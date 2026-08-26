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

const letterBadge = (ch) => svgIcon(
  `<rect x="2.6" y="2.6" width="10.8" height="10.8" rx="3"/>` +
  `<text x="8" y="11.4" text-anchor="middle" font-size="8.5" font-weight="700" ` +
  `fill="currentColor" stroke="none" font-family="system-ui,sans-serif">${ch}</text>`);

const ICON = {
  ice: svgIcon(`<path d="M4.6 12.6V6.9C4.6 4.8 6.1 3.1 8 3.1s3.4 1.7 3.4 3.8v5.7z"/>` +
    `<path d="M4.6 8.5h6.8"/><path d="M6.3 10.7h.01"/><path d="M9.7 10.7h.01"/><path d="M3.2 14.9h9.6"/>`),
  regio: svgIcon(`<rect x="4.4" y="3.1" width="7.2" height="9.5" rx="1.6"/>` +
    `<path d="M4.4 8.3h7.2"/><path d="M6.3 10.6h.01"/><path d="M9.7 10.6h.01"/><path d="M3.2 14.9h9.6"/>`),
  tram: svgIcon(`<rect x="4.4" y="3.6" width="7.2" height="9" rx="1.6"/>` +
    `<path d="M4.4 8.6h7.2"/><path d="M6.3 10.8h.01"/><path d="M9.7 10.8h.01"/>` +
    `<path d="M8 3.6V1.4"/><path d="M6.4 1.4h3.2"/><path d="M3.2 14.9h9.6"/>`),
  bus: svgIcon(`<rect x="3.2" y="3.2" width="9.6" height="8.2" rx="1.7"/>` +
    `<path d="M3.2 7.4h9.6"/><circle cx="5.5" cy="12.7" r="1.1"/><circle cx="10.5" cy="12.7" r="1.1"/>`),
  ferry: svgIcon(`<path d="M3.2 9.4h9.6l-1.5 3.1H4.7z"/><path d="M8 9.4V4.3"/>` +
    `<path d="M8 4.6h3.1L8 6.7"/><path d="M2.4 14.2c1.3.9 2.7.9 4 0s2.7-.9 4 0"/>`),
  walk: svgIcon(`<circle cx="9.3" cy="2.9" r="1.5"/><path d="M9.3 5.3 7.7 8.4l1.3 1.5.8 3.9"/>` +
    `<path d="M7.7 8.4 5.5 10"/><path d="M9 9.9 7 13.7"/><path d="M9.9 6.5l2 1.3"/>`),
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

// Symbol passend zum konkreten Verkehrsmittel des Abschnitts
function modeIcon(l) {
  const m = l.mode;
  if (m === "SUBWAY") return letterBadge("U");
  if (m === "SUBURBAN" || m === "METRO") return letterBadge("S");
  if (m === "TRAM") return ICON.tram;
  if (m === "BUS" || m === "COACH") return ICON.bus;
  if (["HIGHSPEED_RAIL", "LONG_DISTANCE", "NIGHT_RAIL"].includes(m)) return ICON.ice;
  if (["REGIONAL_RAIL", "REGIONAL_FAST_RAIL", "RAIL"].includes(m)) return ICON.regio;
  return ICON.ferry;
}

function productClass(mode) {
  if (["HIGHSPEED_RAIL", "LONG_DISTANCE", "NIGHT_RAIL"].includes(mode)) return "fern";
  if (["REGIONAL_RAIL", "REGIONAL_FAST_RAIL", "RAIL"].includes(mode)) return "regio";
  if (["SUBURBAN", "METRO"].includes(mode)) return "sbahn";
  if (["SUBWAY", "TRAM"].includes(mode)) return "utram";
  if (mode === "COACH") return "fernbus";
  if (mode === "BUS") return "bus";
  return "sonstige"; // Fähren, Rufbusse/On-Demand, Rest
}
function renderTimeline(itins, focus = "start") {
  const scroller = byId("timeline");
  const sameSearch = tl.searchTag === app.searchTag;
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
  if (keepScroll && tl.ppm) {
    const stepOld = tl.colW + TL.GAP;
    const idx = Math.round((prev.left) / stepOld);
    anchor = {
      time: tl.t0 + (prev.top / tl.ppm) * 60000,
      key: tl.itins[idx] ? itKey(tl.itins[idx]) : null,
      offset: prev.left - idx * stepOld,
    };
  }

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

  // Neuer Suchlauf: Y-Zoom dynamisch aus den Verbindungen ab der Startspalte
  if (!sameSearch) {
    tl.ppm = tlAutoZoom(scroller, startIdx);
    tl.lastZoomIdx = startIdx;
    tl.userMoved = false; // erst nach echter Nutzer-Geste vorausladen
  }

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

  if (keepScroll && anchor) {
    // Ankerspalte an derselben Bildschirmposition halten; Zeit-Anker für oben
    const step = tl.colW + TL.GAP;
    const newIdx = anchor.key ? tl.itins.findIndex(it => itKey(it) === anchor.key) : -1;
    scroller.scrollLeft = newIdx >= 0 ? Math.max(0, newIdx * step + anchor.offset) : prev.left;
    scroller.scrollTop = Math.max(0, tlY(anchor.time));
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
    scroller.scrollLeft = Math.max(0, (idx - 1) * (tl.colW + TL.GAP));
    scroller.scrollTop = tlAlignTopFor(bar, scroller);
    tl.lastZoomIdx = idx;
    if (bar.head) bar.head.classList.add("tl-focus");
    if (bar.el) bar.el.classList.add("tl-focus");
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
  // + DEP_LBL: Sonst rastet der Balkenanfang bündig unter der Kachel ein und
  //   verdeckt genau die Abfahrtszeit, die dort steht.
  const clear = tlHeadClear() + TL.DEP_LBL;
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
  tl.lastCheckLeft = null; // Referenz für die Scrollrichtung neu setzen
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
    const step = tl.colW + TL.GAP;
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
function tlAutoZoom(sc, startIdx = 0) {
  const usable = Math.max(180, (sc.clientHeight || 400) - TL.HEAD_H - 60);
  const it = tl.itins[Math.min(tl.itins.length - 1, Math.max(0, startIdx))];
  if (!it) return tl.ppm || 4;
  const legs = transitLegs(it);
  const durMin = Math.max(1,
    (+new Date(legs[legs.length - 1].to.arrival) - +new Date(legs[0].from.departure)) / 60000);
  const ppm = (usable * 0.7) / durMin;
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
  const risk = cancelled ? null : itinIssues(it).level;
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
    `<span class="tl-hl"><strong>${fmtTime(dep.departure)}</strong> ${cancelled ? `<span class="cancelled-label">Fällt aus</span>` : delayBadge(delayMin)}${riskMark(risk)}</span>` +
    `<small>${fmtDur(it.duration)}</small>` +
    `<small>${it.transfers} Umst.</small>`;
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
    const sev = !isCancelled && isReplacementService(l);
    seg.className = `tl-seg seg-${productClass(l.mode)}` + (h < 20 ? " nolabel" : "") +
      (isCancelled ? " seg-cancelled" : "") + (sev ? " seg-sev" : "");
    if (sev) seg.title = "Schienenersatzverkehr";
    seg.style.top = s0 + "px";
    seg.style.height = h + "px";
    const name = lineParts(l).main; // Zusatznummer nur in der Detailansicht
    // Ausgefallene Teilstücke: Streifenmuster, Name als weißer Text auf Schwarz
    if (isCancelled) seg.innerHTML = `<span class="seg-label">${escapeHtml(name)}</span>`;
    else seg.textContent = name;
    bar.appendChild(seg);
  }

  /* Zeiten an beiden Balkenenden — klein und zurückhaltend, damit sie den
     Balken nicht überstimmen. Ohne „ab“/„an“: Oben steht sie am Anfang des
     Balkens, unten am Ende; was gemeint ist, sagt die Position. */
  const t0lbl = document.createElement("span");
  t0lbl.className = "tl-dep";
  t0lbl.style.top = (top - 15) + "px";
  t0lbl.textContent = fmtTime(dep.departure);

  const t1lbl = document.createElement("span");
  t1lbl.className = "tl-arr";
  t1lbl.style.top = (top + height + 3) + "px";
  t1lbl.textContent = fmtTime(arr.arrival);

  col.appendChild(bar);
  col.appendChild(t0lbl);
  col.appendChild(t1lbl);

  tl.bars.push({ colLeft: left, top, height, itin: it, head, el: bar });
  return col;
}

/* ---------- Zoom ---------- */

// Zoom-Anker ist die OBERKANTE der Ansicht: die dort eingerastete
// Verbindung/Zeitmarke bleibt beim Zoomen stehen, die Skala streckt
// bzw. staucht sich nur nach unten.
function tlSetZoom(newPpm) {
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
