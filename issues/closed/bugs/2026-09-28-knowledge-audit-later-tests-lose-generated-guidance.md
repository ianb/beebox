---
title: "Later knowledge audits can lose freshly generated guidance"
workstream: bug-burndown-4
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-jev-triage — reviewing test harness safety fixes
priority: important
resolution: implemented
---

Fixed in `3b784c975` (bug-burndown-4, 2026-10-20). Box audits
now run through `runBoxAudits` (`beebox/src/dev/lib/box-audits.ts`). Before each
audit it checks the box is clean, regenerates docs, and passes that audit's own
setup status to `runTest`. The CLI still refuses a dirty box once at start.
`beebox/test/dev/lib/box-audits.test.ts` runs two audits on a legacy box with a
fake agent; both see the same generated `CLAUDE.md`.

The audit CLI forces docs generation once before its test loop. The runner
resets and cleans the box after each test. Generated guidance that is not
part of the saved commit can therefore disappear before the second test.
Later tests can audit different guidance from the first test.

This is separate from
[discarding pre-existing box edits](2026-09-28-knowledge-audit-resets-preexisting-box-edits.md).
The clean-tree admission check fixes that data-loss bug; it does not preserve
generated setup across the audit suite.

## Research (2026-09-28)

Source trace, independently reviewed across model families:

- `beebox/src/dev/knowledge-audit.ts` calls `generateDocs` before the loop.
- `beebox/src/core/docs-gen/generate/core.ts` commits template sync before
  calling `ensureAgentContext`.
- `beebox/src/core/docs-gen/generate/agents-md.ts` can update tracked
  `AGENTS.md` includes and generate context mirrors without committing them.
- `beebox/src/dev/lib/test-runner/runner.ts` captures HEAD, then restores it
  with `git reset --hard` and removes untracked output with `git clean -fd`.
  It only regenerates Codex mirrors for tests with fixtures.

A disposable synthetic-box regression confirms forced generation can leave
untracked guidance and that reset/clean removes it. No full multi-test audit
with a provider was run to reproduce the resulting agent behavior.

The smallest proposed remedy is to regenerate guidance for each test and
capture that test's setup status, keeping the initial dirty-box refusal.
A regression should compare effective guidance across two tests on an
initially clean box whose generated guidance needs updating.
