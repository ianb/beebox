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

Paths in this plan are relative to `beebox/` unless they start with
`<root>/` (the monorepo root) or `../../../` (a link).

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

- `docs/engineering-principles.md` 3 (validate at boundaries), 4 (resilient
  and never silent), 6 (right-sized defensiveness), 7 (hierarchy is a
  discoverability contract), 8 (one way to do each thing), 12 (the
  maintainer is usually an agent), 13 (a control shows the state the system
  is in).
- `docs/implemented-plans/boxes-as-packages-v2.md:26`: *"Versioning — per-box
  pinning is the mechanism; the fleet staying current is policy"*. This plan
  keeps that for from-source and hub installs and does NOT use it in the
  container. In a one-box container the image tag is the pin. The trade is
  named under "Could this be simpler?".
- `src/cli/commands/upgrade.ts:8-9`: *"the Ghost lesson: code and data revert
  as ONE unit"*. Every rollback step in this plan is checked against it, and
  the one thing outside the unit is named.
- `src/core/migration-sweep.ts:16`: *"A dirty box is skipped, not migrated.
  Auto-committing would sweep someone's in-flight work into a migration
  commit."* This plan adds one deliberate exception, the checkpoint commit,
  and says why.
- `docs/plans/installation-story.md:434`: the entrypoint contract, *"args =
  exec, no-args = check + serve"*, kept unchanged.
- `docker/entrypoint.sh:100-103` and `:107-110`: a box that needs a human
  *"is a box to look at, not a reason to leave the operator with no
  server"*, and *"'cannot stop the box from serving' is only true if it
  cannot hang either"*. Both policies are kept, with one named exception
  (the backwards refusal).
- The most recent shipped precedent for unattended per-box convergence is
  `deploy/deploy.sh:713-716` (sweep then docs refresh, never fails the
  deploy) and its container copy at `docker/entrypoint.sh:124-125`.
- `CLAUDE.md`, Time discipline: *"Long-running timeouts must count only awake
  time via `startAwakeTimeout` (`src/lib/awake-timeout.ts`)"*.
- Soft-launch posture: *"one blessed deploy happy path"* and *"the front door
  reads as a message from the boxholder"*
  (`issues/decisions/2026-07-20-soft-launch-posture.md`, Decisions).

## What already exists

Reused as is:

- **The image and its lifecycle.** `docker/Dockerfile` (two stages, both
  `FROM node:24-bookworm-slim`, `:19` and `:48`), the argv-forwarding
  `docker/entrypoint.sh`, `docker/compose.yaml`, the Caddy profile, the
  Tailscale sidecar overlay. All move to `<root>/container/`; the build and
  runtime stages stay.
- **`bbx migrate --sweep`** (`src/core/migration-sweep.ts`): script-kind
  only, one commit per migration with a `Created-By: migration-sweep`
  trailer (`:126`), `skipped-dirty` on a dirty tree (`:96`),
  `needs-procedure` when it reaches an agent-driven migration (`:101`). The
  manifest is tracked (`src/core/migrations.ts:161`:
  `MANIFEST_PATH = "_config/migrations.jsonl"`), so a git reset reverts the
  record with the data.
- **`bbx docs refresh`** (`src/core/docs-refresh.ts:7-9`, `:24-27`):
  cache-gated on the engine version, commits template-managed paths, skips a
  dirty box. Its generated output `_content/docs/generated/`
  (`src/core/docs-gen/shared.ts:14`) is gitignored
  (`src/core/box/index.ts:255-256`).
- **`bbx upgrade`'s snapshot-and-revert shape** (`upgrade.ts:259`
  `const snapshotSha = await getHead(boxRoot);`, `:302` `revertUpgrade`,
  typecheck at `:284-290`, commit with an `Upgraded-To` trailer at
  `:295-298`, the fake command-runner seam at `:80`). The container cannot
  use the command itself: its dependency swap (`:264`, `pnpm install` of a
  new spec) has nothing to swap in a single-engine image. Its structure is
  copied into `bbx converge`.
- **The engine-link health check** (`src/webapp/trpc/routers/health-engine.ts`)
  and `runHealthChecks` (`src/webapp/trpc/routers/health.ts:217`): the home
  for the new converge-state check.
