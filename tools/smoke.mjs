/* ============================================================================
   Ladetest: Werden alle Skripte fehlerfrei ausgeführt?
   ============================================================================

   `node --check` prüft nur die SYNTAX. Es findet nicht, wenn eine Datei beim
   Laden abstürzt — etwa weil ein `const` benutzt wird, bevor es initialisiert
   ist. Genau das ist in v1.7.0 passiert: `RISK_ICON` rief `svgIcon` auf, das
   erst 150 Zeilen später deklariert wird. Die Datei brach beim Laden ab, aber
   Funktionsdeklarationen werden trotzdem gehoistet — sichtbar war deshalb nur
   ein rätselhaftes „cannot access 'worst' before initialization“ an ganz
   anderer Stelle, und die App fand gar keine Verbindungen mehr.

   Dieser Test führt die Skripte in derselben Reihenfolge aus wie index.html,
   im selben Kontext (klassische Skripte teilen sich den globalen Scope), gegen
   eine Attrappe von Browser-Objekten. Er prüft KEINE Logik — er prüft, dass
   das Laden durchläuft und die erwarteten Funktionen danach benutzbar sind.

   Aufruf:  node tools/smoke.mjs
   ========================================================================== */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* Attrappe: Jeder Zugriff liefert wieder eine Attrappe, die sich zugleich als
   Funktion, Objekt und Array-artig verhält. So kommen die Skripte durch ihre
   Initialisierung, ohne dass ein echter Browser nötig ist. */
const stub = (name = "stub") => new Proxy(function () {}, {
  get(t, k) {
    if (k === Symbol.toPrimitive || k === "toString") return () => name;
    if (k === Symbol.iterator) return function* () {};
    if (k === "length") return 0;
    // then/catch/finally bleiben ganz normale Methoden: Der Code verkettet
    // damit (`register().then(…).catch(…)`), und die Attrappe soll dabei
    // einfach weiterreichen statt als halbes Promise zu zerbrechen.
    if (k === "hash" || k === "search" || k === "protocol") return "";
    if (k === "hostname" || k === "origin") return "localhost";
    if (k === "classList") return stub("classList");
    if (k === "dataset" || k === "style") return stub(String(k));
    if (k === "map" || k === "filter" || k === "forEach" || k === "slice") return () => [];
    return stub(`${name}.${String(k)}`);
  },
  apply() { return stub(`${name}()`); },
  has() { return true },
  set() { return true },
});

const sandbox = {
  console,
  Intl, Date, Math, JSON, crypto, URL, URLSearchParams, Promise, Set, Map, Number, String,
  Array, Object, RegExp, Error, isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
  setTimeout, clearTimeout, setInterval, clearInterval, fetch: () => new Promise(() => {}),
  requestAnimationFrame: () => 0,
  document: stub("document"),
  navigator: stub("navigator"),
  location: stub("location"),
  localStorage: stub("localStorage"),
  history: stub("history"),
  matchMedia: () => stub("mql"),
  CSS: { escape: s => String(s) },
  getComputedStyle: () => stub("cs"),
  addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true },
  open: () => null, alert: () => {}, scrollTo: () => {},
  innerWidth: 400, innerHeight: 800, devicePixelRatio: 2,
  AbortController: globalThis.AbortController,
  TextEncoder: globalThis.TextEncoder, TextDecoder: globalThis.TextDecoder,
  atob: globalThis.atob, btoa: globalThis.btoa,
  Intl, Boolean, Symbol, Proxy, Reflect, WeakMap, WeakSet, Function,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);

// Reihenfolge wie in index.html — sie ist Teil dessen, was geprüft wird
const FILES = ["platform.js", "dblink.js", "app.js", "timeline.js"];
let failed = false;

for (const f of FILES) {
  try {
    vm.runInContext(readFileSync(join(ROOT, f), "utf8"), sandbox, { filename: f });
    console.log(`✓ ${f} geladen`);
  } catch (e) {
    failed = true;
    console.error(`✗ ${f} bricht beim Laden ab:\n    ${e.constructor.name}: ${e.message}`);
  }
}

/* Nach dem Laden müssen die zentralen Funktionen wirklich aufrufbar sein.
   Ein abgestürztes Skript hinterlässt gehoistete Funktionen, die beim ersten
   Aufruf über ein nicht initialisiertes const stolpern — das fällt nur auf,
   wenn man sie tatsächlich anfasst. */
const CALLS = [
  ["itinIssues", it => it({ legs: [] })],
  ["transferIssues", fn => fn({ legs: [] }, { to: { arrival: 0, scheduledArrival: 0 } },
                                             { from: { departure: 0, scheduledDeparture: 0 } })],
  ["legIssues", fn => fn({ intermediateStops: [] })],
  ["riskMark", fn => fn("notice")],
  ["productClass", fn => fn("BUS")],
  ["localMinuteIso", fn => fn("2026-08-25T07:52:00Z")],
  ["alertText", fn => fn("<b>x</b><ul><li>y</li></ul>")],
];

for (const [name, call] of CALLS) {
  try {
    const fn = vm.runInContext(name, sandbox);
    if (typeof fn !== "function") throw new Error("nicht definiert");
    call(fn);
    console.log(`✓ ${name}() aufrufbar`);
  } catch (e) {
    failed = true;
    console.error(`✗ ${name}(): ${e.message}`);
  }
}

console.log(failed ? "\nFEHLGESCHLAGEN" : "\nAlles geladen und aufrufbar.");
process.exit(failed ? 1 : 0);
