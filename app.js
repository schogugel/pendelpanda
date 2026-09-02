"use strict";

/* App-Version — einzige Quelle der Wahrheit.
   Bei JEDER Änderung erhöhen (PATCH = Fix/Detail, MINOR = neue Funktion,
   MAJOR = grundlegender Umbau) und `CACHE` in sw.js gleichlautend mitziehen. */
const APP_VERSION = "1.71.0";

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
  /* Geblättert wird über den ABGEDECKTEN ZEITRAUM, nicht über Cursor — siehe
     fetchPage. `spanFrom`/`spanTo` sind die Ränder dessen, was lückenlos
     geladen ist; `winLater`/`winEarlier` das jeweils nächste Zeitfenster. */
  /* Alle vier werden je Suche in `startFreshSearch` belegt. Hier bewusst KEIN
     Verweis auf die Fenster-Konstanten: Dieses Objekt wird beim Laden der Datei
     ausgewertet, die Konstanten stehen weiter unten — ein `const` vor seiner
     Deklaration zu benutzen bricht die ganze Datei ab (siehe CLAUDE.md). */
  spanFrom: null,
  spanTo: null,
  winLater: null,
  winEarlier: null,
  endLater: false,
  endEarlier: false,
  viewMode: localStorage.getItem("pp.view") || "graph", // "graph" | "list"
  /* Ob langsamere Verbindungen ausgeblendet sind, wird GERÄTEWEIT gemerkt —
     wie die Listen-/Grafikansicht, nicht wie eine Einstellung.

     Bewusst NICHT in `settings` und damit nicht im Übertragungslink: Der Link
     gibt Kacheln und Vorlieben weiter, nicht den Zustand, in dem man die App
     gerade zufällig verlassen hat. Sonst schleppte man beim Teilen einen
     Anzeigefilter mit, den der andere nie gewählt hat.

     Voreinstellung beim allerersten Öffnen: AN. Für den ersten Eindruck ist
     das Gedränge aus dominierten Doppelungen das schlechtere Bild. */
  hideDominated: localStorage.getItem("pp.fastonly") !== "0",
  // Zeitnavigation: kind = now | custom | letzte
  searchTime: { kind: "now", time: null, arriveBy: false },
  planAbort: null,        // bricht die Anfragen einer überholten Suche ab
  hiddenCats: new Set(),  // aktuell über die Legende ausgeblendete Kategorien
  emptyCats: new Set(),   // Kategorien, für die eine eigene Anfrage nichts brachte
  refilling: false,       // Nachladen läuft — Legende solange gesperrt
  autoLoads: 0,           // automatische Nachlade-Runden pro Suche
};

/* ---------------- Einstellungen (Standard-Verkehrsmittel) ---------------- */

const CATS = ["fern", "regio", "sbahn", "ubahn", "tram", "bus", "sonstige", "fernbus"];
// Vor dieser Kategorie bricht die Legende um → 3 Felder oben, 5 unten
const LEGEND_BREAK = 3;
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

/* Standardwerte für „Zoom der Balken“ an EINER Stelle. Der Zurücksetzen-Knopf im
   Dialog stellt genau diese wieder her — stünden sie zweimal da, liefen sie mit
   der ersten Änderung auseinander und der Knopf machte etwas anderes als „wie
   ausgeliefert“. Muss VOR `loadSettings()` stehen, sonst wirft die Datei beim
   Laden (siehe CLAUDE.md, `const` vor seiner Deklaration).

   20 / 70 statt 50 / 90: Die Untergrenze ist das ZIEL des normalen Zooms, und
   50 % war dafür zu satt — auf Stadtstrecken füllte die vorderste Verbindung
   den halben Schirm, während von den folgenden kaum etwas übrig blieb. Mit 20
   bleibt der Blick auf dem, was danach kommt, und „Freifläche unten nutzen“
   holt bis 70 % heran, wo tatsächlich Platz frei ist. Die 90 % oben waren
   nahezu bildfüllend und damit selten das, was jemand wollte. */
const ZOOM_DEFAULTS = { fillMin: 20, fillMax: 70, fitBottom: true };

function loadSettings() {
  // Default: Deutschlandticket-Sicht — Fernverkehr aus, Rest an
  const def = {
    // D-Ticket-Sicht: Fernzug UND Fernbus standardmäßig aus
    show: { fern: false, regio: true, sbahn: true, ubahn: true, tram: true,
            bus: true, sonstige: true, fernbus: false },
    cols: 5,      // Verbindungen nebeneinander in der Grafik (3–7)
    /* SPANNE statt fester Größe (v1.68.0). Ein fester Wert nagelt die vorderste
       Verbindung auf genau diese Höhe — „Freifläche unten nutzen“ konnte danach
       nur noch in dem schmalen Rest wirken, den die Auslösegrenze übrig ließ.
       Mit einer Spanne ist `fillMin` das Ziel des normalen Zooms und `fillMax`
       die Decke, bis zu der die Freiflächen-Nachbearbeitung aufziehen darf.
       Beide gleich gesetzt ergibt exakt das alte Verhalten.
       Grenzen bewusst weit (20–95): Die brauchbare Spanne wird erst am Gerät
       ermittelt, danach werden sie enger gezogen. */
    /* fillMin = % der Bildhöhe, die die vorderste Verbindung MINDESTENS einnimmt,
       fillMax = … und HÖCHSTENS mit „Freifläche unten nutzen“, fitBottom = der
       Schalter dazu. Werte in `ZOOM_DEFAULTS`, siehe oben. */
    ...ZOOM_DEFAULTS,
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
    /* Altbestand: ein einzelner `fill`-Wert wird zur Untergrenze, die Obergrenze
       bekommt den Standard. Wer die Spanne nicht will, zieht sie wieder zu. */
    const klemmFill = v => Math.min(95, Math.max(20, Math.round(v / 5) * 5));
    if (Number.isFinite(s?.fill)) { def.fillMin = klemmFill(s.fill); def.fillMax = Math.max(def.fillMin, 90); }
    if (Number.isFinite(s?.fillMin)) def.fillMin = klemmFill(s.fillMin);
    if (Number.isFinite(s?.fillMax)) def.fillMax = klemmFill(s.fillMax);
    if (def.fillMax < def.fillMin) def.fillMax = def.fillMin;
    /* `fitBottom` wurde von Anfang an geschrieben, aber nie zurückgelesen — der
       Schalter sprang bei jedem Neustart auf den Standard zurück. Fiel nicht
       auf, solange der Standard AUS war und man ihn nur zum Ausprobieren
       anschaltete; seit er AN ist, ließe sich das Abschalten nicht merken. */
    if (typeof s?.fitBottom === "boolean") def.fitBottom = s.fitBottom;
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
  // Die Ergebnisansicht verlassen heißt: Die Grafik hat nichts mehr zu tun.
  if (document.body.dataset.view === "results" && name !== "results") tlStop();
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
  planeTileFont();
}

/* ---------------- Kachelbeschriftung: EINE Größe für alle ----------------

   Eine feste Schriftgröße muss sich am längsten Namen orientieren und ist damit
   für „Zuhause“ zu klein — oder sie passt für „Zuhause“ und schneidet „Bochum
   Ruhr-Universität“ ab. Beides war schon da.

   Deshalb wird gemessen: Für jeden Namen wird die größte Schrift gesucht, bei
   der er in höchstens DREI Zeilen und in die Kachel passt; die kleinste dieser
   Größen gilt dann für ALLE Kacheln. Unterschiedliche Größen nebeneinander
   sähen aus wie ein Fehler — das Raster ist eine Tafel, keine Sammlung.

   Gemessen wird an einem unsichtbaren Doppel, nicht an den echten Kacheln: Jede
   Größenänderung an einer sichtbaren Kachel erzwingt einen Umbruch des ganzen
   Rasters, und davon gäbe es hier Dutzende hintereinander.

   Die Schleife läuft nur ABWÄRTS und über alle Namen zusammen — ist die Größe
   für einen Namen einmal gefallen, startet der nächste dort. Kleiner passt
   immer, wenn größer schon passte, also ist das Ergebnis dasselbe wie bei einer
   Einzelsuche je Name, kostet aber einen Bruchteil. */
const TILE_FONT = { max: 22, min: 12, step: 0.5, zeilen: 3 };
let tileProbe = null, tileFitKey = null, tileFitPending = false;

function tileFontProbe() {
  if (tileProbe) return tileProbe;
  tileProbe = document.createElement("div");
  tileProbe.setAttribute("aria-hidden", "true");
  tileProbe.style.cssText = "position:absolute;left:-9999px;top:0;visibility:hidden;" +
    "white-space:normal;overflow-wrap:anywhere;text-align:center;padding:0;margin:0;";
  document.body.appendChild(tileProbe);
  return tileProbe;
}

/* Einmal je Bild statt bei jedem `renderGrid` — das läuft auch beim bloßen
   Markieren einer Startkachel, und daran ändert sich keine Schriftgröße. */
function planeTileFont() {
  if (tileFitPending) return;
  tileFitPending = true;
  requestAnimationFrame(() => { tileFitPending = false; fitTileFont(); });
}

function fitTileFont() {
  const btn = gridEl.querySelector(".stationbtn");
  const muster = gridEl.querySelector(".tile-name");
  if (!btn || !muster) return;
  const namen = slots.filter(Boolean).map(sl => sl.label || sl.name);
  if (!namen.length) return;

  const cs = getComputedStyle(btn);
  const innenW = btn.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  /* Nur im scrollfreien Raster ist die Höhe fest. Bei mehr als 14 Kacheln
     wächst die Zeile mit ihrem Inhalt — dort würde eine Höhenprüfung sich
     selbst ins Ergebnis rechnen, also bindet dort allein die Zeilenzahl. */
  const fest = document.body.classList.contains("fitgrid");
  const innenH = fest ? btn.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) : Infinity;
  if (!(innenW > 0)) return;

  const key = `${Math.round(innenW)}|${Math.round(innenH)}|${namen.join("\u0001")}`;
  if (key === tileFitKey) return;   // nichts hat sich geändert

  const ns = getComputedStyle(muster);
  const lh = parseFloat(ns.lineHeight) / parseFloat(ns.fontSize) || 1.1;
  const p = tileFontProbe();
  p.style.width = innenW + "px";
  p.style.fontFamily = ns.fontFamily;
  p.style.fontWeight = ns.fontWeight;
  p.style.letterSpacing = ns.letterSpacing;
  p.style.lineHeight = String(lh);

  let size = TILE_FONT.max;
  for (const n of namen) {
    p.textContent = n;
    while (size > TILE_FONT.min) {
      p.style.fontSize = size + "px";
      const h = p.scrollHeight;
      const zeilen = Math.max(1, Math.round(h / (size * lh)));
      if (zeilen <= TILE_FONT.zeilen && h <= innenH) break;
      size -= TILE_FONT.step;
    }
    if (size <= TILE_FONT.min) break;   // tiefer geht es nicht, der Rest ändert nichts
  }
  tileFitKey = key;
  gridEl.style.setProperty("--tile-font", size + "px");
}

/* Drehen und Fenstergrößen ändern die Kachelmaße — dann neu messen. Der
   Schlüssel oben verhindert, dass dabei etwas passiert, wenn sich nichts
   geändert hat. */
let tileFitTimer = null;
addEventListener("resize", () => {
  clearTimeout(tileFitTimer);
  tileFitTimer = setTimeout(() => { tileFitKey = null; fitTileFont(); }, 120);
});
/* Vor dem Laden der Schrift misst der Browser mit einer Ersatzschrift, und die
   ist anders breit — ohne das stünde die Größe nach dem Schriftwechsel falsch. */
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => { tileFitKey = null; fitTileFont(); });
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
  byId("grid-hint").innerHTML = on ? HINT_EDIT : HINT_GRID;
  gridEl.classList.toggle("editing", on);
  renderGrid();
}
byId("btn-editmode").addEventListener("click", () => setEditMode(!app.editMode));

/* Die Bedienzeile über dem Grid. `HINT_GRID` steht WORTGLEICH auch in
   index.html — dort für den ersten Aufbau, bevor JavaScript läuft, sonst
   blitzt die Zeile leer auf. Wer den Text ändert, ändert ihn an beiden
   Stellen; getrennt gepflegt liefen sie schon einmal auseinander.

   „Lange drücken“ steht BEWUSST ohne <strong>: `.hint strong` setzt Versalien
   mit Sperrung, und damit brauchte die Zeile auf 360 px eine dritte Zeile
   (gemessen 51 statt 34 px). Die geht dem Raster verloren, und die letzte
   Kachelreihe wird sichtbar gequetscht. So bleibt es bei zwei Zeilen — der
   Hinweis kostet also gar nichts. */
