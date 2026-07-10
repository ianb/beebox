---
title: "stale image refs after renames"
needs: [design]
area: callback-box
---

Surfaced during the attach-layout migration test on the ledger box. Many archived capture-session cards reference their image children by the original `photo-NNN.image.card` form, but agents renamed those image cards to descriptive forms long ago (`photo-001-arrow-invoice.image.card`, etc.) without updating the session card's `<image-ref>` entries. ~1,166 broken refs on ledger trace back to this pattern.

The renames probably came from `cb mv` (or agent-issued renames) on the image cards alone, without touching the session card pointing at them. `cb mv` does rewrite cross-card refs, so a single rename via `cb mv` SHOULD propagate. Suggests this happened either before `cb mv`'s rewrite pass existed, or the renames bypassed `cb mv` (agents writing direct file moves, or using filesystem mv).

Catching it:

- `cb validate` already reports broken refs — but the noise level on ledger is high enough that the user hasn't acted on these. Maybe the validator could surface a stale-ref count summary at the top, and/or fail with non-zero exit when broken-ref count grows.
- A pre-commit hook could check that any commit touching an image card also updates any session card referencing it (or just refuses commits that introduce broken refs).
- A periodic cleanup job in wakeup could try to repair: for each broken ref pointing at `<old>.image.card`, look for an image card in the same dir whose `<filename>` matches the basename and the session's apparent ordering, and offer to repair.
