---
title: "No automated backup story for server box data"
area: callback-box
filed-by: agent
discovered-in: worktree-security-report — operational inventory for the security report
---

The deployed server has no first-class backup mechanism.
`docs/server-operations.md` defers to "whatever backup mechanism is
currently configured for the server"; git-annexed assets are
`numcopies: 1` with no annex remote (`docs/assets.md`); only migrations
take a tar snapshot, scoped to that operation. A box's git remote (the
one `cb wakeup` pushes to) is operator-chosen and optional — boxes
without one have exactly one copy of their history, and annexed media
has one copy regardless.

Single-disk-loss on the VPS could be unrecoverable for anything not
covered by an operator's own remote. The decision: what is the blessed
backup story — mandatory per-box git remotes plus an annex special
remote? VPS-level disk snapshots? Documented as the operator's problem
with a checklist? The security report lists this as an accepted risk
until decided.
