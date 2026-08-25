"use strict";

/* ============================================================================
   Plattform-Schicht — EINE Codebasis, zwei Auslieferungen
   ============================================================================

   PendelPanda läuft als Web-App (GitHub Pages) und als Android-APK. Beide
   nutzen exakt dieselben Dateien; es gibt KEINEN zweiten Zweig und keine
   Kopie. Der Unterschied wird hier zur Laufzeit erkannt und an genau vier
   Stellen gekapselt — überall sonst weiß der Rest der App nichts davon.

   Warum es die App überhaupt gibt: Der exakte DB-Verbindungslink braucht eine
   „vbid“, die nur das DB-Backend vergeben kann. Dessen Endpunkt schickt keine
   CORS-Header (nachgemessen: Preflight 405, kein Allow-Origin), also darf ihn
   KEINE Webseite aufrufen — der User-Agent ist ihm dagegen egal. In der APK
   läuft die Anfrage über den nativen HTTP-Stack, wo CORS nicht gilt. Damit
   kommt der Link ganz ohne Server zustande: kein Proxy, kein Konto, keine
   Anfragen, die auf eine einzelne Person zurückfallen.

   Was hier gekapselt wird:
   1. Externe Links   → nativ per Intent, damit App-Links den DB Navigator öffnen
   2. Zurück-Geste    → Dialog schließen › Ansicht zurück › App verlassen
   3. Service Worker  → im nativen Build überflüssig (Dateien liegen lokal)
   4. Statusleiste    → an das dunkle Design angleichen
   ========================================================================== */

const PP = (() => {
  const cap = window.Capacitor;
  const native = !!(cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform());
  const plugins = (cap && cap.Plugins) || {};

  return {
    native,
    /* Kurzname für die Versionszeile in den Einstellungen. Wenn etwas klemmt,
       sieht man dort sofort, welche der beiden Auslieferungen läuft. */
    kind: native ? "App" : "Web",
    http: plugins.CapacitorHttp || null,

    /* Nach draußen öffnen. Nativ bewusst über den AppLauncher (Intent
       ACTION_VIEW): Nur so greifen Android-App-Links, und bahn.de-Links landen
       direkt im DB Navigator statt in einem In-App-Browser, der die Verbindung
       nicht an die App weiterreichen kann. */
    openExternal(url) {
      const launcher = plugins.AppLauncher;
      if (native && launcher) {
        launcher.openUrl({ url }).catch(() => window.open(url, "_blank", "noopener"));
        return;
      }
      window.open(url, "_blank", "noopener");
    },
  };
})();

if (PP.native) {
  const plugins = window.Capacitor.Plugins;

  /* Ohne das lädt die WebView externe Seiten IN der App: bahn.de würde im
     eigenen Fenster aufgehen, der DB Navigator nie. Ein zentraler Handler
     fängt alle http(s)-Links ab — auch die Karten-Pins in der Detailansicht.
     `defaultPrevented` respektiert dabei den DB-Link, der sich selbst kümmert
     (er muss erst die vbid holen, bevor er weiß, wohin er zeigt). */
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented) return;
    const a = e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    if (!/^https?:/i.test(a.getAttribute("href") || "")) return;
    e.preventDefault();
    PP.openExternal(a.href);
  });

  /* Die ausführliche Hilfe liegt als Markdown neben der Web-App. Im nativen
     Build ist sie nicht mitgepackt (sie gehört zur Website, nicht zur App) —
     der Link zeigt deshalb auf die gehostete Fassung, die ohnehin immer die
     aktuelle ist. */
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll('a[href="HILFE.md"]').forEach(a => {
      a.href = "https://schogugel.github.io/pendelpanda/HILFE.md";
    });
  });

  /* Android-Zurück. Die App hängt ihre Ansichten an den Hash, kennt aber auch
     modale Dialoge — die fängt der Browser beim Zurück NICHT ab. Reihenfolge
     deshalb von innen nach außen; ganz am Ende steht das Verlassen der App,
     sonst säße man in der Abfahrtstafel fest. */
  if (plugins.App) {
    plugins.App.addListener("backButton", () => {
      const dlg = [...document.querySelectorAll("dialog")].filter(d => d.open).pop();
      if (dlg) { dlg.close(); return; }
      if (location.hash) { history.back(); return; }
      plugins.App.exitApp();
    });
  }

  /* Helle Systemleiste über dunklem Design sieht aus wie ein Fremdkörper. */
  if (plugins.StatusBar) {
    plugins.StatusBar.setStyle({ style: "DARK" }).catch(() => {});
    plugins.StatusBar.setBackgroundColor({ color: "#0a0e18" }).catch(() => {});
  }
}
