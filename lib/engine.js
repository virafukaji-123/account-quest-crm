// The decision engine. It turns the raw game data into numbers and a health score,
// and every number keeps a pointer to the file (and rows) it came from.

// ---------- small helpers ----------
function parseCSV(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.length > 1 || r[0]);
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}
const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const fmtMoney = (v, cur) => (cur === "GBP" ? "£" : cur === "EUR" ? "€" : "") + Number(v).toLocaleString("en-GB");

// Paperwork records by path, with rows that new events (signals) add merged in.
function filesFor(store, id) {
  const files = {};
  for (const r of store.paperwork?.[id]?.records || []) files[r.path] = { kind: r.kind, text: r.text, data: r.data, added: [] };
  const sigs = (store.signals?.data?.signals || []).filter((s) => s.account === id);
  for (const s of sigs) for (const rec of s.records || []) {
    const p = rec.path.replace(new RegExp(`^${id}/`), "");
    if (p.endsWith(".csv") && files[p]) files[p].added.push({ signal: s.id, text: rec.text });
    else files[p] = { kind: rec.kind, text: rec.text, added: [], fromSignal: s.id };
  }
  return files;
}
function csvRows(files, p) {
  const f = files[p]; if (!f?.text) return [];
  const base = parseCSV(f.text).map((r) => ({ ...r, _src: p }));
  const extra = f.added.flatMap((a) => parseCSV(a.text).map((r) => ({ ...r, _src: `${p} (+ event ${a.signal})` })));
  // newer rows replace older rows with the same key
  let n = 0;
  const key = (r) => r.week_start && r.dock_id ? r.week_start + "|" + r.dock_id
    : r.request_id && r.request_id !== "(none)" ? r.request_id
    : r.request_id ? JSON.stringify([r.opened, r.summary]) : n++;
  const m = new Map(); [...base, ...extra].forEach((r) => m.set(key(r), r));
  return [...m.values()];
}

