"use strict";

const API = "https://api.transitous.org/api/v1";
const BASE_SLOTS = 14, MAX_SLOTS = 40;
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

const CATS = ["fern", "regio", "sbahn", "utram", "bus", "sonstige", "fernbus"];
const CAT_LABEL = { fern: "Fernzug", regio: "Regionalzug", sbahn: "S-Bahn", utram: "U-Bahn/Tram", bus: "Bus", sonstige: "Sonstige", fernbus: "Fernbus" };

function loadSettings() {
  // Default: Deutschlandticket-Sicht — Fernverkehr aus, Rest an
  const def = {
    // D-Ticket-Sicht: Fernzug UND Fernbus standardmäßig aus
    show: { fern: false, regio: true, sbahn: true, utram: true, bus: true, sonstige: true, fernbus: false },
    cols: 3, // Verbindungen nebeneinander in der Grafik (3/4/5)
  };
  try {
    const s = JSON.parse(localStorage.getItem("pp.settings") || "null");
    if (s && s.show) for (const c of CATS) if (typeof s.show[c] === "boolean") def.show[c] = s.show[c];
    // Altbestand: „Bus & Sonstige“ war eine Kategorie — Wert auf sonstige übernehmen
    if (s && s.show && typeof s.show.sonstige !== "boolean" && typeof s.show.bus === "boolean") {
      def.show.sonstige = s.show.bus;
    }
    const n = s && (Number.isFinite(s.cols) ? s.cols : s.rows); // rows = Altbestand
    if (Number.isFinite(n)) def.cols = Math.min(5, Math.max(3, Math.round(n)));
    if (s && (s.connectMode === "tap" || s.connectMode === "hybrid")) def.connectMode = s.connectMode;
  } catch { /* Default behalten */ }
  if (!def.connectMode) def.connectMode = "hybrid"; // Verbinde-Modus bei >14 Kacheln
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
      while (arr.length < BASE_SLOTS) arr.push(null);
      return arr;
    }
  } catch { /* Default nutzen */ }
  return new Array(BASE_SLOTS).fill(null);
}
function saveSlots() { localStorage.setItem(STORAGE_KEY, JSON.stringify(slots)); }

/* ---------------- Ansichten ---------------- */

const views = { grid: byId("view-grid"), edit: byId("view-edit"), results: byId("view-results") };

function byId(id) { return document.getElementById(id); }

function showView(name) {
  // Bearbeitung beim Verlassen übernehmen (Zurück-Knopf, Android-Geste):
  // eine getroffene Bahnhofswahl darf nicht verloren gehen.
  if (document.body.dataset.view === "edit" && name !== "edit") commitEdit();
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
  document.body.dataset.view = name; // steuert u. a. die Kopfzeile per CSS
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
  // Bei >14 Kacheln muss das Grid scrollbar sein: „Nur Tippen“ deaktiviert das
  // Wisch-Verbinden komplett; „Hybrid“ deaktiviert es, sobald ein Start gewählt
  // ist (dann scrollt Wischen frei zum Ziel). Bearbeiten-Modus bleibt unberührt.
  const scrollGrid = slots.length > BASE_SLOTS;
  const dragOff = !app.editMode && scrollGrid &&
    (settings.connectMode === "tap" || app.selectedStart !== null);
  gridEl.classList.toggle("no-drag", dragOff);
  slots.forEach((slot, i) => {
    const btn = document.createElement("button");
    btn.className = "stationbtn" + (slot ? "" : " empty") + (app.selectedStart === i ? " selected" : "");
    const num = String(i + 1).padStart(2, "0");
    btn.innerHTML = slot
      ? `<span class="tile-bar"></span><span class="tile-num">${num}</span>` +
        (app.selectedStart === i ? `<span class="tile-flag">Start</span>` : "") +
        `<span class="tile-name">${escapeHtml(slot.label || slot.name)}</span>`
      : `<span class="tile-bar"></span><span class="tile-num">${num}</span>` +
        `<span class="tile-plus">+</span><span class="tile-hint">Halt speichern</span>`;
    btn.dataset.slot = i;
    attachStationPointer(btn, i);
    gridEl.appendChild(btn);
  });
}

