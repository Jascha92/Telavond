// Telavond – kleine server zonder externe pakketten (Node 20+).
// Levert het spel uit /public en bewaart scores in Upstash Redis via de REST-API.

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = process.env.PORT || 3000;
const REDIS_URL = (process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/$/, "");
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";
const PREFIX = process.env.SCORE_PREFIX || "telavond";

// Spelregels die de server moet kennen om onmogelijke scores te weigeren.
const TOTAAL = 100;          // biljetten per stembus
const BONUS = 5000;          // bonus per overgebleven potlood
const MAX_POTLODEN = 3;
const MIN_MS_PER_BILJET = 250;

const PUBLIC = path.join(__dirname, "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

/* ---------- Redis (Upstash REST) ---------- */
async function redis(...cmds) {
  if (!REDIS_URL || !REDIS_TOKEN) throw new Error("Upstash is niet ingesteld");
  const res = await fetch(REDIS_URL + "/pipeline", {
    method: "POST",
    headers: { Authorization: "Bearer " + REDIS_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(cmds),
  });
  if (!res.ok) throw new Error("Upstash antwoordde " + res.status);
  const out = await res.json();
  for (const r of out) if (r.error) throw new Error(r.error);
  return out.map((r) => r.result);
}
const k = (...delen) => [PREFIX, ...delen].join(":");

/* ---------- Hulpjes ---------- */
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const pinHash = (pin, zout) => crypto.scryptSync(String(pin), zout, 32).toString("hex");
const gelijk = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

function naamSleutel(naam) {
  return naam.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}
function geldigeNaam(naam) {
  return typeof naam === "string" && /^[\p{L}\p{N} .'_-]{2,24}$/u.test(naam.trim());
}
function geldigToken(t) {
  return typeof t === "string" && /^[A-Za-z0-9-]{20,80}$/.test(t);
}
// Hoogst haalbare score na een aantal verwerkte biljetten.
function maxScore(biljetten, klaar) {
  let s = 0;
  for (let i = 0; i < biljetten; i++) s += 200 * Math.min(5, 1 + Math.floor(i / 5));
  return s + (klaar ? MAX_POTLODEN * BONUS : 0);
}

async function limiet(sleutel, max, seconden) {
  const sleutel2 = k("limiet", sleutel);
  const [, n] = await redis(["SET", sleutel2, 0, "EX", seconden, "NX"], ["INCR", sleutel2]);
  return n <= max;
}

function stuur(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}
function leesJson(req) {
  return new Promise((ok, fout) => {
    let body = "";
    req.on("data", (d) => { body += d; if (body.length > 4000) { fout(new Error("te groot")); req.destroy(); } });
    req.on("end", () => { try { ok(JSON.parse(body || "{}")); } catch { fout(new Error("geen geldige JSON")); } });
  });
}
function ip(req) {
  return (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "?";
}

/* ---------- API ---------- */
async function scorebord() {
  const [rij] = await redis(["ZREVRANGE", k("bord"), 0, 24, "WITHSCORES"]);
  const sleutels = [];
  for (let i = 0; i < rij.length; i += 2) sleutels.push(rij[i]);
  if (!sleutels.length) return [];
  const details = await redis(...sleutels.map((s) => ["HMGET", k("speler", s), "naam", "nauwk"]));
  return sleutels.map((s, i) => ({ naam: details[i][0] || s, best: Number(rij[i * 2 + 1]), nauwk: Number(details[i][1] || 0) }));
}

async function bewaarScore(b, req) {
  const { naam, token } = b;
  if (!geldigeNaam(naam)) return [400, { fout: "Gebruik 2 tot 24 letters, cijfers of spaties." }];
  if (!geldigToken(token)) return [400, { fout: "Ongeldige sessie. Herlaad de pagina." }];
  const score = Math.round(Number(b.score)), biljetten = Math.round(Number(b.biljetten));
  const nauwk = Math.round(Number(b.nauwk)), niveau = Math.round(Number(b.niveau)), duur = Number(b.duurMs);
  const klaar = b.klaar === true;
  if (![score, biljetten, nauwk, niveau, duur].every(Number.isFinite) || score < 0 || biljetten < 1 || biljetten > TOTAAL
      || nauwk < 0 || nauwk > 100 || (klaar && biljetten !== TOTAAL) || score > maxScore(biljetten, klaar)
      || duur < biljetten * MIN_MS_PER_BILJET) {
    return [400, { fout: "Deze score klopt niet met de spelregels." }];
  }
  if (!(await limiet("score:" + ip(req), 40, 600))) return [429, { fout: "Te veel inzendingen. Probeer het over een paar minuten opnieuw." }];

  const sleutel = naamSleutel(naam);
  const spelerKey = k("speler", sleutel), tokensKey = k("tokens", sleutel);
  const [bestaat, heeftToken, oudBest, pinGezet] = await redis(
    ["EXISTS", spelerKey], ["SISMEMBER", tokensKey, sha(token)], ["HGET", spelerKey, "best"], ["HEXISTS", spelerKey, "pin"]
  );
  if (bestaat && !heeftToken) return [409, { fout: "Deze naam is al in gebruik.", pinMogelijk: pinGezet === 1 }];

  const beter = !bestaat || score > Number(oudBest || 0);
  const cmds = [["HINCRBY", spelerKey, "potjes", 1], ["HSET", spelerKey, "naam", naam.trim(), "bijgewerkt", new Date().toISOString()]];
  if (!bestaat) cmds.push(["SADD", tokensKey, sha(token)]);
  if (beter) {
    cmds.push(["HSET", spelerKey, "best", score, "nauwk", nauwk, "niveau", niveau, "klaar", klaar ? 1 : 0]);
    cmds.push(["ZADD", k("bord"), score, sleutel]);
  }
  await redis(...cmds);
  return [200, { ok: true, nieuw: beter, best: beter ? score : Number(oudBest), pinGezet: pinGezet === 1 }];
}

async function zetPin(b) {
  const { naam, token, pin } = b;
  if (!geldigeNaam(naam) || !geldigToken(token) || !/^\d{4,6}$/.test(String(pin))) return [400, { fout: "Kies een pincode van 4 tot 6 cijfers." }];
  const sleutel = naamSleutel(naam);
  const [heeftToken] = await redis(["SISMEMBER", k("tokens", sleutel), sha(token)]);
  if (!heeftToken) return [403, { fout: "Deze naam hoort niet bij dit apparaat." }];
  const zout = crypto.randomBytes(16).toString("hex");
  await redis(["HSET", k("speler", sleutel), "pin", pinHash(pin, zout), "zout", zout]);
  return [200, { ok: true }];
}

async function koppel(b, req) {
  const { naam, token, pin } = b;
  if (!geldigeNaam(naam) || !geldigToken(token) || !/^\d{4,6}$/.test(String(pin))) return [400, { fout: "Vul je naam en pincode in." }];
  const sleutel = naamSleutel(naam);
  if (!(await limiet("pin:" + sleutel, 5, 3600)) || !(await limiet("pinip:" + ip(req), 20, 3600))) {
    return [429, { fout: "Te veel pogingen. Probeer het over een uur opnieuw." }];
  }
  const [opgeslagen, zout] = await redis(["HMGET", k("speler", sleutel), "pin", "zout"]).then((r) => r[0]);
  if (!opgeslagen || !zout || !gelijk(pinHash(pin, zout), opgeslagen)) return [403, { fout: "Pincode klopt niet." }];
  await redis(["SADD", k("tokens", sleutel), sha(token)]);
  return [200, { ok: true }];
}

/* ---------- Server ---------- */
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    if (url.pathname.startsWith("/api/")) {
      if (req.method === "GET" && url.pathname === "/api/scorebord") return stuur(res, 200, await scorebord());
      if (req.method === "POST") {
        const body = await leesJson(req);
        const routes = { "/api/score": bewaarScore, "/api/pin": zetPin, "/api/koppel": koppel };
        if (routes[url.pathname]) { const [st, data] = await routes[url.pathname](body, req); return stuur(res, st, data); }
      }
      return stuur(res, 404, { fout: "Onbekend adres." });
    }
    if (url.pathname === "/gezond") return stuur(res, 200, { ok: true });

    // Statische bestanden
    const bestand = path.normalize(path.join(PUBLIC, url.pathname === "/" ? "index.html" : url.pathname));
    if (!bestand.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
    fs.readFile(bestand, (err, data) => {
      if (err) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Niet gevonden"); }
      res.writeHead(200, {
        "Content-Type": TYPES[path.extname(bestand)] || "application/octet-stream",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "same-origin",
      });
      res.end(data);
    });
  } catch (e) {
    console.error(e);
    stuur(res, 500, { fout: "Er ging iets mis op de server. Probeer het later opnieuw." });
  }
});

server.listen(PORT, () => console.log("Telavond draait op poort " + PORT + (REDIS_URL ? "" : " (let op: Upstash niet ingesteld)")));
