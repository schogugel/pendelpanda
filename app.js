"use strict";

const API = "https://api.transitous.org/api/v1";
const MIN_SLOTS = 4, MAX_SLOTS = 24;
// Optional: URL des deployten db-link-workers (siehe README, Ordner db-link-worker/).
// Wenn gesetzt, öffnet „Bei der DB öffnen“ exakt die gewählte Verbindung (vbid-Link,
// öffnet auf dem Handy den DB Navigator mit „Zu meinen Reisen hinzufügen“).
// Leer = Fallback auf die vorbefüllte bahn.de-Suche.
const DB_LINK_PROXY = "";
const STORAGE_KEY = "pp.buttons.v1";
const LONGPRESS_MS = 550;

/* ---------------- Zustand ---------------- */

let slots = loadSlots(); // Array(12) aus {name, id} | null
const app = {
  selectedStart: null,   // Slot-Index
  editSlot: null,        // Slot-Index in Bearbeitung
  editMode: false,       // „✎ Bearbeiten“ aktiv
  search: null,          // {from, to}
  itins: [],             // geladene Verbindungen (inkl. „Später“-Seiten)
  nextPageCursor: null,
  viewMode: localStorage.getItem("pp.view") || "graph", // "graph" | "list"
  // Zeitnavigation: kind = now | custom | letzte
  searchTime: { kind: "now", time: null, arriveBy: false },
  prevPageCursor: null,
  hiddenCats: new Set(),  // aktuell über die Legende ausgeblendete Kategorien
  autoLoads: 0,           // automatische Nachlade-Runden pro Suche
};

/* ---------------- Einstellungen (Standard-Verkehrsmittel) ---------------- */

const CATS = ["fern", "regio", "sbahn", "utram", "bus"];
const CAT_LABEL = { fern: "Fernverkehr", regio: "Regionalzug", sbahn: "S-Bahn", utram: "U-Bahn/Tram", bus: "Bus/Sonstige" };

function loadSettings() {
  // Default: Deutschlandticket-Sicht — Fernverkehr aus, Rest an
  const def = {
    show: { fern: false, regio: true, sbahn: true, utram: true, bus: true },
    cols: 3, // Verbindungen nebeneinander in der Grafik (3/4/5)
  };
  try {
    const s = JSON.parse(localStorage.getItem("pp.settings") || "null");
    if (s && s.show) for (const c of CATS) if (typeof s.show[c] === "boolean") def.show[c] = s.show[c];
    const n = s && (Number.isFinite(s.cols) ? s.cols : s.rows); // rows = Altbestand
    if (Number.isFinite(n)) def.cols = Math.min(5, Math.max(3, Math.round(n)));
  } catch { /* Default behalten */ }
  return def;
}
let settings = loadSettings();
function saveSettings() { localStorage.setItem("pp.settings", JSON.stringify(settings)); }

function defaultHiddenCats() {
  return new Set(CATS.filter(c => !settings.show[c]));
}

// Die Kachel-Liste ist geordnet inkl. Leerstellen (Position = Index);
// ihre Länge bestimmt die Anzahl der angezeigten Felder.
function loadSlots() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (Array.isArray(raw) && raw.length) {
      const arr = raw.slice(0, MAX_SLOTS);
      while (arr.length < MIN_SLOTS) arr.push(null);
      return arr;
    }
  } catch { /* Default nutzen */ }
  return new Array(12).fill(null);
}
function saveSlots() { localStorage.setItem(STORAGE_KEY, JSON.stringify(slots)); }

/* ---------------- Ansichten ---------------- */

const views = { grid: byId("view-grid"), edit: byId("view-edit"), results: byId("view-results") };

function byId(id) { return document.getElementById(id); }

function showView(name) {
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
  if (name === "grid") {
    app.selectedStart = null;
    renderGrid();
  }
}

// Zurück-Navigation über den Hash, damit der Android-Back-Button funktioniert
window.addEventListener("hashchange", () => {
  const h = location.hash;
  if (h === "#edit" && app.editSlot !== null) showView("edit");
  else if (h === "#results" && app.search) showView("results");
  else showView("grid");
});

function navigate(name) {
  if (name === "grid") {
    if (location.hash) history.back();
    else showView("grid");
  } else {
    location.hash = name;
  }
}

document.querySelectorAll("[data-back]").forEach(b => b.addEventListener("click", () => navigate("grid")));

/* ---------------- Button-Grid ---------------- */

