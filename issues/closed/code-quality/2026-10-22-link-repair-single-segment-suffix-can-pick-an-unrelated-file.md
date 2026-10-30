---
title: "doc-check link repair can rewrite a deleted single-segment link to an unrelated same-named file"
workstream: unattached
area: docs
filed-by: agent
discovered-by: agent
resolution: implemented
discovered-in: worktree-risky-merge-review — adversarial review of the merges since 2026-10-08
---

Resolved: `redepthCandidates` now rejects a link whose path has one segment and no `../` hop, so `./foo.json` is reported as `no-basename-match` instead of being rewritten to an unrelated ancestor file. Two-segment suffixes (`sub/foo.json`) and `../foo.json` still repair. Covered in `beebox/test/dev/doc-check/link-repair.test.ts`.

`beebox/src/dev/doc-check/link-repair.ts` (`redepthCandidates` and the
`suffixMatches` branch of `decideLink`) repairs a link whose target is gone by
matching its path suffix against tracked files. A link such as `[x](./foo.json)`
has the suffix `foo.json`. If exactly one tracked file ends in `/foo.json` and
its prefix is an ancestor of the source directory (for example `foo.json` at the
repo root), the repair rewrites the link to `../../foo.json`, a file the author
never meant. A single-segment suffix is the weakest possible match.

Unproven by a run; the unique-candidate rule keeps it rare. A fix is to require
at least two path segments, or a `../` hop in the original link, before a
suffix match counts.
