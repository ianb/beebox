---
title: "Feedback collection has no cadence — items rot before review"
workstream: unknown
area: beebox
filed-by: agent
discovered-in: main session — while reviewing accumulated box feedback (all 9 items stale)
priority: normal
---

Box agents (and users, via them) file feedback with `bbx feedback` into each box's
`config/feedback/`. But `feedback-review/collect.ts` — the only thing that
surfaces it — is a manual pull wired to NOTHING: no deploy hook, no schedule, no
dashboard. So it only runs when someone remembers, and by then everything in it
is stale.

Concretely (2026-07-14 review): 9 accumulated items, dated 2026-05-16 →
2026-06-12 (1–2 months old). EVERY one was already shipped, retired, or
superseded by the time it was read — the voice cluster's asks (wake-lock,
earcons, recording-drop signal, partial-transcript persistence) all landed after
filing; `bbx describe-images` was retired in the capture-mode rework; the `bbx mv`
ref-rewriter was rebuilt. All 9 resolved with zero action. The items weren't the
problem — the two-month latency was. Feedback only has value reviewed in the days
after it's filed.

Make collection prompt. Options (not yet decided):

- Run `collect.ts` on each deploy (post-deploy) and surface the unresolved count
  — print it, or a fail-soft notify — so a fresh item is seen within a day.
- A lightweight scheduled nudge (`bbx tick` / cron) reporting new unresolved feedback.
- Surface unresolved feedback in a `/main/dev/` view (like the planned
  issue-browser / the docs browser), so it's glanceable.
- At minimum, have `bbx feedback` confirm to the boxholder inline when an item is
  filed, instead of silently committing.

Related bugs surfaced in the same review (context, not blockers):

- **`bbx feedback` captures the WRONG session's context.** The two earcon items
  showed a day-old, unrelated `refresh-maps` procedure as their "Session
  Context." Makes feedback harder to trust/act on. STILL OPEN.
- **`collect.ts` counted `config/feedback/CLAUDE.md`/`MAP.md` as feedback**
  (would have been swept into `resolved/` by `--resolve-all`). FIXED in commit
  b6638070 — filter to the timestamp-named `bbx feedback` filename shape.
- **`collect.ts`'s LOCAL scan may miss v2 boxes** — `findLocalBoxes` checks for a
  `.bbx-box` marker at the box root, but a v2 box's operational tree is under
  `content/`; the 2026-07-14 run only surfaced `remote:` items, never local.
  Unverified — worth a look (the remote path is the source of truth, so low
  urgency).

## Next-action note (2026-10-06)

A `do-it` request was set. Changed to `discuss`: the issue lists four options and picks none. The smallest is a weekly schedule that runs `feedback-review/collect.ts` and reports the unresolved count (about 40-80 lines in `schedules/`, no deploy). Open questions: which option; schedule or post-deploy hook; and how a schedule reaches the production feedback, since `collect.ts` needs the server address that only the main checkout has.

## Decision (2026-10-06)

A local schedule in this monorepo (`schedules/`, run by `bin/schedules`), not a box schedule, pulls the production feedback in. It replaces the hand-run `feedback-review/collect.ts` step.
