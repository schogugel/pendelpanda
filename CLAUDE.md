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

1. Code ändern → **`node tools/check.mjs`** (Pflicht, nicht optional).
   Prüft zweierlei, weil beide Fehlerklassen schon je einmal ausgeliefert wurden:
   **statisch** (ESLint `no-undef`) findet Namen, die es nicht gibt — auch in Zweigen,
   die erst bei einer echten Suche laufen (v1.9.0: `t.kind` nach weggefallenem
   `const t`); **dynamisch** (`smoke.mjs`) führt die Dateien in der Reihenfolge aus
   index.html aus und findet Abstürze beim Laden (v1.7.0: `const` vor Deklaration
   benutzt). **`node --check` findet KEINEN von beiden** — beide waren syntaktisch
   einwandfrei. Einmalig vorher: `cd tools && npm install`.
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
- **Impressum:** `IMPRESSUM` in app.js. Solange `name` leer ist, bleibt der Eintrag in
  den Einstellungen VERBORGEN — ein unvollständiges Impressum ist schlechter als keines,
  weil es eine Pflichtangabe vortäuscht, die es nicht erfüllt. Nie mit Platzhaltern füllen.
- `tools/check.mjs` — **der Prüfbefehl vor jedem Commit** (statisch + Ladetest)
- `tools/layout.mjs` — misst die Startseite in einem echten Browser (bei Layoutänderungen)
- `tools/smoke.mjs`, `tools/eslint.config.mjs` — die beiden Prüfungen dahinter
  (Dev-Werkzeug, gehört NICHT in die APK und steht nicht in der Allowlist)
- `platform.js` — Web/App-Erkennung (`PP`), externe Links, Zurück-Geste, Statusleiste
- `dblink.js` — vbid-Kette für den exakten DB-Link (nur nativ aktiv)
- `native/` — Capacitor-Hülle, Build-Skripte, `setup-toolchain.sh`, eigenes README.
  **`sync.mjs` schreibt Version, Signatur-Einstellung und Dateinamen ins erzeugte
  Gradle-Projekt** — `android/` ist ein Erzeugnis, von Hand dort zu editieren ist
  zwecklos. Release-APK nur mit `native/keystore.properties`; ohne sie ist das
  Ergebnis unsigniert und nicht installierbar.
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
- **Erdrückt EINE Kategorie das Ergebnis, wird sie in der zweiten Anfrage
  AUSGESCHLOSSEN** (`relievedModes`, Schwelle `CROWD_SHARE = 0,6`). Das ist derselbe
  Pareto-Effekt wie oben, nur innerhalb der Stadt und viel häufiger: Sichtbar bleibt
  nur, wer später losfährt UND früher ankommt — bei dichtem Takt gewinnt damit immer
  dasselbe Verkehrsmittel. Gemessen München Hbf → Ost um 10 Uhr: U5 braucht 11 min,
  die S-Bahn 15, also verdrängt jede U5 die S-Bahn kurz davor. Von 20 Verbindungen
  waren 16 U5 und 4 S6 — während in Wirklichkeit alle zwei Minuten eine S-Bahn zum
  Ostbahnhof fährt. S1, S2, S3, S4 und S8 fehlten VOLLSTÄNDIG.
  Nachgemessen an acht Strecken: Die Regel greift bei sechs und verdoppelt dort die
  Trefferzahl (München 20→37, Berlin Alex→Zoo 20→40, Hamburg Hbf→Altona 20→40,
  Nürnberg Hbf→Erlenstegen 20→36). Wo nichts fehlt, greift sie nicht — Frankfurt
  Hbf→Süd (48 %) und Köln Hbf→Deutz (55 %) liegen unter der Schwelle und lösen keine
  Anfrage aus. Die Schwelle ist genau dazwischen gewählt, nicht geraten.
  **Beim BLÄTTERN kostet das nichts**: Es ist dieselbe zweite Anfrage, die bei
  ausgeblendeten Kategorien ohnehin läuft, nur mit engerem Modus-Satz. Nur die ERSTE
  Seite einer Suche muss sie nachholen (eine Anfrage mehr), weil vor ihr noch der Pool
  der vorherigen Suche steht — nach dem zu urteilen hieße, die falsche Frage zu
  beantworten. Suche kostet damit 5 statt 4 Anfragen, „Letzte“ 7 statt 6.
  Die Cursor bleiben dabei unangetastet — Entlastung ist ein Seitenweg, kein Blättern.
- Verkehrsmittel-Filterung der **Anzeige** bleibt clientseitig (`hiddenCats` +
  `productClass`); die gefilterte Anfrage beschafft nur zusätzliche Kandidaten.
- **Einblenden über die Legende lädt nach** (`refillLoadedRange`) — es MUSS, weil die
  Verbindungen dieser Kategorie im Pool schlicht fehlen können: Pareto verdrängt sie.
  Gemessen Nürnberg→München: ungefiltert kein einziger Fernbus, nach dem Einblenden
  24 neue Verbindungen, davon 21 mit Fernbus.
  **Nachgefüllt wird der GANZE geladene Zeitraum**, nicht nur das sichtbare Fenster:
  Zurückscrollen lädt nichts nach, ältere Spalten blieben sonst dauerhaft unvollständig.
  Bezahlbar wird das durch `REFILL_LIMIT = 30` — eine Anfrage deckt damit rund 12 h ab
  (gemessen 709 min bei 371 ms; mit 10 nur 156 min), also 1–3 Anfragen für den ganzen
  Bereich statt 5–8. **Die Cursor der laufenden Suche bleiben dabei unangetastet** —
  das Nachfüllen ist ein Seitenweg, kein Blättern.
- **Ausgegraut in der Legende heißt „nachweislich nichts da“** (`app.emptyCats`), und
  das weiß man erst NACH einer eigenen Anfrage für diese Kategorie. Vorher stand dort
  „Keine … im Zeitraum“, obwohl nur niemand danach gefragt hatte. Chips sind deshalb
  immer anklickbar; Ausblenden kostet weiterhin keine Anfrage.
- **`tlStop()` beendet alles, was noch an der Grafik arbeitet** — Verfahrbewegung,
  verzögerter Einrast-Aufruf, Sperren. Aufrufen bei jeder neuen Suche
  (`showSearching`), beim Verlassen der Ergebnisansicht (`showView`) und vor jedem
  Neuaufbau (`renderTimeline`). Ohne das lief die Bildschleife weiter und baute die ALTE
  Grafik immer wieder neu auf — auch in eine längst geleerte Ansicht hinein. Die
  Schleife prüft zusätzlich `tl.searchTag !== app.searchTag` und gibt von selbst auf.
  **Wer eine neue Schleife oder einen Zeitgeber an der Grafik einführt, trägt ihn hier
  ein** — sonst kommt genau diese Fehlerklasse zurück.
- **Während einer frischen Suche ist ALLES Alte weg** (`showSearching`): Liste und
  Grafik werden ausgeblendet und geleert, Hinweiszeilen zurückgesetzt. Vorher blieb der
  vorherige Stand stehen, bis der neue kam — beim Wechsel zwischen „Jetzt“ und „Letzte“
  sah man kurz die Verbindungen der anderen Ansicht. Lieber einen Moment nichts als
  etwas Falsches. `renderResults` blendet die Anzeige wieder aus, der Fehlerzweig
  ebenfalls (sonst läuft der Balken unter der Fehlermeldung weiter).
