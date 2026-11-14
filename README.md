# Account Quest CRM

A small CRM for the **Account Quest** questathon. It looks at two FlytBase accounts (a police alliance and an industrial group), works out what is *really* going on behind the "everything is fine" story, and turns it into a renewal plan you can defend.

**For whom:** the customer success manager who has just inherited both accounts, and anyone (a manager, a judge) who needs to see why an account is at risk without reading 200 files.

## What it shows for each account

1. **How healthy is it?** A risk score with every point explained and linked to its source.
2. **What is really going on?** What the customer says next to what the data shows.
3. **Who matters and who is missing?** People, their role, and the gaps.
4. **What could stop the renewal?** The biggest risk points.
5. **What do we do next?** Concrete, dated actions.

Every headline number has a **"trace this number"** link that opens the exact rows it was calculated from.
New game events are picked up automatically and the numbers are recalculated.

## How it decides

The engine is in [`lib/engine.js`](lib/engine.js). It reads the game's paperwork (usage, calls, requests, device events, contract) and merges in rows from new events. Then it adds **risk points**:

| Warning sign | Points | Source |
|---|---|---|
| Fewer than half the docks flying regularly now (2+ flights a week, last 2 weeks) | +25 | usage_weekly.csv |
| 50–75% of docks flying regularly | +10 | usage_weekly.csv |
| A dock has never flown since install | +5 | usage_weekly.csv |
| A busy dock suddenly stopped (and is not away for maintenance) | +10 each, max 20 | usage_weekly.csv, device_events.csv |
| Every call since handover was with one person | +15 | calls_index.json |
| The main contact is leaving | +20 | game events |
| A key person is leaving with know-how not written down | +15 | deadlines |
| Open requests nobody owns | +5 each, max 15 | requests.csv |
| More unchecked claims than verified facts | +10 | facts |
| Renewal within 120 days, not automatic | +10 | profile.json, contract.txt |

**Under 20 = Green, 20–49 = Amber, 50+ = Red.**

The written summaries (headline, "they say / evidence shows", people, actions) are in `lib/briefs.json`. They were drafted with AI from the same paperwork and checked by hand.

## How it talks to the game

- The game allows **one call a minute per token**. Every answer is saved (Upstash Redis on Vercel, a local file on a laptop), and pages read from the store, never from the game directly.
- Any open page asks `/api/refresh` every 20 seconds. A shared lock lets **at most one game call per minute** through, whoever is visiting. It fetches accounts and paperwork first, then checks for new events.
- The game token (`AQ_TOKEN`) lives only in a server environment variable. It is never sent to the browser.
- The public page is **read-only**. Sending notes to the game needs the owner's `ADMIN_KEY` (open the site once with `?key=...`).

## Run it

**On Vercel (hosted)**
1. Import this repo into Vercel.
2. Storage → Create → **Upstash for Redis** (free) → connect it to the project.
3. Settings → Environment Variables: `AQ_TOKEN` (your game token) and `ADMIN_KEY` (any password you choose).
4. Redeploy.

**On a laptop**
```
set AQ_TOKEN=your-token        (PowerShell: $env:AQ_TOKEN="your-token")
node dev.js
```
Open http://localhost:3000. No packages to install.

## What it does not do yet

- The written summaries and five answers are partly hand-checked text. If a new event changes the story, the numbers update at once but the wording needs a human edit.
- It cannot tell which dock sits at which force or plant, because that list is not in the data. Usage is per dock, not per site.
- One call a minute means a fresh deploy takes about 4 minutes to load everything.
- No login: there is one owner key, not separate users.
