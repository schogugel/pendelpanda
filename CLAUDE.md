# CLAUDE.md — PendelPanda

Pendler-PWA (Neuauflage von pendelpanda.de). Vanilla JS/CSS/HTML, **kein Build-Schritt,
keine Frameworks, kein Backend**. Live: https://schogugel.github.io/pendelpanda/
(GitHub Pages, Branch `main`, Root). Dieses Verzeichnis (`app/`) ist das Repo —
`../design-refs/` und `../wayback-recovered/` gehören bewusst NICHT hinein.

## Versionierung (verbindlich)

Die App hat eine sichtbare Versionsnummer — Quelle der Wahrheit ist
`APP_VERSION` in `app.js` (angezeigt unten im ⚙-Dialog).

- **Bei JEDER Änderung erhöhen**, nach `MAJOR.MINOR.PATCH`:
  - **PATCH** — Fehlerbehebung, Detail-/Textänderung, Feinschliff.
  - **MINOR** — neue Funktion oder spürbar geändertes Verhalten.
  - **MAJOR** — grundlegender Umbau (Architektur, Datenquelle, Bedienkonzept).
- `CACHE` in `sw.js` **gleichlautend** mitziehen (`pendelpanda-v<Version>`), sonst
  bekommen Nutzer die Änderung nicht ausgeliefert.
- Die APK zieht automatisch mit: `native/sync.mjs` liest `APP_VERSION` und schreibt
  `versionName`/`versionCode` in `build.gradle`. **Niemals von Hand in Android pflegen** —
  sonst zeigen ⚙-Dialog und Android-Einstellungen Verschiedenes an.
- **Am Ende jeder Antwort die neue Versionsnummer nennen** — der Nutzer prüft damit
  im ⚙-Dialog, ob sein Gerät den aktuellen Stand hat.

## Arbeitsritual (bei jeder Änderung)

1. Code ändern → **`node tools/smoke.mjs`** (Pflicht, nicht optional).
   `node --check` prüft nur Syntax und übersieht Ladefehler. Der Ladetest führt
   platform/dblink/app/timeline in der Reihenfolge aus index.html aus und ruft die
   zentralen Funktionen einmal auf.
2. **`APP_VERSION` erhöhen und `CACHE` in `sw.js` angleichen** (siehe oben).
   Neue Shell-Dateien zusätzlich in `SHELL` eintragen.