- **Die Suchanzeige nimmt in der Grafikansicht GENAU den Platz der Grafik ein**
  (`#searching` bekommt dieselbe Flex-Zuteilung wie `#timeline-wrap`). Vorher klappte
  sie auf ihre Inhaltshöhe zusammen — die Legende sprang beim Laden nach oben und beim
  Fertigwerden zurück. Gemessen beginnt die Legende jetzt in beiden Zuständen bei
  derselben Höhe (791 px bei 393×852). Wer eine weitere Zeile in die Suchanzeige legt,
  muss das erhalten.
- **Der Suchbalken zeigt SCHRITTE, keine Prozente** — ein Feld je Schritt, erledigte
  gefüllt, im laufenden wandert ein Licht. Wie LANGE ein Schritt dauert, hängt an einem
  fremden Dienst und lässt sich nicht vorhersagen; WIE VIELE es sind, dagegen schon.
  Frische Suche 3 Felder, Nachladen über die Legende 2.
- **`Was gerade passiert` (`renderPlanLog`) nennt Antwortzeiten je Anfrage.** Bei einer
  zügigen Suche schaut da niemand hinein, bei einer langen will man wissen, ob überhaupt
  etwas passiert. Ab zwei Antworten über 1,5 s steht dort ausdrücklich, dass der
  Fahrplandienst drosselt — genau das gemessene Verhalten (ab etwa der zwölften Anfrage
  in kurzer Folge konstant ~3 s). Sonst sähe es aus, als hinge die App.
- Der Suchbalken läuft **ohne Prozentangabe** — die Dauer hängt an bis zu drei Anfragen
  an einen fremden Dienst, eine ausgedachte Zahl wäre gelogen. Stattdessen nennt der
  Text den laufenden Schritt.
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
- **Umsteigezeit als STUFE** (`settings.xferLevel`, `XFER_LEVELS`), nicht als
  Minutenzahl. Hauptregler ist `transferTimeFactor` — er skaliert die vom Router
  berechnete nötige Zeit und wirkt damit ANTEILIG zur Größe des Bahnhofs. Ein fester
  Aufschlag allein wäre falsch (gleich viel am Dorfhalt wie am Kopfbahnhof), ein Faktor
  allein aber auch: Gemessen macht selbst Faktor 3 aus einer Grundzeit von 2 min nur
  6 min. Deshalb je Stufe zusätzlich ein kleiner fester Sockel
  (`additionalTransferTime`). Beides geht in DIESELBE Anfrage, kostet also nichts.
  Gemessen an vier Strecken wächst der kürzeste Umstieg über die Stufen von 2–4 auf
  6–18, 11–18 und 18–22 min, bei unverändert 10 Ergebnissen je Strecke.
- MOTIS kennt **keine Obergrenze** für Wartezeiten — die muss clientseitig bleiben.
- **Transitous-Nutzungsbedingungen einhalten** (transitous.org/api):
  1. Sichtbarer Link auf **transitous.org/sources** zur Nennung der Datenquellen — steht
     im „Daten & Datenschutz“-Dialog und in der Hilfe. Nicht entfernen.
  2. Anfragen sollen die App erkennbar machen (Name, **Version**, Kontakt). Im nativen
     Build über `appendUserAgent`; den Wert schreibt **`sync.mjs`** aus `APP_VERSION` —
     von Hand gepflegt liefe er der echten Version hinterher. Im Browser lässt sich der
     User-Agent nicht setzen, dort identifiziert der Origin die App.
  3. „Not intended for commercial or for-profit purposes“ — bei Spendenlink oder
     Ähnlichem vorher bei Transitous nachfragen, sie bitten ausdrücklich darum.
- **Transitous drosselt, es lehnt nicht ab.** Gemessen: ab etwa der zwölften Anfrage in
  kurzer Folge antwortet es konstant nach ~3 s statt ~200 ms, ohne 429 und ohne
  Rate-Limit-Header; nach wenigen Sekunden Pause ist es wieder normal. Eine Suche kostet
  4 Anfragen (Jetzt/Kalender) bzw. 6 („Letzte“) — die Drosselung greift also schon nach
  rund drei zügigen Suchen.
- **Eine neue Suche bricht die Anfragen der vorherigen ab** (`app.planAbort`). Das
  verhindert vor allem, dass die FOLGE-Runden einer überholten Suche überhaupt losgehen
  (Kontext davor/danach); die bereits gesendete erste Runde ist verloren. Zusätzlich
  verwirft `fetchPage` verspätete Antworten über `myTag !== app.searchTag` — ohne diese
  Prüfung konnte eine langsame Antwort den Pool der neuen Suche ÜBERSCHREIBEN, man sah
  dann Verbindungen der vorher gewählten Strecke.
- `AbortError` in `runPlan` still schlucken — ein Abbruch ist kein Fehler.
- **Seitengröße `PAGE_SIZE = 20`, nicht 10.** Was eine Seite an ZEIT abdeckt, hängt
  völlig von der Strecke ab — gemessen 30 min zwischen München Hbf und Ost, aber 285 min
  zwischen Nürnberg und Bayreuth. Mit 10 sah man in der Stadt deutlich weniger als in der
  DB-App, obwohl keine Halte fehlten.
- **`detailedLegs: "false"` immer mitschicken.** Die App zeichnet keine Karte und liest
  weder `legGeometry` noch `steps`. Gemessen spart das 60 % der Antwort (168 → 67 KB);
  20 Verbindungen kosten damit 133 KB, also WENIGER als vorher 10 mit 168 KB, und die
  Anfrage ist schneller. Gegengeprüft: kein von der App benutztes Feld fehlt.
  (`detailedTransfers` allein bringt nichts — die Geometrie kommt trotzdem.)
- **München Hbf ist KEIN Sonderfall.** MOTIS fasst den Komplex bereits zusammen: Unter
  einer Kennung erscheinen `de:09162:100` (Fernbahn), `:6` (U/Tram), `:5000` (Süd) und
  `:7000` (Nord) — samt der tiefen S-Bahn. „München Hbf (tief)“ existiert nicht als Halt,
  nur als OSM-Ort. Elternstationen gibt es (ID mit `P` vor der Nummer, z. B. München Ost),
  aber nicht überall und nicht immer routingfähig — beim Hbf antwortet die Elternform 404.
  Eine Auswahl beim Einrichten einer Kachel wäre also eine Lösung ohne Problem.
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
- **Fußfreiheit (`tlEnsureTail`) ist das Gegenstück zur Kopffreiheit** und genauso
  nötig: Die Leinwand endete 14 min nach der letzten Ankunft, dadurch ließ sich ein
  kurzer Balken am rechten Rand gar nicht bis unter die Kopf-Kachel hochschieben — der
  Browser klemmt das Scrollen ab. Das Einrasten sah aus, als hätte es aufgehört zu
  funktionieren, und zwar UMSO MEHR, je weiter rechts man war (gerechnet: 8 px
  Fehlbetrag in einer frühen Spalte, über 300 px in der letzten). Nach jedem `tlBuild`
  aufrufen — auch nach `tlSetZoom`, weil sich mit der Zoomstufe alles verschiebt.
  **Immer von `tl.t1Base` aus rechnen, nie vom zuletzt verlängerten Wert.** Sonst wächst
  die Leinwand bei jeder Zoomänderung weiter, die Zeitskala wird absurd lang und die
  Stundenlinien im Hintergrund setzen aus.
