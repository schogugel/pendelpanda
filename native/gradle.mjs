// Android-Build aufrufen:  node gradle.mjs debug|release
// Eigenes Skript, weil `./gradlew` in der Windows-Eingabeaufforderung nicht läuft
// und weil ein Release ohne Schlüssel abbrechen soll, statt still eine
// unsignierte, nicht installierbare APK zu liefern.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const art = process.argv[2];
const task = { debug: "assembleDebug", release: "assembleRelease" }[art];
if (!task) {
  console.error("Aufruf: node gradle.mjs debug|release");
  process.exit(1);
}
if (art === "release" && !existsSync(join(HERE, "keystore.properties"))) {
  console.error("✗ Kein Release auf diesem Rechner: native/keystore.properties fehlt.");
  console.error("  Das ist so gewollt. Zum Testen: npm run apk:debug");
  console.error("  KEINEN neuen Schlüssel erzeugen — er sperrte alle Bestandsnutzer von Updates aus.");
  process.exit(1);
}
const win = process.platform === "win32";
const r = spawnSync(win ? ".\\gradlew.bat" : "./gradlew", [task], {
  cwd: join(HERE, "android"), stdio: "inherit", shell: win,
});
process.exit(r.status ?? 1);
