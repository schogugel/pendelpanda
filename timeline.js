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
  COL_W: 128,
  GAP: 10,
  AXIS_W: 50,
  PAD_MIN: 14,      // Minuten Luft über erster Abfahrt / unter letzter Ankunft
  HEAD_H: 46,
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
const PRODUCT_LABEL = { fern: "Fernverkehr", regio: "Regionalzug", sbahn: "S-Bahn", utram: "U-Bahn/Tram", bus: "Bus/Sonstige" };

function renderTimeline(itins) {
  const scroller = byId("timeline");
  const prevT0 = tl.t0;
  const keepScroll = tl.itins.length && itins.length > tl.itins.length;
  const prev = { left: scroller.scrollLeft, top: scroller.scrollTop };

  tl.itins = itins.filter(it => transitLegs(it).length);
  if (!tl.itins.length) { scroller.innerHTML = `<p class="status">Keine Verbindungen.</p>`; return; }

  let min = Infinity, max = -Infinity;
  for (const it of tl.itins) {
    const legs = transitLegs(it);
    min = Math.min(min, +new Date(legs[0].from.departure));
    max = Math.max(max, +new Date(legs[legs.length - 1].to.arrival));
  }
  tl.t0 = min - TL.PAD_MIN * 60000;
  tl.t1 = max + TL.PAD_MIN * 60000;

  tlBuild(scroller);

  if (keepScroll) {
    scroller.scrollLeft = prev.left;
    scroller.scrollTop = prev.top + tlY(prevT0);
  } else {
    // Start: erste Verbindung oben links im Blick
    scroller.scrollLeft = 0;
    scroller.scrollTop = Math.max(0, tl.bars[0].top - TL.HEAD_H - 12);
  }
  tlLegend();
}

function tlBuild(scroller) {
  tl.bars = [];
  const heightPx = tlY(tl.t1);
  const widthPx = TL.AXIS_W + tl.itins.length * (TL.COL_W + TL.GAP) + TL.GAP;

  const canvas = document.createElement("div");
  canvas.className = "tl-canvas";
  canvas.style.width = widthPx + "px";
  canvas.style.height = heightPx + "px";

  canvas.appendChild(tlGrid(heightPx, widthPx));
  canvas.appendChild(tlAxis(heightPx));
  tlNowLine(canvas, widthPx);

  tl.itins.forEach((it, i) => {
    const left = TL.AXIS_W + TL.GAP + i * (TL.COL_W + TL.GAP);
    canvas.appendChild(tlColumn(it, left));
  });

  scroller.innerHTML = "";
  scroller.appendChild(canvas);
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
  col.style.width = TL.COL_W + "px";

  // Kopf bleibt beim Scrollen sichtbar; Tipp darauf holt den Balken ins Bild
  const head = document.createElement("button");
  head.className = "tl-head" + (cancelled ? " cancelled" : "");
  head.innerHTML =
    `<strong>${fmtTime(dep.departure)}</strong> ${cancelled ? `<span class="cancelled-label">Fällt aus</span>` : delayBadge(delayMin)}` +
    `<small>${Math.round(it.duration / 60)} min · ${it.transfers} Umst.</small>`;
  head.addEventListener("click", () => {
    const sc = byId("timeline");
    const viewTop = sc.scrollTop + TL.HEAD_H, viewBot = sc.scrollTop + sc.clientHeight;
    if (top < viewTop || top > viewBot - 40) {
      tl.autoScrolling = true;
      sc.scrollTo({ top: Math.max(0, top - TL.HEAD_H - 12), behavior: "smooth" });
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

  tl.bars.push({ colLeft: left, top, height, itin: it });
  return col;
}

function tlLegend() {
  const present = new Set();
  for (const it of tl.itins) for (const l of transitLegs(it)) present.add(productClass(l.mode));
  byId("tl-legend").innerHTML = ["fern", "regio", "sbahn", "utram", "bus"]
    .filter(c => present.has(c))
    .map(c => `<span class="tl-key"><i class="seg-${c}"></i>${PRODUCT_LABEL[c]}</span>`)
    .join("");
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

  // Pinch-Zoom mit zwei Fingern
  sc.addEventListener("pointerdown", (e) => {
    tl.pointers.set(e.pointerId, e);
    if (tl.pointers.size === 2) {
      const [a, b] = [...tl.pointers.values()];
      tl.pinchBase = { dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), ppm: tl.ppm };
    }
  });
  sc.addEventListener("pointermove", (e) => {
    if (!tl.pointers.has(e.pointerId)) return;
    tl.pointers.set(e.pointerId, e);
    if (tl.pointers.size === 2 && tl.pinchBase) {
      const [a, b] = [...tl.pointers.values()];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (dist > 20) tlSetZoom(tl.pinchBase.ppm * dist / tl.pinchBase.dist, (a.clientY + b.clientY) / 2);
    }
  });
  const lift = (e) => { tl.pointers.delete(e.pointerId); if (tl.pointers.size < 2) tl.pinchBase = null; };
  sc.addEventListener("pointerup", lift);
  sc.addEventListener("pointercancel", lift);

  // Nie im Leeren landen: Wenn nach dem Scrollen kein Balken im Bild ist,
  // sanft zum Balken der sichtbaren Spalte nachziehen.
  sc.addEventListener("scroll", () => {
    if (tl.autoScrolling) return;
    clearTimeout(tl.followTimer);
    tl.followTimer = setTimeout(() => tlFollow(sc), 180);
  });
}

function tlFollow(sc) {
  if (!tl.bars.length || tl.autoScrolling) return;
  const vx0 = sc.scrollLeft + TL.AXIS_W, vx1 = sc.scrollLeft + sc.clientWidth;
  const vy0 = sc.scrollTop + TL.HEAD_H, vy1 = sc.scrollTop + sc.clientHeight;
  const visible = tl.bars.filter(b => b.colLeft + TL.COL_W > vx0 && b.colLeft < vx1);
  if (!visible.length) return;
  const inView = visible.some(b => b.top < vy1 - 20 && b.top + b.height > vy0 + 20);
  if (inView) return;
  // nächstliegenden Balken der sichtbaren Spalten anfahren
  const target = visible.reduce((best, b) => {
    const d = b.top > vy1 ? b.top - vy1 : vy0 - (b.top + b.height);
    return d < best.d ? { d, b } : best;
  }, { d: Infinity, b: visible[0] }).b;
  tl.autoScrolling = true;
  sc.scrollTo({ top: Math.max(0, target.top - TL.HEAD_H - 12), behavior: "smooth" });
  setTimeout(() => { tl.autoScrolling = false; }, 600);
}

document.addEventListener("DOMContentLoaded", tlInitInteractions);
if (document.readyState !== "loading") tlInitInteractions();
