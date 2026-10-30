---
title: "finish-preflight asks for typecheck and lint after a main merge even when the branch changes no code"
workstream: unattached
area: bin
labels: [finish, tooling]
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261025-233625
resolution: implemented
---

**Closed 2026-10-29 (tooling-burndown).** `skipTypecheckLintDecision` now
also takes the paths the branch's non-merge commits touched, each merge's
edits against the side it merged in (`git diff M^2 M`), and HEAD's diff
against main. When a merge brought code but all three hold only `.md` files,
the sheet skips both checks and says why. A code path in any of them (a
branch commit, even one later reverted; a conflict resolution; an evil
merge) still runs them.
A merge that brought only test files now counts as bringing code, since tests
are typechecked. Tests: `bin/finish-preflight.test.ts`,
`bin/test/finish-preflight.test.ts`.

`skipTypecheckLintDecision` in `bin/finish-preflight-lib.ts` returns false
for any merge that brought code in. When the branch's own diff against the
merge base is docs-only, the merged tree's code equals main's
code, which main's own commits already typechecked. Finish agents then decide
by hand that the check does not apply and record why.

Coding feedback: box-isolation/20261025T230953Z-landed.md,
box-isolation/20261025T210840Z-landed.md,
google-connect-options/20261026T011657Z-landed.md,
mac-app-updates/20261024T180449Z-landed.md,
dup-sweep-backend/20261024T010651Z-landed.md,
perf-easy-wins/20261024T000300Z-landed.md.

Direction: also skip when the branch's own changes (merge base to HEAD,
excluding merges) touch only docs and no conflict was resolved in code. The
function's comment records why every merge counts; that reason applies only
when the branch has code of its own.
