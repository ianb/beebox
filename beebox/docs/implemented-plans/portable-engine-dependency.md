---
title: "Portable beebox dependency in box package.json"
status: implemented
workstream: bug-burndown-4
issues:
  - ../../../issues/closed/bugs/2026-10-20-deploy-beebox-link-reaches-box-history.md
---
# Portable beebox dependency in box package.json

Every box commits `"beebox": "link:<this machine's engine>"`. This plan commits one
value, `link:.beebox/engine`. `.beebox/engine` is a gitignored, per-machine
symlink to the engine. Install paths write the symlink, never the tracked file.

**Issues addressed:** `issues/bugs/2026-10-20-deploy-beebox-link-reaches-box-history.md`.
Related, left open: `issues/decisions/2026-07-10-boxes-dead-beebox-symlinks.md`
(its one-engine-link-per-box model is kept). A search of `issues/` for
`link:/opt`, `pnpm.overrides`, `defaultBeeBoxSpec`, `engine link` found nothing else.

## Design

No design section: install infrastructure. A person sees no change.

## Smallest fix and budget

Smallest fix: deploy writes the symlink and the migration converts production
boxes; local, worktree, and docker boxes would still commit their paths. Tracks
A–D cover every install path: about 150 source lines, 220 test lines, 30 doc
lines. Not a BIG CHANGE.

## Stated preferences this plan trades against

`docs/engineering-principles.md` §4 (never silent): a missing link is named by
the health check, never resolved from a registry. §8 (one way): one committed
value on every machine. §6 (right-sized): the setup-commit drop in
`workstream_preserve_keep` stays for unmigrated source boxes.

## What already exists

- `deploy/deploy.sh:734-741` writes `link:/opt/beebox/beebox` into
  `package.json`; `:743-750` installs when it is newer than `node_modules/react`;
  the converge step (`:847`) runs migrations later.
- `src/core/box/package.ts:56-58` `defaultBeeBoxSpec`: `link:${PACKAGE_ROOT}` or
  `^version`; `:215` `process.env.BBX_INIT_BEEBOX_SPEC ??` (the doc comment at
  `:43,:54` misnames it `BBX_INIT_BBX_BOX_SPEC`; fix); `:272-277` links `node_modules/beebox`.
- `bin/lib/worktree-create.sh:116-138` `wt_create_repoint_box_engine` writes the
  link to `dependencies.beebox` and `pnpm.overrides.beebox`; `:476-478` commits
  it ("Worktree setup: …"); `bin/lib/workstream-box-state.sh:72-94` rebases it out of `keep`.
- `docker/Dockerfile:160` `ENV BBX_INIT_BEEBOX_SPEC=file:/app/beebox.tgz`;
  `docker/entrypoint.sh:76-89` first-run `pnpm install`.
- `deploy/add-box.sh:313` runs `bbx init` on the laptop and pushes; the server
  runs `bbx engine init .` on the clone (`:369`).
- `src/webapp/trpc/routers/health/checks/engine.ts:39-67` `engine-link` reads
  `readlink(node_modules/beebox)`; through `.beebox/engine` its worktree-pin test
  would see `../.beebox/engine` and never fire.
