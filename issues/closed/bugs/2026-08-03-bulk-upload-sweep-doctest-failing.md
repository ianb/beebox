---
title: "`bulk-upload/sweep.doctest.md` abandons a fresh staging session it should keep"
workstream: cbserve-fd-leak
area: beebox
filed-by: agent
discovered-in: worktree-cbserve-fd-leak — while running the full suite for the spawn-EBADF fix
resolution: implemented
---

Closed 2026-08-03 (worktree-skill-review): it was the fixture, not the sweep.
The test hardcoded `2026-07-27T00:00:00.000Z` as the "recent" batch's
`startedAt` — a time bomb that crossed the ≥7-day threshold on 2026-08-03
(the day this was filed). The sweep's age cutoff (`getBoxTime`-based) is
correct; real boxes were never at risk. The fixture now derives the recent
date from `getBoxTime(box.root)` minus one day.

`pnpm test` has one failing doctest, unrelated to the change it was found
under. It reproduces every run (not flaky) and it also fails on the unmodified
tree, so it predates that work.

`test/core/bulk-upload/sweep.doctest.md:161` expects the abandonment sweep to
take the aged staging session only:

```
wanted: {"count":1,"path":"store/x/tmp-upload/upload-old/Batch.upload-batch.card","session":"s-target","aged":true}
found:  {"count":2,"path":"store/x/tmp-upload/upload-new/Batch.upload-batch.card","session":"s-target","aged":false}
```

So the sweep abandoned **both** sessions, including the one created moments
before, and reported the new one rather than the old one. Either the age cutoff
is not being applied, or the fixture's two sessions no longer differ in age the
way the test assumes (a frozen-time or mtime detail). Worth checking which,
because if it is the cutoff and not the fixture, a real box would be discarding
in-flight uploads.

Whether the bug is in `core/bulk-upload/sweep.ts` or in the fixture is the open
question — the test has been failing long enough that "the test is wrong" is
not a safe assumption.
