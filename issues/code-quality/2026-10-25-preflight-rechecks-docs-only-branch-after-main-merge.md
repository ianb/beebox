---
title: "finish-preflight asks for typecheck and lint after a main merge even when the branch changes no code"
workstream: unattached
area: bin
labels: [finish, tooling]
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261025-233625
---

`skipTypecheckLintDecision` in `bin/finish-preflight-lib.ts` returns false
for any merge that brought code in. When the branch's own diff against the
merge base is docs-only or non-TypeScript, the merged tree's code equals main's
code, which main's own commits already typechecked. Finish agents then decide
by hand that the check does not apply and record why.

Coding feedback: box-isolation/20261025T230953Z-landed.md,
box-isolation/20261025T210840Z-landed.md,
google-connect-options/20261026T011657Z-landed.md,
mac-app-updates/20261024T180449Z-landed.md,
dup-sweep-backend/20261024T010651Z-landed.md,
perf-easy-wins/20261024T000300Z-landed.md.

Direction: also skip when the branch's own changes (merge base to HEAD,
excluding merges) touch no code and no conflict was resolved in code. The
function's comment records why every merge counts; that reason applies only
when the branch has code of its own.
