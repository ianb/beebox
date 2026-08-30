---
title: "In-box analytics the box itself can use to optimize itself — clicks, agent activity, the typical stuff"
workstream: unattached
area: beebox
needs: [design]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "we should have analytics inside the box that the box itself can use"
---

The box should collect its own analytics — the typical stuff: clicks and other
UI interaction, agent information (what ran, what it touched, what it cost) —
**inside the box, as data the box's own agent can read and act on** to
optimize itself. Not product telemetry shipped to a vendor; an instrument the
box turns on itself, the way the retro/observer machinery already turns the
box's chats on itself.

What partially exists, none of it click-level and none of it unified:

- `src/core/usage.ts` — token usage from agent sessions aggregated into
  `.beebox/usage.db` (SQLite, rebuildable, not git-tracked), fed by
  `store/usage/session-manifest.jsonl`. Agent cost data, no UI data.
- `bin/test-ledger.ts` — the dev-repo precedent for "collect the denominator
  now; the questions come later." Green runs recorded because failure *rates*
  need them. The same argument applies to clicks: a click stream is impossible
  to reconstruct later.
- [doc usage mining](../exploration/2026-05-28-doc-usage-mining.md) — agent
  Read patterns mined from session JSONL, no instrumentation needed. The
  agent-side half of this idea, for one corpus (docs).
- The retro/observer machinery — the existing shape for "the box looks at its
  own behavior and proposes changes"; an analytics store would be one more
  input to it.

Design questions (the reason for `needs: [design]`):

- **What's collected.** UI events (clicks, navigations, dwell, search queries
  that got no click), agent events (runs, tools, files touched, models, cost,
  outcomes), or both under one schema? Where's the line before it becomes
  surveillance of the boxholder rather than an instrument for them?
- **Where it lives.** `.beebox/` SQLite beside `usage.db` (per-checkout,
  not synced) vs something git-tracked/aggregated. The chat-review journal's
  machine-local-vs-shared tension applies here too.
- **Who reads it and how.** The box agent on demand? A scheduled
  retro-style pass that turns "nobody has clicked X in a month" /
  "the agent re-reads Y every session" into proposals? Arrange context for
  judgment, don't build an auto-applier (standing preference).
- **Privacy/consent surface.** It's the boxholder's own box, but a family
  shares some boxes; per-user event attribution needs a decision.

Boxholder refinements (2026-08-26, same session):

- **Standard representations over standard infrastructure.** Prefer event
  shapes an agent already understands from the wider world — the value is the
  agent reading a familiar schema, not adopting an analytics vendor's
  collection stack. If the standard tooling itself turns out useful, fine —
  "who knows" — but it isn't the goal. Survey candidates at design time (e.g.
  the self-describing web-analytics event schemas, OpenTelemetry-style event
  records) and judge them by agent legibility, not ecosystem.
- **Don't copy canonical data into the analytics store.** Chat logs and git
  changes are already the box's canonical records; interleaving them into an
  event stream would duplicate them non-canonically — an efficiency problem
  and an ownership/privacy one (information stored where its owner doesn't
  expect it, outliving its canonical copy's deletion). Analytics should hold
  the events that have no other home (clicks, views, dwell) and *reference*
  canonical records (a session id, a commit sha) rather than embed them. The
  read side joins; the store does not.

The self-optimization loop is the point: collection without a reader is
telemetry theater. The first consumer should probably be named in the same
plan that adds collection.
