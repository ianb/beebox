---
title: "Purge agent-doctest: rename the check library, drop doctest leftovers"
status: active
workstream: doctest-typecheck
issues: []
---
# Purge agent-doctest: rename the check library, drop doctest leftovers

The doctest format is gone (`beebox/docs/implemented-plans/retire-doctest.md`),
but its name is not: the test assertion library is still the `agent-doctest`
package, about 985 test files carry `// doctest:L…` comments that point at
deleted Markdown lines, and temp directories are named `bbx-doctest-…`. The
boxholder (2026-10-18): "I want to purge agent-doctest entirely so it doesn't
get distracting. So we should move those pieces elsewhere. Probably rename
those temp directories too." This plan renames the package, moves nothing
else, and removes the leftovers.

**Issues addressed:** none filed. Searched `issues/` for agent-doctest,
"doctest:L", and bbx-doctest: only historical mentions and three open issues
that name the package in passing (updated by track 3).

## Design

No design section: test tooling only; nothing a box user sees changes.

## Smallest fix and budget

- **Smallest fix:** rename the package directory and name, and rewrite every
  import, config, and live doc reference. That alone removes the name from
  everyday use.
- **Chosen scope:** that, plus deleting the `// doctest:L…` comments, renaming
  the `bbx-doctest-` temp prefix, and deleting the dead `printed()` helper and
  its test. The boxholder asked for all of it ("purge … entirely").
- **Size: BIG CHANGE, by mechanical volume.** About 1,110 import lines
  rewritten in place (one line per test file), about 12,150 comment lines
  deleted, about 60 config/doc/source lines edited by hand, and the package
  directory moved (a rename, not new code). Every changed test line is
  produced by a script; the hand-written change is under 150 lines. The
  boxholder's request covers this scale.

## Stated preferences this plan trades against

- **Minimize invented concepts** (memory `feedback_minimal_concepts_prefer_primitives`):
  the plan keeps one package and its three entry points (`/check`, `/tap`,
  `/eslint`) unchanged; only names move.
- **Historical records stay as written:** implemented plans, closed issues,
  CODING_FEEDBACK, and `dev/project-size/data` keep the old name (they are
  history). `pnpm doc-check --fix` repairs file links into the moved
  directory.

## What already exists

- Package: `agent-doctest/package.json`: `"name": "agent-doctest"`, exports
  `./check`, `./eslint`, `./tap`; devDependency of beebox, browse,
  scan-uploader, workstreams-app and the root (`package.json:45`).
- Wiring that names it (all verified by `git grep -n agent-doctest`):
  `pnpm-workspace.yaml:22`; the four `.taprc` files (`--import=agent-doctest/tap`);
  eslint configs `beebox/eslint.config.ts:10,338-342`,
  `beebox/src/frontend/eslint.config.ts`, `beebox/pub-worker/eslint.config.ts`,
  `personal-vibe-check/preset.ts` (comments); `tsconfig.json:25` (exclude);
  `knip.ts:98`; `bin/deployed-paths.ts:22`, `.husky/post-commit:28-34`,
  `.husky/post-merge:51-58` (the shipped-path regex);
  `beebox/deploy/deploy.sh:414,503-507,648` (wipe, rsync loop, legacy clear);
  `bin/test-roots.ts:43`; `bin/test-graph-query.ts:47`;
  `beebox/src/dev/doc-check/file-paths.ts:27`; `AGENTS.md`, `README.md`,
  `beebox/docs/testing/{check,tap-tests}.md`,
  `beebox/docs/development/technologies.md`, `site/docs/dev/README.md`,
  `.claude/skills/deploy-status/SKILL.md`, `.claude/memory/MEMORY.md`.
- One lint suppression names the plugin:
  `beebox/test/core/triage/evidence.test.ts` (`agent-doctest/check-whole-value`).
- Temp prefix: `beebox/test/helpers/test-helpers.ts:50` and
  `beebox/test/core/box.test.ts:22` create `bbx-doctest-…`;
  `beebox/test/helpers/isolate-user-home.ts:101` already sweeps both
  `bbx-doctest-` and `bbx-test-`; three tests match the prefix in values
  (`secrets/access-log.test.ts:76`, `lib/paths.test.ts:83`,
  `webapp/routes/chat/uploads.test.ts:29`).
- `printed()` (`agent-doctest/src/observe/printed.ts`) has one user, its own
  test `beebox/test/doctest/print.test.ts`.
- Dependencies `typescript` and `esbuild` in `agent-doctest/package.json` are
  imported nowhere in `src/` or `test/` (`grep` for `from "typescript"` and
  `from "esbuild"`: none); they served the removed doctest typecheck and
  loader.

## Prior art (external)

No prior art: a rename inside this monorepo.

## Ontology

- **New name: `tap-check`**, package name `@ianbicking/tap-check`, matching
  the scope of the other shared preset (`@ianbicking/personal-vibe-check`).
  It names what the package is: `check` assertions for tap. Imports become
  `@ianbicking/tap-check/check`, `/tap`, `/eslint`.
- ESLint plugin key: `tap-check`, so rules are `tap-check/check-whole-value`,
  `tap-check/no-voided-check`, `tap-check/no-tap-assert`.
- Temp prefix: `bbx-test-` (already swept by `isolate-user-home.ts`).

## Tracks / scope

