---
title: "bbx doctor annex passes green on a half-migrated box whose .gitignore still hides all assets"
workstream: unknown
area: beebox
filed-by: agent
discovered-in: main session — a clerk page-save 500'd; several boxes found half-migrated
resolution: implemented
---

Resolved by `7084030e`. `bbx doctor annex` now uses the annex gate's shared
`.gitignore` predicate and reports the half-migrated state with the existing
`bbx attachments unignore` repair. The secondary hardening ideas below were not
part of this fix.

Several boxes on a deployment were found in a broken half-migrated annex state:
**git-annex initialized (`annex.uuid` set, `annex.largefiles` configured) BUT the box
`.gitignore` still carried the manifest-scheme asset block** (`**/*.attach/**/*.<ext>`,
incl. `*.frozen`). In that state every asset is ignored, so `git add` never sees it,
so nothing is ever annexed — and any code path that `git add`s an asset fails hard.

Two real surfaces of the same root cause, both hit 2026-08-02:

- A `clerk.commentary` **500** on a page-save: *"The following paths are ignored by
  one of your .gitignore files: …/page.frozen"* (the `page.frozen` snapshot could not
  be `git add`ed).
- Scan-upload routes answering **503 `box is not annex-converted`** — the box passed
  doctor 7/7 while the upload gate refused it.

## The core problem: doctor is blind to it

`isAnnexBox` (`src/core/annex/is-annex-box.ts`) gates on TWO conditions: annex
initialized AND the box `.gitignore` no longer carrying the manifest-scheme asset
block. `bbx doctor annex --check` verifies **seven** things — binary, initialized,
thin, largefiles, content-present, journal, hook — but **not the gitignore half**. So
in this exact state doctor reports all green:

```
✓ initialized  ✓ thin  ✓ largefiles  ✓ content-present  ✓ journal  ✓ hook
```

while the annex gate (and the scan-upload route that depends on it) says "not
converted." **A gate and its diagnostic disagreeing is exactly what doctor exists to
prevent** — reconciling them cost real debugging time reading the probe source.

**Fix:** doctor grows an eighth check that **fails** when the box is annex-initialized
AND an asset ignore rule is still present. The exact predicate already exists —
`isAssetIgnoreRule` / `gitignoreIgnoresAssets` in `attachments-gitignore.ts`, the same
"does this `.gitignore` still hide assets from git" question `is-annex-box.ts` frames.
The check should point at the repair (`bbx attachments unignore` — remove the managed
block, add the post-annex unignore block). Without it, this state is invisible until
an asset write happens to hit it.

## Secondary findings (worth their own items if pursued)

- **`bbx attachments to-annex` no-ops on this half-state.** It guards on
  "is-annex-box" (annex.uuid present) and reports "0 assets, nothing changed", so it
  will NOT complete a box that was annex-init'd but never gitignore-converted. The
  fix on such a box is `bbx attachments unignore`. Consider making `to-annex` (or a
  dedicated repair) detect and finish this state.
- **The clerk save 500s instead of degrading.** `clerk.commentary` surfaces the raw
  git "ignored path" error as a 500 rather than a handled failure. Hardening worth
  doing regardless of the box state.
- **How the boxes got here:** annex init reached these boxes but the gitignore
  conversion did not (one box was fully converted; most were not). Likely an
  incomplete batch annex rollout / the "template rollout parks silently" pattern.
  Worth confirming so a re-run can't re-strand boxes.

## Resolution of the immediate incident (2026-08-02)

Manually ran `bbx attachments unignore` on the affected boxes (annex + largefiles were
already fine; only the gitignore was stale). The one box with stuck clerk page
snapshots had them annexed and committed afterward (verified: `page.frozen` became a
98-byte annex pointer with the annex holding the object). A box that was consistently
on the manifest scheme (not annex) was not affected. One box had the same conversion
sitting UNCOMMITTED in a template sync and was left for the boxholder to commit or
revert.
