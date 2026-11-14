// Weekly drone usage per account, for the leadership view. Reads saved data only (no game call).
const { load } = require("../lib/store");
const { parseCSV, accountIds } = require("../lib/engine");
const history = require("../lib/history.json");

module.exports = async (req, res) => {
  const s = await load();
  const live = s.signals?.data?.signals || [];
  const sigs = [...history.signals.filter((h) => !live.some((l) => l.id === h.id)), ...live];
  const out = {};
  for (const id of accountIds(s)) {
    const base = (s.paperwork?.[id]?.records || []).find((r) => r.path === "usage_weekly.csv")?.text || "";
    const extra = sigs.filter((x) => x.account === id).flatMap((x) => (x.records || []).filter((r) => r.path.endsWith("usage_weekly.csv")).map((r) => r.text));
    const rows = new Map();
    for (const t of [base, ...extra]) for (const r of parseCSV(t)) rows.set(r.week_start + "|" + r.dock_id, r);
    const byWeek = {};
    for (const r of rows.values()) {
      const w = (byWeek[r.week_start] ||= { week: r.week_start, flights: 0, docksFlown: 0, docksRegular: 0, docks: 0 });
      const f = Number(r.flights || 0);
      w.flights += f; w.docks++; if (f > 0) w.docksFlown++; if (f >= 2) w.docksRegular++;
    }
    out[id] = { weeks: Object.values(byWeek).sort((a, b) => a.week.localeCompare(b.week)), source: "usage_weekly.csv" + (extra.length ? " + event rows" : "") };
  }
  res.setHeader("cache-control", "no-store");
  res.json(out);
};
