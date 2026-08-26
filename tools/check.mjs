/* ============================================================================
   Ein Befehl vor jedem Commit:  node tools/check.mjs
   ============================================================================

   Zwei Prüfungen, die verschiedene Dinge finden — beide werden gebraucht:

   1. STATISCH (ESLint, `no-undef`): liest den Code, ohne ihn auszuführen, und
      findet Namen, die es nirgends gibt — auch in Zweigen, die erst bei einer
      echten Suche durchlaufen werden. Das war der Fehler in v1.9.0: Beim
      Umbau fiel `const t = …` weg, `t.kind` blieb stehen, und jede Suche
      brach ab.

   2. DYNAMISCH (smoke.mjs): führt die Dateien in der Reihenfolge aus
      index.html aus und findet Abstürze beim LADEN. Das war der Fehler in
      v1.7.0: ein `const`, das oben benutzt und unten deklariert wurde.

   `node --check` findet KEINEN von beiden — es prüft nur die Syntax. Beide
   Fehler waren syntaktisch einwandfrei und haben die App unbenutzbar gemacht.
   ========================================================================== */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const FILES = ["platform.js", "dblink.js", "app.js", "timeline.js"];

let failed = false;
const run = (cmd, args, cwd = ROOT) => {
  try {
    execFileSync(cmd, args, { cwd, stdio: "inherit" });
    return true;
  } catch {
    failed = true;
    return false;
  }
};

const eslint = join(HERE, "node_modules", ".bin", "eslint");
if (!existsSync(eslint)) {
  console.error("✗ ESLint fehlt. Einmalig:  cd tools && npm install");
  failed = true;
} else {
  console.log("· Statische Prüfung …");
  if (run(eslint, ["--config", join(HERE, "eslint.config.mjs"), ...FILES])) {
    console.log("✓ Keine undefinierten Namen");
  }
}

console.log("· Ladetest …");
run(process.execPath, [join(HERE, "smoke.mjs")]);

console.log(failed ? "\nFEHLGESCHLAGEN — nicht ausliefern." : "\nAlles in Ordnung.");
process.exit(failed ? 1 : 0);
