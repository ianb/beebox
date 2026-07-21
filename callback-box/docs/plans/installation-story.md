# Installation story, phase 1: developer install + local Docker

**Status:** partially implemented 2026-07 — every code/doc chunk (A1/A2, B1/B2,
C1/C2, D1/D2) has landed and is verified by execution (doctor run, doctests,
docker lifecycle smoke, dev-install sequence on a scratch clean clone). The two
rollout-verification done-when items in "Rollout shape" below — a clean-clone
walkthrough on a second machine and a real cheap-VPS run of the compose file —
now have executable Docker approximations that both PASS
(`callback-box/docker/smoke-dev-install.sh` and `smoke-vps-install.sh`, added
2026-07-12; see "Rollout shape"); a real VPS with ACME/DNS/Tailscale and an
interactive `claude auth login` still want a human.

Make callback-box installable by an outside developer: one pinned Node version
enforced at install time, a preflight doctor that makes every missing
prerequisite loud, a verified clone-to-running-box quickstart, and a Docker
image + compose file that runs a box locally and doubles as the cloud/VPS
install. Claude auth is subscription login (`claude auth login`) throughout —
the boxholder's stated preference (2026-07-12).

Research basis: `research/openclaw-hermes/deep-installation.md` (2026-07-12).
Coordinates with `docs/plans/source-available-release.md`: this plan
implements its Track F pieces 1–2 (preflight + credential templates) and
replaces the deferred Track C deploy-genericization with a fresh Docker path;
that plan's remaining tracks (PII/licensing/orientation) are untouched.

Revised 2026-07-12 after a Codex cross-model review (findings incorporated:
v2-box container contract, box-local install, argv-forwarding entrypoint,
git-identity/LFS-filter/UID gaps, doctor de-abstraction, engine-strict
sequencing, several citation corrections).

## Stated preferences this plan trades against

- `callback-box/CLAUDE.md:103` — *"Keep source and docs generic — never
  hardcode personal names. This is a generic tool; any box can be adopted by
  any user."* Governs everything here: the install path must work with zero
  personal-infrastructure assumptions.
- `callback-box/CLAUDE.md` (Behavioral Notes) — *"don't add features beyond
  what the task requires."* Governs the deferrals: no installer script, no
  onboarding wizard, no npm publish in this plan. Also governs Track B's
  shape: a small root script over a grand shared-check framework.
- `docs/engineering-principles.md` #4 (validate at boundaries) and #6
  (resilient, not silent) — a missing prerequisite is boundary input; today
  it fails silently (git-lfs) or opaquely (Claude auth). The doctor and the
  run-path preflight exist to satisfy these two.
- Boxholder feedback (memory, standing): **bias toward strict** — fail-closed
  enforcement over advisory warnings. Applied to `engine-strict` (Track A),
  the fail-loud Docker entrypoint, and the loopback-only compose default
  (Track D).