- **`bbx activity`** (`src/cli/commands/activity.ts:10`: *"Exit 0 = at rest.
  Exit 1 = busy"*) and its caller `deploy/server-bin/bbx-wait-quiet:17-19`
  (180 s cap, poll every 10 s). `activity` reads every configured box from
  `loadBoxesConfig()` (`:21`) and takes no path; its helpers are already
  per-box, so it gains an optional path argument.
- **The symlinked-engine box shape.** `src/core/box/package.ts:147-151`:
  *"when `node_modules/` is absent, it symlinks `node_modules/beebox`
  straight at the running engine's own `PACKAGE_ROOT`"*. The box's other
  dependencies are written as ranges at `package.ts:198-214` (`react`,
  `react-dom`, `typescript`, `@types/node`, `@types/react`). The container
  extends the symlink trick to those (below) and runs no package manager in
  the box.
- **`defaultBeeBoxSpec`** (`package.ts:56-58`) already writes `^<version>`
  when the engine runs from under a `node_modules`, which is the image's
  case. So the box's `package.json` stays registry-shaped and portable; the
  `BBX_INIT_BEEBOX_SPEC=file:` override (`Dockerfile:102`) is removed, not
  replaced.
- **Codex is already in the image.** `@openai/codex` is a runtime dependency
  (`package.json:120`), resolved by `src/services/codex-binary.ts:11`
  (`require.resolve("@openai/codex/bin/codex.js")`), so the Admin → Codex
  device flow (`deploy/README.md:417-419`) works in-container today. Missing:
  an operator `codex` on PATH (production symlinks the pnpm bin shim,
  `deploy/deploy.sh:558`: `ln -sf /opt/beebox/node_modules/.bin/codex /usr/local/bin/codex`)
  and a persisted `CODEX_HOME`. The not-logged-in message already names the
  command (`src/core/agent/auth-preflight.ts:40-41`).
- **A GitHub Actions workflow** (`<root>/.github/workflows/pages.yml:3-6`,
  push to main; `:8-9` grants `contents: read` only) and the `ianb/beebox`
  remote. The image workflow is a second file with its own permissions.
- **The smoke harnesses**: `docker/smoke-docker.sh`, `docker/smoke-vps-install.sh`
  (dind; already chowns the bind mount to 1000), `docker/smoke-dev-install.sh`,
  and `scripts/smoke-upgrade.ts:238-241` (`bbx upgrade --to file:<second tarball>`,
  one hop; its `WIDGET_SCHEMA` at `:43-49`).
- **`scripts/release.ts`** builds the tarball (`:84`, `pnpm pack`) and never
  writes `version` (verified: no write to `package.json`). `package.json:3`
  is `"version": "0.1.0"` and there are no git tags (`git tag | wc -l` = 0).
- **The external-tool promise** (`src/core/agent-guide/chat.ts:14-16`):
  `pandoc`, `magick`, `poppler-utils`, `xlsx2csv`/`openpyxl`, and `fclones`
  are *"Always available on the box host"*. Both image architectures must
  honor it.
- **git-annex, not LFS.** `docs/assets.md:10` (*"no LFS, `annex.thin=false`"*)
  and `:193` (the shipped attributes file *"carries no `filter=lfs` rules at
  all"*). Any rollback text is written against annex.

Rebuilt, with reason:

- The entrypoint's converge block (`entrypoint.sh:111-125`) becomes a call
  to `bbx converge`, so the policy lives in the engine where doctests reach
  it (principle 10). Its 600 s bound moves with it.
- The first-run guard `entrypoint.sh:70` (`if [[ ! -d "$BOX_ROOT/node_modules" ]]`)
  goes: the box's `node_modules` is a symlink farm `bbx-setup` writes.

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
- An image tag is `[A-Za-z0-9_][A-Za-z0-9._-]{0,127}`; `+` is not allowed.
  The version grammar below uses prerelease form, never build metadata.
  https://docs.docker.com/reference/cli/docker/image/tag/
- `docker/metadata-action`: `type=semver,pattern={{version}}` from a `v*`
  tag, `latest` via `flavor` auto, `type=edge` on the default branch, plus
  `type=raw` for a computed tag.
  https://github.com/docker/metadata-action
- Native arm64 hosted runners (`ubuntu-24.04-arm`) are free for public
  repositories; Docker documents one job per platform on native runners and
  a manifest merge step; `cache-from/to: type=gha`.
  https://github.blog/changelog/2025-08-07-arm64-hosted-runners-for-public-repositories-are-now-generally-available/
  https://docs.docker.com/build/ci/github-actions/multi-platform/
- GHCR packages are **private by default**, even from a public repository.
  Pushing needs `permissions: packages: write` and a `docker/login-action`
  step. The `org.opencontainers.image.source` label links the package to the
  repo. One manual visibility change by the boxholder is part of the rollout.
  https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry
- fclones 0.35.0 ships amd64 assets only (release list checked 2026-09-06:
  `x86_64` rpm, glibc and musl tarballs, `amd64.deb`; nothing for aarch64).
  The arm64 image builds it from source.
  https://github.com/pkolaczk/fclones/releases/tag/v0.35.0
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
- Bash reads a script incrementally, so a script that is truncated and
  rewritten while it runs executes garbage at the old offset; an atomic
  `rename()` over it leaves the running copy intact. `bbx-setup` writes
  every file that way.
  https://unix.stackexchange.com/questions/121013

## Tracks / scope

### Track A — Engine identity and the release ritual

- **What.** Every image carries a distinct, ordered engine version string
  that is also a legal image tag, and a release is a tag the boxholder cuts
  on purpose.
- **Why this needs to change.** `package.json:3` is `0.1.0` forever, so
  nothing distinguishes two images. The release-discipline issue asks
  whether users track main or tags; with a published image, `latest`
  tracking main would move a stranger's box several times a day. A version
  with `+` build metadata cannot be an image tag, so the grammar has to be
  designed for both uses at once.
- **Direction.**
  - One grammar, one string used as the engine version, the image tag, and
    the `.env` pin. Validated with a zod regex at every read (principle 3):
    - release: `MAJOR.MINOR.PATCH`, from the tag `vMAJOR.MINOR.PATCH`;
    - edge: `MAJOR.MINOR.PATCH-edge.N.gSHA7`, where the triple is the last
      release tag's patch plus one, `N` is the commit count since that tag,
      and `gSHA7` is `git describe --tags --long`'s own `g`-prefixed short
      commit. The `g` keeps the identifier alphanumeric: a bare seven-hex
      SHA that happens to be all digits with a leading zero is not a valid
      semver identifier, and about one commit in three hundred has one;
    - local: `MAJOR.MINOR.PATCH-local.N.gSHA7` with the same derivation, or
      `-local.0.unknown` when the build context has no git.
    Ordering is semver: core triple, then a release beats a prerelease of
    the same triple, then `N` numerically. So every edge build orders
    against every other and against releases, and a rollback from any build
    to any older one is detectable. `src/lib/engine-version-id.ts` exports
    `parseEngineVersion`, `compareEngineVersions`, and `coreTriple`. No
    `semver` dependency: it is transitive only (`pnpm-lock.yaml:8346`), and
    the grammar is ours. The doctest asserts every form the workflow can
    emit is accepted by npm's own `semver.valid` (the transitive copy is
    fine for a test).
  - The string is the image tag as well as the engine version; the tag
    grammar `[A-Za-z0-9_][A-Za-z0-9._-]*` accepts every form above.
  - `bin/release <MAJOR.MINOR.PATCH>` on a clean `main`: writes
    `package.json` `version`, commits `Release vX.Y.Z`, tags `vX.Y.Z`,
    pushes the commit and the tag. The existing post-commit hook deploys
    production from that commit, which is what a release means. The first
    tag is `v0.1.0`; edge builds before it derive from `0.1.0-edge.N.SHA7`
    with `N` counted from the first commit (`git describe` has no tag to
    find; the workflow handles the empty case once).
  - `Dockerfile` takes `ARG BEEBOX_VERSION` (default `0.1.0-local.0.unknown`),
    declared AFTER the `pnpm install --frozen-lockfile` layer so a version
    change never invalidates the workspace install, and writes it into
    `package.json` before `pnpm release`, so the tarball,
    `/app/node_modules/beebox/package.json`, and the OCI label
    `org.opencontainers.image.version` agree. The runtime stage sets
    `BBX_INIT_BEEBOX_SPEC=^<core triple>` from the same arg (for an edge
    image `^0.1.1`, never the prerelease string), so a scaffolded box's
    tracked `package.json` stays registry-shaped whichever image scaffolded
    it. Also labels
    `org.opencontainers.image.source=https://github.com/ianb/beebox` and
    `org.opencontainers.image.revision`.
  - `<root>/.github/workflows/image.yml`: on `push` to `main` and on tags
    `v*`; `permissions: { contents: read, packages: write }`;
    `docker/login-action` against `ghcr.io` with `GITHUB_TOKEN`; a `version`
    job computes the string above; one build job per platform
    (`ubuntu-24.04` for amd64, `ubuntu-24.04-arm` for arm64) with
    `cache-from/to: type=gha,scope=<platform>` and `pull: true`; a merge job
    writes the manifest. Tags: the version string itself always; `latest`
    on a `v*` tag; `edge` on main. So `edge` is a floating alias for a
    concrete tag that also exists, and the pin written by `update` is always
    concrete.
- **Vocabulary lock-ins.** `ghcr.io/ianb/beebox`; the grammar above; tags
  `X.Y.Z`, `X.Y.Z-edge.N.SHA7`, `latest`, `edge`; `bin/release`.
- **First implementation chunk.** `src/lib/engine-version-id.ts` with its
  doctest (grammar, ordering across all three forms, rejection of `+`);
  `bin/release`; the `ARG BEEBOX_VERSION` stamping in the Dockerfile; the
  workflow file.

### Track B — `container/`: the image, `bbx-setup`, and the deployment template

- **What.** `docker/` becomes the top-level `<root>/container/` project:
  Dockerfile, entrypoint, `bbx-setup`, the deployment template, the smoke
  harnesses, the user-facing install guide. The image gains Codex on PATH
  with persisted credentials, a pinned Claude CLI, a package-manager-free
  box `node_modules`, and `fclones` on both architectures.
- **Why this needs to change.** A directory named `beebox/docker` inside the
  engine package says the container is a detail of the engine (principle
  7); it is its own project that consumes the engine as a tarball. Codex is
  in the image but `~/.codex` is not on a volume, so a Codex login dies with
  the container. The box's `file:/app/beebox.tgz` dependency
  (`Dockerfile:102`) copies the engine into the box and is never refreshed
  (`entrypoint.sh:70`), so after an image update the box's schemas compile
  against the previous engine while the new one serves them. A `link:`
  spec would fix the skew but would commit a container-only absolute path
  into the user's `package.json` and lockfile (both tracked; the box
  `.gitignore` at `src/core/box/index.ts:236` ignores only `node_modules/`),
  making the box less portable than today.
