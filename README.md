# PendelPanda (PWA)

Neuauflage von pendelpanda.de: Deine Pendelverbindung in 2 Taps – mit Echtzeit-Verspätungen, Gleis und DB-Link.

- Statische PWA ohne Backend: HTML + CSS + Vanilla-JS, kein Build-Schritt.
- Daten: [Transitous](https://transitous.org) (MOTIS 2, DELFI/GTFS inkl. Echtzeit), direkt vom Gerät abgefragt.
- Buttons liegen im `localStorage`; Übertragung auf andere Geräte per Konfigurations-Link („Buttons übertragen“).
- „Bei der DB öffnen“ verlinkt die Verbindung auf bahn.de (Wagenreihung, Tickets).

**Weiterführend:** [HILFE.md](HILFE.md) — Bedienung für Nutzer ·
[CLAUDE.md](CLAUDE.md) — Architektur-Invarianten, API-Gotchas und Style Guide für die
Weiterentwicklung.

## Lokal testen

```bash
cd app
python3 -m http.server 8080
# http://localhost:8080 im Browser öffnen
```

## Veröffentlichen (GitHub Pages)

1. Neues GitHub-Repo anlegen (z. B. `pendelpanda`), Inhalt des `app/`-Ordners committen und pushen.
2. Repo → Settings → Pages → Source: „Deploy from a branch“, Branch `main`, Ordner `/ (root)`.
3. Nach ~1 Minute läuft die App unter `https://<username>.github.io/pendelpanda/`.
4. Diesen Link teilen – auf dem Handy öffnen und „Zum Startbildschirm hinzufügen“ / „App installieren“.

## Bedienung

- Tap auf „+“: Bahnhof suchen (Live-Suche) und auf dem Button speichern.
- „✎ Bearbeiten“ (oder Long-Press auf einen Button): Station ändern oder Button leeren;
  im Bearbeiten-Modus tauscht Ziehen die Position zweier Kacheln. Kachel-Anzahl in ⚙
  einstellbar (4–24; Verkleinern kann belegte Kacheln nie löschen). Reihenfolge und
  Lücken sind Teil der Slot-Liste und wandern damit im Übertragungs-Link mit.
- Tap Start-Button, dann Tap Ziel-Button: Verbindungen ab jetzt.
- **Zeitleiste:** „Jetzt“ (Default) · in der Grafik lädt Scrollen an den linken/rechten Rand
  automatisch frühere/spätere Verbindungen nach (ein Batch = eine API-Anfrage; in der Liste
  per Knopf) · „Letzte“ fokussiert die letzte „anständige“ Verbindung der Nacht ·
  📅 öffnet die Datum/Uhrzeit-Wahl mit Abfahrt-/Ankunft-Umschalter.
- **„Letzte anständige Verbindung“-Regel:** Die Nachtflaute wird ohne feste Uhrzeit erkannt
  (letzter Abfahrts-Abstand ≥ max(90 min, 2,5 × Median-Takt der geladenen Verbindungen));
  „anständig“ heißt: längste Umstiegs-Wartezeit ≤ 45 min (Gesamtdauer ist kein Kriterium,
  durchfahrende Nachtzüge zählen als anständig). Es wird nichts gefiltert – die Verbindung
  wird nur fokussiert und markiert, mit Kontext davor/danach.
- **Legende = Filter:** Legendeneinträge unter den Ergebnissen sind antippbar; ausgegraut =
  Verbindungen, die dieses Verkehrsmittel enthalten, sind ausgeblendet. Die Standardauswahl
  kommt aus den Einstellungen (⚙, Default: Deutschlandticket-Sicht ohne Fernverkehr).
- **Grafikansicht** (Standard): vertikale Zeitachse, jede Verbindung ein Balken von Abfahrt
  bis Ankunft, farbige Segmente je Verkehrsmittel, „jetzt“-Linie. Scrollen in alle Richtungen —
  landet man im Leeren, zieht die Ansicht automatisch zum nächsten Balken. Zoom per Pinch,
  Strg+Mausrad zur Feinjustierung – der Grund-Zoom stellt sich automatisch ein. Balken antippen öffnet die Details. ☰/▦ wechselt zur Listenansicht.
- ⇄ tauscht die Richtung, „Spätere Verbindungen“ blättert weiter.
- „Buttons übertragen“: Link kopieren/teilen, auf dem anderen Gerät öffnen und
  „Buttons übernehmen?“ bestätigen.

## Architektur & Personalisierung

- **Kein Backend.** Alles läuft im Browser; die einzige externe Abhängigkeit ist die
  Transitous-API (`/geocode` für die Stationssuche, `/plan` fürs Routing inkl. Echtzeit).
- **Suche ungefiltert, Filter clientseitig.** `/plan` wird ohne Verkehrsmittel-Filter
  abgefragt; die Legende blendet ganze Verbindungen aus, deren Abschnitte eine deaktivierte
  Kategorie enthalten (fern/regio/sbahn/utram/bus, Mapping in `timeline.js: productClass`).
  So lässt sich Ausgeblendetes ohne neue Anfrage wieder einblenden. Bleiben nach dem Filtern
  <5 Verbindungen, lädt die App automatisch weitere Seiten nach.
- **Blättern über API-Cursor.** „Frühere“/„Spätere“ nutzen `previousPageCursor`/
  `nextPageCursor` der MOTIS-API (verbindungsweise, nicht zeitfensterbasiert).
- **Personalisierung lebt in `localStorage` und reist per URL.** Gespeichert werden
  `pp.buttons.v1` (Bahnhofs-Buttons), `pp.settings` (Standard-Verkehrsmittel) und `pp.view`
  (Listen-/Grafikansicht). „Buttons übertragen“ kodiert Buttons **und** Einstellungen als
  Base64-JSON in den Link: `#cfg=` → `{v: 2, slots: […], show: {fern: false, …}}`.
  Beim Öffnen eines solchen Links fragt die App, ob die Konfiguration übernommen werden
  soll. Alte v1-Links (nur Button-Array) werden weiterhin verstanden.

## „Bei der DB öffnen“ mit exakter Verbindung (optional, empfohlen)

Ohne weitere Einrichtung öffnet der DB-Button eine vorbefüllte bahn.de-Suche zur exakten
Abfahrtszeit (die gewünschte Verbindung steht oben). Für den **echten Verbindungs-Link**
(vbid) – der exakt die eine Verbindung zeigt und auf dem Handy den **DB Navigator** mit
„Zu meinen Reisen hinzufügen“ öffnet – braucht es einen Mini-Proxy, weil die DB-Endpunkte
Browser-Anfragen per CORS blocken:

1. Kostenloses Konto bei [Cloudflare Workers](https://workers.cloudflare.com) anlegen.
2. Im Dashboard einen neuen Worker erstellen und den Inhalt von
   `db-link-worker/worker.js` einfügen (oder per `wrangler deploy`).
3. Die Worker-URL (z. B. `https://pendelpanda-db.<name>.workers.dev`) in `app.js`
   bei `DB_LINK_PROXY` eintragen und neu deployen.

Der Worker wird nur beim Klick auf den DB-Button aufgerufen (ein Ablauf pro Klick,
Rate Limits daher unkritisch). Findet er die Verbindung nicht, leitet er automatisch
auf die vorbefüllte Suche um.

## Hinweise

- Die Transitous-[Usage Policy](https://transitous.org/api/) gilt: fairer Umfang, App-Name im Blick behalten; für größere Verbreitung ggf. eigene MOTIS-Instanz.
- Der DB-Deep-Link nutzt Stationsnamen (`so`/`zo`/`soid=O=…`); bei exotischen Stationsnamen kann bahn.de nachfragen. Präziser würde es mit EVA-Nummern (`L=…`) – möglicher Ausbau.
