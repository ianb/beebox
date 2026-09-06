---
title: "Container-first install: a published image, a self-updating deployment directory, and a box that converges on start"
status: draft
workstream: container-first
issues:
  - ../../../issues/features/2026-09-06-container-install-is-the-primary-path.md
---
# Container-first install

A new user installs Bee Box by pulling a published image. They never clone
the repository. Three things move at different speeds on their machine: the
image (engine, tools, and container logic, one version number), the
deployment directory (a handful of host-side files the image writes and
refreshes), and the box (their data, a git repository only they own). This
plan makes each of the three update on its own terms and makes the seams
between them explicit.

- *When I want to try Bee Box, I want to run three commands in an empty
  directory, so I can have a box open in a browser without a toolchain.*
- *When a release comes out, I want to run one command, so my box moves to
  the new engine with its data migrated and committed, and I can see what
  happened.*
- *When an update breaks something, I want to go back, so I keep working
  while the problem is sorted out.*
- *When I use Codex rather than Claude, I want the container to work the
  same way, so the engine choice is mine.*

**Issues addressed:**
[container-install-is-the-primary-path](../../../issues/features/2026-09-06-container-install-is-the-primary-path.md)
(the direction this plan implements).
Related, not closed by this plan:
[installation-remaining-work](../../../issues/features/2026-07-19-installation-remaining-work.md)
(rung 6 is built here; items 1, 2, 4, 5 stay manual-testing),
[release-discipline-and-update-story](../../../issues/decisions/2026-07-20-release-discipline-and-update-story.md)
(this plan settles tags versus main and the minimum release ritual; release
notes and update discovery stay open there),
[soft-launch-posture](../../../issues/decisions/2026-07-20-soft-launch-posture.md)
(gate 3, the README front door, is reshaped here in structure; the
boxholder's paragraphs are his),
[detect-server-update-prompt-client-reload](../../../issues/features/2026-08-03-detect-server-update-prompt-client-reload.md)
and
[stale-web-bundle-detection](../../../issues/features/2026-08-12-stale-web-bundle-detection.md)
(a stamped engine version gives both a real identity to compare against; not
built here). Searched the queue for `ghcr`, `published image`, `codex login`,
`compose`, `bbx upgrade`, `version pin`: nothing else.

## Stated preferences this plan trades against

- `docs/engineering-principles.md` 4 (resilient and never silent), 6
  (right-sized defensiveness), 7 (hierarchy is a discoverability contract),
  8 (one way to do each thing), 12 (the maintainer is usually an agent), 13
  (a control shows the state the system is in).
- `docs/implemented-plans/boxes-as-packages-v2.md:26`: *"Versioning — per-box
  pinning is the mechanism; the fleet staying current is policy"*. This plan
  keeps that for from-source and hub installs and does NOT use it in the
  container. In a one-box container the image tag is the pin. The trade is
  named under "Could this be simpler?".
- `src/cli/commands/upgrade.ts:8-9`: *"the Ghost lesson: code and data revert
  as ONE unit"*. Every rollback step in this plan is checked against it.
- `src/core/migration-sweep.ts:16`: *"A dirty box is skipped, not migrated.
  Auto-committing would sweep someone's in-flight work into a migration
  commit."* This plan adds one deliberate exception, the checkpoint commit,
  and says why.
- `docs/plans/installation-story.md:434`: the entrypoint contract, *"args =
  exec, no-args = check + serve"*, kept unchanged.
- The most recent shipped precedent for unattended per-box convergence is
  `deploy/deploy.sh:713-716` (sweep then docs refresh, never fails the
  deploy) and its container copy at `docker/entrypoint.sh:124-125`.
- Soft-launch posture: *"one blessed deploy happy path"* and *"the front door
  reads as a message from the boxholder"*
  (`issues/decisions/2026-07-20-soft-launch-posture.md`, Decisions).

## What already exists

Reused as is:

- **The image and its lifecycle.** `docker/Dockerfile` (two stages, both
  `FROM node:24-bookworm-slim`, `:19` and `:48`), the argv-forwarding
  `docker/entrypoint.sh`, `docker/compose.yaml`, the Caddy profile, the
  Tailscale sidecar overlay. All move to `container/`; the build and runtime
  stages stay.
- **`bbx migrate --sweep`** (`src/core/migration-sweep.ts`): script-kind
  only, one commit per migration with a `Created-By: migration-sweep`
  trailer (`:126`), `skipped-dirty` on a dirty tree (`:96`),
  `needs-procedure` when it reaches an agent-driven migration (`:101`). The
  manifest is tracked (`src/core/migrations.ts:161`:
  `MANIFEST_PATH = "_config/migrations.jsonl"`), so a git reset reverts the
  record with the data.
- **`bbx docs refresh`** (`src/core/docs-refresh.ts:5-6`, `:24-27`):
  cache-gated on the engine version, commits template-managed paths, skips a
  dirty box.
- **`bbx upgrade`'s snapshot-and-revert shape** (`upgrade.ts:259`
  `const snapshotSha = await getHead(boxRoot);`, `:302` `revertUpgrade`,
  typecheck at `:284-290`, commit with an `Upgraded-To` trailer at
  `:295-298`). The container cannot use the command itself: its dependency
  swap (`:264`, `pnpm install` of a new spec) has nothing to swap in a
  single-engine image. Its structure is copied into `bbx converge`.
