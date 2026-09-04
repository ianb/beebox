---
title: "A dedicated security scan for leaks between boxes on the same host"
workstream: cross-box-leak-scan
area: beebox
labels: [security]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder ask
---

Boxes on one host (prod runs six under one `callback` user; the dev machine
runs many more) are isolated at the env level, not the OS level — the
security overview says so plainly (`docs/security-overview.md:46`). The ask:
a **specific, repeatable scan for cross-box leakage**, not just the general
security report.

Known cross-box surface already on the books (the scan's seed list, not its
limit):

- `GET /api/task-output` — not box-scoped; a known cross-box read gap on
  multi-box servers (`security-report.md:105`, tracked privately).
- Boxes share one browser origin — accepted single-operator decision
  (`closed/decisions/2026-07-19-boxes-share-one-origin.md`); the scan should
  verify the *server-side* compensations hold (session secret never reaching
  boxes; tested in `test/hub/supervisor.doctest.md`).
- Shared per-user state outside the boxes: `~/.claude` (auto-memory keyed by
  cwd — per-box today, but an upstream keying change would silently merge
  them; see the 2026-08-25 finding), `~/.codex` (the plugin/marketplace
  registration is global and was corrupted cross-checkout on 2026-08-27),
  `~/.config/beebox` (global credentials), the shared event-bus/registry files,
  the hub's routing table, `/tmp`.

What "a scan" should mean here (design questions):

- **Static sweep**: every route handler and CLI command checked for
  box-scoping — does each path derive its box from the authenticated
  context rather than a caller-supplied slug/path? (The task-output gap is
  exactly this class.) Grep-able patterns + a lint may cover the recurring
  cases; the architectural-boundary-lints exploration (2026-07-24) is
  adjacent.
- **Dynamic probe**: a two-box fixture (the makeTestServer multi-box shape)
  where box A's agent/session actively tries to read box B — files, API,
  events, chat history, secrets — and the test asserts every attempt fails.
  This is the regression anchor; the static sweep finds new surface.
- **Host-state audit**: enumerate what on the host is shared between boxes
  (the list above) and assert each is either per-box-keyed or contains
  nothing box-confidential.
- **Cadence**: one-off audit vs a schedule (the security-report skill's
  rubric is the precedent — this could be a section of it, or its own
  `schedules/` job).

Fold-ins: the private task-output item gets fixed or explicitly re-accepted
as part of this; the agent-containment allowed-directories item
(`2026-07-20`) is the write-side sibling (an agent escaping its box root)
and at minimum shares the fixture.

## Built 2026-09-03 (workstream `cross-box-leak-scan`)

- **Dynamic probe**: `beebox/test/webapp/cross-box-probe.doctest.md` on the
  new two-box fixture (`createTwoBoxTestServer`, `test/helpers/test-server.ts`)
  — box A's agent bearer against every read surface of box B. Runs with the
  suite, so the hourly full-suite schedule is its cadence.
- **Static sweep + host audit**: `schedules/cross-box-leak-scan/` (weekly,
  knip-sweep shape: baseline in the state dir, only new lines handed off to an
  adjudicating session). The host audit runs locally and on production over
  SSH when the main checkout has `deploy/server-ip`.
- **Report**: security-report §7b and the rubric's 7b entry.
- **Fixed on the way**: `GET /api/task-output` (now box-scoped; the private
  item is closed), `chatControl.reserveSession` and the raw `/api/chat/send`
  body (`contextDir` now uses the shared box-relative schema), `files.summarize`
  (relative inputs now contained), and
  [listsessionroots-contextdir-no-containment](../closed/bugs/2026-08-26-listsessionroots-contextdir-no-containment.md).
