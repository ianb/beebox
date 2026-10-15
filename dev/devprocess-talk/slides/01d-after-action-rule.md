# Nothing from a walk is a finding until verified
## Supporting: the after-action pass, written after the first walk
- 2026-08-24: three of seven reported bugs were the harness, each written up in good faith
- The pass is mandatory: a new walk refuses to start while an old one has notes and no report

```text
On 2026-08-24, three of the seven bugs a walk reported were ours — a 401 from
driving with a key that is not the box owner, "systemic" unreachability that was
a missing scroll instruction, and a data leak between boxes that was stale
transcript files. Each was written up in good faith and each read as a serious
product defect. Filing them unexamined would have put three false bugs in the
queue and sent someone chasing them.

> Nothing from a walk becomes a finding until it has been separately verified.
> The walker's job is to notice. Yours is to find out what actually happened.
```

Notes:
Path: beebox/test/user-stories/journeys/after-action.md, commit 42a74680b. Reports now also get a cross-model review before issues are filed.