- **Direction.**
  - Layout: `container/Dockerfile`, `container/entrypoint.sh`,
    `container/bbx-setup`, `container/deployment/` (the files `bbx-setup`
    writes: `compose.yaml`, `Caddyfile`, `compose.tailscale.yaml`,
    `tailscale-serve.json`, `update`, `.env.example`,
    `tailscale.env.example`, `.gitignore`, `README.md`),
    `container/smoke/` (the three harnesses plus the new update harness),
    `container/README.md` (the install and update guide, replacing
    `docs/docker-install.md`; it leaves the `beebox/docs` tree and the docs
    browser on purpose, since it documents files beside it), and
    `container/CLAUDE.md` (a short map). The root `CLAUDE.md` project list
    and the `beebox/CLAUDE.md` Guides table gain the new entries in Track E.
  - **The three commands**, exactly as the README will print them:

    ```bash
    mkdir beebox && cd beebox
    docker run --rm -v "$PWD:/deploy" ghcr.io/ianb/beebox:latest bbx-setup
    docker compose run --rm box claude auth login   # or: codex login --device-auth
    docker compose up -d
    ```

    The first form has only `/deploy` mounted (no compose file exists yet),
    the later forms have `/deploy` and `/data/box`. `bbx-setup` therefore
    touches the box only through `/deploy/data/box`, never assumes
    `/data/box` exists, and the image adds `safe.directory` for both paths.
    In the update form the two paths alias one host directory; nothing
    `bbx-setup` writes into the box records either absolute path (the
    symlink farm targets `/app`, and `node_modules/` is gitignored).
  - **Box `node_modules` without a package manager.** `bbx-setup` writes
    `node_modules/` as a symlink farm derived from the box's own
    `package.json`: for every name under `dependencies` and
    `devDependencies`, a link to the directory Node's own resolver returns
    for that name with the engine's **realpath**
    (`/app/node_modules/.pnpm/beebox@<key>/node_modules/beebox`) as the
    base, plus `node_modules/.bin/tsc`. The realpath is the rule because
    pnpm's isolated layout puts the engine's dependencies beside its
    realpath, not under the lexical `/app/node_modules/beebox/node_modules/`
    (which holds only `.bin`); from the realpath, `react` resolves to the
    engine's own copy (the single-instance invariant `package.ts:191-197`
    describes) and `typescript`/`@types/*`, which the image installs into
    `/app` at build at the ranges `readEngineVersions()` reports
    (`package.ts:122-137`), resolve by the walk up to `/app/node_modules`.
    After writing, `bbx-setup` verifies every link by resolving
    `<name>/package.json` from the box's `src/` and comparing it to the
    engine's resolution; any difference or failure exits nonzero naming the
    package, so a farm that would break at first render breaks at setup
    instead. A name the image cannot resolve is that same failure: a box
    that added its own dependency is outside this plan (NOT in scope).
    Link targets are image-specific (the `.pnpm` key carries the version),
    so the entrypoint runs the same code as `bbx-setup --relink` on every
    start and rewrites the farm whenever a link is dangling or resolves
    differently; one implementation, two callers. A box whose
    `node_modules` is not this shape (the boxholder's `file:`-installed
    test boxes) is relinked wholesale. No `pnpm` runs in the box, so there
    is no lockfile, no store, no cache, and no network.
  - Codex: `ENV CODEX_HOME=/app/codex-config`, a `codex-auth` named volume
    on it (the `claude-auth` pattern, `compose.yaml:33`), and
    `/usr/local/bin/codex` symlinked to the pnpm bin shim
    `/app/node_modules/beebox/node_modules/.bin/codex` (production's shape,
    `deploy.sh:558`). The operator flow is
    `docker compose run --rm box codex login --device-auth`.
  - Claude CLI: install a pinned version (`bash -s <version>`) and set
    `DISABLE_AUTOUPDATER=1`, so an image is reproducible; the pin is bumped
    where the SDK pin is reviewed (`3ad20ac9a`, the `sdk-update` schedule).
  - `fclones`: amd64 keeps the upstream `.deb`; arm64 gets a
    `rust:1-bookworm` build stage running `cargo install fclones --version 0.35.0`
    (cached by the workflow), so both images honor the tool promise.
  - `bbx-setup` (shell, in the image, on PATH; the `bbx-wait-quiet` naming
    precedent). With `/deploy` mounted: (1) refuse unless `/deploy` is
    writable by the container user, printing the one fix,
    `sudo chown -R 1000:1000 .`, with the reason (the image's git identity,
    `safe.directory` entries, and credential-volume ownership are all set
    for uid 1000, `Dockerfile:88-119`, so a compose `user:` override is not
    supported and the guide's existing ownership note changes to say so);
    (2) write every
    file in `container/deployment/` into `/deploy` by temp-file-and-rename,
    overwriting only files it owns, never `.env`, `compose.override.yaml`,
    `tailscale.env`, or `data/`; (3) create `.env` from the example when
    absent and add `BEEBOX_VERSION=<this image's version>` only when the
    line is absent (`update` is the only writer of an existing line);
    (4) `git init` when there is no `.git`, with the written `.gitignore`
    excluding `data/`, `.env`, and `tailscale.env`, and commit as
    `Deployment files from beebox <version>` only when the index is not
    empty; (5) when `/deploy/data/box` holds no box, `bbx init` it; (6) write
    the box's symlink farm. Re-running it changes nothing and exits 0. It
    refuses to run without `/deploy` mounted.
  - `deployment/compose.yaml`:
    `image: ${BEEBOX_IMAGE:-ghcr.io/ianb/beebox}:${BEEBOX_VERSION:?set BEEBOX_VERSION in .env}`,
    no `build:`; `stop_grace_period: 120s`; `environment: BBX_DEPLOY_SHAPE: "1"`;
    the `codex-auth` volume; `restart: unless-stopped` as today (safe
    because a refusal is a served state, Track D); everything else as
    today. `BEEBOX_VERSION` is only a tag; the engine version that converge
    compares is read from inside the image, so a local tag such as `local`
    or `smoke-a` is fine. Contributors build
    `docker build -f container/Dockerfile -t beebox:local .`, set
    `BEEBOX_IMAGE=beebox` and `BEEBOX_VERSION=local`, and run
    `./update --no-pull`; there is no second compose file.
  - `deployment/update [VERSION|edge] [--no-pull]`: validates the argument
    against the grammar or the literal `edge`; when the box is running,
    waits for quiet (`docker compose exec box bbx activity /data/box`,
    180 s cap, 10 s poll); unless `--no-pull`, pulls the target
    (`latest` with no argument, `edge`, or the concrete tag), reads the
    pulled image's `org.opencontainers.image.version` label with
    `docker image inspect`, and writes that concrete string as the
    `BEEBOX_VERSION=` line, touching nothing else in `.env`; then
    `docker compose stop box`, so the old container never serves a box
    whose links point into the new image; then
    `docker compose run --rm --no-deps -v "$PWD:/deploy" box bbx-setup`
    (the pinned, new image; `--no-deps` so Caddy is not started); then
    `docker compose up -d` and `docker compose exec box bbx status`. If
    `up -d` fails, the box is stopped and the pin has moved; running
    `./update` again is the recovery and the script says so. Because
    `bbx-setup` replaces `update` by rename, the running copy keeps its
    inode and finishes.
- **Vocabulary lock-ins.** `container/`; `/deploy` mount; `bbx-setup` and
  `--relink`; `BEEBOX_IMAGE` and `BEEBOX_VERSION`; `update --no-pull`;
  `BBX_DEPLOY_SHAPE`; `codex-auth`; the owned-file list; "the symlink
  farm".
- **First implementation chunk.** `git mv beebox/docker container` with
  path fixes and the guide moved to `container/README.md` (doc-check clean);
  then the Dockerfile changes (drop the `file:` spec, box devDeps into
  `/app`, Codex, Claude pin, fclones on arm64, labels) verified by
  `container/smoke/smoke-docker.sh`. `bbx-setup`, the deployment template,
  and `update` are the second chunk.

### Track C — `bbx converge`: the box follows the engine, in one revertible step

- **What.** One engine command that brings a box onto the engine serving it:
  checkpoint, migrate, refresh docs, typecheck, record; bounded; and a
  separate check that refuses to run a box backwards.
- **Why this needs to change.** The entrypoint runs the sweep and docs
  refresh (`entrypoint.sh:124-125`) with no snapshot and no typecheck, so a
  box whose views break under a new engine finds out at first render. There
  is no record of which engine a box last converged onto, so serving a
  forward-migrated box from an older image is silent. The dirty-box skip
  (`migration-sweep.ts:96`) is right for a live production fleet; in a
  container the alternative to converging is serving unconverged with no
  one watching.
- **Direction.**
  - `bbx converge [boxRoot]` and `bbx converge --check [boxRoot]`,
    `src/cli/commands/converge.ts` over `src/core/converge.ts`. The decision
    core is a pure function over `{ serving, recorded, treeClean }`
    returning `"refuse-backwards" | "current" | "checkpoint-then-converge" | "converge"`,
    so the doctest tiers reach it (principle 10).
  - Record: `_config/engine.json`, tracked, written only inside the converge
    commit: `{ "engineVersion": "0.1.0", "convergedAt": "<box time>", "snapshot": "<sha>" }`
    where `snapshot` is HEAD before this converge. A git reset to `snapshot`
    reverts the record with the data. Absent record: treated as older than
    any engine, no refusal (fresh box, or a box from before this plan).
  - `--check` does step 0 only and is what the entrypoint runs regardless
    of `BBX_SKIP_CONVERGE`, so the escape hatch keeps its present size
    (skip the sweep and refresh) and never covers the refusal.
  - Steps 3 to 5 run as child processes through the command runner, the
    way `upgrade.ts:272-289` spawns them, and the runner gains a
    `timeoutMs` that sends SIGTERM and then SIGKILL (`src/core/command-runner.ts`
    has no timeout or kill today; the shell it replaces used `timeout 600`,
    which kills). The bound is 600 s of awake time (`startAwakeTimeout`,
    `src/lib/awake-timeout.ts:44`; the bound `entrypoint.sh:107-110` names
    as load-bearing, moved into the engine with the policy), and the reset
    below runs only after the child is dead:
    (0) read `serving` from `PACKAGE_ROOT/package.json` and `recorded` from
    `engine.json`. Equal: exit 0 silently. `recorded` newer than `serving`
    by `compareEngineVersions`: exit 3 with the refusal text, touching
    nothing. (1) Dirty tree: `git add -A` and commit
    `Checkpoint before engine <serving> (unvalidated)` with
    `Created-By: bbx-converge`, passing `--no-verify` (`src/lib/git.ts:76`
    supports it). The box's pre-commit hook has two gates
    (`src/core/install-validation-hooks.ts:208-260`): card validation, and
    `git annex pre-commit .` (`:220-236`). The checkpoint skips only the
    first: validation is for cards the author asserts are valid, and a
    checkpoint asserts nothing, while a half-written card is the usual
    reason a tree is dirty at restart. The annex step runs explicitly
    before the commit, so annexed content is handled exactly as the hook
    would. Secrets stay out by the box `.gitignore`
    (`src/core/box/index.ts:246`, `_config/connectors/*.secret.*`); large
    files go where the box's annex attributes send them, as any commit does.
    (2) `snapshotSha = HEAD`. (3) The sweep as it exists, script-kind only,
    one commit per migration; `needs-procedure` is recorded as pending, not
    a failure. (4) `bbx docs refresh`. (5) Typecheck the box's `src/` the
    way `upgrade.ts:284-289` does. (6) On success: write `engine.json`,
    commit `Converge onto beebox <serving>` with `Converged-To: beebox@<serving>`,
    delete `.beebox/converge-failure.json` if present, exit 0. On a step
    failure or timeout in 3 to 5: `git reset --hard <snapshotSha>` plus
    clean without `-x`, as `revertUpgrade` does (`upgrade.ts:185-195`),
    write `.beebox/converge-failure.json` `{ engineVersion, step, snapshot, output, at }`
    (machine-local; `.beebox/` is gitignored, `src/core/box/index.ts:255`),
    exit 2. The checkpoint commit is not reverted: it is the user's work.
    A failure in step 1 (the checkpoint itself) is also exit 2 with the
    record, and nothing to revert. The command's top level catches every
    error and turns it into the exit-2 record, so exit 1 is reserved for a
    process death (OOM, missing binary).
  - Outside the revert unit, stated: `_content/docs/generated/` and the
    other gitignored outputs of step 4. After a reverted converge they hold
    the new engine's generated docs. The cache is keyed on the engine
    version (`docs-refresh.ts:7-9`), so the next successful converge
    rewrites them; until then guidance and data are at different engines,
    which the failure record and health warning already say.
  - Refusal text (exit 3): both versions, and the two ways out with exact
    commands: `./update <recorded version>`, or
    `git -C data/box reset --hard <snapshot>` followed by
    `git -C data/box annex fix` (the repair `docs/assets.md:168` names for a
    box whose unlocked files need re-pointing). Whether the second command
    is needed after a plain reset is settled by the harness (Track F,
    scenario 3 seeds an annexed file), and the printed text follows what the
    harness proved.
  - `bbx activity [boxRoot]`: an optional path; with it, only that box is
    inspected.
  - Surfacing (principle 13): a `converge` health check in
    `health-engine.ts` reading `engine.json` and `converge-failure.json`:
    a failure record is a warning naming the step and the first lines of
    output plus the recovery; a pending procedure migration is a warning
    naming it. `bbx status` prints the same two lines after its Engine
    line (`status.ts:37-42`).
- **Vocabulary lock-ins.** `bbx converge`, `--check`; `_config/engine.json`;
  `.beebox/converge-failure.json`; trailers `Created-By: bbx-converge` and
  `Converged-To`; exit codes 0 current or converged, 2 failed and recorded,
  3 refused, anything else a process death.
- **First implementation chunk.** `src/core/converge.ts` with the pure
  decision function and the record read/write, plus
  `test/core/converge.doctest.md` covering the four decisions and the
  refusal on a newer record. The orchestration and the CLI command follow.

### Track D — The entrypoint

- **What.** No-args start becomes: deployment-shape check, readiness check,
  backwards check, converge, serve; and a refusal is served, not crashed.
- **Why this needs to change.** The entrypoint has no way to know the user's
  compose file predates the image, and its converge block is shell that
  cannot snapshot or typecheck. Under `restart: unless-stopped`
  (`compose.yaml:20`) a nonzero exit is a crash loop, which is what a
  refusal would look like today.
- **Direction.**
  - `bbx serve --refusal <reason>`: serves a fixed page as a 503 on every
    path, no auth, no agents, no box. Small (one Fastify route), and it is
    how a refusal is shown at the URL the user opens (principle 13) while
    the container stays up under its restart policy. The page carries one
    sentence per reason (`deployment files out of date` or `box is newer
    than this engine`) and `see the container log`, nothing else: on the
    Caddy or Tailscale profiles it is reachable without a login, so
    versions, paths, and commands stay in the log and in `bbx status`. That
    is the trade against "dev is never open" (soft-launch posture): a
    static page that names no box and reads nothing is the state the
    system is in, and hiding it behind the auth wall would need the box.
    `/healthz` (`src/webapp/server-root.ts:176`) answers 503 while
    refusing; the Dockerfile gains `HEALTHCHECK CMD curl -fsS http://127.0.0.1:3210/healthz`,
    so `docker compose ps` shows `unhealthy` rather than `Up` for a
    refusing container.
  - Sequence: (1) `BBX_DEPLOY_SHAPE` must equal the image's constant (`1`);
    absent or different serves a refusal naming
    `docker compose run --rm -v "$PWD:/deploy" box bbx-setup` and `./update`.
    (2) Readiness check unchanged (`entrypoint.sh:50-62`), except the
    recovery command names `bbx-setup`. (3) `bbx converge --check /data/box`
    always; exit 3 serves the refusal. (4) Unless `BBX_SKIP_CONVERGE=1`,
    `bbx converge /data/box`; exit 0 or 2 continues; any other exit logs
    loudly and continues (the shipped policy at `entrypoint.sh:100-103`).
    (5) `exec bbx serve` as today (`:130`). Argument forwarding is
    untouched.
- **Vocabulary lock-ins.** `bbx serve --refusal`; the image `HEALTHCHECK`
  on `/healthz`.
- **First implementation chunk.** `--refusal` on `bbx serve` with a doctest;
  then the entrypoint as one commit, verified by `smoke-docker.sh`.

### Track E — The front door and the docs read from the container user's chair

- **What.** The README, the site card, and the install docs lead with the
  image; from-source is the contributor path; every map that lists projects
  or guides knows about `container/`.
- **Why this needs to change.** `<root>/README.md:13-17` lists the
  from-source guide first; `<root>/site/cards/index.site-page.card:20-21`
  does the same; `docs/agent-install.md:28-29` says the engine is *"this
  repository (or a Docker image built from it)"*; `docs/developer-install.md:1-6`
  presents Docker as an alternative. The docker README table still says
  `bbx serve /data/box/content` (`docker/README.md:11`). The root
  `CLAUDE.md` project list and the `beebox/CLAUDE.md` Guides table point at
  files this plan moves.
- **Direction.**
  - Root README, in order: one paragraph in the boxholder's voice (what
    this is, whom it is for, that it runs on their Claude or ChatGPT
    subscription and spends that quota); "Run it" with the three commands
    from Track B and a link to `container/README.md`; "What leaves your
    machine"; bug reports and Discord; "For contributors" holding today's
    Layout and Dev sections and the from-source guide; License. The two
    voice paragraphs are written as `<!-- boxholder: ... -->` placeholders
    with the facts they must carry, not drafted in his voice.
  - `<root>/site/cards/index.site-page.card:18-31`: image first,
    from-source under a contributor line; the agent prompt points at
    `container/README.md`.
  - `docs/agent-install.md`: the engine is a published image; the Docker
    path is the default and the from-source path is offered only when the
    user says they want to hack on the code.
  - `docs/developer-install.md`: first paragraph names itself the
    contributor path.
  - `container/README.md`: the guide, rewritten around the three commands,
    `update`, the three roots, the rollback procedure as the harness proved
    it, both engines' login commands, `edge` under a contributor heading
    only, the "a box with its own dependencies" limitation, and the
    checklist sections kept.
  - Root `CLAUDE.md` project list and `beebox/CLAUDE.md` Guides table:
    `container/` and its README replace the `docs/docker-install.md` row.
  - `src/frontend/src/components/settings/ScanUploaderSection.tsx:82-87`
    tells the user to `git clone` and `pnpm install` the scan uploader. That
    tool runs on the machine with the scanner, not in the box, so the
    instruction is right; the text says so explicitly, so a container user
    does not read it as an instruction to clone for the box. The search
    that found it (`src/frontend` for `git clone`, `pnpm`, `checkout`) found
    nothing else and no first-run screen text.
