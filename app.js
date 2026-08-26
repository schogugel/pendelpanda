"use strict";

/* App-Version — einzige Quelle der Wahrheit.
   Bei JEDER Änderung erhöhen (PATCH = Fix/Detail, MINOR = neue Funktion,
   MAJOR = grundlegender Umbau) und `CACHE` in sw.js gleichlautend mitziehen. */
const APP_VERSION = "1.19.0";

const API = "https://api.transitous.org/api/v1";
const BASE_SLOTS = 14, MAX_SLOTS = 40;
// Optional: URL des deployten db-link-workers (siehe README, Ordner db-link-worker/).
// Wenn gesetzt, öffnet „Bei der DB öffnen“ exakt die gewählte Verbindung (vbid-Link,
// öffnet auf dem Handy den DB Navigator mit „Zu meinen Reisen hinzufügen“).
// Leer = Fallback auf die vorbefüllte bahn.de-Suche.
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
  emptyCats: new Set(),   // Kategorien, für die eine eigene Anfrage nichts brachte
  refilling: false,       // Nachladen läuft — Legende solange gesperrt
  autoLoads: 0,           // automatische Nachlade-Runden pro Suche
};

/* ---------------- Einstellungen (Standard-Verkehrsmittel) ---------------- */

const CATS = ["fern", "regio", "sbahn", "ubahn", "tram", "bus", "sonstige", "fernbus"];
/* Stufen für die Umsteigezeit. `factor` skaliert die vom Router berechnete
   nötige Zeit (wächst also mit der Größe des Bahnhofs), `extra` legt einen
   kleinen festen Sockel darunter. An vier Strecken gemessen wächst der
   kürzeste Umstieg damit von 2–4 min über 6–18 und 11–18 auf 18–22 min,
   ohne dass Verbindungen wegfallen — es werden andere gefunden. */
const XFER_LEVELS = [
  { label: "Normal", factor: 1, extra: 0 },
  { label: "Etwas mehr", factor: 1.5, extra: 3 },
  { label: "Deutlich mehr", factor: 2, extra: 7 },
  { label: "Viel mehr", factor: 3, extra: 12 },
];

const CAT_LABEL = { fern: "Fernzug", regio: "Regionalzug", sbahn: "S-Bahn", ubahn: "U-Bahn",
                    tram: "Tram", bus: "Bus", sonstige: "Sonstige", fernbus: "Fernbus" };

function loadSettings() {
  // Default: Deutschlandticket-Sicht — Fernverkehr aus, Rest an
  const def = {
    // D-Ticket-Sicht: Fernzug UND Fernbus standardmäßig aus
    show: { fern: false, regio: true, sbahn: true, ubahn: true, tram: true,
            bus: true, sonstige: true, fernbus: false },
    cols: 3,      // Verbindungen nebeneinander in der Grafik (3–7)
    fill: 70,     // % der Bildhöhe, die die vorderste Verbindung einnimmt
    /* „Letzte“: Bis wann will ich ankommen, und wie lange darf ich NACHTS an
       einem einzelnen Umstieg warten? Die Wartegrenze galt früher rund um die
       Uhr — eine Stunde Aufenthalt um 15 Uhr ist aber harmlos, um 3 Uhr nicht. */
    lastArrival: "04:00",
    nightFrom: "22:00",
    nightTo: "06:00",
    nightWait: 45,   // Minuten am Stück, nicht über die Umstiege summiert
    /* Zeit zum Umsteigen als STUFE, nicht als feste Minutenzahl. Ein fixer
       Aufschlag ist das falsche Maß: Er verhält sich an einem kleinen Halt
       gleich wie an einem Kopfbahnhof, obwohl der Weg dort ein Vielfaches
       beträgt. MOTIS kann anteilig rechnen (`transferTimeFactor` skaliert die
       nötige Umsteigezeit), und genau das ist der Hauptregler.
       Ein kleiner fester Anteil bleibt trotzdem dabei — gemessen: Wo die
       Grundzeit nur 2 min beträgt, macht selbst Faktor 3 daraus erst 6 min,
       was mit Gepäck nicht reicht. Faktor allein wäre also genauso einseitig
       wie der Aufschlag allein. */
    xferLevel: 0,    // 0 normal · 1 etwas · 2 deutlich · 3 viel mehr Zeit
  };
  try {
    const s = JSON.parse(localStorage.getItem("pp.settings") || "null");
    if (s && s.show) for (const c of CATS) if (typeof s.show[c] === "boolean") def.show[c] = s.show[c];
    // Altbestand: „Bus & Sonstige“ war eine Kategorie — Wert auf sonstige übernehmen
    if (s && s.show && typeof s.show.sonstige !== "boolean" && typeof s.show.bus === "boolean") {
      def.show.sonstige = s.show.bus;
    }
    // Altbestand: „U-Bahn/Tram“ war EINE Kategorie — der Wert gilt für beide
    if (s && s.show && typeof s.show.utram === "boolean") {
      if (typeof s.show.ubahn !== "boolean") def.show.ubahn = s.show.utram;
      if (typeof s.show.tram !== "boolean") def.show.tram = s.show.utram;
    }
    const n = s && (Number.isFinite(s.cols) ? s.cols : s.rows); // rows = Altbestand
    if (Number.isFinite(n)) def.cols = Math.min(7, Math.max(3, Math.round(n)));
    if (Number.isFinite(s?.fill)) def.fill = Math.min(90, Math.max(40, Math.round(s.fill / 5) * 5));
    for (const k of ["lastArrival", "nightFrom", "nightTo"]) {
      if (typeof s?.[k] === "string" && /^\d{2}:\d{2}$/.test(s[k])) def[k] = s[k];
    }
    if (Number.isFinite(s?.nightWait)) def.nightWait = Math.min(240, Math.max(5, Math.round(s.nightWait)));
    if (Number.isFinite(s?.xferLevel)) def.xferLevel = Math.min(3, Math.max(0, Math.round(s.xferLevel)));
    // Altbestand: früher wurde eine Minutenzahl gespeichert
    else if (Number.isFinite(s?.xferExtra)) def.xferLevel = s.xferExtra >= 10 ? 3 : s.xferExtra >= 6 ? 2 : s.xferExtra >= 1 ? 1 : 0;
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
    return;
  }
  /* Steht der Anker schon auf dem Ziel (z. B. nach einem Neuladen mit
     „#results“ in der Adresszeile), meldet der Browser KEINE Änderung —
     dann muss direkt umgeschaltet werden. Ohne das passierte beim
     Verbinden zweier Kacheln scheinbar gar nichts. */
  if (location.hash === `#${name}`) showView(name);
  else location.hash = name;
}

document.querySelectorAll("[data-back]").forEach(b => b.addEventListener("click", () => navigate("grid")));

/* ---------------- Button-Grid ---------------- */

const gridEl = byId("buttongrid");

function renderGrid() {
  gridEl.innerHTML = "";
  // Bei >14 Kacheln muss das Grid scrollbar sein: „Nur Tippen“ deaktiviert das
  // Wisch-Verbinden komplett; „Hybrid“ deaktiviert es, sobald ein Start gewählt
  // ist (dann scrollt Wischen frei zum Ziel). Bearbeiten-Modus bleibt unberührt.
  /* Bis 14 Kacheln passt alles auf eine Seite (Reihen teilen sich die Höhe);
     darüber ist Scrollen gewollt und das Raster behält seine feste Kachelhöhe. */
  document.body.classList.toggle("fitgrid", slots.length <= BASE_SLOTS);
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
  app.aroundPlaces = null;
  app.searchTag = (app.searchTag || 0) + 1;
  app.lastFocusKey = null;   // die „letzte Verbindung“ wird je Suche EINMAL bestimmt
  app.emptyCats = new Set(); // je Suche neu belegen: was nachweislich nicht fährt
  byId("results-title").textContent = `${from.label || from.name} → ${to.label || to.name}`;
  updateChips();
  navigate("results");
  /* Bewusst KEINE größere Erstanfrage bei „Letzte“: nachgemessen bringt sie
     nichts. Eine Ankunftssuche liefert bei höherem `numItineraries` weitere
     FRÜHERE Verbindungen, nicht spätere — der Kontext hinter der letzten
     Verbindung muss so oder so einmal nachgeladen werden. */
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

// Nächstes Betriebstag-Ende (~04:00 lokal) als Grenze für „Letzte“
const hhmmToMin = v => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || ""));
  return m ? Math.min(1439, Number(m[1]) * 60 + Number(m[2])) : 0;
};

