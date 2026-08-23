"use strict";

/*
 * Grafische Fahrplan-Ansicht (das alte PendelPanda-Markenzeichen):
 * vertikale Zeitachse, jede Verbindung ein Balken von Abfahrt (oben) bis
 * Ankunft (unten), Verbindungen nebeneinander nach Abfahrtszeit gestaffelt.
 * Scrollbar in beide Richtungen, Zoom per Pinch / Strg+Rad / Tasten.
 */

const TL = {
  MIN_PPM: 1.5,
  MAX_PPM: 14,
  COL_W: 100,
  GAP: 8,
  AXIS_W: 50,
  PAD_MIN: 14,      // Minuten Luft über erster Abfahrt / unter letzter Ankunft
  HEAD_H: 58,
};

const tl = {
  ppm: 4,           // Pixel pro Minute (Zoomstufe)
  t0: 0, t1: 0,     // Zeitfenster (ms)
  itins: [],
  bars: [],         // {colLeft, top, height, itin}
  pointers: new Map(),
  pinchBase: null,
  autoScrolling: false,
  followTimer: null,
};

function tlY(ms) { return (ms - tl.t0) / 60000 * tl.ppm; }

// Ausfall kann am Abschnitt, an den Halten oder an Zwischenhalten hängen
function legCancelled(l) {
  return !!(l.cancelled || l.from?.cancelled || l.to?.cancelled ||
    (l.intermediateStops || []).some(s => s.cancelled));
}

/* Nur echte VERKEHRSMITTEL-Flags zählen als Ausfall. Flags auf Umsteige-
   Fußwegen sind erfahrungsgemäß Echtzeitdaten-Artefakte am Umstiegshalt
   (die Direktsuche zeigt dieselben Anschlüsse als fahrend) — sie werden
   als „Umstieg prüfen“-Hinweis behandelt, nicht als Ausfall. */
function cancelledTransitLegs(it) {
  return new Set(it.legs.filter(l => l.mode !== "WALK" && legCancelled(l)));
}

function transferWarning(it) {
  return it.legs.some(l => l.mode === "WALK" && legCancelled(l));
}

