# PendelPanda — Hilfe

Deine Pendelverbindung in zwei Taps, mit Echtzeit. Läuft im Browser und lässt sich
als App auf dem Startbildschirm installieren.
Live: https://schogugel.github.io/pendelpanda/

---

## Installieren

**Android (Chrome):** Seite öffnen → Menü (⋮) → „App installieren“ bzw. „Zum
Startbildschirm hinzufügen“.
**iPhone (Safari):** Seite öffnen → Teilen-Symbol → „Zum Home-Bildschirm“.

Danach startet PendelPanda mit eigenem Icon ohne Browser-Leiste. Die App-Hülle
funktioniert offline; Verbindungsdaten brauchen natürlich Netz.

> **Nach Updates:** Die App zeigt beim Start die gespeicherte Version und lädt die
> neue im Hintergrund. Wenn eine Änderung fehlt: **zweimal neu laden**. Ändert sich
> das App-Icon, muss die installierte App einmal entfernt und neu hinzugefügt werden —
> Android friert das Icon bei der Installation ein.

---

## Startseite: die Abfahrtstafel

Ein Raster aus Kacheln, jede steht für einen Bahnhof.

### Bahnhof speichern
Leere Kachel (⊕ „Halt speichern“) antippen → Namen eintippen → aus der Vorschlagsliste
wählen → optional eine **eigene Beschriftung** vergeben („Zuhause“, „Arbeit“) →
**Speichern**. Ohne Beschriftung steht der offizielle Bahnhofsname auf der Kachel.

### Verbindung suchen
- **Tippen:** erst Start antippen (Kachel wird markiert, „START“), dann Ziel.
  Nochmal auf den Start tippen hebt die Auswahl wieder auf.
- **Wischen:** Finger auf die Start-Kachel legen und eine Linie zur Ziel-Kachel
  ziehen — beim Loslassen startet die Suche.

### Kacheln bearbeiten
**✎ Bearbeiten** oben rechts:
- Kachel antippen → Beschriftung ändern oder **„Diesen Button löschen“**.
  Einen anderen Bahnhof legst du per Löschen + neu anlegen fest.
- Kachel **ziehen** → tauscht die Position mit der Zielkachel (auch mit leeren
  Feldern; Lücken bleiben erhalten).
- Abkürzung ohne Bearbeiten-Modus: Kachel **lange gedrückt halten**.

### Buttons auf ein anderes Gerät übertragen
**„Buttons übertragen“** unten erzeugt einen Link, der deine komplette Konfiguration
enthält — Kacheln, Reihenfolge, Beschriftungen und alle Einstellungen. Link kopieren
oder teilen, auf dem anderen Gerät öffnen, Frage bestätigen. Es ist kein Server
beteiligt: Die Daten stecken im Link selbst.

---

## Ergebnisse: die grafische Fahrplan-Ansicht

Jede Verbindung ist eine Spalte: ein Balken von der Abfahrt (oben) bis zur Ankunft
(unten), farbig unterteilt nach Verkehrsmittel. Weil spätere Verbindungen weiter unten
beginnen, entsteht die typische Treppe nach rechts unten.

- **Oben in jeder Spalte** die Kachel mit Abfahrtszeit, Verspätung, Fahrtdauer und
  Umstiegen. Sie bleibt beim Scrollen sichtbar.
- **Rote Linie** = jetzt. Beim Öffnen dockt die Ansicht so an, dass die Linie knapp
  unter den Kacheln steht und die nächste erreichbare Verbindung darunter beginnt.
- **Bewegen:** in alle Richtungen wischen, auch diagonal. Am Rand wird automatisch
  nachgeladen — meist schon vorher im Hintergrund, sodass man nichts davon merkt.
- **Zoom:** zwei Finger (bzw. Strg + Mausrad). Die oben angedockte Verbindung bleibt
  stehen, die Skala dehnt sich nach unten. Ein Grund-Zoom stellt sich automatisch so
  ein, dass die vorderste Verbindung gut ins Bild passt.
- **Antippen** eines Balkens öffnet die Details.
- **☰ / ▦** oben rechts wechselt zwischen Grafik und Liste.

### Zeitpunkt wählen
- **Jetzt** — Standard, ab der aktuellen Uhrzeit (die zuletzt verpassten Verbindungen
  stehen links daneben).
- **Letzte** — springt zur letzten Verbindung der Nacht, bei der man unterwegs nicht
  strandet (markiert, mit den Verbindungen davor und dem ersten Morgenzug daneben).
- **📅** — Datum und Uhrzeit frei wählen, wahlweise „Abfahrt ab“ oder „Ankunft bis“.
- **⇄** neben der Route tauscht Start und Ziel.

### Farben und Filter (die Legende)
Unter der Grafik stehen alle Verkehrsmittel-Kategorien. Jeder Eintrag ist ein Schalter:

| Aussehen | Bedeutung |
|---|---|
| farbiger Punkt | wird angezeigt |
| hohler Punkt | vorhanden, aber ausgeblendet → antippen blendet ein |
| ausgegraut, durchgestrichen | im geladenen Zeitraum gibt es das nicht |