- Kopffreiheit: `tlHeadClear()` misst die HÖCHSTE Kopf-Kachel; t0 wird vorab + per
  Nachkorrektur (auch in `tlSetZoom`) so erweitert, dass der früheste Balken und die
  Jetzt-Linie nie hinter den Kacheln verschwinden.
- **Spaltenpositionen NUR über `colScrollLeft()` / `colIndexFor()` rechnen.** Spalte i
  liegt bei `AXIS_W + GAP + i·Schritt`; wer die Scrollposition als `i·Schritt` ansetzt,
  rastet GAP-Pixel zu weit links ein, und die Kante der vorherigen Spalte schimmert
  unter dem ausblendenden Rand der Zeitachse durch. Es gibt ZWEI Einrast-Stellen —
  `releaseGlide()` (Touch) und `tlAlign()` (Maus/Trackpad); der Fehler steckte in beiden.
  Die Achse ist deshalb zusätzlich fast durchgehend deckend (Verlauf erst ab 94 %).
- **Zoom und Position bewegen sich GEMEINSAM** (`tlGlideTo`), nicht nacheinander.
  Vorher setzte der Spaltenwechsel erst den Zoom (`tlSetZoom` → Neuaufbau, sichtbarer
  Sprung) und scrollte danach sanft — zwei Bewegungen, die gegeneinander liefen.
  Jetzt eine `requestAnimationFrame`-Schleife: Maßstab interpoliert, Position folgt in
  **Zeit-Koordinaten** statt in Pixeln (sonst zieht der wachsende Maßstab das Ziel unter
  der Bewegung weg). Pro Bild ein voller Neuaufbau — gemessen 1,8 ms bei 10 und 5,6 ms
  bei 40 Spalten, passt in 16 ms. Greift der Nutzer die Ansicht an (`tl.pointers.size`),
  bricht die Bewegung sofort ab. `tlSetZoom` bleibt für den Pinch.
- **`tlAlignTopFor(idx, sc, ppm)` rechnet über den INDEX und die Fahrtdaten**, nicht über
  einen fertigen Balken. Nur so lässt sich das Ziel für eine Zoomstufe ausrechnen, die
  noch gar nicht gebaut ist. Vorher wurde dafür kurz auf die Zielstufe gebaut und wieder
  zurück — zwei vollständige Neuaufbauten unmittelbar VOR der Bewegung. Jetzt null.
- **Datumskachel in der Ecke oben links** (`.tl-date` in `.tl-datewrap`, gesetzt von
  `tlUpdateDate`). Dort überlagern sich Zeitachse und Kopf-Kacheln, und es stand nur ein
  Stück Skala, das nichts aussagt. Ohne Datum ist bei einer über Mitternacht laufenden
  Ansicht schwer zu sehen, für welchen Tag die Zeiten gelten.
  **Angezeigt wird der Tag der LINKESTEN sichtbaren Spalte** — damit springt das Datum
  genau dann, wenn keine Verbindung des alten Tages mehr zu sehen ist. Das passt zur
  Leserichtung: Das Datum steht links, neue Zeiten kommen von rechts herein.
  Drei Punkte, ohne die es nicht funktioniert:
  1. Die Kachel muss das **erste Kind der Achse im Fluss** sein — nur dann liegt ihre
     Ausgangslage oben und `sticky` hält sie dort. Die Zeitmarken sind absolut gesetzt und
     stören das nicht. Die Achse klebt waagerecht, die Kachel senkrecht: zusammen Ecke.
  2. **Der deckende Rahmen ist Pflicht**, nicht Zierde: Ohne ihn lugt die Zeitmarke, die
     zufällig ganz oben liegt, über der Kachel hervor und reiht sich in die Skala ein —
     als stünde das Datum zwischen zwei Uhrzeiten.
  3. **Tagesschlüssel in Europe/Berlin bilden**, nicht über `toDateString()`. Das nähme
     die Zeitzone des Geräts, und für jemanden im Ausland kippte das Datum woanders.
- **Zeitlinien sind einzelne Elemente** (`.tl-hline`), keine gekachelten Verläufe. Eine
  Kachelung mit gebrochener Höhe (60 min × 4,37 px/min = 262,2 px) sammelt über die
  Leinwand Rundungsfehler an: Linien wandern gegenüber der echten Uhrzeit und einzelne
  fallen beim Zeichnen ganz weg („manche volle Stunden haben eine Linie, manche nicht“).
  Einzeln gesetzt: Abweichung 1,4 s, Abstände exakt gleich, und die Aufbaukosten bleiben
  unverändert (1,65 / 3,00 / 5,40 ms bei 10 / 20 / 40 Spalten).
  Die Anzahl begrenzt sich selbst, weil der Abstand nie unter 44 px fällt.
- **`tl.tickStepFest` friert das Linienraster während einer Bewegung ein.** Sonst kippt
  `tlTickStep` beim Durchlaufen der Zoomstufen mehrfach um und die Linien ordnen sich
  mitten in der Bewegung neu.
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
  **nächtlicher** Wartezeit ≤ `settings.nightWait` (Gesamtdauer bewusst kein Kriterium)
  **und Ankunft vor `nextServiceEnd()`** (= `settings.lastArrival`, einstellbar).
  **Nur Wartezeiten im Nachtfenster zählen** (`waitTouchesNight`), am Stück an EINEM
  Halt, nicht summiert: Eine Stunde Aufenthalt um 15 Uhr ist harmlos, um 3 Uhr nicht.
  Die alte Regel galt rund um die Uhr und verwarf dadurch echte letzte Verbindungen —
  Regensburg→Neustrelitz lieferte 16:53 statt der tatsächlich letzten um 17:48, weil
  deren 49-min-Wartezeit nur zu 24 min in die Nacht fällt.
  `waitTouchesNight` prüft NICHT nur Anfang und Ende der Wartezeit: Wer um 20 Uhr
  ankommt und um 8 Uhr weiterfährt, wartet die ganze Nacht, obwohl beide Enden
  außerhalb liegen. Diese Schranke ist nötig, seit für den Kontext auch
  Verbindungen NACH der letzten geladen werden — ohne sie wanderte der Fokus einfach
  mit und beantwortete eine andere Frage.
- Bei „Letzte“ werden bewusst 4 Verbindungen NACH dem Fokus nachgeladen, damit die
  gesuchte Verbindung in der zweiten Spalte steht und rechts Nachbarn hat, statt am
  Rand zu kleben. Markiert wird sie gestrichelt an Kachel UND Balken (`.tl-focus`).
