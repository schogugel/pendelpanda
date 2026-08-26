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
const SIZES = ["393x852", "393x740", "360x640", "412x915"];

/* Zwei Ansichten, die beide bildschirmfüllend sein müssen. Die Ergebnisansicht
   wird im UNGÜNSTIGSTEN Fall gemessen: mit BEIDEN Hinweiszeilen sichtbar. Genau
   daran ist v1.15.1 gescheitert — bei „Letzte“ kommt eine Zeile dazu, die es bei
   „Jetzt“ nicht gibt, und die feste Grafikhöhe passte dann nicht mehr. */
const VIEWS = {
  start: "",
  ergebnis: `
    document.querySelectorAll("main.view").forEach(v => v.hidden = v.id !== "view-results");
    document.body.dataset.view = "results";
    document.body.dataset.mode = "graph";
    document.getElementById("around-note").hidden = false;
    const ln = document.getElementById("last-note");
    ln.hidden = false;
    ln.textContent = "Später fährt noch etwas, aber nur mit Fernzug – in der Legende wieder einblenden.";
    document.getElementById("timeline-wrap").hidden = false;
    document.getElementById("timeline").innerHTML = '<div style="width:2000px;height:3000px"></div>';
    document.getElementById("tl-legend").innerHTML =
      ["Fernzug","Regionalzug","S-Bahn","U-Bahn","Tram","Bus","Sonstige","Fernbus"]
        .map(n => '<button class="tl-key on"><i class="dot"></i>' + n + '</button>').join("");
  `,
};

if (!existsSync("/usr/bin/firefox")) {
  console.error("✗ Firefox nicht gefunden — ohne Browser lässt sich das Layout nicht messen.");
  process.exit(1);
}

/* Messung IM Dokument, ohne Zeitgeber: Firefox schießt das Bild direkt nach
   `load`, ein setTimeout käme zu spät und das Bild bliebe leer. */
const html = readFileSync(join(ROOT, "index.html"), "utf8");
const makeProbe = (name, setup) => html + `
<script>
addEventListener("load", () => {
  ${setup}
  const de = document.documentElement;
  const over = Math.max(0, de.scrollHeight - window.innerHeight);
  // Auch die BREITE prüfen: Genau hier ist ein Fehler durchgerutscht, weil das
  // Werkzeug nur die Höhe maß, während die Grafik die Seite nach rechts sprengte.
  const overX = Math.max(0, de.scrollWidth - window.innerWidth);
  /* Nur die BLÖCKE der Ansicht messen, nicht deren Inhalt: Die Grafik ist ein
     eigenes Scrollfeld, ihr Inneres ragt absichtlich darüber hinaus. Gemessen
     wird also die Unterkante des letzten sichtbaren Blocks (die Legende). */
  const main = document.querySelector("body > main:not([hidden])");
  const letzte = [...main.children].filter(el => !el.hidden)
    .map(el => el.getBoundingClientRect().bottom)
    .reduce((a, b) => Math.max(a, b), 0);
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;inset:0;z-index:99999;background:#fff;color:#000;"
    + "font:21px/1.6 monospace;padding:16px;white-space:pre";
  box.textContent = [
    "${name}",
    "Fenster      " + window.innerWidth + "x" + window.innerHeight,
    "UEBERLAUF Y  " + over + " px",
    "UEBERLAUF X  " + overX + " px",
    "unterste Kante " + Math.round(letzte),
    "", (over <= 1 && overX <= 1 && letzte <= window.innerHeight + 1) ? "PASST" : "PASST NICHT"
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

try {
  if (!existsSync(join(prof, "prefs.js"))) {
    console.log("· Firefox-Profil wird einmalig angelegt …");
    try { ff(["--screenshot", join(work, "warmup.png"), "about:blank"], 300000); } catch { /* egal */ }
  }
  const shots = [];
  for (const [view, setup] of Object.entries(VIEWS)) {
    writeFileSync(probePath, makeProbe(view, setup));
    for (const size of SIZES) {
      const [w, h] = size.split("x");
      const out = join(work, `${view}-${size}.png`);
      ff(["--window-size", `${w},${h}`, "--screenshot", out, `file://${probePath}`], 180000);
      shots.push(out);
      console.log(`· ${view} ${size} gemessen`);
    }
  }
  const montage = join(ROOT, "layout-messung.png");
  execFileSync("magick", ["montage", ...shots, "-tile", `${SIZES.length}x${Object.keys(VIEWS).length}`,
    "-geometry", "300x300+6+6", "-background", "#222", montage], { stdio: "ignore" });
  console.log(`\n✓ Ergebnis: ${montage}  — ansehen, jede Kachel muss „PASST“ zeigen.`);
} finally {
  rmSync(probePath, { force: true });
  rmSync(work, { recursive: true, force: true });
}
