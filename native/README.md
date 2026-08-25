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

## Signaturschlüssel

Für Release-Builds:

    keytool -genkey -v -keystore pendelpanda.keystore \
      -alias pendelpanda -keyalg RSA -keysize 2048 -validity 10000

**Diesen Schlüssel und sein Passwort niemals verlieren.** Ohne ihn kann keine
neue Version über eine bestehende Installation gelegt werden — die Nutzer
müssten deinstallieren und verlören ihre Kacheln. Der Keystore gehört *nicht*
ins Repo (steht im `.gitignore`), sondern in ein Backup.

Signaturdaten kommen in `android/keystore.properties` (ebenfalls ignoriert):

    storeFile=../../pendelpanda.keystore
    storePassword=…
    keyAlias=pendelpanda
    keyPassword=…

## Verteilen und aktualisieren

Ohne Store, ohne Server: APK an ein **GitHub Release** hängen. Wer
[Obtainium](https://github.com/ImranR98/Obtainium) nutzt, trägt einmal die
Repo-URL ein und bekommt Updates automatisch — dieselbe Bequemlichkeit wie ein
Store, aber ohne einen.

Sonst: APK weitergeben, drüberinstallieren. Solange derselbe Schlüssel
signiert, bleiben alle Einstellungen erhalten.

## Was NICHT in die APK wandert

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
