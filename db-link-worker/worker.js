"use strict";

/**
 * PendelPanda DB-Link-Worker (Cloudflare Worker, kostenloser Free-Tier)
 *
 * Macht aus einer konkreten Verbindung einen offiziellen bahn.de-Teilen-Link
 * (vbid). Der Link zeigt exakt DIESE Verbindung – auf dem Handy öffnet er den
 * DB Navigator mit „Zu meinen Reisen hinzufügen“.
 *
 * Aufruf (per Redirect, die PWA verlinkt einfach hierher):
 *   GET /?from=Hanau Hbf&to=Frankfurt(Main)Hbf&dep=2026-08-23T07:52&arr=2026-08-23T08:10
 *   dep/arr = GEPLANTE Abfahrt/Ankunft in lokaler Zeit (Minutengenauigkeit)
 *
 * Ablauf: Stationsnamen auflösen → bahn.de-Fahrplansuche zur Abfahrtszeit →
 * Verbindung über Soll-Abfahrt+Soll-Ankunft matchen → Teilen-Endpunkt des
 * DB-Navigator-Backends erzeugt die vbid → 302 auf bahn.de/buchung/start?vbid=…
 * Schlägt irgendetwas fehl, wird auf die vorbefüllte Suche umgeleitet.
 *
 * Hinweis: nutzt dieselben (inoffiziellen) Endpunkte wie bahn.de/DB Navigator
 * selbst. Es fällt genau EIN Ablauf pro Klick an – Rate Limits sind kein Thema.
 */

const WEB = "https://www.bahn.de/web/api";
const MOB = "https://app.services-bahn.de/mob";
const UA_WEB = "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0";
const MEDIA_TEILEN = "application/x.db.vendo.mob.verbindungteilen.v1+json";

export default {
  async fetch(request) {
    const q = new URL(request.url).searchParams;
    const from = q.get("from"), to = q.get("to");
    const dep = q.get("dep"), arr = q.get("arr"); // "YYYY-MM-DDTHH:MM" lokal

    const fallback = searchLink(from, to, dep);
    if (!from || !to || !dep) return Response.redirect(fallback, 302);

    try {
      const [fromId, toId] = await Promise.all([resolveStop(from), resolveStop(to)]);
      if (!fromId || !toId) return Response.redirect(fallback, 302);

      const verbindungen = await fahrplan(fromId, toId, dep);
      const match = findConnection(verbindungen, dep, arr);
      if (!match || !match.ctxRecon) return Response.redirect(fallback, 302);

      const vbid = await mintVbid(match.ctxRecon, dep, from, to);
      return Response.redirect(
        vbid ? `https://www.bahn.de/buchung/start?vbid=${encodeURIComponent(vbid)}` : fallback,
        302
      );
    } catch {
      return Response.redirect(fallback, 302);
    }
  },
};

function searchLink(from, to, dep) {
  const enc = encodeURIComponent;
  const hd = dep ? `${dep}:00` : "";
  return `https://www.bahn.de/buchung/fahrplan/suche#sts=true&so=${enc(from || "")}&zo=${enc(to || "")}` +
    `&soid=${enc("O=" + (from || ""))}&zoid=${enc("O=" + (to || ""))}${hd ? `&hd=${enc(hd)}` : ""}`;
}

async function resolveStop(name) {
  const res = await fetch(
    `${WEB}/reiseloesung/orte?suchbegriff=${encodeURIComponent(name)}&typ=ALL&limit=1`,
    { headers: { Accept: "application/json", "User-Agent": UA_WEB } }
  );
  if (!res.ok) return null;
  const orte = await res.json();
  return orte?.[0]?.id || null;
}

async function fahrplan(fromId, toId, dep) {
  const body = {
    abfahrtsHalt: fromId,
    anfrageZeitpunkt: `${dep}:00`,
    ankunftsHalt: toId,
    ankunftSuche: "ABFAHRT",
    klasse: "KLASSE_2",
    produktgattungen: ["ICE", "EC_IC", "IR", "REGIONAL", "SBAHN", "BUS", "SCHIFF", "UBAHN", "TRAM", "ANRUFPFLICHTIG"],
    reisende: [{ typ: "ERWACHSENER", ermaessigungen: [{ art: "KEINE_ERMAESSIGUNG", klasse: "KLASSENLOS" }], alter: [], anzahl: 1 }],
    schnelleVerbindungen: true,
    sitzplatzOnly: false,
    bikeCarriage: false,
    reservierungsKontingenteVorhanden: false,
  };
  const res = await fetch(`${WEB}/angebote/fahrplan`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA_WEB },
    body: JSON.stringify(body),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.verbindungen || [];
}

function findConnection(verbindungen, dep, arr) {
  for (const v of verbindungen) {
    const legs = (v.verbindungsAbschnitte || []).filter(a => a?.verkehrsmittel?.typ === "PUBLICTRANSPORT");
    if (!legs.length) continue;
    const soll = (halt, key) => halt?.[key]?.sollzeit?.slice(0, 16) || "";
    const vDep = soll(legs[0].halte?.[0], "abfahrt");
    const vArr = soll(legs[legs.length - 1].halte?.at(-1), "ankunft");
    if (vDep === dep && (!arr || vArr === arr)) return v;
  }
  return null;
}

async function mintVbid(ctxRecon, dep, from, to) {
  const body = { GH: ctxRecon, HD: `${dep}:00${berlinOffset(dep)}`, SO: from, ZO: to };
  const res = await fetch(`${MOB}/angebote/verbindung/teilen`, {
    method: "POST",
    headers: {
      Accept: MEDIA_TEILEN,
      "Content-Type": MEDIA_TEILEN,
      "Accept-Language": "de",
      "User-Agent": "DBNavigator/Android/26.9.0",
      "X-App-Version": "26.9.0",
      "X-Correlation-ID": `${crypto.randomUUID()}_${crypto.randomUUID()}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.vbid || null;
}

// UTC-Offset von Europe/Berlin am gegebenen Datum (+01:00 / +02:00)
function berlinOffset(dep) {
  const d = new Date(`${dep}:00Z`);
  const tzName = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Berlin", timeZoneName: "longOffset" })
    .formatToParts(d).find(p => p.type === "timeZoneName")?.value || "GMT+01:00";
  return tzName.replace("GMT", "") || "+01:00";
}
