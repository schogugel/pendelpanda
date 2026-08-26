/* ============================================================================
   Statische Prüfung: benutzt der Code Namen, die es nicht gibt?
   ============================================================================

   Zweimal hintereinander ist genau dieselbe Fehlerklasse in die Auslieferung
   gerutscht und hat die App unbenutzbar gemacht:

     v1.7.0  `RISK_ICON` benutzte `svgIcon`, bevor es initialisiert war
     v1.9.0  `t.kind` blieb stehen, nachdem `const t = …` beim Umbau wegfiel

   Der Ladetest (`smoke.mjs`) findet nur den ersten Fall — der zweite steckte
   in einem Zweig, der erst bei einer echten Suche durchlaufen wird. Genau
   dafür ist `no-undef` da: Es liest den Code, statt ihn auszuführen, und
   findet jeden Namen, den es nirgends gibt.

   Die vier Skripte sind KLASSISCHE Skripte und teilen sich einen globalen
   Scope — deshalb `sourceType: "script"`. Was die eine Datei oben deklariert,
   darf die andere benutzen; ESLint sieht die Dateien aber einzeln, weshalb die
   dateiübergreifenden Namen unten als `globals` stehen müssen.

   Aufruf:  npx eslint --config tools/eslint.config.mjs *.js
   ========================================================================== */

import globals from "globals";

/* Namen, die in EINER Datei entstehen und in den anderen benutzt werden.
   Wächst diese Liste, ist das ein Hinweis: Vielleicht gehört die Funktion
   eher dorthin, wo sie gebraucht wird. */
const crossFile = [
  // platform.js
  "PP",
  // dblink.js
  "dbExactLink", "enableExactDbLink",
  // app.js
  "app", "settings", "slots", "API", "CATS", "CAT_LABEL", "BASE_SLOTS", "MAX_SLOTS",
  "byId", "escapeHtml", "fmtTime", "fmtDur", "diffMin", "delayBadge", "timeWithDelay",
  "localMinuteIso", "alertText", "transitLegs", "itKey", "openTripDialog", "loadMore",
  "renderResults", "renderGrid", "visibleItins", "neededVisible", "nextServiceEnd",
  "applyConfig", "cfgFromInput", "jrnGroup", "updateJourneyLine", "startJourneyTicker",
  "attachStopAlerts", "stopAlerts", "dbLink", "saveSettings", "saveSlots",
  // timeline.js
  "TL", "tl", "tlY", "renderTimeline", "tlAutoZoom", "tlAlignTopFor", "tlEdgeCheck",
  "tlSetZoom", "tlHeadClear", "tlStop", "tlGlideTo", "productClass", "legCancelled", "cancelledTransitLegs",
  "transferIssues", "legIssues", "itinIssues", "riskMark", "walkLegsBetween",
  "lineParts", "isReplacementService", "mapsPin", "trackChip", "modeIcon", "svgIcon",
  "letterBadge", "ICON", "RISK_ICON", "toMin", "worst",
];

export default [
  {
    files: ["*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "script",
      globals: {
        ...globals.browser,
        ...Object.fromEntries(crossFile.map(n => [n, "writable"])),
      },
    },
    linterOptions: { reportUnusedDisableDirectives: true },
    rules: {
      /* Der eigentliche Grund für diese Datei. */
      "no-undef": "error",
      /* Bewusst AUS. Die Regel kann nicht unterscheiden, ob ein Name beim
         LADEN benutzt wird (echter Fehler, v1.7.0) oder erst in einer später
         aufgerufenen Funktion (völlig in Ordnung, kommt hier ständig vor).
         Sie meldete deshalb korrekten Code. Den Ladefall deckt `smoke.mjs`
         zuverlässig ab, weil es die Dateien wirklich ausführt. */
      "no-use-before-define": "off",
      /* Tippfehler in Bedingungen und tote Zweige. */
      "no-dupe-keys": "error",
      "no-dupe-args": "error",
      "no-unreachable": "error",
      "no-cond-assign": "error",
      "no-constant-condition": "error",
      "no-self-compare": "error",
      /* Nur LOKALE Unbenutzte melden: Funktionen auf oberster Ebene werden
         hier absichtlich von anderen Dateien aufgerufen, ESLint sieht die
         Dateien aber einzeln und hielte sie alle für tot. Lokale Reste sind
         dagegen genau die Spur eines halben Umbaus. */
      "no-unused-vars": ["warn", { vars: "local", args: "none", varsIgnorePattern: "^_" }],
    },
  },
];
