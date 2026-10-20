---
title: "Portable beebox dependency in box package.json"
status: draft
workstream: bug-burndown-4
issues:
  - ../../../issues/bugs/2026-10-20-deploy-beebox-link-reaches-box-history.md
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
After a spec change, `pnpm install --lockfile-only --offline` updates the lockfile.
Every override row fails open: without the override, the committed `^1.0.0`
asks the public registry for `beebox`, a name anyone can register.

## Ontology

- **Engine link**: `<box>/.beebox/engine`, gitignored symlink to an engine
  package root; one per box per machine. Not `node_modules/beebox`.
- **Portable spec**: `link:.beebox/engine`, constant `ENGINE_LINK_SPEC` in `src/lib/box-identity.ts`.
- `BBX_INIT_BEEBOX_SPEC` stays the explicit pin for release smoke tests (tarballs).

## Tracks / scope

### A. Engine link helper, init, health check
`ensureEngineLink(boxRoot, { target, replace })` in `src/core/box/package.ts`
creates `.beebox/engine`, replacing an existing link only with `replace`.
`defaultBeeBoxSpec` returns `ENGINE_LINK_SPEC` for every engine. Fresh and
update-mode `bbx engine init` call it with `PACKAGE_ROOT`, `replace: false`, so
the main checkout's `bbx` never repoints a worktree clone. The `node_modules/beebox`
bootstrap links `../.beebox/engine`. `engine-link` health reads `.beebox/engine`;
its repair text becomes `ln -sfn <engine> .beebox/engine`.

### B. Migration `engine-link-spec-2026-10`
Pure `plan.ts` over `package.json` text: `already-portable`; `write` (sets the
portable spec, deletes `pnpm.overrides.beebox` and an emptied `pnpm.overrides`);
or `refuse` when no dependency field names `beebox`. `run.ts`: (1)
`ensureEngineLink` without replace, to the realpath of `node_modules/beebox` when
it lies outside the box, else `PACKAGE_ROOT` (a docker `file:` copy lies inside);
(2) write `package.json`; (3) if `pnpm-lock.yaml` exists, `pnpm install
--lockfile-only --offline`; a failure prints one line and does not block later
migrations, since the next install converges the lockfile; (4) verify the spec
and that `.beebox/engine` resolves.

### C. Install paths
- `deploy.sh:734-741`: replace the rewrite with `ln -sfn /opt/beebox/beebox
  .beebox/engine` as `beebox`, before the install; fix the `:464-466` comment.
- `wt_create_repoint_box_engine`: `ln -sfn <worktree>/beebox .beebox/engine`;
  write the portable spec (unmigrated box) and drop `pnpm.overrides.beebox`.
- `docker/entrypoint.sh`: `ln -sfn /app/node_modules/beebox .beebox/engine` on
  every start, before the install. `Dockerfile:154-160`: drop `BBX_INIT_BEEBOX_SPEC`.
- `add-box.sh`: no change; server-side `bbx engine init .` creates the link.

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
| Clone installs before the link exists: no `.bin/bbx` | planned (engine.test.ts) | health `engine-link` names it | clear |
| Main checkout's `bbx engine init` repoints a worktree clone | planned (init-v2) | `replace: false` | n/a |
| Migration on a docker `file:` copy links into the box's own `.pnpm` | planned (migration) | target `PACKAGE_ROOT` | clear |
| Offline lockfile refresh fails | planned (migration) | one line; next install converges | clear |
| Rollback: old `deploy.sh` writes `/opt` back | none | old behavior returns; migration already recorded | silent, accepted |

## Agent-flow / user-flow edge cases

- Agent `pnpm add`: ADDRESSED, spec kept (experiment, last row).
- Hand-edit back to `link:/abs`: GAP, accepted; works on that machine, nothing rewrites it.
- Partial migration: ADDRESSED; both specs install while the link exists, and deploy writes it first.

## NOT in scope

- `bbx upgrade --to` (`upgrade.ts:151-159` `bumpBeeBoxDependency`) still writes
  its spec, a tarball path, into `package.json`: the explicit pin for installed
  engines. File an issue at implementation.
- Removing the setup-commit drop: after source boxes migrate.
- An engine registry (Track F of boxes-as-packages-v2).

## Open design questions

None; decided in Tracks.

## Knowledge audits

Skip: infrastructure; the only agent-facing text is the health repair line.

## What will hold this after it ships

t.check tests. `test/scripts/migrate/engine-link-spec.test.ts`: "plan rewrites
an absolute link, a file: tarball, and a range", "plan drops the beebox
override", "plan refuses without a beebox dependency", "run links an outside
realpath, else PACKAGE_ROOT", "run keeps package.json when the lockfile refresh
fails". `test/core/box/structure.init-v2.test.ts`: "fresh init writes the
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
