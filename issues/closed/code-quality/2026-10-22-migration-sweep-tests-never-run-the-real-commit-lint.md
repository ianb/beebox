---
title: "No migration sweep test runs the real box commit lint, so a migration that writes a lint-failing card passes its tests"
workstream: unattached
area: beebox
labels: [migrations, tests]
filed-by: agent
discovered-by: agent
discovered-in: worktree-risky-merge-review — adversarial review of the merges since 2026-10-08
resolution: implemented
---

Closed in `worktree-risky-merge-review`:
`beebox/test/core/migration-sweep.real-commit-lint.test.ts` installs the real
hooks with `installValidationHooks` and `BBX_HOOK_BIN`, then runs the sweep
over a card-rewriting migration: a card with a pre-existing absolute machine
path fails with `commit-failed` naming the lint finding and leaves the manifest
unrecorded; a clean card commits through the hook. The optional self-check of
written cards by migrations was not done.

`makeTmpBox` installs no git hooks. The sweep tests stand in for the box commit
lint with a grep-based `pre-commit` hook, and the engine-link tests injected a
fake lockfile refresh. The real `bbx validate --pre-commit`
(`beebox/src/cli/commands/validate/pre-commit.ts`) lints every staged card and
makes an absolute machine path an error unconditionally
(`beebox/src/core/card-lint/core/lint-cards.ts:319`). This is the gap that let
[the engine-link question card fail to commit on production](../closed/bugs/2026-10-22-engine-link-spec-migration-fails-on-production.md).

The same gap applies to any migration that rewrites or renames cards
(body-tags, retire-memo, briefing-openers, agents-md). If a card they touch
already carries an error-level finding, such as an old transcript holding a
`/Users/<name>/` path written before that guard existed, the migration's commit
fails with `commit-failed`. A retry's commit also carries any lint-failing dirty
file changed since the first attempt (`migrationOutputBaseline`). Repair can
recover it, but only through an agent run. This part is reasoning, not proven.

What would close it: one sweep integration test that installs the real hooks
(`installValidationHooks` with `BBX_HOOK_BIN`) and runs a card-rewriting
migration on a box whose touched card has a pre-existing lint error, asserting
the recorded outcome. Optionally, migrations check their written cards with the
same lint before exiting 0.
