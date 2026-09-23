---
title: "Give parked template updates a resolution path (accept / diff / merge) instead of hand-copying"
workstream: unattached
area: beebox
priority: normal
labels: [templates, boxes]
filed-by: agent
discovered-in: honest-diagnostics — split out of the parked-updates health issue
---

`bbx health` and `bbx status` now report parked template updates
(`config/_template-updates/<path>`), and say to copy the file over or delete
it. That is the whole resolution path. The parked copy usually carries other
upstream improvements alongside the fix the boxholder wants, and the local copy
carries the edit that caused the park, so both "accept wholesale" and "keep
local" lose something.

Candidates, roughly in order of cost:

- `bbx template diff <path>` — show local vs parked vs last stock.
- `bbx template accept <path>` — copy over and record the new stock hash.
- A three-way merge (last stock, local, parked) that applies cleanly when the
  local edit and the upstream change touch different regions.
- Box-owned fields (`install-template-file.ts` already has `boxOwnedFields`) so
  a card that only needs a local paragraph does not detach from upstream.

Origin and the measured cost of the missing path:
[parked updates invisible in health](../closed/bugs/2026-08-24-parked-template-updates-are-invisible-in-health.md).

## Two requirements added 2026-09-19

- **Guide cards are merged by a box agent**, per the boxholder's decision in
  [guide-card template updates](../closed/decisions/2026-09-19-guide-card-template-updates-park-forever.md).
  Whatever this builds has to let an agent write the merge and record that the
  box has resolved that version, or every later update re-parks the same copy.
- **An automated rewrite must record what it wrote.** A migration or rename
  that edits a template file in place leaves the tracker's hash stale, so the
  installer reads stale stock as a boxholder edit and parks forever
  ([tracker keys](../closed/bugs/2026-09-19-template-tracker-keys-not-migrated-to-one-root.md),
  second part). On `test1` this hit `refresh-maps` and `process-retrospective`.