const gridEl = byId("buttongrid");

function renderGrid() {
  gridEl.innerHTML = "";
  slots.forEach((slot, i) => {
    const btn = document.createElement("button");
    btn.className = "stationbtn" + (slot ? "" : " empty") + (app.selectedStart === i ? " selected" : "");
    btn.textContent = slot ? slot.name : "+";
    btn.dataset.slot = i;
    attachStationPointer(btn, i);
    gridEl.appendChild(btn);
  });
}

// Neue Suche vom Startscreen beginnt immer in der „Jetzt“-Ansicht
function startFreshSearch(from, to) {
  app.searchTime = { kind: "now", time: null, arriveBy: false };
  startSearch(from, to);
}

function onSlotTap(i) {
  if (app.editMode) { setEditMode(false); openEdit(i); return; }
  if (!slots[i]) { openEdit(i); return; }
  if (app.selectedStart === null) {
    app.selectedStart = i;
    renderGrid();
    if (navigator.vibrate) navigator.vibrate(30);
  } else if (app.selectedStart === i) {
    app.selectedStart = null;
    renderGrid();
  } else {
    const from = slots[app.selectedStart], to = slots[i];
    app.selectedStart = null;
    startFreshSearch(from, to);
  }
}

function setEditMode(on) {
  app.editMode = on;
  app.selectedStart = null;
  byId("btn-editmode").textContent = on ? "✓ Fertig" : "✎ Bearbeiten";
  byId("grid-hint").innerHTML = on
    ? "Antippen zum Ändern/Leeren – ziehen zum Verschieben."
    : "Tippe <strong>Start</strong>, dann <strong>Ziel</strong> – oder wische von Start zu Ziel.";
  gridEl.classList.toggle("editing", on);
  renderGrid();
}
byId("btn-editmode").addEventListener("click", () => setEditMode(!app.editMode));

// Tap, Long-Press, Wisch-Verbindung (Linie zum Ziel) und – im Bearbeiten-Modus –
// Verschieben der Kachel per Ziehen (Positionstausch)
function attachStationPointer(btn, i) {
  let holdTimer = null, held = false, dragging = false, mode = null;
  let activeId = null, startX = 0, startY = 0, dropSlot = null;

  btn.addEventListener("pointerdown", (e) => {
    activeId = e.pointerId;
    held = false; dragging = false; dropSlot = null; mode = null;
    startX = e.clientX; startY = e.clientY;
    holdTimer = setTimeout(() => {
      held = true;
      if (navigator.vibrate) navigator.vibrate(60);
      if (slots[i]) openEdit(i);
    }, LONGPRESS_MS);
  });

  btn.addEventListener("pointermove", (e) => {
    if (e.pointerId !== activeId || held) return;
    if (!dragging) {
      if (!slots[i]) return;
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < 14) return;
      dragging = true;
      mode = app.editMode ? "move" : "connect";
      clearTimeout(holdTimer);
      try { btn.setPointerCapture(e.pointerId); } catch { /* egal */ }
      if (mode === "connect") dragStart(btn);
      else moveStart(btn, i);
    }
    dropSlot = mode === "connect" ? dragMove(e, btn, i) : moveMove(e, btn);
  });

  const finish = (e, ok) => {
    if (e.pointerId !== activeId) return;
    activeId = null;
    clearTimeout(holdTimer);
    if (!dragging) return;
    held = true; // nachfolgenden Click schlucken
    if (mode === "connect") {
      dragEnd();
      if (ok && dropSlot !== null) {
        const from = slots[i], to = slots[dropSlot];
        app.selectedStart = null;
        startFreshSearch(from, to);
      }
    } else {
      moveEnd();
      if (ok && dropSlot !== null && dropSlot !== i) {
        [slots[i], slots[dropSlot]] = [slots[dropSlot], slots[i]];
        saveSlots();
        renderGrid(); // Bearbeiten-Modus bleibt aktiv für weitere Umordnungen
      }
    }
    dragging = false;
  };
  btn.addEventListener("pointerup", (e) => finish(e, true));
  btn.addEventListener("pointercancel", (e) => finish(e, false));
  btn.addEventListener("pointerleave", () => { if (!dragging) clearTimeout(holdTimer); });

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    if (!held && !dragging) onSlotTap(i);
    held = false;
  });
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
}

/* --- Wisch-Verbindung: Linie über dem Grid --- */

let dragSvg = null, dragLine = null, dragFrom = null;

