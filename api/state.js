const { load, slotTtl, usingRedis } = require("../lib/store");
const { analyse, gameDate, accountIds } = require("../lib/engine");
const briefs = require("../lib/briefs.json");
const drafts = require("../lib/drafts.json");
const answers = require("../lib/answers.json");
const history = require("../lib/history.json");
const { redact } = require("../lib/game");

module.exports = async (req, res) => {
  const s = await load();
  // Events the game returned earlier are kept as history (lib/history.json), marked as recorded.
  const live = s.signals?.data?.signals || [];
  const liveIds = new Set(live.map((x) => x.id));
  const recorded = history.signals.filter((x) => !liveIds.has(x.id)).map((x) => ({ ...x, recorded: history.recorded_at }));
  s.signals = { ...(s.signals || {}), data: { signals: [...recorded, ...live] } };
  const today = gameDate(s);
  res.setHeader("cache-control", "no-store");
  res.json({
    accounts: accountIds(s).filter((id) => s.paperwork?.[id]).map((id) => {
      const a = analyse(s, id, today);
      a.events = a.events.map((e) => ({ ...e, recorded: recorded.find((r) => r.id === e.id)?.recorded || null }));
      return { ...a, brief: briefs[id] || null, answers: answers[id] || null, drafts: drafts[id] || [] };
    }),
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
