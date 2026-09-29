---
title: "Knowledge audit cleanup discards pre-existing box edits"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-jev-triage — validating PDF image guidance
---

The knowledge-audit runner checks that its target is a standalone Git box, but
it does not require a clean working tree before saving HEAD. Its cleanup runs
`git reset --hard` and `git clean -fd`, discarding edits and untracked files that
existed before the audit started.

Reproduced on an isolated development test box during a PDF guidance audit:
a modified package manifest and an untracked package lock disappeared. The
manifest was recovered from a captured diff, and the lock was recovered from
pnpm's installed lock copy. No real box was involved. Operator instructions to
preserve dirty state were insufficient; the runner should enforce its boundary.

Relevant code: `beebox/src/dev/lib/test-runner/runner.ts` saves `headBefore`
and resets/cleans in its finalizer. `knowledge-audit.ts` generates docs before
calling the runner, so a clean-tree gate belongs before any audit setup writes,
not after generated files already modified the target.

The smallest proposed fix is to refuse an initially dirty box with an actionable
message, before documentation generation or fixture writes. A throwaway clone
or explicit preservation mechanism is a separate design choice; do not silently
stash or discard someone else's changes. Add a regression proving that both
tracked edits and untracked files survive refusal unchanged.