function dragStart(btn) {
  dragFrom = btn;
  btn.classList.add("selected");
  if (navigator.vibrate) navigator.vibrate(30);
  dragSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  dragSvg.setAttribute("class", "dragline");
  dragLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
  dragSvg.appendChild(dragLine);
  gridEl.appendChild(dragSvg);
}

function dragMove(e, sourceBtn, sourceSlot) {
  const grid = gridEl.getBoundingClientRect();
  const b = sourceBtn.getBoundingClientRect();
  dragLine.setAttribute("x1", b.left + b.width / 2 - grid.left);
  dragLine.setAttribute("y1", b.top + b.height / 2 - grid.top);
  dragLine.setAttribute("x2", e.clientX - grid.left);
  dragLine.setAttribute("y2", e.clientY - grid.top);

  const under = document.elementFromPoint(e.clientX, e.clientY);
  const target = under && under.closest ? under.closest(".stationbtn") : null;
  gridEl.querySelectorAll(".droptarget").forEach(el => el.classList.remove("droptarget"));
  if (target && target !== sourceBtn) {
    const slot = Number(target.dataset.slot);
    if (slots[slot]) {
      target.classList.add("droptarget");
      return slot;
    }
  }
  return null;
}

function dragEnd() {
  if (dragSvg) dragSvg.remove();
  dragSvg = dragLine = null;
  if (dragFrom) dragFrom.classList.remove("selected");
  dragFrom = null;
  gridEl.querySelectorAll(".droptarget").forEach(el => el.classList.remove("droptarget"));
}

/* --- Kachel verschieben (Bearbeiten-Modus): Ziehen tauscht die Positionen --- */

let moveGhost = null, moveSource = null;

function moveStart(btn, i) {
  moveSource = btn;
  btn.classList.add("moving");
  if (navigator.vibrate) navigator.vibrate(30);
  moveGhost = document.createElement("div");
  moveGhost.className = "moveghost";
  moveGhost.textContent = slots[i].name;
  document.body.appendChild(moveGhost);
}

function moveMove(e, sourceBtn) {
  moveGhost.style.left = e.clientX + "px";
  moveGhost.style.top = e.clientY + "px";
  const under = document.elementFromPoint(e.clientX, e.clientY);
  const target = under && under.closest ? under.closest(".stationbtn") : null;
  gridEl.querySelectorAll(".droptarget").forEach(el => el.classList.remove("droptarget"));
  if (target && target !== sourceBtn) {
    target.classList.add("droptarget"); // auch leere Felder sind gültige Ziele
    return Number(target.dataset.slot);
  }
  return null;
}

function moveEnd() {
  if (moveGhost) moveGhost.remove();
  moveGhost = null;
  if (moveSource) moveSource.classList.remove("moving");
  moveSource = null;
  gridEl.querySelectorAll(".droptarget").forEach(el => el.classList.remove("droptarget"));
}

/* ---------------- Station anlegen / bearbeiten ---------------- */

const stationInput = byId("stationinput");
const suggestionsEl = byId("suggestions");
const clearSlotBtn = byId("btn-clear-slot");
let searchDebounce = null;
let geocodeAbort = null;

function openEdit(i) {
  app.editSlot = i;
  byId("edit-title").textContent = slots[i] ? "Station ändern" : "Station wählen";
  stationInput.value = "";
  suggestionsEl.innerHTML = "";
  clearSlotBtn.hidden = !slots[i];
  navigate("edit");
  setTimeout(() => stationInput.focus(), 50);
}

stationInput.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  const q = stationInput.value.trim();
  if (q.length < 2) { suggestionsEl.innerHTML = ""; return; }
  searchDebounce = setTimeout(() => runGeocode(q), 280);
});

