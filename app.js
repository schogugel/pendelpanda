"use strict";

const API = "https://api.transitous.org/api/v1";
// Optional: URL des deployten db-link-workers (siehe README, Ordner db-link-worker/).
// Wenn gesetzt, öffnet „Bei der DB öffnen“ exakt die gewählte Verbindung (vbid-Link,
// öffnet auf dem Handy den DB Navigator mit „Zu meinen Reisen hinzufügen“).
// Leer = Fallback auf die vorbefüllte bahn.de-Suche.
const DB_LINK_PROXY = "";
const SLOT_COUNT = 12;
const STORAGE_KEY = "pp.buttons.v1";
const LONGPRESS_MS = 550;

/* ---------------- Zustand ---------------- */

let slots = loadSlots(); // Array(12) aus {name, id} | null
const app = {
  selectedStart: null,   // Slot-Index
  editSlot: null,        // Slot-Index in Bearbeitung
  editMode: false,       // „✎ Bearbeiten“ aktiv
  search: null,          // {from, to, offsetMin}
  itins: [],             // geladene Verbindungen (inkl. „Später“-Seiten)
  nextPageCursor: null,
  viewMode: localStorage.getItem("pp.view") || "graph", // "graph" | "list"
};

function loadSlots() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    const arr = Array.isArray(raw) ? raw.slice(0, SLOT_COUNT) : [];
    while (arr.length < SLOT_COUNT) arr.push(null);
    return arr;
  } catch { return new Array(SLOT_COUNT).fill(null); }
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
    attachTapAndHold(btn,
      () => onSlotTap(i),
      () => { if (slots[i]) openEdit(i); });
    gridEl.appendChild(btn);
  });
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
    startSearch(from, to);
  }
}

function setEditMode(on) {
  app.editMode = on;
  app.selectedStart = null;
  byId("btn-editmode").textContent = on ? "✓ Fertig" : "✎ Bearbeiten";
  byId("grid-hint").innerHTML = on
    ? "Button antippen, um ihn zu ändern oder zu leeren."
    : "Tippe auf <strong>Start</strong>, dann auf <strong>Ziel</strong>.";
  gridEl.classList.toggle("editing", on);
  renderGrid();
}
byId("btn-editmode").addEventListener("click", () => setEditMode(!app.editMode));

// Tap vs. Long-Press ohne jQuery Mobile
function attachTapAndHold(el, onTap, onHold) {
  let timer = null, held = false;
  el.addEventListener("pointerdown", () => {
    held = false;
    timer = setTimeout(() => { held = true; if (navigator.vibrate) navigator.vibrate(60); onHold(); }, LONGPRESS_MS);
  });
  const cancel = () => { clearTimeout(timer); };
  el.addEventListener("pointerup", cancel);
  el.addEventListener("pointerleave", cancel);
  el.addEventListener("pointercancel", cancel);
  el.addEventListener("click", (e) => { e.preventDefault(); if (!held) onTap(); });
  el.addEventListener("contextmenu", (e) => e.preventDefault());
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
const laterBtn = byId("btn-later");

function startSearch(from, to, offsetMin = 0) {
  app.search = { from, to, offsetMin };
  app.itins = [];
  byId("results-title").textContent = `${from.name} → ${to.name}`;
  document.querySelectorAll("#timechips .chip").forEach(c =>
    c.classList.toggle("active", Number(c.dataset.offset) === offsetMin));
  navigate("results");
  runPlan();
}

byId("timechips").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip || !app.search) return;
  startSearch(app.search.from, app.search.to, Number(chip.dataset.offset));
});

byId("btn-swap").addEventListener("click", () => {
  if (app.search) startSearch(app.search.to, app.search.from, app.search.offsetMin);
});

laterBtn.addEventListener("click", () => runPlan(app.nextPageCursor));

async function runPlan(pageCursor = null) {
  const { from, to, offsetMin } = app.search;
  if (!pageCursor) {
    const msg = `<p class="status">Suche Verbindungen …</p>`;
    resultsList.innerHTML = msg;
    byId("timeline").innerHTML = msg;
    laterBtn.hidden = true;
  } else {
    laterBtn.disabled = true;
    laterBtn.textContent = "Lade …";
  }
  const time = new Date(Date.now() + offsetMin * 60000).toISOString();
  const params = new URLSearchParams({
    fromPlace: from.id,
    toPlace: to.id,
    time,
    numItineraries: "6",
    language: "de",
  });
  if (pageCursor) params.set("pageCursor", pageCursor);
  try {
    const res = await fetch(`${API}/plan?${params}`);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const fresh = data.itineraries || [];
    app.itins = pageCursor ? app.itins.concat(fresh) : fresh;
    app.nextPageCursor = data.nextPageCursor || null;
    renderResults();
    laterBtn.hidden = !app.nextPageCursor;
    laterBtn.disabled = false;
    laterBtn.textContent = "Spätere Verbindungen ↓";
  } catch (e) {
    if (!pageCursor) {
      const msg = `<p class="status error">Konnte keine Verbindungen laden (${escapeHtml(e.message)}). Nochmal versuchen?</p>`;
      resultsList.innerHTML = msg;
      byId("timeline").innerHTML = msg;
    }
    laterBtn.disabled = false;
    laterBtn.textContent = pageCursor ? "Fehler – nochmal versuchen" : "Spätere Verbindungen ↓";
  }
}

function renderResults() {
  const graph = app.viewMode === "graph";
  byId("timeline-wrap").hidden = !graph;
  resultsList.hidden = graph;
  const toggle = byId("btn-viewmode");
  toggle.textContent = graph ? "☰" : "▦";
  toggle.title = graph ? "Als Liste anzeigen" : "Als Grafik anzeigen";
  if (!app.itins.length) {
    const msg = `<p class="status">Keine Verbindungen gefunden.</p>`;
    if (graph) byId("timeline").innerHTML = msg; else resultsList.innerHTML = msg;
    byId("tl-legend").innerHTML = "";
    return;
  }
  if (graph) {
    renderTimeline(app.itins);
  } else {
    resultsList.innerHTML = "";
    renderItineraries(app.itins);
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
    const cancelled = it.legs.some(l => l.cancelled);
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
      <span class="leg-line">${escapeHtml(l.routeShortName || l.displayName || "")} → ${escapeHtml(l.headsign || l.to.name)}${l.cancelled ? ` <span class="cancelled-label">Fällt aus</span>` : ""}</span>
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
  const cfg = btoa(unescape(encodeURIComponent(JSON.stringify(slots))));
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
    if (Array.isArray(imported) && confirm("Buttons übernehmen? Die im Link gespeicherten Bahnhofs-Buttons ersetzen deine aktuellen.")) {
      slots = imported.slice(0, SLOT_COUNT);
      while (slots.length < SLOT_COUNT) slots.push(null);
      saveSlots();
      alert(`${slots.filter(Boolean).length} Buttons übernommen.`);
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

maybeImportConfig();
renderGrid();
showView("grid");

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
