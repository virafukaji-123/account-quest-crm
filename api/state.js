const { load, slotTtl, usingRedis } = require("../lib/store");
const { analyse, gameDate } = require("../lib/engine");
const briefs = require("../lib/briefs.json");
const drafts = require("../lib/drafts.json");
const { redact } = require("../lib/game");

module.exports = async (req, res) => {
  const s = await load();
  const today = gameDate(s);
  res.setHeader("cache-control", "no-store");
  res.json({
    accounts: ["A", "B"].map((id) => ({ ...analyse(s, id, today), brief: briefs[id] || null, drafts: drafts[id] || [] })),
    newEvents: s.newEvents || [],
    log: s.log.slice(0, 15).map((l) => (l.error ? { ...l, error: redact(l.error) } : l)),
    noteQueue: s.noteQueue.map((n) => ({ account: n.account, kind: n.kind, title: n.title })),
    notesSent: s.notesSent.map((n) => ({ account: n.account, kind: n.kind, title: n.title, at: n.at })),
    nextCallInSeconds: await slotTtl(),
    gameDate: today,
    storage: usingRedis ? "redis" : "local file",
    dataAsOf: { accounts: s.accounts?.at, signals: s.signals?.at },
  });
};
