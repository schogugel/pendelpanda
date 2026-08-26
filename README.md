# PendelPanda (PWA)

Neuauflage von pendelpanda.de: Deine Pendelverbindung in 2 Taps – mit Echtzeit-Verspätungen, Gleis und DB-Link.

- Statische PWA ohne Backend: HTML + CSS + Vanilla-JS, kein Build-Schritt.
- Daten: [Transitous](https://transitous.org) (MOTIS 2, DELFI/GTFS inkl. Echtzeit), direkt vom Gerät abgefragt.
- Buttons liegen im `localStorage`; Übertragung auf andere Geräte per Konfigurations-Link („Einstellungen übertragen“) — auch von der App in den Browser und zurück.
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
- „Einstellungen übertragen“: Link kopieren/teilen, auf dem anderen Gerät öffnen und
  „Buttons übernehmen?“ bestätigen.

## Architektur & Personalisierung

- **Kein Backend.** Alles läuft im Browser; die einzige externe Abhängigkeit ist die
  Transitous-API (`/geocode` für die Stationssuche, `/plan` fürs Routing inkl. Echtzeit).
- **Suche ungefiltert, Filter clientseitig.** `/plan` wird ohne Verkehrsmittel-Filter
  abgefragt; die Legende blendet ganze Verbindungen aus, deren Abschnitte eine deaktivierte
  Kategorie enthalten (fern/regio/sbahn/ubahn/tram/bus, Mapping in `timeline.js: productClass`).
  So lässt sich Ausgeblendetes ohne neue Anfrage wieder einblenden. Bleiben nach dem Filtern
  <5 Verbindungen, lädt die App automatisch weitere Seiten nach.
- **Blättern über API-Cursor.** „Frühere“/„Spätere“ nutzen `previousPageCursor`/
  `nextPageCursor` der MOTIS-API (verbindungsweise, nicht zeitfensterbasiert).
- **Personalisierung lebt in `localStorage` und reist per URL.** Gespeichert werden
  `pp.buttons.v1` (Bahnhofs-Buttons), `pp.settings` (alle Einstellungen) und `pp.view`
  (Listen-/Grafikansicht). „Einstellungen übertragen“ kodiert Buttons **und** Einstellungen
  als Base64-JSON in den Link: `#cfg=` → `{v: 2, slots: […], show: {…}, cols, fill,
  connect, lastArrival, nightFrom, nightTo, nightWait, xferLevel}`. Weil die App keine
  Adresszeile hat, gibt es dort zusätzlich ein Feld zum Einfügen desselben Links.
  Beim Öffnen eines solchen Links fragt die App, ob die Konfiguration übernommen werden
  soll. Alte v1-Links (nur Button-Array) werden weiterhin verstanden.

## „Bei der DB öffnen“

Der Knopf verhält sich in den beiden Auslieferungen unterschiedlich — ohne dass
irgendetwas einzurichten wäre:

- **Android-App:** öffnet **genau diese Verbindung**. Das Gerät holt sich dafür
  selbst einen Teilen-Link (`vbid`) bei der DB und übergibt ihn an den DB
  Navigator, wo die Fahrt unter „Zu meinen Reisen“ landet. Klappt das nicht
  (kein Netz, Endpunkt geändert, Verbindung nicht wiedergefunden), fällt es
  still auf die Suche zurück.
- **Web-Version:** öffnet eine **vorbefüllte bahn.de-Suche** zur exakten
  Soll-Abfahrtszeit; die gewünschte Verbindung steht damit oben in der Liste.

**Warum der Unterschied:** Für den exakten Link braucht es zwei Anfragen an
DB-Endpunkte, die keine CORS-Header senden — eine Webseite darf sie schlicht
nicht aufrufen, egal wo sie gehostet ist. Nativ gilt CORS nicht, deshalb kann
die App es und die Website nicht.

Ein früher hier beschriebener Cloudflare-Worker als Umweg ist seit v1.5.3
**entfallen**: Er hätte die Anfragen aller Nutzer über ein einzelnes Konto und
eine einzelne IP gebündelt. In der App stellt stattdessen jedes Gerät seine
eigene Anfrage — kein Server, kein Konto, nichts, was auf eine Person
zurückfällt. Der Worker steckt noch in der Git-Historie bis v1.5.2.

## Hinweise

- Die Transitous-[Usage Policy](https://transitous.org/api/) gilt: fairer Umfang, App-Name im Blick behalten; für größere Verbreitung ggf. eigene MOTIS-Instanz.
- Der DB-Deep-Link nutzt Stationsnamen (`so`/`zo`/`soid=O=…`); bei exotischen Stationsnamen kann bahn.de nachfragen. Präziser würde es mit EVA-Nummern (`L=…`) – möglicher Ausbau.
