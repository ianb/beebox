---
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
