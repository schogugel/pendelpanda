/* ============================================================================
   App-Icons erzeugen:  node tools/make-icons.mjs
   ============================================================================

   Warum es dieses Skript gibt: Die Icons wurden bisher von Hand erzeugt, und
   ihre Zwischenstufen liegen in `native/assets/` — einem Ordner, der bewusst
   NICHT im Repo ist. Damit war der einzige Weg vom Quellbild zum fertigen Icon
   das Gedächtnis. Jetzt steht er hier.

   Quelle ist EIN Bild (`ICON_SRC`), alles andere entsteht daraus:

     icons/app-<n>.png        Web/PWA — Startbildschirm, Tab, Verknüpfung
     icons/app-maskable.png   Android-PWA: wird zur Launcher-Form beschnitten
     native/assets/icon.png   Vorlage für die APK (Launcher-Icon)

   Für die APK übernimmt danach `@capacitor/assets` die vielen Dichten —
   der Befehl steht unten und in native/README.md.

   ZWEI Dinge, die hier festliegen und nicht geraten sind:

   1. **Der Dateiname trägt die Fassung** (`-dark`). Launcher und Manifest
      halten Icons hartnäckig im Cache; ein geänderter Inhalt unter altem Namen
      kommt beim Nutzer oft gar nicht an. Neue Fassung = neuer Name.

   2. **Das maskierbare Icon wird auf 72 % verkleinert.** Android schneidet
      daraus einen Kreis, ein Quadrat oder eine Squircle-Form — was außerhalb
      der „safe zone“ (80 % Durchmesser) liegt, kann wegfallen. Das Motiv füllt
      in der Vorlage 78 % der Fläche; nach der Verkleinerung sind es 56 %, also
      mit Abstand innerhalb. Die alte Fassung lag bei 53,5 % — gemessen, nicht
      geschätzt, damit die neue nicht plötzlich anders wirkt.

   Braucht ImageMagick (`magick`).
   ========================================================================== */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* Die Quelle. Bei einem neuen Icon HIER umstellen — und die Namen unten
   mitziehen, siehe Punkt 1 oben. */
const ICON_SRC = join(ROOT, "icons/icon_pendelpanda_dark.png");
const SUFFIX = "-dark";

/* Der Grundton der Vorlage. Er füllt den Rand des maskierbaren Icons, damit
   dort keine Kante entsteht, und dient als Hintergrund des Android-Icons.
   Bewusst das Schwarz der Vorlage und nicht die App-Hintergrundfarbe #0a0e18:
   Das Icon soll aussehen wie gezeichnet, nicht wie nachträglich unterlegt. */
const GRUND = "#000000";

const MASKABLE_SCALE = 0.72;

if (!existsSync(ICON_SRC)) {
  console.error(`✗ Quelle fehlt: ${ICON_SRC}`);
  process.exit(1);
}

const magick = (...args) => execFileSync("magick", args, { stdio: "inherit" });

const ziele = [
  { datei: `icons/app-192${SUFFIX}.png`, groesse: 192 },
  { datei: `icons/app-512${SUFFIX}.png`, groesse: 512 },
];

for (const { datei, groesse } of ziele) {
  magick(ICON_SRC, "-resize", `${groesse}x${groesse}`, join(ROOT, datei));
  console.log(`✓ ${datei}  (${groesse}×${groesse})`);
}

/* Maskierbar: verkleinertes Motiv, mittig auf voller Fläche im Grundton. */
const rand = Math.round(512 * MASKABLE_SCALE);
magick(ICON_SRC, "-resize", `${rand}x${rand}`,
  "-background", GRUND, "-gravity", "center", "-extent", "512x512",
  join(ROOT, `icons/app-maskable${SUFFIX}.png`));
console.log(`✓ icons/app-maskable${SUFFIX}.png  (512×512, Motiv auf ${Math.round(MASKABLE_SCALE * 100)} %)`);

/* Vorlage für die APK. 1024² ist, was @capacitor/assets erwartet. */
mkdirSync(join(ROOT, "native/assets"), { recursive: true });
magick(ICON_SRC, "-resize", "1024x1024", join(ROOT, "native/assets/icon.png"));
console.log("✓ native/assets/icon.png  (1024×1024)");

console.log(`
Fertig. Für die APK jetzt noch die Dichten erzeugen:

    cd native
    npx @capacitor/assets generate --android \\
      --iconBackgroundColor '${GRUND}' --iconBackgroundColorDark '${GRUND}' \\
      --splashBackgroundColor '#0a0e18' --splashBackgroundColorDark '#0a0e18'

Und die neuen Dateinamen müssen an VIER Stellen stehen, sonst greift die
Änderung nur halb:
  manifest.webmanifest · index.html · sw.js (SHELL) · native/sync.mjs (Allowlist)`);
