# CLAUDE.md — PendelPanda

Pendler-PWA (Neuauflage von pendelpanda.de). Vanilla JS/CSS/HTML, **kein Build-Schritt,
keine Frameworks, kein Backend**. Live: https://schogugel.github.io/pendelpanda/
(GitHub Pages, Branch `main`, Root). Dieses Verzeichnis (`app/`) ist das Repo —
`../design-refs/` und `../wayback-recovered/` gehören bewusst NICHT hinein.

## Arbeitsritual (bei jeder Änderung)

1. Code ändern → `node --check app.js timeline.js` (Syntax).
2. **`sw.js`: Cache-Version bumpen** (`pendelpanda-vNN` → NN+1) — sonst sehen
   Nutzer die Änderung nicht. Neue Shell-Dateien in `SHELL` eintragen.
3. Commit deutsch, Was+Warum, Trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
4. Push → Deploy verifizieren: `until curl -sL <pages-url>/app.js | grep -q "<neuer-code>"; do sleep 5; done`
   (Achtung: Groß-/Kleinschreibung des Grep-Strings exakt!).
5. Nutzerhinweis: SW aktualisiert per „stale-while-revalidate“ → **zweimal neu laden**.

## Dateien

- `index.html` — alle Views/Dialoge (Grid, Edit, Ergebnisse, Settings, Zeit, Teilen, Hilfe, Trip-Details)
- `app.js` — Zustand, Grid/Gesten, Suche/Laden, Legende, Details, Settings, Link-Transfer
- `timeline.js` — Grafik (Canvas-Aufbau, Zoom, Panning, Einrasten, Prefetch, Kategorien)
- `sw.js` — Cache-first mit Hintergrund-Update; API-Requests nie cachen
- `db-link-worker/worker.js` — optionaler Cloudflare Worker für exakte DB-Links (vbid)
- `icons/icon_pendelpanda.png` — Icon-QUELLE (schwarz auf weiß, 1254²)

## Lade-Architektur (Invarianten — nicht aufweichen!)

- **Pro Ladevorgang eine ungefilterte Anfrage — plus eine gefilterte, sobald
  Kategorien ausgeblendet sind.** Beide Ergebnisse in EINEM Dedupe-Durchgang mischen;
  Cursor immer aus der ungefilterten Antwort.
  **Warum beides zwingend ist (teuer gelernt, nicht „optimieren“!):** MOTIS liefert
  **Pareto-optimale** Ergebnisse. Eine Verbindung, die langsamer *und* umstiegsreicher
  ist als eine andere, wird weggeschnitten — auch wenn sie die einzige ist, die zum
  Filter des Nutzers passt. Beispiel Nürnberg-Erlenstegen → Kufstein: ungefiltert
  kommen ausschließlich ICE-Ketten, die reinen Regio-Verbindungen (D-Ticket!) fehlen
  vollständig; mit `transitModes` erscheinen 10 Stück. Die beiden Antworten waren im
  Test **disjunkt**. Ungefiltert braucht es trotzdem — es speist die Legende
  („was gäbe es sonst noch?“).
- Verkehrsmittel-Filterung der **Anzeige** bleibt clientseitig (`hiddenCats` +
  `productClass`); die gefilterte Anfrage beschafft nur zusätzliche Kandidaten.
- **Alle Blätter-Loads durch die Schleuse `loadMoreRaw`** (`app.paging`-Lock, danach
  `maybeAutoFill()`-Kette). NIE `runPlan("later"/"earlier")` parallel aufrufen —
  paralleles Laden mit gleichem Cursor war eine Dubletten-Quelle.
- Dedupe via `itKey` (fahrplanbasiert: `route@schedDep@schedArr` je Leg — NICHT tripId),
  gegen Pool UND innerhalb des Batches. Pool immer chronologisch sortieren.
- Cursor (`EARLIER|ts` / `LATER|ts`) sind Zeitstempel und filter-agnostisch.
- `ensureFilled`: bis `neededVisible()` (= Spalten+2, Liste 6) sichtbar, max. 4 Seiten.
- Prefetch in `tlEdgeCheck` bei <1 Restfenster; Rand-Spinner nur, wenn wirklich am Rand.
- Anfrage-Budget Transitous: 60/min pro IP. Typisch: Suche ≈2, Seite ≈1. Kein Grund zur Knausrigkeit, aber keine Parallel-Orgien.

## Transitous/MOTIS-Gotchas (teuer erarbeitet)

- **`transitModes`: `RAIL` ist die Oberklasse ALLER Züge inkl. ICE** — niemals für
  „Regionalzug“ verwenden. `METRO` = S-Bahn-artig, `COACH` = Fernbus.
