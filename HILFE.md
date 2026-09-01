# PendelPanda — Hilfe

Deine Pendelverbindung in zwei Taps, mit Echtzeit. Läuft im Browser und lässt sich
als App auf dem Startbildschirm installieren.
Live: https://schogugel.github.io/pendelpanda/

---

## Web-App oder Android-App?

PendelPanda gibt es zweimal, mit demselben Inhalt. Die **Web-App** läuft überall —
Android, iPhone, Rechner — und ist nach einem Neuladen von selbst aktuell. Die
**Android-App** (APK) kann zusätzlich eines: Der Knopf „Bei der DB öffnen“ führt dort
auf *genau diese* Verbindung statt auf eine vorbefüllte Suche, und dafür steht kein
fremder Server dazwischen — dein Gerät fragt selbst bei der Bahn nach. Im ⚙-Dialog
steht hinter der Versionsnummer, was gerade läuft (`· Web` oder `· App`).

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
- Kachel antippen → Beschriftung ändern, **„Immer vollständig suchen“** setzen oder
  **„Diesen Button löschen“**. Einen anderen Bahnhof legst du per Löschen + neu
  anlegen fest.
- Kachel **ziehen** → tauscht die Position mit der Zielkachel (auch mit leeren
  Feldern; Lücken bleiben erhalten).
- Abkürzung ohne Bearbeiten-Modus: Kachel **lange gedrückt halten**.

### Einstellungen auf ein anderes Gerät übertragen
**⚙ → „Einstellungen übertragen“** hat zwei Hälften.

**Von hier weggeben:** Der Link enthält deine komplette Konfiguration — Kacheln,
Reihenfolge, Beschriftungen und alle Einstellungen. Kopieren oder teilen.

**Hierher übernehmen:** Den Link vom anderen Gerät in das Feld einfügen und
„Übernehmen“ antippen. Das ist der Weg **in die App hinein**, wo es keine Adresszeile
gibt, in die man einen Link tippen könnte. Es funktioniert in beide Richtungen: Web zu
App, App zu Web, Gerät zu Gerät.

Im Browser geht es weiterhin auch ohne das Feld — Link einfach öffnen und die Frage
bestätigen. Eingefügt werden darf großzügig: ganze Adresse, nur der Teil ab `#cfg=`
oder nur der Code; Zeilenumbrüche aus einem Messenger stören nicht.

Es ist kein Server beteiligt, die Daten stecken im Link selbst. Genau deshalb gilt
aber: Wer den Link hat, sieht deine Bahnhöfe.

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

### Wann ist die „letzte“ Verbindung?
Zwei Dinge entscheiden das, beide unter **⚙ → „Letzte Verbindung“**:

- **Ankunft spätestens** (Standard 04:00): Bis wann du da sein willst. Gesucht wird die
  späteste Verbindung, die das noch schafft.
- **Nachts höchstens warten** (Standard 45 Minuten zwischen 22:00 und 06:00): Wie lange
  du bereit bist, nachts an *einem* Halt zu stehen. Gemeint ist die Wartezeit am Stück,
  nicht die Summe über alle Umstiege — zweimal zwanzig Minuten sind kein Stranden.

Wartezeiten außerhalb des Nachtfensters zählen nicht mit. Eine Stunde Aufenthalt am
Nachmittag ist unangenehm, aber harmlos; um drei Uhr früh ist sie etwas anderes.

### Mehr Zeit zum Umsteigen
**⚙ → „Umsteigen“** hat vier Stufen: normal, etwas mehr, deutlich mehr, viel mehr —
für schweres Gepäck, Kinderwagen oder wenn Hetzen keine Option ist.

Gerechnet wird **anteilig** zur Wegzeit im jeweiligen Bahnhof, nicht als fester
Zuschlag. An einem großen Kopfbahnhof, wo der Weg zwischen den Gleisen ohnehin lang
ist, wirkt die Einstellung deshalb stärker als an einem Halt mit einem Bahnsteig — dort
wäre ein pauschaler Aufschlag verschenkte Zeit.

Es fallen dadurch keine Verbindungen weg: Der Fahrplanrechner sucht andere, die dir
Zeit lassen.

### Während gesucht wird
Ein laufender Balken und eine Zeile darunter zeigen, was gerade passiert — Verbindungen
suchen, Umgebung prüfen, letzte Verbindung eingrenzen. Solange er läuft, ist die Ansicht
leer: Lieber kurz nichts sehen als eine veraltete Verbindung aus der vorherigen Suche.

### Zurück zur Abfahrtstafel
Der Streckenname oben links ist ein Knopf — antippen bringt dich zurück zu den
Kacheln. Das kleine ‹ davor weist darauf hin. Die Zurück-Geste des Systems tut
dasselbe.