function productClass(mode) {
  if (["HIGHSPEED_RAIL", "LONG_DISTANCE", "NIGHT_RAIL"].includes(mode)) return "fern";
  if (["REGIONAL_RAIL", "REGIONAL_FAST_RAIL", "RAIL"].includes(mode)) return "regio";
  if (["SUBURBAN", "METRO"].includes(mode)) return "sbahn";
  if (["SUBWAY", "TRAM"].includes(mode)) return "utram";
  return "bus";
}
function renderTimeline(itins, focus = "start") {
  const scroller = byId("timeline");
  const prevT0 = tl.t0;
  const prevFirstKey = tl.itins.length ? itKey(tl.itins[0]) : null;
  const sameSearch = tl.searchTag === app.searchTag;
  tl.searchTag = app.searchTag;
  const keepScroll = sameSearch && tl.itins.length && itins.length > tl.itins.length;
  const prev = { left: scroller.scrollLeft, top: scroller.scrollTop };

  tl.itins = itins.filter(it => transitLegs(it).length);
  if (!tl.itins.length) { scroller.innerHTML = `<p class="status">Keine Verbindungen.</p>`; return; }

  // Spalten nebeneinander aus der Einstellung (3/4/5, Default 3),
  // Breite auf großen Screens gedeckelt
  const nCols = Math.min(5, Math.max(3, settings.cols || 3));
  const usableW = Math.max(140, scroller.clientWidth - TL.AXIS_W);
  tl.colW = Math.min(170, Math.max(44, Math.round(usableW / nCols) - TL.GAP));

  // Zoom-Untergrenze: so weit rauszoomen, dass Beschriftungen verschwinden,
  // geht nicht — das Gros der Abschnitte (25%-Quantil der Fahrzeiten) muss
  // seine Label-Mindesthöhe von 20px behalten
  const legMins = [];
  for (const it of tl.itins) for (const l of transitLegs(it)) {
    legMins.push((+new Date(l.to.arrival) - +new Date(l.from.departure)) / 60000);
  }
  legMins.sort((a, b) => a - b);
  const p25 = legMins[Math.floor(legMins.length * 0.25)] || 10;
  tl.minPpm = Math.min(8, Math.max(TL.MIN_PPM, 20 / Math.max(2, p25)));
  tl.ppm = Math.max(tl.ppm, tl.minPpm);

  let min = Infinity, max = -Infinity;
  for (const it of tl.itins) {
    const legs = transitLegs(it);
    min = Math.min(min, +new Date(legs[0].from.departure));
    max = Math.max(max, +new Date(legs[legs.length - 1].to.arrival));
  }
  tl.t0 = min - TL.PAD_MIN * 60000;
  tl.t1 = max + TL.PAD_MIN * 60000;

  // Startspalte (im „Jetzt“-Modus die erste noch erreichbare Verbindung)
  let startIdx = 0;
  if (app.searchTime.kind === "now") {
    const i = tl.itins.findIndex(it =>
      +new Date(transitLegs(it)[0].from.departure) >= Date.now() - 30000);
    if (i > 0) startIdx = i;
  }

  // Neuer Suchlauf: Y-Zoom dynamisch aus den Verbindungen ab der Startspalte
  if (!sameSearch) {
    tl.ppm = tlAutoZoom(scroller, startIdx);
    tl.lastZoomIdx = startIdx;
  }

  // Im „Jetzt“-Modus garantiert genug Kopffreiheit über der Jetzt-Linie,
  // damit sie unter der Kopf-Kachel positioniert werden kann
  if (app.searchTime.kind === "now") {
    const needMs = (90 / tl.ppm + 4) * 60000;
    tl.t0 = Math.min(tl.t0, Date.now() - needMs);
  }

  tlBuild(scroller);

  // Selbstkorrektur: reicht der Platz über der Jetzt-Linie nicht für die
  // real gemessene Kopf-Kachel, Zeitfläche exakt erweitern und neu bauen
  if (!keepScroll && focus === "start" && app.searchTime.kind === "now") {
    const nowMs = Date.now();
    const needed = tlHeadClear() + 8;
    if (nowMs <= tl.t1 && tlY(nowMs) < needed) {
      tl.t0 -= ((needed - tlY(nowMs)) / tl.ppm) * 60000;
      tlBuild(scroller);
    }
  }

  if (keepScroll) {
    // Wurden frühere Verbindungen vorangestellt, sind die Spalten nach rechts gerückt
    const shift = prevFirstKey ? Math.max(0, tl.itins.findIndex(it => itKey(it) === prevFirstKey)) : 0;
    scroller.scrollLeft = prev.left + shift * (tl.colW + TL.GAP);
    scroller.scrollTop = prev.top + tlY(prevT0);
  } else if (focus === "end") {
    // ans Ende scrollen
    const last = tl.bars[tl.bars.length - 1];
    scroller.scrollLeft = scroller.scrollWidth;
    scroller.scrollTop = Math.max(0, last.top + last.height - scroller.clientHeight + 40);
  } else if (focus !== "start") {
    // eine bestimmte Verbindung fokussieren (z. B. letzte anständige der Nacht),
    // mit Kontext davor und danach im Bild
    const idx = tl.itins.findIndex(it => itKey(it) === focus);
    const bar = idx >= 0 ? tl.bars[idx] : tl.bars[tl.bars.length - 1];
    scroller.scrollLeft = Math.max(0, bar.colLeft - TL.AXIS_W - (scroller.clientWidth - TL.AXIS_W) * 0.3);
    scroller.scrollTop = Math.max(0, bar.top - tlHeadClear() - 30);
    if (bar.head) bar.head.classList.add("tl-focus");
  } else {
    // Start: linkeste sichtbare Spalte ist die erste noch ERREICHBARE
    // Verbindung; vertikal gilt dieselbe Docking-Regel wie beim Einrasten
    scroller.scrollLeft = startIdx * (tl.colW + TL.GAP);
    scroller.scrollTop = tlAlignTopFor(tl.bars[startIdx] || tl.bars[0], scroller);
  }
  tl.lastAlignLeft = scroller.scrollLeft;
}

/* Vertikales Einrast-Ziel für eine Spalte: normalerweise die Abfahrt des
   Balkens leicht unter der Kopf-Kachel. Ist die Spalte die NÄCHSTE noch
   erreichbare Verbindung, dockt die Ansicht an der aktuellen Uhrzeit an —
   ABER nur, wenn dabei mindestens 40 % des ersten Transportmittel-Segments
   sichtbar bleiben; sonst gewinnt der Balken (sonst sähe man bei großem
   Abstand nur die Jetzt-Linie und keine Verbindung). */