3. Commit deutsch, Was+Warum, Version in der ersten Zeile, Trailer
   `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
4. Push → Deploy verifizieren: `until curl -sL <pages-url>/app.js | grep -q "<neuer-code>"; do sleep 5; done`
   (Achtung: Groß-/Kleinschreibung des Grep-Strings exakt!).
5. Nutzerhinweis: Ein Neuladen genügt (Netz-zuerst); danach steht die neue Nummer im
   ⚙-Dialog. Stimmt sie nicht, ist etwas mit dem Deploy oder dem SW nicht in Ordnung.

## Fallstrick: `const` vor seiner Deklaration benutzen

Alle vier Skripte sind **klassische Skripte** und teilen sich einen globalen Scope.
Ein `const`, das oben in einer Datei benutzt und weiter unten deklariert wird, wirft
beim LADEN — die Datei bricht ab. Funktionsdeklarationen sind aber schon gehoistet,
also existieren die Funktionen weiterhin und stolpern erst beim Aufruf über ein nicht
initialisiertes `const`. Man sieht dann einen Folgefehler an ganz anderer Stelle
(v1.7.0: `RISK_ICON` rief `svgIcon` 150 Zeilen zu früh → sichtbar war
„cannot access 'worst' before initialization“, und die App fand keine Verbindungen).
**Immer `node tools/smoke.mjs` laufen lassen** — der Test nennt die echte Ursache.

## Fallstrick: Navigation über den URL-Anker

Die Ansichten hängen am `location.hash` (damit die Android-Zurück-Geste greift).
Wird derselbe Hash erneut gesetzt, feuert **kein** `hashchange` — die Ansicht bleibt
stehen und die App wirkt tot. Deshalb: `navigate()` schaltet direkt um, wenn der Hash
schon passt, und beim Start wird ein übrig gebliebener Hash entfernt (er überlebt ein
Neuladen und blockierte sonst dauerhaft das Verbinden zweier Kacheln).

## Fallstrick: CSS-Blöcke per Skript ersetzen

Große Block-Ersetzungen in `style.css` (von Kommentar A bis Kommentar B) haben schon
**fremde Regeln mitgelöscht** (Legende, Kategorie-Punkte, Einstellungsliste, Zeit-Dialog
— erst Runden später bemerkt). Nach jedem Block-Ersatz gegenprüfen, dass die Selektoren
drumherum noch existieren, z. B.:
`for r in .tl-key .checklist .catdot .segmented .timechips; do grep -c "$r" style.css; done`

## Zwei Auslieferungen, EINE Codebasis

Es gibt die Web-App (GitHub Pages) und eine Android-APK. Beide laufen auf denselben
Dateien in der Repo-Wurzel — **kein zweiter Zweig, keine Kopie.** `native/` enthält nur
die Hülle; `native/sync.mjs` kopiert per **Allowlist** in `native/www/`, danach
`cap sync`. `www/`, `android/`, `node_modules/` sind Erzeugnisse und gitignored.

**Warum die APK existiert:** Der exakte DB-Verbindungslink braucht eine `vbid`, deren
Endpunkt keine CORS-Header schickt — keine Webseite darf ihn aufrufen, egal wo sie
liegt. Nativ gilt CORS nicht, also holt das Gerät die vbid selbst. Kein Proxy, kein
Konto, keine Anfragen, die sich bei einer Person sammeln. Der frühere Cloudflare-Worker
ist deshalb ersatzlos entfallen (steckt noch in der Historie bis `v1.5.2`).

Unterschiede ausschließlich über `PP.native` (platform.js), an vier Stellen:

| | Web | App |
|---|---|---|
| DB-Link | vorbefüllte Suche | exakte Verbindung (vbid, `dblink.js`) |
| Externe Links | neuer Tab | Intent via AppLauncher → DB Navigator, Karten |
| Zurück | Browser | Dialog › Ansicht › `exitApp()` |
| Service Worker | ja | nein (Dateien liegen lokal) |

- **Neue Datei zur App? → in die Allowlist in `native/sync.mjs`**, sonst fehlt sie in
  der APK. Das Skript bricht bei fehlenden gelisteten Dateien ab, kann aber nicht
  wissen, was du vergessen hast. Genauso in `SHELL` in `sw.js` eintragen.
- **Kein TWA/Bubblewrap/PWABuilder** — das ist Chrome mit vollem CORS und löst gar
  nichts. Es muss eine WebView mit nativer Brücke sein (Capacitor).
- `CapacitorHttp` wird **gezielt nur in `dblink.js`** benutzt, nicht global als
  `fetch`-Patch. Sonst liefen auch die Transitous-Aufrufe über den nativen Stack und
  der App-Build verhielte sich anders als der Web-Build.
- iOS bleibt bewusst bei der PWA: Eine native Verteilung außerhalb des App Store
  kostet 99 €/Jahr plus Apple-Notarisierung pro Build (AltStore PAL, nur EU/Japan/
  Brasilien) — für genau ein Feature. Die PWA läuft auf iOS ohnehin.

Was ansteht, steht in `TODO.md`.

## Dateien

- `TODO.md` — offene Punkte (Erledigtes wird gelöscht, nicht abgehakt)
- `tools/smoke.mjs` — Ladetest (gehört NICHT in die APK, steht nicht in der Allowlist)
- `platform.js` — Web/App-Erkennung (`PP`), externe Links, Zurück-Geste, Statusleiste
- `dblink.js` — vbid-Kette für den exakten DB-Link (nur nativ aktiv)
- `native/` — Capacitor-Hülle, Build-Skripte, `setup-toolchain.sh`, eigenes README
- `index.html` — alle Views/Dialoge (Grid, Edit, Ergebnisse, Settings, Zeit, Teilen, Hilfe, Trip-Details)
- `app.js` — Zustand, Grid/Gesten, Suche/Laden, Legende, Details, Settings, Link-Transfer
- `timeline.js` — Grafik (Canvas-Aufbau, Zoom, Panning, Einrasten, Prefetch, Kategorien)
- `sw.js` — **Netz-zuerst**, Cache nur als Offline-Rückfall; API-Requests nie cachen.
  Cache-zuerst hatte HTML/JS/CSS aus verschiedenen Ständen gemischt → hängende
  Versionsnummer, kaputte Verbindungsauswahl, lange Ladezeiten. **Nicht zurückdrehen.**
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
- **Beschaffung und Darstellung sind getrennt:** `fetchPage()` holt und mischt nur
  Daten, `runPlan()` orchestriert (inkl. Bootstrap/„Letzte“-Schleife) und rendert
  **genau einmal**. Nie wieder rekursiv `runPlan` aus `runPlan` — das mehrfache
  Rendern hat die Grafik jedes Mal neu positioniert (sichtbares Springen).
- **Alle Blätter-Loads durch die Schleuse `loadMoreRaw`** (`app.paging`-Lock, danach
  `maybeAutoFill()`-Kette). NIE `runPlan("later"/"earlier")` parallel aufrufen —
  paralleles Laden mit gleichem Cursor war eine Dubletten-Quelle.
- Dedupe via `itKey` (fahrplanbasiert: `route@schedDep@schedArr` je Leg — NICHT tripId),
  gegen Pool UND innerhalb des Batches. Pool immer chronologisch sortieren.
- Cursor (`EARLIER|ts` / `LATER|ts`) sind Zeitstempel und filter-agnostisch.
- `ensureFilled`: bis `neededVisible()` (= Spalten+2, Liste 6) sichtbar, max. 4 Seiten.
- Prefetch in `tlEdgeCheck` bei <1 Restfenster — aber nur in die Richtung, in die
  tatsächlich gescrollt wird, und erst nach echter Nutzer-Geste (`tl.userMoved`).
  Sonst löst schon das Positionieren beim Öffnen ein Nachladen aus. Rand-Spinner nur,
  wenn wirklich am Rand.
- Anfrage-Budget Transitous: 60/min pro IP. Typisch: Suche ≈2, Seite ≈1. Kein Grund zur Knausrigkeit, aber keine Parallel-Orgien.

## Transitous/MOTIS-Gotchas (teuer erarbeitet)

- **`transitModes`: `RAIL` ist die Oberklasse ALLER Züge inkl. ICE** — niemals für
  „Regionalzug“ verwenden. `METRO` = S-Bahn-artig, `COACH` = Fernbus.
- **`cancelled` auf WALK-Legs ist ein RT-Artefakt** (Halt-/Steig-Meldung am Umstieg),
  KEIN Ausfall des Anschlusses → als „⚠ Umstieg prüfen“ zeigen (`transferWarning`),
  nie als Ausfall. Echte Ausfälle: nur Transit-Leg-Flags (`cancelledTransitLegs`).
- **Meldungstexte gibt es — aber NICHT in `/plan`.** (Frühere Notiz hier war falsch.)
  Das `Alert`-Schema (headerText, descriptionText, cause, effect, severityLevel, url)
  hängt an den HALTEN und kommt nur über **`/stoptimes&withAlerts=true`**; in
  `/plan`-Antworten fehlt das Feld, auch mit `withAlerts`. Deshalb lädt
  `attachStopAlerts()` sie erst beim ÖFFNEN einer Verbindung für Ein-/Um-/Ausstiegs-
  halte nach (2–4 Anfragen, stundenweise gecacht). Die Texte kommen als **HTML**
  (`<b>`, `<ul>`, `<li>`) → immer durch `alertText()` (Struktur zu Zeichen, dann Tags weg).
- **Drei Risikoklassen mit je eigenem Symbol**, nicht ein Dreieck für alles
  (`transferIssues`/`legIssues`/`itinIssues`):
  `broken` (rot, Kreis-Strich) = nach Prognose nicht erreichbar ·
  `tight` (orange, Sanduhr) = erreichbar, aber ohne Reserve ·
  `notice` (gelb, Dreieck) = Meldung/ausgelassener Halt.
  Jede Markierung ist aufklappbar und nennt ihren Grund — ein Symbol ohne Erklärung
  ist schlimmer als keines.
- **`tight` meldet nur, wenn die ECHTZEITLAGE den Puffer gefressen hat**
  (`slack <= 2 && late > 0`). Von vornherein knapp geplante Umstiege sind bei MOTIS
  der Normalfall: An 84 echten Verbindungen hatte ein Drittel ≤1 min Reserve. Mit der
  Zusatzbedingung liegt die Gesamtquote bei 3 % statt 44 %.
- **Gleiswechsel gehört NICHT in die Aufklapper**, sondern bleibt direkt an der
  Gleisangabe (`trackChip`: „Gl. 7 statt 3“) — dort sucht man ihn beim Einsteigen.
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
  **Der Umkreis-Modus gilt für die ganze Suche:** Ist er aktiv (`app.aroundUsed`), muss
  auch jedes BLÄTTERN mit Koordinaten + den Fußweg-Parametern laufen
  (`app.aroundPlaces`). Cursor einer Koordinaten-Antwort zusammen mit Haltestellen-IDs
  ergeben 0 Treffer — dann „lädt“ die App endlos ohne Ergebnis.
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

- Y-Zoom: Zielspalten-Verbindung belegt **`settings.fill` %** der Fläche (Standard 70,
  einstellbar 40–90). Im **„Jetzt“-Modus wird von JETZT bis zur Ankunft gemessen**, nicht
  nur die Fahrtdauer — die Ansicht dockt dort an der Jetzt-Linie an, und bei langer
  Wartezeit schob die reine Fahrtdauer die Verbindung aus dem Bild (man sah nur den roten
  Balken). So bleiben Jetzt-Linie, ganze Verbindung und der eingestellte Puffer sichtbar;
  Neuberechnung nur bei neuer Suche + Spaltenwechsel (`tl.lastZoomIdx`-Guard schützt Pinch).
  **Zoom-Anker = Viewport-Oberkante** (oben bleibt stehen, unten atmet).
  `tl.minPpm`-Floor: p25 der Leg-Fahrzeiten behält ≥20 px (Labels nie wegzoombar).
- `keepScroll` hängt NUR an „gleiche Suche + es gab schon Spalten“ — nie an einer
  geänderten Trefferzahl. Sonst wirft ein Nachladen ohne Treffer die Ansicht auf den
  Startzustand zurück (sichtbar als „springt auf Jetzt zurück“).
- Scroll-Anker beim Nachladen: Ankerspalte über den **Schlüssel** (neue Verbindungen
  werden chronologisch auch MITTEN einsortiert — ein Index-Anker verschiebt dann alles)
  plus Zeit-Anker für die Vertikale; `tl.lastZoomIdx` mitziehen, sonst zoomt das
  Einrasten die Spalte neu. Die Ansicht darf sich durch Nachladen NIE bewegen.
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
- **„Letzte“ = Ankunftssuche, keine Eigenheuristik:** `arriveBy=true` mit
  `time = nextServiceEnd()` (nächste 04:00 lokal). Der Router liefert damit direkt die
  spätesten Verbindungen, die vor Betriebsschluss ankommen — EINE Anfrage, kein
  Rückwärtsblättern, deterministisch. Verifiziert: Strecke mit Nachtpause → letzte
  Abfahrt 00:33 (identisch zur früheren Lückensuche), durchfahrende Strecke → 02:46.
  Die frühere Konstruktion (Suche ab Morgen + rückwärts blättern + Lücken-Heuristik)
  war langsam und traf oft die falsche Verbindung — **nicht wieder einführen.**
  `findLastDecent()` wählt daraus nur noch die FOKUS-Spalte: späteste mit
  Umstiegswartezeit ≤45 min (Gesamtdauer bewusst kein Kriterium) **und Ankunft vor
  `nextServiceEnd()`**. Diese Schranke ist nötig, seit für den Kontext auch
  Verbindungen NACH der letzten geladen werden — ohne sie wanderte der Fokus einfach
  mit und beantwortete eine andere Frage.
- Bei „Letzte“ werden bewusst 4 Verbindungen NACH dem Fokus nachgeladen, damit die
  gesuchte Verbindung in der zweiten Spalte steht und rechts Nachbarn hat, statt am
  Rand zu kleben. Markiert wird sie gestrichelt an Kachel UND Balken (`.tl-focus`).
- Dominierte Verbindungen (später los wäre besser) ausgegraut, Label weiß.
- **Die Fokusspalte bestimmt den Zoom.** `startIdx` MUSS bei „Letzte“/Datumsauswahl
  auf die fokussierte Verbindung zeigen, sonst zoomt `tlAutoZoom` auf die erste
  geladene, während der Blick auf der letzten liegt — man scrollt seitwärts hin und
  sieht ins Leere. Vertikal immer `tlAlignTopFor`, nie eine eigene Rechnung.
  Die Fokusverbindung steht in der **zweiten** Spalte (eine Spalte Kontext davor).
- **Kontext-Vorladen gilt in JEDEM Modus** (zwei Verbindungen davor), nicht nur bei
  „Jetzt“ — sonst klebt das Ziel bei „Letzte“ am linken Rand.

## Verbindungs-Detailansicht (`fillDetails` + `updateJourneyLine`)

Aufbau wie bei der Bahn (Referenz in `../design-refs/`): **Halt zuerst, darunter die
Fahrt**, die dort abfährt — nicht umgekehrt. Reihenfolge je Abschnitt:
Halt (ab) → Fahrt-Block → Halt (an) → Umstieg → …

- Raster `Zeit | Punkt | Inhalt`; **eine durchgehende Linie über die GANZE Verbindung**
  (nicht pro Abschnitt), absolut positioniert an der Punktspalte.
- `updateJourneyLine` misst die Punkte und färbt die Linie bis zur aktuellen Position
  (zeitinterpoliert über alle Halte inkl. aufgeklappter Zwischenhalte); passierte Halte
  werden gedimmt. So sieht man, in welchem Abschnitt man gerade sitzt. Bei jedem
  `toggle` eines Zwischenhalte-Dropdowns neu vermessen.
- Linien-Chip: Verkehrsmittel-Symbol (`MODE_ICON`) + Trennstrich + Liniennummer,
  eingefärbt nach Kategorie; darunter „nach <Ziel>“.
- Gleis nur an Ein-/Ausstieg (`trackChip`), nie an Zwischenhalten.

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
- Spalten nebeneinander: **3–7** (`settings.cols`). Die colW-Untergrenze (34 px) ist
  bewusst niedrig, damit 7 auf einem Telefon wirklich nebeneinander passen; darüber
  greifen zwei Enge-Stufen am Scroller (`.narrow` <62 px, `.tiny` <46 px), die nur die
  Schrift verkleinern und „2 Umst.“ zu „2×“ kürzen. Gemessen: 7 passen ab 393 px
  Bildschirmbreite, auf 360 px sind es real 6,7.
- BASE 14 (7×2, scrollfrei), „Mehr als 14“: gerade bis 40 + `connectMode`
  `hybrid` (Wischen verbindet; ab gewähltem Start scrollt Wischen frei) / `tap`.
  Umsetzung: `.buttongrid.no-drag` + Guard in `attachStationPointer`. Verkleinern nie
  unter belegte Kacheln.
- Edit-Flow: Bearbeiten = nur Label + Löschen (Stationswechsel = löschen+neu);
  Neuanlage zweiphasig (Suche → `pendingStation` → Label optional → Speichern).
- Übertragungs-Link `#cfg=` = Base64-JSON `{v:2, slots, show, cols, connect}`;
  v1 (nur Array) bleibt lesbar. Alles Personalisierte muss hier hinein.

