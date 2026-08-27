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
  DEP_LBL: 18,      // Zeile für die Abfahrtszeit über dem Balken
  /* Ab dieser Höhe lohnt sich das Verspätungsstück mit eigener Beschriftung.
     Darunter (weit herausgezoomt, kleine Verspätung) wären es ein paar Pixel
     mit zwei Uhrzeiten übereinander — dann bleibt es beim schlichten Balken ab
     der Prognose. 16 px trägt eine Zeile knapp und lässt die Zeit noch lesen. */
  LATE_MIN_H: 16,
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
  animFrame: 0,      // laufende Verfahrbewegung (Zoom + Position in einem)
  tickStepFest: null, // Linienraster während der Bewegung eingefroren
  manualZoom: false,  // hat der Nutzer selbst gezoomt? dann nicht überschreiben
  forceAutoZoom: false, // einmalig zurück auf automatisch (Legende, Einstellung)
  keepAnchor: null,   // vorab gesicherte Position, wenn die Grafik zwischendurch geleert wird
};

/* Wo steht die Ansicht GERADE? Muss abrufbar sein, BEVOR jemand die Grafik
   leert: Das Einblenden eines Verkehrsmittels lädt nach und zeigt dabei den
   Suchbalken, wodurch `#timeline` geleert wird — und ein geleertes Scrollfeld
   meldet `scrollLeft = 0`. Der Anker wurde also anschließend von der Position
   „ganz links“ genommen, und die Ansicht sprang auf die erste Spalte.
   Deshalb: vorher sichern (`tl.keepAnchor`), nachher einsetzen. */
function tlAnchor() {
  const sc = byId("timeline");
  if (!sc || !tl.ppm || !tl.itins.length) return null;
  const idx = Math.max(0, colIndexFor(sc.scrollLeft));
  return {
    time: tl.t0 + (sc.scrollTop / tl.ppm) * 60000,
    key: tl.itins[idx] ? itKey(tl.itins[idx]) : null,
    offset: sc.scrollLeft - colScrollLeft(idx),
  };
}

function tlY(ms) { return (ms - tl.t0) / 60000 * tl.ppm; }

/* Spalte i liegt im Aufbau bei `AXIS_W + GAP + i·Schritt` (siehe tlBuild).
   Damit sie beim Einrasten bündig rechts neben der Zeitachse steht, gehört das
   GAP in die Scrollposition. Es fehlte — deshalb rastete die Ansicht acht Pixel
   zu weit links ein, und vom vorherigen Balken blieb ein Streifen unter dem
   ausblendenden Rand der Achse sichtbar. Beide Rechnungen stehen hier an EINER
   Stelle, damit sie nicht wieder auseinanderlaufen. */
const tlStep = () => tl.colW + TL.GAP;
const colScrollLeft = i => TL.GAP + i * tlStep();
const colIndexFor = x => Math.round((x - TL.GAP) / tlStep());

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

/* ---------------------------------------------------------------------------
   Hinweise und Risiken

   DREI Klassen mit je eigenem Symbol — bewusst nicht ein Dreieck für alles,
   weil „Aufzug defekt“ und „diesen Anschluss verpasst du“ nichts miteinander
   zu tun haben:

     broken  Nach der Echtzeit-Prognose NICHT mehr erreichbar
     tight   Erreichbar, aber ohne Reserve
     notice  Meldung (Störung, ausgelassener Halt, Hinweis am Umstiegshalt)

   Woher die Texte kommen: Verbindungssuche (/plan) liefert KEINE Meldungs-
   texte — nachgemessen, das Feld gibt es dort nicht. Echte Meldungen hängen
   an den HALTEN und kommen über /stoptimes (siehe stopAlerts in app.js).
   Alles, was hier steht, ist dagegen aus den Zeitfeldern gerechnet und daher
   immer verfügbar.

   Was hier bewusst NICHT auftaucht: der Gleiswechsel. Der steht bereits
   direkt an der Gleisangabe („Gl. 7 statt 3“), wo man ihn beim Einsteigen
   sucht — in einem Aufklapper wäre er schlechter aufgehoben, nicht besser.
   --------------------------------------------------------------------------- */

/* Die SYMBOLE dazu stehen weiter unten bei den übrigen Icons — `svgIcon` ist
   ein const und hier oben noch nicht initialisiert. */
const RISK_RANK = { notice: 1, tight: 2, broken: 3 };
const RISK_LABEL = {
  broken: "Anschluss nach Prognose nicht erreichbar",
  tight: "Umstieg ohne Reserve",
  notice: "Meldung",
};

// Symbol + Beschriftung für eine Risikoklasse
function riskMark(level, extra = "") {
  if (!level) return "";
  return `<span class="risk risk-${level}${extra}" title="${RISK_LABEL[level]}" ` +
    `aria-label="${RISK_LABEL[level]}">${RISK_ICON[level]}</span>`;
}

const toMin = ms => Math.round(ms / 60000);
const worst = (a, b) => ((RISK_RANK[b] || 0) > (RISK_RANK[a] || 0) ? b : a) || null;

/* Die Fußwege zwischen zwei Fahrten über die POSITION im leg-Array suchen,
   nicht über die Uhrzeit. Ein Zeitfenster-Filter („Fußweg liegt zwischen
   Ankunft und Abfahrt“) setzt voraus, dass der Fußweg noch in die Lücke passt
   — und blendet damit ausgerechnet den Fall aus, um den es geht: den Fußweg,
   der wegen einer Verspätung nicht mehr hineinpasst. */
function walkLegsBetween(legs, prev, next) {
  const a = legs.indexOf(prev), b = legs.indexOf(next);
  if (a < 0 || b < 0) return [];
  return legs.slice(a + 1, b).filter(l => l.mode === "WALK");
}

function transferIssues(it, prev, next) {
  const notes = [];
  let level = null;
  const walk = walkLegsBetween(it.legs, prev, next);
  const walkMin = Math.round(walk.reduce((a, l) => a + l.duration, 0) / 60);
  const buf = toMin(+new Date(next.from.departure) - +new Date(prev.to.arrival));
  const plan = toMin(+new Date(next.from.scheduledDeparture) - +new Date(prev.to.scheduledArrival));
  const slack = buf - walkMin;
  const late = plan - buf; // wie viel die Echtzeitlage vom Puffer weggenommen hat

  if (slack < 0) {
    level = "broken";
    notes.push(walkMin
      ? `Der Fußweg dauert ${walkMin} min, bis zur Abfahrt bleiben aber nur ${buf} min.`
      : `Der Anschluss fährt ${Math.abs(buf)} min vor der Ankunft ab.`);
  } else if (slack <= 2 && late > 0) {
    /* „Knapp“ meldet nur, wenn die ECHTZEITLAGE den Puffer gefressen hat.
       Ein von vornherein knapp geplanter Umstieg ist bei MOTIS der Normalfall
       (an 84 echten Verbindungen gemessen: ein Drittel hat ≤1 min Reserve) —
       ihn zu markieren hieße, ein Drittel aller Verbindungen zu markieren. */
    level = "tight";
    notes.push(`${slack === 0 ? "Keine Reserve mehr" : `Nur noch ${slack} min Reserve`}: ` +
      `${buf} min Umstiegszeit${walkMin ? `, davon ${walkMin} min Fußweg` : ""}.`);
  }

  if (late >= 5) {
    level = worst(level, level === "broken" ? "broken" : "tight");
    notes.push(`Verspätung verkürzt den Umstieg von ${plan} auf ${buf} min.`);
  }

  /* Ein „cancelled“ auf dem Fußweg ist KEIN Ausfall des Anschlusses, sondern
     eine Echtzeitmeldung am Umstiegshalt (die Direktsuche zeigt dieselben
     Anschlüsse als fahrend) — deshalb Hinweis, nicht Ausfall. */
  if (walk.some(legCancelled)) {
    level = worst(level, "notice");
    notes.push("Am Umstiegshalt liegt eine Echtzeitmeldung vor — prüfe vor Ort die Anzeigen.");
  }

  return { level, notes };
}

function legIssues(l) {
  const notes = [];
  const skipped = (l.intermediateStops || []).filter(s => s.cancelled);
  if (skipped.length) notes.push(`Hält nicht in ${skipped.map(s => s.name).join(", ")}.`);
  return { level: notes.length ? "notice" : null, notes };
}

// Gesamtlage einer Verbindung — speist das Symbol in der Übersicht
function itinIssues(it) {
  const T = it.legs.filter(l => l.mode !== "WALK");
  let level = null;
  const notes = [];
  T.forEach((l, i) => {
    const a = legIssues(l);
    level = worst(level, a.level); notes.push(...a.notes);
    if (i < T.length - 1) {
      const b = transferIssues(it, l, T[i + 1]);
      level = worst(level, b.level); notes.push(...b.notes);
    }
  });
  return { level, notes };
}

// „RB51 (84185)“ → Hauptkennung „RB51“ + Zusatznummer „84185“
function lineParts(l) {
  const full = (l.routeShortName || l.displayName || "").trim();
  const m = full.match(/^(.+?)\s*\(([^)]+)\)$/);
  return m ? { main: m[1], extra: m[2] } : { main: full, extra: null };
}

/* Schienenersatzverkehr erkennen: Der Ersatz fährt als BUS, trägt aber die
   Nummer der Bahnlinie (z. B. „RB30“ mit routeType 3). Zusätzlich greifen
   ausdrückliche Kennzeichnungen wie „SEV“ oder „Ersatz“ im Namen. */
function isReplacementService(l) {
  if (l.mode !== "BUS" && l.mode !== "COACH") return false;
  const name = `${l.routeShortName || ""} ${l.displayName || ""}`.trim();
  if (/^(RB|RE|IRE|RS|MEX|S|IC|ICE|EC)\s?\d/i.test(name)) return true;
  return /\bSEV\b|ersatz/i.test(`${name} ${l.routeLongName || ""} ${l.headsign || ""}`);
}

