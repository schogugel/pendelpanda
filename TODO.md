# Offen

Kurze Liste dessen, was ansteht. Erledigtes wird gelöscht, nicht abgehakt —
die Historie steht im `git log`.

## Verteilung der APK über GitHub Releases + Obtainium

Updates ohne Store und ohne eigenen Server: Die APK hängt an einem GitHub
Release, [Obtainium](https://github.com/ImranR98/Obtainium) zieht sie von dort
und meldet neue Versionen automatisch. Wer es nutzt, trägt einmal die Repo-URL
ein und hat danach dieselbe Bequemlichkeit wie mit einem Store.

Dafür nötig:

- Signaturschlüssel anlegen und **sichern** (Befehl in `native/README.md`).
  Ohne ihn lässt sich später keine neue Version über eine bestehende
  Installation legen — Nutzer müssten deinstallieren und verlören ihre Kacheln.
- `android/keystore.properties` + Signaturblock in `build.gradle`, damit
  `npm run apk` eine signierte Release-APK erzeugt.
- Release je Version anlegen, APK anhängen. Der Dateiname sollte die Version
  tragen (`pendelpanda-1.5.3.apk`), sonst erkennt Obtainium den Wechsel nicht
  zuverlässig.
- Einmal mit Obtainium gegen das echte Repo prüfen — inklusive Update von einer
  älteren auf eine neuere Version, nicht nur Erstinstallation.

## Kleineres

- **Exakten DB-Link auf einem echten Gerät prüfen.** Die vbid-Kette ist gegen
  die DB verifiziert, aber noch nie aus der WebView heraus gelaufen. Erster
  Klick auf „Bei der DB öffnen“ in der App zeigt, ob der AppLauncher den DB
  Navigator trifft.
- **Referenzbilder in `icons/`** (`Bus.png`, `Sbahn.png`, `Tram.png`,
  `Ubahn.png`) liegen im Repo, werden aber nirgends benutzt. Entweder als
  Verkehrsmittel-Icons einbauen oder entfernen.