### Zeitpunkt wählen
Bei **„ab“** beginnt die Ansicht bei deiner Uhrzeit und geht vorwärts. Bei **„an“**
blickt sie ans andere Ende: Gezeigt wird die späteste Verbindung, die deine
Ankunftszeit noch schafft. In beiden Fällen ist die passende Verbindung gestrichelt
markiert und steht in der zweiten Spalte, damit du auch die Nachbarn siehst.
Bei **„Jetzt“** gibt es keine Markierung — dort sagt dir die rote Jetzt-Linie, was du
noch erreichst, und die wandert mit der Uhr weiter.

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

### Selbst zoomen
Zwei Finger (oder Strg + Mausrad) stellen den Maßstab von Hand ein. Ab dann bleibt er
beim Blättern erhalten — die Ansicht rastet weiterhin sauber auf die Spalten und richtet
sich oben aus, ändert aber die Zoomstufe nicht mehr von selbst. Auf automatisch
zurück geht es, sobald du etwas anderes fragst: Jetzt, Letzte, ein Datum oder ein
anderes Verkehrsmittel in der Legende.

### Was die Balken zeigen

Über und unter jedem Balken steht klein die Abfahrts- und die Ankunftszeit. Suchst du
die **letzte Verbindung**, ist die gefundene gestrichelt umrandet — an der Kachel oben
und am Balken. Sie steht in der zweiten Spalte, damit du siehst, was davor und was
danach noch fährt.

- **Drei Symbole, drei Bedeutungen.** Sie stehen an der Verbindung in der Übersicht und
  noch einmal an der betroffenen Zeile in der Detailansicht — dort sind sie aufklappbar
  und sagen im Klartext, worum es geht:
  - **Roter Kreis mit Strich** — nach der aktuellen Prognose ist der Anschluss nicht mehr
    zu schaffen.
  - **Orange Sanduhr** — noch zu schaffen, aber ohne Reserve. Erscheint nur, wenn eine
    Verspätung den Puffer aufgefressen hat; ein von vornherein knapp geplanter Umstieg
    ist normal und wird nicht markiert.
  - **Gelbes Dreieck** — es gibt eine Meldung: eine Störung, Bauarbeiten, ein defekter
    Aufzug, ein ausgelassener Halt. Wo der Verkehrsbetrieb einen Text veröffentlicht hat,
    steht dieser im Original darin.
  Ein **Gleiswechsel** taucht hier bewusst nicht auf — der steht direkt bei der
  Gleisangabe („Gl. 7 statt 3“), wo man beim Einsteigen hinschaut.
- **Zeitfarben zeigen die Datenlage:** **grau** = nur Sollfahrplan, es liegen (noch)
  keine Echtzeitdaten vor; **grün** = per Echtzeit bestätigt und pünktlich — aber nur, solange der Halt noch
  bevorsteht; ist er passiert, wird auch er grau; **rot** =
  Verspätung, daneben die durchgestrichene Sollzeit. Steht in der Spaltenkachel „Plan“
  statt „+0“, gibt es für diese Fahrt noch keine Live-Meldung — „+0“ hieße sonst
  fälschlich „bestätigt pünktlich“.
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
farbiger Linien-Chip mit Fahrtnummer, Fahrtziel sowie Abfahrts- und Ankunftszeit auf
einer durchgehenden Linie. **Gleis und Kartenlink** stehen als ein Feld hinter dem Halt
(„Gl. 8 📍“) – bei Ein- und Ausstieg, denn nur dort braucht man sie. Eine
Gleisänderung ist rot hervorgehoben; der Pin führt bahnsteiggenau in Google Maps.

- **„Zwischenhalte & Infos“** klappt die vollständige Haltefolge auf — mit Echtzeit,
  Gleis, entfallenden Halten sowie Angaben zu Barrierefreiheit und Fahrradmitnahme,
  soweit gemeldet. Läuft die Fahrt gerade, zeigt eine grüne Linie mit Punkt, wo sich
  der Zug befindet; passierte Halte sind gedimmt.
- **📍 im Gleis-Feld** öffnet die genaue Lage in Google Maps – praktisch bei
  Ersatzhaltestellen und unbekannten Umsteigepunkten. Bei Zwischenhalten ohne
  Ein-/Ausstieg wird bewusst kein Gleis angezeigt.
- **„Bei der DB öffnen“** führt zur Deutschen Bahn — für Wagenreihung, Auslastung und
  Tickets.

---

## Einstellungen (⚙)

Ganz unten im Dialog steht die **Versionsnummer** – damit lässt sich prüfen, ob das
Gerät den aktuellen Stand hat (nach einem Update ggf. zweimal neu laden).