- Dominierte Verbindungen (später los wäre besser) ausgegraut, Label weiß.
- **TESTFUNKTION `settings.fitBottom`** („Freie Fläche unten nutzen“, ⚙ → Ansicht,
  standardmäßig AUS). Nachbearbeitung von `tlAutoZoom` (`tlFitBottom`): Enden ALLE
  sichtbaren Verbindungen über 90 % der Höhe, wird der Maßstab so weit aufgezogen, dass
  die tiefste Ankunft bei 85 % liegt. Die bestehende Zoom-Routine bleibt unangetastet —
  es wird nur ihr Rückgabewert nachbehandelt, und zwar nur nach oben.
  1. **Geprüft wird das MAXIMUM über alle sichtbaren Spalten**, nicht die hinterste
     allein. Reicht auch nur eine tiefer als 90 % oder ganz aus dem Bild, bleibt der Wert
     unverändert — über die hinterste allein zu urteilen hieße, den Rest abzuschneiden.
  2. **Die Ankerzeit direkt über `tlAnchorMs` holen, nicht aus der Pixel-Lage
     zurückrechnen.** Beim Aufbau steht über der ersten Abfahrt oft weniger Platz als die
     Kachel hoch ist, `tlAlignTopFor` klemmt dann auf 0 — aus einer geklemmten Zahl lässt
     sich die Zeit nicht mehr gewinnen, und die Funktion lief immer ins Leere.
     `tlAnchorMs` ist dafür aus `tlAlignTopFor` herausgezogen; die Regel ist unverändert,
     es gibt weiterhin nur EINE Entscheidung darüber, wo angedockt wird.
  3. **Ziel 85 %, Auslösegrenze 90 %.** Nach dem Zoom baut die Ansicht neu auf, dabei
     wird die Kachelhöhe erst wirklich gemessen und die Kopffreiheit nachkorrigiert —
     das schiebt die Balken noch ein Stück nach unten. Mit 90 % als Ziel landete die
     unterste Ankunft gemessen bei 95 %, also im unteren Zehntel, das frei bleiben soll.
     Mit 85 % liegt sie bei 90 %.
  Gemessen Nürnberg → Bayreuth, 3 Spalten, Höhe 40 %: ppm 2,74 → 3,38, tiefste Ankunft
  76 % → 90 %. Ist `ppm` schon am Deckel (`TL.MAX_PPM`), passiert nichts — dort ist kein
  Spielraum mehr.
- **Selbst gezoomt schlägt automatisch** (`tl.manualZoom`, gesetzt in `tlSetZoom`, also
  bei Pinch und Strg+Rad). Ein Spaltenwechsel überschreibt den Maßstab dann NICHT mehr;
  die Y-Ausrichtung läuft davon unabhängig weiter. Zurück auf automatisch nur bei einer
  neuen FRAGE: neue Suche oder Zeitwahl (`!sameSearch`) sowie ein-/ausgeblendete
  Verkehrsmittel und die Einstellung „Höhe der vordersten Verbindung“ — beide setzen
  dafür `tl.forceAutoZoom`. Blättern innerhalb derselben Suche zählt ausdrücklich nicht.
- **Die Fokusspalte bestimmt den Zoom.** `startIdx` MUSS bei „Letzte“/Datumsauswahl
  auf die fokussierte Verbindung zeigen, sonst zoomt `tlAutoZoom` auf die erste
  geladene, während der Blick auf der letzten liegt — man scrollt seitwärts hin und
  sieht ins Leere. Vertikal immer `tlAlignTopFor`, nie eine eigene Rechnung.
  Die Fokusverbindung steht in der **zweiten** Spalte (eine Spalte Kontext davor).
  **`tl.lastZoomIdx` muss dabei die LINKESTE Spalte sein, nicht die markierte** —
  `tlAlign` rechnet den Index aus der Scrollposition; bei Abweichung zoomt es 120 ms
  später neu und richtet sich an der Kontextspalte aus (Markierung blitzt auf, Ansicht
  springt weg). Zusätzlich sperrt `tl.autoScrolling` das Einrasten kurz, weil schon das
  Setzen der Scrollposition ein `scroll`-Ereignis auslöst.
- **Die Markierung hängt an `tl.focusKey`, nicht am Fokus-Zweig.** Sie wird nach JEDEM
  Aufbau gesetzt; sonst ist sie beim ersten Nachladen weg (dann gilt `keepScroll`).
- **Kontext-Vorladen (`loadContext`) läuft NACH der Umkreis-Rückfallebene.** Stand es
  davor, hing es an `app.itins.length` — bei Strecken, die erst über den Umkreis etwas
  finden (Erlenstegen → Vorra: Direktsuche liefert 0), war der Pool zu dem Zeitpunkt
  leer und das Nachladen wurde stillschweigend übersprungen. Ergebnis: Die gesuchte
  letzte Verbindung klebte ohne Nachbarn am rechten Rand.
- Nach hinten wird **in EINER Runde** geladen, bemessen auf `settings.cols − 1`
  Verbindungen hinter dem Fokus. Vorher bis zu drei Runden — jede kostet eine volle
  Umlaufzeit (gemessen ~225 ms, bei schlechter Verbindung deutlich mehr). „Letzte“
  braucht damit 3 statt bis zu 5 Runden.
- **Eine größere Erstanfrage hilft bei „Letzte“ NICHT** (nachgemessen): Eine
  Ankunftssuche liefert bei höherem `numItineraries` weitere FRÜHERE Verbindungen,
  nicht spätere. Der Kontext dahinter muss so oder so nachgeladen werden.
- **Jede gewählte Uhrzeit hat EINE Verbindung als Antwort** — die wird angesteuert
  (zweite Spalte) und gestrichelt markiert. Welche das ist, hängt an der Richtung:
  `arrivalDeadline()` bei „an“ (späteste, die es noch schafft — „Letzte“ ist derselbe
  Fall mit Betriebsschluss als Grenze), `departureTarget()` bei „ab“ (erste ab dem
  gewählten Zeitpunkt). `hasFocus()` bündelt beides, `findFocusItin()` wählt aus.
  **„Jetzt“ hat bewusst KEINE Markierung**: Dort verschiebt sich die Antwort mit jeder
  Minute, eine eingefrorene Markierung zeigte bald auf einen abgefahrenen Zug — diese
  Aufgabe hat die Jetzt-Linie, und die läuft mit.
  Beide Richtungen hatten denselben Fehler, nur verschieden groß: Die Ansicht begann an
  der FRÜHESTEN geladenen Verbindung. Bei „Ankunft bis 12:00“ war das eine, die um 20:55
  des Vortages ankam (~15 h daneben); bei „Abfahrt ab 14:00“ eine um 13:05 — denn
  `loadContext` lädt zwei Verbindungen DAVOR als Kontext, und genau die standen dann
  vorne. Die Daten waren immer richtig, nur die Blickrichtung war falsch.
- **Der Fokus wird VOR dem Nachladen des Kontexts festgelegt** (`searchFocusKey` in
  `loadContext`). Danach zu bestimmen ist die Falle: Das Nachladen bringt spätere
  Verbindungen, die nächste Bestimmung nimmt eine davon, und dahinter ist wieder
  nichts — die Markierung rutscht zurück in die letzte Spalte. Inhaltlich ist das
  Einfrieren korrekt, weil die Ankunftssuche die spätesten Verbindungen VOR
  Betriebsschluss schon vollständig geliefert hat; was danach kommt, ist Kontext.
- **Die gesuchte Verbindung wird je Suche EINMAL bestimmt** (`app.focusKey`) und
  festgehalten. Vorher rechnete jeder Neuaufbau sie neu, und weil der Pool zwischendurch
  wächst, kam dabei mal eine andere heraus — die Markierung sprang, mal zweite, mal
  letzte Spalte. Neu bestimmt wird nur, wenn die gemerkte Verbindung nicht mehr sichtbar
  ist (ausgeblendetes Verkehrsmittel) oder bei einer neuen Suche.
- `nextServiceEnd()` rechnet **immer von JETZT** aus (nächstes Auftreten der
  eingestellten Uhrzeit). Mehrfaches Tippen auf „Letzte“ wandert also nicht in den
  nächsten Tag.

## Verbindungs-Detailansicht (`fillDetails` + `updateJourneyLine`)