- The box lockfile is tracked. The test box clone's has `overrides: beebox:
  link:/Users/…/bug-burndown-4/beebox` and `version: link:../../../beebox-worktrees/…`.
- `.beebox/` is in the box `.gitignore`; no code in `src/` removes it (searched).
- Migration model: `box-shape-record-2026-10` (`src/scripts/migrate/box-shape-record/`,
  pure `plan.ts` plus `run.ts`); the sweep commits changed paths (`migration-sweep.ts:259`).

## Prior art (external)

Experiments, pnpm 10.26.2 (root `packageManager`): scratch box depending on
`is-odd` and a local engine `beebox@1.0.0`; "add" is `pnpm add is-even`.

| Mechanism | install | add | package.json | lock |
|---|---|---|---|---|
| bare `^1.0.0`, nothing else | fails, registry 404 | fails | untouched | — |
| tracked `.pnpmfile.cjs` `readPackage`, absolute target | ok | ok | untouched | absolute specifier + `pnpmfileChecksum` |
| same, returns `link:./.beebox/engine` | ok | ok | untouched | relative, but lock specifier disagrees with `package.json` |
| gitignored `pnpm-workspace.yaml` `overrides` | ok | ok | untouched | absolute override + specifier |
| `npm_config_overrides` env / `--config.overrides.beebox` | fails, 404 (ignored) | fails | untouched | — |
| `npm_config_global_pnpmfile` env or gitignored `.npmrc global-pnpmfile` | ok | ok | untouched | absolute specifier + `pnpmfileChecksum` |
| above + `exclude-links-from-lockfile=true` | ok | ok | untouched | only `pnpmfileChecksum` (hash of a per-machine file) |
| `pnpm link <engine>` | ok | — | untouched | writes a new `pnpm-workspace.yaml` override |
| **committed `link:.beebox/engine` + gitignored symlink** | ok | ok, spec kept | untouched | `link:.beebox/engine` only |

Last row, further: `--frozen-lockfile` passes in a copy at another path; a link
to a pnpm-installed engine (docker layout) resolves the engine's dependencies;
repointing the link switches `node_modules/.bin/bbx` with no reinstall. With the
link missing, install exits 0 without `.bin/bbx` and import fails
`ERR_MODULE_NOT_FOUND`; a reinstall after the link exists restores the bin.
Today's `link:/opt/beebox/beebox` on a laptop also exits 0 with a dead link.
After a spec change, `pnpm install --lockfile-only --prefer-offline` updates the lockfile.
It re-resolves the box's direct dependencies, so `--offline` fails on a server
whose pnpm cache lacks their metadata (every production box, 2026-10-21).
Every override row fails open: without the override, the committed `^1.0.0`
asks the public registry for `beebox`, a name anyone can register.

## Ontology

- **Engine link**: `<box>/.beebox/engine`, gitignored symlink to an engine
  package root outside the box; one per box per machine. Not `node_modules/beebox`.
  It is *usable* when it resolves to a directory whose `package.json` is named `beebox`.
- **Pinned engine**: any other spec (`file:` tarball, semver range, a link into
  the box). The migration leaves it alone.
- **`bin/box-engine-link`** (shipped in the engine's `bin/`): `link <box> <engine>`
  (`ln -sfn`, then check usable) and `verify <box>` (after install:
  `node_modules/beebox/package.json` names `beebox` and `node_modules/.bin/bbx`
  exists). The one check every shell install path runs.
- **Portable spec**: `link:.beebox/engine`, constant `ENGINE_LINK_SPEC` in `src/core/box/engine-link.ts`.
- `BBX_INIT_BEEBOX_SPEC` stays the explicit pin for release smoke tests (tarballs).

## Tracks / scope

### A. Engine link helper, init, health check
`ensureEngineLink(boxRoot, target)` in `src/core/box/engine-link.ts` creates
`.beebox/engine` when it is missing or not usable, and never replaces a usable
link, so the main checkout's `bbx` never repoints a worktree clone. It throws
`EngineLinkError` (with the `ln -sfn` repair) when the result is not usable.
`defaultBeeBoxSpec` returns `ENGINE_LINK_SPEC` for every engine. Fresh `bbx
engine init` calls it with `PACKAGE_ROOT`; the `node_modules/beebox` bootstrap
links `../.beebox/engine`. Update-mode init calls it when the spec is portable.
`engine-link` health reads `.beebox/engine`; its repair text becomes `ln -sfn
<engine> .beebox/engine`.

### B. Migration `engine-link-spec-2026-10`
Converts only a machine-local `link:` spec whose target is outside the box.
Pure `plan.ts` over `package.json` text, with the effective spec being
`pnpm.overrides.beebox` over the dependency: `already-portable`; `pinned`
(any non-`link:` spec: exit 0, "skipped: pinned engine", recorded as done);
`convert` (sets the portable spec in the field that held it, deletes
`pnpm.overrides.beebox` and an emptied `overrides`/`pnpm`); or `refuse` when no
dependency names `beebox`. `run.ts`: (1) a link target that resolves inside
the box is `pinned` too: no in-box link target ever; (2) `ensureEngineLink` to
the old link target, which keeps a usable existing link; a dead target exits 1
with the repair; (3) write `package.json`; (4) if `pnpm-lock.yaml` exists, `pnpm
install --lockfile-only --prefer-offline`; on failure restore `package.json` and exit 1
naming the box and command, so the migration stays pending and the manifest
never disagrees with the tracked lockfile; (5) verify the spec reads back
portable and the link is usable. The real install happens at the next install
path below; until then `node_modules/beebox` still points at the old target.

Implementation review (2026-10-20) added: a failed spawn restores like a
failed exit; a rerun with a converted manifest refreshes a lockfile whose
importer specifier is not portable before reporting "already converted"; an
in-box target is a pin by its path, even when dead; the migration runs before
`box-shape-record-2026-10`, so that migration's commit never carries the
machine path.

### C. Install paths
Each supported path runs `box-engine-link link` before `pnpm install` and
`box-engine-link verify` after, and fails loudly naming the box. `verify`
passes only for a completed install (every declared dependency, `.bin/bbx`,
and the portable link), so deploy and docker also use it to decide whether to
install. Worktree setup leaves a pinned engine in place with a warning.
- `deploy.sh:734-741`: replace the rewrite with `box-engine-link link <box>
  /opt/beebox/beebox` as `beebox`; reinstall also when `node_modules/beebox` is
  not the portable link; a failed box prints `ERROR` and the deploy continues
  with the next box, as the converge step does (`:855`); fix the `:464-466` comment.
- `wt_create_repoint_box_engine`: `box-engine-link link` to the worktree engine;
  write the portable spec (unmigrated box) and drop `pnpm.overrides.beebox`;
  verify after the clone's install.
- `docker/entrypoint.sh`: link to `/app/node_modules/beebox` before argument
  dispatch when `package.json` exists; a real install when `node_modules` is
  missing or `node_modules/beebox` is not the portable link, before and after
  migrations; verify. `Dockerfile:154-160`: drop `BBX_INIT_BEEBOX_SPEC`.
- `add-box.sh`: no change; server-side `bbx engine init .` creates the link.

Residual, accepted: a raw agent `pnpm install`/`pnpm add` with a missing link
still exits 0 with a dead `node_modules/beebox`, as today's committed link does
on a machine without its target. The health check names it.

### D. Docs
`docs/box-layout.md` (dependency and repair), `docker/README.md`.

## Could this be simpler?

Simplest: accept it. Concrete harm today: (1) a clone installs with exit 0 and
a dead link, and box schemas do not load until someone repoints it; (2) each
machine that installs rewrites tracked `package.json` and lockfile, so a box
committed on the server and on a laptop clone changes the same lines on both
sides: each sync conflicts or breaks the other machine's link; (3) worktrees
need a setup commit and a rebase to keep it out of the source box, which
refuses when kept work touched `package.json` (unverified); (4) home-directory
paths reach private box history. The plan ends (2)–(4) and gives (1) one fixed
repair, per §8. Deploy-plus-migration alone leaves laptop and docker boxes as they are.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Supported install without a usable link | planned (box-engine-link test) | `link` refuses before pnpm | clear |
| Raw agent `pnpm add` without a link | planned (engine.test.ts) | health `engine-link` names it | clear after the fact (accepted) |
| Main checkout's `bbx engine init` repoints a worktree clone | planned (engine-link test) | a usable link is never replaced | n/a |
| Docker `file:` pin or in-box target | planned (migration) | `pinned`, left alone | clear |
| Old link target is dead | planned (migration) | exit 1 with `ln -sfn` repair | clear |
| Offline lockfile refresh fails | planned (migration) | restore, exit 1, stays pending | clear |
| Rollback: old `deploy.sh` writes `/opt` back | none | old behavior returns; migration already recorded | silent, accepted |

## Agent-flow / user-flow edge cases

- Agent `pnpm add`: ADDRESSED, spec kept (experiment, last row).
- Hand-edit back to `link:/abs`: GAP, accepted; works on that machine, nothing rewrites it.
- Partial migration: ADDRESSED; both specs install while the link exists, and deploy writes it first.

## NOT in scope

- `bbx upgrade --to` (`upgrade.ts:151-159` `bumpBeeBoxDependency`) still writes
  its spec, a tarball path, into `package.json`: the explicit pin for installed
  engines. Filed as an issue. Existing `file:` pins (docker boxes) stay too.
- Guarding a raw `pnpm` run inside a box: needs install-time machinery.
- Removing the setup-commit drop: after source boxes migrate.
- An engine registry (Track F of boxes-as-packages-v2).

## Open design questions

None. The cross-model review (2026-10-20) found an in-box link target, an
unguarded install, docker's stale install, a soft lockfile failure, and pin
conversion; Tracks B and C now carry the adjudicated fixes.

## Knowledge audits

Skip: infrastructure; the only agent-facing text is the health repair line.

## What will hold this after it ships

t.check tests. `test/scripts/migrate/engine-link-spec.test.ts`: "plan converts
link specs and leaves pins", "run converts a box and a clone with a link
installs", "run skips an in-box target", "run exits 1 on a dead target", "run
restores package.json when the lockfile refresh fails".
`test/core/box/engine-link.test.ts`: "a usable link is kept, a dead one
replaced", "bin/box-engine-link refuses a non-engine and verifies an install". `test/core/box/structure.init-v2.test.ts`: "fresh init writes the
portable spec and the engine link", "update init keeps an existing engine link".
`.../health/checks/engine.test.ts`: "dead .beebox/engine names the ln -sfn
repair", "worktree pin is seen through .beebox/engine". `bin/test/lib/workstream-box-state.test.ts`:
"repoint links the worktree engine and drops the override". `docker/smoke-docker.sh` covers the entrypoint.

## Implementation order

A, B, C (worktree, deploy, docker), D; tests with each.

## Rollout shape

Done when the tests pass and a scratch copy of the test box clone migrates,
reinstalls, and loads its schemas. Scripted, atomic per box; production
converts on the first deploy's converge step.
