// Set an account's status (owner only, needs ADMIN_KEY). Keeps a short history of changes.
const { load, save } = require("../lib/store");
const { accountIds } = require("../lib/engine");
const STATUSES = ["Onboarding", "Active", "Expansion in progress", "Due for renewal", "Renewal in negotiation", "Renewed", "At risk", "On hold", "Churned"];
module.exports = async (req, res) => {
  if (!process.env.ADMIN_KEY || req.headers["x-admin-key"] !== process.env.ADMIN_KEY) return res.status(401).json({ error: "Read-only view. Changing status needs the owner's key." });
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { account, status, note } = req.body || {};
  const s = await load();
  if (![...accountIds(s), ...Object.keys(s.customClients || {})].includes(account)) return res.status(400).json({ error: "Unknown account." });
  if (!STATUSES.includes(status)) return res.status(400).json({ error: "Unknown status." });
  s.statuses = s.statuses || {};
  const prev = s.statuses[account];
  const entry = { status, note: String(note || "").trim().slice(0, 500), at: new Date().toISOString() };
  s.statuses[account] = { ...entry, history: [entry, ...(prev?.history || [])].slice(0, 10) };
  await save(s);
  res.json({ saved: account, status });
};
module.exports.STATUSES = STATUSES;