// Google-Maps-Link zu einem Halt (Koordinaten stecken in jeder Antwort)
function mapsPin(place, title = "Haltestelle in Google Maps öffnen") {
  if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)) return "";
  const q = `${place.lat},${place.lon}`;
  return `<a class="mappin" href="https://www.google.com/maps/search/?api=1&query=${q}"` +
    ` target="_blank" rel="noopener" title="${title}" aria-label="${title}">📍</a>`;
}

/* Gleis + Karten-Pin als EIN Element: Die Koordinaten sind bahnsteiggenau
   (verschiedene Gleise desselben Bahnhofs haben verschiedene Positionen),
   Gleisangabe und Kartenlink gehören also zusammen. Ohne Gleisangabe
   (Busse) bleibt nur der Pin. */
function trackChip(place, what = "Halt") {
  if (!place) return "";
  const track = place.track;
  if (!track) return mapsPin(place, `${what} in Google Maps öffnen`);
  const changed = place.scheduledTrack && place.scheduledTrack !== track;
  const q = Number.isFinite(place.lat) ? `${place.lat},${place.lon}` : null;
  const inner =
    `<span class="tc-key">Gl.</span><span class="tc-no">${escapeHtml(String(track))}</span>` +
    (changed ? `<span class="tc-old">statt ${escapeHtml(String(place.scheduledTrack))}</span>` : "") +
    (q ? `<span class="tc-pin">📍</span>` : "");
  const cls = `trackchip${changed ? " changed" : ""}`;
  const title = `Gleis ${track}${changed ? ` (geändert, planmäßig ${place.scheduledTrack})` : ""}` +
    (q ? " – in Google Maps öffnen" : "");
  return q
    ? `<a class="${cls}" href="https://www.google.com/maps/search/?api=1&query=${q}" target="_blank" rel="noopener" title="${title}">${inner}</a>`
    : `<span class="${cls}" title="${title}">${inner}</span>`;
}

/* Verkehrsmittel-Symbole als schlichte weiße Linienzeichnungen (currentColor),
   passend zur Chip-Farbe der Kategorie. U-Bahn und S-Bahn tragen ihr
   klassisches Buchstaben-Signet, alles andere ein Fahrzeug-Piktogramm. */
