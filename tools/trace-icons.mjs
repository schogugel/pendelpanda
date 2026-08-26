/* Wandelt die weißen PNG-Silhouetten aus icons/ in SVG-Pfade um.
   Warum nicht die PNGs direkt: Die vorhandenen Symbole zeichnen mit
   `currentColor` und passen sich damit der Schriftfarbe des Segments an —
   auf hellem Grund schwarz, auf dunklem weiß. Ein weißes PNG verschwände
   auf der hellen ICE-Farbe. Als Pfad geht das, und es kostet keine Datei. */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { trace } = require("potrace");
const sharpish = null;

const NAMES = { Regionalbahn: "regio", Schnellzug: "fern", Sbahn: "sbahn",
                Ubahn: "ubahn", Tram: "tram", Bus: "bus" };
const out = {};
for (const [file, key] of Object.entries(NAMES)) {
  const svg = await new Promise((res, rej) =>
    trace(`/tmp/claude-1000/-home-jonas-Data-Projekte-code-pendelpanda/47820bb0-7ca0-4e9c-9dce-95a8a50cc5dd/scratchpad/tr/${file}.png`, { threshold: 128, turdSize: 8, optCurve: true, optTolerance: 1.1,
                                 color: "currentColor", background: "transparent" },
          (e, s) => e ? rej(e) : res(s)));
  const vb = svg.match(/viewBox="([^"]+)"/)?.[1]
    || `0 0 ${svg.match(/width="(\d+)/)[1]} ${svg.match(/height="(\d+)/)[1]}`;
  const paths = [...svg.matchAll(/ d="([^"]+)"/g)].map(m => m[1]);
  out[key] = { vb, paths, len: paths.join("").length };
  console.log(`${key.padEnd(7)} viewBox ${vb.padEnd(18)} ${paths.length} Pfad(e), ${paths.join("").length} Zeichen`);
}
writeFileSync("/tmp/claude-1000/-home-jonas-Data-Projekte-code-pendelpanda/47820bb0-7ca0-4e9c-9dce-95a8a50cc5dd/scratchpad/traced.json", JSON.stringify(out));
