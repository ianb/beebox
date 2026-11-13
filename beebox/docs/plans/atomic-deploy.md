---
title: "Atomic deploys: install each release beside the live one, then switch"
status: draft
workstream: atomic-deploy
issues:
  - ../../../issues/features/2026-11-11-deploy-without-downtime-or-half-installed-packages.md
---
# Atomic deploys: install each release beside the live one, then switch

Production deploys copy the build into the live `/opt/beebox` and reinstall
packages there. A process that starts during that work can see a partial
tree. This plan installs each deploy into its own release directory while the
services still run, then switches `/opt/beebox` (a symlink) in one rename and
restarts. It also adds a one-command rollback to the previous release, and an
automatic rollback when activation fails after the switch.

**Issues addressed:**
`issues/features/2026-11-11-deploy-without-downtime-or-half-installed-packages.md`
(first direction, "install, then switch"). Related, already closed:
`issues/closed/bugs/2026-07-11-deploy-pnpm-install-oom-killed.md` (the install
retry this plan keeps) and
`issues/closed/bugs/2026-10-22-deploy-failure-after-stop-leaves-services-down.md`
(the activation EXIT trap this plan extends). Searched `issues/` for
"release", "symlink", "rollback", "atomic": no other open item.

## Design

No design section: this changes the deploy pipeline. A person using a box
sees a shorter "updating" page and no broken `bbx` commands; nothing new to
read or decide.

## Smallest fix and budget