function tlAlignTopFor(bar, sc) {
  const clear = tlHeadClear();
  const barTop = Math.max(0, bar.top - clear);
  if (app.searchTime.kind !== "now") return barTop;
  const now = Date.now();
  const dep = b => +new Date(transitLegs(b.itin)[0].from.departure);
  const idx = tl.bars.indexOf(bar);
  const isNextReachable = now >= tl.t0 && now <= tl.t1 &&
    dep(bar) >= now - 30000 &&
    (idx <= 0 || dep(tl.bars[idx - 1]) < now - 30000);
  if (!isNextReachable) return barTop;
  const nowTop = Math.max(0, tlY(now) - clear);
  const viewH = sc ? sc.clientHeight : 0;
  if (viewH) {
    const legs = transitLegs(bar.itin);
    const seg1H = Math.max(1, tlY(+new Date(legs[0].to.arrival)) - bar.top);
    const visiblePx = Math.min(seg1H, nowTop + viewH - bar.top);
    if (visiblePx / seg1H < 0.4) return barTop;
  }
  return nowTop;
}

// Tatsächlicher Platzbedarf der sticky Kopf-Kacheln: die höchste der ersten
// Spalten zählt (Umbrüche/„Fällt aus“ machen einzelne Kacheln höher)
function tlHeadClear() {
  let h = 40;
  for (const b of tl.bars.slice(0, 12)) {
    if (b.head && b.head.offsetHeight > h) h = b.head.offsetHeight;
  }
  if (!tl.bars.length) h = TL.HEAD_H;
  return h + 6 + 16; // sticky-Offset + Luft
}

function tlBuild(scroller) {
  tl.bars = [];
  const heightPx = tlY(tl.t1);
  const widthPx = TL.AXIS_W + tl.itins.length * (tl.colW + TL.GAP) + TL.GAP;

  const canvas = document.createElement("div");
  canvas.className = "tl-canvas";
  canvas.style.width = widthPx + "px";
  canvas.style.height = heightPx + "px";

  canvas.appendChild(tlGrid(heightPx, widthPx));
  canvas.appendChild(tlAxis(heightPx));
  tlNowLine(canvas, widthPx);

  // Dominierte Verbindungen (fahren früher los, kommen nicht früher an als
  // eine später startende) werden ausgegraut dargestellt
  const times = tl.itins.map(it => {
    const legs = transitLegs(it);
    return { dep: +new Date(legs[0].from.departure), arr: +new Date(legs[legs.length - 1].to.arrival) };
  });
  const dominated = times.map((a, i) => times.some((b, j) =>
    j !== i && b.dep >= a.dep && b.arr <= a.arr && (b.dep > a.dep || b.arr < a.arr)));

  tl.itins.forEach((it, i) => {
    const left = TL.AXIS_W + TL.GAP + i * (tl.colW + TL.GAP);
    canvas.appendChild(tlColumn(it, left, dominated[i]));
  });

  scroller.innerHTML = "";
  scroller.appendChild(canvas);
  // Rand-Nachladen erst scharf schalten, wenn der Nutzer den Rand verlassen hat
  tl.armedLeft = false;
  tl.armedRight = false;
}

/* Am Rand angekommen → nächsten Batch in diese Richtung laden.
   Scharf geschaltet wird eine Seite erst, sobald man NICHT am Rand ist —
   die Startposition am linken Rand löst also nichts aus. */
function tlEdgeCheck(sc) {
  if (sc.scrollWidth <= sc.clientWidth + 4) return;
  const atLeft = sc.scrollLeft <= 2;
  const atRight = sc.scrollLeft + sc.clientWidth >= sc.scrollWidth - 2;
  if (!atLeft) tl.armedLeft = true;
  if (!atRight) tl.armedRight = true;
  const now = Date.now();
  if (now - (tl.lastEdgeLoad || 0) < 1500 || typeof loadMore !== "function") return;
  if (atLeft && tl.armedLeft) {
    tl.armedLeft = false;
    tl.lastEdgeLoad = now;
    loadMore("earlier");
  } else if (atRight && tl.armedRight) {
    tl.armedRight = false;
    tl.lastEdgeLoad = now;
    loadMore("later");
  }
}