- **`cancelled` auf WALK-Legs ist ein RT-Artefakt** (Halt-/Steig-Meldung am Umstieg),
  KEIN Ausfall des Anschlusses → als „⚠ Umstieg prüfen“ zeigen (`transferWarning`),
  nie als Ausfall. Echte Ausfälle: nur Transit-Leg-Flags (`cancelledTransitLegs`).
- Kein Alert-/Meldungstext in den Daten (Spec+Live geprüft) — nur strukturierte Flags.
- `withScheduledSkippedStops=true` immer mitschicken (übersprungene Halte).
- Tests per curl/node brauchen einen **eigenen User-Agent** — generische werden geblockt
  (Browser-PWA unbetroffen, Origin identifiziert die App).
- API-Reihenfolge der itineraries ist teils Ranking, nicht Zeit → immer selbst sortieren.
- **Schienenersatzverkehr steht an einem ANDEREN Halt.** Ist eine Strecke gesperrt,
  hat der Bahnhof gar keine Fahrten mehr; der Ersatz fährt als Bus ab einem Nachbarhalt
  (Beispiel Vorra: Bahnhof leer, aber „Vorra a.d. Pegnitz Rathaus“ hat RB30-**Busse**).
  Eine Suche Stop-ID → Stop-ID findet das prinzipiell nie. Deshalb `planAround`:
  bei leerem Ergebnis einmalig mit **Koordinaten** statt IDs suchen, dazu
  `maxPreTransitTime`/`maxPostTransitTime` auf 1800 — ohne diese Parameter liefert
  auch die Koordinatensuche 0 (Default-Fußweg zu kurz). Ergebnis mit Hinweisbanner
  kennzeichnen. Slots speichern `lat`/`lon`; Altbestand wird per Geocode nachgerüstet.
- **SEV erkennen:** Ersatzverkehr fährt als `mode: BUS` mit `routeType: 3`, trägt aber
  die BAHN-Liniennummer (`routeShortName: "RB30"`). `isReplacementService()` prüft genau
  das (plus „SEV“/„Ersatz“ im Namen) — an echten Strecken validiert: 10/10 Treffer im
  SEV-Fall, 0 Fehlalarme bei normalen Stadt-/Regionalbussen. Darstellung: gelbe
  Schrägstreifen ÜBER der Kategoriefarbe (es bleibt ein Bus), Badge „Ersatzverkehr“ in
  den Details. Nicht mit der Ausfall-Streifung (schwarz-rot) verwechseln.
- **Koordinaten sind überall dabei** (`place.lat/lon`) → `mapsPin()` baut daraus
  Google-Maps-Links; wichtig, um Ersatzhaltestellen tatsächlich zu finden.
- **Datenlücken sind real und sehen wie App-Fehler aus:** Ein Halt kann im Geocoder
  existieren und Abfahrten liefern, deren Fahrplan aber erst Wochen später beginnt
  (Beispiel Vorra (Pegnitz), 24.08.2026: 0 Verbindungen; ab 14.09.2026 fährt die RB30
  normal). Bei leerem Ergebnis daher IMMER `stoptimes` für beide Halte prüfen und dem
  Nutzer den Grund nennen (`diagnoseEmpty`) — nie kommentarlos „nichts gefunden“.
- Stop-IDs können Bahnsteig-Ebene sein (`…:3:1`). Das ist korrekt so — die zugehörige
  Eltern-ID ohne Suffix ist oft **keine** gültige Timetable-Location (404). Immer die
  ID aus dem Geocoder verwenden, nie selbst kürzen.

## Grafik (timeline.js)

- Y-Zoom: Zielspalten-Verbindung belegt **70 %** der Fläche unter den Kopf-Kacheln;
  Neuberechnung nur bei neuer Suche + Spaltenwechsel (`tl.lastZoomIdx`-Guard schützt Pinch).
  **Zoom-Anker = Viewport-Oberkante** (oben bleibt stehen, unten atmet).
  `tl.minPpm`-Floor: p25 der Leg-Fahrzeiten behält ≥20 px (Labels nie wegzoombar).
- Kopffreiheit: `tlHeadClear()` misst die HÖCHSTE Kopf-Kachel; t0 wird vorab + per
  Nachkorrektur (auch in `tlSetZoom`) so erweitert, dass der früheste Balken und die
  Jetzt-Linie nie hinter den Kacheln verschwinden.
- Docking: Einrasten auf Spaltengrenzen (Halbe-Spalte-Regel); vertikal an Balkenstart —
  bei der nächsten erreichbaren Verbindung an der **Jetzt-Linie**, außer <40 % des ersten
  Segments wären sichtbar (dann Balken). `tlAlignTopFor` ist die eine Wahrheit dafür.
