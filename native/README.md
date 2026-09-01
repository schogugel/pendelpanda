# PendelPanda als Android-App

Die APK ist **kein zweites Projekt**. Sie ist eine native Hülle um exakt
dieselben Dateien, die auch auf GitHub Pages liegen — Quelle der Wahrheit
bleibt die Repo-Wurzel. Hier drin steht nur, was Android zusätzlich braucht.

## Warum es die App gibt

Ein Link auf *genau eine* Verbindung braucht bei der DB eine `vbid`, die nur
das DB-Backend ausstellt. Dessen Endpunkt schickt keine CORS-Header
(nachgemessen: Preflight 405, kein `Allow-Origin`) — **keine Webseite darf ihn
aufrufen**, egal wie sie gehostet ist. Der User-Agent ist ihm dagegen egal.

Nativ gilt CORS nicht. Die App holt die vbid deshalb selbst, vom Gerät des
Nutzers, mit dessen IP. Kein Proxy, kein Konto, keine Anfragen, die sich bei
einer einzelnen Person sammeln. Genau deshalb gibt es die APK — und deshalb
hilft ein TWA-Wrapper (PWABuilder, Bubblewrap) **nicht**: Das ist Chrome mit
vollem CORS.

Klappt die vbid nicht, öffnet die App den vorbefüllten Suchlink — also das,
was die Web-App immer tut. Es geht nie etwas kaputt, es wird nur ungenauer.

## Was Web und App unterscheidet

Vier Stellen, alle in `platform.js` bzw. `dblink.js`, alle per `PP.native`
zur Laufzeit erkannt:

| | Web | App |
|---|---|---|
| DB-Link | vorbefüllte Suche | exakte Verbindung (vbid) |
| Externe Links | neuer Tab | Intent → DB Navigator, Karten-App |
| Zurück | Browser-Zurück | Dialog › Ansicht › App verlassen |
| Service Worker | ja (Netz-zuerst) | nein, Dateien liegen lokal |

Im ⚙-Dialog steht `v1.5.3 · Web` bzw. `· App` — damit ist ohne Nachfragen
klar, welche Auslieferung jemand vor sich hat.

## Bauen

Einmalig die Toolchain (Android SDK und ein JDK 21 — Gradle 8.14 baut mit dem
neueren System-JDK nicht):

    ./setup-toolchain.sh

Danach:

    npm install
    npm run apk:debug     # zum Ausprobieren, sofort installierbar
    npm run apk           # Release, braucht einen Signaturschlüssel

Die fertige Datei liegt unter
`android/app/build/outputs/apk/{debug,release}/`.

`npm run sync` allein kopiert nur die Web-Dateien nach `www/` und zieht die
Versionsnummer aus `app.js` nach `build.gradle` — **die Version wird nie von
Hand in Android gepflegt**, sonst zeigen App und Systemeinstellungen
irgendwann Verschiedenes an.

## Eine teilbare APK bauen

Die Debug-APK ist zum Ausprobieren gedacht, **nicht zum Weitergeben**: Sie trägt
das `debuggable`-Flag (jeder mit einem USB-Kabel kann sich in die laufende App
einklinken) und ist mit Androids öffentlich bekanntem Debug-Schlüssel signiert,
den jeder besitzt. Der Launcher zeigt zwar schon „PendelPanda“ — das ist nicht
der Unterschied.

### 1. Signaturschlüssel anlegen (einmalig)

    cd native
    keytool -genkeypair -v -keystore pendelpanda.keystore \
      -alias pendelpanda -keyalg RSA -keysize 2048 -validity 10000

**Diesen Schlüssel und sein Passwort niemals verlieren.** Ohne ihn lässt sich
keine neue Version über eine bestehende Installation legen — die Nutzer müssten
deinstallieren und verlören ihre Kacheln. Der Keystore gehört *nicht* ins Repo
(steht im `.gitignore`), sondern in ein Backup, das den Rechner überlebt.

### 2. Passwörter hinterlegen

`native/keystore.properties` (ebenfalls ignoriert):

    storeFile=pendelpanda.keystore
    storePassword=…
    keyAlias=pendelpanda
    keyPassword=…

Der Pfad ist relativ zu `native/`. `sync.mjs` schreibt die Signatur-Einstellung
bei jedem Lauf ins erzeugte Gradle-Projekt — von Hand dort zu editieren wäre
zwecklos, `android/` wird jederzeit neu erzeugt.

### 3. Bauen

    npm run apk

Ergebnis: `android/app/build/outputs/apk/release/pendelpanda-<version>-release.apk`.
Der Dateiname trägt die Version, damit Obtainium Updates zuverlässig erkennt.

Ohne `keystore.properties` läuft der Build zwar durch, die APK ist dann aber
**unsigniert und nicht installierbar** — das ist der Normalzustand eines frischen
Capacitor-Projekts, kein Fehler in diesem Repo.

### 3b. Signatur gegenprüfen

