// Queue a note for the game. Only the owner (with ADMIN_KEY) can do this; judges get a read-only view.
const { load, save } = require("../lib/store");
module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.ADMIN_KEY || req.headers["x-admin-key"] !== process.env.ADMIN_KEY) return res.status(401).json({ error: "Read-only view. Notes need the owner's key." });
  const { account, kind, title, text } = req.body || {};
  if (!["A", "B"].includes(account) || !text) return res.status(400).json({ error: "account (A or B) and text are required" });
  const s = await load();
  s.noteQueue.push({ account, kind: kind || "note", title: title || "", text });
  await save(s);
  res.json({ queued: true, position: s.noteQueue.length });
};