const HINT_GRID = "Tippe <strong>Start</strong>, dann <strong>Ziel</strong> – oder wische von Start zu Ziel. Lange drücken: ab eigenem Standort.";
const HINT_EDIT = "Antippen zum Ändern/Leeren – ziehen zum Verschieben.";

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
      if (!slots[i]) return;
      /* Im Bearbeiten-Modus bleibt der lange Druck beim Bearbeiten — dort ist
         eine Suche das Letzte, was jemand will. Außerhalb heißt er seit
         v1.64.0: von meinem Standort dorthin. Das Bearbeiten war hier eine
         zweite Tür zu etwas, das der Knopf „✎ Bearbeiten“ schon anbietet;
         diese Geste kann etwas leisten, das sonst gar nicht geht. */
      if (app.editMode) openEdit(i);
      else searchFromHere(i);
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
  byId("full-row").hidden = !slot;
  byId("edit-full").checked = !!(slot && slot.full);
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
    ...(station.city ? { city: station.city } : {}),
    ...(v && v !== station.name ? { label: v } : {}),
    ...(byId("edit-full").checked ? { full: true } : {}),
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
      /* Den Ort mitnehmen: Transitous nennt Nahverkehrshalte oft nur beim
         nackten Namen („Klinikum“). Für den DB-Link braucht es die Schreibweise
         der DB („Klinikum, Regensburg“) — sonst steht im Suchfeld drüben ein
         Wort, das es hundertfach gibt. Siehe dbPlaceId(). */
      app.pendingStation = { name: s.name, id: s.id, lat: s.lat, lon: s.lon,
                             city: area ? area.name : null };
      stationInput.hidden = true;
      suggestionsEl.innerHTML = "";
      byId("edit-current").hidden = false;
      byId("edit-current").textContent = s.name;
      byId("label-row").hidden = false;
      byId("labelinput").value = "";
      byId("full-row").hidden = false;
      byId("edit-full").checked = false;
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
  /* Kacheln aus der Zeit vor den Koordinaten einmalig nachrüsten — der DB-Link
     braucht sie, sonst steht dort nur ein Name (siehe dbPlaceId). `coordsOf`
     kehrt sofort zurück, wenn die Kachel sie schon hat, kostet also im
     Normalfall nichts. Bewusst nebenher: Die Suche darf nicht darauf warten. */
  coordsOf(from); coordsOf(to);
  app.itins = [];
  app.autoLoads = 0;
  app.emptyReason = null;
  app.diagnosing = false;
  app.aroundTried = false;
  app.aroundUsed = false;
  app.aroundPlaces = null;
  /* Laufende Anfragen der VORHERIGEN Suche abbrechen. Ohne das laufen sie
     weiter, verbrauchen weiter vom Anfragebudget und können obendrein ihr
     Ergebnis in den frischen Pool schreiben. Gemessen drosselt Transitous ab
     etwa der zwölften Anfrage in kurzer Folge auf konstante 3 Sekunden — wer
     ein paar Strecken schnell durchprobiert, erreicht das mühelos, wenn jede
     Suche ihre Anfragen zu Ende laufen lässt. */
  if (app.planAbort) app.planAbort.abort();
  app.planAbort = new AbortController();
  app.searchTag = (app.searchTag || 0) + 1;
  app.focusKey = null;       // die gesuchte Verbindung wird je Suche EINMAL bestimmt
  app.emptyCats = new Set(); // je Suche neu belegen: was nachweislich nicht fährt
  app.planLog = [];          // Antwortzeiten der laufenden Suche (Aufklapper)
  app.leerFrueher = 0;       // wie oft eine Blätterseite gar nichts brachte
  app.leerSpaeter = 0;
  app.spanFrom = app.spanTo = null;   // abgedeckter Zeitraum, je Suche neu
  app.winLater = app.winEarlier = PAGE_WIN_MIN;
  app.endEarlier = app.endLater = false;
  byId("rhead-from").textContent = from.label || from.name;
  byId("rhead-to").textContent = to.label || to.name;
  updateChips();
  navigate("results");
  /* Bewusst KEINE größere Erstanfrage bei „Letzte“: nachgemessen bringt sie
     nichts. Eine Ankunftssuche liefert bei höherem `numItineraries` weitere
     FRÜHERE Verbindungen, nicht spätere — der Kontext hinter der letzten
     Verbindung muss so oder so einmal nachgeladen werden. */
  runPlan();
}

