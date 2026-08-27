# Offen

Kurze Liste dessen, was ansteht. Erledigtes wird gelöscht, nicht abgehakt —
die Historie steht im `git log`.

## Verteilung der APK über GitHub Releases + Obtainium

Updates ohne Store und ohne eigenen Server: Die APK hängt an einem GitHub
Release, [Obtainium](https://github.com/ImranR98/Obtainium) zieht sie von dort
und meldet neue Versionen automatisch. Wer es nutzt, trägt einmal die Repo-URL
ein und hat danach dieselbe Bequemlichkeit wie mit einem Store.

Vorbereitet ist inzwischen alles: `sync.mjs` schreibt Signatur-Einstellung und
versionshaltigen Dateinamen ins Gradle-Projekt, die Kette ist mit einem
Wegwerf-Schlüssel einmal komplett durchgebaut (signiert, nicht debuggbar, nur
INTERNET-Berechtigung).

Offen bleibt:

- **Signaturschlüssel anlegen und sichern** — nur du kannst das, weil das
  Passwort dir gehört. Befehl in `native/README.md`.
- Release je Version anlegen, APK anhängen.
- Einmal mit Obtainium gegen das echte Repo prüfen — inklusive Update von einer
  älteren auf eine neuere Version, nicht nur Erstinstallation.

## Lizenzdatei fürs Repo

Der Quelltext liegt öffentlich auf GitHub, aber ohne Lizenz — damit gilt das
gesetzliche Urheberrecht: niemand darf ihn nutzen, ändern oder weitergeben, nur
ansehen. „Quelloffen“ im Rechtssinne ist das nicht.

Das ist mehr als Formsache: Die neue EU-Produkthaftung für Software (ab
09.12.2026, verschuldensunabhängig) nimmt in Art. 2 Abs. 2 ausdrücklich „freie
und quelloffene Software, die außerhalb einer Geschäftstätigkeit entwickelt oder
bereitgestellt wird“ aus. „Außerhalb einer Geschäftstätigkeit“ passt
zweifelsfrei; „frei und quelloffen“ ist ohne Lizenz angreifbar — und mit einer
Datei zu beheben. Übliche Open-Source-Lizenzen enthalten obendrein den
anerkannten Gewährleistungsausschluss („AS IS, WITHOUT WARRANTY OF ANY KIND“).

Zu entscheiden ist nur, welche:
- **MIT** — elf Zeilen, maximal erlaubend, jeder darf alles.
- **GPL-3.0** — wer weitergibt, muss wieder quelloffen weitergeben.

Begründung ausführlich in `Notizen/haftung.md`.

## Kleineres

- **Exakten DB-Link auf einem echten Gerät prüfen.** Die vbid-Kette ist gegen
  die DB verifiziert, aber noch nie aus der WebView heraus gelaufen. Erster
  Klick auf „Bei der DB öffnen“ in der App zeigt, ob der AppLauncher den DB
  Navigator trifft.
- **Referenzbilder in `icons/`** (`Bus.png`, `Sbahn.png`, `Tram.png`,
  `Ubahn.png`) liegen im Repo, werden aber nirgends benutzt. Entweder als
  Verkehrsmittel-Icons einbauen oder entfernen.