Eine falsch signierte APK merkt man sonst erst auf dem Telefon:

    ~/Android/Sdk/build-tools/36.0.0/apksigner verify --print-certs \
      android/app/build/outputs/apk/release/pendelpanda-<version>-release.apk

Erwartet: „Verifies“ plus der SHA-256-Fingerabdruck deines Schlüssels. **Dieser
Fingerabdruck muss bei jedem künftigen Release derselbe sein** — er ist die Identität
der App gegenüber Android.

### 4. Auf GitHub veröffentlichen

Die APK gehört als **Release-Anhang** ins Repo, nicht ins Repo selbst — Binärdateien
im Verzeichnisbaum blähen jeden Klon auf, ein Release-Asset lädt nur, wer es will:

    gh release create v<version> \
      android/app/build/outputs/apk/release/pendelpanda-<version>-release.apk \
      --title "PendelPanda <version>" --notes "Was neu ist …"

Ohne `gh` geht es genauso über die Weboberfläche: **Releases → Draft a new release**,
Tag `v<version>` anlegen, Titel setzen, die APK ins Anhang-Feld ziehen, veröffentlichen.
Für das erste Release der bequemere Weg — es ist nichts zu installieren.

Der ⚙-Dialog „App installieren“ zeigt auf
`https://github.com/schogugel/pendelpanda/releases/latest` — die Seite, nicht eine
feste Datei. Ein Direktlink (`…/releases/latest/download/name.apk`) wäre bequemer,
bricht aber still, sobald eine Fassung mal anders heißt; die Seite nennt außerdem die
Versionsnummer, sodass man vor dem Laden sieht, ob es etwas Neues gibt.

**Darf man das?** Ja. Eigener Code, eigene Signatur, MIT-lizenzierte Abhängigkeiten
(Capacitor); GitHub-Releases sind ausdrücklich für Binärdateien da (bis 2 GB je Datei).
Play-Store-Richtlinien gelten hier nicht — es ist kein Store. Was bleibt, ist die
Impressums-/Kontaktpflicht, die im ⚙-Dialog ohnehin schon erfüllt ist.

**Jedes Release mit DEMSELBEN Schlüssel signieren.** Ein Wechsel zwingt alle Nutzer
zum Deinstallieren; siehe Schritt 1.

### Was die Empfänger erleben werden

- **„Unbekannte Apps installieren“** muss einmal für die App erlaubt werden, aus
  der sie die Datei öffnen (Dateimanager, Browser, Messenger).
- **Play Protect warnt** bei jeder sideloadbaren App („unbekannter Entwickler“).
  Das ist normal und lässt sich nur über einen Store vermeiden.
- **Wer schon die Debug-APK hat, muss sie zuerst deinstallieren.** Debug- und
  Release-Signatur passen nicht zusammen; Android verweigert das Drüberinstallieren
  mit einer wenig hilfreichen Fehlermeldung. Ab der ersten Release-Version laufen
  Updates dann normal.
- **Einstellungen wandern nicht automatisch mit.** Vor dem Deinstallieren den
  Übertragungslink aus ⚙ sichern, danach in der neuen App einfügen.

## Was NICHT in die APK wandert

## Icons

Erzeugt werden sie aus **einer** Quelle (`icons/icon_pendelpanda_dark.png`):

    node tools/make-icons.mjs        # Web-Icons + native/assets/icon.png
    cd native
    npx @capacitor/assets generate --android \
      --iconBackgroundColor '#000000' --iconBackgroundColorDark '#000000' \
      --splashBackgroundColor '#0a0e18' --splashBackgroundColorDark '#0a0e18'

Der zweite Schritt füllt die vielen Dichten in `android/app/src/main/res/`. Das ist
ein ERZEUGTER Ordner — dort von Hand zu ändern hält nur bis zum nächsten Lauf.
`@capacitor/assets` steht bewusst nicht in den Abhängigkeiten: Es läuft ein-, zweimal
im Jahr, `npx` genügt.

Ohne die Farbflaggen setzt das Werkzeug einen weißen Icon-Hintergrund — bei einem
Icon, das selbst schwarz ist, sieht man den Unterschied erst auf dem Startbildschirm.

Die Allowlist steht in `sync.mjs`. Draußen bleiben bewusst: `sw.js` (nativ
sinnlos), `manifest.webmanifest` (die APK *ist* die Installation), `HILFE.md`
und `CLAUDE.md` (gehören zur Website bzw. zum Repo) sowie die Referenzbilder
in `icons/`. Kommt eine neue Datei zur App dazu, muss sie in die Allowlist —
`sync.mjs` bricht ab, wenn etwas Gelistetes fehlt, aber es kann nicht wissen,
was du vergessen hast.

## Erzeugtes, das nicht ins Repo gehört

`www/`, `android/`, `node_modules/`, `assets/` und der Keystore sind
Erzeugnisse bzw. Geheimnisse und stehen im `.gitignore`. Wer das Repo frisch
klont, macht `npm install && npx cap add android && npm run sync` — dann steht
alles wieder.