- **The engine-link health check** (`src/webapp/trpc/routers/health-engine.ts`)
  and `runHealthChecks` (`src/webapp/trpc/routers/health.ts:217`): the home
  for the new converge-state check.
- **`bbx activity`** (`src/cli/commands/activity.ts:10`: *"Exit 0 = at rest.
  Exit 1 = busy"*) and its caller `deploy/server-bin/bbx-wait-quiet:17-19`
  (180 s cap, poll every 10 s). `activity` reads every configured box from
  `loadBoxesConfig()` (`:21`) and takes no path; the container has one box
  and no boxes config, so it gains an optional path argument.
- **The symlinked-engine box shape.** `src/core/box/package.ts:147-151`:
  *"when `node_modules/` is absent, it symlinks `node_modules/beebox`
  straight at the running engine's own `PACKAGE_ROOT`"*, and production's
  `link:/opt/beebox/beebox` dependency (`deploy/deploy.sh:405`). The
  container adopts `link:` (below).
- **Codex is already in the image.** `@openai/codex` is a runtime dependency
  (`package.json:120`), resolved by `src/services/codex-binary.ts:11`
  (`require.resolve("@openai/codex/bin/codex.js")`), so the Admin → Codex
  device flow (`deploy/README.md:417-419`) works in-container today. Missing:
  an operator `codex` on PATH (production: `deploy/deploy.sh:558`) and a
  persisted `CODEX_HOME`.
- **A GitHub Actions workflow** (`.github/workflows/pages.yml:3-6`, push to
  main) and the `ianb/beebox` remote. The image workflow is a second file.
- **The smoke harnesses**: `docker/smoke-docker.sh`, `docker/smoke-vps-install.sh`
  (dind), `docker/smoke-dev-install.sh`, and `scripts/smoke-upgrade.ts:238-241`
  (`bbx upgrade --to file:<second tarball>`, one hop).
- **`scripts/release.ts`** builds the tarball (`:83`, `pnpm pack`) and never
  writes `version` (verified: no write to `package.json`). `package.json:3`
  is `"version": "0.1.0"` and there are no git tags (`git tag | wc -l` = 0).

Rebuilt, with reason:

- The entrypoint's converge block (`entrypoint.sh:111-125`) becomes a call
  to `bbx converge`, so the policy lives in the engine where doctests reach
  it (principle 10), not in shell.
- The first-run guard `entrypoint.sh:70` (`if [[ ! -d "$BOX_ROOT/node_modules" ]]`)
  goes: with a `link:` engine the box-local install happens once in
  `bbx-setup`, offline.

## Prior art (external)

- Compose: with `image:` and `build:` both set, `up` pulls before it builds;
  `pull_policy` controls it. This plan avoids the question: the user's
  compose file has `image:` only.
  https://docs.docker.com/reference/compose-file/services/
- Compose `stop_grace_period` defaults to 10 s (SIGTERM, then SIGKILL).
  Same URL.
- Only the project-directory `.env` interpolates into the compose file;
  `env_file:` entries reach the container, not the file. So the version pin
  lives in `.env`.
  https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/
- `docker/metadata-action`: `type=semver,pattern={{version}}` from a `v*`
  tag, `latest` via `flavor` auto, `type=edge` on the default branch.
  https://github.com/docker/metadata-action
- Native arm64 hosted runners (`ubuntu-24.04-arm`) are free for public
  repositories; Docker documents one job per platform on native runners and
  a manifest merge step.
  https://github.blog/changelog/2025-08-07-arm64-hosted-runners-for-public-repositories-are-now-generally-available/
  https://docs.docker.com/build/ci/github-actions/multi-platform/
- GHCR packages are **private by default**, even from a public repository.
  The `org.opencontainers.image.source` label links the package to the repo.
  One manual visibility change by the boxholder is part of the rollout.
  https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry
- Codex CLI honors `CODEX_HOME` (default `~/.codex`) and
  `codex login --device-auth` prints a URL plus a one-time code.
  https://github.com/openai/codex/blob/main/codex-rs/login/src/device_code_auth.rs
- Claude Code's native installer accepts a version (`bash -s 2.1.263`),
  installs under `~/.local/share/claude/versions/`, and auto-updates unless
  `DISABLE_AUTOUPDATER` is set.
  https://code.claude.com/docs/en/setup
- Immich publishes `docker-compose.yml` and `example.env` as release assets;
  update is `docker compose pull && docker compose up -d`; breaking changes
  are a release-notes category and sometimes require re-downloading the
  compose file. This plan's `bbx-setup` exists to remove that last manual
  step.
  https://docs.immich.app/install/docker-compose/
- Nextcloud AIO's mastercontainer manages the stack from inside a container;
  the closest pattern to an image that writes host-side files. No pattern
  found in Gitea, Mastodon, or Home Assistant for "image refreshes the host's
  compose file".
  https://hub.docker.com/_/nextcloud
- Ghost-CLI #699: `--rollback` reverted code, not the migrated database.
  https://github.com/TryGhost/Ghost-CLI/issues/699
- pnpm: `--offline` installs from the store; `store-dir` is set in `.npmrc`;
  since pnpm 11.4 a tarball integrity mismatch is a hard error (one more
  reason to drop the `file:` tarball spec).
  https://pnpm.io/settings/store https://github.com/pnpm/pnpm/releases/tag/v11.4.0
- git-lfs: after `git reset --hard`, LFS files can be left as pointers;
  `git lfs checkout` resolves them. The rollback text says so.
  https://github.com/git-lfs/git-lfs/issues/3100

## Tracks / scope

### Track A — Engine identity and the release ritual

- **What.** Every image carries a distinct engine version string, and a
  release is a tag the boxholder cuts on purpose.
- **Why this needs to change.** `package.json:3` is `0.1.0` forever, so the
  mismatch report in `src/core/engine-version.ts:66` can never fire, and
  nothing distinguishes two images. The release-discipline issue asks
  whether users track main or tags; with a published image, `latest`
  tracking main would move a stranger's box several times a day.
- **Direction.**
  - Version string, one grammar, validated with a zod regex at every read
    (principle 3): `MAJOR.MINOR.PATCH` for a release; `MAJOR.MINOR.PATCH+edge.<sha7>`
    for a main build; `MAJOR.MINOR.PATCH+local.<sha7|unknown>` for a local
    build. Build metadata never affects ordering; the core triple does.
    `src/lib/engine-version-id.ts` exports `parseEngineVersion` and
    `compareEngineCore`. No `semver` dependency: it is transitive only
    (`pnpm-lock.yaml:8346`), and the grammar is ours.
  - `bin/release <MAJOR.MINOR.PATCH>` on a clean `main`: writes
    `beebox/package.json` `version`, commits `Release vX.Y.Z`, tags
    `vX.Y.Z`, pushes the commit and the tag. The existing post-commit hook
    deploys production from that commit, which is what a release means.
  - `container/Dockerfile` takes `ARG BEEBOX_VERSION` and applies it to
    `beebox/package.json` in the build stage before `pnpm release`, so the
    tarball, `/app/node_modules/beebox/package.json`, and the OCI label
    `org.opencontainers.image.version` agree. Also labels
    `org.opencontainers.image.source=https://github.com/ianb/beebox` and
    `org.opencontainers.image.revision`.
  - `.github/workflows/image.yml`: on `push` to `main` and on tags `v*`;
    one build job per platform (`ubuntu-24.04` for amd64, `ubuntu-24.04-arm`
    for arm64), then a manifest merge; tags from `docker/metadata-action`:
    `type=semver,pattern={{version}}` plus `latest` on a tag, `type=edge` on
    main. Pushes to `ghcr.io/ianb/beebox` with `GITHUB_TOKEN`.
  - `docker build --pull` in the workflow so base-image patches arrive with
    each release.
- **Vocabulary lock-ins.** `ghcr.io/ianb/beebox`; tags `X.Y.Z`, `latest`,
  `edge`; the version grammar above; `bin/release`.
- **First implementation chunk.** `src/lib/engine-version-id.ts` with its
  doctest; `bin/release`; the `ARG BEEBOX_VERSION` stamping in the
  Dockerfile; the workflow file. The first tag is `v0.1.0`, matching the
  current version string.

### Track B — `container/`: the image, `bbx-setup`, and the deployment template

- **What.** `beebox/docker/` becomes the top-level `container/` project:
  Dockerfile, entrypoint, `bbx-setup`, the deployment template, the smoke
  harnesses, the user-facing install guide. The image gains Codex on PATH
  with persisted credentials, a pinned Claude CLI, an offline box install,
  and a `link:` engine.
- **Why this needs to change.** A directory named `beebox/docker` inside the
  engine package says the container is a detail of the engine (principle
  7); it is its own project that consumes the engine as a tarball. Codex is
  in the image but `~/.codex` is not on a volume, so a Codex login dies with
  the container. The box's `file:/app/beebox.tgz` dependency
  (`Dockerfile:102`) copies the engine into the box and is never refreshed
  (`entrypoint.sh:70`), so after an image update the box's schemas compile
  against the previous engine while the new one serves them.
- **Direction.**
  - Layout: `container/Dockerfile`, `container/entrypoint.sh`,
    `container/bbx-setup`, `container/deployment/` (the files
    `bbx-setup` writes: `compose.yaml`, `Caddyfile`,
    `compose.tailscale.yaml`, `tailscale-serve.json`, `update`,
    `.env.example`, `tailscale.env.example`, `.gitignore`, `README.md`),
    `container/smoke/` (the three harnesses plus the new update harness),
    `container/README.md` (the install and update guide, replacing
    `beebox/docs/docker-install.md`), `container/CLAUDE.md` (a short map).
  - Engine link: `ENV BBX_INIT_BEEBOX_SPEC=link:/app/node_modules/beebox`
    replaces the `file:` spec. The box's `pnpm install` then resolves
    `beebox` by symlink and only `react`, `react-dom`, `typescript`, and the
    `@types/*` from the store. The image installs those into `/app` at build
    (same ranges `readEngineVersions()` writes, `package.ts:190-210`) with a
    global `store-dir=/app/pnpm-store`, so the box install runs
    `pnpm install --offline`. The smoke harness runs that step with
    `--network none`.
  - Codex: `ENV CODEX_HOME=/app/codex-config`, a `codex-auth` named volume
    on it (the `claude-auth` pattern, `compose.yaml:33`), and
    `/usr/local/bin/codex` symlinked to the resolved
    `@openai/codex/bin/codex.js` under `/app` (production's shape,
    `deploy.sh:558`). The operator flow is
    `docker compose run --rm box codex login --device-auth`; the readiness
    message `auth-preflight.ts:40` already names that command.
  - Claude CLI: install a pinned version (`bash -s <version>`) and set
    `DISABLE_AUTOUPDATER=1`, so an image is reproducible; the pin is bumped
    where the SDK pin is reviewed (`3ad20ac9a`, the `sdk-update` schedule).
  - `bbx-setup` (shell, in the image, on PATH; the `bbx-wait-quiet` naming
    precedent): with `/deploy` mounted, it writes every file in
    `container/deployment/` into `/deploy`, overwriting only files it owns,
    never `.env`, `compose.override.yaml`, `tailscale.env`, or `data/`;
    creates `.env` from the example when absent and sets
    `BEEBOX_VERSION=<this image's version>`; `git init`s the directory when
    it has no `.git` and commits the owned files as
    `Deployment files from beebox <version>`; then, when `/deploy/data/box`
    holds no box, runs `bbx init /deploy/data/box` and the offline box
    install. Idempotent: running it twice changes nothing. It refuses to run
    without `/deploy` mounted.
  - `deployment/compose.yaml`: `image: ghcr.io/ianb/beebox:${BEEBOX_VERSION:?set BEEBOX_VERSION in .env}`,
    no `build:`; `stop_grace_period: 120s`; `environment: BBX_DEPLOY_SHAPE: "1"`;
    the `codex-auth` volume; everything else as today. Contributors build
    `docker build -f container/Dockerfile -t ghcr.io/ianb/beebox:local .`
    and set `BEEBOX_VERSION=local`; there is no second compose file.
  - `deployment/update [X.Y.Z|edge]`: waits for quiet
    (`docker compose exec box bbx activity /data/box`, 180 s cap, only when
    the box is running); pulls the target (`latest` when no argument, then
    reads the image's `org.opencontainers.image.version` label and writes
    that as the pin, so the pin is always a concrete version); runs
    `docker compose run --rm --no-deps -v "$PWD:/deploy" box bbx-setup`;
    `docker compose up -d`; prints `docker compose exec box bbx status`.
    Editing `.env` touches exactly the `BEEBOX_VERSION=` line.
  - Ownership note stays; the UID reconciliation in
    `smoke-vps-install.sh` is unchanged.
- **Vocabulary lock-ins.** `container/`; `/deploy` mount; `bbx-setup`;
  `BEEBOX_VERSION`; `BBX_DEPLOY_SHAPE`; `codex-auth`; the owned-file list.
- **First implementation chunk.** `git mv beebox/docker container` with
  path fixes and the guide moved to `container/README.md` (doc-check clean);
  then the Dockerfile changes (link spec, store, Codex, Claude pin, labels)
  verified by `container/smoke/smoke-docker.sh`. `bbx-setup`, the
  deployment template, and `update` are the second chunk.

### Track C — `bbx converge`: the box follows the engine, in one revertible step

- **What.** One engine command that brings a box onto the engine serving it:
  checkpoint, migrate, refresh docs, typecheck, record; and refuses to run a
  box backwards.
- **Why this needs to change.** The entrypoint runs the sweep and docs
  refresh (`entrypoint.sh:124-125`) with no snapshot and no typecheck, so a
  box whose views break under a new engine finds out at first render. There
  is no record of which engine a box last converged onto, so serving a
  forward-migrated box from an older image is silent. The dirty-box skip
  (`migration-sweep.ts:96`) is right for a live production fleet; in a
  container the alternative to converging is serving unconverged with no
  one watching.
- **Direction.**
  - `bbx converge [boxRoot]`, `src/cli/commands/converge.ts` over
    `src/core/converge.ts`. The decision core is a pure function over
    `{ serving, recorded, treeClean }` returning
    `"refuse-backwards" | "current" | "checkpoint-then-converge" | "converge"`,
    so the doctest tiers reach it (principle 10).
  - Record: `_config/engine.json`, tracked, written only inside the converge
    commit: `{ "engineVersion": "1.4.0", "convergedAt": "<box time>", "snapshot": "<sha>" }`
    where `snapshot` is HEAD before this converge. A git reset to `snapshot`
    reverts the record with the data (the Ghost lesson, kept by
    construction). Absent record: treated as older than any engine, no
    refusal (fresh box, or a box from before this plan).
  - Steps, in order: (0) read `serving` from `PACKAGE_ROOT/package.json` and
    `recorded` from `engine.json`; equal strings: exit 0 silently. Core
    triple of `recorded` newer than `serving`: exit 3 with the refusal text
    (below) and touch nothing. (1) Dirty tree: `git add -A` and commit
    `Checkpoint before engine <serving>` with `Created-By: bbx-converge`.
    (2) `snapshotSha = HEAD`. (3) The sweep as it exists, script-kind only,
    one commit per migration; `needs-procedure` is recorded as pending, not
    a failure. (4) `bbx docs refresh`. (5) Typecheck the box's `src/` the
    way `upgrade.ts:284-289` does. (6) On success: write `engine.json`,
    commit `Converge onto beebox <serving>` with `Converged-To: beebox@<serving>`,
    delete `.beebox/converge-failure.json` if present, exit 0. On any
    failure in 3 to 5: `git reset --hard <snapshotSha>` plus clean, as
    `revertUpgrade` does (`upgrade.ts:185-195`), write
    `.beebox/converge-failure.json` `{ engineVersion, step, snapshot, output, at }`
    (machine-local; `.beebox/` is gitignored, `src/core/box/index.ts:255`),
    exit 2. The checkpoint commit is not reverted: it is the user's work.
  - Refusal text (exit 3): names both versions, the two ways out, and the
    exact commands: `./update <recorded version>` or
    `git -C data/box reset --hard <snapshot> && git -C data/box lfs checkout`
    (the LFS caveat above).
  - `bbx activity [boxRoot]`: an optional path; with it, only that box is
    inspected.
  - Surfacing (principle 13): a `converge` health check in
    `health-engine.ts` reading `engine.json` and `converge-failure.json`:
    a failure record is a warning naming the step and the first lines of
    output plus the recovery; a pending procedure migration is a warning
    naming it. `bbx status` prints the same two lines after its Engine
    line (`status.ts:37-42`).
- **Vocabulary lock-ins.** `bbx converge`; `_config/engine.json`;
  `.beebox/converge-failure.json`; trailers `Created-By: bbx-converge` and
  `Converged-To`; exit codes 0 current or converged, 2 failed and reverted,
  3 refused.
- **First implementation chunk.** `src/core/converge.ts` with the pure
  decision function and the version record read/write, plus
  `test/core/converge.doctest.md` covering the four decisions and the
  refusal on a newer record. The orchestration and the CLI command follow.

### Track D — The entrypoint

- **What.** No-args start becomes: deployment-shape check, readiness check,
  `bbx converge`, serve.
- **Why this needs to change.** The entrypoint has no way to know the user's
  compose file predates the image, and its converge block is shell that
  cannot snapshot or typecheck.
- **Direction.** Before the readiness check: `BBX_DEPLOY_SHAPE` must equal
  the image's constant (`1`); absent or different exits 1 with
  `run ./update again, or: docker compose run --rm -v "$PWD:/deploy" box bbx-setup`.
  Readiness check unchanged (`entrypoint.sh:50-62`), except the recovery
  command now names `bbx-setup`. Then `bbx converge /data/box`: exit 0 or 2
  serves; exit 3 exits the container with the refusal text (the box is
  newer than the engine; serving would be the Ghost failure). Then
  `exec bbx serve` as today (`:130`). `BBX_SKIP_CONVERGE=1` keeps its
  meaning. Argument forwarding is untouched.
- **Vocabulary lock-ins.** none beyond Tracks B and C.
- **First implementation chunk.** The whole track is one commit, verified
  by `smoke-docker.sh`.

### Track E — The front door and the docs read from the container user's chair

- **What.** The README, the site card, and the install docs lead with the
  image; from-source is the contributor path.
- **Why this needs to change.** `README.md:13-17` lists the from-source
  guide first; `site/cards/index.site-page.card:20-21` does the same;
  `agent-install.md:28-29` says the engine is *"this repository (or a
  Docker image built from it)"*; `developer-install.md:1-6` presents Docker
  as an alternative. The docker README table still says
  `bbx serve /data/box/content` (`docker/README.md:11`).