**Kopfzeile** (`tripHeadHTML`): ab · Fahrt · an · Schließen, alles in EINER Zeile. Jede
der drei Angaben trägt bis zu ZWEI Zahlen — Sollzeit durchgestrichen und grau darüber,
gültige Zeit darunter in Farbe. Unterschieden wird also nicht über Beschriftungen,
sondern über dieselbe Darstellung wie in den Zeilen direkt darunter (`timeWithDelay`):
Wer eine Zeile gelesen hat, versteht alle. Ohne Verspätung steht nur EINE Zahl da — ein
„(planmäßig)“ dahinter wäre Lärm für den Normalfall. Übereinander statt nebeneinander,
weil in einer Zeile mit drei Angaben waagerecht kein Platz für sechs Zahlen ist.
- **Die Fahrzeit aus DENSELBEN zwei Zeitpunkten rechnen**, die daneben stehen, nicht aus
  `it.duration` — das zählt Fußwege davor und danach mit, dann widerspräche die mittlere
  Zahl den beiden äußeren. Verschiebt die Verspätung die Fahrzeit (Abfahrt +2, Ankunft
  +5), zeigt auch sie beide Werte.
- **Raster, nicht drei Blöcke nebeneinander:** drei Spalten (ab · Fahrt · an) mal drei
  Zeilen (Beschriftung · Sollzeit · gültige Zeit). Nur so fluchten die Zahlen über alle
  drei Spalten. Ein Strich in der mittleren Spalte spannt beide Wertzeilen und trifft
  mittig ausgerichtet genau deren Grenze — darüber die überholten Zahlen, darunter die
  gültigen —, endet in einer Pfeilspitze und hört vor den Zeiten auf.
- **Beide Wertzeilen brauchen eine MINDESTHÖHE** (`minmax(1.15em, auto)`). Ohne sie fällt
  bei durchweg pünktlichen Verbindungen eine Zeile auf null zusammen, und der Strich hat
  keine definierte Lage mehr — er läge dann mitten im Text.
- **Ohne Verspätung steht nur EINE Zahl** (`.th-v.solo`): Sie spannt beide Wertzeilen und
  sitzt mittig auf dem Strich, statt in die untere Zeile zu rutschen. Sonst stünden
  pünktliche Zeiten tiefer als verspätete daneben, und die Zeile wirkte schief. Gilt je
  Seite einzeln — Abfahrt verspätet und Ankunft pünktlich ist ein echter Fall.
- **Der Schließknopf steht NEBEN der Überschrift, nicht darin.** `<h2>` nimmt nur
  Phrasing-Inhalt; ein `<form method="dialog">` darin ist ungültiges HTML.

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

- **8 Kategorien fix**: fern, regio, sbahn, **ubahn**, **tram**, bus, sonstige
  (Fähre/Rufbus/Rest), fernbus. U-Bahn und Tram waren bis v1.9.2 EINE Kategorie
  (`utram`) — gespeicherte Einstellungen und alte Übertragungslinks tragen sie noch,
  ihr Wert wird auf beide neuen übernommen. Diese Migration nicht entfernen.
- Verkehrsmittel-Farben sind vom Nutzer vorgegeben und in **beiden Themen gleich** —
  sie sind eine Zuordnung, kein Kontrastmittel. Die Lesbarkeit macht die Schriftfarbe
  je Kategorie; alle acht Paarungen erreichen ≥4,5:1 (nachgerechnet, nicht geschätzt).
- Fahrzeugsymbole sind FLÄCHEN (`svgSolid`, `fill-rule="evenodd"`), aus den PNG-Vorlagen
  in `icons/` nachgezeichnet (`tools/trace-icons.mjs`). Sie zeichnen mit `currentColor`
  und nehmen die Schriftfarbe des Segments an — als PNG eingebunden verschwänden sie auf
  der hellen Fernzug-Farbe. „Sonstige“ hat bewusst KEIN Symbol (außer Fähre).
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
- Übertragungs-Link `#cfg=` = Base64-JSON `{v:2, slots, show, cols, fill, connect}`;
  v1 (nur Array) bleibt lesbar. **Alles Personalisierte muss hier hinein** — und in
  `applyConfig()`, der EINEN Stelle, die eine Konfiguration übernimmt (Adresszeile wie
  eingefügter Link). Getrennte Importwege hätten irgendwann unterschiedlich viel übernommen.
- Der Link zeigt auf `WEB_BASE`, wenn nativ: In der APK liegt die Seite unter localhost,
  ein daraus gebauter Link wäre anderswo wertlos. Die App braucht das Einfügefeld, weil
  sie keine Adresszeile hat — `cfgFromInput()` nimmt ganze URL, Anker, `cfg=…` oder den
  nackten Code, auch mit Umbrüchen (8 Eingabeformen geprüft).
- Der Übertragungsdialog muss sich auch OHNE belegte Kacheln öffnen lassen — auf einem
  frischen Gerät will man ihn zum Empfangen.

## Design-Tokens & Stil

- **Erweiterte Einstellungen sind eingeklappt** (`<details class="setgroup setfold">`,
  ohne JS): „Umsteigen“ und „Letzte Verbindung“ stellt man einmal ein. Gemessen ist der
  Dialog dadurch 1576 statt 2113 px hoch, ein Viertel kürzer. Das `h3` steckt dabei im
  `<summary>` — der Selektor `.setgroup > h3` trifft es NICHT mehr, `.setfold > summary >
  h3` muss danebenstehen, sonst steht dort eine große Serifen-Überschrift zwischen lauter
  kleinen Versalzeilen.
- **Rechtliches gehört zu Kontakt, nicht zu Hilfe:** „Daten & Datenschutz“ steht zwischen
  „Schreib mir“ und „Impressum“ unter **Kontakt & Rechtliches**; darüber steht
  **Übertragen & Hilfe**. Vorher hing der Datenschutz im Hilfe-Abschnitt und zwang dessen
  Überschrift zu „Übertragen, Hilfe & Rechtliches“.
- **Kopf der Ergebnisansicht (`.rhead`): eine Karte, drei Felder** — Start · Tauschen ·
  Ziel, darüber eine Akzentkante. Die Höhe folgt dem HÖHEREN der beiden Namen: kurze
  bleiben einzeilig (flache Karte), lange brechen auf zwei Zeilen und dann nicht weiter
  (`-webkit-line-clamp: 2`). Sie darf nicht beliebig wachsen — darunter liegt die
  Grafik, die per Flex nur bekommt, was übrig bleibt.
  **`flex: none` ist an `.rhead` und `.timechips` Pflicht:** In der Flex-Spalte der
  Ergebnisansicht werden sie sonst zusammengedrückt, und die zweite Namenszeile wird
  mittendrin abgeschnitten. Sah im Screenshot aus wie ein zu kleiner Zeilenumbruch.
- **Zwei Zurück-Knöpfe statt eines Titels.** Beide Stationsnamen führen zur
  Abfahrtstafel; dazwischen sitzt der Tauschknopf. Ein `<button>` IM `<button>` wäre
  ungültiges HTML, deshalb drei Geschwister im Grid statt einer Verschachtelung.
  Das `‹` steht am Label „START“, nicht am Namen — beim Abschneiden langer Namen ginge
  es sonst mit, und ohne dieses Zeichen findet niemand den Weg zurück.
