---
title: "Every box uses git-annex, now and forever: delete the manifest scheme"
workstream: full-embrace-annex
area: beebox
labels: [annex, git, scan]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-scan-ingest — 2026-09-14
---

Boxholder decision, 2026-09-14: *"I want every box currently and forever in the
future to use annex. So we should just be making it right, always, and not worry
about cases where it isn't right."*

Today `bbx init` always produces a **manifest-scheme** box — asset bytes
gitignored by `GITIGNORE_BLOCK` (`src/core/commands/attachments-gitignore.ts`)
and inventoried in per-directory `manifest.json` (`src/core/asset-manifest.ts`).
`git annex init` runs only from `bbx attachments to-annex`
(`src/core/annex/to-annex.ts:367`), and `runAnnexDoctor` is explicitly forbidden
from converting a box (`src/core/annex/doctor.ts:290-300`: *"that is a perfectly
correct state — not a defect to repair"*). The scheme itself is already retired
on paper: `docs/implemented-plans/asset-manifests.md` opens with **"Status:
SUPERSEDED by git-annex"**.

The work, as scoped by the decision:

- `bbx init` runs `git annex init` and writes `UNIGNORE_BLOCK`. The dual-scheme
  branch in `writeBoxGitignore` (`src/core/box/index.ts:245-283`) and the
  `annexed` probe feeding it (`:136`) both collapse to one unconditional block.
  Note the ordering: `scaffoldBoxRoot` probes for annex at `:136` but does not
  `initRepo` until `:216-221`, so on a fresh init there is no `.git` yet and the
  probe can only ever read false.
- A binary preflight that refuses **before** the box exists. Once `.git/annex/`
  is present, a machine without git-annex fails *every* commit on that box
  (`src/core/install-validation-hooks.ts:226-235`), so the refusal has to land
  at the one moment the user can act on it. git-annex becomes a hard install
  dependency, and grepping every `.md`/`.sh`/`Dockerfile` finds it mentioned
  only in tests, `bin/lib/worktree-create.sh:354,367`, and a failure-mode table
  in `docs/assets.md` — no install or deploy doc says to install it.
- Asset writers assert instead of accommodating. Four write asset bytes into
  attach scopes and stage them; on a manifest box the stock ignore block means
  scan-import/pdf-extract/Gmail fail at `git add`, and card submissions lose the
  bytes silently. Under this decision a manifest box is a broken invariant, so
  these take `invariant()` per `code-style.md`, not a graceful refusal.
- Convert existing manifest-scheme boxes. Production is reportedly all
  annex-shaped as of 2026-09-06; local scratch and fixture boxes are the
  population.
- Delete the manifest scheme. **Ordering constraint:** `to-annex` reads
  manifests to verify a conversion (`to-annex.ts:307`, and a per-asset sha256
  comparison at `:427`), so deletion cannot precede conversion. Two changes, not
  one.
- `makeTmpBox` (`test/helpers/doctest-helpers.ts:37`) becomes annex-always and
  loses its `annex` option; the ~50 `annex: true` declarations across nine
  doctest files become redundant. Decide the fabricate-vs-real-binary question
  while doing it: `test/helpers/annex-box.ts:22` *fabricates*
  `.git/annex/objects/` rather than running the binary, so today's annex
  fixtures prove the ignore block does not block, not that bytes annex. With
  git-annex mandatory the fixture can require the binary and close that gap —
  which matters, because "the old `makeTmpBox` never ran the real init" is what
  the scan-import issue names as the reason its bug went unnoticed.

The design work is drafted at `beebox/docs/plans/annex-at-init.md`, whose
leading note records this decision and marks exactly which of its sections the
decision deletes. That plan's budget predates the decision and must be re-set
before implementation.

Resolves, or absorbs, these:
`issues/bugs/2026-09-04-scan-import-gitignore-blocks-attach-staging.md`,
`issues/bugs/2026-09-14-card-submission-asset-bytes-silently-unstaged.md`,
`issues/code-quality/2026-08-18-retire-remaining-asset-manifest-writers.md`.

Why this seam deserves care: `c47fd2be1` (2026-09-06) fixed `isAssetIgnoreRule`
missing a path-anchored spelling of these rules. Three checks over the one seam
failed open at once — `attachments unignore` reported success, `to-annex`
converted and reported success, and the annex-shape probe called the box
converted — leaving one production box with 536 assets in neither git nor the
annex, found only by running `git check-ignore` per box. Any change here gets
verified with `git check-ignore` against real boxes, not reasoned about.