Was standardmäßig angezeigt wird, legst du in den Einstellungen fest (Voreinstellung:
Deutschlandticket-Sicht ohne Fernzug und Fernbus). Ausblenden entfernt immer die
**ganze** Verbindung, nicht nur ein Teilstück. Die Auswahl bleibt erhalten, während du
Zeitpunkt oder Richtung änderst; erst eine neue Verbindung von der Startseite setzt
sie zurück.

### Was die Balken zeigen
- **Verspätung:** Soll-Zeit klein durchgestrichen, Ist-Zeit farbig (grün pünktlich,
  orange bis 5 min, rot darüber).
- **Ausfall:** betroffenes Teilstück schwarz-rot gestreift mit weißer Beschriftung,
  „Fällt aus“ in der Kopfzeile. Fahrende Abschnitte derselben Verbindung bleiben normal
  — so siehst du, wie weit du trotzdem kommst.
- **⚠ (orange):** Meldung am Umsteigehalt (oft Steig- oder Haltestellenänderung). Der
  Anschluss fährt meistens trotzdem — vor Ort prüfen.
- **Schienenersatzverkehr:** gelb schraffierter Abschnitt in Busfarbe – die Linie fährt
  als Bus ab einer Ersatzhaltestelle. In den Details steht „Ersatzverkehr“, und über das
  📍 neben dem Abfahrtsort findest du die Haltestelle in Google Maps.
- **Ausgegraute Spalte:** fährt früher, kommt aber nicht früher an — die Nachbarspalte
  ist die bessere Wahl.

---

## Verbindungsdetails

Ein Tipp auf einen Balken (oder eine Listenkarte) zeigt die Verbindung im Detail:
farbiger Linien-Chip mit Fahrtnummer, Fahrtziel, Abfahrts- und Ankunftszeiten mit
Gleis auf einer durchgehenden Linie.

- **„Zwischenhalte & Infos“** klappt die vollständige Haltefolge auf — mit Echtzeit,
  Gleis, entfallenden Halten sowie Angaben zu Barrierefreiheit und Fahrradmitnahme,
  soweit gemeldet. Läuft die Fahrt gerade, zeigt eine grüne Linie mit Punkt, wo sich
  der Zug befindet; passierte Halte sind gedimmt.
- **📍 neben einem Halt** öffnet dessen genaue Lage in Google Maps – praktisch bei
  Ersatzhaltestellen und unbekannten Umsteigepunkten.
- **„Bei der DB öffnen“** führt zur Deutschen Bahn — für Wagenreihung, Auslastung und
  Tickets.

---

## Einstellungen (⚙)

Ganz unten im Dialog steht die **Versionsnummer** – damit lässt sich prüfen, ob das
Gerät den aktuellen Stand hat (nach einem Update ggf. zweimal neu laden).

- **Verkehrsmittel:** was standardmäßig angezeigt wird (Fernzug, Regionalzug, S-Bahn,
  U-Bahn/Tram, Bus, Sonstige = Fähre/Rufbus, Fernbus).
- **Mehr als 14 Kacheln:** Standard sind 14 Kacheln, die ohne Scrollen auf den Schirm
  passen. Wer mehr braucht, schaltet hier frei (gerade Anzahl bis 40) und wählt, wie
  verbunden wird:
  - **Hybrid** — Wischen verbindet wie gewohnt; sobald ein Start gewählt ist, scrollt
    Wischen frei und das Ziel wird angetippt.
  - **Nur Tippen** — Verbinden ausschließlich per Antippen, Wischen scrollt immer.
- **Grafik: Verbindungen nebeneinander** — 3, 4 oder 5 Spalten.

Alle Einstellungen wandern über „Buttons übertragen“ mit.

---

## Wenn etwas nicht stimmt

**Änderung fehlt / alte Ansicht** → zweimal neu laden; installierte App einmal
schließen und neu öffnen.
**Altes App-Icon** → installierte App entfernen, Seite öffnen, neu zum Startbildschirm
hinzufügen.
**Keine Verbindungen** → Legende prüfen (alles ausgeblendet?), Internet prüfen; bei sehr
seltenen Strecken hilft „Frühere/Spätere“ bzw. weiter wischen. Findet die App am Halt
selbst nichts, sucht sie automatisch im **Umkreis** weiter — so tauchen
Schienenersatzverkehr und verlegte Haltestellen auf (erkennbar am Hinweisbanner über
den Ergebnissen; der Fußweg steht in den Details). Bleibt es leer, nennt die App den
Grund — etwa wenn für einen Halt erst ab einem späteren Datum Fahrplandaten vorliegen.
**Verspätungen wirken alt** → Ansicht neu laden; Echtzeitdaten hängen am jeweiligen
Verkehrsunternehmen und fehlen manchmal ganz.
**Gespeicherte Kacheln weg** → sie liegen im Browser-Speicher dieser Seite; Löschen der
Website-Daten entfernt sie. Vorbeugen: Übertragungs-Link aufheben.

---

## Datenquellen

Fahrplan und Echtzeit: [Transitous](https://transitous.org) (offene DELFI/GTFS-Daten).
Weiterleitungen zur Buchung: bahn.de. PendelPanda speichert nichts auf fremden Servern —
Kacheln und Einstellungen bleiben auf deinem Gerät.
