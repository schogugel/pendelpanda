/* ============================================================================
   Layout nachmessen statt schätzen:  node tools/layout.mjs
   ============================================================================

   Die Startseite soll ohne Scrollen auf jeden Bildschirm passen. Ob das
   stimmt, lässt sich nicht am Quelltext ablesen — dreimal lag ich damit
   daneben, zuletzt in v1.13.0: `min-height` statt `height` am body ließ die
   Höhenkette offen, `1fr` in `grid-auto-rows` hatte nichts zu verteilen, und
   die letzte Kachelreihe hing 15 px über.

   Dieses Werkzeug lädt die echte Seite in einem echten Browser, misst darin
   `scrollHeight` gegen `innerHeight` und legt die Ergebnisse als Bild ab.
   Es urteilt NICHT selbst — sieh dir das Bild an: „PASST“ heißt kein Überlauf,
   „SCROLLT“ nennt die Zahl der überstehenden Pixel.

   Braucht Firefox (`/usr/bin/firefox`) und ImageMagick für die Montage.
   ========================================================================== */

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SIZES = ["393x852", "393x740", "360x640", "412x915", "1280x800"];

if (!existsSync("/usr/bin/firefox")) {
  console.error("✗ Firefox nicht gefunden — ohne Browser lässt sich das Layout nicht messen.");
  process.exit(1);
}

/* Messung IM Dokument, ohne Zeitgeber: Firefox schießt das Bild direkt nach
   `load`, ein setTimeout käme zu spät und das Bild bliebe leer. */
const probe = readFileSync(join(ROOT, "index.html"), "utf8") + `
<script>
addEventListener("load", () => {
  const de = document.documentElement, tile = document.querySelector(".stationbtn");
  const over = Math.max(0, de.scrollHeight - window.innerHeight);
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;inset:0;z-index:99999;background:#fff;color:#000;"
    + "font:22px/1.6 monospace;padding:18px;white-space:pre";
  box.textContent = [
    "Fenster      " + window.innerWidth + "x" + window.innerHeight,
    "scrollHeight " + de.scrollHeight,
    "UEBERLAUF    " + over + " px",
    "Kacheln      " + document.querySelectorAll(".stationbtn").length,
    "Kachelhoehe  " + (tile ? Math.round(tile.getBoundingClientRect().height) : "-"),
    "", over <= 1 ? "PASST" : "SCROLLT"
  ].join("\\n");
  document.body.appendChild(box);
});
</script>`;

const probePath = join(ROOT, "_layout-probe.html");
const work = mkdtempSync(join(tmpdir(), "pp-layout-"));
/* Eigenes, DAUERHAFTES Profil: Ein frisches Profil richtet Firefox beim ersten
   Start minutenlang ein und lief dabei in den Zeitausfall. Getrennt vom Profil
   des Nutzers, damit ein laufender Browser nicht stört. */
const prof = join(dirname(fileURLToPath(import.meta.url)), ".ffprofile");
mkdirSync(prof, { recursive: true });
const ff = (args, ms) => execFileSync("/usr/bin/firefox",
  ["--headless", "--no-remote", "--profile", prof, ...args], { stdio: "ignore", timeout: ms });

writeFileSync(probePath, probe);
try {
  if (!existsSync(join(prof, "prefs.js"))) {
    console.log("· Firefox-Profil wird einmalig angelegt …");
    try { ff(["--screenshot", join(work, "warmup.png"), "about:blank"], 300000); } catch { /* egal */ }
  }
  const shots = [];
  for (const size of SIZES) {
    const [w, h] = size.split("x");
    const out = join(work, `${size}.png`);
    ff(["--window-size", `${w},${h}`, "--screenshot", out, `file://${probePath}`], 180000);
    shots.push(out);
    console.log(`· ${size} gemessen`);
  }
  const montage = join(ROOT, "layout-messung.png");
  execFileSync("magick", ["montage", ...shots, "-tile", `${SIZES.length}x1`,
    "-geometry", "300x330+6+6", "-background", "#222", montage], { stdio: "ignore" });
  console.log(`\n✓ Ergebnis: ${montage}  — ansehen, jede Kachel muss „PASST“ zeigen.`);
} finally {
  rmSync(probePath, { force: true });
  rmSync(work, { recursive: true, force: true });
}