- **`.timeseg .chip.active` muss NACH `.timeseg .chip` stehen.** Gleiche Spezifität, also
  gewinnt die spätere Regel: Stand die Aktiv-Regel davor, wurde der ausgewählte Knopf
  durchsichtig — weiße Schrift auf weißem Grund, „Jetzt“ war schlicht unsichtbar.
- **Eigene Beschriftungen sind auf 28 Zeichen begrenzt** (`maxlength` an `#labelinput`).
  Vorher gab es gar keine Grenze, und der Text bestimmt die Höhe der Kopfkarte. 28 lässt
  jeden echten Bahnhofsnamen zu — gemessen an 75 Namen: Median 14, 90 % unter 19,
  längster gefundener 23 („Bochum Ruhr-Universität“).
- **Dialog-Knöpfe SCHWEBEN unten** (`.dlgfoot`, `position: sticky; bottom: 0`), ohne
  Balken dahinter: Eine deckende Leiste verdeckt dauerhaft ein Stück Inhalt; ohne sie
  scrollt der Text sichtbar zwischen und hinter den Knöpfen durch. Die Knöpfe selbst
  sind deckend und werfen einen Schatten, sonst wären sie über Text nicht lesbar.
  **`pointer-events` an der Leiste AUS und an den Knöpfen wieder AN** — sonst fängt der
  durchsichtige Streifen zwischen ihnen jede Wischgeste ab, und der Dialog ließe sich am
  unteren Rand nicht mehr scrollen.
  **Gleiche Höhe braucht eine durchgehende Kette aus Prozenthöhen** (Rasterzelle → form →
  Knopf). `align-self: stretch` am `<form>` genügte NICHT: gemessen blieb es bei 44 px,
  während die Zeile 60 hoch war, und der Knopf darin konnte mit `height: 100%` folglich
  auch nur 44 werden. Erst `height: 100%` am form löst die Kette auf.
- **Dialog-Knöpfe kleben unten** (`.dlgfoot`, `position: sticky; bottom: 0`). Auf einem
  Telefon liegt die Daumenzone unten, und in einem langen Dialog (Einstellungen,
  Halteliste, Datenschutz) müsste man sonst erst ans Ende scrollen, nur um zu schließen.
  **`dialog:has(.dlgfoot) { padding-bottom: 0 }` ist Pflicht:** Der untere Innenabstand
  gehört zur SCROLLFLÄCHE — bleibt er stehen, klebt die Leiste 1,2 rem über dem Rand und
  der Inhalt scrollt sichtbar darunter durch. Die Leiste übernimmt den Abstand selbst.
  Der deckende Grund ist ebenfalls Pflicht, sonst liest sich der Text hindurch.
  **Extra Fußraum braucht es NICHT:** Die Leiste steht im Fluss ganz am Ende — ganz nach
  unten gescrollt sitzt sie an ihrer natürlichen Stelle und verdeckt nichts. Verdeckt
  wird nur unterwegs, und dorthin scrollt man ohnehin weiter.
- **Der DB-Knopf wandert im Dialog in die Fußleiste**, in der aufklappbaren Listenansicht
  bleibt er am Ende des Inhalts (`fillDetails(container, it, foot)`): Dort gibt es keine
  Fußleiste, an die er kleben könnte. Beim Öffnen der nächsten Verbindung muss der alte
  Knopf entfernt werden, sonst sammeln sie sich.
- **Dialoge sind Fenster, keine Vollbildseiten**: `max-height` mit `2 * max(inset-top,
  inset-bottom)` Abzug, innen `overflow-y: auto`. Sie liegen in der obersten Ebene und
  erben das `padding` des `body` NICHT; beim mittigen Zentrieren verteilt sich der freie
  Platz gleichmäßig, deshalb der doppelte Abzug. Ohne das schob sich der Dialogtext unter
  die Statusleisten-Symbole.
- **Startseite passt immer auf eine Seite** (`.fitgrid`): Bis 14 Kacheln ist
  `#view-grid` eine Flex-Spalte und das Raster teilt die Resthöhe auf
  (`grid-auto-rows: minmax(44px, 1fr)`). Ab 15 Kacheln bleibt die feste Kachelhöhe.
  **Am `body` muss `height: 100dvh` stehen, NICHT `min-height`** — `1fr` verteilt nur
  Platz, wenn die Höhe feststeht; mit `min-height` bemaßen sich die Reihen nach ihrem
  Inhalt und die letzte hing über (v1.13.0, gemessen: 15 px bei 393×740).
  **Kein `overflow: hidden` am `body`** (nimmt das Ziehen zum Aktualisieren mit);
  für sehr flache Bildschirme darf stattdessen das RASTER scrollen, nie die Seite.
- **Auch die Ergebnisansicht (Grafik) ist bildschirmfüllend und scrollt NICHT** —
  gescrollt wird nur INNERHALB der Balken. Die Grafik hat deshalb keine feste Höhe
  mehr, sondern bekommt per Flex, was nach Kopfzeile, Zeitleiste, Hinweiszeilen und
  Legende übrig bleibt (`body[data-view="results"][data-mode="graph"]`; `data-mode`
  setzt `renderResults`). Die alte feste Höhe (74dvh) ging nur auf, solange keine
  Hinweiszeile da war: Bei „Letzte“ kommt eine dazu, und die Seite wurde scrollbar,
  während „Jetzt“ und die Datumsauswahl fest standen (gemessen: 187 px Überlauf,
  Legende 155 px unter dem Rand).
- **Für bildschirmfüllende Ansichten `svh`, NIEMALS `dvh` oder `vh`.** `dvh` ist die
  aktuelle Höhe: Solange die Adressleiste eines mobilen Browsers ausgefahren ist, ist
  sie klein — der Browser lässt aber trotzdem genau um deren Höhe scrollen, weil das
  die Geste zum Einklappen ist. Genau dieses Stück ließ sich die Seite verschieben.
  `svh` ist die KLEINSTE Höhe; passt der Inhalt hinein, gibt es in keinem Zustand
  etwas zu scrollen. **In der APK fällt das nicht auf** (keine Adressleiste) — dieser
  Unterschied ist der Grund, warum ein Fehler nur im Browser auftreten kann.
- **Flex-Fallstricke, die diese App zweimal zerlegt haben:**
  Ein Flex-Element hat `min-width: auto` und kann deshalb NICHT schmaler werden als
  sein Inhalt — bei der Grafik sind das tausende Pixel, sie sprengte die Seite nach
  rechts. Der Rahmen der Grafik ist deshalb bewusst KEIN Flex-Container.
  Und `.view` hat `margin: 0 auto`; in einer Flex-Spalte schaltet ein automatischer
  Seitenrand das Dehnen ab, die Ansicht nimmt ihre INHALTSBREITE an. Deshalb braucht
  sie dort ausdrücklich `width: 100%`.
- **Layout nicht schätzen, messen: `node tools/layout.mjs`.** Lädt die echte Seite in
  Firefox und misst zwei Ansichten (Startseite und Ergebnis-Grafik) bei vier
  Bildschirmgrößen; die Ergebnisansicht bewusst im UNGÜNSTIGSTEN Fall, mit beiden
  Hinweiszeilen sichtbar. Gemessen wird `scrollHeight`/`scrollWidth` gegen `innerHeight`/`innerWidth` und die
  Unterkante des letzten sichtbaren BLOCKS. **Die Breite gehört dazu** — sie fehlte
  zuerst, und genau dadurch ging eine über den Rand ragende Grafik als „PASST“ durch — nicht dessen Inhalt, denn die Grafik ist
  ein eigenes Scrollfeld und ragt innen absichtlich darüber hinaus. Alle Kacheln in
  `layout-messung.png` müssen „PASST“ zeigen. Dieselbe Fehlerklasse ist inzwischen
  viermal ausgeliefert worden — ohne Messung geht es offensichtlich nicht.