- **Direction.**
  - Root README, in order: one paragraph in the boxholder's voice (what
    this is, whom it is for, that it runs on their Claude or ChatGPT
    subscription and spends that quota); "Run it" with the three commands
    and a link to `container/README.md`; "What leaves your machine"; bug
    reports and Discord; "For contributors" holding today's Layout and Dev
    sections and the from-source guide; License. The two voice paragraphs
    are written as `<!-- boxholder: ... -->` placeholders with the facts
    they must carry, not drafted in his voice.
  - `site/cards/index.site-page.card:18-31`: image first, from-source
    under a contributor line; the agent prompt points at
    `container/README.md`.
  - `agent-install.md`: the engine is a published image; the Docker path
    is the default and the from-source path is offered only when the user
    says they want to hack on the code.
  - `developer-install.md`: first paragraph names itself the contributor
    path.
  - `container/README.md`: the guide, rewritten around `bbx-setup`,
    `update`, the three roots, the rollback procedure with the LFS note,
    both engines' login commands, and the checklist sections kept.
  - Every install doc reviewed for a step that assumes a checkout.
    Searched `src/frontend` for `git clone`, `pnpm`, `checkout`: no
    first-run screen text assumes one (only two unrelated component hits).
- **Vocabulary lock-ins.** "the deployment directory", "the box", "the
  image" as the three names used in every doc.