**Smallest fix for the reported breakage.** The 2026-11-11 report ("Cannot
find package @kwsites/file-exists" from every `bbx` call mid-deploy) has a
direct cause, verified in this session. `deploy.sh` links the stage's
`node_modules` to the live one when the lockfiles match
(`beebox/deploy/deploy.sh:1273-1278`, *"ln -s "$install_dir/node_modules"
"$stage_dir/node_modules""*), then runs
`(cd "$stage_dir" && ... CI=true pnpm fetch)` (`:1296`). Reproduced in a
scratch project (hoisted linker, `packageImportMethod: copy`): without `CI`,
`pnpm fetch` in the stage aborts with
`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`; with `CI=true` it removes and
recreates the modules directory through the link. The live
`node_modules/@kwsites/file-exists/package.json` got a new inode, and
`.modules.yaml` now names `virtualStoreDir: ../../stage/node_modules/.pnpm`.
On production that is 2.4 GB deleted and rewritten under running services on
every deploy whose lockfile did not change. The smallest fix skips the
prefetch when the stage's `node_modules` is that link. It is chunk 1, a
separate commit that can land alone.

**Chosen design (chunks 2–5).** Source and test lines, additions plus
deletions:

| Track | Estimate |
|---|---|
| Release helper `src/scripts/deploy-releases/` (`cli.ts`, `layout.ts`, `prepare.ts`, `rollback.ts`) | ~340 |
| Its tests | ~220 |
| `deploy.sh`: prepare before the window, switch inside it, trap rollback, `--rollback` mode | ~250 |
| Docs (`docs/server/deploying.md`, `deploy/AGENTS.md`, `docs/server/provisioning.md`) | ~80, reported separately |

About 730 source and test lines. Not a BIG CHANGE. The fuller design buys
what the smallest fix cannot: the install happens before the services stop
(the window loses the rsync and the in-place install, about 20–35 s of the
63–124 s windows in `deploy/.deploy-logs/deploys.jsonl`), a `bbx` run never
sees a half-copied source tree, and rollback becomes a symlink switch.

## Stated preferences this plan trades against

- **Strict by default** (boxholder memory, "bias toward strict"): rollback
  fails closed when it cannot prove the previous release understands every
  box migration the live one applied.
- **Stop over-engineering rare failures** (boxholder memory): the rollback
  restores code, `node_modules` and the systemd unit files. It does not revert
  root helpers in `/usr/local/sbin` or the sudoers entry. They change rarely
  and `deploy.sh --ref <sha>` reinstalls them.
- **Operational simplicity**: one new on-server helper, no daemon, no new
  service. The deploy lock, latest-wins chaining, maintenance controller and
  deploy window are reused as they are.
- **Ghost lesson** (`src/cli/commands/upgrade.ts:13-20`, *"code and data
  revert as ONE unit. `ghost update --rollback` used to revert only the code
  symlink while the database stayed migrated forward"*): this is the reason
  for the migration guard on rollback.
- **Root helpers' bytes come from the build checkout through stdin**
  (`deploy.sh:858-865`, *"never from $INSTALL_DIR: the hub user owns that
  tree"*): the release helper is installed the same way.
- **TypeScript for code** (root `AGENTS.md`): the helper carries decisions
  (what to prune, whether rollback is safe), so it is TypeScript with tests.
  The mechanics stay in `deploy.sh`'s bash, which is how the rest of the
  pipeline is written.

## What already exists

- **Fixed install path.** Every consumer names `/opt/beebox`: unit
  `ExecStart=/usr/local/bin/bbx ...` (`deploy/systemd/beebox-hub.service:17`,
  `beebox-box@.service:35`), `/usr/local/bin/bbx` →
  `/opt/beebox/beebox/bin/bbx` (`deploy.sh:856`), each box's
  `.beebox/engine` → `/opt/beebox/beebox` (`deploy/server-bin/bbx-box-install`,
  `bin/box-engine-link` *"ln -sfn "$engine" "$box/.beebox/engine""*),
  `/usr/local/bin/codex` → `/opt/beebox/node_modules/.bin/codex`
  (`deploy.sh:752`), `bin/deploy-status.ts:65` reads
  `/opt/beebox/beebox/deploy-info.json`. All of these resolve through a
  symlink. Reuse: `/opt/beebox` becomes the symlink; no consumer changes.
- **Processes pin their release at start.** `bin/bbx` resolves its own real
  location (*"SCRIPT_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)""*) and runs
  `$PROJECT_DIR/dist/cli.mjs`. Node resolves a main module's real path by
  default, so imports resolve inside one release. Reuse.
- **Stage directory.** `/opt/beebox.deploy-stage` stays the rsync target
  (`deploy.sh:486-571`). Reuse; it stops getting a `node_modules`.
- **Install retry on OOM.** `install_with_retry` (`deploy.sh:726-750`). Move
  into the prepare step.
- **Activation EXIT trap.** It restarts services after a failure between
  stop and restart (`deploy.sh:627-645`). Extend it with the rollback.
- **Maintenance controller.** It keeps boxes closed across the activation
  command and reopens each box the hub canary verifies, even when the command
  failed (`src/cli/commands/maintenance/controller.ts:149-157`). Reuse: after
  an automatic rollback the canary runs against the restored release.
- **Rollback by redeploy.** `deploy.sh --ref <old-sha>` (`deploy/AGENTS.md`,
  "Rollback"). Kept as the full path; `--rollback` is the fast path.
- **Migration manifest.** A box records applied migration names in
  `_config/migrations.jsonl`; pending = canonical list minus applied
  (`src/cli/commands/migrate.ts:4-6`). An older engine ignores names it does
  not know, so it opens a forward-migrated box without error. That is why the
  rollback guard has to exist.
- **No local deploy test path.** Searched `deploy/`, `docs/server/`,
  `bin/` for a local or VM harness: there is none. Past rehearsals used a
  throwaway Hetzner VM from `hetzner/cloud-init.yaml` plus `provision.sh`
  (`docs/plans/per-box-units.subplan.md:116`). `limactl` is installed locally.

## Prior art (external)

- Capistrano's `releases/` + `current` symlink layout and its
  `ln -s new tmp && mv -T tmp current` atomic switch
  (https://capistranorb.com/documentation/getting-started/structure/).
  Adopted as a pattern. No code is copied, so no ACKNOWLEDGEMENTS entry.
- Ghost-CLI's code-only rollback corrupting forward-migrated data
  (https://github.com/TryGhost/Ghost-CLI/issues/699), already cited in
  `upgrade.ts`. Evaluated; it shapes the migration guard.
- pnpm `fetch` behavior with an existing hoisted `node_modules`: verified
  locally (see Smallest fix); no external source needed.

## Ontology

- **install dir**: `/opt/beebox` (existing name, `INSTALL_DIR`,
  `deploy-target.sh:114`). After this plan, a symlink to the live release.
- **releases dir**: `/opt/beebox.releases/`, a sibling of the install dir like
  the existing `/opt/beebox.deploy-stage`. New.
- **release**: `/opt/beebox.releases/<UTC stamp>-<12-char sha>`, a complete
  workspace tree plus its own `node_modules`. Identified by its directory
  name. It is not the stage.
- **live release**: the target of the install dir symlink.
- **previous release**: the target of `/opt/beebox.releases/previous`, a
  symlink the switch writes. It is the rollback target.
- **legacy tree**: a real directory at `/opt/beebox` (every host before this
  plan). The first switch moves it to `/opt/beebox.releases/legacy-<stamp>`;
  from then on it is an ordinary release.
- **failed mark**: `<release>/.bbx-release-failed`, written when an automatic
  rollback leaves a release. Rollback never switches to a release with this
  mark.
- **stage**: `/opt/beebox.deploy-stage` (existing). The upload target only.

## Tracks / scope

### Track A — stop the prefetch from rewriting the live tree (chunk 1)

- **What:** skip `pnpm fetch` when `$stage_dir/node_modules` is a symlink.
- **Why:** it deletes and recreates the live `node_modules` (verified above).
- **Direction:** wrap `deploy.sh:1295-1296` in
  `if [[ ! -L "$stage_dir/node_modules" ]]`. When the stage has its own
  install (lockfile changed), the prefetch still runs there and is harmless.
- **First chunk:** that edit, one commit.

### Track B — release helper (chunk 2)

- **What:** `beebox/src/scripts/deploy-releases/` (`cli.ts` with
  `layout.ts`, `prepare.ts`, `rollback.ts`), Node built-ins only, so it runs
  with `node` type stripping from any directory as root. deploy.sh installs
  the four files to `/usr/local/lib/beebox/deploy-releases/` from the build
  checkout through stdin. Subcommands of `cli.ts`, all taking `--install-dir`:
  - `prepare --stage <dir> --name <name> -- <member>...`: prune, then copy
    each listed member from the stage into a new release, skipping every
    `node_modules`; carry `beebox/deploy-history.json` forward from the live
    tree with the stage's `beebox/deploy-info.json` prepended (last 20); run
    `pnpm install --frozen-lockfile`, retried only when the kernel killed it.
    Prints the release path. deploy.sh then proves
    `node_modules/.bin/tsc --version` runs and applies `chown -R
    beebox:beebox` and `chmod -R a+rX`.
  - `switch --to <release>`: refuse unless the release is in the releases dir
    and has `beebox/dist/cli.mjs` and `node_modules`. From a link: point
    `previous` at the old live release first, then rename a temporary link
    over the install dir. From the legacy real directory: rename it to
    `legacy-<stamp>`, link the install dir (renaming the tree back if that
    fails), then point `previous` at it. An empty directory is removed.
  - `rollback --boxes-root <dir> [--from <release>] [--check]`: target =
    `previous`. Refuse when there is none, when it carries the failed mark,
    when it is incomplete, when `--from` is given and is not the live release,
    or when any box has applied a migration the previous engine does not
    know. Applied names come from each `<boxes-root>/<slug>/box/_config/
    migrations.jsonl`; known names are read with `/name: "([^"]+)"/` from the
    previous release's `beebox/src/core/migrations.ts`. An unreadable manifest
    or list refuses. Otherwise mark the live release failed and switch.
    `--check` decides and switches nothing.
  - `status`: print the live and previous releases.
  - Pruning keeps the live release, the previous release, the `previous`
    link, and every release a running process's command line names (from
    `/proc/*/cmdline`; `bin/bbx` execs node on the bundle's real path).
    Backup and scheduler-pass units are not stopped by a deploy and can
    outlive two of them.
- **Why:** the decisions (prune set, rollback safety, legacy conversion) need
  tests; bash in a heredoc has none.
- **Vocabulary lock-ins:** `/opt/beebox.releases/`, `previous`,
  `.bbx-release-failed`, release name `<YYYYMMDDTHHMMSSZ>-<sha12>`.
- **First chunk:** the helper and its tests, no `deploy.sh` change.

### Track C — deploy through releases (chunk 3)

- **What:** `deploy.sh` prepares a release before the maintenance controller
  and switches inside activation.
- **Direction:**
  1. One `SHIPPED` array names the members (`personal-vibe-check tap-check
     canvas-loop beebox package.json pnpm-workspace.yaml .npmrc
     pnpm-lock.yaml patches`). The upload loop and `prepare` both read it.
     Stale stage entries (`agent-doctest` today) are no longer copied into
     the live tree. (`browse`, `site` and `workstreams-app` in `/opt/beebox`
     are not stale: the frozen install creates `node_modules` for every
     workspace member the lockfile lists, present or not. The rehearsal
     showed it; it costs about 150 MB per release.)
  2. `deploy-info.json` is computed as now, uploaded to
     `$STAGE_DIR/beebox/deploy-info.json` after the rsync, and carried by
     `prepare`. The two queued deploy-info/history steps go away.
  3. Before the controller (CONTROL block, services running): remove a stage
     `node_modules` link left by an older deploy, install the helper, run
     `prepare`. This replaces the stage install, the `tsc` probe and the
     prefetch (`deploy.sh:1262-1296`). The controller then runs from the new
     release: `node "$release/beebox/dist/cli.mjs" engine maintenance ...`.
  4. Activation: after the stop, `switch --to $release` replaces the rsync, the `chown -R` and the "Checking
     dependencies" block. The one-time cleanups in that block
     (`/opt/personal-vibe-check`, `cardworks`, `pub-worker`, legacy per-package
     `node_modules`) are dropped: a fresh release has none of them. The codex
     link stays.
  5. The cache prune moves after the controller returns (outside the window).
  6. The units block becomes a function, `install_units <install dir>`,
     defined in the activation script and called where the block runs today.
  7. The EXIT trap becomes a function. On a non-zero exit it reads where
     `/opt/beebox` points; when that is `$release` (the switch happened,
     whatever the step that failed), it runs `rollback --from $release`. If
     that switches, it re-runs `install_units /opt/beebox` (the restored
     release's unit files), stops and starts the hub, scheduler and box
     units, leaves a `rolled-back` marker beside the script, and prints the
     release it returned to. If it refuses, or the switch never happened,
     keep today's behavior: start the services when `SERVICES_STOPPED=1`.
  8. CONTROL: when the rolled-back marker exists, print it and skip the
     migration repair, as for the existing restarted-by-trap marker.
- **First chunk:** items 1–8 in one commit; they are one activation path.

### Track D — `deploy.sh --rollback` (deferred)

**Deferred during implementation.** The brief asks for "one command, or one
automatic step on a failed health check"; Track C's trap is the automatic
step, and `deploy.sh --ref <sha>` stays the one manual command (it builds a
new release). A fast manual switch needs the build and upload half of
`deploy.sh` skippable and a second activation script; that is about as large
as Track C again for a path the automatic rollback mostly covers. The design
below stays as the starting point if a manual fast rollback is wanted.

- **What:** the one-command rollback.
- **Direction:** `--rollback` excludes `--ref` and `--skip-restart`. It takes
  the deploy lock (refusing, not queuing, when a deploy holds it), runs the
  layout check, reads the previous release's `deploy-info.json` hash and
  resolves it to a full sha locally, runs `bbx-release rollback --check`, then
  stamps `.deploy-requested` with that sha (a rollback is the latest intent,
  so a later commit still chains past it). It builds a short activation
  script from the same queued pieces as a deploy: window open (page from the
  previous release), down, stop, `bbx-release rollback`, units block,
  restart, health check. It runs that script under the controller from the
  live release. It writes `.last-deployed-sha` on success.
- **First chunk:** the flag, refactoring the restart and health heredocs into
  functions both modes queue.

### Track E — docs and rehearsal (chunk 5)

- `docs/server/deploying.md`, `deploy/AGENTS.md` ("Rollback",
  "Waiting for a deploy"), `docs/server/provisioning.md:110-115` layout.
- Rehearsal on a local Lima Ubuntu VM (see *What will hold this*).

## Could this be simpler?

- **Simplest: Track A only.** It fixes the reported breakage. It leaves the
  in-place rsync and install inside the window, where a `bbx` run outside the
  stopped units (an operator shell, `bbx-wait-quiet`, a timer) still sees a
  partial tree, and the window keeps its install time. The developer asked for
  the switch, so Track A ships first and the rest follows.
- **Switch without automatic rollback.** Cut Track C item 6 and rely on
  `--rollback`. The trap rollback is about 15 lines, and the developer named
  "one automatic step on a failed health check" as acceptable. Kept, guarded
  by the same refusal rules as the manual rollback.
- **Bash helper instead of TypeScript.** It would save the install-as-`.ts`
  step, but the prune and guard logic would have no tests. Rejected.
- **Hardlink `node_modules` from the store or the live release** to save
  2.4 GB per release. Rejected: `pnpm-workspace.yaml:49-57` chose
  `clone-or-copy` because a hardlinked package that rewrites its own files
  corrupts the shared copy; with releases the shared copy would be the live
  one.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `prepare`'s install is OOM-killed under box load | no (plan: none, existing retry) | retry on 137, then the deploy fails before anything stops | clear |
| Disk: three releases at ~2.6 GB each plus the stage | plan: prune test | prune keeps only live+previous before creating; the existing 15%/3 GiB gate runs first | clear |
| A dependency was present only because a stale entry (`agent-doctest`) sat in `/opt/beebox` | Lima rehearsal (frozen install of the `SHIPPED` set, `bbx --version` from it) | the canary and health checks catch a failed start | clear at deploy |
| `switch` runs on the legacy real dir while a process holds files in it | plan: legacy-switch test | runs only after the services and box units stop; open files survive a rename | clear |
| Rename of the symlink is not atomic | plan: switch test | `rename(2)` of a symlink over a symlink is atomic on the same filesystem; the temp link is created in the parent dir of the install dir | — |
| Rollback after a box applied a migration the previous engine does not know | `rollback.test.ts` | refusal; the trap falls back to restarting on the new release | clear (message names the migrations) |
| A box manifest cannot be read during the rollback decision | `rollback.test.ts` | refusal (fail closed) | clear |
| Rollback to a release an earlier automatic rollback left | plan: failed-mark test | refusal | clear |
| Prune deletes a release a process still runs from (a backup or scheduler pass spanning two deploys) | `layout.test.ts` | prune keeps live, previous, and any release a `/proc/*/cmdline` names | — |
| The first switch: `/opt/beebox` is absent between the two renames | no | once per host, inside the window with hub, scheduler and box units stopped; the tree is renamed back if the link fails | silent, accepted: microseconds, once, with no service running; Ubuntu 24.04's coreutils has no `mv --exchange` and Node has no `renameat2` |
| `switch` fails between writing `previous` and the live link | `layout.test.ts` (order) | `previous` is written first; the trap reads the real link, not a flag | clear |
| Automatic rollback leaves the new release's systemd units | no | the trap re-runs `install_units` from the restored release | clear |
| A drop-in file the failed release added stays installed after rollback (`install_units` copies, never deletes) | no | none; deleting unknown files under `/etc/systemd` could remove an operator's own drop-in | silent, accepted: drop-ins are added rarely, and the next deploy reinstalls the set |
| A box's manifest is missing | `rollback.test.ts` | rollback refuses (what the box holds is unknown) | clear |
| A hub that accepts connections and never answers holds the health poll | no | one 180 s deadline for the whole poll, each attempt capped at the time left | clear |
| A box's pnpm bin shim embeds `NODE_PATH` of the release that was live at its last install | no | `NODE_PATH` is a fallback only; Node resolves from the real path of `bin/bbx` first, and a pruned path is skipped | silent, accepted: a correct install never resolves through `NODE_PATH` |
| `deploy.sh --rollback` while a deploy runs | no | refuse when the lock is held | clear |
| Automatic rollback leaves root helpers and sudoers from the new release | no | documented; `deploy.sh --ref <sha>` reinstalls | clear in docs |
| Box guidance that converge rewrote under the new engine stays after a rollback | no | none needed: the guard ensures no new migration ran; regenerated guidance is refreshed by the next converge | silent, accepted |

No critical gap: every silent row is accepted above with its reason.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field:** not applicable; no agent-facing vocabulary.
- **Stale ref:** `previous` points at a pruned release. ADDRESSED: prune never
  removes the `previous` target, and `rollback` checks the target exists.
- **Two agents touching the same card:** two deploys at once. ADDRESSED by the
  existing lock (`deploy.sh:287-314`); `--rollback` refuses when it is held.
- **Hand-edit drift:** an operator edits files in the live release by hand.
  ADDRESSED: the next deploy builds a fresh release; the edit is gone, as it
  is today after rsync `--delete`.
- **Fabricated free-form value:** not applicable.
- **Validation error UX:** the refusal messages name the reason and the
  forward path (`deploy.sh --ref <sha>` or fix forward).
- **Partial migration / transition state:** the first deploy after merge
  converts the legacy tree (scenario 1 below). A box agent running `bbx` sees
  the old tree or the new release; during the window its unit is stopped.

### Scenario walks (against `deploy.sh` as it stands)

1. **First deploy after merge.** `/opt/beebox` is a real dir. Laptop builds and
   uploads to the stage as today. CONTROL: removes the stage `node_modules`
   link (`deploy.sh:1273-1275` does today), installs the helper, `prepare`
   finds the install dir is not a link, copies history from
   `/opt/beebox/beebox/deploy-history.json`, installs into
   `/opt/beebox.releases/<name>` while services run (about 26 s on
   2026-11-13, `Done in 26.3s` for 1591 packages). `has_maintenance_gate`
   reads the legacy CLI (`deploy.sh:1245`), passes. Controller from the new
   release closes boxes; activation opens the window, stops units, `switch`
   renames `/opt/beebox` to `legacy-<stamp>`, links `/opt/beebox`, links
   `previous` to the legacy tree. Box installs, converge, units, restart,
   health as today. The legacy tree carries server-local leftovers
   (`beebox/.env`, a world-readable file from 2026-08-30 holding two keys
   that no code loads, `callback-*`, `site`, `workstreams-app`); they leave
   the live path now and are deleted when the legacy tree is pruned two
   deploys later.
2. **Normal deploy.** Same, with `prepare` pruning down to live + previous
   first. Window: stop → switch (milliseconds) → box installs → converge →
   units → restart → host installs → health.
3. **Failed install.** `prepare` exits non-zero before the controller runs.
   Nothing stopped; the live release is untouched; the half-built release
   is pruned by the next `prepare`. The EXIT trap on the laptop reports
   failure and chains as today.
4. **Failed health check, then rollback.** The HEALTHCHECK block exits 1
   with services up and `SWITCHED=1`. The trap runs `rollback --from`; with
   no box having applied a migration the previous engine lacks, it marks the new release failed, switches to
   `previous`, restarts services, writes the marker, closes the window. The
   controller's per-box canary runs against the restored release and reopens
   verified boxes. CONTROL sees the marker, skips repair, exits non-zero; the
   laptop prints "Deploy failed" and notifies. If the release added a
   migration, the trap prints the refusal and leaves the new release running,
   as today.
5. **Deploy queued during a deploy.** Unchanged: the second invocation stamps
   `.deploy-requested` and exits; the holder chains after finishing or
   failing (`deploy.sh:118-133`, `:1390-1404`). The chained run's `prepare`
   prunes the failed or superseded release.

## NOT in scope

- **`deploy.sh --rollback`** (Track D): deferred; see that track.
- **Light path for box-docs-only commits** (issue direction 2): each deploy
  still builds a full release. Considered; the release copy makes a docs-only
  deploy cheaper to add later, but it needs hook classification work.
- **"Bee Box is updating" message from `bbx`** (issue direction 3): with the
  switch, no `bbx` run sees a partial tree, so the message has little left to
  explain.
- **Moving converge or health checks out of the window**: they need the
  maintenance controller's closed boxes.
- **Reverting root helpers and sudoers on rollback**: see preferences.
- **Removing the stale stage entries** (`agent-doctest`, `browse` in
  `/opt/beebox.deploy-stage`): harmless once `prepare` copies only `SHIPPED`.
- **A provisioned-host test harness for `deploy.sh`**: proposed for the
  supervised first run instead (see Rollout).

## Open design questions

- Should the first switch-over run supervised with `BBX_DEPLOY_NOTIFY` and a
  person watching `deploy/.last-deploy.log`, or on a Hetzner probe VM first?
  Lean: supervised production run right after a quiet period. The Lima
  rehearsal covers the helper on real Ubuntu, and Track A plus the automatic
  rollback bound the damage. A probe VM costs money and needs the
  boxholder's yes.

## Knowledge audits

Skip: purely infrastructural. No box agent or dev agent learns a new concept;
`deploy/AGENTS.md` gains the `--rollback` command.

## What will hold this after it ships

- `test/scripts/deploy-releases/{layout,prepare,rollback}.test.ts`
  (`t.check`, temp directories, a stub install command passed as
  `InstallOptions`): legacy conversion, switch and `previous`, prune
  keep-set including in-use releases, command-line parsing for in-use
  releases, rollback refusals (no previous, failed mark, `--from` mismatch,
  applied-but-unknown migration, unreadable manifest or migration list), a new
  migration no box applied allowing rollback, history carry-forward and its
  20-entry cap, install retry only on a kill.
- `deploy.sh` has no test tier; the rehearsal and the first supervised run
  cover it. Adding a harness is not in scope.

## Implementation order

1. Track A (one commit, can land alone).
2. Track B helper + tests.
3. Track C activation path.
4. Track D `--rollback`: deferred (see Track D).
5. Track E docs; Lima rehearsal; cross-model diff review.

## Rollout shape

Done when `release.test.ts` passes, `pnpm typecheck` and `pnpm layout-check`
pass, `bash -n` and shellcheck pass on `deploy.sh`, and the Lima rehearsal
passes: prepare the real `SHIPPED` set from a local build on Ubuntu, convert a
legacy dir, keep a long-running `node` process started from release A alive
across the switch to B, start a fresh `bbx --version` that reports B, roll
back, prune.

**The first real switch-over** (the developer decides when):
- Land the branch when no box work is running; watch
  `deploy/.last-deploy.log`.
- Expect "prepare" output (about 30 s install) before the window, then
  "Deploy window: down Ns" smaller than the recent 63–124 s.
- Check: `deploy/prod-ssh 'readlink /opt/beebox; readlink
  /opt/beebox.releases/previous; cat /opt/beebox/beebox/deploy-info.json'`,
  then `bin/deploy-status`.
- If the deploy fails before the switch, nothing changed. If it fails after,
  the trap returns to the legacy tree. Manual fallback: `deploy.sh
  --rollback`, or on the server `mv` the legacy tree back.
- Disk after the first deploy: about +2.6 GB (legacy tree kept as
  `previous`), reclaimed by the third deploy's prune.

No data migration; no box changes shape.

## Rehearsal (Lima Ubuntu 24.04 VM, arm64, 2026-11-13)

`scratch/rehearse-releases.sh` (not tracked) ran the helper as root on a local
VM against the last deploy's build output: prepare with a real frozen install
of the `SHIPPED` set (55 s, 2.5 GB), legacy conversion, `bbx --version` through
the link, a process started from release A that lazy-loads a `dist/cli-*.mjs`
chunk after the switch to B, in-use detection from `/proc`, pruning, the
rollback guard against applied manifests, rollback, the failed mark, and the
legacy tree pruned at the third prepare. All checks passed after one
expectation was corrected (pnpm creates `node_modules` for absent workspace
members). Not rehearsed: `deploy.sh` end to end, the activation trap, and
systemd. The generated activation and CONTROL scripts were syntax-checked and
shellchecked locally.

## Cross-model plan review (codex gpt-6-sol, round 1, 2026-11-13)

Adjudication of the seven findings:

1. First switch not atomic: accepted as a documented one-time risk (Failure
   modes). Fixing it needs `renameat2(RENAME_EXCHANGE)`, which neither Node
   nor the host's coreutils exposes.
2. Prune can delete an in-use release: fixed; prune keeps releases a running
   process names.
3. Automatic rollback leaves new units: fixed; the trap re-runs
   `install_units`.
4. Guard reads source names, not applied migrations: fixed; the guard reads
   the boxes' manifests and fails closed when one is unreadable.
5. Partial switch confuses the trap: fixed; `previous` is written first, the
   legacy tree is restored on failure, and the trap reads the real link.
6. No integration rehearsal of failure paths: accepted; see Open design
   questions and Rollout.
7. Cut `status` and failed marks: partly rejected. The failed mark stops a
   manual rollback after an automatic one from returning to the failed
   release. `status` is two lines.

## Cross-model diff review (codex gpt-6-sol, round 1, 2026-11-13)

1. A box with no manifest counted as "applied nothing": fixed; a box (a
   `box/.git`) without a manifest refuses rollback.
2. First cutover not atomic: the same accepted one-time exception as in the
   plan review; raised to the boxholder.
3. The legacy switch wrote `previous` after the live link: fixed; `previous`
   is written first and both are restored if the live link fails.
4. A failed switch lost the old `previous`: fixed; it is restored (tested).
5. Rollback leaves drop-ins the failed release added: accepted (Failure
   modes).
6. A hanging `/healthz` could hold the poll for over an hour: fixed with one
   180 s deadline.