- **Wer die Grafik leert, muss die Position VORHER sichern** (`tlAnchor()` →
  `tl.keepAnchor`). Ein geleertes Scrollfeld meldet `scrollLeft = 0`; der Anker wurde
  danach also von „ganz links“ genommen und die Ansicht sprang auf die erste Spalte.
  Genau das passierte beim Einblenden eines Verkehrsmittels: Der Legenden-Handler ruft
  `showSearching()` (leert `#timeline`), lädt nach und rendert neu. Gemessen sprang die
  linke Spalte von 04:57 auf 04:28. Betrifft alle Zeitmodi gleich.
- **Nach einer geänderten FRAGE bleibt X stehen und Y richtet sich neu aus.** Ist
  `tl.forceAutoZoom` gesetzt (Legende, „Höhe der vordersten Verbindung“), wird der Zoom
  neu bestimmt — dann ist die gemerkte Oberkanten-Zeit kein sinnvolles Ziel mehr, sie
  stammt aus einem anderen Maßstab. Also: Spalte über den Schlüssel halten,
  senkrecht `tlAlignTopFor`. Das Flag muss VOR dem Zoom-Block gemerkt werden, der es
  zurücksetzt.
- **Der Zoom richtet sich dabei nach der ANKERSPALTE, nicht nach `startIdx`.** Sonst
  zoomt er auf die Fokus- oder Jetzt-Spalte, die woanders steht: Die Ansicht bleibt
  seitlich stehen, wird aber für eine andere Verbindung skaliert — und das sieht aus wie
  ein Sprung, obwohl sich die Scrollposition gar nicht geändert hat.
- **Die Fokus-Markierung gehört in `tlBuild`, nicht in `renderTimeline`.** Jede
  Zoomänderung ruft `tlBuild` erneut auf und wirft alle Spalten weg — eine Ebene höher
  gesetzt, verschwand die Markierung beim ersten Scrollen von selbst.
- **Scrollen NICHT sperren.** `overscroll-behavior: none` am Dokument nimmt im Browser
  auch das Ziehen zum Aktualisieren mit — das wurde einmal versucht und war falsch.
  Soll unter einer Ansicht nichts mehr kommen, gehört der LEERRAUM weg, nicht das
  Scrollen: Auf der Startseite waren es 2rem Fußraum plus ein seit v1.8.0 leerer
  `<footer>`. `overscroll-behavior: contain` an der Grafik und an Dialogen ist etwas
  anderes und bleibt — es verhindert nur das Durchreichen an die Seite dahinter.
- **Systemzonen oben UND unten freihalten** (`env(safe-area-inset-*)` am `body`):
  Android zeichnet ab Version 15 randlos, die APK legte die Überschrift sonst unter die
  Statusleisten-Symbole. Im Browser und in der installierten PWA ist der Wert 0.
- Die Verbindungslinie zwischen den Balken-Segmenten hat einen EIGENEN Farbwert
  (`--tl-link`), nicht `--border`. Der ist auf ruhige Trennlinien ausgelegt und kam hier
  auf 1,4:1 gegen den Kartengrund — die Linie trägt aber Bedeutung („hier wird
  gewartet“) und gehört sichtbar: jetzt 11:1 dunkel, 5,4:1 hell.
- Dark-first. bg `#0a0e18`, card `#131928`, Akzent Amber `#f0a63a` (hell `#b97800`).
  Status semantisch: ok grün, warn orange, bad rot — nie als Deko missbrauchen.
- Formen: Kacheln 4 px (Farbbalken INNEN an der Oberkante, eingerückt), Karten/Chips 8 px,
  Segmente 3 px. Typo-Akzente versal-gesperrt (Seitentitel, BEARBEITEN, START-Flag).
- Verspätungs-Abzeichen zeigt IMMER die Zahl (`+0`, `+3`, …), auch ohne Echtzeitdaten.
  Ein Sonderzustand „Plan“ war ausdrücklich unerwünscht — die Datenlage steckt in der
  Textfarbe der Uhrzeit, nicht im Abzeichen.
- **Kopf-Kachel = SOLLZEIT, Balken = PROGNOSE.** In der Kachel steht das
  Verspätungs-Abzeichen direkt daneben, und „10:15 +5“ liest sich sonst wie eine
  Rechenaufgabe — man addiert im Kopf und landet fünf Minuten zu spät. Sollzeit plus
  Abzeichen ergibt zusammen die Prognose, und die steht ausgeschrieben oben am Balken.
  **Geändert wird dabei NUR der angezeigte Text**: `dep.departure` bleibt überall sonst
  maßgeblich — daran hängen Balkenlage (`top`), Zeitachse (`geoCol.ms0`), aria-label und
  das Einrasten. Wer dort die Variable tauscht statt der Anzeige, verschiebt die halbe
  Grafik gegen ihre eigene Zeitachse.
- **Der Balken beginnt an der SOLL-Abfahrt, nicht an der Prognose.** Verspätet sich die
  Verbindung, liegt zwischen beiden ein eigenes Stück (`.seg-late`) — die Zeit, in der
  man am Bahnsteig steht. Erst danach beginnt die Fahrt. Damit stimmen Kopf-Kachel,
  Balkenanfang und Zeitachse wieder überein: Steht in der Kachel 09:20, fängt der Balken
  auf Höhe 09:20 an. Am Übergang steht die Prognose in Rot (`.tl-real`).
  Drei Fallen, alle beim Bauen aufgelaufen:
  1. **NICHT die Ausfall-Streifen verwenden.** Schwarz-Rot heißt „fällt aus“, Gelb-Schräg
     „Ersatzverkehr“ — ein drittes Muster darf keinem ähneln, sonst sehen zwei
     verschiedene Aussagen gleich aus. Deshalb feine Rot-Schraffur auf deckendem Grund.
  2. **`tlAlignTopFor` MUSS denselben Balkenanfang rechnen** wie `tlColumn` — dafür gibt
     es `tlBarStartMs(legs, ppm)` als eine Wahrheit für beide. Ohne das dockt die Ansicht
     an der Prognose an und schiebt das Verspätungsstück hinter die Kopf-Kachel; bei
     +32 min war davon nichts mehr zu sehen. Fiel erst im Screenshot auf, nicht im Code.
  3. **Deckender Grund unter der Schraffur.** Der Balken zeichnet eine senkrechte
     Wartelinie über seine ganze Höhe; die schien mitten durch das Verspätungsstück und
     sah aus wie ein Zeichenfehler.
  Unterhalb von `TL.LATE_MIN_H` (16 px) wird das Stück NICHT gezeichnet — bei einer
  Minute Verspätung und weit herausgezoomter Ansicht wären es zwei Pixel mit zwei
  Uhrzeiten übereinander. Dann bleibt es beim Balken ab der Prognose, und die Abweichung
  ist zu klein, um aufzufallen. `tlRescale` muss Stück und Beschriftung mitziehen.
- **Verspätete Zeiten am Balken sind rot** (`.tl-dep.late` / `.tl-arr.late`), je Ende
  einzeln entschieden: Eine Verbindung, die mit +2 losfährt und pünktlich ankommt, ist
  oben rot und unten nicht. Grün für „bestätigt pünktlich“ gibt es hier bewusst nicht —
  die Zeiten am Balken sollen zurückhaltend bleiben, die Datenlage steht im Abzeichen.