- **First implementation chunk.** `container/README.md`, since Tracks B to
  D are its spec. README, site card, and agent-install follow once the
  commands are verified.

### Track F — Verification

- **What.** Harnesses that prove the stranger's path and the update path,
  and the manual items the boxholder clears.
- **Why this needs to change.** `smoke-docker.sh` and `smoke-vps-install.sh`
  script today's `bbx init` flow; nothing exercises an update against a box
  with code, a dirty tree, or a version skip; nothing runs a box install
  without network.
- **Direction.**
  - `smoke-docker.sh`: build with `--build-arg BEEBOX_VERSION=0.1.0+local.test`,
    then the stranger's sequence: `bbx-setup` into a scratch directory,
    `--network none` for the box install step, `up`, 200, teardown.
  - `smoke-update.sh` (new): build two images from the same tree with
    versions `0.1.0+local.a` and `0.1.0+local.b`, plus a third stamped
    `0.0.9`. Scenario 1: box with a seeded schema (the `WIDGET_SCHEMA` in
    `smoke-upgrade.ts:43-49`) and a dirty file, `update` to `b`: expect a
    checkpoint commit, a converge commit, `engine.json` at `b`, 200.
    Scenario 2: seed a schema that cannot typecheck, `update`: expect exit 2
    in the log, HEAD equal to the snapshot, `converge-failure.json` present,
    200, the health warning in `/healthz`. Scenario 3: pin `0.0.9`: expect
    the container to exit 3 with the refusal; run the printed reset; expect
    it to start. Scenario 4: `BBX_DEPLOY_SHAPE` removed from the compose
    file: expect exit 1 naming `bbx-setup`.
  - `smoke-vps-install.sh`: the in-dind sequence uses `bbx-setup`; the
    Caddy profile check stays.
  - The workflow is verified by its first run on `main` (`edge`) and by the
    `v0.1.0` tag; a scratch `docker compose pull` of both from a machine
    that has never built the image.
  - Manual, boxholder: make the GHCR package public; run the interactive
    `claude auth login` and `codex login --device-auth` in-container once
    each; the ACME and Tailscale items in the ledger keep their status.