## Design-Tokens & Stil

- **Systemzonen oben UND unten freihalten** (`env(safe-area-inset-*)` am `body`):
  Android zeichnet ab Version 15 randlos, die APK legte die Überschrift sonst unter die
  Statusleisten-Symbole. Im Browser und in der installierten PWA ist der Wert 0.
- Dark-first. bg `#0a0e18`, card `#131928`, Akzent Amber `#f0a63a` (hell `#b97800`).
  Status semantisch: ok grün, warn orange, bad rot — nie als Deko missbrauchen.
- Formen: Kacheln 4 px (Farbbalken INNEN an der Oberkante, eingerückt), Karten/Chips 8 px,
  Segmente 3 px. Typo-Akzente versal-gesperrt (Seitentitel, BEARBEITEN, START-Flag).
- Verspätungs-Abzeichen zeigt IMMER die Zahl (`+0`, `+3`, …), auch ohne Echtzeitdaten.
  Ein Sonderzustand „Plan“ war ausdrücklich unerwünscht — die Datenlage steckt in der
  Textfarbe der Uhrzeit, nicht im Abzeichen.
- An beiden Balkenenden steht die Uhrzeit (`.tl-dep` / `.tl-arr`), klein und ohne
  „ab“/„an“ — die Position sagt, was gemeint ist. `TL.DEP_LBL` reserviert den Platz
  dafür; wer am Einrasten oder an der Kopffreiheit rechnet, muss ihn mit einrechnen,
  sonst verschwindet die Abfahrtszeit unter der Kopf-Kachel.
