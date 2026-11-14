// Storage: Upstash Redis (free, added from the Vercel dashboard) when its env vars exist,
// otherwise a local JSON file so the same code runs on a laptop with `node dev.js`.
const fs = require("fs");
const path = require("path");

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = "aq:store";
const LOCK = "aq:lock";
const LOCAL = path.join(process.cwd(), "data", "store.json");

async function redis(cmd) {
  const r = await fetch(URL_, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (j.error) throw new Error("Redis: " + j.error);
  return j.result;
}

const empty = () => ({ accounts: null, signals: null, paperwork: {}, other: {}, noteQueue: [], notesSent: [], log: [], lastCallAt: 0 });

async function load() {
  if (URL_) { const v = await redis(["GET", KEY]); return v ? { ...empty(), ...JSON.parse(v) } : empty(); }
  return fs.existsSync(LOCAL) ? { ...empty(), ...JSON.parse(fs.readFileSync(LOCAL, "utf8")) } : empty();
}
async function save(s) {
  if (URL_) return redis(["SET", KEY, JSON.stringify(s)]);
  fs.mkdirSync(path.dirname(LOCAL), { recursive: true });
  fs.writeFileSync(LOCAL, JSON.stringify(s));
}
// One game call per minute across every visitor: whoever gets the lock may call.
let localLockUntil = 0;
async function takeSlot(seconds = 61) {
  if (URL_) return (await redis(["SET", LOCK, "1", "NX", "EX", String(seconds)])) === "OK";
  if (Date.now() < localLockUntil) return false;
  localLockUntil = Date.now() + seconds * 1000; return true;
}
async function slotTtl() {
  if (URL_) return Math.max(0, await redis(["TTL", LOCK]));
  return Math.max(0, Math.ceil((localLockUntil - Date.now()) / 1000));
}
module.exports = { load, save, takeSlot, slotTtl, usingRedis: !!URL_ };