- **First implementation chunk.** `smoke-docker.sh` rewritten against
  Track B's first chunk.

## Could this be simpler?

The simplest version: keep the clone-and-build image, flip the README
order, add the Codex volume, and change nothing in the update path. It
fails the boxholder's direction on its face: a stranger's first step is
still cloning a monorepo and building a 2 GB image, which is the developer
path with extra steps.

The next simplest: publish the image and a compose file to download, Immich
style, and keep today's entrypoint. It fails on the update path. The box's
engine copy is never refreshed (`entrypoint.sh:70`), so every update serves
a box compiled against the previous engine, silently (principle 4). And a
changed compose file is a manual re-download nobody is told about.

What the fuller plan buys, per principle:

- `link:` instead of the tarball and a start-time converge: the box's code
  and the serving engine cannot differ (principle 6: the mismatch state
  becomes unrepresentable rather than flagged). This is the deliberate
  departure from per-box pinning (`boxes-as-packages-v2.md:26`); the pin
  moves to the one place a container user already controls, the image tag.
- `bbx-setup` writing the deployment files: the files and the image cannot
  skew, and `BBX_DEPLOY_SHAPE` makes an old compose file a loud failure
  (principle 4).
- The version record and the backwards refusal: the Ghost failure is
  refused, not documented (principle 12).
