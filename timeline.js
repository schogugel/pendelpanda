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

  // Spaltenbreite aus der Einstellung „Spalten nebeneinander“ (3–10)
  const nCols = Math.min(10, Math.max(3, settings.cols || 3));
  const usableW = Math.max(140, scroller.clientWidth - TL.AXIS_W);
  tl.colW = Math.max(44, Math.round(usableW / nCols) - TL.GAP);

  let min = Infinity, max = -Infinity;
  for (const it of tl.itins) {
    const legs = transitLegs(it);
    min = Math.min(min, +new Date(legs[0].from.departure));
    max = Math.max(max, +new Date(legs[legs.length - 1].to.arrival));
  }
  tl.t0 = min - TL.PAD_MIN * 60000;
  tl.t1 = max + TL.PAD_MIN * 60000;

  // Neuer Suchlauf: Zoom so wählen, dass die ersten 2–3 Verbindungen komplett
  // ins Bild passen (Ausreißer gehen nur gedämpft ein)
  if (!sameSearch) tl.ppm = tlAutoZoom(scroller);

  tlBuild(scroller);

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
    // Start: im „Jetzt“-Modus richtet die rote Jetzt-Linie die Ansicht aus
    // (leicht unter der Kopf-Kachel), sonst der erste Balken
    scroller.scrollLeft = 0;
    const now = Date.now();
    const anchor = (app.searchTime.kind === "now" && now >= tl.t0 && now <= tl.t1)
      ? tlY(now)
      : tl.bars[0].top;
    scroller.scrollTop = Math.max(0, anchor - tlHeadClear());
  }
  tl.lastAlignLeft = scroller.scrollLeft;
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

  tl.itins.forEach((it, i) => {
    const left = TL.AXIS_W + TL.GAP + i * (tl.colW + TL.GAP);
    canvas.appendChild(tlColumn(it, left));
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

/* Default-Zoom: Ziel ist, dass die ersten R Verbindungen (Einstellung
   „Verbindungen komplett im Bild“, 3–6) vertikal komplett sichtbar sind.
   Für k = R/R+1/R+2 wird der ideale Zoom berechnet und mit abnehmenden
   Gewichten gemittelt — ein Langläufer (Nachtzug) drückt nur gedämpft. */
function tlAutoZoom(sc) {
  const usable = Math.max(180, (sc.clientHeight || 400) - TL.HEAD_H - 60);
  const dep0 = +new Date(transitLegs(tl.itins[0])[0].from.departure);
  const spanMin = (k) => {
    let end = 0;
    for (let i = 0; i < Math.min(k, tl.itins.length); i++) {
      const legs = transitLegs(tl.itins[i]);
      end = Math.max(end, +new Date(legs[legs.length - 1].to.arrival));
    }
    return (end - dep0) / 60000;
  };
  const R = Math.min(6, Math.max(3, settings.rows || 3));
  let num = 0, den = 0;
  for (const [k, w] of [[R, 1], [R + 1, 0.55], [R + 2, 0.3]]) {
    const s = spanMin(k);
    if (s > 0) { num += w * (usable / s); den += w; }
  }
  const ppm = den ? num / den : 4;
  return Math.min(TL.MAX_PPM, Math.max(TL.MIN_PPM, ppm));
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

function tlColumn(it, left) {
  const legs = transitLegs(it);
  const dep = legs[0].from, arr = legs[legs.length - 1].to;
  const cancelled = it.legs.some(l => l.cancelled);
  const delayMin = diffMin(dep.scheduledDeparture, dep.departure);
  const top = tlY(+new Date(dep.departure));
  const height = Math.max(10, tlY(+new Date(arr.arrival)) - top);

  const col = document.createElement("div");
  col.className = "tl-col";
  col.style.left = left + "px";
  col.style.width = tl.colW + "px";

  // Kopf bleibt beim Scrollen sichtbar; Tipp darauf holt den Balken ins Bild
  const head = document.createElement("button");
  head.className = "tl-head" + (cancelled ? " cancelled" : "");
  head.innerHTML =
    `<span class="tl-hl"><strong>${fmtTime(dep.departure)}</strong> ${cancelled ? `<span class="cancelled-label">Fällt aus</span>` : delayBadge(delayMin)}</span>` +
    `<small>${Math.round(it.duration / 60)} min</small>` +
    `<small>${it.transfers} Umst.</small>`;
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
  bar.className = "tl-bar" + (cancelled ? " cancelled" : "");
  bar.style.top = top + "px";
  bar.style.height = height + "px";
  bar.setAttribute("aria-label", `${fmtTime(dep.departure)} bis ${fmtTime(arr.arrival)}`);
  bar.addEventListener("click", () => openTripDialog(it));

  for (const l of legs) {
    const s0 = tlY(+new Date(l.from.departure)) - top;
    const s1 = tlY(+new Date(l.to.arrival)) - top;
    const seg = document.createElement("span");
    const h = Math.max(6, s1 - s0);
    seg.className = `tl-seg seg-${productClass(l.mode)}` + (h < 20 ? " nolabel" : "") + (l.cancelled ? " seg-cancelled" : "");
    seg.style.top = s0 + "px";
    seg.style.height = h + "px";
    seg.textContent = l.routeShortName || l.displayName || "";
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
  newPpm = Math.min(TL.MAX_PPM, Math.max(TL.MIN_PPM, newPpm));
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

  byId("tl-zoom-in").addEventListener("click", () => tlSetZoom(tl.ppm * 1.4));
  byId("tl-zoom-out").addEventListener("click", () => tlSetZoom(tl.ppm / 1.4));

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
    const maxTop = Math.max(0, sc.scrollHeight - sc.clientHeight);
    const targetLeft = Math.min(maxLeft, Math.max(0, Math.round(sc.scrollLeft / step) * step));
    let targetTop = Math.min(maxTop, Math.max(0, sc.scrollTop));

    // Y-Regel: nach Spaltenwechsel (oder wenn nichts im Bild wäre) den linkesten
    // sichtbaren Balken leicht unter die Kopf-Kachel legen
    const clear = tlHeadClear();
    const vx0 = targetLeft + TL.AXIS_W, vx1 = targetLeft + sc.clientWidth;
    const visible = tl.bars.filter(b => b.colLeft + tl.colW > vx0 && b.colLeft < vx1);
    if (visible.length) {
      const horizChanged = Math.abs(targetLeft - (tl.lastAlignLeft ?? targetLeft)) > 2;
      const anyInView = visible.some(b =>
        b.top < targetTop + sc.clientHeight - 20 && b.top + b.height > targetTop + clear + 20);
      if (horizChanged || !anyInView) targetTop = Math.max(0, visible[0].top - clear);
    }

    tl.autoScrolling = true;
    sc.scrollTo({ left: targetLeft, top: targetTop, behavior: "smooth" });
    setTimeout(() => { tl.autoScrolling = false; tlEdgeCheck(sc); }, 450);
    tl.lastAlignLeft = targetLeft;
  }

  sc.addEventListener("pointerdown", (e) => {
    tl.pointers.set(e.pointerId, e);
    tl.autoScrolling = false; // laufendes Gleiten übernehmen
    if (tl.pointers.size === 2) {
      const [a, b] = [...tl.pointers.values()];
      tl.pinchBase = { dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), ppm: tl.ppm };
      panLast = null;
    } else if (tl.pointers.size === 1 && e.pointerType === "touch") {
      panLast = { x: e.clientX, y: e.clientY, t: performance.now() };
      panMoved = 0;
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

      panMoved += Math.abs(dx) + Math.abs(dy);
      panLast = { x: e.clientX, y: e.clientY, t: performance.now() };
    }
  });

  const lift = (e) => {
    tl.pointers.delete(e.pointerId);
    if (tl.pointers.size < 2) tl.pinchBase = null;
    if (e.pointerType === "touch" && tl.pointers.size === 0 && panLast) {
      if (panMoved > 10) { tl.suppressClick = true; releaseGlide(); }
      panLast = null;
    }
  };
  sc.addEventListener("pointerup", lift);
  sc.addEventListener("pointercancel", lift);

  // Nach echtem Panning keinen Balken-Tap auslösen
  sc.addEventListener("click", (e) => {
    if (tl.suppressClick) { tl.suppressClick = false; e.stopPropagation(); e.preventDefault(); }
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
  const needH = Math.abs(sc.scrollLeft - targetLeft) > 2;

  const vx0 = targetLeft + TL.AXIS_W, vx1 = targetLeft + sc.clientWidth;
  const vy0 = sc.scrollTop + tlHeadClear(), vy1 = sc.scrollTop + sc.clientHeight;
  const visible = tl.bars.filter(b => b.colLeft + tl.colW > vx0 && b.colLeft < vx1);
  if (!visible.length) { tl.lastAlignLeft = targetLeft; return; }
  const anyInView = visible.some(b => b.top < vy1 - 20 && b.top + b.height > vy0 + 20);
  const horizMoved = Math.abs(sc.scrollLeft - (tl.lastAlignLeft ?? sc.scrollLeft)) > 24;
  const targetTop = Math.max(0, visible[0].top - tlHeadClear());
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
