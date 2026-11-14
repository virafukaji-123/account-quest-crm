const { load, slotTtl, usingRedis } = require("../lib/store");
const { analyse, gameDate, accountIds } = require("../lib/engine");
const briefs = require("../lib/briefs.json");
const drafts = require("../lib/drafts.json");
const answers = require("../lib/answers.json");
const history = require("../lib/history.json");
const { redact } = require("../lib/game");

// Fallback for a surprise account that has no written brief yet, so the page never breaks.
const autoBrief = (a) => ({ tabline: a.story || "New account", headline: a.story || "New account: write-up in progress.", numbers: [], vs: [], risks: a.health.reasons.map((r) => r.text), actions: [], people: (a.contacts.stakeholders || []).map((p) => [p.name + " – " + p.role, p.relationship || ""]) });
const autoAnswers = (a) => ({
  worth: { backed: a.renewal ? [{ deal: "Current contract", id: "renewal", value: a.renewal.label, basis: a.renewal.evidence, ids: ["contract.txt", "profile.json"] }] : [], unbacked: [] },
  power: [{ deal: "Renewal", decides: "Not yet known (new account)", pays: "See invoices.json", uses: "See stakeholders", blocks: "Not yet known", stance: (a.contacts.stakeholders || []).map((p) => [p.name, (p.relationship || "unknown") + ". " + p.role]), ids: ["get_new_account → stakeholders"] }],
  first: [{ rank: 1, move: "New account: read the paperwork, meet the main contact and agree the first move.", owner: "Viraf", by: "within 2 days", deal: "", ids: [] }],
  wrong: a.health.reasons.map((r) => ({ type: "Deal turning bad", what: r.text, turnsBad: "See evidence", ids: [r.evidence] })),
  unknown: (a.contacts.notOnFile || []).map((g) => ({ gap: g, why: "Not on file yet", who: "Main contact", ids: ["profile.json → not_on_file"] })),
});

// Clients added by hand in the CRM (not from the game).
function customClient(s, id, c, today) {
  const lines = (t) => String(t || "").split(/\n+/).map((x) => x.trim()).filter(Boolean);
  const acc = { id, name: c.name, official_story: c.summary || c.stage, stakeholders: c.contactName ? [{ name: c.contactName, role: c.contactRole || "Main contact", relationship: "" }] : [] };
  const overlay = { ...s, paperwork: { ...s.paperwork, [id]: { records: [{ path: "profile.json", data: { currency: c.currency, renewal: { term_ends: c.renewalDate, annual_value: c.annualValue }, flytbase_side: { csm: [{ from: c.termStart || today }] }, not_on_file: lines(c.questions) } }] } } };
  const a = analyse(overlay, id, today, acc);
  const src = "Added in the CRM by " + (c.owner || "the owner") + " (" + String(c.updated || c.created).slice(0, 10) + ")";
  a.custom = true; a.client = c; a.story = acc.official_story;
  a.renewal.auto = c.autoRenew === "Yes"; a.renewal.evidence = src;
  a.fleet = { ...a.fleet, total: c.docks || 0, flyingNow: c.docksFlying ?? 0, never: 0, perDock: [], evidence: src, window: "entered by hand", rule: "Numbers entered by the account owner." };
  const risks = lines(c.risks), contact = [c.contactName, c.contactRole].filter(Boolean).join(" – ");
  a.health = { score: { Green: 0, Amber: 30, Red: 60 }[c.health], rating: c.health, reasons: [{ points: 0, text: "Health set by the account owner", evidence: src }, ...risks.map((r) => ({ points: 0, text: r, evidence: src }))], rule: a.health.rule };
  a.brief = { tabline: c.stage || "Added by hand", headline: c.summary || `${c.name}: ${c.stage || "new client"}.`, numbers: [], vs: [], risks, actions: c.nextStep ? [c.nextStep] : [], people: contact ? [[contact, [c.contactEmail, c.contactPhone].filter(Boolean).join(" · ")]] : [] };
  a.answers = {
    worth: { backed: [{ deal: "Current contract", id: "contract", value: a.renewal.label, basis: `${c.docks ?? "?"} docks. Renewal ${c.renewalDate}${a.renewal.auto ? ", renews automatically" : ", does not renew by itself"}.`, ids: [src] }, ...(c.opportunity ? [{ deal: c.opportunity, id: "opportunity", value: c.opportunityValue ? require("../lib/engine").fmtMoney(c.opportunityValue, c.currency) : "Value not set", basis: "Opportunity entered by the account owner.", ids: [src] }] : [])], unbacked: [] },
    power: [{ deal: "Renewal", decides: c.decisionMaker || "Not recorded yet", pays: "Not recorded yet", uses: contact || "Not recorded yet", blocks: "Not recorded yet", stance: contact ? [[c.contactName, c.contactRole || "Main contact"]] : [], ids: [src] }],
    first: [{ rank: 1, move: c.nextStep || "Agree the first move with the main contact.", owner: c.owner || "Viraf", by: c.nextStepDue || "Not set", deal: "", ids: [src] }],
    wrong: risks.map((r) => ({ type: "Noted risk", what: r, turnsBad: "Not set", ids: [src] })),
    unknown: lines(c.questions).map((q) => ({ gap: q, why: "Open question noted by the account owner.", who: contact || "Main contact", ids: [src] })),
  };
  a.drafts = [];
  return a;
}

// Status: what the owner set, or a suggestion from the numbers until they set one.
function withStatus(s, a) {
  const saved = s.statuses?.[a.id];
  const suggest = a.custom && ["Onboarding", "At risk"].includes(a.client?.stage) ? a.client.stage
    : a.fleet.total && a.fleet.never === a.fleet.total ? "Onboarding"
    : a.renewal && a.renewal.daysLeft <= 120 ? "Due for renewal"
    : a.health.rating === "Red" ? "At risk" : "Active";
  return { ...a, status: saved ? { ...saved, suggested: false } : { status: suggest, suggested: true, history: [] } };
}

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
      return { ...a, brief: briefs[id] || autoBrief(a), answers: answers[id] || autoAnswers(a), drafts: drafts[id] || [] };
    }).concat(Object.entries(s.customClients || {}).map(([id, c]) => customClient(s, id, c, today))).map((a) => withStatus(s, a)),
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