- Fahrdauern: <60 min „42 min“, sonst „1:40 h“ (`fmtDur`). Ist-Zeiten farbcodiert,
  Soll durchgestrichen gestapelt darüber (Spaltenbreite konstant halten!).
- Icons: aus `icons/icon_pendelpanda.png` generieren (magick). **Bei Icon-Wechsel
  Dateinamen ändern** (Launcher/Manifest-Caches); PWA friert Icon/theme_color bei
  Installation ein → Neuinstallation nötig. theme_color/background_color = bg-Farbe.

## DB-Integration

- **Zeiten im DB-Link immer in Europe/Berlin** (`localMinuteIso`), NIE in der Zeitzone
  des Geräts. Wer aus einer anderen Zeitzone plant, bekäme sonst die falsche Minute —
  die Suche landet daneben, der Worker findet die Verbindung überhaupt nicht.
- Fallback-Link: `bahn.de/buchung/fahrplan/suche#sts=true&so/zo/soid/zoid&hd=<exakte Sollabfahrt>`.
- Exakter Verbindungs-Link (öffnet DB Navigator mit „Zu meinen Reisen“): Worker deployen,
  URL in `DB_LINK_PROXY` (app.js) eintragen. Ablauf: bahn.de `fahrplan` (ctxRecon) →
  mob-Backend `verbindung/teilen` `{GH, HD, SO, ZO}` (Media-Type
  `application/x.db.vendo.mob.verbindungteilen.v1+json`, UA `DBNavigator/Android/26.9.0`)
  → `vbid`. Inoffiziell; ein Aufruf pro Klick.
- **Der einzige Hinderungsgrund im Browser ist CORS** — am 25.08.2026 nachgemessen:
  Der Teilen-Endpunkt beantwortet den Preflight mit 405 und ohne
  `Access-Control-Allow-Origin`, und der Media-Type erzwingt einen Preflight. Der
  User-Agent ist dagegen egal (mit Browser-UA kam ebenso eine vbid). Heißt: Jede
  Umgebung ohne Browser-CORS — Worker, oder eine APK mit nativem HTTP — kann die
  Kette direkt fahren. Ein TWA-Wrapper hilft NICHT, das ist Chrome mit CORS.

## Historie / Kontext

Ursprung: Wayback-Rekonstruktion der alten Seite (Konzept: Kachel-Grid, 2 Taps).
Datenquelle Transitous statt DB-HAFAS (2025 abgeschaltet; bahn.de-APIs rate-limitiert).
Ausführliche Änderungs-Historie: Session-Memory bzw. `git log`.
