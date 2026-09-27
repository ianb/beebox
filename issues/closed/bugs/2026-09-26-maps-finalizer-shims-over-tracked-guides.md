---
title: "The maps finalizer plants a MAP-include shim where a tracked CLAUDE.md guide belongs, so the guide never installs and its updates park forever"
workstream: unattached
area: beebox
labels: [maps, templates, box-guidance]
filed-by: agent
discovered-by: agent
discovered-in: worktree-doc-structure — verifying the 2026-09-26 engine release on production boxes
resolution: implemented
---

Closed 2026-09-26 by commit a3b7aa701 (worktree-doc-structure): the finalizer skips
directories whose `CLAUDE.md` is a tracked registry row and strips a leading
include it finds there; the guidance sync strips the same before the tracker
compares. Doctest in `test/core/box-guidance-sync.doctest.md`.

`ensureClaudeMdInDir` (`beebox/src/core/maps/finalize.ts:95-118`) writes a
one-line `CLAUDE.md` holding only the MAP include into every directory that gets a `MAP.md`, or
inserts the include line at the top of an existing one. Some of those
directories are homes of a tracked guide in `GUIDANCE_SURFACES`
(`beebox/src/core/box/guidance-surfaces.ts`): `_config/feedback/`,
`src/schemas/`, `src/views/`, `src/tricks/scripts/`.

Two failure shapes, both seen on production boxes on 2026-09-26:

1. The shim arrives first. `_config/feedback/CLAUDE.md` on three boxes was the
   bare MAP include line; the feedback guide had never installed because the
   tracker (`install-template-file.ts`) saw a file that was not stock and parked
   the guide under `_config/_template-updates/`. The guide stayed parked for
   months.
2. The guide is there and the shim is prepended. `src/tricks/scripts/CLAUDE.md`
   on one box and `src/schemas/CLAUDE.md`, `src/views/CLAUDE.md` on another
   started with the MAP include line above stock text. The file's hash no longer matched
   any stock hash, so every later stock rewrite parked.

Both were resolved by hand on 2026-09-26 (accept the parked copy, keep the
include line on top). The engine will recreate the state on the next
`refresh-maps` run that touches one of those directories.

## Direction

Pick one, in `finalize.ts`:

- Skip directories whose `CLAUDE.md` is a registry row of class `tracked`
  (`guidanceSurfaceFor(relPath)`); the guide already tells an agent where it is,
  and the map can be referenced from the guide's box-conventions section.
- Or keep the include but make the tracker blind to it: an `installTemplateFile`
  `normalize` that strips a leading MAP include line before hashing, for the
  tracked guide rows. This keeps both surfaces but adds a special case to the
  tracker.

The first is simpler and matches the one-class-per-surface rule in
`beebox/docs/box-guidance.md`. Either way, `test/core/box-guidance-sync.doctest.md`
should gain a case that runs the finalizer over a box with a tracked guide and
asserts the guide still matches stock afterwards.