async function runGeocode(q) {
  if (geocodeAbort) geocodeAbort.abort();
  geocodeAbort = new AbortController();
  try {
    const res = await fetch(`${API}/geocode?text=${encodeURIComponent(q)}&language=de`, { signal: geocodeAbort.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    renderSuggestions(data.filter(x => x.type === "STOP").slice(0, 8));
  } catch (e) {
    if (e.name !== "AbortError") {
      suggestionsEl.innerHTML = `<p class="status error">Suche fehlgeschlagen – bist du online?</p>`;
    }
  }
}

function renderSuggestions(stops) {
  suggestionsEl.innerHTML = "";
  if (!stops.length) {
    suggestionsEl.innerHTML = `<p class="status">Keine Station gefunden.</p>`;
    return;
  }
  for (const s of stops) {
    const area = (s.areas || []).find(a => a.default) || (s.areas || [])[0];
    const b = document.createElement("button");
    b.className = "suggestion";
    b.innerHTML = `${escapeHtml(s.name)}<small>${escapeHtml(area ? area.name : "")}</small>`;
    b.addEventListener("click", () => {
      slots[app.editSlot] = { name: s.name, id: s.id };
      saveSlots();
      navigate("grid");
    });
    suggestionsEl.appendChild(b);
  }
}

clearSlotBtn.addEventListener("click", () => {
  slots[app.editSlot] = null;
  saveSlots();
  navigate("grid");
});

/* ---------------- Verbindungssuche ---------------- */

const resultsList = byId("results-list");

function startSearch(from, to) {
  app.search = { from, to };
  app.itins = [];
  app.hiddenCats = defaultHiddenCats();
  app.autoLoads = 0;
  app.searchTag = (app.searchTag || 0) + 1;
  byId("results-title").textContent = `${from.name} → ${to.name}`;
  updateChips();
  navigate("results");
  runPlan();
}

function updateChips() {
  byId("chip-now").classList.toggle("active", app.searchTime.kind === "now");
  byId("chip-last").classList.toggle("active", app.searchTime.kind === "letzte");
  byId("chip-time").classList.toggle("active", app.searchTime.kind === "custom");
}

function restartWith(kind, time = null, arriveBy = false) {
  app.searchTime = { kind, time, arriveBy };
  if (app.search) startSearch(app.search.from, app.search.to);
}

byId("chip-now").addEventListener("click", () => restartWith("now"));
byId("chip-last").addEventListener("click", () => restartWith("letzte"));

// Nachladen: in der Grafik durch Scrollen an den Rand, in der Liste per Button.
// Ein Batch = genau eine API-Anfrage (numItineraries Verbindungen pro Cursor-Seite).
async function loadMore(direction) {
  if (app.paging || !app.search) return;
  const cursor = direction === "earlier" ? app.prevPageCursor : app.nextPageCursor;
  if (!cursor) return;
  app.paging = true;
  const edge = byId(direction === "earlier" ? "tl-load-left" : "tl-load-right");
  const btn = byId(direction === "earlier" ? "list-earlier" : "list-later");
  edge.hidden = false;
  btn.disabled = true;
  try { await runPlan(direction); }
  finally {
    app.paging = false;
    edge.hidden = true;
    btn.disabled = false;
  }
}
byId("list-earlier").addEventListener("click", () => loadMore("earlier"));
byId("list-later").addEventListener("click", () => loadMore("later"));

byId("btn-swap").addEventListener("click", () => {
  if (app.search) startSearch(app.search.to, app.search.from);
});

// Nächstes Betriebsende der Nacht (~03:30) für „Letzte Verbindungen“
function nextNightEnd() {
  const d = new Date();
  d.setHours(3, 30, 0, 0);
  if (d <= new Date()) d.setDate(d.getDate() + 1);
  return d;
}

function itKey(it) {
  const legs = transitLegs(it);
  return legs.map(l => `${l.tripId}@${l.from.scheduledDeparture}`).join("|") || it.startTime;
}

// direction: null = neue Suche, "later" / "earlier" = blättern per Cursor
async function runPlan(direction = null) {
  const { from, to } = app.search;
  const loading = `<p class="status">Suche Verbindungen …</p>`;
  if (!direction) {
    resultsList.innerHTML = loading;
    byId("timeline").innerHTML = loading;
  }
  const t = app.searchTime;
  const baseTime = t.kind === "custom" ? new Date(t.time)
    : t.kind === "letzte" ? nextNightEnd()
    : new Date();
  const params = new URLSearchParams({
    fromPlace: from.id,
    toPlace: to.id,
    time: baseTime.toISOString(),
    numItineraries: "8",
    language: "de",
  });
  if (t.kind === "custom" && t.arriveBy) params.set("arriveBy", "true");
  if (direction === "later" && app.nextPageCursor) params.set("pageCursor", app.nextPageCursor);
  if (direction === "earlier" && app.prevPageCursor) params.set("pageCursor", app.prevPageCursor);

  try {
    const res = await fetch(`${API}/plan?${params}`);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const fresh = data.itineraries || [];
    const known = new Set(app.itins.map(itKey));
    const add = fresh.filter(it => !known.has(itKey(it)));
    if (direction === "earlier") {
      app.itins = add.concat(app.itins);
      app.prevPageCursor = data.previousPageCursor || null;
    } else if (direction === "later") {
      app.itins = app.itins.concat(add);
      app.nextPageCursor = data.nextPageCursor || null;
    } else {
      app.itins = fresh;
      app.prevPageCursor = data.previousPageCursor || null;
      app.nextPageCursor = data.nextPageCursor || null;
    }
    // „Letzte“: erst die Nacht-Verbindungen VOR dem Morgen dazuladen, dann rendern
    if (!direction && t.kind === "letzte" && app.prevPageCursor) {
      await runPlan("earlier");
      return;
    }
    renderResults();
    // Wenn nach dem Legenden-Filter zu wenig übrig bleibt: automatisch nachladen
    if (visibleItins().length < 5 && app.nextPageCursor && app.autoLoads < 3 && direction !== "earlier") {
      app.autoLoads++;
      await runPlan("later");
    }
  } catch (e) {
    if (!direction) {
      const msg = `<p class="status error">Konnte keine Verbindungen laden (${escapeHtml(e.message)}). Nochmal versuchen?</p>`;
      resultsList.innerHTML = msg;
      byId("timeline").innerHTML = msg;
    }
  }
}

/* --- „Letzte anständige Verbindung“ ---
   1) Nachtflaute erkennen: Median-Takt der Abfahrten; der letzte Abstand
      >= max(90 min, 2,5 × Takt) ist die Betriebspause.
   2) Anständig = kein Stranden: längste Umstiegs-Wartezeit <= 45 min
      (Gesamtdauer ist bewusst KEIN Kriterium – durchfahrende Nachtzüge sind ok).
   Gefiltert wird nichts; die Verbindung wird nur fokussiert. */
function findLastDecent(itins, anchorMs) {
  const list = itins.map(it => {
    const legs = transitLegs(it);
    let maxGap = 0;
    for (let i = 1; i < legs.length; i++) {
      maxGap = Math.max(maxGap, +new Date(legs[i].from.departure) - +new Date(legs[i - 1].to.arrival));
    }
    return { key: itKey(it), dep: +new Date(legs[0].from.departure), maxGap };
  }).sort((a, b) => a.dep - b.dep);
  if (!list.length) return null;
  if (list.length < 3) return list[list.length - 1].key;

  const deltas = list.slice(1).map((c, i) => c.dep - list[i].dep);
  const sorted = [...deltas].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const gapThresh = Math.max(90 * 60000, 2.5 * median);
  let gapIdx = -1;
  deltas.forEach((d, i) => { if (d >= gapThresh) gapIdx = i; });

  // Keine Flaute gefunden (Strecke fährt durch): letzte Verbindung vor dem
  // Morgen-Anker nehmen statt willkürlich der letzten geladenen
  let beforeGap;
  if (gapIdx >= 0) beforeGap = list.slice(0, gapIdx + 1);
  else {
    beforeGap = anchorMs ? list.filter(c => c.dep < anchorMs) : list;
    if (!beforeGap.length) beforeGap = list;
  }
  const DECENT_WAIT = 45 * 60000;
  for (let i = beforeGap.length - 1; i >= 0; i--) {
    if (beforeGap[i].maxGap <= DECENT_WAIT) return beforeGap[i].key;
  }
  return beforeGap[beforeGap.length - 1].key;
}

/* --- Datum/Uhrzeit-Dialog --- */

byId("chip-time").addEventListener("click", () => {
  const d = app.searchTime.kind === "custom" ? new Date(app.searchTime.time) : new Date();
  byId("time-input").value = localMinuteIso(d.toISOString());
  byId("time-dialog").showModal();
});

byId("time-apply").addEventListener("click", () => {
  const v = byId("time-input").value;
  if (!v) return;
  const arriveBy = document.querySelector('input[name="timedir"]:checked').value === "arr";
  byId("time-dialog").close();
  restartWith("custom", new Date(v).toISOString(), arriveBy);
});

/* --- Legende: Kategorien ein-/ausblenden wie bei einer dynamischen Grafik --- */

function visibleItins() {
  return app.itins.filter(it =>
    transitLegs(it).every(l => !app.hiddenCats.has(productClass(l.mode))));
}

function renderLegend() {
  const present = new Set();
  for (const it of app.itins) for (const l of transitLegs(it)) present.add(productClass(l.mode));
  const el = byId("tl-legend");
  el.innerHTML = "";
  for (const c of CATS) {
    if (!present.has(c) && !app.hiddenCats.has(c)) continue;
    if (!present.has(c)) continue; // ausgeblendet UND nicht vorhanden → weglassen
    const b = document.createElement("button");
    b.className = "tl-key" + (app.hiddenCats.has(c) ? " off" : "");
    b.innerHTML = `<i class="seg-${c}"></i>${CAT_LABEL[c]}`;
    b.title = app.hiddenCats.has(c)
      ? `Verbindungen mit ${CAT_LABEL[c]} wieder einblenden`
      : `Verbindungen mit ${CAT_LABEL[c]} ausblenden`;
    b.addEventListener("click", () => {
      if (app.hiddenCats.has(c)) app.hiddenCats.delete(c);
      else app.hiddenCats.add(c);
      renderResults();
    });
    el.appendChild(b);
  }
}

function renderResults() {
  const graph = app.viewMode === "graph";
  byId("timeline-wrap").hidden = !graph;
  resultsList.hidden = graph;
  const toggle = byId("btn-viewmode");
  toggle.textContent = graph ? "☰" : "▦";
  toggle.title = graph ? "Als Liste anzeigen" : "Als Grafik anzeigen";
  renderLegend();
  const visible = visibleItins();
  byId("list-earlier").hidden = graph || !visible.length || !app.prevPageCursor;
  byId("list-later").hidden = graph || !visible.length || !app.nextPageCursor;
  if (!visible.length) {
    const msg = app.itins.length
      ? `<p class="status">Alle geladenen Verbindungen sind über die Legende ausgeblendet – unten wieder einblenden.</p>`
      : `<p class="status">Keine Verbindungen gefunden.</p>`;
    if (graph) byId("timeline").innerHTML = msg; else resultsList.innerHTML = msg;
    return;
  }
  if (graph) {
    const focus = app.searchTime.kind === "letzte" ? (findLastDecent(visible, +nextNightEnd()) || "end") : "start";
    renderTimeline(visible, focus);
  } else {
    resultsList.innerHTML = "";
    renderItineraries(visible);
  }
}

byId("btn-viewmode").addEventListener("click", () => {
  app.viewMode = app.viewMode === "graph" ? "list" : "graph";
  localStorage.setItem("pp.view", app.viewMode);
  renderResults();
});

function openTripDialog(it) {
  const legs = transitLegs(it);
  byId("trip-dialog-title").textContent =
    `${fmtTime(legs[0].from.departure)} – ${fmtTime(legs[legs.length - 1].to.arrival)} · ${Math.round(it.duration / 60)} min`;
  const body = byId("trip-dialog-body");
  body.innerHTML = "";
  fillDetails(body, it);
  byId("trip-dialog").showModal();
}

function transitLegs(it) { return it.legs.filter(l => l.mode !== "WALK"); }

function renderItineraries(itineraries) {
  for (const it of itineraries) {
    const legs = transitLegs(it);
    if (!legs.length) continue; // reine Fußwege ausblenden
    const first = legs[0], last = legs[legs.length - 1];
    const dep = first.from, arr = last.to;
    const cancelled = it.legs.some(legCancelled);
    const delayMin = diffMin(dep.scheduledDeparture, dep.departure);

    const card = document.createElement("article");
    card.className = "trip" + (cancelled ? " cancelled" : "");

    const lines = legs.map(l => l.routeShortName || l.displayName || l.mode).join(" › ");
    const durMin = Math.round(it.duration / 60);
    const trackInfo = dep.track ? `Gl. ${dep.track}` : "";
    const trackChanged = dep.track && dep.scheduledTrack && dep.track !== dep.scheduledTrack;

    const main = document.createElement("button");
    main.className = "trip-main";
    main.innerHTML = `
      <span class="trip-times">${fmtTime(dep.departure)}<br><span class="arr">${fmtTime(arr.arrival)}</span></span>
      <span class="trip-meta">
        <span class="trip-lines">${escapeHtml(lines)}</span>
        <span class="trip-sub">${durMin} min · ${it.transfers} Umst.${trackInfo ? " · " + (trackChanged ? `<span class="track-changed">${trackInfo}</span>` : trackInfo) : ""}</span>
      </span>
      ${cancelled ? `<span class="cancelled-label">Fällt aus</span>` : delayBadge(delayMin)}`;

    const details = document.createElement("div");
    details.className = "trip-details";
    details.hidden = true;
    main.addEventListener("click", () => {
      if (details.hidden && !details.childNodes.length) fillDetails(details, it);
      details.hidden = !details.hidden;
    });

    card.appendChild(main);
    card.appendChild(details);
    resultsList.appendChild(card);
  }
}

function fillDetails(container, it) {
  for (const l of it.legs) {
    if (l.mode === "WALK") {
      const w = document.createElement("p");
      w.className = "walkleg";
      w.textContent = `🚶 ${Math.round(l.duration / 60)} min Fußweg`;
      container.appendChild(w);
      continue;
    }
    const div = document.createElement("div");
    div.className = "leg";
    const depDelay = diffMin(l.from.scheduledDeparture, l.from.departure);
    const arrDelay = diffMin(l.to.scheduledArrival, l.to.arrival);
    const track = l.from.track ? ` · Gl. ${l.from.track}` : "";
    const trackChanged = l.from.track && l.from.scheduledTrack && l.from.track !== l.from.scheduledTrack;
    div.innerHTML = `
      <span class="leg-time">${timeWithDelay(l.from.scheduledDeparture, l.from.departure)}</span>
      <span class="leg-line">${escapeHtml(l.routeShortName || l.displayName || "")} → ${escapeHtml(l.headsign || l.to.name)}${legCancelled(l) ? ` <span class="cancelled-label">Fällt aus</span>` : ""}</span>
      <span class="leg-detail">ab ${escapeHtml(l.from.name)}${trackChanged ? ` · <span class="track-changed">Gl. ${l.from.track} (statt ${l.from.scheduledTrack})</span>` : escapeHtml(track)}</span>
      <span class="leg-time">${timeWithDelay(l.to.scheduledArrival, l.to.arrival)}</span>
      <span class="leg-detail" style="grid-column:2">an ${escapeHtml(l.to.name)}${arrDelay > 0 ? ` (${delayText(arrDelay)})` : ""}</span>`;
    void depDelay;
    container.appendChild(div);
  }
  const legs = transitLegs(it);
  const a = document.createElement("a");
  a.className = "dblink";
  a.target = "_blank";
  a.rel = "noopener";
  a.href = dbLink(
    app.search.from.name, app.search.to.name,
    legs[0].from.scheduledDeparture, legs[legs.length - 1].to.scheduledArrival
  );
  a.textContent = "Bei der DB öffnen (Wagenreihung, Tickets …)";
  container.appendChild(a);
}

/* ---------------- DB-Link ---------------- */

// Lokale Zeit minutengenau: "YYYY-MM-DDTHH:MM"
function localMinuteIso(iso) {
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function dbLink(fromName, toName, depIso, arrIso) {
  const enc = encodeURIComponent;
  const dep = localMinuteIso(depIso);
  if (DB_LINK_PROXY) {
    // Worker löst die exakte Verbindung auf und leitet zum vbid-Link weiter
    return `${DB_LINK_PROXY}?from=${enc(fromName)}&to=${enc(toName)}&dep=${enc(dep)}&arr=${enc(localMinuteIso(arrIso))}`;
  }
  // Fallback: vorbefüllte Suche mit exakter Soll-Abfahrtszeit — die gewünschte
  // Verbindung steht damit ganz oben in der Trefferliste
  return `https://www.bahn.de/buchung/fahrplan/suche#sts=true&so=${enc(fromName)}&zo=${enc(toName)}&soid=${enc("O=" + fromName)}&zoid=${enc("O=" + toName)}&hd=${enc(dep + ":00")}`;
}

/* ---------------- Konfiguration übertragen ---------------- */

byId("btn-share-config").addEventListener("click", () => {
  if (!slots.filter(Boolean).length) { alert("Noch keine Buttons belegt."); return; }
  // v2: Buttons UND Einstellungen wandern gemeinsam im Link
  const payload = { v: 2, slots, show: settings.show, cols: settings.cols };
  const cfg = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  byId("share-url").value = `${location.origin}${location.pathname}#cfg=${cfg}`;
  byId("share-native").hidden = !navigator.share;
  byId("share-copy").textContent = "Link kopieren";
  byId("share-dialog").showModal();
});

byId("share-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(byId("share-url").value);
    byId("share-copy").textContent = "✓ Kopiert!";
    setTimeout(() => { byId("share-copy").textContent = "Link kopieren"; }, 2000);
  } catch {
    byId("share-url").select();
  }
});

byId("share-native").addEventListener("click", () => {
  navigator.share({ title: "PendelPanda-Buttons", url: byId("share-url").value }).catch(() => {});
});

function maybeImportConfig() {
  if (!location.hash.startsWith("#cfg=")) return;
  try {
    const imported = JSON.parse(decodeURIComponent(escape(atob(location.hash.slice(5)))));
    // v1 = nur Button-Array, v2 = {v, slots, show}
    const newSlots = Array.isArray(imported) ? imported : imported.slots;
    if (Array.isArray(newSlots) && confirm("Buttons übernehmen? Die im Link gespeicherte Konfiguration ersetzt deine aktuelle.")) {
      slots = newSlots.slice(0, MAX_SLOTS);
      while (slots.length < MIN_SLOTS) slots.push(null);
      saveSlots();
      if (imported.show) {
        for (const c of CATS) if (typeof imported.show[c] === "boolean") settings.show[c] = imported.show[c];
        const n = Number.isFinite(imported.cols) ? imported.cols : imported.rows;
        if (Number.isFinite(n)) settings.cols = Math.min(5, Math.max(3, Math.round(n)));
        saveSettings();
      }
      alert(`${slots.filter(Boolean).length} Buttons${imported.show ? " samt Einstellungen" : ""} übernommen.`);
    }
  } catch { alert("Der Übertragungslink ist leider ungültig."); }
  history.replaceState(null, "", location.pathname);
}

/* ---------------- Kleinkram ---------------- */

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}
function diffMin(scheduledIso, actualIso) {
  if (!scheduledIso || !actualIso) return 0;
  return Math.round((new Date(actualIso) - new Date(scheduledIso)) / 60000);
}
function delayText(min) { return (min >= 0 ? "+" : "") + min; }
function delayBadge(min) {
  const cls = min <= 0 ? "ok" : min < 6 ? "warn" : "bad";
  return `<span class="delay ${cls}">${delayText(min)}</span>`;
}
function timeWithDelay(scheduledIso, actualIso) {
  const d = diffMin(scheduledIso, actualIso);
  if (d === 0) return fmtTime(actualIso || scheduledIso);
  return `<span class="old-time">${fmtTime(scheduledIso)}</span>${fmtTime(actualIso)}`;
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------------- Start ---------------- */

byId("btn-help").addEventListener("click", () => byId("help-dialog").showModal());

/* --- Einstellungs-Dialog --- */

byId("btn-settings").addEventListener("click", () => {
  document.querySelectorAll("#settings-cats input").forEach(cb => {
    cb.checked = settings.show[cb.dataset.cat];
  });
  byId("set-count").value = slots.length;
  renderColsControl();
  byId("settings-dialog").showModal();
});

let gridSettingsDirty = false;

function renderColsControl() {
  const idx = [3, 4, 5].indexOf(settings.cols);
  byId("set-cols").dataset.idx = idx >= 0 ? idx : 0;
  document.querySelectorAll("#set-cols button").forEach(b =>
    b.classList.toggle("active", Number(b.dataset.cols) === settings.cols));
}

byId("set-cols").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-cols]");
  if (!b) return;
  settings.cols = Number(b.dataset.cols);
  saveSettings();
  gridSettingsDirty = true;
  renderColsControl();
});
byId("settings-dialog").addEventListener("close", () => {
  if (gridSettingsDirty && app.search && app.itins.length) {
    app.searchTag++; // frisches Layout mit neuem Auto-Zoom/Spaltenbreite
    renderResults();
  }
  gridSettingsDirty = false;
});

// Kachel-Anzahl ändern – Verkleinern kann nie belegte Kacheln löschen
byId("set-count").addEventListener("change", () => {
  let n = Math.round(Number(byId("set-count").value)) || slots.length;
  n = Math.max(MIN_SLOTS, Math.min(MAX_SLOTS, n));
  let lastUsed = -1;
  slots.forEach((s, idx) => { if (s) lastUsed = idx; });
  n = Math.max(n, lastUsed + 1);
  while (slots.length < n) slots.push(null);
  slots.length = n;
  byId("set-count").value = n;
  saveSlots();
  renderGrid();
});

byId("settings-cats").addEventListener("change", (e) => {
  const cb = e.target.closest("input[data-cat]");
  if (!cb) return;
  settings.show[cb.dataset.cat] = cb.checked;
  saveSettings();
});

maybeImportConfig();
renderGrid();
showView("grid");

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