const svgIcon = (inner) =>
  `<svg class="mi" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" ` +
  `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

/* Fahrzeugsymbole aus den Vorlagen in icons/ nachgezeichnet (tools/trace-icons.mjs).
   Es sind FLÄCHEN, keine Linien — deshalb `svgSolid` statt `svgIcon`. Sie zeichnen
   mit `currentColor` und nehmen damit die Schriftfarbe des Segments an: auf hellem
   Grund dunkel, auf dunklem hell. Als PNG eingebunden würden sie auf der hellen
   ICE-Farbe verschwinden. */
const svgSolid = (d) =>
  `<svg class="mi" viewBox="0 0 128 128" fill="currentColor" fill-rule="evenodd" ` +
  `aria-hidden="true"><path d="${d}"/></svg>`;

const ICON = {
  fern: svgSolid(`M 44.803 11.350 C 28.827 15.819, 24.778 23.516, 22.550 53.647 C 20.370 83.128, 20.797 84.276, 37.776 94.592 L 47.500 100.500 64.030 100.500 L 80.559 100.500 90.935 94 C 106.383 84.322, 107.232 82.382, 105.828 59.945 C 103.724 26.338, 101.212 19.689, 88.204 13.301 C 81.419 9.969, 54.126 8.742, 44.803 11.350 M 43.970 27.250 C 30.173 34.220, 31.384 55.957, 45.791 59.959 C 51.659 61.589, 79.373 61.289, 83.533 59.551 C 97.068 53.896, 97.097 33.036, 83.579 26.896 C 76.983 23.901, 50.125 24.140, 43.970 27.250 M 41.455 74.455 C 36.730 79.179, 39.620 86, 46.345 86 C 52.922 86, 55.564 78.162, 50.365 74.073 C 46.905 71.351, 44.453 71.456, 41.455 74.455 M 77.635 74.073 C 72.354 78.227, 75.087 86, 81.829 86 C 88.383 86, 91.199 79.108, 86.545 74.455 C 83.547 71.456, 81.095 71.351, 77.635 74.073 M 27.022 98.250 C 27.111 103.299, 35.385 114.427, 40.702 116.649 C 45.312 118.575, 82.724 118.560, 87.343 116.630 C 91.527 114.882, 97.468 107.960, 99.619 102.327 C 101.873 96.425, 101.045 96.112, 94.563 100.415 C 83.732 107.604, 82.309 107.954, 63.823 107.978 L 47.145 108 40.578 104.577 C 36.967 102.694, 32.823 100.219, 31.371 99.077 C 28.357 96.707, 26.990 96.447, 27.022 98.250`),
  regio: svgSolid(`M 45.137 15.369 C 31.339 20.363, 29.562 25.469, 29.196 61.183 C 28.853 94.575, 29.300 97.067, 36.260 100.607 C 38.042 101.513, 39.667 102.402, 39.871 102.582 C 40.076 102.762, 39.063 104.923, 37.621 107.383 C 34.149 113.308, 34.289 114, 38.965 114 C 41.906 114, 43.206 113.484, 44 112 C 45.012 110.108, 46.094 110, 64 110 C 81.906 110, 82.988 110.108, 84 112 C 84.794 113.484, 86.094 114, 89.035 114 C 93.736 114, 93.798 113.680, 90.310 107.439 C 88.346 103.924, 87.967 102.511, 88.907 102.198 C 97.951 99.183, 99.201 93.860, 98.821 60 C 98.432 25.433, 96.175 19.365, 82.142 15.161 C 76.975 13.613, 49.564 13.767, 45.137 15.369 M 53.667 21.667 C 50.172 25.161, 53.893 27, 64.459 27 C 73.099 27, 75.893 25.769, 74.643 22.513 C 74.038 20.936, 55.158 20.175, 53.667 21.667 M 42.500 34.155 C 38.512 36.336, 38 38.047, 38 49.191 C 38 64.820, 36.579 64.004, 63.750 63.985 C 90.792 63.966, 90 64.415, 90 49.113 C 90 38.665, 88.891 35.506, 84.713 34.050 C 80.647 32.632, 45.122 32.721, 42.500 34.155 M 41 78 C 35.566 83.434, 42.309 90.692, 48.365 85.927 C 52.612 82.587, 50.379 76, 45 76 C 43.900 76, 42.100 76.900, 41 78 M 79 78 C 77.900 79.100, 77 80.900, 77 82 C 77 83.100, 77.900 84.900, 79 86 C 80.100 87.100, 81.900 88, 83 88 C 84.100 88, 85.900 87.100, 87 86 C 88.100 84.900, 89 83.100, 89 82 C 89 80.900, 88.100 79.100, 87 78 C 85.900 76.900, 84.100 76, 83 76 C 81.900 76, 80.100 76.900, 79 78 M 50.161 100.547 C 49.522 101.948, 49 103.197, 49 103.324 C 49 103.450, 55.750 103.541, 64 103.527 C 72.250 103.512, 79 103.263, 79 102.973 C 79.002 97.281, 52.658 95.065, 50.161 100.547`),
  sbahn: svgSolid(`M 25 8.922 C 8.982 12.220, 8 15.402, 8 64.008 C 8 121.539, 5.415 119, 64 119 C 122.789 119, 120.219 121.633, 119.787 61.835 L 119.500 22.169 116.456 17.835 C 114.781 15.451, 111.406 12.375, 108.956 11 L 104.500 8.500 66.500 8.351 C 45.600 8.269, 26.925 8.526, 25 8.922 M 21.898 18.270 C 15.082 22.823, 15.003 23.343, 15.003 63.500 C 15.003 115.388, 10.477 111, 64 111 C 117.523 111, 112.997 115.388, 112.997 63.500 C 112.997 11.612, 117.523 16, 64 16 C 25.426 16, 25.284 16.008, 21.898 18.270 M 58.326 32.988 C 46.467 35.493, 39.321 45.050, 41.965 54.869 C 44.010 62.466, 49.032 66.266, 63.174 70.917 C 70.768 73.415, 72.278 74.755, 71.822 78.591 C 70.804 87.155, 55.105 87.657, 44.371 79.469 C 39.994 76.131, 40 76.125, 40 83.385 C 40 90.922, 41.117 92.047, 51.162 94.620 C 86.542 103.684, 103.981 68.879, 69.464 58.090 C 58.936 54.799, 56 52.926, 56 49.500 C 56 42.690, 68.338 41.178, 78.253 46.774 L 84 50.017 84 43.598 L 84 37.178 79.750 35.133 C 74.827 32.763, 64.355 31.715, 58.326 32.988`),
  ubahn: svgSolid(`M 25.481 16.375 C 14.916 21.044, 13.835 25.828, 14.200 66.292 C 14.537 103.596, 14.423 102.993, 22.343 109.394 L 26.186 112.500 64 112.500 L 101.814 112.500 105.657 109.394 C 113.679 102.910, 113.500 103.948, 113.500 64 C 113.500 24.053, 113.679 25.091, 105.658 18.606 L 101.817 15.500 65.158 15.271 C 36.378 15.090, 27.851 15.328, 25.481 16.375 M 28.096 23.265 C 21.607 26.600, 21.529 27.035, 21.199 61.838 C 20.745 109.662, 17.196 106, 64 106 C 110.791 106, 107.225 109.678, 106.789 61.873 C 106.472 27.028, 106.395 26.601, 99.904 23.265 C 96.473 21.502, 31.527 21.502, 28.096 23.265 M 38 54.818 C 38 85.968, 43.463 94.279, 64 94.372 C 84.219 94.464, 89.353 86.984, 89.822 56.750 L 90.145 36 83.072 36 L 76 36 76 54.032 C 76 77.477, 74.059 82, 64 82 C 53.941 82, 52 77.477, 52 54.032 L 52 36 45 36 L 38 36 38 54.818`),
  tram: svgSolid(`M 48.441 16.441 C 44.884 19.083, 47.720 21.452, 54.854 21.798 L 61 22.095 61 26.048 L 61 30 54.148 30 C 43.797 30, 37.294 35.212, 36.266 44.332 C 35.850 48.022, 35.346 48.951, 33.626 49.197 C 30.231 49.681, 30.349 68.337, 33.750 68.820 C 35.934 69.130, 36 69.475, 36 80.619 C 36 93.189, 37.110 96.946, 41.505 99.249 L 43.985 100.548 40.383 105.897 C 37.537 110.124, 37.066 111.427, 38.140 112.108 C 41.204 114.049, 43.144 112.907, 46.793 107.011 L 50.500 101.022 64.066 101.011 L 77.632 101 79.964 105.250 C 84.084 112.755, 86.354 114.329, 89.860 112.108 C 90.934 111.427, 90.463 110.124, 87.617 105.897 L 84.015 100.548 86.495 99.249 C 90.890 96.946, 92 93.189, 92 80.619 C 92 69.475, 92.066 69.130, 94.250 68.820 C 97.651 68.337, 97.769 49.681, 94.374 49.197 C 92.654 48.951, 92.150 48.022, 91.734 44.332 C 90.706 35.212, 84.203 30, 73.852 30 L 67 30 67 26.048 L 67 22.095 73.146 21.798 C 80.280 21.452, 83.116 19.083, 79.559 16.441 C 76.775 14.374, 51.225 14.374, 48.441 16.441 M 47.691 36.643 C 43.429 40.904, 48.885 43, 64.243 43 C 78.446 43, 81.559 42.144, 80.846 38.434 C 80.465 36.451, 49.552 34.781, 47.691 36.643 M 43.434 50.461 C 41.351 53.639, 41.692 73.727, 43.872 76.350 C 45.059 77.776, 47.795 78, 64.066 78 C 87.161 78, 86 78.809, 86 62.712 C 86 46.910, 87.595 48, 64.488 48 L 45.046 48 43.434 50.461 M 44.452 86.433 C 42.570 89.306, 43.736 92.464, 47.071 93.522 C 51.631 94.970, 55.252 87.276, 51.066 85.035 C 48.030 83.410, 46.176 83.802, 44.452 86.433 M 76.200 85.200 C 72.262 89.138, 77.143 95.600, 82.066 92.965 C 85.952 90.885, 83.981 84, 79.500 84 C 78.345 84, 76.860 84.540, 76.200 85.200`),
  bus: svgSolid(`M 38.619 20.034 C 31.940 22.034, 28 28.287, 28 36.887 L 28 42.873 24.750 43.187 C 22.230 43.430, 21.426 44.019, 21.172 45.811 C 20.992 47.082, 20.205 48.368, 19.422 48.668 C 18.398 49.061, 18 51.002, 18 55.607 L 18 62 21.500 62 L 25 62 25 54.500 C 25 48.500, 25.300 47, 26.500 47 C 27.790 47, 28 50.233, 28 70.099 L 28 93.198 31 96 C 32.962 97.832, 34.005 99.788, 34.015 101.651 C 34.039 106, 35.379 107.347, 39.527 107.191 C 44.348 107.010, 46 105.526, 46 101.378 L 46 98 64 98 L 82 98 82 101.378 C 82 108.617, 93.233 109.765, 93.820 102.586 C 94.048 99.806, 94.990 97.878, 97.070 95.934 L 100 93.198 100 70.099 C 100 50.233, 100.210 47, 101.500 47 C 102.700 47, 103 48.500, 103 54.500 L 103 62 106.500 62 L 110 62 110 55.607 C 110 51.002, 109.602 49.061, 108.578 48.668 C 107.795 48.368, 107.008 47.082, 106.828 45.811 C 106.574 44.019, 105.770 43.430, 103.250 43.187 L 100 42.873 100 36.585 C 100 28.813, 97.483 24.510, 91.030 21.250 C 86.273 18.847, 45.726 17.906, 38.619 20.034 M 47.930 25.584 C 44.617 29.576, 47.637 30.500, 64 30.500 C 80.363 30.500, 83.383 29.576, 80.070 25.584 C 78.121 23.236, 49.879 23.236, 47.930 25.584 M 35.861 37.909 C 32.312 40.780, 31.642 66.003, 35.001 70.274 L 37.145 73 64 73 L 90.855 73 92.999 70.274 C 96.358 66.003, 95.688 40.780, 92.139 37.909 C 88.516 34.979, 39.484 34.979, 35.861 37.909 M 37.116 82.580 C 34.580 85.804, 34.505 86.848, 36.595 89.832 C 38.912 93.139, 44.853 92.545, 46.948 88.796 C 50.288 82.818, 41.366 77.177, 37.116 82.580 M 82.116 82.580 C 79.580 85.804, 79.505 86.848, 81.595 89.832 C 83.912 93.139, 89.853 92.545, 91.948 88.796 C 95.288 82.818, 86.366 77.177, 82.116 82.580`),
  // Linienzeichnungen, die bleiben: Fußweg und Fähre
  walk: svgIcon(`<circle cx="9.3" cy="2.9" r="1.5"/><path d="M9.3 5.3 7.7 8.4l1.3 1.5.8 3.9"/>` +
    `<path d="M7.7 8.4 5.5 10"/><path d="M9 9.9 7 13.7"/><path d="M9.9 6.5l2 1.3"/>`),
  ferry: svgIcon(`<path d="M3.2 9.4h9.6l-1.5 3.1H4.7z"/><path d="M8 9.4V4.3"/>` +
    `<path d="M8 4.6h3.1L8 6.7"/><path d="M2.4 14.2c1.3.9 2.7.9 4 0s2.7-.9 4 0"/>`),
};

/* Symbole der drei Risikoklassen (die Logik dazu steht oben bei
   `transferIssues`). Sie gehören ZWINGEND hierher, unter `svgIcon`: Weiter oben
   aufgerufen, wirft die Datei beim Laden. Funktionsdeklarationen werden dabei
   trotzdem gehoistet, deshalb sieht man von der eigentlichen Ursache nichts —
   nur einen kryptischen Folgefehler („cannot access X before initialization“)
   an ganz anderer Stelle. Genau das ist in v1.7.0 passiert. */
const RISK_ICON = {
  broken: svgIcon(`<circle cx="8" cy="8" r="5.6"/><path d="M4.6 4.6l6.8 6.8"/>`),
  tight: svgIcon(`<path d="M4.6 2.5h6.8"/><path d="M4.6 13.5h6.8"/>` +
    `<path d="M5.5 2.5v2.2L8 7.3l2.5-2.6V2.5"/><path d="M5.5 13.5v-2.2L8 8.7l2.5 2.6v2.2"/>`),
  notice: svgIcon(`<path d="M8 2.7 14 13.3H2z"/><path d="M8 6.7v3"/><path d="M8 11.5h.01"/>`),
};

/* Symbol passend zum konkreten Verkehrsmittel. Für „Sonstige“ gibt es bewusst
   KEIN allgemeines Zeichen — außer der Fähre, die eines verdient hat. Ein
   Platzhalter für alles Unbekannte behauptet mehr, als wir wissen; die
   Liniennummer daneben sagt ohnehin mehr. */
function modeIcon(l) {
  const m = l.mode;
  if (m === "SUBWAY") return ICON.ubahn;
  if (m === "SUBURBAN" || m === "METRO") return ICON.sbahn;
  if (m === "TRAM") return ICON.tram;
  if (m === "BUS" || m === "COACH") return ICON.bus;
  if (["HIGHSPEED_RAIL", "LONG_DISTANCE", "NIGHT_RAIL"].includes(m)) return ICON.fern;
  if (["REGIONAL_RAIL", "REGIONAL_FAST_RAIL", "RAIL"].includes(m)) return ICON.regio;
  if (m === "FERRY") return ICON.ferry;
  return "";
}

function productClass(mode) {
  if (["HIGHSPEED_RAIL", "LONG_DISTANCE", "NIGHT_RAIL"].includes(mode)) return "fern";
  if (["REGIONAL_RAIL", "REGIONAL_FAST_RAIL", "RAIL"].includes(mode)) return "regio";
  if (["SUBURBAN", "METRO"].includes(mode)) return "sbahn";
  if (mode === "SUBWAY") return "ubahn";
  if (mode === "TRAM") return "tram";
  if (mode === "COACH") return "fernbus";
  if (mode === "BUS") return "bus";
  return "sonstige"; // Fähren, Rufbusse/On-Demand, Rest
}
function renderTimeline(itins, focus = "start") {
  const scroller = byId("timeline");
  tlStop();   // eine noch laufende Verfahrbewegung gehört zur vorherigen Ansicht
  const sameSearch = tl.searchTag === app.searchTag;
  /* Welche Verbindung markiert ist, gehört zur SUCHE, nicht zum Neuaufbau.
     Vorher wurde die Markierung nur im Fokus-Zweig gesetzt; sobald ein
     Nachladen die Ansicht neu baute (dann gilt keepScroll), war sie weg. */
  if (!sameSearch) tl.focusKey = null;
  if (focus && focus !== "start" && focus !== "end") tl.focusKey = focus;
  tl.searchTag = app.searchTag;
  /* Position halten bei JEDEM Neuaufbau innerhalb derselben Suche — nicht nur
     wenn Verbindungen dazukamen. Ein Nachladen ohne Treffer hat sonst die
     Ansicht auf den Startzustand zurückgeworfen („springt auf Jetzt zurück“). */
  const keepScroll = sameSearch && tl.itins.length > 0;
  const prev = { left: scroller.scrollLeft, top: scroller.scrollTop };
  /* Anker für „nichts darf springen“: Zeit an der Oberkante + die Spalte am
     linken Rand samt Feinversatz. Über den Spalten-SCHLÜSSEL statt Index —
     neue Verbindungen können auch MITTEN einsortiert werden, dann verschiebt
     ein reiner Index-Vergleich die Ansicht. Der Zeit-Anker ist zusätzlich
     robust gegen geänderte Zoomstufen. */
  let anchor = null;
  if (tl.keepAnchor) {
    anchor = tl.keepAnchor;      // vor dem Leeren gesichert, siehe tlAnchor()
    tl.keepAnchor = null;
  } else if (keepScroll && tl.ppm) {
    const idx = Math.max(0, colIndexFor(prev.left));
    anchor = {
      time: tl.t0 + (prev.top / tl.ppm) * 60000,
      key: tl.itins[idx] ? itKey(tl.itins[idx]) : null,
      offset: prev.left - colScrollLeft(idx),
    };
  }
  /* Bei einer geänderten FRAGE (Legende, „Höhe der vordersten Verbindung“) wird
     der Zoom neu bestimmt — dann ist die alte Oberkanten-Zeit kein sinnvolles
     Ziel mehr, sie stammt aus einem anderen Maßstab. Die Spalte bleibt, wo sie
     war, aber senkrecht greift wieder die automatische Ausrichtung.
     Muss VOR dem Zoom-Block gemerkt werden, der das Flag zurücksetzt. */
  const wantAutoY = tl.forceAutoZoom;

  tl.itins = itins.filter(it => transitLegs(it).length);
  if (!tl.itins.length) { scroller.innerHTML = `<p class="status">Keine Verbindungen.</p>`; return; }

  /* Spalten nebeneinander aus der Einstellung (3–7, Default 3), Breite auf
     großen Screens gedeckelt. Die Untergrenze muss klein genug sein, dass 7
     Spalten auf einem schmalen Telefon TATSÄCHLICH nebeneinander passen —
     stünde sie zu hoch, wählte man 7 und bekäme trotzdem nur 5 zu sehen. */
  const nCols = Math.min(7, Math.max(3, settings.cols || 3));
  const usableW = Math.max(140, scroller.clientWidth - TL.AXIS_W);
  tl.colW = Math.min(170, Math.max(34, Math.round(usableW / nCols) - TL.GAP));
  // Zwei Enge-Stufen: „narrow“ ab 6 Spalten, „tiny“ bei 7 auf dem Telefon
  scroller.classList.toggle("narrow", tl.colW < 62);
  scroller.classList.toggle("tiny", tl.colW < 46);

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
    // Der Balken beginnt an der SOLL-Abfahrt (das Verspätungsstück davor gehört
    // dazu) — sonst reicht die Leinwand oben nicht bis zu seinem Anfang
    min = Math.min(min, +new Date(legs[0].from.scheduledDeparture || legs[0].from.departure));
    max = Math.max(max, +new Date(legs[legs.length - 1].to.arrival));
  }
  tl.t0 = min - TL.PAD_MIN * 60000;
  tl.t1 = max + TL.PAD_MIN * 60000;
  tl.t1Base = tl.t1;   // Bezug für die Fußfreiheit, siehe tlEnsureTail

  /* Startspalte: im „Jetzt“-Modus die erste noch erreichbare Verbindung, sonst
     die fokussierte (z. B. die letzte des Tages). Das ist WICHTIG für den Zoom
     — tlAutoZoom richtet sich danach. Stand hier immer 0, wurde die Ansicht auf
     die erste geladene Verbindung gezoomt, während der Blick auf der letzten
     lag: Man scrollte seitwärts hin und sah ins Leere. */
  const focusIdx = (focus && focus !== "start" && focus !== "end")
    ? tl.itins.findIndex(it => itKey(it) === focus) : -1;
  let startIdx = 0;
  if (app.searchTime.kind === "now") {
    const i = tl.itins.findIndex(it =>
      +new Date(transitLegs(it)[0].from.departure) >= Date.now() - 30000);
    if (i > 0) startIdx = i;
  } else if (focusIdx >= 0) {
    startIdx = focusIdx;
  }
  /* Wird der Zoom wegen einer geänderten Frage neu bestimmt, während die
     Ansicht auf ihrer Spalte stehen bleibt, muss er sich nach GENAU DIESER
     Spalte richten. Sonst zoomt er auf die Fokus- oder Jetzt-Spalte, die
     woanders steht — die Ansicht bleibt zwar seitlich, wird aber für eine
     andere Verbindung skaliert, und das sieht aus wie ein Sprung.
     Gilt für alle Zeitmodi gleichermaßen: Jetzt, Letzte und Datumsauswahl. */
  if (wantAutoY && anchor?.key) {
    const i = tl.itins.findIndex(it => itKey(it) === anchor.key);
    if (i >= 0) startIdx = i;
  }

  /* Zoom automatisch bestimmen — bei einer neuen Suche und immer dann, wenn
     sich die Frage geändert hat (Zeitwahl, ein-/ausgeblendete Verkehrsmittel).
     Blättern innerhalb derselben Suche zählt NICHT dazu. */
  if (!sameSearch || tl.forceAutoZoom) {
    tl.ppm = tlAutoZoom(scroller, startIdx);
    tl.lastZoomIdx = startIdx;
    tl.manualZoom = false;
    tl.forceAutoZoom = false;
  }
  if (!sameSearch) tl.userMoved = false; // erst nach echter Nutzer-Geste vorausladen

  // Kopffreiheit: über dem FRÜHESTEN geladenen Balken (und im „Jetzt“-Modus
  // zusätzlich über der Jetzt-Linie) muss immer Platz für die Kopf-Kachel
  // sein — egal, in welcher Spalte man steht
  const headroomMs = ((tlHeadClear() + TL.DEP_LBL + 8) / tl.ppm) * 60000;
  tl.t0 = Math.min(tl.t0, min - headroomMs);
  if (app.searchTime.kind === "now") tl.t0 = Math.min(tl.t0, Date.now() - headroomMs);

  tlBuild(scroller);

  // Exakte Nachkorrektur mit der real gemessenen Kachelhöhe (eine Runde genügt)
  {
    const clear = tlHeadClear() + TL.DEP_LBL + 8; // Kachel + Abfahrtszeit + Luft
    let deficit = clear - tl.bars[0].top;
    if (app.searchTime.kind === "now" && Date.now() <= tl.t1) {
      deficit = Math.max(deficit, clear - tlY(Date.now()));
    }
    if (deficit > 0) {
      tl.t0 -= (deficit / tl.ppm) * 60000;
      tlBuild(scroller);
    }
  }
  tlEnsureTail(scroller);

  if (anchor) {
    // Ankerspalte an derselben Bildschirmposition halten; Zeit-Anker für oben
    const newIdx = anchor.key ? tl.itins.findIndex(it => itKey(it) === anchor.key) : -1;
    scroller.scrollLeft = newIdx >= 0 ? Math.max(0, colScrollLeft(newIdx) + anchor.offset) : prev.left;
    /* Senkrecht: normalerweise die gemerkte Zeit halten (beim Blättern darf sich
       nichts bewegen). Hat sich die Frage geändert und der Zoom damit auch, wird
       stattdessen wieder automatisch ausgerichtet — bezogen auf die Spalte, die
       jetzt links steht, nicht auf irgendeine andere. */
    scroller.scrollTop = wantAutoY && newIdx >= 0
      ? tlAlignTopFor(newIdx, scroller)
      : Math.max(0, tlY(anchor.time));
    // Zoom-Index mitziehen, sonst zoomt das Einrasten die Spalte neu (Sprung)
    if (newIdx >= 0) tl.lastZoomIdx = newIdx;
  } else if (focus === "end") {
    // ans Ende scrollen
    const last = tl.bars[tl.bars.length - 1];
    scroller.scrollLeft = scroller.scrollWidth;
    scroller.scrollTop = Math.max(0, last.top + last.height - scroller.clientHeight + 40);
  } else if (focus !== "start") {
    /* Eine bestimmte Verbindung fokussieren (z. B. die letzte des Tages).
       Sie steht in der ZWEITEN Spalte: eine Spalte Kontext davor zeigt, was
       man als vorletzte Möglichkeit noch hätte. Vertikal gilt dieselbe
       Docking-Regel wie überall sonst — vorher stand hier eine eigene
       Rechnung, die den Balken verfehlen konnte. */
    const idx = focusIdx >= 0 ? focusIdx : tl.bars.length - 1;
    const bar = tl.bars[idx];
    const leftIdx = Math.max(0, idx - 1);   // Kontextspalte davor
    scroller.scrollLeft = colScrollLeft(leftIdx);
    scroller.scrollTop = tlAlignTopFor(idx, scroller);
    /* Der Zoom-Index MUSS die linkeste Spalte sein, nicht die markierte.
       `tlAlign` rechnet ihn aus der Scrollposition aus; stand hier die
       markierte Spalte, wich er sofort ab, und das Einrasten zoomte 120 ms
       später neu und richtete sich an der Kontextspalte aus — die Markierung
       blitzte auf und die Ansicht sprang weg. */
    tl.lastZoomIdx = leftIdx;
    /* Das Setzen der Scrollposition feuert ein scroll-Ereignis. Ohne diese
       Sperre plant dessen Handler sofort ein Einrasten ein und macht die
       gerade gesetzte Position wieder kaputt. */
    tl.autoScrolling = true;
    clearTimeout(tl.focusHold);
    tl.focusHold = setTimeout(() => { tl.autoScrolling = false; }, 400);
  } else {
    // Start: linkeste sichtbare Spalte ist die erste noch ERREICHBARE
    // Verbindung; vertikal gilt dieselbe Docking-Regel wie beim Einrasten
    scroller.scrollLeft = colScrollLeft(startIdx);
    scroller.scrollTop = tlAlignTopFor(startIdx, scroller);
  }
  tl.lastAlignLeft = scroller.scrollLeft;
  // Nach dem Setzen der Scrollposition, sonst zeigte die Kachel den Tag der
  // Spalte 0 statt den der Spalte, auf die die Ansicht gerade gesprungen ist.
  tlUpdateDate(scroller);
}

/* Vertikales Einrast-Ziel für eine Spalte: normalerweise die Abfahrt des
   Balkens leicht unter der Kopf-Kachel. Ist die Spalte die NÄCHSTE noch
   erreichbare Verbindung, dockt die Ansicht an der aktuellen Uhrzeit an —
   ABER nur, wenn dabei mindestens 40 % des ersten Transportmittel-Segments
   sichtbar bleiben; sonst gewinnt der Balken (sonst sähe man bei großem
   Abstand nur die Jetzt-Linie und keine Verbindung). */
/* Vertikales Einrast-Ziel für eine Spalte, in PIXELN bei der angegebenen
   Zoomstufe. Bewusst über den INDEX und die Fahrtdaten statt über den fertigen
   Balken: So lässt es sich auch für eine Zoomstufe ausrechnen, die noch gar
   nicht gebaut ist. Vorher wurde dafür kurz auf die Zielstufe gebaut und wieder
   zurück — zwei vollständige Neuaufbauten unmittelbar vor der Bewegung.

   Regel: normalerweise die Abfahrt des Balkens leicht unter der Kopf-Kachel.
   Ist die Spalte die NÄCHSTE noch erreichbare Verbindung, dockt die Ansicht an
   der aktuellen Uhrzeit an — aber nur, wenn dabei mindestens 40 % des ersten
   Segments sichtbar bleiben; sonst gewinnt der Balken (sonst sähe man bei
   großem Abstand nur die Jetzt-Linie und keine Verbindung). */
/* Wo FÄNGT der Balken an? Mit sichtbarem Verspätungsstück an der Soll-Abfahrt,
   sonst an der Prognose. Diese eine Wahrheit brauchen zwei Stellen: das Zeichnen
   (`tlColumn`) und das Andocken (`tlAlignTopFor`) — und letzteres rechnet für
   eine Zoomstufe, die es noch gar nicht gibt, deshalb geht `ppm` mit hinein.
   Ohne diesen gemeinsamen Nenner dockt die Ansicht an der Prognose an und
   schiebt das Verspätungsstück hinter die Kopf-Kachel; bei +32 min war davon
   nichts mehr zu sehen. */
function tlBarStartMs(legs, ppm = tl.ppm) {
  const from = legs[0].from;
  const plan = +new Date(from.scheduledDeparture || from.departure);
  const real = +new Date(from.departure);
  const h = ((real - plan) / 60000) * ppm;
  return h >= TL.LATE_MIN_H ? plan : real;
}

function tlAlignTopFor(idx, sc, ppm = tl.ppm) {
  const it = tl.itins[idx];
  if (!it) return 0;
  const legs = transitLegs(it);
  const px = ms => ((ms - tl.t0) / 60000) * ppm;
  // + DEP_LBL: Sonst rastet der Balkenanfang bündig unter der Kachel ein und
  //   verdeckt genau die Abfahrtszeit, die dort steht.
  const clear = tlHeadClear() + TL.DEP_LBL;
  const dep = +new Date(legs[0].from.departure);
  const barTop = Math.max(0, px(tlBarStartMs(legs, ppm)) - clear);
  if (!tlIsNextReachable(idx)) return barTop;
  const nowTop = Math.max(0, px(Date.now()) - clear);
  const viewH = sc ? sc.clientHeight : 0;
  if (viewH) {
    const seg1H = Math.max(1, px(+new Date(legs[0].to.arrival)) - px(dep));
    const sichtbar = Math.min(seg1H, nowTop + viewH - px(dep));
    if (sichtbar / seg1H < 0.4) return barTop;
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

/* Die Markierung der gesuchten Verbindung MUSS in tlBuild sitzen, nicht in
   renderTimeline: Jede Zoomänderung (Pinch, oder das automatische Nachzoomen
   beim Spaltenwechsel) ruft tlBuild erneut auf, wirft dabei alle Spalten weg
   und baut sie neu. Stand die Markierung eine Ebene höher, war sie nach dem
   ersten Scrollen still verschwunden — sie „blendete sich aus“, ohne dass sie
   jemand entfernt hätte. */
function tlMarkFocus() {
  if (!tl.focusKey) return;
  const i = tl.itins.findIndex(it => itKey(it) === tl.focusKey);
  if (i < 0 || !tl.bars[i]) return;
  tl.bars[i].head?.classList.add("tl-focus");
  tl.bars[i].el?.classList.add("tl-focus");
}

/* Auch die LETZTE Spalte muss sich oben andocken lassen. Dafür braucht es unter
   dem spätesten Balken genug Leinwand, um ihn bis unter die Kopf-Kachel
   hochzuschieben — die Leinwand endete aber 14 Minuten nach der letzten Ankunft.
   Bei kurzen Verbindungen am rechten Rand reichte das nicht: Der Browser klemmt
   das Scrollen ab, der Balken bleibt auf halber Höhe stehen, und das Einrasten
   sieht aus, als hätte es aufgehört zu funktionieren. Genau deshalb trat es erst
   auf, je weiter man nach rechts kam.

   Es wird nur ANGEHÄNGT, nie gekürzt — an der Zeitskala oben ändert sich nichts. */
function tlEnsureTail(sc) {
  if (!tl.bars.length || !sc.clientHeight) return;
  /* IMMER von der Grundlänge aus rechnen, nie vom zuletzt verlängerten Wert:
     Sonst wächst die Leinwand bei jeder Zoomänderung weiter, die Zeitskala wird
     absurd lang, und die Stundenlinien im Hintergrund fangen an auszusetzen. */
  if (!Number.isFinite(tl.t1Base)) tl.t1Base = tl.t1;
  const clear = tlHeadClear() + TL.DEP_LBL;
  const maxTop = tl.bars.reduce((m, b) => Math.max(m, b.top), 0);
  const needed = Math.max(0, maxTop - clear) + sc.clientHeight;
  const base = tl.t1Base;
  const want = tl.t0 + (needed / tl.ppm) * 60000;
  const t1 = Math.max(base, want);
  if (Math.abs(t1 - tl.t1) < 1000) return;
  tl.t1 = t1;
  tlBuild(sc);
}

function tlBuild(scroller) {
  tl.bars = [];
  /* Verweise auf alles, dessen Lage von der Zoomstufe abhängt. Damit kann
     tlRescale die Ansicht während einer Bewegung verschieben, ohne sie neu zu
     bauen — der Neuaufbau pro Bild war zu teuer und wurde als Stottern
     sichtbar, sobald der Zoom mitlief. */
  tl.geo = { canvas: null, axis: null, lines: [], ticks: [], now: null, cols: [], dateEl: null };
  tl.dateKey = null;   // beim Neuaufbau ist die Datumskachel leer, also neu setzen
  const heightPx = tlY(tl.t1);
  const widthPx = TL.AXIS_W + tl.itins.length * (tl.colW + TL.GAP) + TL.GAP;

  const canvas = document.createElement("div");
  tl.geo.canvas = canvas;
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
  tl.lastCheckLeft = null; // Referenz für die Scrollrichtung neu setzen
  tlMarkFocus();
}

/* Am Rand angekommen → nächsten Batch in diese Richtung laden.
   Scharf geschaltet wird eine Seite erst, sobald man NICHT am Rand ist —
   die Startposition am linken Rand löst also nichts aus. */
function tlEdgeCheck(sc) {
  /* Vorausschauend nachladen — aber nur in die Richtung, in die der Nutzer
     tatsächlich scrollt, und erst nachdem er die Ansicht angefasst hat.
     Sonst feuert schon das Positionieren beim Öffnen ein Nachladen der
     bereits abgefahrenen Verbindungen (unnötig, langsam, verwirrend). */
  const last = tl.lastCheckLeft;
  tl.lastCheckLeft = sc.scrollLeft;
  if (typeof loadMore === "function" && tl.bars.length && tl.userMoved && last != null) {
    const step = tlStep();
    const movedRight = sc.scrollLeft > last + 1;
    const movedLeft = sc.scrollLeft < last - 1;
    const colsRight = (sc.scrollWidth - sc.clientWidth - sc.scrollLeft) / step;
    const colsLeft = sc.scrollLeft / step;
    if (movedRight && colsRight < 1) loadMore("later");
    else if (movedLeft && colsLeft < 1) loadMore("earlier");
  }
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

/* Dynamischer Y-Zoom: die Verbindung der Zielspalte (startIdx) belegt die
   oberen 70 % der Sichtfläche unter den Kopf-Kacheln — die unteren 30 %
   bleiben frei, damit man mehr von den nachfolgenden, weiter unten
   startenden Verbindungen sieht. */
/* Zoomstufe so wählen, dass das WESENTLICHE der Startspalte den eingestellten
   Anteil der Bildhöhe einnimmt; der Rest bleibt als Vorschau auf das, was
   danach kommt.

   Im „Jetzt“-Modus gehört die Wartezeit bis zur Abfahrt mit ins Bild: Die
   Ansicht dockt dort an der Jetzt-Linie an, nicht am Balken. Rechnete man nur
   mit der Fahrtdauer, schob eine lange Wartezeit die Verbindung nach unten aus
   dem Bild — man sah dann den roten Balken und sonst nichts. Gemessen wird
   deshalb von JETZT bis zur Ankunft, damit Jetzt-Linie, ganze Verbindung und
   der eingestellte Puffer zusammen sichtbar bleiben. */
/* Ist die Spalte die NÄCHSTE noch erreichbare Verbindung? Nur dort dockt die
   Ansicht an der Jetzt-Linie an — und nur dort gehört die Wartezeit bis zur
   Abfahrt in die Zoom-Rechnung. Beide Stellen müssen dieselbe Antwort geben,
   deshalb steht sie hier einmal. */
function tlIsNextReachable(idx) {
  if (app.searchTime.kind !== "now") return false;
  const now = Date.now();
  if (!(now >= tl.t0 && now <= tl.t1)) return false;
  const dep = i => {
    const it = tl.itins[i];
    return it ? +new Date(transitLegs(it)[0].from.departure) : -Infinity;
  };
  return dep(idx) >= now - 30000 && (idx <= 0 || dep(idx - 1) < now - 30000);
}

function tlAutoZoom(sc, startIdx = 0) {
  const usable = Math.max(180, (sc.clientHeight || 400) - TL.HEAD_H - 60);
  const it = tl.itins[Math.min(tl.itins.length - 1, Math.max(0, startIdx))];
  if (!it) return tl.ppm || 4;
  const legs = transitLegs(it);
  const dep = +new Date(legs[0].from.departure);
  const arr = +new Date(legs[legs.length - 1].to.arrival);
  /* Die Wartezeit ab JETZT zählt nur für die nächste erreichbare Verbindung
     mit — dort steht die Jetzt-Linie oben im Bild und muss mit hineinpassen.
     Für jede weitere Spalte wäre das falsch: Je später sie abfährt, desto
     größer würde die gemessene Spanne, und der Zoom schrumpfte immer weiter,
     bis die Verbindung nur noch ein Zehntel der Höhe einnahm. Genau das
     passierte beim Weiterscrollen nach rechts. */
  const idx = Math.min(tl.itins.length - 1, Math.max(0, startIdx));
  const from = (tlIsNextReachable(idx) && Date.now() < dep) ? Date.now() : dep;
  const spanMin = Math.max(1, (arr - from) / 60000);
  const fill = Math.min(90, Math.max(40, settings.fill || 70)) / 100;
  const ppm = (usable * fill) / spanMin;
  return Math.min(TL.MAX_PPM, Math.max(tl.minPpm || TL.MIN_PPM, ppm));
}

/* Waagerechte Zeitlinien als EINZELNE Elemente, jede exakt auf ihrer Uhrzeit.

   Vorher waren es zwei gekachelte Verläufe. Eine Kachelung mit gebrochener
   Höhe (60 min × 4,37 px/min = 262,2 px) sammelt über die Länge der Leinwand
   Rundungsfehler an: Die Linien wandern gegenüber der echten Uhrzeit, und beim
   Zeichnen fallen einzelne ganz weg — daher „manche volle Stunden haben eine
   Linie, manche nicht“. Bei jeder Zoomänderung verschob sich der Fehler neu,
   weshalb sie zusätzlich wild sprangen.

   Einzeln gesetzt gibt es keinen Fehler, der sich aufsummieren könnte. Die
   Anzahl ist von selbst begrenzt, weil der Abstand nie unter 44 px fällt —
   bei einer 5000 px hohen Leinwand also rund 110 Linien. */
function tlGrid(h, w) {
  const step = tlTickStep();
  const g = document.createElement("div");
  g.className = "tl-gridlines";
  g.style.width = w + "px";
  g.style.height = h + "px";

  const minStart = Math.ceil(tl.t0 / 60000 / step) * step;   // erste runde Marke
  const minEnd = tl.t1 / 60000;
  for (let m = minStart; m <= minEnd; m += step) {
    const y = Math.round(((m * 60000 - tl.t0) / 60000) * tl.ppm);
    if (y < 0 || y > h) continue;
    const l = document.createElement("i");
    // Volle Stunden kräftiger — sie tragen die Orientierung
    l.className = (m % 60 === 0) ? "tl-hline strong" : "tl-hline";
    l.style.top = y + "px";
    tl.geo.lines.push({ el: l, ms: m * 60000 });
    g.appendChild(l);
  }
  return g;
}

/* Während einer Verfahrbewegung bleibt die Stufe FEST (auf dem Zielwert).
   Sonst kippt sie beim Durchlaufen der Zoomstufen mehrfach um, und die Linien
   ordnen sich mitten in der Bewegung neu — genau das Flackern im Hintergrund. */
function tlTickStep(ppm = tl.ppm) {
  if (tl.tickStepFest) return tl.tickStepFest;
  for (const s of [5, 10, 15, 30, 60, 120]) if (s * ppm >= 44) return s;
  return 240;
}

const TL_WOCHENTAG = new Intl.DateTimeFormat("de-DE", { weekday: "short", timeZone: "Europe/Berlin" });
const TL_TAGMONAT = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "numeric", timeZone: "Europe/Berlin" });
// Tagesschlüssel in Berliner Zeit — `toDateString()` würde die Zeitzone des
// Geräts nehmen, und dann kippte das Datum für jemanden im Ausland woanders.
const tlTagKey = ms => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date(ms));

/* Datum in der Ecke oben links, wo sich Zeitachse und Kopf-Kacheln überlagern.
   Dort stand vorher nur ein Stück Skala, das nichts aussagt. Ohne Datum ist bei
   einer über Mitternacht laufenden Ansicht schwer zu sehen, für welchen Tag die
   Zeiten gelten — den Tagessprung übersieht man leicht.

   Angezeigt wird der Tag der LINKESTEN sichtbaren Spalte. Damit springt das
   Datum genau dann, wenn keine Verbindung des alten Tages mehr zu sehen ist.
   Das passt zur Leserichtung: Das Datum steht links, neue Zeiten kommen von
   rechts herein. */
function tlUpdateDate(sc) {
  const el = tl.geo?.dateEl;
  if (!el || !tl.itins.length) return;
  const step = tlStep();
  /* Erste Spalte, deren rechte Kante rechts der Achse liegt — die Achse deckt
     die linken TL.AXIS_W Pixel ab, was darunter liegt, ist nicht zu sehen. */
  const i = Math.min(tl.itins.length - 1,
    Math.max(0, Math.ceil((sc.scrollLeft - TL.GAP - tl.colW) / step)));
  const legs = transitLegs(tl.itins[i]);
  if (!legs.length) return;
  const ms = +new Date(legs[0].from.scheduledDeparture || legs[0].from.departure);
  const key = tlTagKey(ms);
  if (key === tl.dateKey) return;          // nichts anfassen, wenn gleich
  tl.dateKey = key;
  const d = new Date(ms);
  el.innerHTML = `<b>${escapeHtml(TL_WOCHENTAG.format(d).replace(".", ""))}</b>`
    + `<span>${escapeHtml(TL_TAGMONAT.format(d))}</span>`;
}

function tlAxis(h) {
  const axis = document.createElement("div");
  tl.geo.axis = axis;
  axis.className = "tl-axis";
  axis.style.height = h + "px";
  /* Muss das ERSTE Kind im Fluss sein: Nur dann liegt seine Ausgangslage am
     oberen Rand der Achse, und `sticky` hält es dort fest. Die Zeitmarken sind
     absolut gesetzt und stören diese Lage nicht. */
  const rahmen = document.createElement("div");
  rahmen.className = "tl-datewrap";
  const datum = document.createElement("div");
  datum.className = "tl-date";
  tl.geo.dateEl = datum;
  rahmen.appendChild(datum);
  axis.appendChild(rahmen);
  const step = tlTickStep() * 60000;
  let t = Math.ceil(tl.t0 / step) * step;
  for (; t < tl.t1; t += step) {
    const tick = document.createElement("span");
    tick.className = "tl-tick";
    tick.style.top = tlY(t) + "px";
    tl.geo.ticks.push({ el: tick, ms: t });
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
  tl.geo.now = { el: line, ms: now };
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
  const risk = cancelled ? null : itinIssues(it).level;
  const delayMin = diffMin(dep.scheduledDeparture, dep.departure);
  /* Der Balken beginnt an der SOLL-Abfahrt. Verspätet sich die Verbindung, liegt
     zwischen Soll und Prognose ein eigenes Stück — die verlorene Zeit, in der
     man am Bahnsteig steht. Erst danach beginnt die eigentliche Fahrt.
     Damit stimmen Kopf-Kachel, Balkenanfang und Zeitachse wieder überein:
     Steht in der Kachel 10:15, fängt der Balken auf Höhe 10:15 an.

     Nur wenn das Stück auch sichtbar wäre. Bei einer Minute Verspätung und weit
     herausgezoomter Ansicht sind das zwei Pixel — dafür ein zweites Zeitlabel
     zu setzen bringt nichts als Gedränge. Dann bleibt es beim alten Verhalten
     (Balken ab Prognose), und die Abweichung ist zu klein, um aufzufallen. */
  const msPlan = +new Date(dep.scheduledDeparture || dep.departure);
  const msReal = +new Date(dep.departure);
  const showLate = tlBarStartMs(legs) === msPlan && msReal > msPlan;
  const lateH = showLate ? tlY(msReal) - tlY(msPlan) : 0;
  const top = tlY(showLate ? msPlan : msReal);
  const height = Math.max(10, tlY(+new Date(arr.arrival)) - top);

  const col = document.createElement("div");
  col.className = "tl-col" + (isDominated ? " dominated" : "");
  col.style.left = left + "px";
  col.style.width = tl.colW + "px";

  // Kopf bleibt beim Scrollen sichtbar; Tipp darauf holt den Balken ins Bild
  const head = document.createElement("button");
  head.className = "tl-head" + (cancelled ? " cancelled" : "");
  /* In der Kopf-Kachel steht die SOLL-Abfahrt, nicht die Prognose. Dort steht
     direkt daneben das Verspätungs-Abzeichen, und „10:15 +5“ liest sich sonst
     wie eine Rechenaufgabe — man addiert im Kopf und landet fünf Minuten zu
     spät. Sollzeit + Abzeichen ergibt zusammen die Prognose, und die steht
     ausgeschrieben oben am Balken (`tl-dep`).
     NUR die Anzeige: `dep.departure` bleibt überall sonst maßgeblich — daran
     hängen die Balkenlage (`top`), die Zeitachse (`geoCol.ms0`) und das
     Einrasten. Wer hier die Variable tauscht, verschiebt die halbe Grafik. */
  head.innerHTML =
    `<span class="tl-hl"><strong>${fmtTime(dep.scheduledDeparture || dep.departure)}</strong> ${cancelled ? `<span class="cancelled-label">Fällt aus</span>` : delayBadge(delayMin)}${riskMark(risk)}</span>` +
    `<small>${fmtDur(it.duration)}</small>` +
    `<small><span class="u-long">${it.transfers} Umst.</span>` +
    `<span class="u-short">${it.transfers}×</span></small>`;
  head.addEventListener("click", () => {
    const sc = byId("timeline");
    const viewTop = sc.scrollTop + tlHeadClear(), viewBot = sc.scrollTop + sc.clientHeight;
    if (top < viewTop - 10 || top > viewBot - 40) {
      tl.autoScrolling = true;
      sc.scrollTo({ top: Math.max(0, top - tlHeadClear() - TL.DEP_LBL), behavior: "smooth" });
      setTimeout(() => { tl.autoScrolling = false; }, 500);
    } else {
      openTripDialog(it);
    }
  });
  col.appendChild(head);

  const bar = document.createElement("button");
  const geoCol = { bar, segs: [], dep: null, arr: null, late: null,
                   ms0: showLate ? msPlan : msReal, ms1: +new Date(arr.arrival) };
  tl.geo.cols.push(geoCol);
  bar.className = "tl-bar";
  bar.style.top = top + "px";
  bar.style.height = height + "px";
  bar.setAttribute("aria-label", `${fmtTime(dep.departure)} bis ${fmtTime(arr.arrival)}`);
  bar.addEventListener("click", () => openTripDialog(it));

  /* Das Verspätungsstück: eigene Optik, KEINE Ausfall-Streifen. Schwarz-Rot ist
     in dieser Grafik für „fällt aus“ vergeben, Gelb-Schräg für Ersatzverkehr —
     ein drittes Muster darf keinem der beiden ähneln, sonst heißen zwei
     verschiedene Dinge dasselbe. Deshalb hier ein feines Rot-Schraffur-Muster
     auf durchscheinendem Grund: erkennbar „hier fährt noch nichts“, aber ohne
     die Wucht der Ausfall-Streifen. */
  if (showLate) {
    const late = document.createElement("span");
    late.className = "tl-seg seg-late";
    late.style.top = "0px";
    late.style.height = lateH + "px";
    late.title = `${delayMin} Min. später als geplant`;
    bar.appendChild(late);
    geoCol.late = { el: late, ms0: msPlan, ms1: msReal };
  }

  for (const l of legs) {
    const s0 = tlY(+new Date(l.from.departure)) - top;
    const s1 = tlY(+new Date(l.to.arrival)) - top;
    const seg = document.createElement("span");
    const h = Math.max(6, s1 - s0);
    const isCancelled = flagged.has(l);
    const sev = !isCancelled && isReplacementService(l);
    seg.className = `tl-seg seg-${productClass(l.mode)}` + (h < 20 ? " nolabel" : "") +
      (isCancelled ? " seg-cancelled" : "") + (sev ? " seg-sev" : "");
    if (sev) seg.title = "Schienenersatzverkehr";
    seg.style.top = s0 + "px";
    seg.style.height = h + "px";
    geoCol.segs.push({ el: seg, ms0: +new Date(l.from.departure), ms1: +new Date(l.to.arrival) });
    const name = lineParts(l).main; // Zusatznummer nur in der Detailansicht
    // Ausgefallene Teilstücke: Streifenmuster, Name als weißer Text auf Schwarz
    if (isCancelled) seg.innerHTML = `<span class="seg-label">${escapeHtml(name)}</span>`;
    else seg.textContent = name;
    bar.appendChild(seg);
  }

  /* Zeiten an beiden Balkenenden — klein und zurückhaltend, damit sie den
     Balken nicht überstimmen. Ohne „ab“/„an“: Oben steht sie am Anfang des
     Balkens, unten am Ende; was gemeint ist, sagt die Position. */
  /* Rot heißt hier: Diese Zeit ist nicht die geplante. Die Zeiten am Balken
     sind die tatsächlich erwarteten, der Balken selbst liegt und misst nach
     ihnen — verspätet rutscht er nach unten und wird kürzer oder länger.
     Ohne die Farbe sieht man dem Balken nicht an, dass er verschoben ist. */
  const arrDelay = diffMin(arr.scheduledArrival, arr.arrival);

  const t0lbl = document.createElement("span");
  // Rot nur, wenn diese Beschriftung selbst die verspätete Zeit zeigt
  t0lbl.className = "tl-dep" + (!showLate && delayMin > 0 ? " late" : "");
  /* Beide Zeiten bekommen denselben Abstand von 3 px zum Balken. Oben wird
     dafür die UNTERkante gesetzt (per translateY(-100%) im Stylesheet) — mit
     einem festen Versatz nach oben hinge der Abstand an der Texthöhe und wäre
     in den engen Spaltenstufen wieder ein anderer. */
  t0lbl.style.top = (top - 3) + "px";
  /* Über dem Balken steht immer die Zeit, an der er ANFÄNGT. Mit Verspätungs-
     stück ist das die Sollzeit — dieselbe wie in der Kopf-Kachel, und damit
     stimmt endlich beides überein. Die Prognose wandert an den Übergang. */
  t0lbl.textContent = fmtTime(showLate ? dep.scheduledDeparture : dep.departure);
  geoCol.dep = t0lbl;

  /* Am Übergang die neue Abfahrtszeit, rot: Genau dort geht es wirklich los. */
  let realLbl = null;
  if (showLate) {
    realLbl = document.createElement("span");
    realLbl.className = "tl-real late";
    realLbl.style.top = (top + lateH) + "px";
    realLbl.textContent = fmtTime(dep.departure);
    geoCol.real = { el: realLbl, ms: msReal };
  }

  const t1lbl = document.createElement("span");
  t1lbl.className = "tl-arr" + (arrDelay > 0 ? " late" : "");
  t1lbl.style.top = (top + height + 3) + "px";
  t1lbl.textContent = fmtTime(arr.arrival);
  geoCol.arr = t1lbl;

  col.appendChild(bar);
  col.appendChild(t0lbl);
  if (realLbl) col.appendChild(realLbl);
  col.appendChild(t1lbl);

  tl.bars.push({ colLeft: left, top, height, itin: it, head, el: bar });
  return col;
}

/* ---------- Zoom ---------- */

// Zoom-Anker ist die OBERKANTE der Ansicht: die dort eingerastete
// Verbindung/Zeitmarke bleibt beim Zoomen stehen, die Skala streckt
// bzw. staucht sich nur nach unten.
/* Von Hand zoomen (Pinch, Strg+Rad). Das merkt sich die Ansicht: Ab dann
   bestimmt der Nutzer den Maßstab, und ein Spaltenwechsel setzt ihn nicht mehr
   zurück. Zurück auf automatisch geht es nur bei einer NEUEN Frage — andere
   Zeitwahl, neue Suche, geänderte Verkehrsmittel. */
function tlSetZoom(newPpm) {
  tl.manualZoom = true;
  const sc = byId("timeline");
  newPpm = Math.min(TL.MAX_PPM, Math.max(tl.minPpm || TL.MIN_PPM, newPpm));
  if (Math.abs(newPpm - tl.ppm) < 0.01) return;
  const anchorTime = tl.t0 + (sc.scrollTop / tl.ppm) * 60000;
  const left = sc.scrollLeft;
  tl.ppm = newPpm;
  tlBuild(sc);
  // Kopffreiheit auch nach Zoom-Änderung sicherstellen (Rauszoomen
  // schrumpft den Pixel-Puffer über dem frühesten Balken)
  const clear = tlHeadClear() + 8;
  if (tl.bars.length && tl.bars[0].top < clear) {
    tl.t0 -= ((clear - tl.bars[0].top) / tl.ppm) * 60000;
    tlBuild(sc);
  }
  tlEnsureTail(sc);
  sc.scrollLeft = left;
  sc.scrollTop = Math.max(0, tlY(anchorTime));
}

function tlInitInteractions() {
  const sc = byId("timeline");

  sc.addEventListener("wheel", () => { tl.userMoved = true; }, { passive: true });
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
    const maxLeft = Math.max(0, sc.scrollWidth - sc.clientWidth);
    const targetLeft = Math.min(maxLeft, Math.max(0, colScrollLeft(Math.max(0, colIndexFor(sc.scrollLeft)))));

    // Zielzoom bestimmen (Pinch in derselben Spalte bleibt unangetastet),
    // aber NOCH NICHT setzen — er wird gleich mitanimiert
    const idx0 = Math.min(tl.itins.length - 1, Math.max(0, colIndexFor(targetLeft)));
    let ppm = tl.ppm;
    if (idx0 !== tl.lastZoomIdx) {
      tl.lastZoomIdx = idx0;
      if (!tl.manualZoom) {           // selbst gewählter Maßstab bleibt stehen
        const dyn = tlAutoZoom(sc, idx0);
        if (Math.abs(dyn - tl.ppm) / tl.ppm > 0.05) ppm = dyn;
      }
    }

    /* Y-Regel: nach Spaltenwechsel (oder wenn nichts im Bild wäre) den linkesten
       sichtbaren Balken leicht unter die Kopf-Kachel legen — bzw. bei der
       nächsten erreichbaren Verbindung an der Jetzt-Linie andocken */
    const clear = tlHeadClear();
    const vx0 = targetLeft + TL.AXIS_W, vx1 = targetLeft + sc.clientWidth;
    const visible = tl.bars.filter(b => b.colLeft + tl.colW > vx0 && b.colLeft < vx1);
    let topTime = tl.t0 + (sc.scrollTop / tl.ppm) * 60000;   // sonst bleibt die Zeit stehen
    if (visible.length) {
      const horizChanged = Math.abs(targetLeft - (tl.lastAlignLeft ?? targetLeft)) > 2;
      const anyInView = visible.some(b =>
        b.top < sc.scrollTop + sc.clientHeight - 20 && b.top + b.height > sc.scrollTop + clear + 20);
      if (horizChanged || !anyInView) topTime = tlTopTimeFor(sc, idx0, ppm);
    }

    tlGlideTo(sc, { ppm, left: targetLeft, topTime });
    tl.lastAlignLeft = targetLeft;
  }

  sc.addEventListener("pointerdown", (e) => {
    tl.userMoved = true; // ab jetzt darf vorausschauend nachgeladen werden
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
      tl.axisX = 0; tl.axisY = 0;
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

      // Weiche Achsdämpfung: dominiert die Geste klar vertikal, wird das
      // seitliche Finger-Zittern gedämpft; horizontale und diagonale Gesten
      // bleiben völlig frei (gleitender Mittelwert löst sofort wieder)
      tl.axisX = tl.axisX * 0.88 + Math.abs(dx);
      tl.axisY = tl.axisY * 0.88 + Math.abs(dy);
      const effDx = (tl.axisY > 2.5 * tl.axisX + 12) ? dx * 0.2 : dx;

      sc.scrollLeft -= effDx;
      sc.scrollTop -= dy;

      // Am Rand weiterziehen lädt nach — funktioniert auch, wenn die Fläche
      // schmaler als der Bildschirm ist und gar kein Scrollen möglich wäre
      const atRight = sc.scrollLeft + sc.clientWidth >= sc.scrollWidth - 2;
      const atLeft = sc.scrollLeft <= 2;
      tl.pullRight = (effDx < 0 && atRight) ? (tl.pullRight || 0) - effDx : 0;
      tl.pullLeft = (effDx > 0 && atLeft) ? (tl.pullLeft || 0) + effDx : 0;
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
    tlUpdateDate(sc);
    tlEdgeCheck(sc); // auch beim Gleiten an den Rand → Nachladen
    if (tl.autoScrolling) return;
    clearTimeout(tl.followTimer);
    // kurzer Debounce nur noch für Maus-/Trackpad-Scrollen; Touch rastet
    // direkt beim Loslassen ein (releaseGlide)
    tl.followTimer = setTimeout(() => tlAlign(sc), 120);
  });
}

/* ---------------------------------------------------------------------------
   EINE Verfahrbewegung statt zwei

   Vorher wurde beim Spaltenwechsel erst der Zoom gesetzt — ein Neuaufbau, also
   ein sichtbarer Sprung — und DANACH sanft gescrollt. Zwei getrennte
   Bewegungen, die besonders auffielen, wenn sich der Maßstab stark änderte:
   erst zuckte die Höhe, dann glitt das Bild.

   Jetzt läuft beides in derselben Schleife. Der Maßstab wandert von der alten
   zur neuen Zoomstufe, und die Ansicht folgt in ZEIT-Koordinaten statt in
   Pixeln — sonst zöge der wachsende Maßstab das Ziel unter der Bewegung weg.
   Ein vollständiger Neuaufbau kostet gemessen 1,8 ms (10 Spalten) bis 5,6 ms
   (40 Spalten) und passt damit in ein Bild von 16 ms.
   --------------------------------------------------------------------------- */
/* Alles anhalten, was noch an der Grafik arbeitet: die Verfahrbewegung, der
   verzögerte Einrast-Aufruf und die Sperren dazu. Ohne das lief die
   Bildschleife nach einem Wechsel weiter und baute die ALTE Grafik immer
   wieder neu auf — auch in eine Ansicht hinein, die längst geleert war. Genau
   daher die Reste der vorherigen Suche.

   Aufgerufen bei jeder neuen Suche, bei jedem Wechsel des Zeitraums und beim
   Verlassen der Ergebnisansicht. Jede dieser Handlungen ist unabhängig von
   dem, was vorher lief. */
function tlStop() {
  cancelAnimationFrame(tl.animFrame);
  tl.tickStepFest = null;
  tl.animFrame = 0;
  clearTimeout(tl.followTimer);
  clearTimeout(tl.focusHold);
  tl.followTimer = null;
  tl.autoScrolling = false;
}

/* Zoomstufe ändern, ohne neu zu bauen: Es wird nur die Lage der vorhandenen
   Elemente nachgezogen. Ein vollständiger Neuaufbau je Bild war auf dem Gerät
   zu teuer und wurde als Stottern sichtbar — reines Scrollen lief glatt, erst
   mit laufendem Zoom fing es an zu haken.

   Am ENDE der Bewegung wird trotzdem einmal richtig gebaut. Das ist die
   Sicherung gegen Abweichungen: Sollte hier je etwas fehlen, das tlBuild
   inzwischen anders setzt, korrigiert sich das im Ruhezustand von selbst. */
function tlRescale(sc, ppm) {
  const g = tl.geo;
  if (!g || !g.canvas) { tl.ppm = ppm; tlBuild(sc); return; }
  tl.ppm = ppm;
  const y = ms => ((ms - tl.t0) / 60000) * ppm;
  const hoehe = y(tl.t1);
  g.canvas.style.height = hoehe + "px";
  if (g.axis) g.axis.style.height = hoehe + "px";
  for (const { el, ms } of g.lines) el.style.top = Math.round(y(ms)) + "px";
  for (const { el, ms } of g.ticks) el.style.top = y(ms) + "px";
  if (g.now) g.now.el.style.top = y(g.now.ms) + "px";

  g.cols.forEach((c, i) => {
    const top = y(c.ms0), h = Math.max(10, y(c.ms1) - top);
    c.bar.style.top = top + "px";
    c.bar.style.height = h + "px";
    if (tl.bars[i]) { tl.bars[i].top = top; tl.bars[i].height = h; }
    for (const s of c.segs) {
      const s0 = y(s.ms0) - top, sh = Math.max(2, y(s.ms1) - top - s0);
      s.el.style.top = s0 + "px";
      s.el.style.height = sh + "px";
      s.el.classList.toggle("nolabel", sh < 20);
    }
    /* Das Verspätungsstück und seine Beschriftung müssen bei jedem Bild
       mitwandern — sonst laufen sie während des Zoomens gegen den Balken. */
    if (c.late) {
      const lh = Math.max(1, y(c.late.ms1) - y(c.late.ms0));
      c.late.el.style.height = lh + "px";
    }
    if (c.real) c.real.el.style.top = y(c.real.ms) + "px";
    if (c.dep) c.dep.style.top = (top - 3) + "px";
    if (c.arr) c.arr.style.top = (top + h + 3) + "px";
  });
}

function tlGlideTo(sc, { ppm, left, topTime, ms = 300 }) {
  cancelAnimationFrame(tl.animFrame);
  const p0 = tl.ppm, l0 = sc.scrollLeft;
  const tTop0 = tl.t0 + (sc.scrollTop / p0) * 60000;
  const p1 = ppm || p0;
  const start = performance.now();
  tl.autoScrolling = true;
  tl.tickStepFest = tlTickStep(p1);   // Linienraster über die Bewegung stabil halten

  const schritt = (jetzt) => {
    // Fasst der Nutzer die Ansicht an, gehört sie ihm — Bewegung sofort aufgeben.
    // Ebenso, wenn inzwischen eine andere Suche läuft: Dann gehört die Grafik
    // schon zu einer anderen Frage.
    if (tl.pointers.size || tl.searchTag !== app.searchTag) {
      tl.autoScrolling = false; tl.tickStepFest = null; return;
    }
    const k = Math.min(1, (jetzt - start) / ms);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // weich rein und raus
    if (p1 !== p0) tlRescale(sc, p0 + (p1 - p0) * e);
    sc.scrollLeft = l0 + (left - l0) * e;
    sc.scrollTop = Math.max(0, tlY(tTop0 + (topTime - tTop0) * e));
    if (k < 1) { tl.animFrame = requestAnimationFrame(schritt); return; }

    tl.ppm = p1;
    tl.tickStepFest = null;
    if (p1 !== p0) { tlBuild(sc); tlEnsureTail(sc); }
    sc.scrollLeft = left;
    sc.scrollTop = Math.max(0, tlY(topTime));
    tl.autoScrolling = false;
    tlEdgeCheck(sc);
  };
  tl.animFrame = requestAnimationFrame(schritt);
}

/* Wo soll die Oberkante am Ende stehen — als ZEIT, damit die Bewegung
   unabhängig vom Maßstab ist. Wird direkt für die Ziel-Zoomstufe gerechnet,
   ohne dafür etwas zu bauen. */
function tlTopTimeFor(sc, idx, ppm) {
  return tl.t0 + (tlAlignTopFor(idx, sc, ppm) / ppm) * 60000;
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
  const maxLeft = Math.max(0, sc.scrollWidth - sc.clientWidth);
  const targetLeft = Math.min(maxLeft, Math.max(0, colScrollLeft(Math.max(0, colIndexFor(sc.scrollLeft)))));

  // Zielzoom bestimmen, aber noch nicht setzen — er wird mitanimiert
  const idx0 = Math.min(tl.itins.length - 1, Math.max(0, colIndexFor(targetLeft)));
  let ppm = tl.ppm;
  if (idx0 !== tl.lastZoomIdx) {
    tl.lastZoomIdx = idx0;
    if (!tl.manualZoom) {             // selbst gewählter Maßstab bleibt stehen
      const dyn = tlAutoZoom(sc, idx0);
      if (Math.abs(dyn - tl.ppm) / tl.ppm > 0.05) ppm = dyn;
    }
  }

  const needH = Math.abs(sc.scrollLeft - targetLeft) > 2;

  const vx0 = targetLeft + TL.AXIS_W, vx1 = targetLeft + sc.clientWidth;
  const vy0 = sc.scrollTop + tlHeadClear(), vy1 = sc.scrollTop + sc.clientHeight;
  const visible = tl.bars.filter(b => b.colLeft + tl.colW > vx0 && b.colLeft < vx1);
  if (!visible.length) { tl.lastAlignLeft = targetLeft; return; }
  const anyInView = visible.some(b => b.top < vy1 - 20 && b.top + b.height > vy0 + 20);
  const horizMoved = Math.abs(sc.scrollLeft - (tl.lastAlignLeft ?? sc.scrollLeft)) > 24;
  const targetTop = tlAlignTopFor(idx0, sc);
  const needV = (horizMoved || !anyInView) && Math.abs(sc.scrollTop - targetTop) > 8;
  const needZoom = Math.abs(ppm - tl.ppm) > 0.01;

  if (needH || needV || needZoom) {
    tlGlideTo(sc, {
      ppm,
      left: needH ? targetLeft : sc.scrollLeft,
      topTime: needV ? tlTopTimeFor(sc, idx0, ppm)
                     : tl.t0 + (sc.scrollTop / tl.ppm) * 60000,
    });
  }
  tl.lastAlignLeft = needH ? targetLeft : sc.scrollLeft;
}

document.addEventListener("DOMContentLoaded", tlInitInteractions);
if (document.readyState !== "loading") tlInitInteractions();