- **Vocabulary lock-ins.** "the deployment directory", "the box", "the
  image" as the three names used in every doc.
- **First implementation chunk.** `container/README.md`, since Tracks B to
  D are its spec. README, site card, agent-install, and the two CLAUDE.md
  maps follow once the commands are verified.

### Track F — Verification

- **What.** Harnesses that prove the stranger's path and the update path,
  and the manual items the boxholder clears.
- **Why this needs to change.** `smoke-docker.sh` and `smoke-vps-install.sh`
  script today's `bbx init` flow; nothing exercises an update against a box
  with code, a dirty tree, an invalid card, an annexed file, or a version
  skip.
- **Direction.**
  - Image tags in the harnesses are local tags (`beebox:smoke-a`); the
    engine version inside each is set by `--build-arg BEEBOX_VERSION`; the
    scratch `.env` sets `BEEBOX_IMAGE=beebox` and pins the local tag; every
    `update` call passes `--no-pull`. The two namespaces are named
    separately in every script.
  - `smoke-docker.sh`: build with `BEEBOX_VERSION=0.1.0-local.1.gaaaaaaa`,
    then the three commands into a scratch directory (the bare `docker run`
    form first), `up`, 200, a second `bbx-setup` run asserting no change,
    teardown. The box step runs with `--network none` to prove no package
    manager is needed, and a negative case adds a dependency the image
    lacks to a scratch box's `package.json` and asserts `bbx-setup` fails
    naming it.
  - `smoke-update.sh` (new): build images `smoke-a` (`0.1.0-local.1.gaaaaaaa`),
    `smoke-b` (`0.1.0-local.2.gbbbbbbb`), and `smoke-old` (`0.0.9`) from the
    same tree; the three builds share the workspace-install layer because
    `ARG BEEBOX_VERSION` sits after it. `smoke-b` is built from a copy of
    the tree with one comment line appended to
    `container/deployment/update`, so its `bbx-setup` rewrites `update` to
    a different length. Scenario 1: box with a seeded schema (the
    `WIDGET_SCHEMA` in `smoke-upgrade.ts:43-49`), a dirty file, and an
    invalid card, `update` to `smoke-b`: expect a `--no-verify` checkpoint
    commit containing the invalid card, a converge commit, `engine.json` at
    `b`, 200, every farm link resolving into the `smoke-b` image, and that
    `update` completed to its last line. Scenario 2: seed a schema
    that cannot typecheck, `update`: expect exit 2 in the log, HEAD equal to
    the snapshot, `converge-failure.json` present, 200, the health warning
    in `/healthz`. Scenario 3: seed an annexed file, pin `smoke-old`: expect
    the refusal served as 503 at the box URL and the container `Up`; run the
    printed reset; assert the annexed file's content is present and record
    whether `annex fix` was required; expect the container to serve.
    Scenario 4: `BBX_DEPLOY_SHAPE` removed from the compose file: expect the
    503 refusal naming `bbx-setup`.
  - `smoke-vps-install.sh`: the in-dind sequence uses the three commands;
    the Caddy profile check stays; the existing chown proves the ownership
    refusal text is not hit when ownership is right, and a step with the
    chown removed proves the refusal text is.
  - The workflow is verified by its first run on `main` (`edge`) and by the
    `v0.1.0` tag; a scratch `docker compose pull` of both from a machine
    that has never built the image; and a `docker manifest inspect` showing
    both architectures.
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