/* Nächster Zeitpunkt der eingestellten Spät-Ankunft („Betriebsschluss“).
   Früher fest 04:00 — jetzt einstellbar, weil die Grenze je nach Strecke und
   Gewohnheit ganz verschieden liegt. */
function nextServiceEnd() {
  const mins = hhmmToMin(settings.lastArrival || "04:00");
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setMinutes(mins);
  if (d <= new Date()) d.setDate(d.getDate() + 1);
  return d;
}

// Liegt dieser Zeitpunkt im eingestellten Nachtfenster? (darf über Mitternacht gehen)
function inNightWindow(ms) {
  const d = new Date(ms);
  const m = d.getHours() * 60 + d.getMinutes();
  const a = hhmmToMin(settings.nightFrom), b = hhmmToMin(settings.nightTo);
  return a <= b ? (m >= a && m < b) : (m >= a || m < b);
}

/* Berührt eine Wartezeit die Nacht? Es genügt NICHT, Anfang und Ende zu prüfen:
   Wer um 20 Uhr ankommt und um 8 Uhr weiterfährt, wartet die ganze Nacht,
   obwohl beide Enden außerhalb liegen. Deshalb zusätzlich prüfen, ob ein
   Nachtbeginn INNERHALB der Wartezeit liegt. */
function waitTouchesNight(startMs, endMs) {
  if (inNightWindow(startMs) || inNightWindow(endMs)) return true;
  const a = hhmmToMin(settings.nightFrom);
  const d = new Date(startMs);
  const days = Math.ceil((endMs - startMs) / 86400000) + 1;
  for (let k = 0; k <= days; k++) {
    const start = +new Date(d.getFullYear(), d.getMonth(), d.getDate() + k, 0, a);
    if (start >= startMs && start <= endMs) return true;
  }
  return false;
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
/* Gemeinsamer Bau der Suchparameter — von fetchPage UND vom Nachfüllen der
   Legende benutzt. Eine zweite, eigene Zusammenstellung hätte über kurz oder
   lang andere Werte gehabt (Umsteigezeit, Umkreis-Modus, Ankunftssuche). */
function planParams({ time = null, limit = 10, cursor = null } = {}) {
  const { from, to } = app.search;
  const t = app.searchTime;
  /* „Letzte“ nutzt die ANKUNFTSSUCHE bis Betriebsschluss: Der Router liefert
     damit von sich aus die spätesten Verbindungen, die vor der Grenze ankommen
     — eine Anfrage, kein Rückwärtsblättern, keine eigene Lücken-Heuristik. */
  const arriveBy = t.kind === "letzte" || (t.kind === "custom" && t.arriveBy);
  const baseTime = time ? new Date(time)
    : t.kind === "custom" ? new Date(t.time)
    : t.kind === "letzte" ? nextServiceEnd()
    : new Date();
  const params = new URLSearchParams({
    fromPlace: from.id,
    toPlace: to.id,
    time: baseTime.toISOString(),
    numItineraries: String(limit),
    language: "de",
    withScheduledSkippedStops: "true", // auch übersprungene Halte mitnehmen
  });
  /* Läuft die Suche im Umkreis-Modus (Ersatzverkehr), muss auch das BLÄTTERN
     mit Koordinaten laufen. Sonst werden die Cursor der Umkreis-Antwort mit
     einer Haltestellen-Anfrage kombiniert, die für diese Strecke gar nichts
     liefert — Ergebnis: „Nachladen bringt nichts“. */
  if (app.aroundUsed && app.aroundPlaces) {
    params.set("fromPlace", app.aroundPlaces.from);
    params.set("toPlace", app.aroundPlaces.to);
    params.set("maxPreTransitTime", "1800");
    params.set("maxPostTransitTime", "1800");
  }
  /* Mehr Zeit zum Umsteigen geht direkt in die Anfrage. Der Router sucht dann
     ANDERE Verbindungen, die das einhalten, statt dass wir hinterher welche
     wegwerfen — und es kostet keine zusätzliche Anfrage. */
  const xf = XFER_LEVELS[settings.xferLevel] || XFER_LEVELS[0];
  if (xf.factor !== 1) params.set("transferTimeFactor", String(xf.factor));
  if (xf.extra) params.set("additionalTransferTime", String(xf.extra));
  /* Eine Ankunftssuche mit ausdrücklicher Zeit ist beim Nachfüllen falsch:
     Dort geht es um einen Zeitraum, der bereits geladen ist. */
  if (arriveBy && !time) params.set("arriveBy", "true");
  if (cursor) params.set("pageCursor", cursor);
  return params;
}

async function fetchPage(direction, limit = 10) {
  const params = planParams({
    limit,
    cursor: direction === "later" ? app.nextPageCursor
      : direction === "earlier" ? app.prevPageCursor : null,
  });

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

/* ---------------------------------------------------------------------------
   Ein Verkehrsmittel nachträglich einblenden

   Warum das überhaupt Anfragen braucht: MOTIS liefert Pareto-optimale
   Ergebnisse. Eine Fernbus-Verbindung, die langsamer ist als der ICE, taucht in
   der ungefilterten Suche NIE auf — sie existiert aber. Nachgemessen an
   Nürnberg→München: ungefiltert kein einziger Fernbus, mit Fernbus im Filter
   vier Verbindungen. Ohne Nachladen bliebe der Eintrag in der Legende also
   ausgegraut, obwohl es etwas zu sehen gäbe.

   Nachgefüllt wird der GESAMTE bereits geladene Zeitraum, nicht nur das
   sichtbare Fenster: Sonst blieben ältere Spalten dauerhaft unvollständig, ohne
   dass es jemand merkt — Zurückscrollen lädt ja nichts nach.

   Warum das bezahlbar ist: mit `numItineraries: 30` deckt EINE Anfrage rund
   zwölf Stunden ab (gemessen 709 min bei 371 ms; mit 10 sind es 156 min). Der
   ganze geladene Bereich kostet damit 1–3 Anfragen statt 5–8 — und nur beim
   Einblenden, nicht bei jedem Laden.
   --------------------------------------------------------------------------- */
const REFILL_LIMIT = 30;

async function refillLoadedRange() {
  const modes = enabledModes();
  if (!modes || !app.itins.length) return 0;   // alles an → nichts zu ergänzen
  const deps = app.itins.map(depOf).filter(Number.isFinite);
  if (!deps.length) return 0;
  const von = Math.min(...deps), bis = Math.max(...deps);

  let cursor = null, added = 0;
  for (let round = 0; round < 4; round++) {
    const params = planParams({ time: round === 0 ? von : null, limit: REFILL_LIMIT, cursor });
    let data;
    try {
      const res = await fetch(`${API}/plan?${params}&transitModes=${encodeURIComponent(modes)}`);
      if (!res.ok) break;
      data = await res.json();
    } catch { break; }

    const known = new Set(app.itins.map(itKey));
    const fresh = (data.itineraries || []).filter(it => transitLegs(it).length);
    for (const it of fresh) {
      const k = itKey(it);
      if (known.has(k)) continue;
      known.add(k);
      app.itins.push(it);
      added++;
    }
    /* Die Cursor der laufenden Suche bleiben UNANGETASTET — dieses Nachfüllen
       ist ein Seitenweg, kein Blättern. */
    const juengste = fresh.length ? Math.max(...fresh.map(depOf)) : -Infinity;
    if (!data.nextPageCursor || juengste >= bis) break;
    cursor = data.nextPageCursor;
  }
  if (added) app.itins.sort((a, b) => depOf(a) - depOf(b));
  return added;
}

/* Kontext um das Ergebnis herum nachladen — NACH der Umkreis-Rückfallebene.
   Vorher stand das davor und hing an `app.itins.length`: Bei Strecken, die
   erst über den Umkreis etwas finden (Erlenstegen → Vorra), war der Pool zu
   diesem Zeitpunkt noch leer, das Nachladen wurde übersprungen, und die
   gesuchte letzte Verbindung klebte ohne Nachbarn am rechten Rand.

   Nach hinten wird so weit geladen, dass die Zielverbindung in der ZWEITEN
   Spalte stehen kann und die eingestellte Spaltenzahl gefüllt ist — bei sieben
   Spalten braucht es eben sechs Verbindungen danach, nicht vier. */
async function loadContext() {
  if (!app.itins.length) return;
  if (app.prevPageCursor) await fetchPage("earlier", 2); // zwei als Kontext davor
  if (app.searchTime.kind !== "letzte") return;

  const need = Math.max(2, Math.min(7, settings.cols || 3) - 1);

  /* Den Fokus JETZT festlegen — VOR dem Nachladen. Sonst passiert genau das,
     was die Markierung immer wieder nach rechts rutschen ließ: Das Nachladen
     bringt spätere Verbindungen, die nächste Bestimmung nimmt eine davon, und
     dahinter ist wieder nichts. Inhaltlich ist das Einfrieren korrekt, weil die
     Ankunftssuche die spätesten Verbindungen VOR Betriebsschluss bereits
     vollständig geliefert hat; was danach kommt, kommt erst am nächsten Morgen
     und ist nur Kontext. Kostet keine zusätzliche Anfrage. */
  const key = lastFocusKey(visibleItins());
  if (key === "end") return;

  /* Höchstens zwei Runden, und die zweite nur, wenn die erste nichts Sichtbares
     gebracht hat (etwa weil alles Nachgeladene ausgeblendet ist). Jede Runde
     kostet eine volle Umlaufzeit — im Normalfall bleibt es bei einer. */
  for (let round = 0; round < 2; round++) {
    const visible = visibleItins();
    const focus = visible.find(it => itKey(it) === key);
    if (!focus) return;
    const behind = visible.filter(it => depOf(it) > depOf(focus)).length;
    if (behind >= need || !app.nextPageCursor) return;
    const { added } = await fetchPage("later", need - behind + 2);
    if (!added) return;
  }
}

/* Die „letzte Verbindung“ wird je Suche EINMAL bestimmt und dann festgehalten.
   Vorher rechnete sie jeder Neuaufbau neu — und weil der Pool zwischendurch
   wächst, konnte dabei eine andere Verbindung herauskommen: Die Markierung
   sprang, mal stand sie in der zweiten Spalte, mal in der letzten. Neu bestimmt
   wird nur, wenn die gemerkte Verbindung nicht mehr sichtbar ist (etwa weil ein
   Verkehrsmittel ausgeblendet wurde) — oder bei einer neuen Suche, und genau
   das passiert beim erneuten Tippen auf „Letzte“. */
function lastFocusKey(visible) {
  const known = app.lastFocusKey && visible.some(it => itKey(it) === app.lastFocusKey);
  if (!known) app.lastFocusKey = findLastDecent(visible) || null;
  return app.lastFocusKey || "end";
}

/* Orchestrierung: beschafft (ggf. mehrere Seiten) und rendert GENAU EINMAL. */
/* Während einer frischen Suche ist ALLES Alte weg — Liste und Grafik werden
   ausgeblendet und die Grafik geleert. Vorher blieb der vorherige Stand stehen,
   bis der neue kam: Beim Wechsel zwischen „Jetzt“ und „Letzte“ sah man kurz die
   Verbindungen der anderen Ansicht. Lieber einen Moment nichts als etwas
   Falsches. */
function showSearching(text) {
  byId("searching-text").textContent = text;
  byId("searching").hidden = false;
  byId("timeline-wrap").hidden = true;
  resultsList.hidden = true;
  byId("timeline").innerHTML = "";
  resultsList.innerHTML = "";
  byId("last-note").hidden = true;
  byId("around-note").hidden = true;
}

async function runPlan(direction = null, limit = 10) {
  if (!direction) showSearching("Verbindungen suchen …");
  try {
    const { params } = await fetchPage(direction, limit);
    if (!direction) {
      // Nichts gefunden? Ersatzverkehr fährt oft ab einem Nachbarhalt →
      // einmalig mit Koordinaten und großzügigem Fußweg nachfassen.
      if (!app.itins.length && !app.aroundTried) {
        app.aroundTried = true;
        showSearching("Nichts am Halt selbst – Umgebung prüfen …");
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
      if (app.itins.length) {
        showSearching(app.searchTime.kind === "letzte"
          ? "Letzte Verbindung eingrenzen …" : "Umgebung laden …");
      }
      await loadContext();
    }
    renderResults();
    if (!direction) maybeAutoFill();
  } catch (e) {
    if (!direction) {
      const msg = `<p class="status error">Konnte keine Verbindungen laden (${escapeHtml(e.message)}). Nochmal versuchen?</p>`;
      // Suchanzeige beenden, sonst läuft der Balken unter der Fehlermeldung weiter
      byId("searching").hidden = true;
      resultsList.hidden = app.viewMode === "graph";
      byId("timeline-wrap").hidden = app.viewMode !== "graph";
      resultsList.innerHTML = msg;
      byId("timeline").innerHTML = msg;
    }
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
  app.aroundPlaces = { from: a, to: b }; // fürs spätere Blättern merken
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

/* Wenn die markierte „letzte“ Verbindung nur deshalb die letzte ist, weil
   spätere über ein AUSGEBLENDETES Verkehrsmittel laufen, muss das dastehen.
   Sonst wirkt die Markierung schlicht falsch: Regensburg→Neustrelitz zeigt mit
   D-Ticket-Sicht 12:45 als letzte, während es bis 17:48 weitergeht — aber eben
   nur mit ICE. Ohne diesen Hinweis sucht man den Fehler in der App. */
function updateLastNote(visible) {
  const el = byId("last-note");
  el.hidden = true;
  if (app.searchTime.kind !== "letzte" || !visible.length) return;
  const depOfIt = it => { const T = transitLegs(it); return T.length ? +new Date(T[0].from.departure) : 0; };
  const lastVisible = Math.max(...visible.map(depOfIt));
  const later = app.itins.filter(it => depOfIt(it) > lastVisible);
  if (!later.length) return;
  const cats = new Set();
  for (const it of later) {
    for (const l of transitLegs(it)) {
      const c = productClass(l.mode);
      if (app.hiddenCats.has(c)) cats.add(CAT_LABEL[c]);
    }
  }
  if (!cats.size) return;
  const names = [...cats].join(" und ");
  el.innerHTML = `ℹ️ Später fährt noch etwas, aber nur mit <strong>${escapeHtml(names)}</strong> – ` +
    `in der Legende unten wieder einblenden.`;
  el.hidden = false;
}

/* --- „Letzte anständige Verbindung“ ---
   Welche Verbindungen überhaupt die letzten sind, beantwortet die
   Ankunftssuche bis Betriebsschluss (siehe fetchPage) — hier wird daraus nur
   noch die FOKUS-Spalte gewählt: die späteste, bei der man unterwegs nicht
   strandet (längste Umstiegs-Wartezeit ≤ 45 min; die Gesamtdauer ist bewusst
   kein Kriterium, ein durchfahrender Nachtzug bleibt „anständig“).
   Gefiltert wird nichts — die Verbindung wird nur angesteuert. */
// Verbindungen als sortierte Kennzahlen-Liste (Abfahrt + längste Umstiegswartezeit)
function gapList(itins) {
  return itins.map(it => {
    const legs = transitLegs(it);
    if (!legs.length) return null;
    let maxGap = 0, nightGap = 0;
    for (let i = 1; i < legs.length; i++) {
      const s0 = +new Date(legs[i - 1].to.arrival), s1 = +new Date(legs[i].from.departure);
      const gap = s1 - s0;
      maxGap = Math.max(maxGap, gap);
      if (waitTouchesNight(s0, s1)) nightGap = Math.max(nightGap, gap);
    }
    return { key: itKey(it), dep: +new Date(legs[0].from.departure),
             arr: +new Date(legs[legs.length - 1].to.arrival), maxGap, nightGap };
  }).filter(Boolean).sort((a, b) => a.dep - b.dep);
}

/* Die „letzte Verbindung des Tages“ ist die späteste, die noch VOR
   Betriebsschluss ankommt — nicht einfach die letzte geladene. Der Unterschied
   wurde wichtig, als für den Kontext auch Verbindungen NACH ihr geladen wurden:
   ohne diese Schranke wäre der Fokus einfach mitgewandert und die Antwort auf
   „wann komme ich noch heim?“ eine andere geworden. */
function findLastDecent(itins) {
  const limit = +nextServiceEnd();
  const all = gapList(itins);
  const list = all.filter(x => x.arr <= limit);
  if (!list.length) return all.length ? all[0].key : null;
  /* Gemessen wird nur die Wartezeit, die tatsächlich in die Nacht fällt — und
     zwar am Stück an EINEM Halt, nicht über die Umstiege summiert. Zwei kurze
     Aufenthalte sind kein Stranden, einer von zwei Stunden um 3 Uhr schon. */
  const limitMs = (settings.nightWait || 45) * 60000;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].nightGap <= limitMs) return list[i].key;
  }
  return list[list.length - 1].key;
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
  return app.viewMode === "graph" ? Math.min(7, Math.max(3, settings.cols || 3)) + 2 : 6;
}

// transitModes-Gruppen je Kategorie (für gezielt gefilterte Zusatzanfragen)
const CAT_MODES = {
  fern: "HIGHSPEED_RAIL,LONG_DISTANCE,NIGHT_RAIL",
  // Achtung: RAIL ist serverseitig die Oberklasse ALLER Züge (inkl. ICE)
  // und darf hier nicht auftauchen, sonst kippt der Filter
  regio: "REGIONAL_RAIL,REGIONAL_FAST_RAIL",
  sbahn: "SUBURBAN,METRO",
  ubahn: "SUBWAY",
  tram: "TRAM",
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
    el.addEventListener("click", async (e) => {
      const b = e.target.closest(".tl-key");
      if (!b || app.refilling) return;
      const c = b.dataset.cat;
      app.autoLoads = 0;
      if (!app.hiddenCats.has(c)) {          // ausblenden kostet keine Anfrage
        app.hiddenCats.add(c);
        renderResults();
        return;
      }
      /* Einblenden: Die Verbindungen dieser Kategorie können im Pool schlicht
         fehlen, weil sie von schnelleren verdrängt wurden. Also nachfüllen —
         und zwar über den ganzen geladenen Zeitraum. */
      app.hiddenCats.delete(c);
      app.refilling = true;
      showSearching(`${CAT_LABEL[c]} nachladen …`);
      try {
        await refillLoadedRange();
      } finally {
        app.refilling = false;
      }
      /* Kam trotz eigener Anfrage nichts dieser Art, gibt es hier wirklich
         nichts — erst DANN ist die Aussage „keine“ belegt. */
      const gibts = app.itins.some(it => transitLegs(it).some(l => productClass(l.mode) === c));
      if (!gibts) app.emptyCats.add(c); else app.emptyCats.delete(c);
      renderResults();
      maybeAutoFill();
    });
  }
  const present = new Set();
  for (const it of app.itins) for (const l of transitLegs(it)) present.add(productClass(l.mode));
  el.querySelectorAll(".tl-key").forEach(b => {
    const c = b.dataset.cat;
    const has = present.has(c);
    /* Ausgegraut heißt jetzt „nachweislich nichts da“ — und das wissen wir erst,
       wenn eine eigene Anfrage für diese Kategorie nichts gebracht hat. Vorher
       stand dort „Keine … im Zeitraum“, obwohl nur niemand danach gefragt
       hatte: Verdrängte Verbindungen tauchen ungefragt nie auf. */
    const belegtLeer = !has && app.emptyCats.has(c);
    b.classList.toggle("nodata", belegtLeer);
    b.classList.toggle("off", !belegtLeer && app.hiddenCats.has(c));
    b.classList.toggle("on", has && !app.hiddenCats.has(c));
    b.title = belegtLeer ? `Auf dieser Strecke fährt im geladenen Zeitraum kein ${CAT_LABEL[c]}`
      : app.hiddenCats.has(c) ? `${CAT_LABEL[c]} einblenden${has ? "" : " (wird nachgeladen)"}`
      : `${CAT_LABEL[c]} ausblenden`;
  });
}

function renderResults() {
  byId("searching").hidden = true;   // ab hier steht echter Inhalt
  const graph = app.viewMode === "graph";
  // Die Grafikansicht ist bildschirmfüllend und darf nicht scrollen; das
  // steuert CSS über dieses Attribut (die Liste scrollt dagegen normal).
  document.body.dataset.mode = app.viewMode;
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
  updateLastNote(visible);
  if (graph) {
    const focus = app.searchTime.kind === "letzte" ? lastFocusKey(visible) : "start";
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
        <span class="trip-sub">${dur} · ${it.transfers} Umst.${trackInfo ? " · " + (trackChanged ? `<span class="track-changed">${trackInfo}</span>` : trackInfo) : ""}${cancelled ? "" : (issues => issues.level ? ` · ${riskMark(issues.level)}` : "")(itinIssues(it))}</span>
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

let jrnGroup = 0; // laufende Nummer für Zwischenhalt-Gruppen

function fillDetails(container, it) {
  const flagged = cancelledTransitLegs(it);
  const T = transitLegs(it);
  if (!T.length) return;
  const legs = it.legs;

  const jrn = document.createElement("div");
  jrn.className = "jrn";
  const parts = [`<div class="jrn-line"></div><div class="jrn-progress" hidden></div>`];

  const stopRow = (p, kind, rt) => {
    const t = kind === "dep" ? p.departure : p.arrival;
    const ts = kind === "dep" ? p.scheduledDeparture : p.scheduledArrival;
    return `<div class="jrn-stop" data-ts="${+new Date(t || ts)}" data-stop="${escapeHtml(p.stopId || "")}">` +
      `<span class="jrn-time">${timeWithDelay(ts, t, rt)}</span>` +
      `<span class="jrn-dot"></span>` +
      `<span class="jrn-name">${escapeHtml(p.name)}` +
      `<span class="jrn-track">${trackChip(p, kind === "dep" ? "Abfahrtsort" : "Ankunftsort")}</span></span></div>`;
  };

  const segBlock = (l) => {
    const lp = lineParts(l);
    const cls = productClass(l.mode);
    const sev = !flagged.has(l) && isReplacementService(l);
    const stops = l.intermediateStops || [];
    const facts = [];
    if (l.wheelchairAccessible === true || l.wheelchairAccessible === "WHEELCHAIR_ACCESSIBLE") facts.push("♿ barrierefrei");
    if (l.bikesAllowed === true || l.bikesAllowed === "BIKES_ALLOWED") facts.push("🚲 Fahrradmitnahme");
    const stopLi = (s, gid) => {
      const rt = l.realTime;
      const t = s.arrival || s.departure, ts = s.scheduledArrival || s.scheduledDeparture;
      return `<div class="jrn-sub" data-group="${gid}" data-ts="${+new Date(t || ts)}" hidden>` +
        `<span class="jrn-time">${timeWithDelay(ts, t, rt)}</span><span class="jrn-dot"></span>` +
        `<span class="jrn-name${s.cancelled ? " stop-cancelled" : ""}">${escapeHtml(s.name)}` +
        `${s.cancelled ? " · entfällt" : ""}</span></div>`;
    };
    const seg = `<div class="jrn-seg">` +
      `<span class="jrn-dur">${fmtDur(l.duration)}</span>` +
      `<div class="jrn-body">` +
        `<span class="linechip seg-${cls}${sev ? " chip-sev" : ""}">` +
          `<span class="lc-icon">${modeIcon(l)}</span><span class="lc-name">${escapeHtml(lp.main)}</span>` +
        `</span>` +
        `${lp.extra ? ` <span class="linextra">(${escapeHtml(lp.extra)})</span>` : ""}` +
        `${flagged.has(l) ? ` <span class="cancelled-label">Fällt aus</span>` : ""}` +
        `${sev ? ` <span class="sev-badge">Ersatzverkehr</span>` : ""}` +
        `<p class="jrn-dir">nach ${escapeHtml(l.headsign || l.to.name)}</p>` +
        `${sev ? `<p class="sev-hint">Fährt als Bus ab einer Ersatzhaltestelle.</p>` : ""}` +
      `</div></div>`;
    /* Zwischenhalte als DIREKTE Geschwisterzeilen — bewusst OHNE
       <details>/<ul> drumherum. Jede Verschachtelung hat ihre Zeilen aus
       dem Raster gebracht und die Punkte neben die Linie geschoben.
       Das Auf- und Zuklappen macht ein eigener Umschalter. */
    const gid = `g${jrnGroup++}`;
    const { level, notes } = legIssues(l);
    const label = stops.length
      ? `${stops.length} Zwischenhalt${stops.length === 1 ? "" : "e"}`
      : notes.length ? "Hinweise zur Fahrt" : "Infos zur Fahrt";
    const info = (stops.length || facts.length || notes.length)
      ? `<div class="jrn-more"><span class="jrn-dur"></span><span></span>` +
          (notes.length
            ? noteToggle(gid, level, label)
            : `<button type="button" class="jrn-toggle" data-group="${gid}" aria-expanded="false">` +
              `${label}<span class="caret">▾</span></button>`) +
          `</div>` +
        stops.map(st => stopLi(st, gid)).join("") +
        (notes.length ? noteRows(gid, level, notes) : "") +
        (facts.length
          ? `<div class="jrn-facts" data-group="${gid}" hidden><span class="jrn-dur"></span>` +
            `<span></span><span>${facts.join(" · ")}</span></div>`
          : "")
      : "";
    return seg + info;
  };

  /* Aufklappbare Hinweiszeile. Sie liegt als eigene Rasterzeile NEBEN dem
     Auslöser, nicht darin verschachtelt — verschachtelte Zeilen haben die
     Punkte schon einmal von der Linie geschoben.

     Jede Markierung ist aufklappbar und nennt ihren Grund. Ein Symbol ohne
     Erklärung ist schlimmer als keines: Man sieht, dass etwas ist, kann aber
     nichts damit anfangen. */
  const noteRows = (gid, level, notes) =>
    `<div class="jrn-warn risk-${level}" data-group="${gid}" hidden>` +
    `<span class="jrn-dur"></span><span></span>` +
    `<ul>${notes.map(w => `<li>${escapeHtml(w)}</li>`).join("")}</ul></div>`;

  const noteToggle = (gid, level, label) =>
    `<button type="button" class="jrn-toggle" data-group="${gid}" aria-expanded="false">` +
    `${label} ${riskMark(level)}<span class="caret">▾</span></button>`;

  // Umstieg zwischen zwei Fahrten: Fußweg und/oder Wartezeit
  const transferBlock = (prev, next) => {
    const ms = +new Date(next.from.departure) - +new Date(prev.to.arrival);
    const walk = walkLegsBetween(legs, prev, next);
    const walkMin = walk.reduce((a, l) => a + l.duration, 0);
    const { level, notes } = transferIssues(it, prev, next);
    const gid = `g${jrnGroup++}`;
    const label = `<span class="wi">${ICON.walk}</span>${walkMin > 60 ? `Umstieg mit ${fmtDur(walkMin)} Fußweg` : "Umstieg"}`;
    return `<div class="jrn-transfer${level ? ` risk-${level}` : ""}">` +
      `<span class="jrn-dur">${fmtDur(Math.max(0, ms / 1000))}</span>` +
      `<div class="jrn-body">${notes.length ? noteToggle(gid, level, label) : label}</div></div>` +
      (notes.length ? noteRows(gid, level, notes) : "");
  };

  // führender / abschließender Fußweg (Umkreis-Suche, Ersatzhaltestellen)
  const edgeWalk = (l, where) => {
    if (!l || l.duration < 60) return "";
    const name = where === "pre" ? l.to.name : l.from.name;
    return `<div class="jrn-transfer edge"><span class="jrn-dur">${fmtDur(l.duration)}</span>` +
      `<div class="jrn-body"><span class="wi">${ICON.walk}</span>Fußweg ${where === "pre" ? "zum" : "vom"} Halt ${escapeHtml(name)} ` +
      `${mapsPin(where === "pre" ? l.to : l.from)}</div></div>`;
  };

  const firstIdx = legs.indexOf(T[0]), lastIdx = legs.indexOf(T[T.length - 1]);
  const preWalk = legs.slice(0, firstIdx).find(l => l.mode === "WALK");
  const postWalk = legs.slice(lastIdx + 1).find(l => l.mode === "WALK");
  if (preWalk) parts.push(edgeWalk(preWalk, "pre"));
  T.forEach((l, i) => {
    parts.push(stopRow(l.from, "dep", l.realTime));
    parts.push(segBlock(l));
    parts.push(stopRow(l.to, "arr", l.realTime));
    if (i < T.length - 1) parts.push(transferBlock(l, T[i + 1]));
  });
  if (postWalk) parts.push(edgeWalk(postWalk, "post"));

  jrn.innerHTML = parts.join("");
  const relayout = () => updateJourneyLine(jrn);
  jrn.addEventListener("click", (e) => {
    const btn = e.target.closest(".jrn-toggle");
    if (!btn) return;
    const open = btn.getAttribute("aria-expanded") === "true";
    btn.setAttribute("aria-expanded", open ? "false" : "true");
    jrn.querySelectorAll(`.jrn-sub[data-group="${btn.dataset.group}"], .jrn-facts[data-group="${btn.dataset.group}"]`)
      .forEach(el => { el.hidden = open; });
    relayout();
  });
  requestAnimationFrame(relayout);
  attachStopAlerts(jrn, T, relayout);
  startJourneyTicker();
  container.appendChild(jrn);

  const a = document.createElement("a");
  a.className = "dblink";
  a.target = "_blank";
  a.rel = "noopener";
  a.href = dbLink(
    app.search.from.name, app.search.to.name,
    T[0].from.scheduledDeparture, T[T.length - 1].to.scheduledArrival
  );
  a.textContent = "Bei der DB öffnen";
  if (PP.native) {
    enableExactDbLink(a, app.search.from.name, app.search.to.name,
      T[0].from.scheduledDeparture, T[T.length - 1].to.scheduledArrival);
  }
  container.appendChild(a);
}

/* Durchgehende Linie über die GESAMTE Verbindung: Sie verbindet alle Halte,
   und der farbige Teil zeigt, wie weit die Reise fortgeschritten ist — man
   sieht also auf einen Blick, in welchem Abschnitt man gerade sitzt und wo
   der aktuelle Zug zwischen zwei Halten steht. Bereits passierte Halte
   werden gedimmt. Läuft die Reise nicht (noch nicht los / schon vorbei),
   bleibt die Linie neutral. */
/* ---------------------------------------------------------------------------
   Echte Meldungen der Verkehrsbetriebe

   Die Verbindungssuche (/plan) liefert KEINE Meldungstexte — das Feld gibt es
   dort schlicht nicht (nachgemessen, auch mit withAlerts). Die echten Texte
   hängen an den HALTEN und kommen über /stoptimes: Störungen, Bauarbeiten,
   defekte Aufzüge, Umleitungen — mit Überschrift, Fließtext, Ursache und
   Wirkung, so wie der Verkehrsbetrieb sie formuliert hat.

   Deshalb werden sie erst beim ÖFFNEN einer Verbindung nachgeladen, für deren
   Ein-, Um- und Ausstiegshalte. Das sind zwei bis vier Anfragen, nur auf
   ausdrücklichen Wunsch des Nutzers, und sie werden stundenweise gecacht.
   Schlägt es fehl, fehlen nur die Zusatztexte — die gerechneten Hinweise
   (Umstieg zu knapp usw.) stehen unabhängig davon.
   --------------------------------------------------------------------------- */

const alertCache = new Map();

async function stopAlerts(stopId, timeIso) {
  if (!stopId) return [];
  const key = `${stopId}@${timeIso.slice(0, 13)}`; // stundenweise reicht völlig
  if (!alertCache.has(key)) {
    alertCache.set(key, (async () => {
      try {
        const q = new URLSearchParams({ stopId, time: timeIso, n: "1", withAlerts: "true" });
        const res = await fetch(`${API}/stoptimes?${q}`);
        if (!res.ok) return [];
        const d = await res.json();
        const all = [...(d.place?.alerts || [])]
          .concat((d.stopTimes || []).flatMap(st => st.place?.alerts || []));
        const seen = new Set();
        return all.filter(a => {
          const k = `${a.headerText}|${a.descriptionText}`;
          return !seen.has(k) && seen.add(k);
        });
      } catch { return []; }
    })());
  }
  return alertCache.get(key);
}

/* Die Texte kommen als HTML aus den Feeds (<b>, <ul>, <li>, <br>). Sie roh
   einzusetzen wäre eine Lücke, sie stumpf zu entschärfen macht Listen
   unlesbar — deshalb Struktur in Zeichen übersetzen und dann alle Tags weg. */
function alertText(raw) {
  return String(raw || "")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/(p|div|ul|ol|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}

const ALERT_CAUSE = {
  TECHNICAL_PROBLEM: "Technische Störung", STRIKE: "Streik", DEMONSTRATION: "Demonstration",
  ACCIDENT: "Unfall", HOLIDAY: "Feiertag", WEATHER: "Wetter", MAINTENANCE: "Wartung",
  CONSTRUCTION: "Bauarbeiten", POLICE_ACTIVITY: "Polizeieinsatz",
  MEDICAL_EMERGENCY: "Medizinischer Notfall", SPECIAL_EVENT: "Veranstaltung",
};

async function attachStopAlerts(jrn, T, relayout) {
  const stops = [];
  T.forEach((l, i) => {
    if (i === 0) stops.push([l.from, l.from.departure]);
    stops.push([l.to, l.to.arrival]);
    if (i < T.length - 1) stops.push([T[i + 1].from, T[i + 1].from.departure]);
  });
  const seen = new Set();
  await Promise.all(stops.map(async ([p, when]) => {
    if (!p.stopId || seen.has(p.stopId)) return;
    seen.add(p.stopId);
    const alerts = await stopAlerts(p.stopId, when || new Date().toISOString());
    if (!alerts.length || !jrn.isConnected) return;
    const row = jrn.querySelector(`.jrn-stop[data-stop="${CSS.escape(p.stopId)}"]`);
    if (!row || row.dataset.alerted) return;
    row.dataset.alerted = "1";
    const gid = `a${jrnGroup++}`;
    const items = alerts.map(a => {
      const cause = ALERT_CAUSE[a.cause];
      const head = alertText(a.headerText);
      const body = alertText(a.descriptionText);
      return `<li>${cause ? `<b>${escapeHtml(cause)}:</b> ` : ""}${escapeHtml(head)}` +
        (body && body !== head ? `<span class="alert-body">${escapeHtml(body)}</span>` : "") +
        (a.url ? ` <a href="${escapeHtml(a.url)}" target="_blank" rel="noopener">Mehr</a>` : "") +
        `</li>`;
    }).join("");
    row.insertAdjacentHTML("afterend",
      `<div class="jrn-more"><span class="jrn-dur"></span><span></span>` +
      `<button type="button" class="jrn-toggle" data-group="${gid}" aria-expanded="false">` +
      `${alerts.length === 1 ? "Meldung zu diesem Halt" : `${alerts.length} Meldungen zu diesem Halt`} ` +
      `${riskMark("notice")}<span class="caret">▾</span></button></div>` +
      `<div class="jrn-warn risk-notice" data-group="${gid}" hidden>` +
      `<span class="jrn-dur"></span><span></span><ul>${items}</ul></div>`);
    relayout();
  }));
}

/* Der Fortschritt hängt an der Uhr, nicht an einer Nutzeraktion: Linie,
   gedimmte Halte und die Umfärbung Grün→Grau müssen auch bei einer offen
   liegenden Ansicht weiterlaufen. EIN Ticker für alle sichtbaren Reisen, der
   sich selbst beendet, sobald keine mehr offen ist. */
let jrnTicker = null;
function startJourneyTicker() {
  if (jrnTicker) return;
  jrnTicker = setInterval(() => {
    const open = [...document.querySelectorAll(".jrn")].filter(j => j.offsetParent !== null);
    if (!open.length) { clearInterval(jrnTicker); jrnTicker = null; return; }
    open.forEach(updateJourneyLine);
  }, 30000);
}

function updateJourneyLine(jrn) {
  const rows = [...jrn.querySelectorAll(".jrn-stop, .jrn-sub")]
    .filter(r => r.offsetParent !== null);
  if (rows.length < 2) return;
  const center = r => {
    const dot = r.querySelector(".jrn-dot");
    return dot ? dot.offsetTop + dot.offsetHeight / 2 : r.offsetTop + r.offsetHeight / 2;
  };
  const y0 = center(rows[0]), y1 = center(rows[rows.length - 1]);
  const line = jrn.querySelector(".jrn-line");
  line.style.top = y0 + "px";
  line.style.height = Math.max(0, y1 - y0) + "px";

  const prog = jrn.querySelector(".jrn-progress");
  const now = Date.now();
  const stamps = rows.map(r => Number(r.dataset.ts)).filter(Number.isFinite);
  if (stamps.length < 2) { prog.hidden = true; return; }
  const first = stamps[0], last = stamps[stamps.length - 1];
  rows.forEach(r => r.classList.toggle("passed", now > Number(r.dataset.ts)));
  if (!(now >= first && now <= last)) { prog.hidden = true; return; }
  let y = y0;
  for (let i = 0; i < rows.length - 1; i++) {
    const t0 = Number(rows[i].dataset.ts), t1 = Number(rows[i + 1].dataset.ts);
    if (!Number.isFinite(t0) || !Number.isFinite(t1)) continue;
    if (now > t1) { y = center(rows[i + 1]); continue; }
    if (now >= t0) {
      y = center(rows[i]) + (t1 > t0 ? (now - t0) / (t1 - t0) : 0) * (center(rows[i + 1]) - center(rows[i]));
    }
    break;
  }
  // hart auf die Linie begrenzen — sie darf nie über den letzten Halt
  // hinauslaufen (sonst ragt sie aus der Ansicht heraus)
  y = Math.min(Math.max(y, y0), y1);
  prog.style.top = y0 + "px";
  prog.style.height = Math.max(0, y - y0) + "px";
  prog.hidden = false;
}

/* ---------------- DB-Link ---------------- */

/* Deutsche Ortszeit minutengenau: "YYYY-MM-DDTHH:MM".
   Bewusst NICHT die Zeitzone des Geräts: Die DB rechnet in Europe/Berlin.
   Wer aus einer anderen Zeitzone plant (Urlaub, Dienstreise, Grenzregion),
   bekäme sonst einen Link mit der falschen Minute — die Suche landet am
   falschen Zeitpunkt, und der Worker findet die Verbindung gar nicht mehr. */
const BERLIN_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Berlin", hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
});
function localMinuteIso(iso) {
  const p = {};
  for (const { type, value } of BERLIN_FMT.formatToParts(new Date(iso))) p[type] = value;
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

function dbLink(fromName, toName, depIso, arrIso) {
  const enc = encodeURIComponent;
  const dep = localMinuteIso(depIso);
  /* Vorbefüllte Suche mit exakter Soll-Abfahrtszeit — die gewünschte Verbindung
     steht damit ganz oben in der Trefferliste. Das ist das Beste, was ohne
     Server geht, und bleibt auch im nativen Build der Rückfall, wenn die vbid
     nicht zustande kommt (siehe dblink.js). */
  return `https://www.bahn.de/buchung/fahrplan/suche#sts=true&so=${enc(fromName)}&zo=${enc(toName)}&soid=${enc("O=" + fromName)}&zoid=${enc("O=" + toName)}&hd=${enc(dep + ":00")}`;
}

/* ---------------- Konfiguration übertragen ---------------- */

/* Der Link muss auf die ÖFFENTLICHE Adresse zeigen, nicht auf die des
   laufenden Geräts: In der APK liegt die Seite unter localhost, ein daraus
   gebauter Link wäre auf jedem anderen Gerät wertlos. */
const WEB_BASE = "https://schogugel.github.io/pendelpanda/";
const KONTAKT_MAIL = "pendelpanda@gmx.de";

/* Impressum. Solange `name` leer ist, bleibt der Eintrag in den Einstellungen
   VERBORGEN — ein unvollständiges Impressum ist schlechter als keines, weil es
   eine Pflichtangabe vortäuscht, die es nicht erfüllt. Name und ladungsfähige
   Anschrift eintragen, dann erscheint es von selbst. */
const IMPRESSUM = {
  name: "",
  strasse: "",
  ort: "",
};

function configLink() {
  // v2: Kacheln UND Einstellungen wandern gemeinsam
  const payload = { v: 2, slots, show: settings.show, cols: settings.cols,
                    fill: settings.fill, connect: settings.connectMode,
                    lastArrival: settings.lastArrival, nightFrom: settings.nightFrom,
                    nightTo: settings.nightTo, nightWait: settings.nightWait,
                    xferLevel: settings.xferLevel };
  const cfg = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  const base = PP.native ? WEB_BASE : `${location.origin}${location.pathname}`;
  return `${base}#cfg=${cfg}`;
}

byId("btn-share-config").addEventListener("click", () => {
  // Unterseite der Einstellungen: Einstellungen schließen, danach zurückkehren
  if (byId("settings-dialog").open) {
    app.shareFromSettings = true;
    byId("settings-dialog").close();
  }
  /* Der Dialog dient auch dem EMPFANGEN — er muss sich deshalb auch dann
     öffnen lassen, wenn hier noch nichts zu verschenken ist. Früher brach er
     mit „Noch keine Buttons belegt“ ab; genau auf einem frischen Gerät will
     man ihn aber am dringendsten. */
  const has = slots.filter(Boolean).length > 0;
  byId("share-url").value = has ? configLink() : "";
  byId("share-url").placeholder = has ? "" : "Noch keine Kacheln belegt";
  byId("share-copy").disabled = !has;
  byId("share-copy").textContent = "Link kopieren";
  byId("share-native").hidden = !navigator.share || !has;
  byId("share-in").value = "";
  byId("share-msg").textContent = "";
  byId("share-dialog").showModal();
});

/* Eingabe großzügig auslegen: ganze URL, nur der Anker, `cfg=…` oder der
   nackte Code. Wer etwas zwischen zwei Geräten hin- und herkopiert, verliert
   schnell mal ein Stück — daran soll es nicht scheitern. */
function cfgFromInput(raw) {
  const t = String(raw || "").trim();
  if (!t) return null;
  const m = t.match(/[#?&]cfg=([^&\s]+)/);
  if (m) return decodeURIComponent(m[1]);
  if (/^cfg=/.test(t)) return decodeURIComponent(t.slice(4));
  return t.replace(/\s+/g, "");
}

byId("share-apply").addEventListener("click", () => {
  const msg = byId("share-msg");
  const cfg = cfgFromInput(byId("share-in").value);
  if (!cfg) { msg.textContent = "Bitte erst den Link einfügen."; return; }
  const res = applyConfig(cfg, { ask: true });
  msg.textContent = res.ok ? res.text : `Das hat nicht geklappt: ${res.text}`;
  if (res.ok) {
    byId("share-in").value = "";
    renderGrid();
  }
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

// Zurück in die Einstellungen, wenn von dort aufgerufen
byId("share-dialog").addEventListener("close", () => {
  if (!app.shareFromSettings) return;
  app.shareFromSettings = false;
  byId("settings-dialog").showModal();
});

/* EINE Stelle, die eine Konfiguration übernimmt — egal ob sie aus der Adresse
   des Browsers kommt oder im Dialog eingefügt wurde. Getrennte Wege hätten
   über kurz oder lang unterschiedlich viel übernommen. */
function applyConfig(cfg, { ask = false } = {}) {
  let imported;
  try {
    imported = JSON.parse(decodeURIComponent(escape(atob(cfg))));
  } catch {
    return { ok: false, text: "Der Link ist unvollständig oder beschädigt." };
  }
  // v1 = nur das Kachel-Array, v2 = {v, slots, show, …}
  const newSlots = Array.isArray(imported) ? imported : imported.slots;
  if (!Array.isArray(newSlots)) return { ok: false, text: "Darin steckt keine Konfiguration." };
  if (ask && !confirm("Einstellungen übernehmen? Kacheln und Einstellungen dieses Geräts werden ersetzt.")) {
    return { ok: false, text: "Abgebrochen." };
  }
  slots = newSlots.slice(0, MAX_SLOTS);
  while (slots.length < BASE_SLOTS) slots.push(null);
  saveSlots();
  if (imported.show) {
    for (const c of CATS) if (typeof imported.show[c] === "boolean") settings.show[c] = imported.show[c];
    // Links aus älteren Fassungen kennen nur die zusammengefasste Kategorie
    if (typeof imported.show.utram === "boolean") {
      if (typeof imported.show.ubahn !== "boolean") settings.show.ubahn = imported.show.utram;
      if (typeof imported.show.tram !== "boolean") settings.show.tram = imported.show.utram;
    }
    const n = Number.isFinite(imported.cols) ? imported.cols : imported.rows;
    if (Number.isFinite(n)) settings.cols = Math.min(7, Math.max(3, Math.round(n)));
    if (Number.isFinite(imported.fill)) settings.fill = Math.min(90, Math.max(40, Math.round(imported.fill / 5) * 5));
    if (imported.connect === "tap" || imported.connect === "hybrid") settings.connectMode = imported.connect;
    for (const k of ["lastArrival", "nightFrom", "nightTo"]) {
      if (typeof imported[k] === "string" && /^\d{2}:\d{2}$/.test(imported[k])) settings[k] = imported[k];
    }
    if (Number.isFinite(imported.nightWait)) settings.nightWait = Math.min(240, Math.max(5, Math.round(imported.nightWait)));
    if (Number.isFinite(imported.xferLevel)) settings.xferLevel = Math.min(3, Math.max(0, Math.round(imported.xferLevel)));
    else if (Number.isFinite(imported.xferExtra)) settings.xferLevel = imported.xferExtra >= 10 ? 3 : imported.xferExtra >= 6 ? 2 : imported.xferExtra >= 1 ? 1 : 0;
    saveSettings();
  }
  const n = slots.filter(Boolean).length;
  return { ok: true, text: `✓ ${n} Kachel${n === 1 ? "" : "n"}${imported.show ? " samt Einstellungen" : ""} übernommen.` };
}

function maybeImportConfig() {
  if (!location.hash.startsWith("#cfg=")) return;
  const res = applyConfig(location.hash.slice(5), { ask: true });
  if (res.text && res.text !== "Abgebrochen.") alert(res.text);
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
/* Zeitdarstellung nach Datenlage:
   - ohne Echtzeitdaten → neutral grau (es ist nur der Sollfahrplan)
   - Echtzeit bestätigt und pünktlich → grün
   - Echtzeit mit Verspätung → Sollzeit grau durchgestrichen, Ist-Zeit rot
   Der Unterschied ist wichtig: „+0“ aus reinen Plandaten heißt nur
   „nichts Gegenteiliges bekannt“, nicht „bestätigt pünktlich“. */
function timeWithDelay(scheduledIso, actualIso, realTime) {
  const d = diffMin(scheduledIso, actualIso);
  if (!realTime) return `<span class="t-plan">${fmtTime(actualIso || scheduledIso)}</span>`;
  if (d !== 0) {
    const cls = d > 0 ? "bad" : "ok";
    return `<span class="old-time">${fmtTime(scheduledIso)}</span>` +
      `<span class="t-real ${cls}">${fmtTime(actualIso)}</span>`;
  }
  return `<span class="t-real ok">${fmtTime(actualIso || scheduledIso)}</span>`;
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------------- Start ---------------- */

// Hilfe liegt in den Einstellungen; der Dialog legt sich über den offenen ⚙-Dialog
byId("btn-help").addEventListener("click", () => byId("help-dialog").showModal());
byId("btn-legal").addEventListener("click", () => byId("legal-dialog").showModal());

/* Betreff und Version gleich mitgeben: Eine Fehlermeldung ohne Versionsnummer
   kostet immer eine Rückfrage. */
byId("btn-contact").addEventListener("click", () => {
  const betreff = encodeURIComponent(`PendelPanda ${APP_VERSION} (${PP.kind})`);
  const url = `mailto:${KONTAKT_MAIL}?subject=${betreff}`;
  /* Nativ über den AppLauncher (Intent — findet die Mail-App), im Browser über
     die Adresse selbst. `window.open` hinterlässt für mailto in manchen Browsern
     ein leeres Fenster. */
  if (PP.native) PP.openExternal(url); else location.href = url;
});

if (IMPRESSUM.name) {
  byId("btn-imprint").hidden = false;
  byId("btn-imprint").addEventListener("click", () => {
    const zeilen = [IMPRESSUM.name, IMPRESSUM.strasse, IMPRESSUM.ort].filter(Boolean);
    byId("imprint-body").textContent = zeilen.concat(["", KONTAKT_MAIL]).join("\n");
    byId("imprint-dialog").showModal();
  });
}
byId("app-version").textContent = `v${APP_VERSION} · ${PP.kind}`;

/* --- Einstellungs-Dialog --- */

byId("btn-settings").addEventListener("click", () => {
  document.querySelectorAll("#settings-cats input").forEach(cb => {
    cb.checked = settings.show[cb.dataset.cat];
  });
  refreshTileOpts();
  renderColsControl();
  byId("set-fill").value = settings.fill;
  byId("set-fill-val").textContent = `${settings.fill}\u00a0%`;
  byId("set-lastarr").value = settings.lastArrival;
  byId("set-nightfrom").value = settings.nightFrom;
  byId("set-nightto").value = settings.nightTo;
  byId("set-nightwait").value = settings.nightWait;
  byId("set-xfer").value = settings.xferLevel;
  byId("set-xfer-val").textContent = XFER_LEVELS[settings.xferLevel].label;
  byId("settings-dialog").showModal();
});

let gridSettingsDirty = false;

function renderColsControl() {
  const idx = [3, 4, 5, 6, 7].indexOf(settings.cols);
  byId("set-cols").dataset.idx = idx >= 0 ? idx : 0;
  document.querySelectorAll("#set-cols button").forEach(b =>
    b.classList.toggle("active", Number(b.dataset.cols) === settings.cols));
}

/* Diese Einstellungen ändern die ANFRAGE oder die Auswahl der letzten
   Verbindung — eine bereits geladene Trefferliste passt danach nicht mehr
   dazu. Deshalb wird bei offenen Ergebnissen frisch gesucht statt nur neu
   gezeichnet; ein halb altes, halb neues Ergebnis wäre schlimmer als warten. */
function applySearchSetting() {
  saveSettings();
  if (app.search && document.body.dataset.view === "results") startSearch(app.search.from, app.search.to);
}

byId("set-lastarr").addEventListener("change", (e) => {
  if (!/^\d{2}:\d{2}$/.test(e.target.value)) return;
  settings.lastArrival = e.target.value;
  applySearchSetting();
});
for (const [id, key] of [["set-nightfrom", "nightFrom"], ["set-nightto", "nightTo"]]) {
  byId(id).addEventListener("change", (e) => {
    if (!/^\d{2}:\d{2}$/.test(e.target.value)) return;
    settings[key] = e.target.value;
    applySearchSetting();
  });
}
byId("set-nightwait").addEventListener("change", (e) => {
  const v = Number(e.target.value);
  if (!Number.isFinite(v)) return;
  settings.nightWait = Math.min(240, Math.max(5, Math.round(v)));
  e.target.value = settings.nightWait;
  applySearchSetting();
});
byId("set-xfer").addEventListener("input", (e) => {
  settings.xferLevel = Math.min(3, Math.max(0, Number(e.target.value) || 0));
  byId("set-xfer-val").textContent = XFER_LEVELS[settings.xferLevel].label;
});
byId("set-xfer").addEventListener("change", applySearchSetting);

byId("set-fill").addEventListener("input", (e) => {
  settings.fill = Number(e.target.value);
  byId("set-fill-val").textContent = `${settings.fill}\u00a0%`;
  saveSettings();
  // sofort sichtbar machen: neuer Zoom gilt für die laufende Ansicht
  if (app.viewMode === "graph" && tl.itins.length) {
    tl.lastZoomIdx = null;
    renderResults();
  }
});

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
// Beim Start immer sauber in der Übersicht beginnen: ein übrig gebliebener
// Anker (etwa „#results“ nach einem Neuladen) würde sonst die spätere
// Navigation blockieren.
if (location.hash) history.replaceState(null, "", location.pathname + location.search);
renderGrid();
showView("grid");

/* Selbstheilung gegen veraltete Stände: aktiv nach Updates suchen (beim Start
   und stündlich) und einmalig neu laden, sobald ein neuer Service Worker
   übernimmt. Ohne das blieb eine installierte App auf einem alten Stand
   hängen, weil sie beim Wiederöffnen gar nicht neu lädt. */
if (!PP.native && "serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("sw.js").then(reg => {
    reg.update().catch(() => {});
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  }).catch(() => {});
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}
