---
title: "Feedback collection has no cadence — items rot before review"
area: callback-box
filed-by: agent
discovered-in: main session — while reviewing accumulated box feedback (all 9 items stale)
---

Box agents (and users, via them) file feedback with `cb feedback` into each box's
`config/feedback/`. But `feedback-review/collect.ts` — the only thing that
surfaces it — is a manual pull wired to NOTHING: no deploy hook, no schedule, no
dashboard. So it only runs when someone remembers, and by then everything in it
is stale.

Concretely (2026-07-14 review): 9 accumulated items, dated 2026-05-16 →
2026-06-12 (1–2 months old). EVERY one was already shipped, retired, or
superseded by the time it was read — the voice cluster's asks (wake-lock,
earcons, recording-drop signal, partial-transcript persistence) all landed after
filing; `cb describe-images` was retired in the capture-mode rework; the `cb mv`
ref-rewriter was rebuilt. All 9 resolved with zero action. The items weren't the
problem — the two-month latency was. Feedback only has value reviewed in the days
after it's filed.

Make collection prompt. Options (not yet decided):

- Run `collect.ts` on each deploy (post-deploy) and surface the unresolved count
  — print it, or a fail-soft notify — so a fresh item is seen within a day.
- A lightweight scheduled nudge (`cb tick` / cron) reporting new unresolved feedback.
- Surface unresolved feedback in a `/main/dev/` view (like the planned
  issue-browser / the docs browser), so it's glanceable.
- At minimum, have `cb feedback` confirm to the boxholder inline when an item is
  filed, instead of silently committing.

Related bugs surfaced in the same review (context, not blockers):

- **`cb feedback` captures the WRONG session's context.** The two earcon items
  showed a day-old, unrelated `refresh-maps` procedure as their "Session
  Context." Makes feedback harder to trust/act on. STILL OPEN.
- **`collect.ts` counted `config/feedback/CLAUDE.md`/`MAP.md` as feedback**
  (would have been swept into `resolved/` by `--resolve-all`). FIXED in commit
  b6638070 — filter to the timestamp-named `cb feedback` filename shape.
- **`collect.ts`'s LOCAL scan may miss v2 boxes** — `findLocalBoxes` checks for a
  `.cb-box` marker at the box root, but a v2 box's operational tree is under
  `content/`; the 2026-07-14 run only surfaced `remote:` items, never local.
  Unverified — worth a look (the remote path is the source of truth, so low
  urgency).
