"use strict";

/* ============================================================================
   Exakter DB-Verbindungslink (vbid) — nur im nativen Build
   ============================================================================

   Ein Link auf EINE bestimmte Verbindung ist bei der DB immer ein Teilen-Link
   mit einer „vbid“. Die kann man nicht selbst bauen: Man macht eine echte
   Fahrplansuche, nimmt aus dem Treffer den Kontext `ctxRecon` und lässt sich
   vom Teilen-Endpunkt eine vbid ausstellen. Vier Anfragen, dann steht der Link.

   Im Browser ist das unmöglich — nicht aus Geheimhaltung, sondern wegen CORS
   (Preflight 405, kein Allow-Origin). Nativ gilt CORS nicht, deshalb läuft das
   hier über den HTTP-Stack von Android statt über `fetch`. Bewusst NUR hier:
   Die Transitous-Aufrufe der App bleiben auf dem normalen Web-Pfad, damit der
   native Build sich in allem anderen exakt wie die Web-App verhält.

   Schlägt irgendetwas fehl — DB ändert die Endpunkte, kein Netz, Verbindung
   nicht wiedergefunden —, passiert nichts Schlimmes: Der Aufrufer öffnet dann
   den vorbefüllten Suchlink, also genau das, was die Web-App immer tut.
   ========================================================================== */

const DB_WEB = "https://www.bahn.de/web/api";
const DB_MOB = "https://app.services-bahn.de/mob";
const DB_MEDIA_TEILEN = "application/x.db.vendo.mob.verbindungteilen.v1+json";

async function dbHttp(opts) {
  const res = await PP.http.request(opts);
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
  // Der Teilen-Endpunkt antwortet mit einem eigenen Media-Type, den der native
  // Stack nicht als JSON erkennt — dann kommt der Rumpf als Text zurück.
  return typeof res.data === "string" ? JSON.parse(res.data) : res.data;
}

async function dbResolveStop(name) {
  const orte = await dbHttp({
    url: `${DB_WEB}/reiseloesung/orte?suchbegriff=${encodeURIComponent(name)}&typ=ALL&limit=1`,
    method: "GET",
    headers: { Accept: "application/json" },
  });
  return orte?.[0]?.id || null;
}

async function dbFahrplan(fromId, toId, dep) {
  const data = await dbHttp({
    url: `${DB_WEB}/angebote/fahrplan`,
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    data: {
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
    },
  });
  return data.verbindungen || [];
}

/* Die DB-Suche liefert mehrere Verbindungen; gesucht ist die, die PendelPanda
   anzeigt. Gematcht wird über Soll-Abfahrt UND Soll-Ankunft — die Ist-Zeiten
   wandern mit der Verspätung und taugen nicht als Schlüssel. */
function dbFindConnection(verbindungen, dep, arr) {
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

async function dbMintVbid(ctxRecon, dep, from, to) {
  const data = await dbHttp({
    url: `${DB_MOB}/angebote/verbindung/teilen`,
    method: "POST",
    headers: {
      Accept: DB_MEDIA_TEILEN,
      "Content-Type": DB_MEDIA_TEILEN,
      "Accept-Language": "de",
      "X-Correlation-ID": `${dbUuid()}_${dbUuid()}`,
    },
    data: { GH: ctxRecon, HD: `${dep}:00${dbBerlinOffset(dep)}`, SO: from, ZO: to },
  });
  return data.vbid || null;
}

function dbUuid() {
  return crypto.randomUUID ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
      });
}

// UTC-Offset von Europe/Berlin am gegebenen Datum ("+01:00" / "+02:00")
function dbBerlinOffset(dep) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Berlin", timeZoneName: "longOffset" })
    .formatToParts(new Date(`${dep}:00Z`)).find(p => p.type === "timeZoneName")?.value || "GMT+01:00";
  return name.replace("GMT", "") || "+01:00";
}

/* Liefert den Link auf genau diese Verbindung — oder null, wenn irgendein
   Schritt nicht klappt. Nie werfen: Der Aufrufer soll ohne Sonderbehandlung
   auf den Suchlink zurückfallen können. */
async function dbExactLink({ from, to, dep, arr }) {
  if (!PP.native || !PP.http) return null;
  try {
    const [fromId, toId] = await Promise.all([dbResolveStop(from), dbResolveStop(to)]);
    if (!fromId || !toId) return null;
    const match = dbFindConnection(await dbFahrplan(fromId, toId, dep), dep, arr);
    if (!match?.ctxRecon) return null;
    const vbid = await dbMintVbid(match.ctxRecon, dep, from, to);
    return vbid ? `https://www.bahn.de/buchung/start?vbid=${encodeURIComponent(vbid)}` : null;
  } catch {
    return null;
  }
}

/* Hängt den exakten Link an den „Bei der DB öffnen“-Knopf. Der `href` bleibt
   als Suchlink stehen und ist damit gleichzeitig der Rückfall: Wenn die vbid
   nicht zustande kommt, wird einfach er geöffnet. Die vier Anfragen dauern
   einen Moment, deshalb sagt der Knopf solange, dass er arbeitet. */
function enableExactDbLink(a, fromName, toName, depIso, arrIso) {
  const fallback = a.href;
  const label = a.textContent;
  a.addEventListener("click", async (e) => {
    e.preventDefault();
    if (a.dataset.busy) return;
    a.dataset.busy = "1";
    a.textContent = "Verbindung wird geöffnet …";
    const url = await dbExactLink({
      from: fromName, to: toName,
      dep: localMinuteIso(depIso), arr: localMinuteIso(arrIso),
    });
    a.textContent = label;
    delete a.dataset.busy;
    PP.openExternal(url || fallback);
  });
}
