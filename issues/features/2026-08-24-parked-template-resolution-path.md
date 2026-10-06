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

## Re-encounter (2026-10-01)

On a production box, 7 parked updates were resolved by hand: 5 accepted by
copying, the briefing merged (the template's new "Reaching me" section added to
the box's own briefing), and the personality kept (the stock copy only dropped
user-stated traits). The deploy that followed re-parked the briefing and
personality within minutes, because nothing records that this stock version was
resolved. The `template-updates` health check is back to failing on that box,
and only a recorded resolution clears it. The `normal` priority may be stale:
every box with a customized briefing or personality shows a failing health
check after each deploy until this exists.

## Decision (2026-10-06)

The developer approved building it: `bbx template diff` and `accept` first, and a three-way merge where it applies cleanly. Assigned to the `parked-templates` workstream.
