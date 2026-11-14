// Add, edit or delete a client by hand (owner only, needs ADMIN_KEY). Saved with the rest of the CRM data.
const { load, save } = require("../lib/store");
const { accountIds } = require("../lib/engine");
const TEXT = ["name", "sector", "stage", "health", "owner", "contactName", "contactRole", "contactEmail", "contactPhone", "decisionMaker", "currency", "termStart", "renewalDate", "autoRenew", "opportunity", "nextStep", "nextStepDue", "risks", "questions", "summary"];
const NUM = ["annualValue", "docks", "docksFlying", "opportunityValue"];
module.exports = async (req, res) => {
  if (!process.env.ADMIN_KEY || req.headers["x-admin-key"] !== process.env.ADMIN_KEY) return res.status(401).json({ error: "Read-only view. Adding clients needs the owner's key." });
  const s = await load();
  s.customClients = s.customClients || {};
  if (req.method === "DELETE") {
    const id = (req.body || {}).id;
    if (!s.customClients[id]) return res.status(404).json({ error: "No such client." });
    delete s.customClients[id]; await save(s); return res.json({ deleted: id });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "POST or DELETE only" });
  const b = req.body || {}, c = {};
  for (const k of TEXT) c[k] = String(b[k] ?? "").trim().slice(0, k === "risks" || k === "questions" || k === "summary" ? 2000 : 300);
  for (const k of NUM) c[k] = b[k] === "" || b[k] == null ? null : Number(b[k]);
  if (!c.name) return res.status(400).json({ error: "Client name is required." });
  if (!(c.annualValue > 0)) return res.status(400).json({ error: "Contract value per year must be a number above 0." });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.renewalDate)) return res.status(400).json({ error: "Renewal date is required." });
  if (c.docksFlying != null && c.docks != null && c.docksFlying > c.docks) return res.status(400).json({ error: "Docks flying cannot be more than total docks." });
  if (!["GBP", "EUR", "USD", "INR"].includes(c.currency)) c.currency = "GBP";
  if (!["Green", "Amber", "Red"].includes(c.health)) c.health = "Green";
  let id = b.id && s.customClients[b.id] ? b.id : null;
  if (!id) { const used = new Set([...accountIds(s), ...Object.keys(s.customClients)]); let n = 1; while (used.has("C" + n)) n++; id = "C" + n; c.created = new Date().toISOString(); }
  else c.created = s.customClients[id].created;
  c.updated = new Date().toISOString();
  s.customClients[id] = c;
  await save(s);
  res.json({ saved: id });
};
