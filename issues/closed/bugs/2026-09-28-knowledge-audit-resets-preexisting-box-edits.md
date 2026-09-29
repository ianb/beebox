---
title: "Knowledge audit cleanup discards pre-existing box edits"
workstream: jev-triage
resolution: implemented
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-jev-triage — validating PDF image guidance
---

> Resolved in commit `cf575dae4`: the audit CLI and runner now refuse dirty
> boxes before destructive setup, and preserve the CLI's generated setup state
> for the first run. Direct callers and later tests retain the clean-tree guard.

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

## Implementation evidence (2026-09-28)

The CLI now checks tracked, staged, and untracked state after confirming the
box is standalone and before loading into or generating docs in it. The
destructive `runTest` boundary has the same check for direct callers. Refusal
reports changed paths and advises committing/moving edits or using a clean
disposable box.

Forced `generateDocs` can itself create untracked guidance in an otherwise
clean synthetic box. The CLI captures that exact setup status and permits it
only for its first `runTest`; runner cleanup restores a clean tree, and later
tests use the normal clean-tree requirement. No user-facing bypass option was
added.

Validation used disposable synthetic boxes only. The CLI regression verifies
staged index contents, unstaged tracked bytes, untracked bytes, and absence of
generated guidance after refusal; a direct `runTest` call refuses the same box.
The generated-doc regression confirms the guard accepts the captured setup
baseline and that reset/clean restores the status required by subsequent
tests. It does not invoke a clean full audit or an agent provider.

Checks passed:

- `pnpm exec tap test/dev/lib/box-guard.doctest.md` — 7 assertions passed.
- `pnpm lint:changed`.
- `pnpm typecheck:backend`.
