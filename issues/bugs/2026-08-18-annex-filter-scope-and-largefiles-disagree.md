---
title: Assets commit as raw blobs where the filter scope and annex.largefiles disagree (bulk non-asset files, mixed-case extensions)
workstream: unattached
area: callback-box
filed-by: agent
discovered-by: agent
discovered-in: worktree-annex-bypass-check — cross-model review of the photo-batch annex investigation
---

Whether a file is annexed is decided by **two independent lists**, and a file is
annexed only if both agree:

1. `.git/info/attributes` — which paths reach the git-annex filter-process at
   all (`assetAnnexAttributes()`, `src/lib/asset-extensions.ts:107`). Scoped to
   the asset extensions by `cf5eb474` (2026-08-04) so text commits skip a ~0.3s
   filter round-trip.
2. `annex.largefiles` — which of those the filter actually annexes
   (`assetLargefilesExpression()`, `src/lib/asset-extensions.ts:76`).

`asset-extensions.ts:97` reasons that the two fail asymmetrically and that the
attributes list being wider is safe: *"an over-wide attribute line only runs a
filter that then declines to annex."* True for data loss. But the outcome of
"declines to annex" is that the bytes commit into git as a raw blob — which is
the thing the annex migration exists to stop. Two reachable cases, both verified
on a box with a clean `cb doctor annex` and the current expressions:

**1. Bulk-upload batches of non-asset file types.** `src/core/bulk-upload/prepare.ts:166`
writes a batch-local `.gitattributes` with `* annex.largefiles=anything`,
deliberately, because *"a bulk batch lands ARBITRARY extensions (.zip, .csv,
extensionless, …), which the box-wide asset allowlist deliberately does not
cover."* That override is now dead letter: a `.zip` is not in the scoped
`.git/info/attributes`, so it never reaches the filter, and `largefiles=anything`
is never consulted. One batch, four 1.5 MB files:

| file in the batch | committed object |
|---|---|
| `plain.jpg` | 102 bytes — pointer |
| `Mixed.Jpg` | 102 bytes — pointer |
| `archive.zip` | **1,500,000 bytes — raw blob** |
| `noext` (no extension) | **1,500,000 bytes — raw blob** |

The perf scoping landed 2026-08-04; the batch `.gitattributes` predates it
(2026-07-30). Nothing tests the interaction — `test/core/bulk-upload/prepare.doctest.md`
asserts only that the blob is *tracked*, not that it is a pointer, and runs on a
non-annex box.

**2. Mixed-case extensions anywhere.** `assetLargefilesExpression()` emits the
lowercase and all-uppercase spellings only, *"not every mixed-case permutation"*
(`src/lib/asset-extensions.ts:71`), while the attributes renderer uses per-character
any-case globs (`[jJ][pP][gG]`). In an ordinary attach scope, three 1.5 MB files:

| file | committed object |
|---|---|
| `lower.jpg` | 102 bytes — pointer |
| `upper.JPG` | 102 bytes — pointer |
| `Mixed.Jpg` | **1,500,000 bytes — raw blob** |

**Not yet fired in production.** No box has a tracked mixed-case asset, and no
batch of a non-asset type has been committed. Every asset-extension photo batch
annexed correctly — see the closed
[photo-batch annex-bypass investigation](../closed/bugs/2026-08-01-prod-photo-uploads-bypass-annex.md).

**Unresolved.** The fix could be to derive one list from the other so they cannot
drift (largefiles matching case-insensitively, and the filter scope covering
whatever a batch-local `.gitattributes` can widen to), or to accept that a batch
scope needs its paths in `.git/info/attributes` too, or to drop the perf scoping
for `.attach/` paths. Whatever the shape, the invariant worth encoding is that
`assetAnnexAttributes()` must be a superset of *everything any largefiles
expression in the repo can match* — `asset-extensions.ts:122` already states the
superset rule, but only against the box-wide expression, not a batch-local one.
Also worth a test on a real annex box: today's bulk doctest cannot catch this.