- Boxholder decisions this session (2026-07-12): resolve the Node drift ("it
  causes a lot of trouble locally too"); be cautious about widening `cb` —
  *"cb is what the box runs, I'm not sure we should be so quick to use it for
  external operations like doctor"*; developer install first, with local
  Docker exercising the cloud install; prefer `claude auth login`.
- Precedent: `scripts/smoke-external-box.ts` — the shipped pattern for
  "verify the stranger sequence actually works, from outside the repo." Its
  sequence (tarball → `cb init` → **box-local `pnpm install`** → validate →
  serve → HTTP probes) is the contract the Docker lifecycle must reproduce.

## What already exists

- **Node pin, partial.** `callback-box/.nvmrc` = `v24.12.0`. Nothing else:
  no root `.nvmrc`, no `engines` field in any workspace `package.json`
  (root, the four subprojects, `browse/`, the frontend), no `packageManager`
  field, no `engine-strict`. `deploy/setup-server.sh:11` contradicts it:
  `NODE_MAJOR=22`. **Reuse the .nvmrc value; build the enforcement.**
- **The v2 box shape constrains everything downstream.** `cb init` on a
  fresh path scaffolds a *package*: marker at `<target>/content/.cb-box`
  (`src/core/box/package.ts:60-64` — *"An existing v2 box (marker at
  `<target>/content`)"*), operational box = `content/`, and the package
  needs its own `pnpm install` to replace the scaffold-time engine symlink
  (`src/core/box/package.ts:137,185,208`; `smoke-external-box.ts:178,197`
  performs exactly that second install). Any container or quickstart that
  checks `.cb-box` at the package root, serves the package root, or skips
  the box-local install is wrong by construction.
- **Loopback-by-default binds, already correct.** `src/webapp/server.ts:185`
  `const host = options.host ?? "localhost"`; `src/cli/commands/serve.ts:90`
  `.option("-h, --host <host>", "Host to bind to", "localhost")`;
  `src/cli/commands/hub.ts:50` `const host = config.host ?? "127.0.0.1"`.
  **Reuse** — Docker needs only `--host 0.0.0.0` inside the container; no
  bind changes needed.
- **Claude auth checking, two halves.** `src/services/claude-cli.ts` shells
  to `claude auth status/login/logout` (typed service with a fake, already
  injected into the admin router); `src/webapp/trpc/routers/health.ts:270-273`
  peeks at `~/.claude/.credentials.json` and *"On macOS they live in the
  Keychain instead … so skip the check there"*. Health checks have their own
  result shape `{ name, ok, message, severity }` (`health.ts:22`). **Reuse
  the service, retire the file-peek**; do NOT invent a fourth result shape
  shared across consumers (see Track B).
- **External-binary contract.** `src/core/agent-guide/chat.ts:11-15` promises
  the agent *"Always available on the box host … `pandoc`, `imagemagick`
  (`magick`), `poppler-utils` (`pdftotext`, `pdfimages`)"*. This is the
  authoritative list the doctor checks and the Docker image must satisfy.
- **git-lfs is wired per-box at init.** `src/core/box/index.ts:130-145`
  writes LFS `.gitattributes` filters into every new box. Filters only
  function when `git lfs install` has run for the user/repo — installing
  the binary alone is insufficient (Track D must run it; the doctor must
  check it).
- **SDK binary resolution.** `src/core/sdk-binary-path.ts` picks the bundled
  Agent SDK binary (glibc-first on Linux, working around the SDK's
  musl-first bug). The doctor reuses it as a check ("SDK binary resolves for
  this platform"), and it constrains the Docker base image to glibc (Debian,
  not Alpine).
- **The stranger sequence, already executable.** `scripts/smoke-external-box.ts`
  scaffolds a fresh v2 box in a temp dir against a packed tarball, with zero
  monorepo context, and prints the authoritative "Stranger sequence" block.
  `scripts/release.ts` + `build:cli` produce the tarball (frontend built at
  `release.ts:67-72`). **Reuse heavily** — as the specification of what the
  container lifecycle must do, not as a claim that building an image tests
  it (it doesn't; Track D adds its own lifecycle test).
- **`cb serve --dev` is backend-only.** `serve.ts:123` execs
  `node --watch` over the backend; `docs/stack-decisions.md` used to pair
  it with a `Procfile.dev` (Overmind: backend + vite together), but
  Decision 24 deleted `Procfile.dev`/Overmind — it is no longer a
  candidate. A clean clone has **no built frontend** — `dist` frontend
  output comes from `build:frontend`/`release.ts`. The quickstart
  therefore builds the frontend once and uses plain `serve`. The
  contributor dev-loop (Track C spike, verified): two terminals, no
  Overmind — terminal 1 `cd callback-box && pnpm cb serve --dev --port
  3211 ~/boxes/dev1` (backend watch); terminal 2 `cd
  callback-box/src/frontend && FRONTEND_PORT=3210 BACKEND_PORT=3211 pnpm
  dev` (Vite + HMR, proxies `/api` and `/auth` to the backend). Documented
  in `docs/developer-install.md`.
- **`cb` is not reachable from the monorepo root.** Root `package.json` had
  no `cb` script; the binary belongs to the `callback-box` package
  (`callback-box/package.json` `"cb": "./bin/cb"`). **Decided (C2):** add
  a thin root convenience script, `"cb": "pnpm --dir callback-box cb"` —
  verified with `pnpm cb --help` from the repo root. The doc's canonical
  sequence still uses `cd callback-box && pnpm cb …`.
- **Secret-file conventions.** `*.secret.json` gitignore convention
  (`docs/box-layout.md:194`), Telegram validate-then-persist
  (`src/webapp/trpc/routers/admin.ts:60-78`). Reused as-is; this plan adds
  only the missing `.env.example`.
- **Prod deploy scripts** (`deploy/*.sh`) — **deliberately not reused** for
  the public path. They stay personal (release plan Track C decision); the
  Docker path is written fresh so there is no transition-state risk to the
  live deployment.

## Prior art (external)

Carried over from `research/openclaw-hermes/deep-installation.md` (searched
2026-07-12); the load-bearing items:

- Docker-compose-first is the common primary distribution for stateful
  self-hosted Node apps (n8n, LibreChat, Open WebUI, Umami; each project's
  own docs are cited in the research doc — the pattern is theirs, the
  "prebuilt native modules" rationale is stated by n8n and Umami
  specifically). Our `better-sqlite3`/`esbuild` builds plus
  `pandoc`/`imagemagick`/`poppler`/`git-lfs` extend the same argument.
  <https://docs.n8n.io/hosting/installation/server-setups/docker-compose/>
- Both OpenClaw and Hermes ship a `doctor` command and end every install doc
  with it. <https://docs.openclaw.ai/install>,
  <https://hermes-agent.nousresearch.com/docs/getting-started/installation>
- Claude subscription auth on a headless host: `claude setup-token` on a
  browser machine → **`CLAUDE_CODE_OAUTH_TOKEN` environment variable** on
  the server (an env contract, not a credentials file — compose must pass
  it via env-file, a volume can't persist it); `ssh -L` port-forward is the
  fallback for completing browser OAuth remotely.
  <https://code.claude.com/docs/en/authentication>. Whether interactive
  `claude auth login` completes inside `docker compose run` (URL +
  paste-code) is **unverified** — treated as an implementation-time
  experiment with the env-token path as the documented fallback, not as
  settled.
- Agent SDK musl/glibc launcher bug (why we have `sdk-binary-path.ts`):
  anthropics/claude-agent-sdk-typescript#296. Constrains the image to
  Debian-slim; Alpine is off the table.
- pnpm honors `engines` + `engine-strict=true` in the root `.npmrc`
  (workspace-wide — the only `.npmrc` pnpm reads in a workspace), failing
  install on mismatched Node. <https://pnpm.io/npmrc>. Blast radius is every
  environment that runs `pnpm install` here: contributor machines, the
  deploy checkout, worktree hooks — hence the two-step landing in Track A.
- **Not searched**: nothing else in this plan leans on a library capability
  that is undocumented or novel; the Docker/compose shapes are the boring
  well-trodden ones.

## Tracks / scope

Order: A unblocks everything (every other track states a Node version);
B before C (the quickstart ends with `pnpm doctor`); D last (the image bakes
in A's pin, B's doctor checks, C's verified sequence).

### Track A — One Node version, enforced (in two steps)

- **What.** One Node version everywhere; enforcement lands separately from
  the pin.
- **Why this needs to change.** `callback-box/.nvmrc` says `v24.12.0`,
  `deploy/setup-server.sh:11` says `NODE_MAJOR=22`, and nothing enforces
  either — a wrong-Node `pnpm install` half-succeeds and fails later in
  native modules or runtime behavior. Boxholder: "It causes a lot of trouble
  locally too."
- **Which version — DECIDED at implementation (2026-07-12): Node 22, not
  24.** The plan's environment check surfaced that the *demonstrated-working*
  version everywhere is 22: the boxholder's shell default is `v22.22.1`,
  prod was provisioned at `NODE_MAJOR=22`, and the dev router runs on the
  PATH node (22). The `.nvmrc` 24 pin never actually took anywhere. Pinning
  22 makes every environment consistent and enforceable with zero machine
  changes; moving to 24 later is a deliberate single-commit bump
  (`.nvmrc` + `engines` + Docker base) that `engine-strict` will then
  enforce, instead of today's silent drift.
- **Direction.**
  - **Step 1 — pin.** Root `.nvmrc` (`v22.22.1`; remove
    `callback-box/.nvmrc`, version managers resolve upward). Root
    `package.json` gains `"engines": { "node": ">=22.11.0 <23" }` and
    `"packageManager": "pnpm@10.26.2"` (corepack then self-selects).
    `deploy/setup-server.sh:11` already says `NODE_MAJOR=22` — unchanged.
    Docker base image (Track D) `FROM node:22-bookworm-slim`.
  - **Step 2 — enforce.** `engine-strict=true` in root `.npmrc`, as its own
    commit, only after: (a) `node -v` confirmed ≥24 on the boxholder's
    machine AND the prod server AND the deploy checkout's environment;
    (b) one clean `pnpm install --frozen-lockfile` under Node 24 verified
    from scratch. The strict flag is workspace-wide (root `.npmrc` is the
    only one pnpm reads) and hits every environment that installs —
    landing it separately makes the revert trivially cheap if something
    unexpected (a hook, a CI-less automation, a worktree script) breaks.
- **Vocabulary lock-ins.** None (no shared vocabulary).
- **First implementation chunk.** Step 1 in one commit. Step 2 is its own
  commit behind the two checks above — both are mechanical verifications,
  not open questions.

### Track B — Preflight doctor (`pnpm doctor`) + actionable Claude-auth errors

- **What.** A root `bin/doctor.ts` for developers, and — separately, sharing
  only the `ClaudeCli` service — an actionable Claude-auth error in the
  agent-run path and a fixed health probe. Three consumers, three
  right-sized implementations; no shared check framework.
- **Why this needs to change.** Missing prerequisites fail silently or
  opaquely today: git-lfs hooks degrade silently (`.husky/post-commit:85`
  guards with `command -v git-lfs || true`), a missing/expired Claude login
  surfaces as an opaque `success:false` from the SDK stream (release plan
  Track F), and the health probe that would catch it is skipped on macOS
  (`health.ts:270-273`). Both competitor products and every comparable
  install doc converge on a doctor command as the rail beside every install
  path (research doc §4). The original one-library-three-consumers shape
  was reviewed and rejected: health already has its own result shape
  (`health.ts:22`), `runHealthChecks` takes no injected services
  (`health.ts:126`), and forcing one record type across a CLI table, a
  tRPC health payload, and a run-path error message is abstraction for its
  own sake — *"don't add features beyond what the task requires."*
- **Direction.**
  - **`bin/doctor.ts`** (monorepo tooling at the monorepo root — the same
    home as the other operator scripts, which also honors the boxholder's
    `cb`-boundary concern), exposed as root script `"doctor"`. Checks,
    each with a one-line remedy: Node version satisfies root `engines`;
    pnpm present; workspace installed from root (hoisted `node_modules`);
    `pandoc`, `magick`, `pdftotext` on PATH (the `chat.ts:11-15`
    contract); `git-lfs` binary present AND `git config --get filter.lfs.clean`
    resolves (filters actually installed); system `claude` on PATH and
    `claude auth status` healthy; Agent SDK binary resolves
    (`sdk-binary-path.ts` non-null); frontend build output present (else
    "run `pnpm --dir callback-box build:frontend`"). Human-readable table,
    nonzero exit on failure, `--json` for scripts. Tested with the
    monorepo-root `node --test` harness (`bin/*.test.ts` precedent),
    injecting a fake exec.
  - **Run-path preflight** (in callback-box, using the existing `ClaudeCli`
    service + its fake): before starting a chat/reactor agent run, check
    auth; on failure surface *"Claude Code is not logged in — run `claude
    auth login` on this machine"* through the existing error path instead
    of the opaque SDK failure. (Release-plan Track F piece 1, implemented
    here.) Doctest with the fake `ClaudeCli`.
  - **Health probe fix**: `health.ts:270-289` replaces the
    credentials-file peek (and its darwin skip) with a `claude auth
    status` call, keeping health's own result shape. macOS dev finally
    gets a signal.
- **Vocabulary lock-ins.** None — deliberately (the shared-shape lock-in
  from the draft is withdrawn).
- **First implementation chunk.** `bin/doctor.ts` + its tests + the root
  script. Preflight and health rewire follow as separate commits.

### Track C — Developer quickstart, verified on a clean clone

- **What.** A from-source developer install doc: clone → correct Node
  (enforced by A) → `pnpm install` → `pnpm doctor` → build the frontend
  once → `cb init` a box outside the repo → box-local `pnpm install` →
  `cb serve` → open browser. Plus the missing `.env.example` and a loud
  git-lfs gap.
- **Why this needs to change.** Every doc today serves the boxholder or
  agents; the router/worktree harness assumes the personal `~/src` layout
  (release plan, NOT-in-scope: *"do not invest in making the
  worktree/router harness reusable"*). An outside developer needs a path
  that never touches `bin/worktrees` — and the naive path has three
  landmines the draft plan itself stepped on: `cb` isn't reachable from
  the root, a clean clone has no built frontend, and `--dev` is
  backend-only. And there is no `.env.example` anywhere — the only env
  enumeration is `deploy/README.md` prose, which wrongly lists
  `ANTHROPIC_API_KEY` as required (the code deletes it:
  `src/cli/bootstrap.ts:31`, `src/core/script-env.ts:106`).
- **Direction.**
  - **Doc**: `docs/developer-install.md` — written and linked from the
    root README's Layout section (C2; superseded the plan-time note that
    release-plan Track E owns the link — the small pointer landed here
    instead). Content: prerequisites (Node 22, matching Track A's decided
    pin — not 24, the plan's original draft was stale before Track A even
    settled; pnpm via corepack; `brew install pandoc imagemagick poppler
    git-lfs` / apt equivalents; `git lfs install`; Claude Code CLI +
    `claude auth login`), then the exact sequence (verified on this
    worktree, C1 spike):

    ```
    git clone … && cd <repo>
    pnpm install
    pnpm run doctor
    pnpm --dir callback-box build:frontend
    cd callback-box
    pnpm cb init ~/boxes/dev1
    (cd ~/boxes/dev1 && pnpm install)      # v2 boxes are packages
    pnpm cb serve ~/boxes/dev1
    ```

    with "run `pnpm run doctor` whenever anything misbehaves" (note the
    `run` — `pnpm doctor` alone is shadowed by pnpm's own builtin `doctor`
    subcommand). States the auth model plainly: subscription login is the
    supported path; `ANTHROPIC_API_KEY` is ignored by design. **Resolved
    by the spike**: `cb serve ~/boxes/dev1` (the package root, no
    `/content` suffix) — `cb serve <package-root>` resolves down to
    `content/` on its own (a fix landed alongside the spike, commit
    `0d2fbfb8`); `cb init` also now defaults the box's `callback-box` dep
    to `link:<checkout>` from a source checkout with no env var needed.
  - **Contributor dev loop — resolved.** `--dev` watches the backend only
    (`serve.ts:123`). `Procfile.dev` + Overmind, the previous full-loop
    candidate (`docs/stack-decisions.md`), is gone — deleted by Decision
    24, so it is off the table, not a choice to make. The verified
    two-terminal recipe (no extra process supervisor): terminal 1 `cd
    callback-box && pnpm cb serve --dev --port 3211 ~/boxes/dev1`
    (backend watch); terminal 2 `cd callback-box/src/frontend &&
    FRONTEND_PORT=3210 BACKEND_PORT=3211 pnpm dev` (Vite + HMR, proxies
    `/api` and `/auth`). Quickstart stays built-frontend + plain `serve`;
    this is the "working on the frontend" subsection. Exercised as part of
    landing the doc (run-the-verification-you-author).
  - **`.env.example`** at `callback-box/.env.example`: every optional
    provider var (`THINKING_OPENAI_API_KEY`, `CALLBACK_DEEPGRAM_API_KEY` +
    project, `CALLBACK_MISTRAL_API_KEY`, `GEMINI_KEY`, VAPID trio,
    `GOOGLE_OAUTH_CLIENT_ID/SECRET`) each with a one-line comment and
    "optional — feature degrades without it." No `ANTHROPIC_API_KEY` entry
    except a comment saying it is deliberately ignored. Fix the stale
    `deploy/README.md` claim in the same commit. (Release-plan Track F
    piece 2, implemented here.)
  - **git-lfs loudness**: the husky guards keep degrading gracefully, but
    gain a one-line stderr warning (`git-lfs not found — media files will
    not be handled; see docs/developer-install.md`) instead of `|| true`
    silence. Doctor makes it a failed check.
- **Vocabulary lock-ins.** None.
- **First implementation chunk (C1) — done.** The dev-loop spike, verified
  on a clean clone; landed two fixes (commit `0d2fbfb8`): `cb init`
  defaults the box's `callback-box` dep to `link:<checkout>`, and `cb
  serve <package-root>` resolves down to `content/`.
- **Second implementation chunk (C2) — done.** `docs/developer-install.md`,
  `callback-box/.env.example`, the `deploy/README.md` correction, and the
  husky git-lfs stderr warnings (`post-commit`, `post-merge`, `pre-push`),
  plus a root `"cb": "pnpm --dir callback-box cb"` convenience script
  (verified with `pnpm cb --help` from the repo root). The final
  clean-clone walkthrough happens at rollout, not per-chunk.

### Track D — Docker image + compose: local install that doubles as cloud

- **What.** A Dockerfile, an argv-forwarding entrypoint, and a
  `compose.yaml` that run one v2 box through its full lifecycle: locally as
  a developer-facing install, and unchanged on a VPS with an optional Caddy
  profile. A short guide covering both. A container lifecycle test.
- **Why this needs to change.** There is no Docker artifact in the repo
  (verified: none anywhere). The field treats compose as the primary server
  distribution, and our unusually heavy host requirements (native modules +
  four system binaries + git-lfs) are exactly what an image absorbs.
  Boxholder: "A local docker install seems like a good way to exercise the
  cloud install."
- **Direction.**
  - **Image** (`callback-box/docker/Dockerfile`, build context = monorepo
    root since the workspace is needed at build time):
    - Build stage: `FROM node:24-bookworm-slim`, pnpm via corepack,
      workspace install, tarball pack via the `release.ts` path (which
      builds the frontend, `release.ts:67-72`).
    - Runtime stage: `node:24-bookworm-slim` + `apt-get install pandoc
      imagemagick poppler-utils git git-lfs` + pnpm via corepack (the
      runtime needs it for the box-local install). **One runtime user for
      everything**: a non-root user (fixed UID, `user:` overridable in
      compose) that owns `/app`, has the native Claude Code CLI installed
      under *its* home (`deploy/setup-server.sh:80-84` pattern — the CLI
      and its credentials must share one home), and runs `git lfs install`
      plus a container-level git identity (`user.name`/`user.email` from
      env with neutral defaults) and `safe.directory` for `/data/box`.
      Engine installed into `/app` from the packed tarball. Debian (glibc)
      is mandatory (`sdk-binary-path.ts` / SDK issue #296).
    - **Entrypoint with argv pass-through**: any arguments → `exec "$@"`
      (so `docker compose run --rm box cb init /data/box` and
      `docker compose run --rm box claude auth login` do exactly what they
      say). No arguments → readiness check, then
      `cb serve /data/box/content --host 0.0.0.0 --port 3210`.
    - **Readiness check (v2-aware, more than marker-presence)**:
      `/data/box/content/.cb-box` exists, `/data/box/package.json` exists,
      and the box git repo has a HEAD commit (guards the partial-init case
      where `cb init` wrote the marker but died before its final commit —
      `src/core/box/index.ts:63` writes the marker early,
      `src/cli/commands/init.ts` commits at the end). On failure: print
      the exact recovery commands, exit nonzero. Additionally, when
      `/data/box/node_modules` is missing, run the **box-local
      `pnpm install`** before serving (the v2-package requirement;
      `package.ts:137-208`, mirrored from `smoke-external-box.ts:178`).
  - **Compose** (`callback-box/docker/compose.yaml`):
    - `box` service: `restart: unless-stopped`, port mapping
      `127.0.0.1:3210:3210` (loopback-only on the host by default —
      publishing wider is an explicit operator edit), volumes:
      `./data/box:/data/box` (the box package, a git repo the user owns)
      and a named volume at the runtime user's `.claude` (persists
      `claude auth login` credentials across container recreation);
      `env_file: .env` (optional) for provider keys and — as the headless
      auth fallback — `CLAUDE_CODE_OAUTH_TOKEN` from a laptop-side
      `claude setup-token` (an env contract; a volume cannot carry it).
    - `caddy` service under `profiles: [public]` with a two-line
      Caddyfile (domain → `box:3210`); absent from plain
      `docker compose up`.
  - **Auth flow in the guide**: primary = `docker compose run --rm box
    claude auth login` — **to be verified during implementation** (URL +
    paste-code inside a TTY-attached run; known-wobbly, Prior art);
    fallback = `claude setup-token` on any browser machine →
    `CLAUDE_CODE_OAUTH_TOKEN` in the env-file. Whichever the experiment
    favors leads the doc; both ship.
  - **Container lifecycle test** (`scripts/smoke-docker.ts` or a shell
    script beside the Dockerfile): build image → `cb init` a scratch box
    via the entrypoint → box-local install runs → serve → HTTP probe →
    clean shutdown. This — not the image build itself — is what makes the
    Docker path verified; installing the same tarball the external smoke
    uses gives artifact identity, not test identity.
  - **Guide**: `docs/docker-install.md` — local usage first (init, auth,
    up, open `http://localhost:3210`), then the VPS section: same compose,
    DNS + `--profile public` for Caddy TLS, the Tailscale-only variant
    (keep loopback mapping, join tailnet, zero open ports), Google OAuth
    env vars for multi-device access, and the client-connection story
    (URL, PWA install) *in* the guide — Hermes's remote-onboarding gap is
    the cautionary tale (research doc §4). Update = `git pull` + rebuild
    (image is built from source until an image registry is warranted —
    see NOT in scope).
- **Vocabulary lock-ins.** Container paths `/data/box` (the box package;
  operational box at `/data/box/content`), the `.claude` volume name, and
  the entrypoint contract (args = exec, no-args = check + serve) —
  documented in both the compose file and guide; changing them later
  breaks existing deployments.
- **First implementation chunk.** Dockerfile + entrypoint + compose + the
  lifecycle test, run locally end-to-end (init → box install → auth →
  serve → one chat turn). The auth experiment happens inside this chunk
  (both outcomes are shippable — it decides doc emphasis, not design).
  The Caddy profile + guide follow as a second chunk; an actual cheap-VPS
  run is the rollout verification.

## Subplans

None. The one candidate — hub-shaped multi-box compose — is explicitly
deferred (NOT in scope) rather than subplanned; single-box `cb serve` is the
whole Docker story this cut.

## Failure modes

> **Critical gap (accepted, documented):** in-container `claude auth login`
> may not complete on some terminals/platforms. Handling: the Track D chunk
> runs the experiment; the env-token fallback (`CLAUDE_CODE_OAUTH_TOKEN`
> via env-file) ships regardless and the doctor/preflight report auth state
> precisely. Accepted because both paths are documented and the failure is
> loud, never silent.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `pnpm install` on Node 22 half-succeeds, breaks later in native builds | After A2: enforced at install (`engine-strict`) | Fails before any package installs | Clear (version message) |
| `engine-strict` breaks an unanticipated environment (worktree hook, deploy checkout, contributor) | A2's pre-checks + fresh frozen install under 24 | Own commit — one-line revert | Clear (install refuses loudly) |
| Agent run with missing/expired Claude login | Preflight doctest (fake `ClaudeCli`) | Track B preflight → actionable error | Clear after B (today: opaque) |
| macOS dev never learns their Claude auth is broken | health probe doctest updated | `health.ts` rerouted through `claude auth status` | Clear after B (today: silently skipped) |
| git-lfs binary present but filters never installed → media committed as plain blobs | Doctor check (`filter.lfs.clean` probe) | Doctor + `git lfs install` baked into image; husky warning | Clear after B/C/D (today: silent) |
| `pandoc`/`magick`/`pdftotext` missing → agent promised tools that fail mid-task | Doctor check test | Doctor + docs prerequisites; image bakes them in | Clear after B (today: fails at first agent use) |
| Fresh v2 box served without its box-local `pnpm install` → schemas/views fail on first load | Container lifecycle test; `smoke-external-box.ts` for the non-Docker path | Entrypoint installs when `node_modules` missing; quickstart step is explicit | Clear after C/D (today's docs: silent trap) |
| `cb init` dies after writing the marker, before the initial commit (no git identity, ownership refusal) → volume looks initialized | Lifecycle test covers the happy path; readiness check covers the partial state | Readiness requires marker + package.json + HEAD commit; image sets git identity + `safe.directory` | Clear (entrypoint refuses with recovery commands) |
| Bind-mount UID mismatch → git refuses the box repo (`dubious ownership`) | Manual (documented) | Fixed-UID runtime user + documented `user:` compose override + `safe.directory` | Clear (git's own error + guide section) |
| Docker entrypoint started against an empty volume | Lifecycle test | Readiness check prints the exact init command, exits nonzero | Clear |
| Compose accidentally exposes the box publicly on a VPS | No (config, not code) | Default mapping `127.0.0.1:3210:3210`; public access only via explicit Caddy profile. The Tailscale variant never rebinds this mapping — it keeps loopback and fronts it with `tailscale serve` (`cb tailscale setup`), so the box is never bound off-loopback | Fail-closed by default |
| Claude credentials volume lost on `docker compose down -v` | No | Named volume (survives `down`; `-v` is explicit destruction); guide warns next to the auth section | Clear-ish (documented; re-login is cheap) |
| Dev-loop doc promises a flow that doesn't work on a clean clone | The C1 spike IS the test; rollout adds a clean-clone walkthrough | Doc promises only what was exercised | Clear (spike precedes doc) |

## Agent-flow / user-flow edge cases

This plan is operator/installer infrastructure; no card, tag, ref, or
validation surface changes. Per the template, stated explicitly:

- **Wrong tag / stale ref / two agents / fabricated value / validation UX**
  — **GAP by irrelevance**: no agent-facing vocabulary or card shape is
  introduced or changed.
- **Hand-edit drift** — **ADDRESSED** where it applies: compose/Caddyfile
  are operator-owned files; the entrypoint validates what it depends on
  (the readiness check) rather than trusting the mount.
- **Partial migration / transition state** — **ADDRESSED**: the only
  behavior-changing flip is `engine-strict`, isolated in its own commit
  behind explicit environment checks (Track A step 2). Docker and doctor
  are purely additive; the personal `deploy/` path is untouched, so the
  live deployment has no transition state at all.

## NOT in scope

- **npm publish / registry-hosted image.** The tarball stays a local build
  artifact; publishing is its own release with versioning concerns
  (release plan NOT-in-scope stands). The Docker guide says "build from
  source" until then.
- **curl|bash installer + onboarding wizard.** The field ladder is source
  → package → installer → wizard; we are at rung one-and-a-half
  (research doc §5, rows 7–8). Trigger: published package + evidence
  strangers stall on the quickstart.
- **Hub-shaped multi-box compose.** Prod runs `cb hub`; the public Docker
  story is one box per compose project. Multi-box operators exist only
  hypothetically today. Trigger: a real second-party multi-box request.
- **Explicit-config `ANTHROPIC_API_KEY` path.** Stays in the release
  plan's Track F piece 1 as decided-but-unbuilt; this plan's auth story is
  subscription login per the boxholder's preference. The `.env.example`
  comment and install docs say so plainly.
- **Genericizing `deploy/` scripts or the dev router/worktree harness.**
  Both explicitly retained as personal tooling (release plan decisions);
  the Docker path exists so they never need to be public.
- **First-run web onboarding / admin key-management UI.** Release plan
  Track F items; not needed for a developer install.
- **CI.** A CI job running doctor/smoke/docker-lifecycle would be lovely
  and is community-infrastructure fast-follow territory (release plan
  NOT-in-scope), not this plan. The lifecycle test is runnable locally;
  wiring it to CI waits for CI to exist.

## Open design questions

- **Does doctor ever become `cb doctor`?** Boxholder concern recorded:
  `cb` is the box-facing CLI, and widening it for operator tasks is "a
  constant issue, but… maybe it's fine." Lean: keep it out of `cb` now
  (root `bin/doctor.ts` only); revisit at npm-publish time, when a
  stranger has *only* `cb` on their machine and a root script no longer
  exists for them — that is the moment `cb doctor` earns its place. Note
  the container has the same shape (no monorepo root), but the container
  bakes its prerequisites in, so the doctor matters far less there; the
  entrypoint readiness check covers the container-specific failure modes.
- **Root convenience `cb` script** (`"cb": "pnpm --dir callback-box cb"`)
  vs documenting `cd callback-box` — cosmetic. **Resolved in C2: adopted.**
  Added to the root `package.json`, verified with `pnpm cb --help` from
  the repo root; it removes a whole class of wrong-directory confusion for
  newcomers. The doc's canonical sequence still uses `cd callback-box`,
  which works everywhere; the root script is mentioned as optional sugar.
- **Exact `packageManager` pnpm version** — read from the machine at
  implementation time (`pnpm --version`); pinning is the decision, the
  number is mechanical.

## Knowledge audits

Skip with rationale: nothing here is agent-facing. The doctor, compose
files, and install docs are operator surfaces; the one agent-adjacent
artifact (the `chat.ts:11-15` external-tools promise) is unchanged — the
plan makes the *promise true* in more environments, it does not alter what
the agent is told. No entries in `src/dev/knowledge-audits.yaml`.

## Implementation order

1. **A1: Node pin** — root `.nvmrc`, `engines`, `packageManager`,
   `setup-server.sh` one-liner. One commit.
2. **A2: `engine-strict`** — own commit, after the environment checks and
   a fresh frozen install under Node 24.
3. **B1: `bin/doctor.ts` + tests + root script.** Depends on A1 (the Node
   check reads the engines field).
4. **B2: run-path preflight + health-probe rewire** (each its own commit,
   both via `ClaudeCli`). Also update the release plan's Track F to point
   here.
5. **C1: dev-loop spike** (`serve` on a clean clone, built frontend,
   `Procfile.dev`, `--dev` scope); fix what it surfaces; settle the root
   `cb` convenience script.
6. **C2: `docs/developer-install.md` + `.env.example` +
   `deploy/README.md` correction + husky lfs warning.** Depends on B1
   (doc ends with `pnpm doctor`) and C1.
7. **D1: Dockerfile + argv entrypoint + compose + lifecycle test**,
   exercised locally end-to-end (init → box-local install → auth
   experiment → serve → one chat turn). Depends on A1 and C1.
8. **D2: Caddy profile + `docs/docker-install.md`** (local + VPS + auth
   fallback + Tailscale variant).

## Rollout shape

- **Test posture.** Tests first, as design tools: the doctor's checks are
  designed as testable functions under the existing root `bin/*.test.ts`
  harness (fake exec); the preflight doctest (fake `ClaudeCli` → the exact
  actionable message) and the health-probe doctest update name their
  codepaths' contracts. The container lifecycle test is the Docker path's
  done-when — build → init → box install → serve → HTTP probe → shutdown —
  designed alongside the entrypoint, not after it.
  `scripts/smoke-external-box.ts` stays the regression anchor for the
  tarball artifact both paths consume. The plan's overall done-when adds:
  one clean-clone walkthrough of `docs/developer-install.md` on a machine
  without the personal `~/src` layout (a temp `git clone` + fresh
  `~/boxes` path suffices), and one real cheap-VPS run of the compose file
  before the guide ships.
- **Rollout verifications — executable approximations landed 2026-07-12.**
  Both outstanding done-when items now have repeatable Docker harnesses in
  `callback-box/docker/` (the runs are the deliverable; the scripts are the
  residue):
  - `smoke-dev-install.sh` — the clean-clone walkthrough, from a bare
    `debian:bookworm` following `developer-install.md` step by step to a
    served box + a `pnpm run doctor` that passes every check except headless
    "Claude auth". **Result: PASS (~150s).** Surfaced three
    `developer-install.md` gaps (all fixed): no stated Linux Node-22
    mechanism, no Claude Code CLI install command, and no note that Debian's
    ImageMagick 6 lacks the `magick` name.
  - `smoke-vps-install.sh` — the compose file exercised against a real
    daemon, inside a privileged `docker:dind` "VPS": build → `cb init` →
    `up` → HTTP 200 → `--profile public` Caddy → 200 through Caddy.
    **Result: PASS.** Caught a compose bug the existing `smoke-docker.sh`
    could not (it uses a scratch compose file): `${CB_DOMAIN:?…}` was
    interpolated at load time before profile filtering, so it broke even the
    plain local `docker compose up`/`run` flow — fixed to `${CB_DOMAIN:-}`.
  - **Still needs a human / real infra** (unchanged): real ACME/Let's Encrypt
    issuance and DNS (the harness uses `CB_DOMAIN=localhost` → Caddy internal
    CA, probed with `curl -k`), ports 80/443 from the public internet, the
    Tailscale-only variant, interactive `claude auth login`, and the
    macOS/Homebrew prerequisite path (the harness exercises Debian/apt).
- **Knowledge audits.** None (skip recorded above).
- **Migration.** No data-shape changes. The only flip with blast radius is
  `engine-strict`, isolated in A2; everything else is additive. The plan
  ships as one unit; merging to main is the boxholder's explicit call, per
  plan discipline.