Vier Abschnitte, in dieser Reihenfolge: erst was gesucht wird, dann wie es aussieht,
dann die Startseite, dann Wartung.

**Verbindungssuche**
- **Verkehrsmittel:** was standardmäßig angezeigt wird (Fernzug, Regionalzug, S-Bahn,
  U-Bahn, Tram, Bus, Sonstige = Fähre/Rufbus, Fernbus).
- **Umsteigen** und **„Letzte Verbindung“** sind eingeklappt — antippen öffnet sie. Das
  sind Sachen, die man einmal einstellt und danach lange nicht mehr anfasst.

**Balkenansicht**
- **Verbindungen nebeneinander** — 3 bis 7 Spalten (Standard 5).
- **Höhe der vordersten Verbindung** — wie viel der Bildhöhe sie einnimmt (Standard
  50 %). Kleiner heißt mehr Übersicht, größer heißt mehr Detail.
- **Freifläche unten nutzen** (Standard an) — enden alle sichtbaren Verbindungen weit
  über dem unteren Rand, wird stärker gezoomt, statt die Fläche leer zu lassen.

**Startseite**
- **Mehr als 14 Kacheln:** Standard sind 14 Kacheln, die ohne Scrollen auf den Schirm
  passen. Wer mehr braucht, schaltet hier frei (15 bis 40) und wählt, wie verbunden
  wird — denn Wischen erreicht nur, was gerade zu sehen ist:
  - **Hybrid** — Wischen verbindet wie gewohnt; sobald ein Start gewählt ist, scrollt
    Wischen frei und das Ziel wird angetippt. Gut, wenn die häufigen Halte oben liegen.
    Der Haken: Ist an einer Suche keine der oben sichtbaren Kacheln beteiligt, musst du
    erst irgendeine antippen, um scrollen zu dürfen.
  - **Nur Tippen** — Wischen scrollt immer, verbunden wird nur durch Antippen. Zwei
    Tipper für jede Strecke, dafür ohne Sonderfall.

**Update-Hinweis (nur Android-App)**
- Gibt es eine neuere APK, wird das **Zahnrad oben rechts orange** und in den
  Einstellungen steht ganz oben ein Hinweis mit Link zur Download-Seite. Die
  Web-Version braucht das nicht — sie lädt bei jedem Start die aktuelle Fassung,
  auch wenn sie auf dem Startbildschirm liegt.

**App installieren**
- **PendelPanda aufs Gerät** — erklärt die zwei Wege: die Android-APK (Link zu den
  GitHub-Releases) und „Zum Startbildschirm hinzufügen“, das auf jedem Gerät geht.
  Nur mit der APK öffnen die DB-Knöpfe die *genaue* Verbindung im DB Navigator; im
  Browser bleibt es bei einer vorbefüllten Suche. In der App führt dieselbe Zeile zu
  den Updates — sie holt sich neue Versionen nicht von selbst.

Ganz unten: **Übertragen & Hilfe**, darunter **Kontakt & Rechtliches** (Schreib mir,
Daten & Datenschutz, Impressum).

Alle Einstellungen wandern über „Buttons übertragen“ mit.

---

## Warum manchmal Verbindungen fehlten

Der Fahrplanrechner antwortet mit den *besten* Verbindungen, nicht mit allen: Eine
Verbindung fällt weg, sobald eine andere später losfährt und trotzdem früher ankommt.
In der Stadt gewinnt damit fast immer dasselbe Verkehrsmittel — zwischen München Hbf
und Ostbahnhof verdrängte die U-Bahn praktisch die ganze S-Bahn, obwohl die alle zwei
Minuten fährt.

Seit Version 1.30.0 merkt PendelPanda, wenn ein Verkehrsmittel das Ergebnis so
erdrückt, und fragt gezielt nach dem nach, was dahinter liegt. In dichten Städten
verdoppelt das die Zahl der angezeigten Verbindungen.

Der Knopf **⤓** über den Ergebnissen holt zusätzlich alles: eine eigene Anfrage je
Verkehrsmittel. Wer das an einem bestimmten Bahnhof immer will, setzt bei dieser Kachel
**„Immer vollständig suchen“** (✎ Bearbeiten → Kachel antippen). Die Einstellung hängt
bewusst am Bahnhof und nicht am Gerät — an einer dichten Stammstrecke fehlt ohne sie die
halbe S-Bahn, an einem Landhalt kostet sie nur Wartezeit. Ist sie bei Start **oder** Ziel
gesetzt, wird vollständig gesucht.

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
Die vollständige Liste der Datenquellen samt Lizenzen: [transitous.org/sources](https://transitous.org/sources/).
Weiterleitungen zur Buchung: bahn.de. PendelPanda speichert nichts auf fremden Servern —
Kacheln und Einstellungen bleiben auf deinem Gerät.