- The symlink farm instead of the tarball or a `link:` spec, plus a
  start-time converge: the box's code and the serving engine cannot differ
  (principle 6: the mismatch state becomes unrepresentable rather than
  flagged), and nothing container-specific enters the user's repository.
  This is the deliberate departure from per-box pinning
  (`boxes-as-packages-v2.md:26`); the pin moves to the one place a
  container user already controls, the image tag.
- `bbx-setup` writing the deployment files: the files and the image cannot
  skew, and `BBX_DEPLOY_SHAPE` makes an old compose file a loud failure
  (principle 4).
- The version record and the backwards refusal: the Ghost failure is
  refused, not documented (principle 12), and served as a page rather than
  crash-looped (principle 13).
- The checkpoint commit: the exception to `migration-sweep.ts:16` exists
  because the container has one engine; a skipped box would be served
  unconverged by that engine anyway. A checkpoint keeps the work visible in
  the user's history with a name that says what it is.
- One grammar for version, tag, and pin: three strings that could drift
  become one (principle 8).

Dropped from earlier drafts as over-built: a separate container version
number (one image, one version); a `compose.build.yaml` for contributors
(a local tag does it); an `update --rollback` (two documented commands);
release notes and an update-available check (their own decisions); a
`link:` dependency spec (it leaks a container path into the user's repo).

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
| Image pulled is older than the box's `engine.json` (rollback, edge behind a release, older edge) | Track F scenario 3 | `--check` exit 3, refusal served as 503 with the two ways out | clear |
| Dirty tree at converge | Track F scenario 1 | `--no-verify` checkpoint commit, then converge | clear (commit named) |
| Invalid card in the dirty tree | Track F scenario 1 | `--no-verify`; the commit says "unvalidated" | clear |
| Checkpoint commit itself fails (git lock, disk) | converge doctest | exit 2 with the record; serve | clear |
| Box code fails typecheck under the new engine | Track F scenario 2 | reset to snapshot, failure record, health warning, serve | clear |
| A script migration fails mid-sweep | sweep doctests today | sweep stops, converge reverts to snapshot, failure record | clear |
| A procedure migration is pending | converge doctest | recorded pending, health warning, serve | clear |
| A converge step hangs | converge doctest (fake runner) | 600 s awake-time bound per step, then the exit-2 path | clear |
| Converge process dies (OOM, missing binary) | none | entrypoint logs and serves; no record | partly silent, accepted (rare, log only) |
| Reverted converge leaves new generated docs in the gitignored dir | none | stated; regenerated by the next successful converge | clear (health warning covers the interval) |
| Restart lands mid-commit, orphan `.git/index.lock` | none | `update` waits for quiet; `stop_grace_period: 120s`; `git-stale-lock.ts` recovers an abandoned lock | clear (lock recovery logs) |
| User's compose file predates the image (`BBX_DEPLOY_SHAPE` absent or old) | Track F scenario 4 | refusal served naming `bbx-setup` | clear |
| `update` rewritten by `bbx-setup` while running | Track F scenario 1 | rename-over, running inode intact | clear |
| Farm links dangle after the image changes without `bbx-setup` (pin edited by hand) | Track F scenario 1 (link assertion) | entrypoint runs `--relink` on every start | clear |
| A farm link resolves to a different package than the engine's | smoke-docker (verification step) | `bbx-setup` compares resolutions and fails naming the package | clear |
| `update`'s `up -d` fails after the pin moved | none | box is stopped, not serving stale links; script names `./update` as the recovery | clear |
| A converge step is killed by the bound mid-write | converge doctest (fake runner) | reset runs after the child is dead | clear |
| `bbx-setup` run without `/deploy` mounted | smoke-docker | refuses with the mount command | clear |
| `/deploy` not writable by the container user (Linux, uid not 1000) | smoke-vps chown-removed step | refuses with the chown and `user:` fixes | clear |
| `bbx-setup` run from an older image than the pin | none | it never rewrites an existing `BEEBOX_VERSION`; only `update` does | clear |
| `update` with no argument on a machine that cannot reach GHCR | none | `docker pull` fails; script exits before touching `.env` | clear |
| `update edge` writes a pin | Track F (grammar doctest for the label) | the label is a concrete legal tag; `edge` is never written as the pin | clear |
| A box dependency the image cannot resolve | smoke-docker (negative case) | `bbx-setup` fails naming it; documented as unsupported | clear |
| Codex login lost across container recreation | manual (boxholder) | `codex-auth` named volume | clear (`auth-preflight.ts:40-41` message) |
| Claude CLI pinned version no longer installable | build fails | none beyond the failed build | clear |
| arm64 image lacks `fclones` | build fails without the arm stage | built from source on arm64 | clear |
| GHCR package left private | first `docker pull` by a stranger 401s | manual visibility change in rollout | clear |
| Workflow tags `latest` on a tag the boxholder did not mean as a release | none | `bin/release` is the only tagger; a hand tag is the operator's act | silent (documented) |
| Two `update` runs at once | none | `docker compose` serializes container ops; `git` in the box has the box lock | partly silent, accepted |
| Annexed content after the documented reset | Track F scenario 3 | the printed text follows what the harness proved | clear |
| `engine.json` hand-edited to a wrong version | converge doctest (zod parse) | parse failure is a converge failure with the record named | clear |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field**: ADDRESSED. The only user-typed values are
  `BEEBOX_VERSION` (compose fails on an unpullable tag) and `update`'s
  argument (validated against the grammar or `edge` before anything runs).
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
  fixes it; the served 503, `bbx status`, and the dashboard health show the
  same text.
- **Partial migration / transition state**: ADDRESSED. A box from before
  this plan has no `engine.json` and a `file:`-installed `node_modules`;
  converge treats the missing record as older than any engine, and
  `bbx-setup` replaces the `node_modules` with the symlink farm. Its
  `package.json` keeps whatever `beebox` spec it has (`file:/app/beebox.tgz`
  on the boxholder's test boxes); the farm ignores the spec and links by
  name, and the first converge does not rewrite `package.json`. Only the
  boxholder's own test installs are in this state; the guide's transition
  note is one line.

## NOT in scope

- Release notes, a changelog, and an update-available signal in the box:
  the release-discipline issue keeps them; a version check is an egress
  question under "what leaves your machine".
- `bin/release` gating on tests or on a clean CI run: there is no CI beyond
  the site checks; the ritual is tag-and-build.
- Scheduled base-image rebuilds between releases: a release rebuilds with
  `pull: true`; a cadence is a later decision.
- Moving production (`deploy/deploy.sh:713-770`) onto `bbx converge`: it
  would consolidate two converge loops (principle 8), but it touches the
  live fleet and needs its own verification; filed as a follow-up issue at
  implementation time.
- `bbx upgrade --to` and per-box pinning for from-source and hub installs:
  unchanged. A box leaving the container for one of those runs
  `bbx upgrade --to <spec>` there; its `package.json` is registry-shaped, so
  that is the designed starting state.
- A box that adds its own npm dependencies inside the container: the
  symlink farm covers the scaffolded set only; such a box needs a real
  install with network, which the guide says how to run by hand and this
  plan does not manage.
- Multi-box (hub) compose, the Windows/WSL2 stance, the macOS from-source
  walk, real ACME and Tailscale runs: the ledger items keep their owners.
- Publishing to npm: rung 6's other half; the image is the distribution.
- The README's voice paragraphs: placeholders with required facts; the
  words are the boxholder's (soft-launch posture, "Register").
- A client reload on engine change: the two filed issues; they get an
  identity to compare from Track A and nothing else here.
- The scan uploader's clone instruction: correct for a tool that runs on
  the scanner's machine; reworded, not redesigned.

## Open design questions

- First release number: `v0.1.0` (lean) matches the current string; the
  boxholder may prefer to signal a fresh start with `v0.2.0`. Decided at
  the first `bin/release` call, nothing in the plan depends on it.
- Whether `annex fix` is needed after the documented reset: settled by
  Track F scenario 3, and the refusal text follows the result.

## Knowledge audits

Skip-with-rationale: nothing here changes what a box agent is told. The
converge commit and checkpoint commit are visible in the box's git history
the agent already reads; the generated agent docs are refreshed by the
existing `bbx docs refresh` step; the tool promise is kept on both
architectures rather than changed.

## What will hold this after it ships

- Doctests reach the decisions: `test/core/converge.doctest.md` (the pure
  decision function, the record read/write, the exit paths with the fake
  command-runner seam `upgrade.ts:80` established, including a step that
  never returns against a frozen awake clock),
  `test/lib/engine-version-id.doctest.md` (grammar, ordering across
  release, edge, and local forms, rejection of `+`), and a `bbx serve
  --refusal` doctest.
- The harnesses hold the shell: `smoke-docker.sh` for the stranger's path,
  `smoke-update.sh` for the four update scenarios, `smoke-vps-install.sh`
  for the Caddy profile and the ownership refusal. They are local-run; the
  ledger's CI item stays open. Cost: each is minutes and a 2 GB build;
  `smoke-update.sh` builds three images from one tree, so it caches the
  build stage.
- `pnpm doc-check` holds the doc moves.
- No new test tier and no mock beyond the command-runner seam.

## Implementation order

1. Track A chunk 1: version grammar module and doctest; `bin/release`;
   Dockerfile stamping. No dependency.
2. Track C chunk 1: `src/core/converge.ts` decision core, record
   read/write, doctest. Depends on 1 for the grammar.
3. Track C chunk 2: orchestration with the awake-time bound,
   `bbx converge` and `--check`, `bbx activity [box]`, health check,
   `bbx status` lines, doctests with the fake runner.
4. Track D chunk 1: `bbx serve --refusal` with its doctest.
5. Track B chunk 1: `git mv` to `container/`, doc moves, Dockerfile
   (drop `file:`, box devDeps into `/app`, Codex, Claude pin, fclones on
   arm64, labels). Verified by `smoke-docker.sh` as it exists, on its new
   path.
6. Track D chunk 2: entrypoint. Depends on 3, 4, and 5.
7. Track B chunk 2: `bbx-setup` (symlink farm, atomic writes, ownership
   refusal), `container/deployment/`, `update`. Depends on 6.
8. Track F: `smoke-docker.sh` rewritten, `smoke-update.sh`,
   `smoke-vps-install.sh` adjusted. Depends on 7. Run one harness at a
   time on this machine.
9. Track A chunk 2: the workflow file. Verified only after merge.
10. Track E: `container/README.md`, README, site card, agent-install,
    developer-install, the two CLAUDE.md maps, docs index, the scan
    uploader text, the ledger's rung 6 entry. Depends on 7 and 8 so the
    commands documented are the commands that ran.
11. Cross-model review, then the merge, then the boxholder's manual items.

## Rollout shape

Tests first: the converge doctest, the version-grammar doctest, and the
refusal-serve doctest are written with their tracks and must pass before
the entrypoint changes. Done-when for the code: `smoke-docker.sh` and all
four `smoke-update.sh` scenarios pass locally; `smoke-vps-install.sh`
passes via dind; typecheck, lint, and the affected doctests pass.
Done-when for the release path: the `edge` build succeeds on the first push
to `main`, `v0.1.0` produces `0.1.0` and `latest`, `docker manifest inspect`
lists both architectures, and a machine that never built the image
completes the three commands from `container/README.md`. Migration
approach: none for user data; the only existing container boxes are the
boxholder's, and `bbx-setup` relinks their `node_modules` on its first run.
The boxholder clears: GHCR visibility, the two interactive logins, and the
README voice paragraphs.