- The checkpoint commit: the exception to `migration-sweep.ts:16` exists
  because the container has one engine; a skipped box would be served
  unconverged by that engine anyway. A checkpoint keeps the work visible in
  the user's history with a name that says what it is.

Dropped from earlier drafts as over-built: a separate container version
number (one image, one version); a `compose.build.yaml` for contributors
(a local tag does it); an `update --rollback` (two documented commands);
release notes and an update-available check (their own decisions).

## Subplans

none. The release ritual is small enough to live in Track A; release notes
are out of scope.

## Failure modes

> **Critical gap:** a box whose own code fails to typecheck under the new
> engine is served by that engine anyway, reverted and unconverged. There
> is no old engine in the image to serve it with. Handled by the failure
> record, the health warning, and the refusal to hide it; accepted as the
> single-engine trade, and stated in the guide.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Image pulled is older than the box's `engine.json` (rollback, or `edge` behind a release) | Track F scenario 3 | converge exit 3, container exits with the two ways out | clear |
| Dirty tree at converge | Track F scenario 1 | checkpoint commit, then converge | clear (commit named) |
| Box code fails typecheck under the new engine | Track F scenario 2 | reset to snapshot, failure record, health warning, serve | clear |
| A script migration fails mid-sweep | sweep doctests today | sweep stops, converge reverts to snapshot, failure record | clear |
| A procedure migration is pending | converge doctest | recorded pending, health warning, serve | clear |
| Restart lands mid-commit, orphan `.git/index.lock` | none | `update` waits for quiet; `stop_grace_period: 120s`; `git-stale-lock.ts` recovers an abandoned lock | clear (lock recovery logs) |
| User's compose file predates the image (`BBX_DEPLOY_SHAPE` absent or old) | Track F scenario 4 | entrypoint exit 1 naming `bbx-setup` | clear |
| `bbx-setup` run without `/deploy` mounted | smoke-docker | refuses with the mount command | clear |
| `bbx-setup` on a directory with a `.env` lacking `BEEBOX_VERSION` | smoke-docker | adds the line; compose `:?` fails loudly otherwise | clear |
| `update` with no argument on a machine that cannot reach GHCR | none | `docker pull` fails; script exits before touching `.env` | clear |
| Box install offline lacks a package (store incomplete) | smoke-docker `--network none` | `pnpm install --offline` fails at `bbx-setup` | clear |
| Codex login lost across container recreation | manual (boxholder) | `codex-auth` named volume | clear (`auth-preflight.ts:40` message) |
| Claude CLI pinned version no longer installable | build fails | none beyond the failed build | clear |
| GHCR package left private | first `docker pull` by a stranger 401s | manual visibility change in rollout | clear |
| Workflow tags `latest` on a tag the boxholder did not mean as a release | none | `bin/release` is the only tagger; a hand tag is the operator's act | silent (documented) |
| Two `update` runs at once | none | `docker compose` serializes container ops; `git` in the box has the box lock | partly silent, accepted |
| LFS content left as pointers after the documented reset | none | the refusal text and guide include `git lfs checkout` | clear |
| `engine.json` hand-edited to a wrong version | converge doctest (zod parse) | parse failure is a converge failure with the record named | clear |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field**: ADDRESSED. The only user-typed values are
  `BEEBOX_VERSION` (compose fails on an unpullable tag) and `update`'s
  argument (validated against the version grammar before anything runs).
