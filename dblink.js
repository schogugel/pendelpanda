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

/* Wie weit ein DB-Halt von der bekannten Position entfernt sein darf. Großzügig,
   weil ein Bahnhof ein Gelände ist und die beiden Datenquellen den Mittelpunkt
   verschieden setzen — gemessen 1–160 m bei richtigen Treffern, während der
   falsche Ort (Rathaus in Lauf statt in Vorra) 5 km daneben lag. */
const DB_NEAR_M = 600;

/* Wie viele Minuten die DB von unserer Sollzeit abweichen darf. Große
   Busbahnhöfe haben mehrere Steige, und die beiden Datenquellen führen
   denselben Halt an verschiedenen davon: Gemessen in Regensburg fährt Bus 7
   laut Transitous um 22:30 und laut DB um 22:32 — dieselbe Fahrt, dieselbe
   Ankunft 22:48. Ohne Toleranz gäbe es dafür keinen Link. */
const DB_SHIFT_MIN = 5;

/* Verkehrsmittel von MOTIS auf die Produktgattung der DB. Damit lässt sich unter
   mehreren Halten an derselben Stelle der richtige wählen — am Hamburger Hbf
   liegen S-Bahn- und Fernbahnhalt wenige Meter auseinander. */
const DB_PRODUCT = {
  HIGHSPEED_RAIL: "ICE", LONG_DISTANCE: "EC_IC", NIGHT_RAIL: "EC_IC",
  REGIONAL_FAST_RAIL: "REGIONAL", REGIONAL_RAIL: "REGIONAL",
  METRO: "SBAHN", SUBWAY: "UBAHN", TRAM: "TRAM",
  BUS: "BUS", COACH: "BUS", FERRY: "SCHIFF",
};

async function dbHttp(opts) {
  const res = await PP.http.request(opts);
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
  // Der Teilen-Endpunkt antwortet mit einem eigenen Media-Type, den der native
  // Stack nicht als JSON erkennt — dann kommt der Rumpf als Text zurück.
  return typeof res.data === "string" ? JSON.parse(res.data) : res.data;
}

