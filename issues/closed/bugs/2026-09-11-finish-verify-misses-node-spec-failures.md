---
resolution: implemented
title: "Finish verification cannot identify failing files from Node's spec reporter"
workstream: unattached
filed-by: agent
discovered-by: agent
discovered-in: interface-as-cards finish on 2026-09-11
---

`parseFailingFiles` in `bin/finish-verify.ts` only matches TAP lines beginning
`not ok`. Its comment assumes piped `node --test` always produces TAP, but the
root test command produced spec output during this finish:

```text
✖ failing tests:
test at bin/schedules-hardening.test.ts:3:1824
✖ a timeout kills the whole process group, not just the run script
```

The verifier reported “no failing file identified” and skipped its promised
single isolated rerun. Manually running the named file at unchanged content
passed all 12 cases, so the finish policy's named-flake rule could be applied,
but the verifier itself remained red. This issue concerns reporter parsing,
not that timing flake.

Reproduce the parser gap by passing the sample above to `parseFailingFiles`
with an existence predicate accepting `bin/schedules-hardening.test.ts`: the
result is empty. Either explicitly select TAP for Node test commands or support
the spec reporter's file locations, retaining existence checks and deduplication.

## Closed 2026-09-12 — the parser learned the spec reporter

The comment's premise was wrong, not just incomplete: piping does not switch
`node --test` to TAP. It did on Node 20; on Node 24 piped output is spec, which
I confirmed by running the root command and reading what it wrote. So the TAP-only
matcher never identified a file from `bin/*.test.ts` or `schedules/*/*.test.ts`
at all — every failure there came back unattributed, and finish-verify treats
unattributed as real, so the isolated rerun that decides flake-vs-real never ran
for that whole suite.

`parseFailingFiles` now also matches spec's `test at <path>:<line>:<col>`
header, anchored and whole so the `at … (file:///…)` stack frames beneath it
cannot contribute a path. Choosing the parser over forcing `--test-reporter=tap`
keeps `pnpm test`'s human-readable output intact and stops the verifier from
depending on which reporter a Node version defaults to.

Verified end to end rather than by reading: wrote a deliberately failing
`bin/*.test.ts`, ran the real `pnpm test`, and handed its real output to the
real parser with the real existence predicate — it named the probe file, where
the old matcher returned nothing. Two unit cases pin the header shape and that
the existence check still keeps a test *name* out of the list.