- **Stale ref**: ADDRESSED. `engine.json`'s `snapshot` can point at a commit
  the user has since rewritten; the refusal text prints the SHA and the
  reset fails loudly if it is gone.
- **Two agents touching the same card**: ADDRESSED. Converge runs before
  serve, so no agent is live; `update` waits for quiet first.
- **Hand-edit drift**: ADDRESSED for `engine.json` (zod at read); for
  `compose.yaml` the next `bbx-setup` overwrites it, which the guide
  states, and user changes belong in `compose.override.yaml`.
- **Fabricated free-form value**: not applicable; no agent writes any of
  these files.
- **Validation error UX**: ADDRESSED. Each refusal prints the command that
  fixes it; `bbx status` and the dashboard health show the same text.
- **Partial migration / transition state**: ADDRESSED. A box from before
  this plan has no `engine.json` and a `file:`-installed `node_modules`;
  converge treats the missing record as older than any engine, and
  `bbx-setup` replaces the box's `beebox` dependency with the `link:` spec
  on its first run against such a box (the one deliberate rewrite of a
  user-owned file, committed as part of the converge). Only the boxholder's
  own test installs are in this state.

## NOT in scope

- Release notes, a changelog, and an update-available signal in the box:
  the release-discipline issue keeps them; a version check is an egress
  question under "what leaves your machine".
