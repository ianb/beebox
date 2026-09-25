---
title: "The one-root migration left template-tracker keys on pre-one-root paths, so every tracked procedure update parks"
workstream: refresh-maps-correctness
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: refresh-maps-correctness (worktree-refresh-maps-correctness), fixing the pre-one-root procedure templates
resolution: implemented
---

> Closed by `b2ae1028f` (re-key the template tracker onto v3 paths).
> `beebox/scripts/migrate/rekey-template-versions.ts` fixes part 1 (the key
> rename). Part 2 (an automated rewrite leaving the recorded hash stale) is
> not fixed here — it is recorded as a requirement on
> [parked template resolution](../../features/2026-08-24-parked-template-resolution-path.md),
> which stays open.

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

Two parts. The first is fixed by
`scripts/migrate/rekey-template-versions.ts`: a key whose file exists is kept
(this protects `src/…` keys, which `mapV2Path` would wrongly send under
`_content/`), a key whose file is missing is re-keyed when its v3 path exists
(later `installed-at` wins a collision), and anything else is dropped,
including keys that escape the box — `test1` carried
`../src/views/CLAUDE.md`.

The second part remains open: an automated edit (a migration, or the rename
that rewrote the CLI command name inside box copies) changes a template's bytes
without updating the recorded hash, so the installer later reads stale stock
as a boxholder edit and parks every update. On `test1`, `refresh-maps` and
`process-retrospective` matched no shipped hash for that reason and were
force-accepted by hand. Deciding how an automated rewrite should record its
result is tracked with the rest of the parked-template work.

Related: [parked template resolution](../../features/2026-08-24-parked-template-resolution-path.md).
