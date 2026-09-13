---
title: "`serveSite` no longer rebuilds when a source changes or is deleted — two router tests fail"
workstream: unattached
area: router
filed-by: agent
discovered-by: agent
discovered-in: worktree-openrouter-services — running the router test suite after merging main on 2026-09-10
labels: [router, tests]
resolution: implemented
---

`workstreams-app/test/router/router-site.test.ts` has two failing cases on
current `main` (as merged into this worktree on 2026-09-10):

- *serveSite: a changed source (same set) triggers a rebuild* — expected one
  rebuild after editing `content/index.md`, got zero.
- *serveSite: a deleted source triggers a rebuild (content-based, not mtime)* —
  expected one rebuild after removing a source, got zero.

The other ten cases in the file pass, including "missing dist auto-builds" and
"missing manifest is treated as stale", so the build runner is wired and the
manifest is read; what has stopped is the **content-hash comparison** deciding
that a changed or shrunken source set differs from the built manifest. Either
the hash now ignores content (mtime-only, which the second test name says it
must not be), or the manifest written by a fresh build already reflects the
edit before the comparison runs.

Not touched by the workstream that noticed it — its `workstreams-app/` diff is
`router-worktree-start.ts`, `router-worktree-teardown.ts`, and
`router-core.test.ts` only. Reproduce with
`cd workstreams-app && node --import tsx --test test/router/router-site.test.ts`.

## Closed 2026-09-13 — an optional input was listed unconditionally

By today it was 13 of the 15 cases failing, not two, and all of them for one
reason the issue's guesses did not include: `mkBuiltSite` threw
`ENOENT … /site/docs-manifest.yaml` before any hash comparison ran. The
content-hash logic was never broken.

`listSourceRelPaths` (`site/sources.ts`) pushed `"docs-manifest.yaml"` onto the
source list unconditionally, and `hashSources` throws on a listed file it cannot
read — by contract, since a source it cannot hash means it cannot tell whether
the site is stale. Four lines below the push, `loadManifestEntries` already
treats a missing manifest as "promotes nothing", and the sibling optional input
(`beebox/box-docs/.hash`) has an explicit tolerated-absent check. So the file
contradicted itself within a few lines. Landed in `6d4abe3a1` (the agent-docs
corpus work), which added the manifest as an input.

The manifest is now listed only when it exists, via one `fileExists` helper that
both optional inputs share. A site dir without a manifest builds instead of
500ing, and the real site still lists and hashes it (202 inputs, 69 promoted repo
sources). `site` 171 tests and the router's 15 serveSite cases pass.

## Why it went unnoticed for three days, which was the worse bug

`pnpm --dir workstreams-app test` ran `tap`, and `.taprc` listed
`test/router/**/*.test.ts` in its `include`. Those are `node:test` files, which
tap does not execute: it reported `# SKIP no tests found` for each and exited 0.
Fifteen files and 129 assertions looked covered and never ran — a failing router
test could not fail the package's own test command, which is also the command
`bin/finish-preflight` verifies with.

`test` is now `test:doctests && test:router`, the second being node's runner over
that glob, and the dead `include` line is gone so nothing reports phantom skips.
Verified by planting a failing router test: `pnpm test` exits 1 where it
previously exited 0.