- `bin/release` gating on tests or on a clean CI run: there is no CI beyond
  the site checks; the ritual is tag-and-build.
- Scheduled base-image rebuilds between releases: a release rebuilds with
  `--pull`; a cadence is a later decision.
- Moving production (`deploy/deploy.sh:713-770`) onto `bbx converge`: it
  would consolidate two converge loops (principle 8), but it touches the
  live fleet and needs its own verification; filed as a follow-up issue at
  implementation time.
- `bbx upgrade --to` and per-box pinning for from-source and hub installs:
  unchanged.
- Multi-box (hub) compose, the Windows/WSL2 stance, the macOS from-source
  walk, real ACME and Tailscale runs: the ledger items keep their owners.
- Publishing to npm: rung 6's other half; the image is the distribution.
- The README's voice paragraphs: placeholders with required facts; the
  words are the boxholder's (soft-launch posture, "Register").
- A client reload on engine change: the two filed issues; they get an
  identity to compare from Track A and nothing else here.

## Open design questions

- First release number: `v0.1.0` (lean) matches the current string; the
  boxholder may prefer to signal a fresh start with `v0.2.0`. Decided at
  the first `bin/release` call, nothing in the plan depends on it.
- Whether `edge` is documented for users at all, or mentioned only in the
  contributor section. Lean: contributor section only.
- Whether `bbx converge` runs on every container start or only when the
  version string differs. The plan says every start with an early exit on
  equal strings (cheap; and a box whose last converge failed retries at
  each restart, which is the visible-retry behaviour wanted).

## Knowledge audits

Skip-with-rationale: nothing here changes what a box agent is told. The
converge commit and checkpoint commit are visible in the box's git history
the agent already reads; the generated agent docs are refreshed by the
existing `bbx docs refresh` step.

## What will hold this after it ships

- Doctests reach the decisions: `test/core/converge.doctest.md` (the pure
  decision function, the record read/write, the four exit paths with a
  fake command runner as `upgrade.ts` uses), `test/lib/engine-version-id.doctest.md`
  (grammar and ordering, including build metadata not ordering).
- The harnesses hold the shell: `smoke-docker.sh` for the stranger's path,
  `smoke-update.sh` for the four update scenarios, `smoke-vps-install.sh`
  for the Caddy profile. They are local-run; the ledger's CI item stays
  open. Cost: each is minutes and a 2 GB build; `smoke-update.sh` builds
  three images from one tree, so it caches the build stage.
- `pnpm doc-check` holds the doc moves.
- No new test tier and no mock beyond the command-runner seam that
  `upgrade.ts:80` already established.

## Implementation order

1. Track A chunk 1: version grammar module and doctest; `bin/release`;
   Dockerfile stamping. No dependency.
2. Track C chunk 1: `src/core/converge.ts` decision core, record
   read/write, doctest. Depends on 1 for the grammar.
3. Track C chunk 2: orchestration, `bbx converge` and `bbx activity [box]`
   commands, health check, `bbx status` lines, doctests with the fake
   runner.
4. Track B chunk 1: `git mv` to `container/`, doc moves, Dockerfile
   (link spec, store, Codex, Claude pin, labels). Verified by
   `smoke-docker.sh` as it exists, on its new path.
5. Track D: entrypoint. Depends on 3 and 4.
6. Track B chunk 2: `bbx-setup`, `container/deployment/`, `update`.
   Depends on 5.
7. Track F: `smoke-docker.sh` rewritten, `smoke-update.sh`,
   `smoke-vps-install.sh` adjusted. Depends on 6. Run one harness at a
   time on this machine.
8. Track A chunk 2: the workflow file. Verified only after merge.
9. Track E: `container/README.md`, README, site card, agent-install,
   developer-install, docs index, the ledger's rung 6 entry. Depends on 6
   and 7 so the commands documented are the commands that ran.
10. Cross-model review, then the merge, then the boxholder's manual items.

## Rollout shape

Tests first: the converge doctest and the version-grammar doctest are
written with their tracks and must pass before the entrypoint changes.
Done-when for the code: `smoke-docker.sh` and all four `smoke-update.sh`
scenarios pass locally; `smoke-vps-install.sh` passes via dind; typecheck,
lint, and the affected doctests pass. Done-when for the release path: the
`edge` build succeeds on the first push to `main`, `v0.1.0` produces
`0.1.0` and `latest`, and a machine that never built the image completes
the three-command start from `container/README.md`. Migration approach:
none for user data; the only existing container boxes are the boxholder's,
and the first converge on one rewrites its `beebox` dependency to `link:`
as part of its converge commit. The boxholder clears: GHCR visibility, the
two interactive logins, and the README voice paragraphs.