function updateChips() {
  const f = byId("btn-fast");
  f.classList.toggle("active", !!app.hideDominated);
  f.disabled = !app.itins.length;
  f.title = app.hideDominated
    ? "Langsamere Verbindungen sind ausgeblendet – antippen zeigt wieder alle"
    : "Nur die besten Verbindungen zeigen – langsamere ausblenden";
  const b = byId("btn-full");
  const fertig = app.fullLoaded === app.searchTag;
  b.classList.toggle("active", fertig);
  b.disabled = fertig || !app.itins.length;
  b.title = fertig ? "Alle Verkehrsmittel wurden für diese Suche geladen"
    : "Alle Verbindungen laden – eine Anfrage je Verkehrsmittel";
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
  if (direction === "earlier" ? app.endEarlier : app.endLater) return;
  if (app.spanFrom == null || app.spanTo == null) return;
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
  updateLagHint();   // Abzeichen zusammen mit dem Ladekreis
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

/* Zurück zur Abfahrtstafel über den Streckennamen. Bewusst über `navigate`
   und nicht direkt: Damit läuft es über denselben Weg wie die Zurück-Geste
   des Systems, und der Anker in der Adresse bleibt in Ordnung. */
// Beide Stationsnamen führen zurück — links wie rechts, je nachdem, wo man tippt
for (const id of ["results-title", "results-title-to"]) {
  byId(id).addEventListener("click", () => navigate("grid"));
}

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
/* Seitengröße. 10 war zu wenig: Was eine Seite an ZEIT abdeckt, hängt völlig
   von der Strecke ab — gemessen 30 Minuten zwischen München Hbf und Ost, aber
   285 Minuten zwischen Nürnberg und Bayreuth. In der Stadt sah man dadurch
   deutlich weniger als in der DB-App, obwohl keine Halte fehlten. */
/* Geblättert wird nach ZEITFENSTER, nicht nach Trefferzahl.

   Der Unterschied ist keine Feinheit, sondern die Ursache verschluckter
   Verbindungen: Mit `numItineraries` dehnt der Router sein Fenster so lange
   aus, bis er so viele Pareto-optimale Ergebnisse beisammen hat. Gemessen an
   Regensburg → Nürnberg deckte EINE Seite damit 900 Minuten ab — und die
   Folgeseiten kamen nicht einmal der Reihe nach:

     Seite 0: Fr 12:45–03:45
     Seite 1: Sa 04:20–13:58   ← einen Tag vorwärts gesprungen
     Seite 2: Fr 14:45–Sa 04:20 ← wieder zurück

   Beim Scrollen sah man deshalb nach 17:48 unvermittelt den nächsten Morgen,
   samt zweitem Tagesstrich, und erst nach weiterem Hin und Her tauchten die
   Abendzüge auf. Mit festem Fenster schließen die Seiten lückenlos an:
   12:45–15:48, 16:45–17:48, 18:45–19:48, 20:45–21:49, 22:45–00:24.

   Drei Stunden sind gemessen der richtige Schnitt. Pro Minute Abdeckung kostet
   das genauso viel wie bisher (dicht: 1,65 gegen 1,66 KB/min), bei sechs
   Stunden stieg eine Anfrage auf der dichtesten Strecke aber auf 399 KB und
   905 ms. `numItineraries` muss dabei auf 1 stehen — sonst dehnt der Router
   das Fenster doch wieder aus. `maxItineraries` ist nur ein Sicherheitsnetz für
   sehr dichte Takte; wird dabei abgeschnitten, macht der Cursor an derselben
   Stelle weiter, es entsteht keine Lücke. */
/* Fenster der ERSTEN Anfrage. NEUN Stunden, nicht sechs — und der Grund dafür
   ist, dass „Jetzt“ seit v1.56.0 keinen Kontext mehr rückwärts holt (siehe
   `loadContext`). Die dort gesparte Anfrage geht in ZUKUNFT, und zwar ohne eine
   weitere Anfrage: Ein breiteres Fenster ist derselbe Aufruf.

   Neun ist gemessen die Kante, an der es kippt. An fünf Strecken, je 6/9/12 h,
   nachts und im Berufsverkehr — Treffer der ersten Anfrage:

     München Hbf → Ost      60 / 60 / 60     Deckel bindet ab 6 h
     Nürnberg → Fürth       53 / 60 / 60     Deckel bindet ab 9 h
     Regensburg → Nürnberg  13 / 19 / 24
     Hamburg → Berlin        7 / 10 / 15
     Nürnberg → Bayreuth    16 / 23 / 33

   Wo der Deckel bindet, ist ab neun Stunden nichts mehr zu holen — dieselben
   60 Treffer, dieselben 392 KB, nur längere Rechenzeit (München 908 → 1028 →
   1393 ms). Zwölf Stunden bezahlen also auf den dichten Strecken +36 % Wartezeit
   für exakt null zusätzliche Verbindungen. Auf den dünnen bringen sie etwas,
   aber dort steigen auch Bytes und Zeit überproportional (Bayreuth 154 → 222 KB,
   334 → 472 ms). Neun nimmt fast den ganzen Nutzen zu einem Drittel der Kosten.

   In der Stadt ändert sich weiterhin fast nichts — dort bindet `PAGE_MAX` und
   nicht die Zeit. */
const PAGE_WINDOW = 9 * 3600;
const PAGE_MAX = 60;            // Obergrenze je Anfrage

/* Geblättert wird über ein ZEITFENSTER, dessen Breite sich der Strecke anpasst.

   Warum nicht über den Cursor: `searchWindow` wird IGNORIERT, sobald ein
   `pageCursor` mitgeht — der Cursor trägt das Fenster der Ursprungsanfrage in
   sich. Nachgemessen liefert eine Cursor-Seite deshalb immer dieselbe magere
   Ausbeute, egal was man als Fenster mitschickt: Hamburg → Berlin viermal
   hintereinander genau ZWEI neue Verbindungen. Bei drei sichtbaren Spalten ist
   das ein Wischer, dann steht man wieder an der Wand.

   Der Ausweg ist eine frische Anfrage mit eigenem Zeitpunkt statt des Cursors.
   Gegengeprüft an sechs Strecken über je vier Schritte: Es fehlte KEINE einzige
   Verbindung, die der Cursor gefunden hätte, und die Ausbeute stieg von 2 auf
   13–15 (Hamburg), 3 auf 12–24 (Regensburg → Nürnberg), 4 auf 12–21 (Ulm).

   Dass das bezahlbar ist, hängt an einer Messung: **Die Drosselung zählt
   ANFRAGEN, nicht Bytes.** 16 Anfragen mit Drei-Stunden-Fenster (1125 KB)
   wurden ab der zwölften langsam, 16 mit Zwölf-Stunden-Fenster (2869 KB) ab der
   dreizehnten. Zweieinhalbmal so viele Daten, dieselbe Grenze. Eine Anfrage ist
   das knappe Gut, ein Kilobyte kostet praktisch nichts — also wenige große
   Anfragen statt vieler kleiner. */
const PAGE_TARGET = 20;          // angepeilte Verbindungen je Blätterschritt
const PAGE_WIN_MIN = 3 * 3600;
const PAGE_WIN_MAX = 12 * 3600;

/* Wie breit wird das nächste Fenster in dieser Richtung? Aus der DICHTE der
   letzten Antwort, damit sich die App der Strecke anpasst statt eine Zahl zu
   raten: München bleibt bei drei Stunden (dort ist der Deckel das Problem,
   nicht die Zeit), Hamburg → Berlin geht auf zwölf.
   Eine leere Antwort ergibt das größte Fenster — genau richtig, denn dahinter
   liegt eine Betriebspause, die man überspringen will. */
function nextWindow(fenster, treffer) {
  const proStunde = Math.max(treffer, 0.5) / (fenster / 3600);
  return Math.round(Math.min(PAGE_WIN_MAX,
    Math.max(PAGE_WIN_MIN, (PAGE_TARGET / proStunde) * 3600)));
}
/* Für Ankunftssuchen bleibt es bei einer Trefferzahl: Dort ist sie die
   MINDESTanzahl und bestimmt, wie viele frühere Alternativen mitkommen.

   ZWÖLF, nicht zwanzig. Was die Zahl leisten muss, ist eng umrissen: Sie muss
   die gesuchte letzte Verbindung enthalten und ein paar Spalten Kontext davor.
   Der Router liefert bei einer Ankunftssuche die SPÄTESTEN zuerst — nachgemessen
   an zehn Strecken ist die späteste Ankunft bei 6, 8, 10, 12 und 20 Treffern
   dieselbe, und `findLastDecent` wählt die letzte oder vorletzte (Rang 0 oder 1
   von hinten). Alles darüber ist Vorrat zum Zurückscrollen, und dafür gibt es
   den Cursor.

   Bezahlt wird die Zahl in Bytes, und zwar doppelt (ungefiltert + Entlastung):
   Regensburg → Neustrelitz kostete eine Anfrage 486 KB bei 20 und 257 KB bei 12,
   Regensburg → Nürnberg 158 gegen 96 KB. Auf einem Telefon im Mobilnetz ist das
   der spürbarste Teil der Wartezeit. Zwölf lässt zehn Ränge Luft über den je
   gemessenen Bedarf — Vorsicht mit Maß, nicht Knausern. */
const ARRIVE_COUNT = 12;

function planParams({ time = null, limit = PAGE_MAX, cursor = null, window = PAGE_WINDOW } = {}) {
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
    fromPlace: placeParam(from),
    toPlace: placeParam(to),
    time: baseTime.toISOString(),
    /* Bei einer ABFAHRTSSUCHE 1, nicht `limit`: Jede höhere Zahl ist eine
       MINDESTANZAHL, für die der Router sein Zeitfenster ausdehnt — genau das
       soll hier nicht passieren.

       Bei einer ANKUNFTSSUCHE dagegen bleibt es beim alten Weg. Dort meint das
       Fenster die ANKUNFTSzeit, und der Router liefert darin faktisch eine
       einzige Verbindung: die späteste, die es noch schafft. Nachgemessen an
       Regensburg → Nürnberg und → Neustrelitz brachten 3, 6 und sogar 12
       Stunden Fenster jedes Mal genau einen Treffer — richtig, aber zu wenig,
       um die Spalten davor zu füllen. Mit `numItineraries` kommen die früheren
       Alternativen mit, und genau die braucht „Letzte“ als Umfeld. */
    /* Maßgeblich ist, ob DIESE Anfrage eine Ankunftssuche ist — nicht, ob die
       Suche einmal als solche begonnen hat. Ein ausdrücklicher Zeitpunkt macht
       sie zur Abfahrtssuche (siehe `arriveBy` unten), und dann MUSS auch das
       Zeitfenster gelten.

       Ohne das `&& !time` nahm bei „Letzte“ jede Blätteranfrage weiter den
       Ankunftszweig: kein `searchWindow`, dafür `numItineraries: 12` — und der
       Router dehnte sein Fenster wieder selbst aus. Ein einziger Schritt sprang
       damit zwölf Stunden weit und ließ gemessen 392 Minuten Loch mitten im
       geladenen Bereich. Das ist derselbe Fehler, den v1.52.0 beseitigt hat,
       nur an der Stelle, die damals nicht mit umgestellt wurde. */
    ...(arriveBy && !time
      ? { numItineraries: String(Math.min(limit, ARRIVE_COUNT)) }
      : { numItineraries: "1", searchWindow: String(window), maxItineraries: String(limit) }),
    language: "de",
    withScheduledSkippedStops: "true", // auch übersprungene Halte mitnehmen
    /* Ohne Streckengeometrie und Wegbeschreibungen: Die App zeichnet keine
       Karte und liest weder das eine noch das andere. Gemessen spart das 60 %
       der Antwortgröße (168 → 67 KB) und macht die Anfrage schneller. Damit
       kosten 20 Verbindungen (133 KB) weniger als vorher 10 (168 KB).
       Gegengeprüft: kein einziges Feld fehlt, das die App verwendet. */
    detailedLegs: "false",
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
  /* Startet die Suche am eigenen Standort, ist der erste Weg IMMER ein Fußweg —
     und der darf länger sein als der Normalfall. MOTIS erlaubt voreingestellt
     15 Minuten; wer irgendwo zwischen zwei Dörfern steht, hat damit gar keine
     Verbindung. 20 Minuten sind der Kompromiss: genug für den nächsten Ort,
     nicht so viel, dass Fußwege die Ergebnisliste bestimmen. */
  if (from.here) params.set("maxPreTransitTime", "1200");
  if (to.here) params.set("maxPostTransitTime", "1200");   // nach dem Tauschen
  const xf = XFER_LEVELS[settings.xferLevel] || XFER_LEVELS[0];
  if (xf.factor !== 1) params.set("transferTimeFactor", String(xf.factor));
  if (xf.extra) params.set("additionalTransferTime", String(xf.extra));
  /* Eine Ankunftssuche mit ausdrücklicher Zeit ist beim Nachfüllen falsch:
     Dort geht es um einen Zeitraum, der bereits geladen ist. */
  if (arriveBy && !time) params.set("arriveBy", "true");
  if (cursor) params.set("pageCursor", cursor);
  return params;
}

async function fetchPage(direction, limit = PAGE_MAX, fensterFest = null) {
  const myTag = app.searchTag;
  const signal = app.planAbort?.signal;
  const frisch = direction !== "later" && direction !== "earlier";

  /* Blättern heißt: das nächste ZEITFENSTER hinter bzw. vor dem bereits
     abgedeckten Bereich holen. Ein ausdrücklicher Zeitpunkt schaltet dabei
     `arriveBy` ab (siehe planParams) — und das ist richtig so: Die Frage
     „was fährt ab hier?“ ist beim Blättern auch dann die richtige, wenn die
     Suche selbst eine Ankunftssuche war.

     `fensterFest` ist der Ausweg für Runden, die kein Blättern sind, sondern
     ein enges Stück Kontext holen (siehe `loadContext`). Ohne das erbten sie
     das dichteabhängige Blätterfenster von bis zu zwölf Stunden — und weil der
     Router im Fenster ein PRÄFIX liefert, kamen die frühesten daraus zurück
     statt der nächstgelegenen. */
  const fenster = fensterFest || (frisch ? PAGE_WINDOW
    : direction === "later" ? (app.winLater || PAGE_WIN_MIN)
    : (app.winEarlier || PAGE_WIN_MIN));
  const von = frisch ? null
    : direction === "later" ? app.spanTo
    : app.spanFrom - fenster * 1000;
  const params = planParams({ limit, time: von, window: fenster });

  /* Zweite Anfrage: entweder für die Filterung des Nutzers oder zur Entlastung
     einer erdrückenden Kategorie (siehe relievedModes) — nie beides, es bleibt
     bei höchstens zwei Anfragen je Seite. Die Entlastung sticht, weil sie den
     engeren Modus-Satz stellt und die ausgeblendeten Kategorien bereits
     berücksichtigt. Beim BLÄTTERN steht der Pool schon, die Entlastung kann
     also sofort parallel losgehen; nur die allererste Seite einer Suche kennt
     ihn noch nicht und holt sie in derselben Runde nach. */
  const modes = (frisch ? null : relievedModes()) || enabledModes();
  const t0 = performance.now();
  const filtered = modes
    ? fetch(`${API}/plan?${new URLSearchParams(params)}&transitModes=${encodeURIComponent(modes)}`, { signal })
        .then(r => (r.ok ? r.json() : null)).catch(() => null)
    : null;

  {
    const res = await fetch(`${API}/plan?${params}`, { signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    /* Verspätete Antwort einer ÜBERHOLTEN Suche verwerfen. Ohne diese Prüfung
       konnte sie den Pool der aktuellen Suche überschreiben — man sah dann
       Verbindungen der vorher gewählten Strecke. */
    if (myTag !== app.searchTag) return { added: 0, params };
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
    logPlan(direction === "later" ? "Spätere Verbindungen"
      : direction === "earlier" ? "Frühere Verbindungen"
      : modes ? "Fahrplan (ungefiltert + gefiltert)" : "Fahrplan",
      performance.now() - t0, add.length);
    /* Kommt ZWEIMAL hintereinander keine einzige Verbindung, ist in dieser
       Richtung Schluss: Der „Spätere anzeigen“-Knopf verschwindet, und die
       Ansicht sagt ehrlich, dass es hier zu Ende ist. Ohne diese Bremse fragte
       die App bei jeder Randberührung erneut, zeigte den Ladekreis und bekam
       nichts.

       Zweimal, nicht einmal: Eine einzelne leere Antwort kann eine echte
       Betriebspause sein, hinter der es weitergeht — und weil eine leere
       Antwort das Fenster auf das Maximum aufzieht (`nextWindow`), deckt der
       zweite Versuch bis zu zwölf Stunden ab. Länger als das fährt keine
       Strecke nicht. */
    const roh = (data.itineraries || []).filter(it => transitLegs(it).length);
    const leer = roh.length === 0;
    const zaehler = direction === "earlier" ? "leerFrueher" : "leerSpaeter";
    app[zaehler] = leer ? (app[zaehler] || 0) + 1 : 0;
    const amEnde = leer && app[zaehler] >= 2;

    /* Wie weit reicht das Geladene jetzt? Der Fensterrand gilt nur, wenn die
       Antwort NICHT am Deckel hing — sonst hat der Rechner mittendrin
       aufgehört, und als Grenze zählt die letzte gefundene Abfahrt. Ohne diese
       Unterscheidung entstünde genau die Lücke, die v1.52.0 beseitigt hat. */
    const deps = roh.map(depOf).filter(Number.isFinite);
    const voll = roh.length >= limit && deps.length > 0;

    if (direction === "earlier") {
      app.itins = add.concat(app.itins);
      app.endEarlier = amEnde;
      /* Bei vollem Deckel bleibt die Grenze stehen: Abgedeckt ist dann nur der
         VORDERE Teil des Fensters, der Rest dahinter wäre ein Loch. Das
         schmalere Fenster aus `nextWindow` holt ihn beim nächsten Schritt. */
      if (!voll) app.spanFrom = von;
      /* Eine Kontextrunde mit festem Fenster darf die Blätterbreite NICHT
         verstellen — sie sagt nichts über die Dichte der Strecke aus, sondern
         nur über eine einzelne Stunde. Dieselbe Regel wie beim Nachfüllen über
         die Legende: ein Seitenweg, kein Blättern. */
      if (!fensterFest) app.winEarlier = nextWindow(fenster, roh.length);
    } else if (direction === "later") {
      app.itins = app.itins.concat(add);
      app.endLater = amEnde;
      app.spanTo = voll ? Math.max(...deps) + 60000 : von + fenster * 1000;
      app.winLater = nextWindow(fenster, roh.length);
    } else {
      app.itins = add;
      app.endEarlier = app.endLater = false;
      /* Erste Seite. Bei einer ANKUNFTSSUCHE hat das Fenster eine andere
         Bedeutung (es begrenzt die Ankunft), deshalb zählt dort der tatsächlich
         gelieferte Bereich; bei einer Abfahrtssuche der angefragte. */
      const start = +new Date(params.get("time"));
      const ankunft = params.get("arriveBy") === "true";
      app.spanFrom = deps.length && (ankunft || voll) ? Math.min(...deps) : start;
      app.spanTo = ankunft ? (deps.length ? Math.max(...deps) + 60000 : start)
        : voll ? Math.max(...deps) + 60000 : start + fenster * 1000;
      /* Die Dichte am TATSÄCHLICH abgedeckten Zeitraum messen, nicht am
         angefragten Fenster: Bei einer Ankunftssuche sagt das Fenster nichts
         über die Zeitspanne der Antwort — gemessen deckten zwölf Treffer dort
         sechs Stunden ab, ein andermal zwanzig. */
      const abgedeckt = Math.max(1, (app.spanTo - app.spanFrom) / 3600000);
      app.winLater = app.winEarlier = nextWindow(abgedeckt * 3600, roh.length);
    }
    // Spalten immer chronologisch nach Abfahrt (API-Reihenfolge ist teils
    // ein Qualitäts-Ranking und würde die Kaskade der Grafik brechen)
    app.itins.sort((a, b) => depOf(a) - depOf(b));

    /* Die erste Seite einer Suche kann die Entlastung nicht vorab planen — vor
       ihr steht noch der Pool der VORHERIGEN Suche, und danach zu urteilen
       hieße, die falsche Frage zu beantworten. Also erst jetzt, mit dem
       frischen Ergebnis in der Hand, und nur wenn es tatsächlich schief liegt.
       Kostet die eine Anfrage nur auf der ersten Seite; beim Blättern läuft sie
       oben schon parallel mit. */
    let extra = 0;
    if (frisch) {
      const rel = relievedModes(app.itins);
      if (rel) {
        const tr = performance.now();
        const r = await fetch(`${API}/plan?${new URLSearchParams(params)}&transitModes=${encodeURIComponent(rel)}`, { signal })
          .then(x => (x.ok ? x.json() : null)).catch(() => null);
        if (myTag !== app.searchTag) return { added: add.length, params };
        for (const it of r?.itineraries || []) {
          const k = itKey(it);
          if (known.has(k)) continue;
          known.add(k);
          app.itins.push(it);
          extra++;
        }
        // Cursor bleiben unangetastet — die Entlastung ist ein Seitenweg,
        // kein Blättern (dieselbe Regel wie bei refillLoadedRange).
        logPlan("Verdeckte Verbindungen", performance.now() - tr, extra);
        if (extra) app.itins.sort((a, b) => depOf(a) - depOf(b));
      }
    }
    return { added: add.length + extra, params };
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
/* Beim Nachfüllen eines bereits geladenen Bereichs darf das Fenster größer
   sein: Hier geht es nicht ums Blättern, sondern darum, eine bekannte Spanne in
   wenigen Anfragen abzudecken. */
const REFILL_WINDOW = 8 * 3600;
const REFILL_LIMIT = 60;

async function refillLoadedRange(modes = null, runden = 4, nurImFenster = false) {
  modes = modes || enabledModes();
  if (!modes || !app.itins.length) return 0;   // alles an → nichts zu ergänzen
  const deps = app.itins.map(depOf).filter(Number.isFinite);
  if (!deps.length) return 0;
  const von = Math.min(...deps), bis = Math.max(...deps);

  let cursor = null, added = 0;
  for (let round = 0; round < runden; round++) {
    const params = planParams({ time: round === 0 ? von : null, limit: REFILL_LIMIT,
      cursor, window: REFILL_WINDOW });
    let data;
    try {
      const res = await fetch(`${API}/plan?${params}&transitModes=${encodeURIComponent(modes)}`,
        { signal: app.planAbort?.signal });
      if (!res.ok) break;
      data = await res.json();
    } catch { break; }

    const known = new Set(app.itins.map(itKey));
    /* Beim Sammeln JE KATEGORIE auf den bereits geladenen Zeitraum beschneiden.
       Ohne das sprengt es den Pool: Eine Fernverkehrs-Anfrage ab dem frühesten
       geladenen Halt liefert 30 Verbindungen quer über den Tag — gemessen wuchs
       München Ost → Hbf von 33 auf 352 Verbindungen, mit Nachtzügen und
       Westbahn weit außerhalb dessen, was auf dem Schirm war. Gesucht ist
       Vollständigkeit IM Fenster, nicht ein größeres Fenster. */
    const fresh = (data.itineraries || []).filter(it => transitLegs(it).length)
      .filter(it => !nurImFenster || (depOf(it) >= von && depOf(it) <= bis));
    for (const it of fresh) {
      const k = itKey(it);
      if (known.has(k)) continue;
      known.add(k);
      app.itins.push(it);
      added++;
    }
    /* Die Cursor der laufenden Suche bleiben UNANGETASTET — dieses Nachfüllen
       ist ein Seitenweg, kein Blättern. */
    /* Für den Abbruch die UNBESCHNITTENE Antwort messen — sonst sähe es nach
       „nichts mehr da“ aus, sobald der Rechner über das Fenster hinausgelaufen
       ist, und die Seite dazwischen fehlte. */
    const roh = (data.itineraries || []).filter(it => transitLegs(it).length);
    const juengste = roh.length ? Math.max(...roh.map(depOf)) : -Infinity;
    if (!data.nextPageCursor || juengste >= bis) break;
    cursor = data.nextPageCursor;
  }
  if (added) app.itins.sort((a, b) => depOf(a) - depOf(b));
  return added;
}

/* Ob vollständig gesucht wird, hängt an den beiden beteiligten KACHELN, nicht
   an einer globalen Einstellung: Nötig sind die Zusatzanfragen dort, wo sich
   Linien gegenseitig verdrängen (Stammstrecke, Knotenbahnhof) — an einem
   Landhalt sind sie reine Wartezeit. Eine der beiden Kacheln genügt, denn die
   dichte Seite verursacht die Lücke, egal ob sie Start oder Ziel ist. */
function wantsFullSearch() {
  return !!(app.search?.from?.full || app.search?.to?.full);
}

/* Vollständig suchen: EINE Anfrage je sichtbarer Kategorie statt einer
   ungefilterten.

   Warum das nötig ist: Der Fahrplanrechner antwortet Pareto-optimal und wirft
   weg, was nicht zugleich später losfährt und früher ankommt. Auf dichten
   Strecken verschwindet dabei viel — gemessen München Ost → Hbf: Die
   ungefilterte Antwort enthielt S1, S2, S4, S6; eine reine S-Bahn-Anfrage
   brachte zehn weitere Verbindungen, darunter S3 und S8 vollständig. Die
   U5 braucht 7 Minuten, die S-Bahn 8 bis 14 — jede U5 verdrängt die S-Bahn
   kurz davor.

   Die Entlastung aus `relievedModes` hilft dagegen NICHT: Sie schließt die
   erdrückende Kategorie aus, hier fehlen die Linien aber INNERHALB einer
   Kategorie (70 % der Treffer waren bereits S-Bahn). Nur eine Anfrage je
   Kategorie findet sie.

   Kostet je Kategorie eine Anfrage — deshalb nicht der Standard, sondern ein
   Knopf. Zwei Runden statt vier je Kategorie, sonst wird es zu viel auf
   einmal; Transitous drosselt ab etwa zwölf Anfragen in kurzer Folge. */
async function loadAllCategories() {
  if (app.refilling || !app.itins.length) return;
  const offen = CATS.filter(c => !app.hiddenCats.has(c) && !app.emptyCats.has(c));
  if (!offen.length) return;
  app.refilling = true;
  const vorher = app.itins.length;
  /* Position sichern, bevor `showSearching` die Grafik leert — sonst springt die
     Ansicht danach auf die erste Spalte (dieselbe Falle wie bei der Legende). */
  tl.keepAnchor = tlAnchor();
  tl.forceAutoZoom = true;
  tl.forceRealign = tlAtAlign();   // wie bei der Legende: neu ausrichten, wenn man noch dort steht
  try {
    for (let i = 0; i < offen.length; i++) {
      showSearching(`${CAT_LABEL[offen[i]]} …`, i, offen.length);
      await refillLoadedRange(CAT_MODES[offen[i]], 3, true);
    }
  } finally {
    app.refilling = false;
  }
  app.fullLoaded = app.searchTag;   // je Suche nur einmal nötig
  /* Wer alles holt, will alles sehen: Sonst lädt man Verbindungen nach, die
     der Filter im selben Moment wieder wegnimmt. Das zählt als bewusste
     Entscheidung und wird deshalb genauso gemerkt wie ein Tippen auf den
     Trichter — sonst stünde beim nächsten Start wieder der Filter davor. */
  app.hideDominated = false;
  localStorage.setItem("pp.fastonly", "0");
  updateChips();
  renderResults();
  return app.itins.length - vorher;
}

/* Kontext um das Ergebnis herum nachladen — NACH der Umkreis-Rückfallebene.
   Vorher stand das davor und hing an `app.itins.length`: Bei Strecken, die
   erst über den Umkreis etwas finden (Erlenstegen → Vorra), war der Pool zu
   diesem Zeitpunkt noch leer, das Nachladen wurde übersprungen, und die
   gesuchte letzte Verbindung klebte ohne Nachbarn am rechten Rand.

   Nach hinten wird so weit geladen, dass die Zielverbindung in der ZWEITEN
   Spalte stehen kann und die eingestellte Spaltenzahl gefüllt ist — bei sieben
   Spalten braucht es eben sechs Verbindungen danach, nicht vier. */
/* Wie viele Spalten sollen VOR der gesuchten Verbindung stehen? Eine reicht,
   damit sie nicht am linken Rand klebt — geholt werden zwei, weil eine davon
   ausgeblendet sein kann. Die Zahl zählt nur noch, OB die Runde nötig ist;
   wie viel sie holt, bestimmt `CONTEXT_WINDOW`. */
const CONTEXT_BEFORE = 2;
/* Wie weit reicht diese Runde zurück? Eine Stunde. Sie soll die Spalte direkt
   vor der gesuchten Verbindung beschaffen, nicht rückwärts blättern — dafür
   gibt es die Geste nach links. Gilt nur für die Zeitwahl; „Jetzt“ holt hier
   gar nichts mehr. */
const CONTEXT_WINDOW = 3600;

async function loadContext() {
  if (!app.itins.length) return;

  const need = Math.max(2, Math.min(7, settings.cols || 3) - 1);

  /* „JETZT“ HOLT KEINEN KONTEXT RÜCKWÄRTS. Die Frage lautet „wann komme ich
     weg“ — eine Verbindung, die schon abgefahren ist, beantwortet sie nicht.
     In der Liste stand sie sogar OBEN, also dort, wo man zuerst hinsieht.

     Bis v1.53.0 lief diese Runde über `app.prevPageCursor` und lieferte damit
     tatsächlich die zwei Verbindungen unmittelbar davor. Mit dem Wegfall der
     Cursor in v1.54.0 lief dieselbe Zeile unbemerkt auf die Zeitfenster-Logik
     über — und die fragt `[spanFrom − winEarlier, spanFrom]` mit
     `maxItineraries: 2` ab. Der Router liefert dabei ein PRÄFIX, also die zwei
     FRÜHESTEN im Fenster. Gemessen Regensburg → Nürnberg um 03:23: Fenster
     10 h, geholt wurden 17:48 und 18:45 — Verbindungen von vor neun Stunden,
     und die standen dann als erste Spalte in der Grafik. Wie stark es auffiel,
     hing an `winEarlier` und damit an der Dichte der Strecke: In der Stadt
     steht das Fenster auf der Untergrenze und die Verschiebung blieb klein,
     auf dünnen Strecken zog es auf zehn bis zwölf Stunden auf.

     Der Weg nach hinten bleibt vollständig erhalten — er wird nur nicht mehr
     von selbst gegangen: nach links wischen in der Grafik, „Frühere anzeigen“
     in der Liste. Beides läuft dann als normaler Blätterschritt mit passendem
     Fenster. Gespart wird eine von 2–4 Anfragen je Suche; sie steckt jetzt im
     größeren `PAGE_WINDOW`, also in Zukunft statt in Vergangenheit. */
  if (!hasFocus()) return;

  /* Den Fokus JETZT festlegen — VOR dem Nachladen. Sonst passiert genau das,
     was die Markierung immer wieder nach rechts rutschen ließ: Das Nachladen
     bringt spätere Verbindungen, die nächste Bestimmung nimmt eine davon, und
     dahinter ist wieder nichts. Inhaltlich ist das Einfrieren korrekt, weil die
     Ankunftssuche die spätesten Verbindungen VOR Betriebsschluss bereits
     vollständig geliefert hat; was danach kommt, kommt erst am nächsten Morgen
     und ist nur Kontext. Kostet keine zusätzliche Anfrage. */
  const key = searchFocusKey(visibleItins());
  if (key === "end") return;

  /* Kontext DAVOR nur holen, wenn tatsächlich welcher fehlt — dieselbe Regel
     wie für den Kontext dahinter, nur spiegelverkehrt. Bei einer Ankunftssuche
     ist die gesuchte Verbindung die SPÄTESTE, alles andere liegt ohnehin davor:
     Nachgemessen an acht Strecken standen bereits 19 bis 39 Verbindungen vor
     ihr, während diese Runde zwei weitere holte, die niemand braucht. Das war
     eine volle Umlaufzeit und ein bis zwei Anfragen für nichts — bei „Letzte“
     jedes Mal. Bei einer Abfahrtssuche („ab 14:00“) beginnt der Pool dagegen
     genau am gewählten Zeitpunkt, davor steht nichts, und die Runde läuft
     weiterhin. Die Zählung entscheidet das von selbst, ohne Sonderfall. */
  const vorher = visibleItins();
  const fokus = vorher.find(it => itKey(it) === key);
  const ahead = fokus ? vorher.filter(it => depOf(it) < depOf(fokus)).length : 0;
  /* EINE Stunde, und mit vollem Deckel statt `CONTEXT_BEFORE` als Limit.
     Beides gehört zusammen und behebt hier denselben Fehler, den „Jetzt“ oben
     ganz losgeworden ist: Mit dem geerbten Blätterfenster (3–12 h) und einem
     Limit von 2 lieferte der Router die zwei FRÜHESTEN aus dem Fenster — bei
     „ab 14:00“ also Verbindungen vom Vormittag statt der Spalte direkt davor.
     Eine Stunde mit offenem Deckel liefert stattdessen genau das Stück vor dem
     gewählten Zeitpunkt, lückenlos, und kostet dieselbe eine Anfrage. */
  if (!app.endEarlier && ahead < CONTEXT_BEFORE) {
    await fetchPage("earlier", PAGE_MAX, CONTEXT_WINDOW);
  }

  /* Höchstens zwei Runden, und die zweite nur, wenn die erste nichts Sichtbares
     gebracht hat (etwa weil alles Nachgeladene ausgeblendet ist). Jede Runde
     kostet eine volle Umlaufzeit — im Normalfall bleibt es bei einer. */
  for (let round = 0; round < 2; round++) {
    const visible = visibleItins();
    const focus = visible.find(it => itKey(it) === key);
    if (!focus) return;
    const behind = visible.filter(it => depOf(it) > depOf(focus)).length;
    if (behind >= need || app.endLater) return;
    const { added } = await fetchPage("later", need - behind + 2);
    if (!added) return;
  }
}

/* Bis wann muss man ANKOMMEN? Beantwortet zugleich, ob es überhaupt eine
   Ankunftssuche ist. „Letzte“ ist der Sonderfall mit Betriebsschluss als
   Grenze; bei der Datumsauswahl mit „an“ ist es der gewählte Zeitpunkt.
   Beide brauchen dieselbe Behandlung: Interessant ist die SPÄTESTE Verbindung,
   die es noch schafft — nicht die früheste im Ergebnis. */
function arrivalDeadline() {
  const t = app.searchTime;
  if (t.kind === "letzte") return +nextServiceEnd();
  if (t.kind === "custom" && t.arriveBy && t.time) return +new Date(t.time);
  return null;
}

/* Ab wann will man LOSFAHREN? Das Gegenstück, ebenfalls mit Doppelrolle.
   Bewusst NICHT für „Jetzt“: Dort verschiebt sich die Antwort mit jeder Minute,
   und genau dafür gibt es die Jetzt-Linie — eine eingefrorene Markierung
   zeigte irgendwann auf einen Zug, der längst weg ist. Ein gewählter Zeitpunkt
   steht dagegen fest, da darf und soll die Antwort festgehalten werden. */
function departureTarget() {
  const t = app.searchTime;
  if (t.kind === "custom" && !t.arriveBy && t.time) return +new Date(t.time);
  return null;
}

/* Hat die Suche überhaupt eine bestimmte Verbindung als Antwort? Bei jeder
   gewählten Uhrzeit ja — bei „Jetzt“ nicht (siehe departureTarget). */
const hasFocus = () => arrivalDeadline() !== null || departureTarget() !== null;

/* Die gesuchte Verbindung wird je Suche EINMAL bestimmt und dann festgehalten.
   Vorher rechnete sie jeder Neuaufbau neu — und weil der Pool zwischendurch
   wächst, konnte dabei eine andere Verbindung herauskommen: Die Markierung
   sprang, mal stand sie in der zweiten Spalte, mal in der letzten. Neu bestimmt
   wird nur, wenn die gemerkte Verbindung nicht mehr sichtbar ist (etwa weil ein
   Verkehrsmittel ausgeblendet wurde) — oder bei einer neuen Suche, und genau
   das passiert beim erneuten Tippen auf „Letzte“. */
function searchFocusKey(visible) {
  const known = app.focusKey && visible.some(it => itKey(it) === app.focusKey);
  if (!known) app.focusKey = findFocusItin(visible) || null;
  return app.focusKey || "end";
}

/* Welche Verbindung beantwortet die Frage? Bei „an“ die späteste, die es noch
   schafft; bei „ab“ die erste, die ab dem gewählten Zeitpunkt fährt. Die
   frühere Ansicht zeigte bei „ab“ einfach die erste GELADENE — und weil für den
   Kontext zwei Verbindungen davor mitgeladen werden, war das eine, die vor der
   gewünschten Zeit abfährt. */
function findFocusItin(visible) {
  const from = departureTarget();
  if (from === null) return findLastDecent(visible);
  const list = gapList(visible);
  if (!list.length) return null;
  return (list.find(x => x.dep >= from) || list[list.length - 1]).key;
}

/* Orchestrierung: beschafft (ggf. mehrere Seiten) und rendert GENAU EINMAL. */
/* Während einer frischen Suche ist ALLES Alte weg — Liste und Grafik werden
   ausgeblendet und die Grafik geleert. Vorher blieb der vorherige Stand stehen,
   bis der neue kam: Beim Wechsel zwischen „Jetzt“ und „Letzte“ sah man kurz die
   Verbindungen der anderen Ansicht. Lieber einen Moment nichts als etwas
   Falsches. */
/* Der Balken zeigt SCHRITTE, keine erfundenen Prozente: ein Feld je Schritt,
   erledigte gefüllt, der laufende wandert. Wie lange ein Schritt dauert, hängt
   an einem fremden Dienst — das lässt sich nicht vorhersagen. Wie viele Schritte
   es sind, dagegen schon, und das ist die ehrliche Auskunft. */
function showSearching(text, step = 0, total = 1) {
  tlStop();   // nichts aus der vorherigen Suche darf weiterzeichnen
  /* Der Zustand des Dienstes überlebt die Suche — `apiTimes` wird bewusst nicht
     mit geleert. Wer gerade in die Drosselung gelaufen ist, soll das schon beim
     Start der nächsten Suche sehen und nicht erst nach der ersten Antwort. */
  updateLagHint();
  byId("searching-text").textContent = text;
  const bar = byId("searchbar");
  if (bar.children.length !== total) {
    bar.innerHTML = "";
    for (let i = 0; i < total; i++) bar.appendChild(document.createElement("i"));
  }
  [...bar.children].forEach((el, i) => {
    el.className = i < step ? "done" : i === step ? "run" : "";
  });
  renderPlanLog();
  byId("searching").hidden = false;
  byId("timeline-wrap").hidden = true;
  resultsList.hidden = true;
  byId("timeline").innerHTML = "";
  resultsList.innerHTML = "";
  byId("last-note").hidden = true;
  byId("around-note").hidden = true;
  byId("same-note").hidden = true;
}

/* Start und Ziel am selben Bahnhof? Kommt leichter vor, als man denkt: „München
   Ost“ und „Ostbahnhof“ sind zwei Einträge derselben Anlage, 57 m auseinander —
   einmal die Fernbahn-Elternstation, einmal ein U-Bahn-Steig davon. Der
   Fahrplanrechner beantwortet die Frage dann wörtlich und fährt eine Station
   hinaus und wieder zurück (gemessen: U5·U5, S6·S4, jeweils fünf Minuten).

   Bewusst nur ein HINWEIS, keine Sperre: Es kann Gründe geben, genau das zu
   wollen, und wer die Suche selbst gestartet hat, soll ihr Ergebnis auch sehen. */
const SAME_STOP_M = 250;
function sameStopWarning() {
  const el = byId("same-note");
  const { from, to } = app.search || {};
  const ok = p => Number.isFinite(p?.lat) && Number.isFinite(p?.lon);
  if (!ok(from) || !ok(to)) { el.hidden = true; return; }
  const R = 6371000, p = Math.PI / 180;
  const dLat = (to.lat - from.lat) * p, dLon = (to.lon - from.lon) * p;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(from.lat * p) * Math.cos(to.lat * p) * Math.sin(dLon / 2) ** 2;
  el.hidden = 2 * R * Math.asin(Math.sqrt(h)) > SAME_STOP_M;
}

/* Was der Fahrplanrechner bisher geliefert hat — aufklappbar unter dem Balken.
   Bei einer zügigen Suche sieht das niemand; wartet man dagegen länger, will man
   wissen, ob überhaupt etwas passiert. Gemessen drosselt Transitous ab etwa der
   zwölften Anfrage in kurzer Folge auf konstante ~3 s, und genau das steht dann
   hier schwarz auf weiß, statt dass die App bloß hängt. */
/* Ab hier gilt eine Antwort als träge. Gemessen liegt der Unterschied weit
   auseinander: normal 99–343 ms, gedrosselt 2087–3110 ms. 1500 ms trifft
   niemanden versehentlich. */
const LAG_MS = 1500;
/* … und so schnell muss eine Antwort gewesen sein, damit „vorher ging es ja“
   als Beleg zählt. */
const LAG_FAST_MS = 800;
const LAG_KEEP = 20;        // so viele Antwortzeiten bleiben in Erinnerung
const LAG_MEMORY = 120000;  // … und so lange (2 min)

function logPlan(label, ms, added) {
  (app.planLog ||= []).push({ label, ms: Math.round(ms), added });
  /* Zweite, KÜRZERE Erinnerung, die eine neue Suche überlebt: `planLog` wird je
     Suche geleert, die Drosselung greift aber erst nach etwa zwölf Anfragen und
     damit über mehrere Suchen hinweg. Ohne dieses Gedächtnis wüsste die App nach
     jedem Neustart wieder nichts. */
  (app.apiTimes ||= []).push({ at: Date.now(), ms });
  if (app.apiTimes.length > LAG_KEEP) app.apiTimes.splice(0, app.apiTimes.length - LAG_KEEP);
  renderPlanLog();
  updateLagHint();
}

/* Antwortet der Dienst gerade langsam — und WORAN liegt es?

   Die Unterscheidung ist keine Spitzfindigkeit, sondern der Unterschied
   zwischen „gleich wieder gut“ und „hier hilft nur besseres Netz“:
   Die Drosselung setzt NACH etwa zwölf zügigen Anfragen ein und ist danach
   gleichmäßig (gemessen 2,1 bis 3,1 s). Ein schwaches Mobilnetz ist dagegen von
   der ersten Anfrage an langsam. Also: Gab es kurz zuvor schnelle Antworten,
   war es die Drosselung; gab es nie welche, ist es die Leitung.

   Gewertet wird erst bei ZWEI trägen Antworten hintereinander. Eine einzelne
   kann jeder haben, und ein Warnzeichen, das bei jedem Ausreißer aufblinkt,
   lernt man in einer Woche zu übersehen. */
function apiLag() {
  const t = (app.apiTimes || []).filter(x => Date.now() - x.at < LAG_MEMORY);
  if (t.length < 2) return null;
  const letzte = t.slice(-2);
  if (!letzte.every(x => x.ms >= LAG_MS)) return null;
  return t.some(x => x.ms <= LAG_FAST_MS) ? "throttle" : "slow";
}

/* Die Zahlen sind gemessen, nicht geschätzt (v1.54.2, Ulm → Friedrichshafen):
   Am Stück blieben 11 Anfragen bei ~80 ms, die zwölfte sprang auf 2325 ms.
   Danach füllt sich das Guthaben wieder auf — nach dem Bremsen T Sekunden
   gewartet und je drei Anfragen am Stück geschickt: bei 1 s keine schnell,
   bei 2 s und 3 s eine, bei 5 s zwei. Das ist rund eine Anfrage je zwei
   Sekunden; für das volle Dutzend also etwa zwanzig Sekunden.

   „Ein paar Sekunden“ steht bewusst im kurzen Text und die genauen Zahlen erst
   im Aufklapper: Wer beim Warten hinsieht, will wissen, ob es gleich weitergeht
   — nicht, wie ein Token-Eimer funktioniert. Und eine grobe, richtige Angabe
   ist besser als eine genaue, die schon bei der nächsten Änderung des Dienstes
   nicht mehr stimmt. */
const LAG_TEXT = {
  throttle: "Zu viele Anfragen in kurzer Folge – ein paar Sekunden Pause genügen",
  slow: "Die Verbindung ist gerade langsam",
};

/* Das kleine Dreieck. Es sitzt an JEDER Stelle, an der gerade geladen wird:
   in der Suchanzeige und an den beiden Rand-Ladern der Grafik. Bisher stand die
   Auskunft nur im Aufklapper „Was gerade passiert“ — und dort schaut beim
   Warten niemand hin, genau dann will man aber wissen, ob es an der App liegt. */
function updateLagHint() {
  const art = apiLag();
  const note = byId("lagnote");
  if (note) {
    note.hidden = !art;
    if (art) note.lastElementChild.textContent = LAG_TEXT[art];
  }
  for (const el of document.querySelectorAll(".lagtri")) {
    el.hidden = !art;
    if (art) el.setAttribute("aria-label", LAG_TEXT[art]);
    if (art) el.setAttribute("title", LAG_TEXT[art]);
  }
}

function renderPlanLog() {
  const el = byId("searching-log");
  if (!el) return;
  const log = app.planLog || [];
  if (!log.length) { el.innerHTML = `<p class="logline muted">Noch keine Antwort.</p>`; return; }
  const gesamt = log.reduce((s, x) => s + x.ms, 0);
  /* Der Aufklapper nennt denselben Befund wie das Dreieck daneben, nur
     ausführlich — er darf ihm nicht widersprechen, also dieselbe Quelle. */
  const art = apiLag();
  const erklaerung = {
    throttle: `Mehrere Antworten über 1,5 s, davor schnelle – der Fahrplandienst
      drosselt gerade. Gemessen sind rund ein Dutzend Anfragen am Stück frei;
      danach kommt etwa alle zwei Sekunden eine neue dazu, nach ungefähr
      zwanzig Sekunden Pause ist wieder alles frei. Eine Suche kostet 2 bis 4
      Anfragen, ein Blätterschritt 1 bis 2.`,
    slow: `Mehrere Antworten über 1,5 s, und auch davor keine schnelle – das
      sieht nach der Netzverbindung aus, nicht nach dem Fahrplandienst.`,
  };
  el.innerHTML = log.map(x =>
    `<p class="logline"><span>${escapeHtml(x.label)}</span>` +
    `<span class="logval${x.ms >= LAG_MS ? " slow" : ""}">${x.ms} ms` +
    `${x.added === null ? "" : ` · ${x.added} neu`}</span></p>`).join("")
    + `<p class="logline sum"><span>${log.length} Anfragen</span><span class="logval">${gesamt} ms</span></p>`
    + (art ? `<p class="logline muted">${erklaerung[art]}</p>` : "");
}

async function runPlan(direction = null, limit = PAGE_MAX) {
  if (!direction) showSearching("Verbindungen suchen …", 0, 3);
  try {
    const { params } = await fetchPage(direction, limit);
    if (!direction) {
      // Nichts gefunden? Ersatzverkehr fährt oft ab einem Nachbarhalt →
      // einmalig mit Koordinaten und großzügigem Fußweg nachfassen.
      if (!app.itins.length && !app.aroundTried) {
        app.aroundTried = true;
        showSearching("Nichts am Halt selbst – Umgebung prüfen …", 1, 3);
        const around = await planAround(params);
        const fresh2 = (around?.itineraries || []).filter(it => transitLegs(it).length);
        if (fresh2.length) {
          const seen = new Set();
          app.itins = fresh2.filter(it => !seen.has(itKey(it)) && seen.add(itKey(it)))
            .sort((a, b) => depOf(a) - depOf(b));
          app.aroundUsed = true;
          /* Der Umkreis-Treffer setzt den abgedeckten Zeitraum neu — er kommt
             aus einer eigenen Anfrage mit eigenen Grenzen. */
          const ad = app.itins.map(depOf).filter(Number.isFinite);
          app.spanFrom = ad.length ? Math.min(...ad) : app.spanFrom;
          app.spanTo = ad.length ? Math.max(...ad) + 60000 : app.spanTo;
          app.endEarlier = app.endLater = false;
        }
      }
      if (app.itins.length) {
        showSearching(app.searchTime.kind === "letzte"
          ? "Letzte Verbindung eingrenzen …" : "Umgebung laden …", 1, 3);
      }
      await loadContext();
      /* Vollständig suchen: NACH dem Kontext, sonst würde die Fokusspalte auf
         einem unvollständigen Pool bestimmt und wanderte danach. */
      if (wantsFullSearch()) { await loadAllCategories(); return; }
    }
    renderResults();
    if (!direction) maybeAutoFill();
  } catch (e) {
    // Ein Abbruch ist kein Fehler: Die nächste Suche läuft bereits.
    if (e.name === "AbortError") return;
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

/* Ein Ort für die Anfrage: normalerweise die Halt-ID, beim eigenen Standort
   die reinen Koordinaten. MOTIS sucht daraus selbst den besten Einstieg — das
   ist besser, als vorher eine Haltestelle zu raten: Gemessen (Regensburg →
   München) legt es 9 Minuten Fußweg zum Hauptbahnhof, obwohl drei nähere
   Bushaltestellen dazwischen liegen, weil von dort die schnellere Verbindung
   fährt. Eine selbst gewählte „nächste Haltestelle“ hätte die verpasst. */
function placeParam(stop) {
  if (stop.id) return stop.id;
  return `${stop.lat},${stop.lon}`;
}

/* Der eigene Standort als Pseudo-Kachel. Er sieht für den Rest der App aus wie
   ein Halt ohne ID — `coordsOf` ist sofort zufrieden, `dbPlaceId` baut daraus
   einen Koordinaten-Ort für die DB, und der Ergebniskopf zeigt den Namen. */
function hereStop(lat, lon) {
  return { name: "Mein Standort", id: null, lat, lon, here: true };
}

const GEO_OPTS = { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 };

function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error("nicht verfügbar")); return; }
    navigator.geolocation.getCurrentPosition(
      p => resolve(hereStop(p.coords.latitude, p.coords.longitude)), reject, GEO_OPTS);
  });
}

/* Meldungen bewusst konkret: „Standort nicht verfügbar“ sagt niemandem, ob er
   etwas erlauben muss, im Keller steht oder ob die App kaputt ist. */
function geoFehler(e) {
  if (e && e.code === 1) return "Standortfreigabe verweigert – in den Browser- bzw. App-Einstellungen erlauben.";
  if (e && e.code === 2) return "Standort nicht ermittelbar – draußen oder am Fenster nochmal versuchen.";
  if (e && e.code === 3) return "Standortsuche hat zu lange gedauert – nochmal probieren.";
  return "Dieses Gerät gibt den Standort nicht her.";
}

/* Langer Druck auf eine Kachel: von hier aus dorthin. */
async function searchFromHere(i) {
  const ziel = slots[i];
  if (!ziel || app.geoBusy) return;
  app.geoBusy = true;
  const hinweis = byId("grid-hint");
  const vorher = hinweis.innerHTML;
  hinweis.innerHTML = `Standort wird bestimmt – dann geht es nach <strong>${escapeHtml(ziel.label || ziel.name)}</strong> …`;
  try {
    const von = await currentPosition();
    hinweis.innerHTML = vorher;
    startFreshSearch(von, ziel);
  } catch (e) {
    hinweis.innerHTML = `<span class="hint-bad">${escapeHtml(geoFehler(e))}</span>`;
    /* Der Hinweis ersetzt die Bedienanleitung — sie muss zurückkommen, sonst
       weiß beim nächsten Blick niemand mehr, wie das Grid funktioniert. */
    setTimeout(() => { if (byId("grid-hint").querySelector(".hint-bad")) byId("grid-hint").innerHTML = vorher; }, 6000);
  } finally {
    app.geoBusy = false;
  }
}

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
    const res = await fetch(`${API}/plan?${p}`, { signal: app.planAbort?.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/* Leeres Ergebnis erklären statt schweigen: Für beide Halte prüfen, ob dort
   überhaupt etwas fährt. Deckt Datenlücken (Fahrplan beginnt erst später),
   stillgelegte/saisonale Halte und echte „keine Verbindung“-Fälle ab. */
async function nextDeparture(stopId) {
  try {
    const res = await fetch(`${API}/stoptimes?stopId=${encodeURIComponent(stopId)}&n=1`,
      { signal: app.planAbort?.signal });
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
      const c = productClass(l.mode, l.routeType);
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
  const limit = arrivalDeadline() ?? +nextServiceEnd();
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
    transitLegs(it).every(l => !app.hiddenCats.has(productClass(l.mode, l.routeType))));
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

/* Ab welchem Anteil eine Kategorie als „erdrückend“ gilt. 0,6 ist gemessen:
   Bei den Strecken, wo etwas fehlte, lag der Anteil bei 80–100 %; bei denen,
   wo nichts fehlte (Frankfurt Hbf → Süd 48 %, Köln Hbf → Deutz 55 %), darunter. */
const CROWD_SHARE = 0.6;

/* Welche Kategorie ist das Rückgrat einer Verbindung? Die, die die meisten
   ihrer Abschnitte stellt — bei Gleichstand die des ersten. */
function mainCat(it) {
  const zahl = new Map();
  for (const l of transitLegs(it)) {
    const c = productClass(l.mode, l.routeType);
    zahl.set(c, (zahl.get(c) || 0) + 1);
  }
  let best = null, n = 0;
  for (const [c, v] of zahl) if (v > n) { best = c; n = v; }
  return best;
}

/* Erdrückt EINE Kategorie das Ergebnis, verschwinden alle anderen dahinter —
   und zwar nicht, weil sie schlechter wären, sondern weil der Router
   Pareto-optimal antwortet: Sichtbar bleibt nur, wer später losfährt UND
   früher ankommt. In einer Stadt mit dichtem Takt gewinnt damit fast immer
   dasselbe Verkehrsmittel.

   Gemessen München Hbf → Ost, 10 Uhr: Die U5 braucht 11 Minuten, die S-Bahn 15.
   Also verdrängt jede U5 die S-Bahn, die kurz davor fährt — von 20 Verbindungen
   waren 16 U5 und 4 S6, während in Wirklichkeit alle zwei Minuten eine S-Bahn
   nach Ostbahnhof fährt (S1, S2, S3, S4, S8 fehlten vollständig).

   Deshalb: Ist eine Kategorie erdrückend, wird sie in der ZWEITEN Anfrage
   ausgeschlossen, damit dahinter sichtbar wird, was es sonst noch gibt. Das
   kostet KEINE zusätzliche Anfrage — es ist dieselbe zweite Anfrage, die bei
   ausgeblendeten Kategorien ohnehin läuft, nur mit engerem Modus-Satz. */
function relievedModes(pool) {
  const cand = pool && pool.length ? pool : app.itins;
  if (cand.length < 4) return null;
  const zahl = new Map();
  for (const it of cand) {
    const c = mainCat(it);
    if (c) zahl.set(c, (zahl.get(c) || 0) + 1);
  }
  let top = null, n = 0;
  for (const [c, v] of zahl) if (v > n) { top = c; n = v; }
  if (!top || n / cand.length < CROWD_SHARE) return null;
  const rest = CATS.filter(c => c !== top && !app.hiddenCats.has(c));
  // Bleibt nichts übrig, gäbe die Anfrage garantiert nichts her
  return rest.length ? rest.map(c => CAT_MODES[c]).join(",") : null;
}

// Reicht es nach dem Filtern noch nicht für die Spaltenzahl,
// weitere Cursor-Seiten nachlegen (serialisiert, gefiltert gezählt)
async function ensureFilled() {
  if (app.paging) return;
  if (visibleItins().length >= neededVisible()) return;
  if (!app.endLater && app.autoLoads < 4) {
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
    /* ZWEI echte Zeilen statt eines Umbruch-Elements: drei Felder oben, fünf
       unten. Der Umbruch über ein Flex-Element voller Breite war der
       naheliegende Weg, kostete aber eine zusätzliche Zeile der Höhe null —
       und damit einen Zeilenabstand zu viel (gemessen 60 statt 54 px). Zwei
       Zeilen ergeben exakt zwei Zeilen. Die Reihenfolge bleibt unangetastet,
       geschnitten wird nur an einer Stelle. */
    const feld = c =>
      `<button class="tl-key" data-cat="${c}"><i class="dot seg-${c}"></i>${CAT_LABEL[c]}</button>`;
    el.innerHTML =
      `<span class="leg-row">${CATS.slice(0, LEGEND_BREAK).map(feld).join("")}</span>` +
      `<span class="leg-row">${CATS.slice(LEGEND_BREAK).map(feld).join("")}</span>`;
    el.dataset.built = "1";
    el.addEventListener("click", async (e) => {
      const b = e.target.closest(".tl-key");
      if (!b || app.refilling) return;
      const c = b.dataset.cat;
      app.autoLoads = 0;
      tl.forceAutoZoom = true;   // andere Verkehrsmittel = andere Frage
      /* … und andere Frage heißt auch: neu ausrichten. Die Antwort auf „was ist
         die nächste erreichbare Verbindung?“ bzw. „welche ist die letzte?“ kann
         mit den nachgeladenen Verbindungen eine andere sein — meist eine, die
         VOR der bisherigen Spalte einsortiert wird und sonst links außerhalb des
         Bildes stünde. Nur wenn die Ansicht noch an ihrer automatisch gesetzten
         Stelle steht: Wer bewusst woanders hingescrollt ist, soll dort bleiben.
         JETZT auswerten, nicht später — `showSearching` leert die Grafik gleich,
         danach ließe sich die Position nicht mehr ablesen. */
      tl.forceRealign = tlAtAlign();
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
      /* Position sichern, BEVOR showSearching die Grafik leert: Ein geleertes
         Scrollfeld meldet scrollLeft = 0, der Anker käme also von „ganz links“
         und die Ansicht spränge nach dem Nachladen auf die erste Spalte. */
      tl.keepAnchor = tlAnchor();
      showSearching(`${CAT_LABEL[c]} nachladen …`, 0, 2);
      try {
        await refillLoadedRange();
      } finally {
        app.refilling = false;
      }
      /* Kam trotz eigener Anfrage nichts dieser Art, gibt es hier wirklich
         nichts — erst DANN ist die Aussage „keine“ belegt. */
      const gibts = app.itins.some(it => transitLegs(it).some(l => productClass(l.mode, l.routeType) === c));
      if (!gibts) app.emptyCats.add(c); else app.emptyCats.delete(c);
      renderResults();
      maybeAutoFill();
    });
  }
  const present = new Set();
  for (const it of app.itins) for (const l of transitLegs(it)) present.add(productClass(l.mode, l.routeType));
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
  /* Neu ausrichten heißt auch: die gesuchte Verbindung neu bestimmen. Sonst
     bliebe bei „Letzte“ die alte Antwort stehen, obwohl das eingeblendete
     Verkehrsmittel womöglich genau die spätere letzte Verbindung mitgebracht
     hat — `searchFocusKey` fragt `findLastDecent` nur, wenn die gemerkte
     Verbindung verschwunden ist. Das Flag selbst setzt `renderTimeline`
     zurück, nicht diese Stelle. */
  if (tl.forceRealign) app.focusKey = null;
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
  byId("list-earlier").hidden = graph || !visible.length || app.endEarlier;
  byId("list-later").hidden = graph || !visible.length || app.endLater;
  if (!visible.length) {
    const msg = app.itins.length
      ? `<p class="status">Alle geladenen Verbindungen sind über die Legende ausgeblendet – unten wieder einblenden.</p>`
      : `<p class="status">${app.emptyReason || "Keine Verbindungen gefunden."}</p>`;
    if (graph) byId("timeline").innerHTML = msg; else resultsList.innerHTML = msg;
    return;
  }
  updateLastNote(visible);
  sameStopWarning();
  updateChips();   // die beiden Knöpfe in der Mitte hängen am Ergebnis
  /* „Nur die besten“: In der ANZEIGE-Schicht gefiltert, nicht im Pool. Die
     Verbindungen bleiben geladen, der Fokus und das Nachladen rechnen weiter
     mit allen — nur gezeigt werden sie nicht. Umschalten kostet dadurch keine
     Anfrage und verliert nichts. */
  const dom = app.hideDominated ? dominatedFlags(visible) : null;
  const gezeigt = dom ? visible.filter((_, i) => !dom[i]) : visible;
  if (!gezeigt.length) {
    const msg = `<p class="status">Alle geladenen Verbindungen gelten als langsamer –
      oben über das Zugsymbol wieder einblenden.</p>`;
    if (graph) byId("timeline").innerHTML = msg; else resultsList.innerHTML = msg;
    return;
  }
  if (graph) {
    // Jede gewählte Uhrzeit hat eine Verbindung als Antwort — die wird angesteuert
    // und markiert. Nur „Jetzt“ hat keine feste: das macht die Jetzt-Linie.
    const focus = hasFocus() ? searchFocusKey(gezeigt) : "start";
    renderTimeline(gezeigt, focus);
  } else {
    resultsList.innerHTML = "";
    renderItineraries(gezeigt);
  }
}

byId("btn-viewmode").addEventListener("click", () => {
  app.viewMode = app.viewMode === "graph" ? "list" : "graph";
  localStorage.setItem("pp.view", app.viewMode);
  renderResults();
});

/* Kopf der Detailansicht: Abfahrt · Fahrzeit · Ankunft, dazu der Schließknopf —
   alles in EINER Zeile. Jede der drei Angaben kann zwei Zahlen tragen: die
   geplante und die tatsächlich erwartete. Unterschieden werden sie nicht durch
   eine Beschriftung, sondern durch dieselbe Darstellung wie in den Zeilen direkt
   darunter — Sollzeit durchgestrichen und grau, Prognose in Farbe. Wer die eine
   Zeile gelesen hat, versteht alle. Ohne Verspätung steht nur EINE Zahl da; ein
   „(planmäßig)“ dahinter wäre Lärm für den Normalfall. */
function tripHeadHTML(it) {
  const legs = transitLegs(it);
  const ab = legs[0].from, an = legs[legs.length - 1].to;
  /* Die Fahrzeit aus DENSELBEN zwei Zeitpunkten rechnen, die daneben stehen —
     `it.duration` zählt auch Fußwege davor und danach mit, dann widerspräche
     die mittlere Zahl den beiden äußeren. */
  const soll = (+new Date(an.scheduledArrival) - +new Date(ab.scheduledDeparture)) / 1000;
  const ist = (+new Date(an.arrival) - +new Date(ab.departure)) / 1000;
  const dauerAnders = Math.abs(ist - soll) >= 30;

  /* Eine Zeitangabe belegt ZWEI Rasterzeilen: oben die überholte Sollzeit,
     unten die gültige. Gibt es keine Verspätung, steht nur eine Zahl da — die
     rutscht dann nicht nach unten, sondern spannt beide Zeilen und sitzt mittig
     auf der Linie (`solo`). Sonst stünden pünktliche Zeiten tiefer als
     verspätete, und die Zeile wirkte schief. */
  const zeit = (spalte, plan, ist2, rt) => {
    const d = diffMin(plan, ist2);
    if (!rt || d === 0) {
      return `<span class="th-v solo ${spalte} ${rt ? "t-real ok" : "t-plan"}">${fmtTime(ist2 || plan)}</span>`;
    }
    return `<span class="th-v alt ${spalte} old-time">${fmtTime(plan)}</span>`
      + `<span class="th-v neu ${spalte} t-real ${d > 0 ? "bad" : "ok"}">${fmtTime(ist2)}</span>`;
  };

  /* Die Fahrzeit steht immer ÜBER der Linie, ihre geänderte Fassung darunter —
     „vorher so lang, jetzt so lang“ liest sich in dieser Richtung von selbst. */
  const dauer = dauerAnders
    ? `<span class="th-v alt mid old-time">${fmtDur(soll)}</span>`
      + `<span class="th-v neu mid t-real ${ist > soll ? "bad" : "ok"}">${fmtDur(ist)}</span>`
    : `<span class="th-v alt mid t-plan">${fmtDur(soll)}</span>`;

  return `<span class="th-lab lab-ab">ab</span><span class="th-lab lab-an">an</span>`
    + zeit("ab", ab.scheduledDeparture, ab.departure, legs[0].realTime)
    + dauer
    + zeit("an", an.scheduledArrival, an.arrival, legs[legs.length - 1].realTime)
    + `<span class="th-line" aria-hidden="true"></span>`;
}

byId("btn-trip-back").addEventListener("click", () => byId("trip-dialog").close());

function openTripDialog(it) {
  byId("trip-dialog-title").innerHTML = tripHeadHTML(it);
  const body = byId("trip-dialog-body");
  const foot = byId("trip-foot");
  body.innerHTML = "";
  foot.querySelector(".dblink")?.remove();   // Knopf der vorher geöffneten Verbindung
  fillDetails(body, it, foot);
  byId("trip-dialog").showModal();
}

function transitLegs(it) { return it.legs.filter(l => l.mode !== "WALK"); }

/* Streifen unter der Kachel: die Verbindung in klein, maßstäblich nach Dauer
   und in den Kategoriefarben der Balkengrafik. Er beantwortet auf einen Blick,
   was die Textzeile erst nach dem Lesen verrät — wie viel der Fahrt womit
   zurückgelegt wird und wo gewartet wird. Fußwege und Umstiege bleiben neutral,
   Ausfälle bekommen die Streifung aus der Grafik. */
function tripStripe(it) {
  const T = transitLegs(it);
  if (!T.length) return "";
  const von = +new Date(T[0].from.departure);
  const bis = +new Date(T[T.length - 1].to.arrival);
  const ganz = bis - von;
  if (!(ganz > 0)) return "";
  const flagged = cancelledTransitLegs(it);
  const teile = [];
  let cursor = von;
  for (const l of it.legs) {
    const a = +new Date(l.from.departure), b = +new Date(l.to.arrival);
    if (b <= von || a >= bis) continue;               // führende/abschließende Fußwege
    const s = Math.max(a, von), e = Math.min(b, bis);
    if (s > cursor) teile.push({ cls: "st-wait", ms: s - cursor });   // Wartezeit
    const walk = l.mode === "WALK";
    teile.push({
      cls: walk ? "st-walk" : `seg-${productClass(l.mode, l.routeType)}`
        + (flagged.has(l) ? " seg-cancelled" : isReplacementService(l) ? " seg-sev" : ""),
      ms: e - s,
    });
    cursor = e;
  }
  if (cursor < bis) teile.push({ cls: "st-wait", ms: bis - cursor });
  return `<span class="trip-stripe" aria-hidden="true">` + teile
    .map(t => `<i class="${t.cls}" style="flex:${Math.max(1, t.ms)}"></i>`).join("") + `</span>`;
}

/* Beschriftung des Tagestrenners: „Samstag, 30. August“. Ausgeschrieben, weil
   die Liste die volle Breite hat — die Grafik muss sich mit „SA / 30.8.“ auf
   44 px begnügen. Der Formatierer steht AUSSERHALB der Funktion: Er wird je
   Aufbau mehrfach gebraucht, und `Intl.DateTimeFormat` neu zu bauen ist teuer. */
const LIST_DAY = new Intl.DateTimeFormat("de-DE", {
  weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Berlin",
});

function dayDivider(ms) {
  const el = document.createElement("div");
  el.className = "daysep";
  el.setAttribute("role", "separator");
  el.innerHTML = `<span class="daysep-tag">${escapeHtml(LIST_DAY.format(new Date(ms)))}</span>`;
  return el;
}

function renderItineraries(itineraries) {
  /* Tageswechsel in der Liste: Zwischen der letzten Verbindung eines Tages und
     der ersten des nächsten steht eine Kachel mit Wochentag und Datum. In der
     Grafik leistet das der Mitternachtsstrich neben der Kopf-Kachel; in der
     Liste gab es dafür bisher nichts — man scrollte über Mitternacht hinweg,
     ohne es zu bemerken, und las 00:14 als wäre es heute.

     Zwei Regeln übernimmt der Trenner unverändert von der Grafik, beide teuer
     gelernt (siehe `tlBuild`):
     · **Verglichen wird die SOLL-Abfahrt**, dieselbe Zahl, die in der Zeile
       steht. Mit der Ist-Zeit zählte eine für 23:59 geplante, über Mitternacht
       verspätete Verbindung als nächster Tag — der Trenner stünde dann ÜBER
       23:59, obwohl das noch heute ist.
     · **Der Tagesschlüssel kommt aus `tlTagKey`**, also in Europe/Berlin.
       `toDateString()` nähme die Zeitzone des Geräts, und für jemanden im
       Ausland kippte das Datum woanders. */
  let letzterTag = null;
  for (const it of itineraries) {
    const legs = transitLegs(it);
    if (!legs.length) continue; // reine Fußwege ausblenden
    const first = legs[0], last = legs[legs.length - 1];
    const dep = first.from, arr = last.to;

    const sollAb = +new Date(dep.scheduledDeparture || dep.departure);
    const tag = tlTagKey(sollAb);
    if (letzterTag !== null && tag !== letzterTag) resultsList.appendChild(dayDivider(sollAb));
    letzterTag = tag;
    const flagged = cancelledTransitLegs(it);
    const cancelled = flagged.size > 0;
    const delayMin = diffMin(dep.scheduledDeparture, dep.departure);
    const risk = cancelled ? null : itinIssues(it).level;

    const card = document.createElement("article");
    card.className = "trip" + (cancelled ? " cancelled" : "");

    /* Linien als farbige Marken mit Fahrzeugsymbol — dieselben Bausteine wie in
       der Detailansicht. Vorher stand hier „RE22 › S3“ als reiner Text; welche
       Verkehrsmittel das sind, musste man wissen. */
    const chips = legs.map(l => {
      const cls = productClass(l.mode, l.routeType);
      const sev = !flagged.has(l) && isReplacementService(l);
      return `<span class="linechip seg-${cls}${sev ? " chip-sev" : ""}${flagged.has(l) ? " seg-cancelled" : ""}">` +
        `<span class="lc-icon">${modeIcon(l)}</span>` +
        `<span class="lc-name">${escapeHtml(lineParts(l).main || l.mode)}</span></span>`;
    }).join(`<span class="trip-arrow" aria-hidden="true">›</span>`);

    /* Nur MIT Gleisangabe: Ohne Gleis liefert `trackChip` bloß den Karten-Pin,
       und der steht in der Übersichtszeile als einzelnes Zeichen ohne Bezug da.
       In der aufgeklappten Detailansicht ist er weiterhin an jedem Halt. */
    const track = dep.track ? trackChip(dep, "Abfahrtsgleis") : "";
    const umst = it.transfers === 1 ? "1 Umstieg" : `${it.transfers} Umstiege`;

    const main = document.createElement("button");
    main.className = "trip-main";
    main.innerHTML =
      `<span class="trip-when">` +
        `<span class="trip-dep">${timeWithDelay(dep.scheduledDeparture, dep.departure, first.realTime)}</span>` +
        `<span class="trip-rule" aria-hidden="true"></span>` +
        `<span class="trip-arr">${timeWithDelay(arr.scheduledArrival, arr.arrival, last.realTime)}</span>` +
      `</span>` +
      `<span class="trip-body">` +
        `<span class="trip-chips">${chips}</span>` +
        `<span class="trip-sub">${fmtDur(it.duration)} · ${umst}` +
          `${track ? ` <span class="trip-track">${track}</span>` : ""}</span>` +
      `</span>` +
      `<span class="trip-side">` +
        `${cancelled ? `<span class="cancelled-label">Fällt aus</span>` : delayBadge(delayMin, first.realTime)}` +
        `${risk ? riskMark(risk) : ""}` +
        `<span class="trip-more" aria-hidden="true">›</span>` +
      `</span>` +
      tripStripe(it);

    const details = document.createElement("div");
    details.className = "trip-details";
    details.hidden = true;
    main.addEventListener("click", () => {
      if (details.hidden && !details.childNodes.length) fillDetails(details, it);
      details.hidden = !details.hidden;
      card.classList.toggle("open", !details.hidden);
    });

    card.appendChild(main);
    card.appendChild(details);
    resultsList.appendChild(card);
  }
}

let jrnGroup = 0; // laufende Nummer für Zwischenhalt-Gruppen

/* `foot` ist optional: Im Dialog wandert der DB-Knopf in die klebende
   Fußleiste, in der aufklappbaren Listenansicht bleibt er am Ende des
   Inhalts — dort gibt es keine Fußleiste, an die er kleben könnte. */
function fillDetails(container, it, foot = null) {
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
    const cls = productClass(l.mode, l.routeType);
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
  /* „Mein Standort“ kann die DB nicht suchen — ihr Suchfeld will einen Ort.
     Für den Suchlink deshalb den tatsächlichen Einstiegshalt einsetzen; das
     ist ohnehin die Information, die drüben weiterhilft. Dasselbe rückwärts,
     wenn der Standort nach dem Tauschen das Ziel ist. */
  const dbVon = app.search.from.here ? T[0].from : app.search.from;
  const dbBis = app.search.to.here ? T[T.length - 1].to : app.search.to;
  a.href = dbLink(dbVon, dbBis,
    T[0].from.scheduledDeparture, T[T.length - 1].to.scheduledArrival);
  a.textContent = "Bei der DB öffnen";
  if (PP.native) {
    /* Der Suchlink oben nennt die KACHELN — danach hat der Nutzer gefragt.
       Der exakte Link braucht dagegen die tatsächlichen Ein- und Ausstiegshalte
       dieser Verbindung samt Koordinaten: Fängt sie mit einem Fußweg zu einem
       anderen Halt an, gehört die Abfahrtszeit zu diesem, nicht zur Kachel. */
    const ein = T[0].from, aus = T[T.length - 1].to;
    enableExactDbLink(a,
      { name: ein.name, lat: ein.lat, lon: ein.lon, mode: T[0].mode },
      { name: aus.name, lat: aus.lat, lon: aus.lon, mode: T[T.length - 1].mode },
      ein.scheduledDeparture, aus.scheduledArrival, T.length);
  }
  (foot || container).appendChild(a);
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

/* Wie die Station im DB-Link heißen soll. Transitous nennt Nahverkehrshalte oft
   nur beim nackten Namen — „Klinikum“, „Rathaus“, „Bismarckplatz“ —, die DB
   dagegen „Klinikum, Regensburg“. Steht der Ort schon im Namen (Bahnhöfe:
   „Regensburg Hbf“), wird nichts angehängt. */
function dbPlaceName(stop) {
  /* „<Stadt> Hauptbahnhof“ → „<Stadt> Hbf“. Transitous schreibt Hauptbahnhöfe
     aus (9 von 12 geprüften Großstädten), die DB kürzt ab — und über die
     Kennung findet sie die lange Form NICHT: „Hamburg Hauptbahnhof“ lieferte
     null Verbindungen, „Hamburg Hbf“ fünf. Nur die Form OHNE Komma wird
     gekürzt: „Hauptbahnhof, Regensburg“ ist ein Bushalt und heißt bei der DB
     auch so. */
  let n = String(stop?.name || "").replace(/^([^,]+)\s+Hauptbahnhof$/i, "$1 Hbf");
  /* Ort nur anhängen, wenn er nicht schon drinsteht — geprüft wird auch sein
     ERSTES Wort: „Frankfurt Hbf“ trägt die Stadt bereits, der Ort heißt aber
     amtlich „Frankfurt am Main“. Angehängt kam „Frankfurt Hbf, Frankfurt am
     Main“ heraus, und das findet die DB nicht (sie schreibt „Frankfurt(Main)Hbf“). */
  const ort = stop?.city;
  if (!ort) return n;
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const kopf = ort.split(/\s+/)[0];
  if (new RegExp(`\\b${esc(ort)}\\b`, "i").test(n)) return n;
  if (kopf.length > 3 && new RegExp(`\\b${esc(kopf)}\\b`, "i").test(n)) return n;
  return `${n}, ${ort}`;
}

/* Der Ortsteil eines DB-Links ist eine HAFAS-Kennung. Bisher stand darin nur der
   Name (`O=Klinikum`) — und ein Wort, das es deutschlandweit hundertfach gibt,
   findet die DB-Suche nicht: Nachgemessen liefert genau das NULL Verbindungen,
   während dieselbe Anfrage mit Koordinaten fünf liefert. Genau der gemeldete
   Fehler.

   Die Koordinaten haben wir längst (sie stecken in jeder Kachel), und die DB
   nimmt eine selbst gebaute Kennung an: `A=1@O=<Name>@X=<lon×1e6>@Y=<lat×1e6>@U=80@`
   funktioniert gegen den echten Endpunkt genauso gut wie die interne Kennung der
   DB — auch mit dem nackten Namen, weil die Koordinaten den Halt festlegen. Die
   ID der DB selbst ist im Browser nicht zu holen (CORS, gemessen: die
   Ortssuche schickt kein Access-Control-Allow-Origin), Koordinaten brauchen
   dagegen keine Anfrage.

   Ohne Koordinaten bleibt es beim Namen — dann wenigstens mit Ort dahinter. */
function dbPlaceId(stop) {
  const name = dbPlaceName(stop);
  if (Number.isFinite(stop?.lat) && Number.isFinite(stop?.lon)) {
    const x = Math.round(stop.lon * 1e6), y = Math.round(stop.lat * 1e6);
    return `A=1@O=${name}@X=${x}@Y=${y}@U=80@`;
  }
  return `A=1@O=${name}@`;
}

function dbLink(from, to, depIso, arrIso) {
  const enc = encodeURIComponent;
  const dep = localMinuteIso(depIso);
  /* Vorbefüllte Suche mit exakter Soll-Abfahrtszeit — die gewünschte Verbindung
     steht damit ganz oben in der Trefferliste. Das ist das Beste, was ohne
     Server geht, und bleibt auch im nativen Build der Rückfall, wenn die vbid
     nicht zustande kommt (siehe dblink.js). */
  return `https://www.bahn.de/buchung/fahrplan/suche#sts=true`
    + `&so=${enc(dbPlaceName(from))}&zo=${enc(dbPlaceName(to))}`
    + `&soid=${enc(dbPlaceId(from))}&zoid=${enc(dbPlaceId(to))}`
    + `&hd=${enc(dep + ":00")}`;
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
  name: "Jonas Seyfried",
  strasse: "Keplerstraße 16",
  ort: "93047 Regensburg",
};

function configLink() {
  // v2: Kacheln UND Einstellungen wandern gemeinsam
  const payload = { v: 2, slots, show: settings.show, cols: settings.cols,
                    fillMin: settings.fillMin, fillMax: settings.fillMax,
                    fit: settings.fitBottom, connect: settings.connectMode,
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
    const klemmFill = v => Math.min(95, Math.max(20, Math.round(v / 5) * 5));
    if (Number.isFinite(imported.fill)) { settings.fillMin = klemmFill(imported.fill); settings.fillMax = 90; }
    if (Number.isFinite(imported.fillMin)) settings.fillMin = klemmFill(imported.fillMin);
    if (Number.isFinite(imported.fillMax)) settings.fillMax = klemmFill(imported.fillMax);
    if (settings.fillMax < settings.fillMin) settings.fillMax = settings.fillMin;
    if (typeof imported.fit === "boolean") settings.fitBottom = imported.fit;
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
/* OHNE Echtzeitdaten kein Abzeichen. „+0“ hieße dort „bestätigt pünktlich“,
   gemeint ist aber nur „nichts Gegenteiliges bekannt“ — bei einer Fahrt in drei
   Tagen weiß niemand, ob sie pünktlich wird (nachgemessen: Transitous liefert
   dafür durchweg `realTime: false`). `timeWithDelay` macht genau diesen
   Unterschied bei den Uhrzeiten seit jeher; das Abzeichen zog nicht mit und
   behauptete Pünktlichkeit für jede Verbindung ohne Rückmeldung.
   Die Farbstufen bleiben, wie sie sind. */
function delayBadge(min, realTime) {
  if (!realTime) return "";
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
byId("btn-install").addEventListener("click", () => byId("install-dialog").showModal());

/* ---------------- Update-Prüfung (nur APK) ----------------
   Die Web-App braucht das nicht: Sie holt bei jedem Start neu, auch die zum
   Startbildschirm gelegte Fassung — der Service Worker geht netz-zuerst. Eine
   sideloadete APK dagegen erfährt von niemandem, dass es etwas Neues gibt: kein
   Store, kein Updater, und seit v1.60.1 auch kein „App installieren“ mehr im
   Menü. Deshalb fragt sie selbst bei GitHub nach.

   Die Releases-API schickt `Access-Control-Allow-Origin: *`, ein normales
   `fetch` genügt also — KEIN CapacitorHttp. Der native Stack bleibt bewusst auf
   dblink.js beschränkt, sonst verhielten sich Web- und App-Build verschieden.

   Höchstens alle sechs Stunden eine Anfrage: Unangemeldet erlaubt GitHub 60 je
   Stunde und IP, und öfter als ein paar Mal am Tag erscheint ohnehin nichts. */
const RELEASES_PAGE = "https://github.com/schogugel/pendelpanda/releases/latest";
const RELEASES_API = "https://api.github.com/repos/schogugel/pendelpanda/releases/latest";
const UPDATE_KEY = "pp.update";
const UPDATE_EVERY = 6 * 60 * 60 * 1000;

/* Vergleich Stelle für Stelle, nicht als Zeichenkette: „1.9.0“ ist als Text
   größer als „1.60.1“, als Version aber kleiner. Was sich nicht in Zahlen
   zerlegen lässt, gilt als NICHT neuer — ein falscher Hinweis wäre schlimmer
   als keiner. */
function versionNewer(kandidat, basis) {
  const teile = v => String(v).trim().replace(/^v/i, "").split(".").map(x => parseInt(x, 10));
  const a = teile(kandidat), b = teile(basis);
  if (a.some(Number.isNaN) || !a.length) return false;
  for (let i = 0; i < 3; i++) {
    const x = a[i] || 0, y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

function showUpdate(tag) {
  if (!versionNewer(tag, APP_VERSION)) return;
  const nr = String(tag).trim().replace(/^v/i, "");
  byId("btn-settings").classList.add("hasupdate");
  byId("update-note-sub").textContent =
    `Version ${nr} steht bereit – du hast ${APP_VERSION}. Antippen öffnet die Download-Seite.`;
  byId("update-note").hidden = false;
}

async function checkForUpdate() {
  if (!PP.native) return;
  let cache = null;
  try { cache = JSON.parse(localStorage.getItem(UPDATE_KEY) || "null"); } catch { /* egal */ }
  if (cache && cache.tag) showUpdate(cache.tag);          // sofort, ohne aufs Netz zu warten
  if (cache && Date.now() - cache.at < UPDATE_EVERY) return;
  try {
    const res = await fetch(RELEASES_API, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) return;
    const tag = String((await res.json()).tag_name || "").trim();
    if (!tag) return;
    localStorage.setItem(UPDATE_KEY, JSON.stringify({ at: Date.now(), tag }));
    showUpdate(tag);
  } catch { /* offline oder GitHub streikt — dann eben kein Hinweis */ }
}

/* Nativ fängt platform.js Klicks auf http(s)-Links ab und schickt sie per Intent
   nach draußen. Der Hinweis ist ein <a> und läuft damit ohne Zutun richtig; die
   Adresse steht trotzdem hier, damit sie nur an EINER Stelle gepflegt wird. */
byId("update-note").href = RELEASES_PAGE;
/* In der APK ganz weg: Eine Anleitung zum Installieren zu zeigen, während man
   in der installierten App sitzt, ist Unsinn. Preis dieser Entscheidung: Die
   sideloadete App hat damit KEINEN Hinweis mehr auf neue Fassungen — sie
   aktualisiert sich nicht selbst, und niemand sagt ihr Bescheid. Wenn das
   wehtut, ist der Weg zurück eine eigene Zeile „Nach Updates suchen“, nicht
   diese hier. */
if (PP.native) byId("install-group").hidden = true;
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
  byId("set-fitbottom").checked = !!settings.fitBottom;
  renderFillRange();
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

byId("btn-full").addEventListener("click", () => loadAllCategories());

/* Reiner Anzeige-Schalter: kein Nachladen, keine Anfrage. Die Grafik behält
   dabei ihre Stelle nicht — die Spaltenzahl ändert sich ja —, deshalb wird der
   Zoom neu bestimmt wie bei einer geänderten Frage. */
byId("btn-fast").addEventListener("click", () => {
  app.hideDominated = !app.hideDominated;
  localStorage.setItem("pp.fastonly", app.hideDominated ? "1" : "0");
  tl.forceAutoZoom = true;
  /* Kurzes Überblenden statt hartem Umschalten. Bewusst NUR die Deckkraft des
     Rahmens — an Bewegung, Zoom und Einrasten wird dafür nichts angefasst. */
  const wrap = byId("timeline-wrap");
  wrap.classList.add("swap");
  renderResults();
  requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.remove("swap")));
});

byId("set-fitbottom").addEventListener("change", (e) => {
  settings.fitBottom = e.target.checked;
  syncZoomReset();
  saveSettings();
  if (app.viewMode === "graph" && tl.itins.length) {
    tl.lastZoomIdx = null;
    tl.forceAutoZoom = true;
    renderResults();
  }
});

/* Die beiden Regler begrenzen einander: Die Obergrenze darf nie unter die
   Untergrenze rutschen. Statt die Eingabe abzulehnen (der Regler spränge dann
   unter dem Finger zurück) wird der jeweils andere mitgenommen — das ist die
   Bewegung, die man von einem Spannen-Regler erwartet. */
function renderFillRange() {
  byId("set-fillmin").value = settings.fillMin;
  byId("set-fillmax").value = settings.fillMax;
  byId("set-fillmin-val").textContent = `${settings.fillMin}\u00a0%`;
  byId("set-fillmax-val").textContent = `${settings.fillMax}\u00a0%`;
  syncZoomReset();
}

/* Der Zurücksetzen-Knopf ist stumpf, solange alle drei Werte auf Standard
   stehen — sonst verspricht er eine Wirkung, die er nicht hat. Er hängt an
   `ZOOM_DEFAULTS`, also an derselben Quelle wie die Auslieferungswerte. */
function zoomIsDefault() {
  return Object.keys(ZOOM_DEFAULTS).every(k => settings[k] === ZOOM_DEFAULTS[k]);
}
function syncZoomReset() {
  byId("set-zoom-reset").disabled = zoomIsDefault();
}

byId("set-zoom-reset").addEventListener("click", () => {
  if (zoomIsDefault()) return;
  Object.assign(settings, ZOOM_DEFAULTS);
  byId("set-fitbottom").checked = settings.fitBottom;
  renderFillRange();      // setzt beide Regler UND den Knopf-Zustand
  applyZoomSetting();     // speichern und sofort in der laufenden Ansicht zeigen
});

function applyZoomSetting() {
  saveSettings();
  // sofort sichtbar machen: neuer Zoom gilt für die laufende Ansicht
  if (app.viewMode === "graph" && tl.itins.length) {
    tl.lastZoomIdx = null;
    tl.forceAutoZoom = true;   // die Einstellung steuert genau diesen Automatismus
    renderResults();
  }
}

byId("set-fillmin").addEventListener("input", (e) => {
  settings.fillMin = Number(e.target.value);
  if (settings.fillMax < settings.fillMin) settings.fillMax = settings.fillMin;
  renderFillRange();
  applyZoomSetting();
});
byId("set-fillmax").addEventListener("input", (e) => {
  settings.fillMax = Number(e.target.value);
  if (settings.fillMin > settings.fillMax) settings.fillMin = settings.fillMax;
  renderFillRange();
  applyZoomSetting();
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
   schaltet frei — dann 15 bis 40 plus Wahl des Verbinde-Modus.
   Verkleinern kann nie belegte Kacheln löschen.
   Früher wurde auf gerade Zahlen aufgerundet, damit die letzte Reihe im
   zweispaltigen Raster voll ist. Das ist kein Grund, eine Zahl zu verweigern:
   Ab 480 px sind es ohnehin drei Spalten, dort war „gerade“ genauso oft
   krumm — und eine halb leere letzte Reihe stört niemanden. */
function lastUsedIndex() {
  let last = -1;
  slots.forEach((s, i) => { if (s) last = i; });
  return last;
}

function setSlotCount(n) {
  n = Math.max(BASE_SLOTS, Math.min(MAX_SLOTS, Math.round(n)));
  n = Math.max(n, lastUsedIndex() + 1);
  while (slots.length < n) slots.push(null);
  slots.length = n;
  saveSlots();
  renderGrid();
}

function refreshTileOpts() {
  const more = slots.length > BASE_SLOTS;
  byId("set-more").checked = more;
  byId("more-tiles-opts").hidden = !more;
  byId("set-count").value = Math.max(BASE_SLOTS + 1, slots.length);
  const mode = settings.connectMode === "tap" ? "tap" : "hybrid";
  byId("set-connect").dataset.idx = mode === "tap" ? 1 : 0;
  byId("set-connect").querySelectorAll("button").forEach(b =>
    b.classList.toggle("active", b.dataset.mode === mode));
}

byId("set-more").addEventListener("change", () => {
  if (byId("set-more").checked) {
    setSlotCount(BASE_SLOTS + 2); // eine volle Reihe mehr als der Standard
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
  setSlotCount(Number(byId("set-count").value) || BASE_SLOTS + 1);
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
checkForUpdate();

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