/* Dynamischer Y-Zoom: der Anzeigebereich wird exakt auf die Verbindung der
   Zielspalte (startIdx) skaliert — sie füllt die Sichtfläche und ist damit
   immer vollständig zu sehen. */
function tlAutoZoom(sc, startIdx = 0) {
  const usable = Math.max(180, (sc.clientHeight || 400) - TL.HEAD_H - 60);
  const it = tl.itins[Math.min(tl.itins.length - 1, Math.max(0, startIdx))];
  if (!it) return tl.ppm || 4;
  const legs = transitLegs(it);
  const durMin = Math.max(1,
    (+new Date(legs[legs.length - 1].to.arrival) - +new Date(legs[0].from.departure)) / 60000);
  const ppm = usable / durMin;
  return Math.min(TL.MAX_PPM, Math.max(tl.minPpm || TL.MIN_PPM, ppm));
}

function tlGrid(h, w) {
  const step = tlTickStep();
  const g = document.createElement("div");
  g.className = "tl-gridlines";
  g.style.width = w + "px";
  g.style.height = h + "px";
  const minor = step * tl.ppm, hour = 60 * tl.ppm;
  // Linien auf runde Uhrzeiten ausrichten
  const off = m => ((m - ((tl.t0 / 60000) % m)) % m) * tl.ppm;
  g.style.backgroundImage =
    `repeating-linear-gradient(to bottom, var(--tl-line-strong) 0 1px, transparent 1px ${hour}px),` +
    `repeating-linear-gradient(to bottom, var(--tl-line) 0 1px, transparent 1px ${minor}px)`;
  g.style.backgroundPosition = `0 ${off(60)}px, 0 ${off(step)}px`;
  return g;
}

function tlTickStep() {
  for (const s of [5, 10, 15, 30, 60, 120]) if (s * tl.ppm >= 44) return s;
  return 240;
}

function tlAxis(h) {
  const axis = document.createElement("div");
  axis.className = "tl-axis";
  axis.style.height = h + "px";
  const step = tlTickStep() * 60000;
  let t = Math.ceil(tl.t0 / step) * step;
  for (; t < tl.t1; t += step) {
    const tick = document.createElement("span");
    tick.className = "tl-tick";
    tick.style.top = tlY(t) + "px";
    tick.textContent = fmtTime(new Date(t).toISOString());
    axis.appendChild(tick);
  }
  return axis;
}

function tlNowLine(canvas, w) {
  const now = Date.now();
  if (now < tl.t0 || now > tl.t1) return;
  const line = document.createElement("div");
  line.className = "tl-now";
  line.style.top = tlY(now) + "px";
  line.style.width = w + "px";
  const label = document.createElement("span");
  label.textContent = "jetzt";
  line.appendChild(label);
  canvas.appendChild(line);
}

