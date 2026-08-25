/* ============================================================================
   Web-Dateien → native/www/
   ============================================================================

   Die Repo-Wurzel ist die EINZIGE Quelle. Dieses Skript kopiert daraus, was in
   die APK gehört; danach übernimmt `cap sync android`. Es gibt bewusst keinen
   zweiten Zweig und keine gepflegte Kopie — `native/www/` ist reines Erzeugnis
   und liegt deshalb im .gitignore.

   Bewusst eine ALLOWLIST, keine Ausschlussliste: Sonst wandern früher oder
   später .git, node_modules oder die halbe Doku mit in die App, und niemand
   merkt es. Was neu dazugehört, wird hier eingetragen — der Lauf bricht ab,
   wenn eine gelistete Datei fehlt, damit ein Tippfehler nicht als stille
   Lücke in der APK landet.

   NICHT dabei und warum:
   - sw.js .................. Service Worker; die Dateien liegen nativ lokal,
                              ein Cache davor stiftet nur Verwirrung
   - HILFE.md, CLAUDE.md .... gehören zur Website bzw. zum Repo, nicht in die App
   - manifest.webmanifest ... PWA-Installationsdatei; die APK IST die Installation
   - db-link-worker/ ........ ersatzlos entfallen, die App macht das selbst
   - icons/Bus|Sbahn|... .... Referenzbilder, kein App-Inhalt
   ========================================================================== */

import { cp, mkdir, rm, access, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..");
const OUT = join(HERE, "www");

const FILES = [
  "index.html",
  "style.css",
  "platform.js",
  "dblink.js",
  "app.js",
  "timeline.js",
  "icons/app-192.png",
  "icons/app-512.png",
  "icons/app-maskable.png",
];

for (const f of FILES) {
  try {
    await access(join(SRC, f));
  } catch {
    console.error(`✗ fehlt: ${f} — Allowlist in native/sync.mjs prüfen`);
    process.exit(1);
  }
}

await rm(OUT, { recursive: true, force: true });
for (const f of FILES) {
  const dest = join(OUT, f);
  await mkdir(dirname(dest), { recursive: true });
  await cp(join(SRC, f), dest);
}

console.log(`✓ ${FILES.length} Dateien nach native/www/ kopiert`);

/* ---------------------------------------------------------------------------
   Version aus app.js in die APK übernehmen

   Die Versionsnummer hat EINE Quelle: APP_VERSION in app.js. Sie von Hand auch
   noch in build.gradle zu pflegen, geht garantiert irgendwann schief — dann
   zeigt die App im ⚙-Dialog etwas anderes an als Android in den Einstellungen,
   und niemand weiß mehr, welcher Stand installiert ist.

   Android braucht zusätzlich einen ganzzahligen versionCode, der NIE kleiner
   werden darf, sonst verweigert das System das Update. 1.5.3 → 10503 hält die
   Reihenfolge von semver ein und lässt bis 99 Minor-/Patch-Schritte Luft.
   --------------------------------------------------------------------------- */
const appJs = await readFile(join(SRC, "app.js"), "utf8");
const version = appJs.match(/APP_VERSION\s*=\s*"([\d.]+)"/)?.[1];
if (!version) {
  console.error("✗ APP_VERSION in app.js nicht gefunden");
  process.exit(1);
}
const [maj, min, pat] = version.split(".").map(Number);
const code = maj * 10000 + min * 100 + pat;

const gradlePath = join(HERE, "android", "app", "build.gradle");
try {
  const gradle = await readFile(gradlePath, "utf8");
  const patched = gradle
    .replace(/versionCode\s+\d+/, `versionCode ${code}`)
    .replace(/versionName\s+"[^"]*"/, `versionName "${version}"`);
  if (patched !== gradle) await writeFile(gradlePath, patched);
  console.log(`✓ APK-Version ${version} (versionCode ${code})`);
} catch {
  console.log("· android/ noch nicht angelegt — Version wird beim nächsten Lauf gesetzt");
}