1. **Rename the package.** `git mv agent-doctest tap-check`; package name,
   description, and `repository` (drop: it pointed at a standalone repo that
   is no longer the source); update every live reference listed above,
   including the open plans that name the package's paths
   (`beebox/docs/plans/source-available-release.md` and others found by
   `git grep`); root and
   package manifests' `"agent-doctest": "workspace:*"` →
   `"@ianbicking/tap-check": "workspace:*"`; `pnpm install` to rewrite the
   lockfile. Script-rewrite every `agent-doctest/` import specifier in
   `*.ts`/`*.tsx`.
2. **Delete the leftovers.** Delete every `// doctest:L<n>` comment line
   (scripted: a line whose only content is that comment; then collapse a
   blank line doubled by the deletion). Rename `bbx-doctest-` to `bbx-test-`
   in source and tests; the sweep list keeps `bbx-doctest-` so directories
   left by earlier runs are still cleaned. Delete `printed()`, its export, and
   `beebox/test/doctest/` (its only test).
3. **Docs and records.** Update live docs, skills, AGENTS, and the three open
   issues that name the package. `pnpm doc-check --fix` repairs moved links
   by unique basename only, so links to `agent-doctest/README.md` and other
   shared basenames are edited by hand; then regenerate the doc graph. A
   progress note here.
4. **Deploy guard.** In `deploy.sh`'s package-sync loop, a missing package
   directory fails the deploy instead of `continue`. The loop runs before the
   deploy stops the hub (`deploy.sh` stops services and copies the staged tree
   before `pnpm install --frozen-lockfile`), so a missed rename aborts with the
   site still up.

## Could this be simpler?

The simplest version is track 1 alone, without deleting the markers or
renaming the temp prefix. The fuller plan buys what the boxholder asked for:
nothing in a test file still says "doctest". The markers alone are 12,150
lines of comments with no reader since retire-doctest track 6 removed the
driver. Keeping one package (not splitting `check`, `tap` and `eslint` into
beebox and elsewhere) is the simpler choice: five packages import it.

## Subplans

None.

## Failure modes

- **Deploy breaks on the rename.** `deploy.sh` rsyncs packages by name
  (`for repo in personal-vibe-check agent-doctest beebox`) and skips a
  missing one. It stops the hub and copies the staged tree before
  `pnpm install --frozen-lockfile`, so a missed rename would fail with the
  site down (cross-model plan review). Mitigation: track 4 makes a missing
  package fatal in the sync loop, before services stop; all three
  `deploy.sh` sites and the shipped-path regex in `.husky/*` and
  `bin/deployed-paths.ts` change together (`bin/deployed-paths.test.ts`
  checks the three regexes agree, not the sync loop).
  The server keeps a stale `/opt/beebox/agent-doctest/` directory; it is not
  in the synced `pnpm-workspace.yaml`, so pnpm ignores it. Removing it needs
  the boxholder's yes (a delete on the production host) and is NOT in this
  plan.
- **tap's shared runtime.** Every `.taprc` must keep the same plugin list
  (`.taprc` root comment); only the `--import` specifier changes.
- **A missed import** fails typecheck at once (module not found). The commit
  hook typechecks beebox and workstreams-app but not browse, scan-uploader,
  or the library, so their typechecks and tap runs (which exercise each
  `.taprc` preload) run by hand before landing.
- **A marker deletion eats code:** the script deletes only lines matching
  `^\s*// doctest:L\d+\s*$`; tests and typecheck catch anything else. A
  final `git grep -n "doctest:L"` finds the markers that share a line with
  code (`beebox/test/cli/commands/secrets/command.test.ts:210`), fixed by
  hand.
- **Stale `node_modules/agent-doctest` symlinks** in checkouts until
  `pnpm install`; harmless, and `pnpm install` in this worktree removes them.

## Agent-flow / user-flow edge cases

- Other worktrees that branched before the rename keep importing
  `agent-doctest/...`; after they merge main, their new imports fail typecheck
  with a clear "cannot find module" until rewritten. The script used here goes
  in the commit message so a worktree can rerun it.
- Agent instructions that name `agent-doctest` (skills, rules, AGENTS) are
  updated in the same landing, so an agent never reads the old name for a live
  path.

## NOT in scope

- Moving the package's inner `src/tap-check/` directory or pruning its
  unused `typescript`/`esbuild` dependencies (cross-model review: no
  `agent-doctest` name goes with them; separate cleanup).
- Deleting `/opt/beebox/agent-doctest/` on the production host.
- Renaming anything in implemented plans, closed issues, or recorded data.
- Changing the library's API or behavior.

## Open design questions

None.

## Knowledge audits

The `dev-test-check-value` knowledge audit (renamed in retire-doctest track
6) names the testing docs; it is rerun by its own schedule, not changed here.

## What will hold this after it ships

- Typecheck: any import of `agent-doctest/...` fails to resolve.
- `bin/deployed-paths.ts` tests pin the shipped-path regex.
- A grep in the cross-model review confirms no live (non-historical)
  `agent-doctest` reference remains.

## Implementation order

1. Track 1 in one commit (a partial rename does not typecheck).
2. Track 2 in a second commit.
3. Track 3 with the second commit or a third; cross-model review of the hand
   edits; full beebox suite, other packages' suites, `bin/smoke` after
   landing.

## Rollout shape

One landing. The deploy that follows is the first with the new package name;
check `beebox/deploy/.last-deploy.log` for the frozen install and the health
checks.