function tlColumn(it, left, isDominated = false) {
  const legs = transitLegs(it);
  const dep = legs[0].from, arr = legs[legs.length - 1].to;
  const flagged = cancelledTransitLegs(it);
  const cancelled = flagged.size > 0;
  const warn = !cancelled && transferWarning(it);
  const delayMin = diffMin(dep.scheduledDeparture, dep.departure);
  const top = tlY(+new Date(dep.departure));
  const height = Math.max(10, tlY(+new Date(arr.arrival)) - top);

  const col = document.createElement("div");
  col.className = "tl-col" + (isDominated ? " dominated" : "");
  col.style.left = left + "px";
  col.style.width = tl.colW + "px";

  // Kopf bleibt beim Scrollen sichtbar; Tipp darauf holt den Balken ins Bild
  const head = document.createElement("button");
  head.className = "tl-head" + (cancelled ? " cancelled" : "");
  head.innerHTML =
    `<span class="tl-hl"><strong>${fmtTime(dep.departure)}</strong> ${cancelled ? `<span class="cancelled-label">Fällt aus</span>` : delayBadge(delayMin)}</span>` +
    `<small>${fmtDur(it.duration)}</small>` +
    `<small>${it.transfers} Umst.</small>` +
    (warn ? `<small class="warn-label">⚠ Umstieg prüfen</small>` : "");
  head.addEventListener("click", () => {
    const sc = byId("timeline");
    const viewTop = sc.scrollTop + tlHeadClear(), viewBot = sc.scrollTop + sc.clientHeight;
    if (top < viewTop - 10 || top > viewBot - 40) {
      tl.autoScrolling = true;
      sc.scrollTo({ top: Math.max(0, top - tlHeadClear()), behavior: "smooth" });
      setTimeout(() => { tl.autoScrolling = false; }, 500);
    } else {
      openTripDialog(it);
    }
  });
  col.appendChild(head);

  const bar = document.createElement("button");
  bar.className = "tl-bar";
  bar.style.top = top + "px";
  bar.style.height = height + "px";
  bar.setAttribute("aria-label", `${fmtTime(dep.departure)} bis ${fmtTime(arr.arrival)}`);
  bar.addEventListener("click", () => openTripDialog(it));

  for (const l of legs) {
    const s0 = tlY(+new Date(l.from.departure)) - top;
    const s1 = tlY(+new Date(l.to.arrival)) - top;
    const seg = document.createElement("span");
    const h = Math.max(6, s1 - s0);
    const isCancelled = flagged.has(l);
    seg.className = `tl-seg seg-${productClass(l.mode)}` + (h < 20 ? " nolabel" : "") + (isCancelled ? " seg-cancelled" : "");
    seg.style.top = s0 + "px";
    seg.style.height = h + "px";
    const name = l.routeShortName || l.displayName || "";
    // Ausgefallene Teilstücke: Streifenmuster, Name als weißer Text auf Schwarz
    if (isCancelled) seg.innerHTML = `<span class="seg-label">${escapeHtml(name)}</span>`;
    else seg.textContent = name;
    bar.appendChild(seg);
  }

  const t1lbl = document.createElement("span");
  t1lbl.className = "tl-arr";
  t1lbl.style.top = (top + height + 3) + "px";
  t1lbl.textContent = `an ${fmtTime(arr.arrival)}`;
  col.appendChild(bar);
  col.appendChild(t1lbl);

  tl.bars.push({ colLeft: left, top, height, itin: it, head });
  return col;
}

/* ---------- Zoom ---------- */

function tlSetZoom(newPpm, anchorClientY) {
  const sc = byId("timeline");
  newPpm = Math.min(TL.MAX_PPM, Math.max(tl.minPpm || TL.MIN_PPM, newPpm));
  if (Math.abs(newPpm - tl.ppm) < 0.01) return;
  const rect = sc.getBoundingClientRect();
  const y = (anchorClientY ?? rect.top + rect.height / 2) - rect.top;
  const anchorTime = tl.t0 + (sc.scrollTop + y) / tl.ppm * 60000;
  const left = sc.scrollLeft;
  tl.ppm = newPpm;
  tlBuild(sc);
  sc.scrollLeft = left;
  sc.scrollTop = Math.max(0, tlY(anchorTime) - y);
}