// Neue Suche vom Startscreen: immer „Jetzt“-Ansicht und Legenden-Filter
// zurück auf die Einstellungen. Innerhalb einer Detailansicht (Zeit ändern,
// Richtung tauschen) bleibt die Filterung dagegen erhalten.
function startFreshSearch(from, to) {
  app.searchTime = { kind: "now", time: null, arriveBy: false };
  app.hiddenCats = defaultHiddenCats();
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
      // Wisch-Verbinden ggf. deaktiviert (Scroll-Modus bei vielen Kacheln)
      if (!app.editMode && gridEl.classList.contains("no-drag")) return;
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
  moveGhost.textContent = slots[i].label || slots[i].name;
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

/* Kachel bearbeiten: nur Beschriftung + Löschen (Station wechseln = löschen
   und neu anlegen). Neuanlage: Bahnhof suchen → Auswahl → optionale
   Beschriftung → Speichern (leer = automatischer Name). */
function openEdit(i) {
  app.editSlot = i;
  app.pendingStation = null;
  const slot = slots[i];
  byId("edit-title").textContent = slot ? "Kachel bearbeiten" : "Station wählen";
  stationInput.hidden = !!slot;
  stationInput.value = "";
  suggestionsEl.innerHTML = "";
  byId("edit-current").hidden = !slot;
  if (slot) byId("edit-current").textContent = slot.name;
  byId("label-row").hidden = !slot;
  byId("labelinput").value = slot ? (slot.label || "") : "";
  byId("btn-save-slot").hidden = !slot;
  clearSlotBtn.hidden = !slot;
  navigate("edit");
  setTimeout(() => (slot ? byId("labelinput") : stationInput).focus(), 60);
}

/* Übernimmt die Bearbeitung. Wird sowohl von „Speichern“ als auch beim
   Verlassen der Ansicht aufgerufen — eine bereits getroffene Bahnhofswahl
   (oder eine getippte Beschriftung) geht so auch über „Zurück“ nicht verloren. */
function commitEdit() {
  const i = app.editSlot;
  if (i === null) return;
  const station = app.pendingStation || slots[i];
  if (!station) return;
  const v = byId("labelinput").value.trim();
  slots[i] = {
    name: station.name, id: station.id,
    ...(Number.isFinite(station.lat) ? { lat: station.lat, lon: station.lon } : {}),
    ...(v && v !== station.name ? { label: v } : {}),
  };
  app.pendingStation = null;
  saveSlots();
}

byId("btn-save-slot").addEventListener("click", () => {
  commitEdit();
  navigate("grid");
});
byId("labelinput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") byId("btn-save-slot").click();
});

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
      // Auswahl gemerkt — gespeichert wird erst mit „Speichern“
      // (lat/lon für die Umkreis-Suche bei Ersatzverkehr, s. planAround)
      app.pendingStation = { name: s.name, id: s.id, lat: s.lat, lon: s.lon };
      stationInput.hidden = true;
      suggestionsEl.innerHTML = "";
      byId("edit-current").hidden = false;
      byId("edit-current").textContent = s.name;
      byId("label-row").hidden = false;
      byId("labelinput").value = "";
      byId("btn-save-slot").hidden = false;
      setTimeout(() => byId("labelinput").focus(), 50);
    });
    suggestionsEl.appendChild(b);
  }
}

clearSlotBtn.addEventListener("click", () => {
  slots[app.editSlot] = null;
  app.pendingStation = null;
  app.editSlot = null; // verhindert, dass das Verlassen die Kachel neu anlegt
  saveSlots();
  navigate("grid");
});

/* ---------------- Verbindungssuche ---------------- */

const resultsList = byId("results-list");

