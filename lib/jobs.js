// Decides which single game call to make next (at most one a minute, shared by every visitor).
const { load, save, takeSlot, slotTtl } = require("./store");
const { callTool } = require("./game");

const age = (iso) => (iso ? (Date.now() - new Date(iso)) / 1000 : Infinity);

function nextJob(s) {
  if (s.noteQueue.length) return { label: "write_note", run: async () => { const n = s.noteQueue[0]; const res = await callTool("write_note", n); s.noteQueue.shift(); s.notesSent.unshift({ ...n, at: new Date().toISOString(), response: res }); } };
  if (!s.accounts) return { label: "get_my_accounts", run: async () => (s.accounts = { at: new Date().toISOString(), data: await callTool("get_my_accounts") }) };
  for (const id of ["A", "B"]) if (!s.paperwork[id]) return { label: `get_all_paperwork ${id}`, run: async () => (s.paperwork[id] = { ...(await callTool("get_all_paperwork", { account: id })), at: new Date().toISOString() }) };
  if (age(s.accounts.at) > 900 && age(s.signals?.at) < 300) return { label: "get_my_accounts", run: async () => (s.accounts = { at: new Date().toISOString(), data: await callTool("get_my_accounts") }) };
  return { label: "get_signals", run: async () => {
    // Keep every event ever seen: a CRM should not forget history if the game stops listing it.
    const known = s.signals?.data?.signals || [];
    const before = new Set(known.map((x) => x.id));
    const incoming = (await callTool("get_signals"))?.signals || [];
    const fresh = incoming.filter((x) => !before.has(x.id)).map((x) => x.id);
    const merged = [...known.map((x) => incoming.find((y) => y.id === x.id) || x), ...incoming.filter((x) => !before.has(x.id))];
    s.signals = { at: new Date().toISOString(), data: { signals: merged } };
    if (fresh.length) s.newEvents = [...fresh.map((id) => ({ id, seen: new Date().toISOString() })), ...(s.newEvents || [])].slice(0, 20);
  } };
}

async function tick() {
  if (!(await takeSlot(61))) return { called: null, nextInSeconds: await slotTtl() };
  const s = await load();
  const job = nextJob(s);
  try { await job.run(); s.log.unshift({ at: new Date().toISOString(), call: job.label, ok: true }); }
  catch (e) { s.log.unshift({ at: new Date().toISOString(), call: job.label, ok: false, error: e.message }); }
  s.log = s.log.slice(0, 50); s.lastCallAt = Date.now();
  await save(s);
  return { called: job.label, nextInSeconds: 61 };
}
module.exports = { tick };