function tlInitInteractions() {
  const sc = byId("timeline");

  sc.addEventListener("wheel", (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    tlSetZoom(tl.ppm * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientY);
  }, { passive: false });

  /* Freies Touch-Panning (kein Achsen-Threshold: diagonal ab dem ersten Pixel).
     Beim Loslassen rastet die Ansicht DIREKT von der aktuellen Position ein:
     Spaltengrenze auf der X-Achse, Y-Regel — ohne Schwung-Nachlauf. */
  let panLast = null, panMoved = 0;

  function releaseGlide() {
    const step = tl.colW + TL.GAP;
    const maxLeft = Math.max(0, sc.scrollWidth - sc.clientWidth);
    const targetLeft = Math.min(maxLeft, Math.max(0, Math.round(sc.scrollLeft / step) * step));

    // Dynamischen Y-Zoom nur bei Spaltenwechsel anwenden (Pinch in derselben
    // Spalte bleibt unangetastet); baut ggf. neu, Bildmitte bleibt verankert
    const idx0 = Math.min(tl.itins.length - 1, Math.max(0, Math.round(targetLeft / step)));
    if (idx0 !== tl.lastZoomIdx) {
      tl.lastZoomIdx = idx0;
      const dyn = tlAutoZoom(sc, idx0);
      if (Math.abs(dyn - tl.ppm) / tl.ppm > 0.05) tlSetZoom(dyn);
    }

    const maxTop = Math.max(0, sc.scrollHeight - sc.clientHeight);
    let targetTop = Math.min(maxTop, Math.max(0, sc.scrollTop));

    // Y-Regel: nach Spaltenwechsel (oder wenn nichts im Bild wäre) den linkesten
    // sichtbaren Balken leicht unter die Kopf-Kachel legen — bzw. bei der
    // nächsten erreichbaren Verbindung an der Jetzt-Linie andocken
    const clear = tlHeadClear();
    const vx0 = targetLeft + TL.AXIS_W, vx1 = targetLeft + sc.clientWidth;
    const visible = tl.bars.filter(b => b.colLeft + tl.colW > vx0 && b.colLeft < vx1);
    if (visible.length) {
      const horizChanged = Math.abs(targetLeft - (tl.lastAlignLeft ?? targetLeft)) > 2;
      const anyInView = visible.some(b =>
        b.top < targetTop + sc.clientHeight - 20 && b.top + b.height > targetTop + clear + 20);
      if (horizChanged || !anyInView) targetTop = tlAlignTopFor(visible[0], sc);
    }

    tl.autoScrolling = true;
    sc.scrollTo({ left: targetLeft, top: targetTop, behavior: "smooth" });
    setTimeout(() => { tl.autoScrolling = false; tlEdgeCheck(sc); }, 450);
    tl.lastAlignLeft = targetLeft;
  }

  sc.addEventListener("pointerdown", (e) => {
    tl.pointers.set(e.pointerId, e);
    // Laufendes Gleiten sofort anhalten und übernehmen — so sind auch Taps
    // während der Einrast-Animation sofort klickbar
    if (tl.autoScrolling) {
      tl.autoScrolling = false;
      sc.scrollTo({ left: sc.scrollLeft, top: sc.scrollTop, behavior: "auto" });
    }
    if (tl.pointers.size === 2) {
      const [a, b] = [...tl.pointers.values()];
      tl.pinchBase = { dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), ppm: tl.ppm };
      panLast = null;
    } else if (tl.pointers.size === 1 && e.pointerType === "touch") {
      panLast = { x: e.clientX, y: e.clientY, t: performance.now() };
      panMoved = 0;
      tl.pullLeft = 0; tl.pullRight = 0;
      try { e.target.setPointerCapture(e.pointerId); } catch { /* egal */ }
    }
  });

  sc.addEventListener("pointermove", (e) => {
    if (!tl.pointers.has(e.pointerId)) return;
    tl.pointers.set(e.pointerId, e);
    if (tl.pointers.size === 2 && tl.pinchBase) {
      const [a, b] = [...tl.pointers.values()];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (dist > 20) tlSetZoom(tl.pinchBase.ppm * dist / tl.pinchBase.dist, (a.clientY + b.clientY) / 2);
      return;
    }
    if (panLast && e.pointerType === "touch" && tl.pointers.size === 1) {
      const dx = e.clientX - panLast.x, dy = e.clientY - panLast.y;
      sc.scrollLeft -= dx;
      sc.scrollTop -= dy;

      // Am Rand weiterziehen lädt nach — funktioniert auch, wenn die Fläche
      // schmaler als der Bildschirm ist und gar kein Scrollen möglich wäre
      const atRight = sc.scrollLeft + sc.clientWidth >= sc.scrollWidth - 2;
      const atLeft = sc.scrollLeft <= 2;
      tl.pullRight = (dx < 0 && atRight) ? (tl.pullRight || 0) - dx : 0;
      tl.pullLeft = (dx > 0 && atLeft) ? (tl.pullLeft || 0) + dx : 0;
      const cool = Date.now() - (tl.lastEdgeLoad || 0) > 1500 && typeof loadMore === "function";
      if (tl.pullRight > 70 && cool) {
        tl.pullRight = 0; tl.lastEdgeLoad = Date.now();
        loadMore("later");
      } else if (tl.pullLeft > 70 && cool) {
        tl.pullLeft = 0; tl.lastEdgeLoad = Date.now();
        loadMore("earlier");
      }

      panMoved += Math.abs(dx) + Math.abs(dy);
      panLast = { x: e.clientX, y: e.clientY, t: performance.now() };
    }
  });

  const lift = (e) => {
    tl.pointers.delete(e.pointerId);
    if (tl.pointers.size < 2) tl.pinchBase = null;
    if (e.pointerType === "touch" && tl.pointers.size === 0 && panLast) {
      if (panMoved > 10) { tl.panEndAt = performance.now(); releaseGlide(); }
      panLast = null;
    }
  };
  sc.addEventListener("pointerup", lift);
  sc.addEventListener("pointercancel", lift);

  // Nach echtem Panning keinen Balken-Tap auslösen
  sc.addEventListener("click", (e) => {
    // Nur Klicks direkt nach einem echten Pan schlucken — als ablaufendes
    // Zeitfenster statt Flag, denn nach Wischgesten feuert der Browser oft
    // gar keinen Klick und ein Flag würde den NÄCHSTEN echten Tap fressen
    if (tl.panEndAt && performance.now() - tl.panEndAt < 300) {
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);

  sc.addEventListener("scroll", () => {
    tlEdgeCheck(sc); // auch beim Gleiten an den Rand → Nachladen
    if (tl.autoScrolling) return;
    clearTimeout(tl.followTimer);
    // kurzer Debounce nur noch für Maus-/Trackpad-Scrollen; Touch rastet
    // direkt beim Loslassen ein (releaseGlide)
    tl.followTimer = setTimeout(() => tlAlign(sc), 120);
  });
}

/* Sanftes Einrasten nach dem Scrollen:
   - horizontal: auf die nächste Spaltengrenze (mehr als die halbe Spalte
     sichtbar → voll einblenden, sonst rausschieben), keine abgeschnittenen
     Spalten am linken Rand
   - vertikal: nach Spaltenwechsel gleitet die Ansicht, bis der linkeste
     sichtbare Balken leicht unter der Kopf-Kachel beginnt; reines
     Hoch-/Runterscrollen bleibt unangetastet, außer kein Balken ist im Bild */
function tlAlign(sc) {
  if (!tl.bars.length || tl.autoScrolling || tl.pointers.size) return;
  const step = tl.colW + TL.GAP;
  const maxLeft = Math.max(0, sc.scrollWidth - sc.clientWidth);
  const targetLeft = Math.min(maxLeft, Math.max(0, Math.round(sc.scrollLeft / step) * step));

  // Dynamischer Y-Zoom nur bei Spaltenwechsel (Maus-/Trackpad-Pfad)
  const idx0 = Math.min(tl.itins.length - 1, Math.max(0, Math.round(targetLeft / step)));
  if (idx0 !== tl.lastZoomIdx) {
    tl.lastZoomIdx = idx0;
    const dyn = tlAutoZoom(sc, idx0);
    if (Math.abs(dyn - tl.ppm) / tl.ppm > 0.05) tlSetZoom(dyn);
  }

  const needH = Math.abs(sc.scrollLeft - targetLeft) > 2;

  const vx0 = targetLeft + TL.AXIS_W, vx1 = targetLeft + sc.clientWidth;
  const vy0 = sc.scrollTop + tlHeadClear(), vy1 = sc.scrollTop + sc.clientHeight;
  const visible = tl.bars.filter(b => b.colLeft + tl.colW > vx0 && b.colLeft < vx1);
  if (!visible.length) { tl.lastAlignLeft = targetLeft; return; }
  const anyInView = visible.some(b => b.top < vy1 - 20 && b.top + b.height > vy0 + 20);
  const horizMoved = Math.abs(sc.scrollLeft - (tl.lastAlignLeft ?? sc.scrollLeft)) > 24;
  const targetTop = tlAlignTopFor(visible[0], sc);
  const needV = (horizMoved || !anyInView) && Math.abs(sc.scrollTop - targetTop) > 8;

  if (needH || needV) {
    tl.autoScrolling = true;
    sc.scrollTo({
      left: needH ? targetLeft : sc.scrollLeft,
      top: needV ? targetTop : sc.scrollTop,
      behavior: "smooth",
    });
    setTimeout(() => { tl.autoScrolling = false; }, 650);
  }
  tl.lastAlignLeft = needH ? targetLeft : sc.scrollLeft;
}

document.addEventListener("DOMContentLoaded", tlInitInteractions);
if (document.readyState !== "loading") tlInitInteractions();