- **Die LISTENANSICHT behält die Ist-Zeit neben dem Abzeichen.** Dort gibt es keinen
  Balken, der die Prognose trägt; auf die Sollzeit umgestellt stünde die tatsächliche
  Abfahrt nirgends mehr. Die beiden Ansichten dürfen hier auseinandergehen.
- An beiden Balkenenden steht die Uhrzeit (`.tl-dep` / `.tl-arr`), klein und ohne
  „ab“/„an“ — die Position sagt, was gemeint ist. **Beide mit 3 px Abstand zum Balken.**
  Oben wird dafür die UNTERkante gesetzt (`transform: translateY(-100%)`), nicht ein
  fester Versatz nach oben: Sonst hängt der Abstand an der Texthöhe und ist in den engen
  Spaltenstufen (`.narrow`, `.tiny`) wieder ein anderer. Gemessen war es vorher −1 px,
  die Abfahrtszeit berührte den Balken also. `TL.DEP_LBL` reserviert den Platz
  dafür; wer am Einrasten oder an der Kopffreiheit rechnet, muss ihn mit einrechnen,
  sonst verschwindet die Abfahrtszeit unter der Kopf-Kachel.
- Fahrdauern: <60 min „42 min“, sonst „1:40 h“ (`fmtDur`). Ist-Zeiten farbcodiert,
  Soll durchgestrichen gestapelt darüber (Spaltenbreite konstant halten!).
- Icons: aus `icons/icon_pendelpanda.png` generieren (magick). **Bei Icon-Wechsel
  Dateinamen ändern** (Launcher/Manifest-Caches); PWA friert Icon/theme_color bei
  Installation ein → Neuinstallation nötig. theme_color/background_color = bg-Farbe.

## DB-Integration

- **Der exakte Link braucht die HALTE DER VERBINDUNG, nicht die Kacheln.** Das war die
  Ursache dafür, dass Nahverkehr fast nie funktionierte und Fern-/Regionalverkehr immer:
  Beginnt eine Verbindung mit einem Fußweg zu einem anderen Halt — im Nahverkehr der
  Normalfall —, gehört die Abfahrtszeit gar nicht zur Startkachel. Die DB suchte dann ab
  „Arnulfsplatz“ eine Fahrt, die um 21:50 am **Bismarckplatz** losfährt, fand nichts und
  fiel auf den Suchlink zurück. Übergeben werden deshalb `T[0].from` und `T.at(-1).to`
  samt Koordinaten und `mode`. Der SUCHLINK daneben nennt weiterhin die Kacheln — danach
  hat der Nutzer gefragt.
- **DB-Halte über KOORDINATEN auflösen** (`reiseloesung/orte/nearby?lat=&long=&radius=`),
  nicht über den Namen. Die Namen passen im Nahverkehr grundsätzlich nicht zusammen: DB
  schreibt „Haltestelle, Ort“ („Rathaus, Vorra“), Transitous liefert oft nur „Rathaus“.
  Die alte Namenssuche mit `limit=1` nahm dann irgendeinen Treffer in Deutschland —
  gemessen landete „Vorra a.d. Pegnitz Rathaus“ auf „Rathaus, Lauf a.d. Pegnitz“, 20 km
  daneben. Unter mehreren Halten an derselben Stelle entscheidet die Produktgattung
  (`DB_PRODUCT`), sonst die Entfernung; die Namenssuche bleibt als Rückfall.
  **`nearby` ist merklich strenger begrenzt als die übrigen Endpunkte** — beim Ausmessen
  kam nach rund 40 Anfragen in Folge dauerhaft 429. Im Betrieb sind es zwei pro Klick,
  die Gesamtzahl bleibt bei vier.
- **Beim Vergleich der Zeiten ist EIN kleiner Versatz erlaubt** (`DB_SHIFT_MIN = 5`).
  Große Busbahnhöfe haben mehrere Steige, und die beiden Datenquellen führen denselben
  Halt an verschiedenen davon: Gemessen fährt Bus 7 in Regensburg laut Transitous um
  22:30 ab „Hauptbahnhof“, laut DB um 22:32 ab „HBF Süd/Arcaden“ — gleiche Linie, gleiche
  Ankunft 22:48, gleiche Fahrt. Die Toleranz greift nur mit Auflagen: gleiche Zahl an
  Abschnitten UND eines der beiden Enden muss exakt sitzen. Zwei verschiedene Fahrten,
  die am selben Halt zur selben Minute ankommen und deren Abfahrt keine fünf Minuten
  auseinanderliegt, gibt es praktisch nicht.
  **Nachgemessen an 18 echten Verbindungen: vorher 15, jetzt 18** — die drei Gewinne sind
  genau die Nahverkehrsfälle (zweimal Fußweg zum Nachbarhalt, einmal Steig-Versatz).
- **Zeiten im DB-Link immer in Europe/Berlin** (`localMinuteIso`), NIE in der Zeitzone
  des Geräts. Wer aus einer anderen Zeitzone plant, bekäme sonst die falsche Minute —
  die Suche landet daneben, der Worker findet die Verbindung überhaupt nicht.
- **Der `soid` im Suchlink ist eine HAFAS-Kennung — nur ein Name reicht NICHT.**
  Vorher stand dort `O=<Name>`, und Transitous nennt Nahverkehrshalte oft nackt
  („Klinikum“, „Rathaus“, „Marienplatz“). Ein Wort, das es deutschlandweit hundertfach
  gibt, findet die DB nicht: gemessen NULL Verbindungen. `dbPlaceId()` baut deshalb
  `A=1@O=<Name>@X=<lon×1e6>@Y=<lat×1e6>@U=80@` — die Koordinaten stecken in jeder Kachel,
  kosten keine Anfrage, und die DB nimmt eine selbst gebaute Kennung an. Die interne ID
  der DB ist im Browser nicht zu holen (CORS: die Ortssuche schickt kein
  `Access-Control-Allow-Origin`, nachgemessen).
  Zwei Namensregeln in `dbPlaceName()`, beide gemessen:
  1. **Ort anhängen, wenn er fehlt** („Klinikum“ → „Klinikum, Regensburg“) — geprüft wird
     auch das ERSTE Wort des Ortes, sonst wird aus „Frankfurt Hbf“ ein „Frankfurt Hbf,
     Frankfurt am Main“, das die DB nicht kennt.
  2. **„<Stadt> Hauptbahnhof“ → „<Stadt> Hbf“.** Transitous schreibt aus (9 von 12
     geprüften Großstädten), die DB kürzt ab; über die Kennung findet sie die lange Form
     nicht. Nur die Form OHNE Komma wird gekürzt — „Hauptbahnhof, Regensburg“ ist ein
     Bushalt und heißt bei der DB auch so.
  **`A=2` statt `A=1` wäre falsch**, obwohl es 8/8 findet: Mit `A=2` gilt der Punkt als
  ADRESSE, die DB sucht sich selbst einen Halt dazu und startet dann woanders — gemessen
  „Graß“ statt „Klinikum“ und „Mögeldorf“ statt „Erlenstegen“. Bei `A=1` entscheidet der
  Name, die Koordinaten grenzen nur ein. Nachgemessen an 12 Strecken: vorher 3, jetzt 11.
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
