---
title: "The one-root migration left template-tracker keys on pre-one-root paths, so every tracked procedure update parks"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: refresh-maps-correctness (worktree-refresh-maps-correctness), fixing the pre-one-root procedure templates
---

`_config/template-versions.json` records the stock hash `installTemplateFile`
last installed for each template, keyed by box-relative path. The one-root
migration moved the files (`config/procedures/X` to `_config/procedures/X`)
but did not rename the keys. On the worktree clone of `test1` (2026-09-19):

```
config/procedures/process-retrospective.procedure.card   sha256 219cdaf2…  (2026-07-19)
config/procedures/view-card-shape.procedure.card          sha256 170cd683…
_config/procedures/view-card-shape.procedure.card         sha256 9623752f…  (reinstalled 2026-09-12)
```

A lookup under the v3 path finds no entry, so the installer treats the box as
untracked. With no `priorStockHashes` for that file (only `refresh-maps` has
any, `src/core/box/defaults.ts`), every changed template parks under
`_config/_template-updates/`.

Renaming the keys alone would not unpark `test1`: its live
`process-retrospective` (`545bbe5b…`) differs from the recorded `219cdaf2…`.
It still calls the pre-rename CLI command and names the pre-rename state
directory, so later
migrations or the rename edited the file without updating the tracker. The
installer then reads it as a boxholder edit.

Two parts:

1. A migration that renames tracker keys with `mapV2Path`
   (`src/core/migrations/one-root-mapping.ts`), keeping the newer entry where
   both keys exist.
2. A decision on how an automated edit (a migration or rename that rewrote a
   template file) should update the recorded hash, so it is not read as a
   human edit later.

Related: [parked template resolution](../features/2026-08-24-parked-template-resolution-path.md).