// ---------- the analysis ----------
function gameDate(store) {
  const real = new Date().toISOString().slice(0, 10);
  const dated = (store.signals?.data?.signals || []).map((s) => s.dated).filter(Boolean).sort();
  return dated.length && dated[dated.length - 1] > real ? dated[dated.length - 1] : real;
}
function analyse(store, id, today = gameDate(store)) {
  const acc = (store.accounts?.data?.accounts || []).find((a) => a.id === id) || { id, name: "Account " + id };
  const files = filesFor(store, id);
  const profile = files["profile.json"]?.data || {};
  const sigs = (store.signals?.data?.signals || []).filter((s) => s.account === id);
  const reasons = [];
  const add = (points, text, evidence) => reasons.push({ points, text, evidence });

  // 1. Renewal
  const renewal = profile.renewal ? {
    date: profile.renewal.term_ends, value: profile.renewal.annual_value, currency: profile.currency,
    label: fmtMoney(profile.renewal.annual_value, profile.currency) + " a year",
    daysLeft: days(today, profile.renewal.term_ends), auto: false,
    evidence: "profile.json → renewal; contract.txt → 'No automatic renewal'",
  } : null;
  if (renewal && renewal.daysLeft <= 120) add(10, `Renewal is ${renewal.daysLeft} days away and does not renew by itself`, renewal.evidence);

  // 2. Fleet use (weekly usage, last 4 weeks on file, including rows added by new events)
  const usage = csvRows(files, "usage_weekly.csv");
  const weeks = [...new Set(usage.map((r) => r.week_start))].sort();
  const last4 = weeks.slice(-4), prev4 = weeks.slice(-8, -4), last2 = weeks.slice(-2);
  const docks = [...new Set(usage.map((r) => r.dock_id))].sort();
  const sum = (d, ws) => usage.filter((r) => r.dock_id === d && ws.includes(r.week_start)).reduce((t, r) => t + Number(r.flights || 0), 0);
  const events = csvRows(files, "device_events.csv");
  const lastWeekEnd = last4.length ? new Date(new Date(last4[last4.length - 1]).getTime() + 6 * 86400000).toISOString().slice(0, 10) : today;
  const inMaintenance = (d) => {
    const ev = events.filter((e) => e.dock_id === d && /aircraft_removed_for_maintenance|aircraft_returned/.test(e.event) && e.date <= lastWeekEnd);
    const lastEv = ev[ev.length - 1];
    const firstWindowDay = prev4[0] || last4[0];
    return !!lastEv && (lastEv.event === "aircraft_removed_for_maintenance" || lastEv.date >= (last2[0] || firstWindowDay)) && ev.some((e) => e.event === "aircraft_removed_for_maintenance" && e.date >= firstWindowDay);
  };
  const perDock = docks.map((d) => {
    const recent = sum(d, last4), before = sum(d, prev4), ever = sum(d, weeks), lastTwo = sum(d, last2);
    const maint = inMaintenance(d);
    const status = ever === 0 ? "never flown" : maint && recent / 4 < 2 ? "in maintenance" : recent / 4 >= 2 ? "regular" : recent > 0 ? "occasional" : "idle";
    const stopped = !maint && before / 4 >= 2 && lastTwo === 0;
    const flyingNow = lastTwo / Math.max(1, last2.length) >= 2;
    return { dock: d, recent, before, ever, lastTwo, status, stopped, flyingNow };
  });
  const count = (s) => perDock.filter((d) => d.status === s).length;
  const fleet = {
    total: docks.length, flyingNow: perDock.filter((d) => d.flyingNow).length, maintenance: count("in maintenance"), regular: count("regular"), occasional: count("occasional"), idle: count("idle"), never: count("never flown"),
    stopped: perDock.filter((d) => d.stopped).map((d) => d.dock),
    window: last4.length ? `weeks starting ${last4[0]} to ${last4[last4.length - 1]}` : "no usage data yet",
    rule: "Flying now = 2+ flights a week over the last 2 weeks on file. Regular = 2+ a week over the last 4 weeks. Stopped = regular in the 4 weeks before, zero in the last 2, and not away for maintenance (device_events.csv).",
    evidence: "usage_weekly.csv" + (files["usage_weekly.csv"]?.added.length ? " + rows from event " + files["usage_weekly.csv"].added.map((a) => a.signal).join(", ") : ""),
    perDock,
  };
  if (fleet.total) {
    const share = fleet.flyingNow / fleet.total;
    if (share < 0.5) add(25, `Only ${fleet.flyingNow} of ${fleet.total} docks are flying regularly right now`, fleet.evidence);
    else if (share < 0.75) add(10, `${fleet.flyingNow} of ${fleet.total} docks are flying regularly right now`, fleet.evidence);
    if (fleet.never) add(5, `${fleet.never} dock(s) have never flown since install`, fleet.evidence);
    if (fleet.stopped.length) add(Math.min(20, 10 * fleet.stopped.length), `${fleet.stopped.length} busy dock(s) suddenly stopped flying: ${fleet.stopped.join(", ")}`, fleet.evidence);
  }

  // 3. Relationships
  const calls = files["calls_index.json"]?.data?.calls || [];
  const handover = profile.flytbase_side?.csm?.[0]?.from || "2026-05";
  const recentCalls = calls.filter((c) => c.date >= handover);
  const people = [...new Set(recentCalls.flatMap((c) => c.customer || []))];
  const contacts = {
    stakeholders: (acc.stakeholders || []).map((p) => ({ name: p.name, role: p.role, relationship: p.relationship })),
    callsSinceHandover: recentCalls.length, peopleOnThoseCalls: people,
    notOnFile: profile.not_on_file || [],
    evidence: "calls_index.json (calls since " + handover + "), profile.json → not_on_file",
  };
  if (recentCalls.length && people.length === 1) add(15, `All ${recentCalls.length} calls since ${handover} were with one person: ${people[0]}`, contacts.evidence);
  const leaving = sigs.find((s) => /leav|moving on|moves on/i.test(s.title + s.summary) && !/deadline/i.test(s.id));
  const deputyDeadline = (acc.deadlines || []).find((d) => /leaves/i.test(d.text) && !d.passed);
  if (leaving) add(20, leaving.summary.split(". ")[0] + ".", `event ${leaving.id} (${leaving.dated})`);
  if (deputyDeadline) add(15, deputyDeadline.text, "get_my_accounts → deadlines");

  // 4. Open requests nobody owns
  const reqs = csvRows(files, "requests.csv").filter((r) => /open/i.test(r.status));
  const unowned = reqs.filter((r) => !r.owner).map((r) => ({ id: r.request_id, opened: r.opened, age: Math.max(0, days(r.opened, today)), from: r.from, summary: r.summary, src: r._src }));
  if (unowned.length) add(Math.min(15, 5 * unowned.length), `${unowned.length} open request(s) with no owner, oldest ${Math.max(...unowned.map((u) => u.age))} days`, "requests.csv" + (unowned.some((u) => /event/.test(u.src)) ? " + new event rows" : ""));

  // 5. Claims vs checked facts
  const facts = acc.facts || [];
  const claims = { claim: facts.filter((f) => f.status === "claim"), told: facts.filter((f) => f.status === "told"), verified: facts.filter((f) => f.status === "verified") };
  if (claims.claim.length > claims.verified.length) add(10, `${claims.claim.length} big claims are unchecked; only ${claims.verified.length} fact(s) are verified`, "get_my_accounts → facts (status)");

  // Score
  const score = reasons.reduce((t, r) => t + r.points, 0);
  const rating = score >= 50 ? "Red" : score >= 20 ? "Amber" : "Green";

  return {
    id, name: acc.name, story: acc.official_story, today, renewal, fleet, contacts,
    openRequests: unowned, claims, events: sigs.map((s) => ({ id: s.id, dated: s.dated, title: s.title, summary: s.summary, records: s.records })),
    opportunities: acc.opportunities || [], offers: acc.offers || [], facts,
    health: { score, rating, reasons, rule: "Each warning sign adds risk points. Under 20 = Green, 20–49 = Amber, 50 or more = Red." },
  };
}
module.exports = { analyse, parseCSV, gameDate };