// Luftlinie in Metern (Haversine)
function dbMeters(aLat, aLon, bLat, bLon) {
  const R = 6371000, p = Math.PI / 180;
  const dLat = (bLat - aLat) * p, dLon = (bLon - aLon) * p;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(aLat * p) * Math.cos(bLat * p) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/* Den DB-Halt über die KOORDINATEN finden, nicht über den Namen.
   Der Name taugt dafür nicht: DB schreibt Nahverkehrshalte als
   „Haltestelle, Ort“ („Rathaus, Vorra“), Transitous liefert oft nur die nackte
   Haltestelle („Rathaus“). Die Namenssuche nahm dann den ersten Treffer
   irgendwo in Deutschland — „Vorra a.d. Pegnitz Rathaus“ landete auf
   „Rathaus, Lauf a.d. Pegnitz“, 20 km entfernt. Fernbahnhöfe heißen in beiden
   Systemen gleich, deshalb fiel es dort nie auf.

   Die Namenssuche bleibt als Rückfall, falls keine Koordinaten vorliegen oder
   die Umkreissuche nicht antwortet (sie ist merklich strenger begrenzt). */
async function dbResolveStop(place) {
  if (Number.isFinite(place?.lat) && Number.isFinite(place?.lon)) {
    try {
      const nah = await dbHttp({
        url: `${DB_WEB}/reiseloesung/orte/nearby?lat=${place.lat}&long=${place.lon}`
           + `&radius=${DB_NEAR_M}&maxNo=10`,
        method: "GET",
        headers: { Accept: "application/json" },
      });
      const cand = (Array.isArray(nah) ? nah : [])
        .filter(x => x?.type === "ST" && x.id && Number.isFinite(x.lat))
        .map(x => ({ ...x, d: dbMeters(place.lat, place.lon, x.lat, x.lon) }))
        .filter(x => x.d <= DB_NEAR_M)
        .sort((a, b) => a.d - b.d);
      const want = DB_PRODUCT[place.mode];
      const hit = (want && cand.find(x => (x.products || []).includes(want))) || cand[0];
      if (hit) return hit;
    } catch { /* weiter mit der Namenssuche */ }
  }
  const orte = await dbHttp({
    url: `${DB_WEB}/reiseloesung/orte?suchbegriff=${encodeURIComponent(place?.name || "")}`
       + `&typ=ALL&limit=1`,
    method: "GET",
    headers: { Accept: "application/json" },
  });
  return orte?.[0]?.id ? orte[0] : null;
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
   wandern mit der Verspätung und taugen nicht als Schlüssel.

   Stimmt beides auf die Minute, ist die Sache klar. Sonst wird EIN kleiner
   Versatz zugelassen, aber nur unter Auflagen: gleich viele Abschnitte, höchstens
   DB_SHIFT_MIN Minuten Unterschied, und eines der beiden Enden muss exakt
   passen. Zwei verschiedene Fahrten, die am selben Halt zur selben Minute
   ankommen und deren Abfahrt weniger als fünf Minuten auseinanderliegt, gibt es
   praktisch nicht — die Toleranz macht also keine falsche Verbindung auf, sie
   fängt nur ab, dass die beiden Datenquellen verschiedene Bussteige meinen. */
function dbFindConnection(verbindungen, dep, arr, legCount) {
  const min = s => +new Date(`${s}:00Z`) / 60000;
  const soll = (halt, key) => halt?.[key]?.sollzeit?.slice(0, 16) || "";
  let best = null;
  for (const v of verbindungen) {
    const legs = (v.verbindungsAbschnitte || []).filter(a => a?.verkehrsmittel?.typ === "PUBLICTRANSPORT");
    if (!legs.length) continue;
    const vDep = soll(legs[0].halte?.[0], "abfahrt");
    const vArr = soll(legs[legs.length - 1].halte?.at(-1), "ankunft");
    if (!vDep) continue;
    if (vDep === dep && (!arr || vArr === arr)) return v;   // exakt
    if (!arr || !vArr || legs.length !== legCount) continue;
    const dDep = Math.abs(min(vDep) - min(dep));
    const dArr = Math.abs(min(vArr) - min(arr));
    if (dDep > DB_SHIFT_MIN || dArr > DB_SHIFT_MIN) continue;
    if (dDep && dArr) continue;                              // ein Ende muss sitzen
    if (!best || dDep + dArr < best.score) best = { v, score: dDep + dArr };
  }
  return best?.v || null;
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
async function dbExactLink({ from, to, dep, arr, legCount }) {
  if (!PP.native || !PP.http) return null;
  try {
    const [a, b] = await Promise.all([dbResolveStop(from), dbResolveStop(to)]);
    if (!a?.id || !b?.id) return null;
    const match = dbFindConnection(await dbFahrplan(a.id, b.id, dep), dep, arr, legCount);
    if (!match?.ctxRecon) return null;
    /* Für den Teilen-Aufruf die DB-eigene Schreibweise nehmen: Transitous
       liefert im Nahverkehr oft nur „Bismarckplatz“, die DB nennt denselben
       Halt „Bismarckplatz, Regensburg“. */
    const vbid = await dbMintVbid(match.ctxRecon, dep, a.name || from?.name, b.name || to?.name);
    return vbid ? `https://www.bahn.de/buchung/start?vbid=${encodeURIComponent(vbid)}` : null;
  } catch {
    return null;
  }
}

/* Hängt den exakten Link an den „Bei der DB öffnen“-Knopf. Der `href` bleibt
   als Suchlink stehen und ist damit gleichzeitig der Rückfall: Wenn die vbid
   nicht zustande kommt, wird einfach er geöffnet. Die vier Anfragen dauern
   einen Moment, deshalb sagt der Knopf solange, dass er arbeitet. */
/* `von`/`bis` sind die ECHTEN Ein- und Ausstiegshalte dieser Verbindung
   (`{name, lat, lon, mode}`), nicht die vom Nutzer gewählten Kacheln. Der
   Unterschied ist der Kern der Sache: Beginnt eine Verbindung mit einem Fußweg
   zu einem anderen Halt — im Nahverkehr der Normalfall —, dann gehört die
   Abfahrtszeit gar nicht zum Startbahnhof. Die DB suchte dann ab Arnulfsplatz
   nach einer Fahrt, die um 21:50 am Bismarckplatz losfährt, fand sie nicht und
   fiel auf den Suchlink zurück. */
function enableExactDbLink(a, von, bis, depIso, arrIso, legCount) {
  const fallback = a.href;
  const label = a.textContent;
  a.addEventListener("click", async (e) => {
    e.preventDefault();
    if (a.dataset.busy) return;
    a.dataset.busy = "1";
    a.textContent = "Verbindung wird geöffnet …";
    const url = await dbExactLink({
      from: von, to: bis, legCount,
      dep: localMinuteIso(depIso), arr: localMinuteIso(arrIso),
    });
    a.textContent = label;
    delete a.dataset.busy;
    PP.openExternal(url || fallback);
  });
}
