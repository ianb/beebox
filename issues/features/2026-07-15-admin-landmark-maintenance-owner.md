---
title: "Admin landmark that owns box maintenance (health checks + housekeeping)"
needs: [design]
filed-by: agent
discovered-in: main session — after a local test-box health-check triage, the boxholder wanted a single home for maintenance
area: callback-box
---

Right now box maintenance has no single owner. When the health monitor surfaces a
problem (e.g. the 2026-07-15 local test-box episode: three scheduled tasks stuck
"failing/never-succeeded" — all stale, cleared by re-running through the
scheduler), there's no designated place an agent goes to *do maintenance*: what to
check, how to read `cb health`, when a failure is stale-vs-live, how to clear it,
and what else to sweep. The knowledge is scattered across box CLAUDE.md-equivalents,
per-directory briefings, connector rules, and docs — so each maintenance pass
re-derives it.

**The idea:** a single **admin landmark** plus its agent-facing context (the
boxholder called it "a CLAUDE.md") that is *the* place for maintenance. It's the
one to look at health checks and handle the other periodic housekeeping. Then
**remove the maintenance instructions from the other paths** and point them here —
consolidation, one home instead of N.

### Why a landmark fits

Landmarks are already the box's "notable spots" surface (`docs/landmarks.md`), and
landmark-bound chat sessions run with **cwd = the landmark's directory** — so an
agent opened on the admin landmark lands *in* the maintenance context. The doc
already splits the two audiences we need:

- **`landmark`** (human-facing) — the "Admin / Maintenance" bookmark in the nav
  surface.
- **`briefing`** (agent-facing, `briefing.briefing.card`) — "context every agent
  needs to know about this spot." This is where the maintenance instructions live
  (boxes deliberately don't inherit the repo CLAUDE.md, so in-box the agent-facing
  doc is a briefing card, not a literal CLAUDE.md — worth confirming that's the
  right vehicle vs. something new).

So the shape is likely: an `admin/` (or similarly named) box directory carrying an
`*.landmark.card` (navigation role) + a `briefing.briefing.card` that owns the
maintenance playbook. An agent tasked with "do the maintenance" opens the admin
landmark and has everything.

### What it would own

- **Health checks** — read `cb health`, distinguish stale-vs-live failures, know
  the clear path (re-run the scheduled script via the scheduler so `recordOutcome`
  resets state; don't force agent-invoking procedures just to clear a cosmetic
  flag). Today's test-box triage is the worked example this playbook should
  encode.
- **Scheduled-task hygiene** — disabled/overdue/failing task review; stale run-dir
  cleanup; when the scheduler daemon isn't running for a box.
- **Other periodic housekeeping** — TBD in design, but the box-operational
  counterparts of what a boxholder does by hand: connector health, storage/trash
  sweeps, migration prompts, etc.

### Design questions (why this needs a design pass)

- **Box-level, repo-level, or both?** The trigger was *box* maintenance, and
  landmarks are a box construct — so this is per-box. But "handle other things"
  and "CLAUDE.md" could also mean a repo-side maintenance owner. Note that
  `docs/maintenance.md` already owns **dev/code** maintenance (audits, sweeps, SDK
  updates) and `docs/health-checks.md` owns deployed-server runbooks — this admin
  landmark is the **box-operational** layer, distinct from both. Settle the
  boundary and the cross-links rather than overlapping them.
- **Briefing vs a new vehicle.** Is the maintenance playbook a `briefing` card
  (existing, agent-facing, cwd-bound) or does it want its own construct? Briefing
  seems right; confirm it carries enough (procedures, not just context).
- **Per-box duplication.** If every box gets an admin landmark, the playbook is
  template stock, not hand-written per box — so it flows through the box template
  system (`config/template-versions.json`) like other stock cards. Decide whether
  the admin landmark ships as template stock and how updates roll out.
- **What exactly moves out of "the other paths"** — enumerate the maintenance
  instructions currently scattered in box CLAUDE.md-equivalents / briefings /
  connector rules / docs, and which consolidate here vs. stay. That enumeration is
  the concrete first design step (a `## Research (incomplete)` if pursued).
- **Landmark + destinations role.** A landmark can also carry a `destinations`
  role with a handler procedure (`docs/triage.md`). Could the admin landmark host
  a maintenance *procedure* as its handler, so "run maintenance" is a first-class
  action rather than a prose playbook an agent follows by hand? (Weigh against
  "arrange context, don't automate judgment" — maintenance triage is
  judgment-heavy, so the briefing-playbook form is probably right, with discrete
  procedures for the mechanical bits.)

Related: the health-monitor surfacing that started this
(`docs/scheduler.md` / the scheduled-task health state at
`config/schedules/.state/*.json`), and the consolidation instinct generally
(prefer one home over duplicated instructions).