- Touch: freies Panning (`touch-action:none`), weiche Achsdämpfung (nur bei klar
  vertikaler Geste wird dx auf 20 % gedämpft), **kein Schwung-Nachlauf** — `releaseGlide`
  rastet direkt ein. Klick-Unterdrückung über Zeitfenster `tl.panEndAt` (300 ms), NIE
  über ein Flag (Browser feuert nach Wischgesten oft keinen Klick → Flag frisst den nächsten).
- „Letzte“-Heuristik: Nachtflaute = letzter Abfahrtsabstand ≥ max(90 min, 2,5×Median-Takt);
  „anständig“ = max. Umstiegswartezeit ≤45 min (Gesamtdauer bewusst KEIN Kriterium).
- Dominierte Verbindungen (später los wäre besser) ausgegraut, Label weiß.

## Kategorien & Legende

- 7 Kategorien fix: fern, regio, sbahn, utram, bus, sonstige (Fähre/Rufbus/Rest), fernbus.
- Legende statisch gebaut (alle immer sichtbar), 3 Zustände: farbiger Punkt (an),
  hohler Punkt (Daten da, ausgeblendet), ausgegraut+durchgestrichen (keine Daten).
  Toggle rein clientseitig; `hiddenCats` resettet NUR bei `startFreshSearch` (Grid),
  überlebt Jetzt/Letzte/📅/⇄.
- Kategorie-Palette ist dataviz-validiert (CVD-Checks). Ausfall-Segmente: schwarz-rot
  schräg gestreift, Label weiß auf schwarzem Chip — **weiße Segment-Schrift ist dem
  Ausfall vorbehalten** (Ausnahmen: fernbus/sonstige-Chips, dominierte Labels).

## Grid & Kacheln

- `slots` = geordnetes Array inkl. `null`-Lücken (Position = Index, Länge = Feldzahl);
  Einträge `{name, id, label?}` — `name` ist der offizielle Bahnhofsname (Pflicht für
  DB-Link/API), `label` reine Anzeige.
- BASE 14 (7×2, scrollfrei), „Mehr als 14“: gerade bis 40 + `connectMode`
  `hybrid` (Wischen verbindet; ab gewähltem Start scrollt Wischen frei) / `tap`.
  Umsetzung: `.buttongrid.no-drag` + Guard in `attachStationPointer`. Verkleinern nie
  unter belegte Kacheln.
- Edit-Flow: Bearbeiten = nur Label + Löschen (Stationswechsel = löschen+neu);
  Neuanlage zweiphasig (Suche → `pendingStation` → Label optional → Speichern).
- Übertragungs-Link `#cfg=` = Base64-JSON `{v:2, slots, show, cols, connect}`;
  v1 (nur Array) bleibt lesbar. Alles Personalisierte muss hier hinein.

## Design-Tokens & Stil

- Dark-first. bg `#0a0e18`, card `#131928`, Akzent Amber `#f0a63a` (hell `#b97800`).
  Status semantisch: ok grün, warn orange, bad rot — nie als Deko missbrauchen.
- Formen: Kacheln 4 px (Farbbalken INNEN an der Oberkante, eingerückt), Karten/Chips 8 px,
  Segmente 3 px. Typo-Akzente versal-gesperrt (Seitentitel, BEARBEITEN, START-Flag).
- Fahrdauern: <60 min „42 min“, sonst „1:40 h“ (`fmtDur`). Ist-Zeiten farbcodiert,
  Soll durchgestrichen gestapelt darüber (Spaltenbreite konstant halten!).
- Icons: aus `icons/icon_pendelpanda.png` generieren (magick). **Bei Icon-Wechsel
  Dateinamen ändern** (Launcher/Manifest-Caches); PWA friert Icon/theme_color bei
  Installation ein → Neuinstallation nötig. theme_color/background_color = bg-Farbe.

## DB-Integration

- Fallback-Link: `bahn.de/buchung/fahrplan/suche#sts=true&so/zo/soid/zoid&hd=<exakte Sollabfahrt>`.
- Exakter Verbindungs-Link (öffnet DB Navigator mit „Zu meinen Reisen“): Worker deployen,
  URL in `DB_LINK_PROXY` (app.js) eintragen. Ablauf: bahn.de `fahrplan` (ctxRecon) →
  mob-Backend `verbindung/teilen` `{GH, HD, SO, ZO}` (Media-Type
  `application/x.db.vendo.mob.verbindungteilen.v1+json`, UA `DBNavigator/Android/26.9.0`)
  → `vbid`. Inoffiziell; ein Aufruf pro Klick. CORS-blockiert im Browser → nur via Worker.

## Historie / Kontext

Ursprung: Wayback-Rekonstruktion der alten Seite (Konzept: Kachel-Grid, 2 Taps).
Datenquelle Transitous statt DB-HAFAS (2025 abgeschaltet; bahn.de-APIs rate-limitiert).
Ausführliche Änderungs-Historie: Session-Memory bzw. `git log`.