function startSearch(from, to) {
  app.search = { from, to };
  app.itins = [];
  app.autoLoads = 0;
  app.emptyReason = null;
  app.diagnosing = false;
  app.aroundTried = false;
  app.aroundUsed = false;
  app.searchTag = (app.searchTag || 0) + 1;
  byId("results-title").textContent = `${from.label || from.name} → ${to.label || to.name}`;
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

/* Nachladen: ALLE Blätter-Ladevorgänge laufen serialisiert durch diese eine
   Schleuse (app.paging) — parallele Ladevorgänge mit demselben Cursor waren
   eine Dubletten-Quelle. Ein Batch = genau eine API-Anfrage. */
async function loadMoreRaw(direction) {
  if (app.paging || !app.search) return;
  const cursor = direction === "earlier" ? app.prevPageCursor : app.nextPageCursor;
  if (!cursor) return;
  app.paging = true;
  const edge = byId(direction === "earlier" ? "tl-load-left" : "tl-load-right");
  const btn = byId(direction === "earlier" ? "list-earlier" : "list-later");
  // Spinner nur zeigen, wenn man wirklich AM Rand steht (Fallback bei sehr
  // schnellem Wischen) — Prefetch im Hintergrund bleibt unsichtbar
  const sc = byId("timeline");
  const step = (tl.colW || 100) + TL.GAP;
  const atEdge = app.viewMode !== "graph" ? false
    : direction === "earlier"
      ? sc.scrollLeft < step * 0.5
      : (sc.scrollWidth - sc.clientWidth - sc.scrollLeft) < step * 0.5;
  if (atEdge) edge.hidden = false;
  btn.disabled = true;
  try { await runPlan(direction); }
  finally {
    app.paging = false;
    edge.hidden = true;
    btn.disabled = false;
  }
  maybeAutoFill(); // ggf. weiter auffüllen — durch die Schleuse, nie parallel
}

async function loadMore(direction) {
  app.autoLoads = 0; // manuelle Aktion gibt dem Auto-Nachladen frisches Budget
  return loadMoreRaw(direction);
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
  // fahrplanbasiert statt Trip-IDs — stabil über verschiedene Antworten hinweg
  return legs.map(l =>
    `${l.routeShortName || l.mode}@${l.from.scheduledDeparture}@${l.to.scheduledArrival}`
  ).join("|") || it.startTime;
}

const depOf = x => { const tls = transitLegs(x); return tls.length ? +new Date(tls[0].from.departure) : Infinity; };

/* Eine Seite beschaffen und in den Pool mischen — OHNE zu rendern.
   Trennung von Beschaffung und Darstellung: So kann eine Suche mehrere Seiten
   nachladen (Bootstrap, „Letzte“) und trotzdem nur EINMAL rendern. Jedes
   Zwischenrendern hat die Grafik neu positioniert — daher das Springen. */
async function fetchPage(direction, limit = 10) {
  const { from, to } = app.search;
  const t = app.searchTime;
  const baseTime = t.kind === "custom" ? new Date(t.time)
    : t.kind === "letzte" ? nextNightEnd()
    : new Date();
  const params = new URLSearchParams({
    fromPlace: from.id,
    toPlace: to.id,
    time: baseTime.toISOString(),
    numItineraries: String(limit),
    language: "de",
    withScheduledSkippedStops: "true", // auch übersprungene Halte mitnehmen
  });
  if (t.kind === "custom" && t.arriveBy) params.set("arriveBy", "true");
  if (direction === "later" && app.nextPageCursor) params.set("pageCursor", app.nextPageCursor);
  if (direction === "earlier" && app.prevPageCursor) params.set("pageCursor", app.prevPageCursor);

  /* Zwei Anfragen pro Ladevorgang, wenn gefiltert wird (sonst eine):
     - ungefiltert → speist die Legende („was gäbe es?“) und den Pool
     - gefiltert   → die unter der Filterung optimalen Verbindungen, die die
       ungefilterte Suche wegen Pareto-Optimierung verschweigt
     Beide werden in EINEM Dedupe-Durchgang gemischt; Cursor kommen immer aus
     der ungefilterten Antwort (Zeitstempel, filter-agnostisch). */
  const modes = enabledModes();
  const filtered = modes
    ? fetch(`${API}/plan?${new URLSearchParams(params)}&transitModes=${encodeURIComponent(modes)}`)
        .then(r => (r.ok ? r.json() : null)).catch(() => null)
    : null;

  {
    const res = await fetch(`${API}/plan?${params}`);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const filteredData = filtered ? await filtered : null;
    // Dubletten gegen den Pool UND innerhalb des Batches aussieben
    const known = new Set(app.itins.map(itKey));
    const add = [];
    for (const it of (data.itineraries || []).concat(filteredData?.itineraries || [])) {
      const k = itKey(it);
      if (known.has(k)) continue;
      known.add(k);
      add.push(it);
    }
    if (direction === "earlier") {
      app.itins = add.concat(app.itins);
      app.prevPageCursor = data.previousPageCursor || null;
    } else if (direction === "later") {
      app.itins = app.itins.concat(add);
      app.nextPageCursor = data.nextPageCursor || null;
    } else {
      app.itins = add;
      app.prevPageCursor = data.previousPageCursor || null;
      app.nextPageCursor = data.nextPageCursor || null;
    }
    // Spalten immer chronologisch nach Abfahrt (API-Reihenfolge ist teils
    // ein Qualitäts-Ranking und würde die Kaskade der Grafik brechen)
    app.itins.sort((a, b) => depOf(a) - depOf(b));
    return { added: add.length, params };
  }
}

/* Orchestrierung: beschafft (ggf. mehrere Seiten) und rendert GENAU EINMAL. */
async function runPlan(direction = null, limit = 10) {
  if (!direction) {
    const loading = `<p class="status">Suche Verbindungen …</p>`;
    resultsList.innerHTML = loading;
    byId("timeline").innerHTML = loading;
  }
  try {
    const { params } = await fetchPage(direction, limit);
    if (!direction) {
      const t = app.searchTime;
      if (t.kind === "letzte") {
        await loadBackToNightGap();
      } else if (t.kind === "now" && app.itins.length && app.prevPageCursor) {
        // zwei gerade verpasste Verbindungen als Kontext links
        await fetchPage("earlier", 2);
      }
      // Nichts gefunden? Ersatzverkehr fährt oft ab einem Nachbarhalt →
      // einmalig mit Koordinaten und großzügigem Fußweg nachfassen.
      if (!app.itins.length && !app.aroundTried) {
        app.aroundTried = true;
        const around = await planAround(params);
        const fresh2 = (around?.itineraries || []).filter(it => transitLegs(it).length);
        if (fresh2.length) {
          const seen = new Set();
          app.itins = fresh2.filter(it => !seen.has(itKey(it)) && seen.add(itKey(it)))
            .sort((a, b) => depOf(a) - depOf(b));
          app.aroundUsed = true;
          app.prevPageCursor = around.previousPageCursor || null;
          app.nextPageCursor = around.nextPageCursor || null;
        }
      }
    }
    renderResults();
    if (!direction) maybeAutoFill();
  } catch (e) {
    if (!direction) {
      const msg = `<p class="status error">Konnte keine Verbindungen laden (${escapeHtml(e.message)}). Nochmal versuchen?</p>`;
      resultsList.innerHTML = msg;
      byId("timeline").innerHTML = msg;
    }
  }
}

/* „Letzte“: so weit rückwärts laden, bis die Betriebspause der Nacht wirklich
   im geladenen Fenster liegt. Vorher war es genau EINE Seite — reichte die
   nicht bis zur Lücke, landete der Fokus irgendwo am Nachmittag. */
async function loadBackToNightGap() {
  const coverUntil = +nextNightEnd() - 7 * 3600e3; // bis ~20:30 des Vorabends
  for (let i = 0; i < 3; i++) {
    const list = gapList(app.itins);
    if (nightGapIndex(list) >= 0) return;                 // Flaute gefunden
    if (list.length && list[0].dep <= coverUntil) return; // Abend abgedeckt
    // Deckt der Pool schon ≥4 h ohne Pause ab, fährt die Strecke durch —
    // weiteres Rückwärtsladen wäre reine Wartezeit
    if (list.length > 2 && list[list.length - 1].dep - list[0].dep >= 4 * 3600e3) return;
    if (!app.prevPageCursor) return;
    const { added } = await fetchPage("earlier", 10);
    if (!added) return; // nichts Neues mehr — Abbruch statt Endlosschleife
  }
}

/* Umkreis-Suche als Rückfallebene — der Fall „Schienenersatzverkehr“:
   Ist eine Strecke gesperrt, hat der Bahnhof selbst keine Fahrten mehr; der
   Ersatzverkehr fährt ab einem NEBENAN liegenden Halt (Ersatzhaltestelle,
   Rathaus, Busbahnhof). Eine Suche Haltestelle→Haltestelle findet das nie.
   Deshalb: bei leerem Ergebnis mit Koordinaten statt Stop-IDs erneut suchen
   und großzügige Fußwege erlauben — dann tauchen Ersatzhalte auf.
   Gilt genauso für kurzfristige Verlegungen und getrennte Bus-/Bahn-Halte. */
const geoCache = new Map();

async function coordsOf(stop) {
  if (Number.isFinite(stop.lat) && Number.isFinite(stop.lon)) return `${stop.lat},${stop.lon}`;
  if (geoCache.has(stop.id)) return geoCache.get(stop.id);
  try {
    const res = await fetch(`${API}/geocode?text=${encodeURIComponent(stop.name)}&language=de`);
    if (!res.ok) return null;
    const list = await res.json();
    const hit = list.find(x => x.type === "STOP" && x.id === stop.id)
      || list.find(x => x.type === "STOP" && x.name === stop.name);
    const val = hit && Number.isFinite(hit.lat) ? `${hit.lat},${hit.lon}` : null;
    geoCache.set(stop.id, val);
    if (val) { stop.lat = hit.lat; stop.lon = hit.lon; saveSlots(); } // einmalig nachrüsten
    return val;
  } catch { return null; }
}

async function planAround(baseParams) {
  const { from, to } = app.search;
  const [a, b] = await Promise.all([coordsOf(from), coordsOf(to)]);
  if (!a || !b) return null;
  const p = new URLSearchParams(baseParams);
  p.set("fromPlace", a);
  p.set("toPlace", b);
  // großzügige Fußwege an beiden Enden, damit Ersatzhalte in Reichweite sind
  p.set("maxPreTransitTime", "1800");
  p.set("maxPostTransitTime", "1800");
  try {
    const res = await fetch(`${API}/plan?${p}`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/* Leeres Ergebnis erklären statt schweigen: Für beide Halte prüfen, ob dort
   überhaupt etwas fährt. Deckt Datenlücken (Fahrplan beginnt erst später),
   stillgelegte/saisonale Halte und echte „keine Verbindung“-Fälle ab. */
async function nextDeparture(stopId) {
  try {
    const res = await fetch(`${API}/stoptimes?stopId=${encodeURIComponent(stopId)}&n=1`);
    if (!res.ok) return null;
    const d = await res.json();
    const s = (d.stopTimes || [])[0];
    return s ? new Date(s.place.departure || s.place.scheduledDeparture) : null;
  } catch { return null; }
}

async function diagnoseEmpty() {
  app.diagnosing = true;
  const myTag = app.searchTag;
  const { from, to } = app.search;
  const [a, b] = await Promise.all([nextDeparture(from.id), nextDeparture(to.id)]);
  app.diagnosing = false;
  if (myTag !== app.searchTag || app.itins.length) return;
  const parts = [];
  const soon = Date.now() + 36 * 3600e3;
  for (const [stop, next] of [[from, a], [to, b]]) {
    const nm = escapeHtml(stop.label || stop.name);
    if (!next) parts.push(`Für <strong>${nm}</strong> liegen keine Fahrplandaten vor.`);
    else if (+next > soon) {
      parts.push(`Für <strong>${nm}</strong> beginnt der hinterlegte Fahrplan erst am ` +
        `<strong>${next.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })}</strong>.`);
    }
  }
  app.emptyReason = parts.length
    ? parts.join(" ") + " Deshalb findet die Suche hier nichts – das ist eine Lücke in den offenen Fahrplandaten, keine fehlende Verbindung."
    : "Keine Verbindungen im gewählten Zeitraum – auch nicht über Halte in der Nähe. Über 📅 einen anderen Zeitpunkt wählen oder in der Legende weitere Verkehrsmittel einblenden.";
  renderResults();
}

/* --- „Letzte anständige Verbindung“ ---
   1) Nachtflaute erkennen: Median-Takt der Abfahrten; der letzte Abstand
      >= max(90 min, 2,5 × Takt) ist die Betriebspause.
   2) Anständig = kein Stranden: längste Umstiegs-Wartezeit <= 45 min
      (Gesamtdauer ist bewusst KEIN Kriterium – durchfahrende Nachtzüge sind ok).
   Gefiltert wird nichts; die Verbindung wird nur fokussiert. */
// Verbindungen als sortierte Kennzahlen-Liste (Abfahrt + längste Umstiegswartezeit)
function gapList(itins) {
  return itins.map(it => {
    const legs = transitLegs(it);
    if (!legs.length) return null;
    let maxGap = 0;
    for (let i = 1; i < legs.length; i++) {
      maxGap = Math.max(maxGap, +new Date(legs[i].from.departure) - +new Date(legs[i - 1].to.arrival));
    }
    return { key: itKey(it), dep: +new Date(legs[0].from.departure), maxGap };
  }).filter(Boolean).sort((a, b) => a.dep - b.dep);
}

// Index der letzten Betriebspause („Nachtflaute“) in der Liste, sonst -1
function nightGapIndex(list) {
  if (list.length < 3) return -1;
  const deltas = list.slice(1).map((c, i) => c.dep - list[i].dep);
  const sorted = [...deltas].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const gapThresh = Math.max(90 * 60000, 2.5 * median);
  let gapIdx = -1;
  deltas.forEach((d, i) => { if (d >= gapThresh) gapIdx = i; });
  return gapIdx;
}

function findLastDecent(itins, anchorMs) {
  const list = gapList(itins);
  if (!list.length) return null;
  if (list.length < 3) return list[list.length - 1].key;
  const gapIdx = nightGapIndex(list);

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

// So viele Verbindungen sollten nach dem Filtern mindestens da sein:
// Spaltenzahl + 2, damit die Grafik überläuft und seitwärts scrollbar
// bleibt (sonst kann das Rand-Nachladen nie greifen); Liste: sechs
function neededVisible() {
  return app.viewMode === "graph" ? Math.min(5, Math.max(3, settings.cols || 3)) + 2 : 6;
}

// transitModes-Gruppen je Kategorie (für gezielt gefilterte Zusatzanfragen)
const CAT_MODES = {
  fern: "HIGHSPEED_RAIL,LONG_DISTANCE,NIGHT_RAIL",
  // Achtung: RAIL ist serverseitig die Oberklasse ALLER Züge (inkl. ICE)
  // und darf hier nicht auftauchen, sonst kippt der Filter
  regio: "REGIONAL_RAIL,REGIONAL_FAST_RAIL",
  sbahn: "SUBURBAN,METRO",
  utram: "SUBWAY,TRAM",
  bus: "BUS",
  sonstige: "FERRY,ODM",
  fernbus: "COACH",
};

/* transitModes der aktiven Kategorien (null = alle aktiv).
   WICHTIG: Der Router liefert Pareto-optimale Ergebnisse. Eine rein
   ungefilterte Anfrage verschweigt daher Verbindungen, die nur unter der
   Filterung optimal sind (eine Regio-Kette ist langsamer UND umstiegsreicher
   als der ICE → wird weggeschnitten). Deshalb braucht es bei aktiver
   Filterung zusätzlich eine gefilterte Anfrage. */
function enabledModes() {
  const enabled = CATS.filter(c => !app.hiddenCats.has(c));
  if (enabled.length === CATS.length) return null;
  return enabled.map(c => CAT_MODES[c]).join(",");
}

// Reicht es nach dem Filtern noch nicht für die Spaltenzahl,
// weitere Cursor-Seiten nachlegen (serialisiert, gefiltert gezählt)
async function ensureFilled() {
  if (app.paging) return;
  if (visibleItins().length >= neededVisible()) return;
  if (app.nextPageCursor && app.autoLoads < 4) {
    app.autoLoads++;
    await loadMoreRaw("later"); // kettet sich über die Schleuse selbst weiter
  }
}

function maybeAutoFill() {
  if (!app.paging) ensureFilled();
}


/* Feste Legende: alle Kategorien immer sichtbar, in fester Reihenfolge.
   Drei Zustände je Chip:
   - on:     farbiger Punkt, normaler Text  → Daten da, eingeblendet
   - off:    hohler Punkt,   normaler Text  → Daten da, ausgeblendet (antippen!)
   - nodata: alles ausgegraut + durchgestrichen → keine solchen Verbindungen */
function renderLegend() {
  const el = byId("tl-legend");
  if (!el.dataset.built) {
    el.innerHTML = CATS.map(c =>
      `<button class="tl-key" data-cat="${c}"><i class="dot seg-${c}"></i>${CAT_LABEL[c]}</button>`).join("");
    el.dataset.built = "1";
    el.addEventListener("click", (e) => {
      const b = e.target.closest(".tl-key");
      if (!b || b.classList.contains("nodata")) return;
      const c = b.dataset.cat;
      if (app.hiddenCats.has(c)) app.hiddenCats.delete(c);
      else app.hiddenCats.add(c);
      app.autoLoads = 0;
      renderResults();
      maybeAutoFill();
    });
  }
  const present = new Set();
  for (const it of app.itins) for (const l of transitLegs(it)) present.add(productClass(l.mode));
  el.querySelectorAll(".tl-key").forEach(b => {
    const c = b.dataset.cat;
    const has = present.has(c);
    b.classList.toggle("nodata", !has);
    b.classList.toggle("off", has && app.hiddenCats.has(c));
    b.classList.toggle("on", has && !app.hiddenCats.has(c));
    b.title = !has ? `Keine ${CAT_LABEL[c]}-Verbindungen im Zeitraum`
      : app.hiddenCats.has(c) ? `${CAT_LABEL[c]} einblenden` : `${CAT_LABEL[c]} ausblenden`;
  });
}

function renderResults() {
  const graph = app.viewMode === "graph";
  byId("timeline-wrap").hidden = !graph;
  resultsList.hidden = graph;
  const toggle = byId("btn-viewmode");
  toggle.textContent = graph ? "☰" : "▦";
  toggle.title = graph ? "Als Liste anzeigen" : "Als Grafik anzeigen";
  renderLegend();
  // Hinweis, wenn nur die Umkreis-Suche etwas fand (Ersatzverkehr o. Ä.)
  byId("around-note").hidden = !app.aroundUsed;
  const visible = visibleItins();
  // Warum ist nichts da? Einmal pro Suche klären (Guard gegen Re-Entry).
  if (!app.itins.length && app.search && !app.emptyReason && !app.diagnosing) diagnoseEmpty();
  byId("list-earlier").hidden = graph || !visible.length || !app.prevPageCursor;
  byId("list-later").hidden = graph || !visible.length || !app.nextPageCursor;
  if (!visible.length) {
    const msg = app.itins.length
      ? `<p class="status">Alle geladenen Verbindungen sind über die Legende ausgeblendet – unten wieder einblenden.</p>`
      : `<p class="status">${app.emptyReason || "Keine Verbindungen gefunden."}</p>`;
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
    `${fmtTime(legs[0].from.departure)} – ${fmtTime(legs[legs.length - 1].to.arrival)} · ${fmtDur(it.duration)}`;
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
    const cancelled = cancelledTransitLegs(it).size > 0;
    const delayMin = diffMin(dep.scheduledDeparture, dep.departure);

    const card = document.createElement("article");
    card.className = "trip" + (cancelled ? " cancelled" : "");

    const lines = legs.map(l => lineParts(l).main || l.mode).join(" › ");
    const dur = fmtDur(it.duration);
    const trackInfo = dep.track ? `Gl. ${dep.track}` : "";
    const trackChanged = dep.track && dep.scheduledTrack && dep.track !== dep.scheduledTrack;

    const main = document.createElement("button");
    main.className = "trip-main";
    main.innerHTML = `
      <span class="trip-times">${fmtTime(dep.departure)}<br><span class="arr">${fmtTime(arr.arrival)}</span></span>
      <span class="trip-meta">
        <span class="trip-lines">${escapeHtml(lines)}</span>
        <span class="trip-sub">${dur} · ${it.transfers} Umst.${trackInfo ? " · " + (trackChanged ? `<span class="track-changed">${trackInfo}</span>` : trackInfo) : ""}${!cancelled && transferWarning(it) ? ` · <span class="warn-tri">⚠</span>` : ""}</span>
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
  const flagged = cancelledTransitLegs(it);
  for (const l of it.legs) {
    if (l.mode === "WALK") {
      if (legCancelled(l)) {
        // Meldung als aufklappbares Element mit allem, was die Daten hergeben
        const det = document.createElement("details");
        det.className = "walkmeld";
        const stops = [l.from, l.to].filter(s => s && s.cancelled);
        det.innerHTML =
          `<summary>🚶 ${fmtDur(l.duration)} Fußweg · <span class="warn-tri">⚠</span> Meldung am Umstieg</summary>` +
          stops.map(s =>
            `<p>Halt „${escapeHtml(s.name)}“${s.description ? ` (${escapeHtml(s.description)})` : ""}: laut Echtzeitdaten als entfallen markiert.</p>`).join("") +
          `<p class="finequote">Die Datenquelle liefert dazu keinen Meldungstext. Häufig steckt eine Haltestellen- oder Steigänderung dahinter – der Anschluss fährt meist trotzdem. Vor Ort prüfen.</p>`;
        container.appendChild(det);
      } else {
        // Fußwege benennen — bei Ersatzverkehr ist das der Weg zur Ersatzhaltestelle
        const endName = p => p.name === "START" ? (app.search.from.label || app.search.from.name)
          : p.name === "END" ? (app.search.to.label || app.search.to.name) : p.name;
        const a = endName(l.from), b = endName(l.to);
        const w = document.createElement("p");
        w.className = "walkleg";
        w.innerHTML = `🚶 ${fmtDur(l.duration)} Fußweg` +
          (a && b && a !== b ? `: ${escapeHtml(a)} → ${escapeHtml(b)} ${mapsPin(l.to, "Ziel des Fußwegs in Google Maps öffnen")}` : "");
        container.appendChild(w);
      }
      continue;
    }
    const lp = lineParts(l);
    const stops = l.intermediateStops || [];
    const trackChanged = l.from.track && l.from.scheduledTrack && l.from.track !== l.from.scheduledTrack;
    const trackPart = l.from.track
      ? (trackChanged
        ? ` · <span class="track-changed">Gl. ${escapeHtml(String(l.from.track))} (statt ${escapeHtml(String(l.from.scheduledTrack))})</span>`
        : ` · Gl. ${escapeHtml(String(l.from.track))}`)
      : "";
    const facts = [];
    if (l.wheelchairAccessible === true || l.wheelchairAccessible === "WHEELCHAIR_ACCESSIBLE") facts.push("♿ barrierefrei");
    if (l.bikesAllowed === true || l.bikesAllowed === "BIKES_ALLOWED") facts.push("🚲 Fahrradmitnahme");

    const stopRow = s => {
      const t = s.arrival || s.departure, ts = s.scheduledArrival || s.scheduledDeparture;
      return `<li class="leg-row" data-ts="${+new Date(t || ts)}">` +
        `<span class="leg-dot mini"></span><span class="leg-time">${timeWithDelay(ts, t)}</span>` +
        `<span class="leg-text${s.cancelled ? " stop-cancelled" : ""}">${escapeHtml(s.name)}` +
        `${s.track ? ` · Gl. ${escapeHtml(String(s.track))}` : ""}${s.cancelled ? " · entfällt" : ""}</span></li>`;
    };
    const infoBlock = (stops.length || facts.length) ? `
      <details class="leginfo">
        <summary>${stops.length ? `${stops.length} Zwischenhalt${stops.length === 1 ? "" : "e"} & Infos` : "Infos zur Fahrt"}</summary>
        ${stops.length ? `<ul class="stoplist">${stops.map(stopRow).join("")}</ul>` : ""}
        ${facts.length ? `<p class="leg-facts">${facts.join(" · ")}</p>` : ""}
      </details>` : "";

    const wrap = document.createElement("div");
    wrap.className = "leg2";
    const sev = !flagged.has(l) && isReplacementService(l);
    wrap.innerHTML = `
      <div class="leg-head"><span class="linechip seg-${productClass(l.mode)}${sev ? " chip-sev" : ""}">${escapeHtml(lp.main)}</span>${lp.extra ? ` <span class="linextra">(${escapeHtml(lp.extra)})</span>` : ""} → ${escapeHtml(l.headsign || l.to.name)}${flagged.has(l) ? ` <span class="cancelled-label">Fällt aus</span>` : ""}${sev ? ` <span class="sev-badge">Ersatzverkehr</span>` : ""}</div>
      ${sev ? `<p class="sev-hint">Fährt als Bus ab einer Ersatzhaltestelle – Abfahrtsort unten prüfen.</p>` : ""}
      <div class="leg-body">
        <div class="leg-track"></div>
        <div class="leg-progress" hidden></div>
        <div class="leg-row" data-ts="${+new Date(l.from.departure)}">
          <span class="leg-dot"></span><span class="leg-time">${timeWithDelay(l.from.scheduledDeparture, l.from.departure)}</span>
          <span class="leg-text">ab ${escapeHtml(l.from.name)}${trackPart} ${mapsPin(l.from, "Abfahrtsort in Google Maps öffnen")}</span>
        </div>
        ${infoBlock}
        <div class="leg-row" data-ts="${+new Date(l.to.arrival)}">
          <span class="leg-dot"></span><span class="leg-time">${timeWithDelay(l.to.scheduledArrival, l.to.arrival)}</span>
          <span class="leg-text">an ${escapeHtml(l.to.name)} ${mapsPin(l.to, "Ankunftsort in Google Maps öffnen")}</span>
        </div>
      </div>`;
    const det = wrap.querySelector("details.leginfo");
    const relayout = () => updateLegLine(wrap, l, det);
    if (det) det.addEventListener("toggle", relayout);
    requestAnimationFrame(relayout);
    container.appendChild(wrap);
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

/* Linien-Geometrie eines Abschnitts: die vertikale Linie verbindet Abfahrts-
   und Ankunftszeit (bzw. alle Zwischenhalte, wenn aufgeklappt). Läuft die
   Fahrt gerade UND ist aufgeklappt, zeigt eine gefüllte Teil-Linie mit
   Positionspunkt, wo der Zug ist; vergangene Halte werden gedimmt. */
function updateLegLine(wrap, l, det) {
  const body = wrap.querySelector(".leg-body");
  if (!body) return;
  const open = !!(det && det.open);
  const rows = [...body.querySelectorAll(".leg-row")].filter(r => open || !r.closest("details"));
  if (rows.length < 2) return;
  const center = r => r.offsetTop + r.offsetHeight / 2;
  const y0 = center(rows[0]), y1 = center(rows[rows.length - 1]);
  const track = body.querySelector(".leg-track");
  track.style.top = y0 + "px";
  track.style.height = Math.max(0, y1 - y0) + "px";

  const prog = body.querySelector(".leg-progress");
  const now = Date.now();
  const dep = +new Date(l.from.departure), arr = +new Date(l.to.arrival);
  rows.forEach(r => r.classList.toggle("passed", open && now > Number(r.dataset.ts)));
  if (!open || now < dep || now > arr) { prog.hidden = true; return; }
  let y = y0;
  for (let i = 0; i < rows.length - 1; i++) {
    const t0 = Number(rows[i].dataset.ts), t1 = Number(rows[i + 1].dataset.ts);
    if (now > t1) { y = center(rows[i + 1]); continue; }
    if (now >= t0) {
      y = center(rows[i]) + (t1 > t0 ? (now - t0) / (t1 - t0) : 0) * (center(rows[i + 1]) - center(rows[i]));
    }
    break;
  }
  prog.style.top = y0 + "px";
  prog.style.height = Math.max(0, y - y0) + "px";
  prog.hidden = false;
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
  const payload = { v: 2, slots, show: settings.show, cols: settings.cols, connect: settings.connectMode };
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
      while (slots.length < BASE_SLOTS) slots.push(null);
      saveSlots();
      if (imported.show) {
        for (const c of CATS) if (typeof imported.show[c] === "boolean") settings.show[c] = imported.show[c];
        const n = Number.isFinite(imported.cols) ? imported.cols : imported.rows;
        if (Number.isFinite(n)) settings.cols = Math.min(5, Math.max(3, Math.round(n)));
        if (imported.connect === "tap" || imported.connect === "hybrid") settings.connectMode = imported.connect;
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
// Fahrdauer kompakt: unter einer Stunde „42 min“, sonst „1:40 h“
function fmtDur(seconds) {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} h`;
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
  const cls = d <= 0 ? "ok" : d < 6 ? "warn" : "bad";
  return `<span class="old-time">${fmtTime(scheduledIso)}</span><span class="t-real ${cls}">${fmtTime(actualIso)}</span>`;
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
  refreshTileOpts();
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

/* Kachel-Anzahl: Standard sind 14 (7×2, passt ohne Scrollen). „Mehr als 14“
   schaltet frei — dann gerade Anzahl bis 40 plus Wahl des Verbinde-Modus.
   Verkleinern kann nie belegte Kacheln löschen. */
function lastUsedIndex() {
  let last = -1;
  slots.forEach((s, i) => { if (s) last = i; });
  return last;
}

function setSlotCount(n) {
  n = Math.max(BASE_SLOTS, Math.min(MAX_SLOTS, Math.round(n)));
  n = Math.max(n, lastUsedIndex() + 1);
  if (n > BASE_SLOTS && n % 2) n += 1; // gerade halten
  while (slots.length < n) slots.push(null);
  slots.length = n;
  saveSlots();
  renderGrid();
}

function refreshTileOpts() {
  const more = slots.length > BASE_SLOTS;
  byId("set-more").checked = more;
  byId("more-tiles-opts").hidden = !more;
  byId("set-count").value = Math.max(16, slots.length);
  const mode = settings.connectMode === "tap" ? "tap" : "hybrid";
  byId("set-connect").dataset.idx = mode === "tap" ? 1 : 0;
  byId("set-connect").querySelectorAll("button").forEach(b =>
    b.classList.toggle("active", b.dataset.mode === mode));
}

byId("set-more").addEventListener("change", () => {
  if (byId("set-more").checked) {
    setSlotCount(16);
  } else {
    if (lastUsedIndex() >= BASE_SLOTS) {
      alert("Es sind Kacheln jenseits von Nr. 14 belegt – bitte erst leeren oder verschieben.");
      byId("set-more").checked = true;
      return;
    }
    setSlotCount(BASE_SLOTS);
  }
  refreshTileOpts();
});

byId("set-count").addEventListener("change", () => {
  setSlotCount(Number(byId("set-count").value) || 16);
  refreshTileOpts();
});

byId("set-connect").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-mode]");
  if (!b) return;
  settings.connectMode = b.dataset.mode;
  saveSettings();
  refreshTileOpts();
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
