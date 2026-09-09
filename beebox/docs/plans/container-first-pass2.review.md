# Plan Engineering Review 2 — container-first

Second pass, deliberately narrow. It checks only the mechanisms the revision
added or changed, and states for each first-pass finding whether the revision
resolves it. Findings the revision resolves are not re-litigated.

Paths are beebox-relative unless prefixed `<root>/`.

## First-pass findings — disposition

| First-pass finding | Verdict |
|---|---|
| `update` overwrites itself mid-execution | resolved |
| The checkpoint commit runs the box's pre-commit hook | partial |
| `restart: unless-stopped` turns the exit-3 refusal into a crash loop | resolved |
| `bbx converge` drops the 600 s bound the shell it replaces has | partial |
| `git reset --hard` does not revert the docs refresh | resolved |
| `+` is not a legal Docker tag character, and `update edge` produces one | resolved |
| Offline install needs the pnpm metadata cache | resolved |
| The box's tracked `pnpm-lock.yaml` will record `/app/node_modules/beebox` | resolved |
| `/deploy` is a new host-ownership surface | partial |
| The three commands are never written down | resolved |
| `docker compose run -v` leaves `/deploy/data/box` and `/data/box` aliased | resolved |
| The backwards refusal has a hole exactly where `edge` lives | resolved |
| `BBX_SKIP_CONVERGE=1` now disables the Ghost guard | resolved |
| Converge's exit-code vocabulary does not cover a crash | resolved |
| `bbx-setup` "idempotent" is not free | resolved |
| The image workflow's `permissions` block and cache strategy are missing | resolved |
| Multi-arch: `fclones` is amd64-only | resolved |
| The rollback recovery command names git-lfs | resolved |
| Wrong path: `site/cards/index.site-page.card` | resolved |
| Three imprecise citations and one misdescribed precedent | resolved |
| The `src/frontend` empty-search claim is narrower than it reads | resolved |
| `container/` at the monorepo root is not registered anywhere | resolved |
| NOT-in-scope gap: a box that leaves the container | resolved |
| NOT-in-scope gap: an image healthcheck is neither in scope nor deferred | open |

Counts: 20 resolved, 3 partial, 1 open.

Notes on the three partials and the one open, so the planner does not have to
guess which half moved:

- **Checkpoint / pre-commit.** `--no-verify` is the right instrument and it
  exists (`src/lib/git.ts:76`, `:314`), and the step-1 failure path is now
  defined (exit 2, record, nothing to revert). What is still unexamined is that
  the same hook also runs `git annex pre-commit .`; see the finding below.
- **The 600 s bound.** It is back, and named. But `startAwakeTimeout` fires a
  callback; it does not cancel an in-process step or kill a child process, and
  the shell it replaces used `timeout 600`, which SIGTERMs. See the finding.
- **`/deploy` ownership.** The refusal, the two printed fixes, and the
  `smoke-vps` chown-removed step all land. One of the two printed fixes
  (a compose `user:` override) breaks other image assumptions. See the finding.
- **Image healthcheck.** Still absent from `deployment/compose.yaml` and from
  NOT in scope. With `bbx serve --refusal` the container is deliberately "Up"
  while refusing, which makes "is this deployment healthy?" answerable only in a
  browser. Either add a healthcheck whose failure distinguishes refusal from
  serving, or defer it in one line.

## What already exists

Re-verified only where the revision now leans on it.

- **`getBoxShape` accepts the symlink farm.** The dependency check is
  `requireBeeBoxDependency` (`src/lib/box-shape.ts:207-228`), which reads the
  box's `package.json` and asserts the *name* `beebox` appears in
  `dependencies`/`devDependencies`. It never inspects `node_modules`. The farm
  is invisible to it, which is what the plan needs.
- **`commit()` supports `--no-verify`.** `src/lib/git.ts:76` (`noVerify?:
  boolean`) and `:314` (`if (options.noVerify) commitArgs.push("--no-verify")`).
  The doc comment at `:66-75` names `box-packageify` as the one deliberate
  exception today; `src/core/migrations/one-root-run.ts:403` is a second
  precedent the plan could cite and does not.
- **The pre-commit hook's contents.** `src/core/install-validation-hooks.ts:208-260`
  — an annex block (`:228`, `git annex pre-commit .`) *above* the bbx block, then
  `"$BBX" validate --pre-commit` (`:259`). Two gates, not one.
- **`command-runner.ts` has no timeout and no kill.** `grep -n
  "timeout\|kill\|SIGTERM\|signal" src/core/command-runner.ts` returns nothing.
  The bound the plan promises has to be built.
- **Node-target views do not depend on the box's `react` link for instance
  identity.** `src/webapp/views/node-view-runtime.ts:86-91` symlinks the box's
  `node_modules` in as the outer resolution root, then *overrides* `react` in
  the inner directory with the engine's own realpath. `react-dom` is not in the
  node-target external list (`src/webapp/views/compiler.ts:182-190`), so it is
  bundled through the box's `node_modules` — the farm's `react-dom` link is the
  one that must be right or an esbuild resolve error is the symptom.
- **Citations added in this revision, spot-checked and correct:**
  `migration-sweep.ts:96` (`skipped-dirty`), `:101` (`needs-procedure`), `:126`
  (`Created-By: migration-sweep`); `src/core/box/index.ts:236` (`node_modules/`),
  `:246` (`_config/connectors/*.secret.*`), `:255-256` (`.beebox/`,
  `_content/docs/generated/`); `docs-refresh.ts:7-9`; `status.ts:37-42`;
  `docs/assets.md:168` (`git annex fix`); `src/lib/git-stale-lock.ts` exists;
  `package.ts:122-137` / `:198-214`; `scripts/release.ts:84`;
  `auth-preflight.ts:40-41`. The first pass's five imprecise references are
  corrected.

## Prior art (external) — verified

Only the two items the revision adds were re-checked.

- **Image tag grammar.** `[A-Za-z0-9_][A-Za-z0-9._-]{0,127}` — `0.1.0-edge.5.abc1234`
  is legal. Correct, and the `+` problem is genuinely gone.
- **A truncate-and-rewrite of a running bash script executes garbage; an atomic
  `rename()` leaves the running copy intact.** Correct, and it is the right fix
  for `update`. The plan states it as the reason `bbx-setup` writes every file
  by temp-file-and-rename, which also makes the property hold for files nobody
  thought about.

Not re-verified (unchanged from the first pass and accepted there): Compose
interpolation, `docker/metadata-action`, arm64 runners, GHCR default privacy,
Immich, Nextcloud AIO, Ghost-CLI #699, `CODEX_HOME`.

## Stated preferences this plan trades against

Unchanged in substance; the revision adds `docs/assets.md` (annex, not LFS) and
the `entrypoint.sh:100-103` / `:107-110` policies, both correctly quoted. One
preference is newly *strained* rather than traded: the sweep's dirty-box rule
(`migration-sweep.ts:16`) is now bypassed by a `--no-verify` commit, which is a
second exception layered on the first, and only the first is argued.

## Could this be simpler? (verified)

The section is genuinely argumentative, names two simpler versions, says why
each fails, and lists five things dropped as over-built. It holds.

One simplification the section does not consider, and should: **the symlink
farm could be one symlink.** The plan's own justification for the farm is the
single-React-instance invariant — but `node-view-runtime.ts:88-91` already
forces React identity by overriding it with the engine's copy, and
`getBoxShape` needs only a name in `package.json`. If the surviving consumers
are `react-dom` bundling and `tsc`, the farm may reduce to `beebox`, `react`,
`react-dom`, `.bin/tsc` and the two `@types` — which is what it is. That is
fine, but the section should say the farm is exactly six links and not a
general package-manager replacement, because "a symlink farm derived from the
box's `package.json`" reads like the latter.

## Failure modes

The table gained rows and is materially better. Three rows marked "clear" are
not, and one row is missing.

- *"A converge step hangs | converge doctest (fake runner) | 600 s awake-time
  bound per step, then the exit-2 path | clear"* — a timer that cannot cancel
  the thing it is timing does not produce the exit-2 path. See the finding.
- *"A box dependency the image cannot resolve | smoke-docker (negative case) |
  `bbx-setup` fails naming it"* — depends entirely on which resolution root
  `bbx-setup` uses; with the obvious one, `react` is the *scaffolded* dependency
  that fails to resolve. See the finding.
- *"`update` with no argument on a machine that cannot reach GHCR | none |
  `docker pull` fails; script exits before touching `.env` | clear"* — true only
  if the pull is a bare `docker pull <target>` and is the first step. The plan's
  prose says "pulls the target", not which command; `docker compose pull` would
  pull the *old* pin.
- **Missing row:** `bbx-setup` from the new image rewrites the running box's
  `node_modules` while the old container still serves it. See the finding.

## Agent-flow / user-flow edge cases

Adequate and unchanged in shape. One case the revision creates and does not
list: **a contributor's `BEEBOX_VERSION=local`.** The pin is a tag, and step 3
of `bbx-setup` writes an *engine version* into it. For published images the two
strings are equal by construction; for a locally built image they are not, and
the plan's contributor instructions and Track F harnesses both live in the gap.
See the finding.

## Findings

### The symlink farm's resolution root is ambiguous, and the obvious reading silently fails for `react`

**Location in plan:** Track B, Direction, "Box `node_modules` without a package
manager" (plan lines 332-345).
**Citation:** *"for every name under `dependencies` and `devDependencies`, a
link to that package as resolved from `/app/node_modules/beebox` (so `beebox`
links to the engine, `react` to the engine's own `react`, keeping the
single-instance invariant `package.ts:191-197` describes)"*.
**Issue:** "Resolved from `/app/node_modules/beebox`" has two readings and only
one works. `/app/node_modules/beebox` is a pnpm symlink into
`/app/node_modules/.pnpm/<key>/node_modules/beebox`. I built the layout the
image builds (`pnpm add` into a fresh `/app`-shaped directory with no `.npmrc`,
so pnpm 10's default isolated linker applies — the monorepo's
`node-linker=hoisted` is in the root `.npmrc`, which `/app` does not have) and
measured:

- pnpm creates `<pkg>/node_modules/` inside the package directory containing
  **only `.bin`** — for `tsx@4.19.2`, `node_modules/tsx/node_modules` holds
  `.bin` and nothing else.
- Resolving from the *lexical* path
  (`createRequire("<root>/node_modules/react-dom/package.json").resolve("react/package.json")`)
  **throws MODULE_NOT_FOUND**: the empty `<pkg>/node_modules` is searched, then
  the walk goes to the project root's `node_modules`, where a transitive
  dependency is not present.
- Resolving from the *realpath*
  (`.pnpm/react-dom@…/node_modules/react-dom`) finds `react`, `scheduler`, and
  also `typescript` installed at the project root — the `.pnpm` store lives
  under the root `node_modules`, so the ancestor walk reaches it.

So: `@types/node`, `@types/react` and `typescript` installed into `/app`
resolve from *either* root, while `react` and `react-dom` — beebox's own
dependencies, the two the single-instance invariant is about — resolve **only**
from the realpath. A shell `bbx-setup` that tests
`/app/node_modules/beebox/node_modules/<name>` or calls `require.resolve` with
the symlink path gets a farm that is correct for the type packages and broken
for React, and the breakage surfaces as an esbuild resolve error in a view, not
as a `bbx-setup` failure.
**Why it matters:** This is the plan's central new mechanism and the failure is
partial, which is the worst shape: `bbx-setup` exits 0, the box serves, and only
JSX views break. The failure table's *"A box dependency the image cannot
resolve → `bbx-setup` fails naming it"* row assumes an all-or-nothing outcome
that the layout does not produce.
**Suggested action:** State the resolution rule explicitly and in one sentence —
e.g. "resolve every name with `node -e 'require.resolve(name + "/package.json")'`
run with `/app/node_modules/beebox`'s **realpath** as the resolution base, and
fail loudly on any name that does not resolve" — and have `smoke-docker.sh`'s
negative case assert that a *removed* `react` is what fails, not only an
invented package name. Also state that scoped names (`@types/node`) need their
scope directory created in the farm.
**Traces to preference:** `docs/engineering-principles.md` 3 (validate at
boundaries) and 4 (resilient and never silent) — a resolution rule that half
works is the silent-failure class both principles exist to close.

### The version grammar can emit a string that is not valid semver

**Location in plan:** Track A, Direction (plan lines 242-247).
**Citation:** *"edge: `MAJOR.MINOR.PATCH-edge.N.SHA7` … and `SHA7` the short
commit, all from `git describe --tags --long`"*.
**Issue:** Semver forbids leading zeroes in a *numeric* prerelease identifier.
A short SHA that happens to be all digits is a numeric identifier, and one that
also starts with `0` makes the whole version invalid. Measured with the
repository's own resolver:

```
0.1.0-edge.5.abc1234  ->  0.1.0-edge.5.abc1234
0.1.0-edge.5.1234567  ->  0.1.0-edge.5.1234567
0.1.0-edge.5.0123456  ->  null
```

The Dockerfile writes this string into `package.json` before `pnpm release`,
so an invalid one fails the build — roughly one commit in 270 (P(first hex digit
is `0`) × P(remaining six are all digits) = 1/16 × (10/16)^6). The same applies
to `-local.N.SHA7`.
**Why it matters:** It is a build that fails for a reason nobody will connect to
the commit hash, on a channel (`edge`) whose whole point is that it builds on
every push. The plan's own doctest list — *"grammar, ordering across all three
forms, rejection of `+`"* — would not catch it, because the case is not in it.
**Suggested action:** Use `git describe`'s own `g`-prefixed short SHA
(`g0123456`), which is never numeric, or prefix with `sha`. Add the all-digit
and leading-zero SHA cases to `test/lib/engine-version-id.doctest.md`.
**Traces to preference:** `docs/engineering-principles.md` 3 — the grammar is a
boundary the plan validates with zod everywhere *except* where it is produced.

### Track F's harnesses cannot run `update`, because the compose file's image name is fixed and `update` always pulls

**Location in plan:** Track F, Direction (plan lines 578-601); Track B,
`deployment/compose.yaml` and `deployment/update`.
**Citation:** *"Image tags in the harnesses are local tags (`beebox:smoke-a`);
the engine version inside each is set by `--build-arg BEEBOX_VERSION`, and the
scratch `.env` pins the local tag."* against *"`image:
ghcr.io/ianb/beebox:${BEEBOX_VERSION:?…}`, no `build:`"* and *"pulls the target
(`latest` with no argument, `edge`, or the concrete tag)"*.
**Issue:** Three concrete blockers, all in the same knot.
(a) The compose file `bbx-setup` writes hardcodes the repository
`ghcr.io/ianb/beebox`. A local tag `beebox:smoke-a` is unreachable from it; the
harness must tag its builds `ghcr.io/ianb/beebox:smoke-a`, which the plan does
not say.
(b) `update` always pulls. `docker pull ghcr.io/ianb/beebox:smoke-a` fails —
the tag exists only in the local daemon. So scenarios 1 and 3, both of which are
described as exercising `update`, cannot invoke it as specified. There is no
`--no-pull`, no local registry, and no stated alternative.
(c) `BEEBOX_VERSION` is simultaneously an image tag and an engine version.
They coincide only for published images. `bbx-setup` step 3 writes *the image's
engine version* into `.env`, so a contributor image built as
`ghcr.io/ianb/beebox:local` gets `BEEBOX_VERSION=0.1.0-local.0.unknown` written
for it and compose then looks for a tag that does not exist — unless the
contributor writes `.env` before ever running `bbx-setup`, which is the reverse
of the documented order.
**Why it matters:** Track F is what makes the rest of the plan checkable, and
`smoke-update.sh` is the only thing that exercises the update path at all. If it
cannot run as described, the plan's done-when ("all four `smoke-update.sh`
scenarios pass locally") is not reachable.
**Suggested action:** Decide the tag/version relationship explicitly. Either
(i) make the image reference itself a variable
(`image: ${BEEBOX_IMAGE:-ghcr.io/ianb/beebox}:${BEEBOX_VERSION:?…}`) and give
`update` a documented `--no-pull` for local tags, or (ii) state that harnesses
and contributors tag under the real repository name and set `.env` by hand
before `bbx-setup`. Then say which of the two namespaces `bbx-setup` step 3
writes.
**Traces to preference:** `docs/engineering-principles.md` 8 (one way to do each
thing) — one string is currently doing two jobs that only coincide in
production.

### The 600 s bound is a timer, not a kill — the mechanism it replaces was a kill

**Location in plan:** Track C, Direction, Steps (plan lines 429-431).
**Citation:** *"Steps, each bounded at 600 s of awake time (`startAwakeTimeout`,
`src/lib/awake-timeout.ts:44`; the bound `entrypoint.sh:107-110` names as
load-bearing, moved into the engine with the policy)"*.
**Issue:** `startAwakeTimeout` accumulates awake time and invokes `onTimeout`
(`src/lib/awake-timeout.ts:28-43`). It has no handle on the work. The shell it
replaces uses `timeout 600` (`entrypoint.sh:114`), which sends SIGTERM to the
child. Two of converge's five steps are in-process engine code (the sweep, the
docs refresh) and cannot be interrupted by a callback at all; the other
candidates run through `runCommand`, which has no timeout or kill support
(`src/core/command-runner.ts` contains no `timeout`, `kill`, `SIGTERM`, or
`signal`). So on a hang the plan's exit-2 path runs `git reset --hard` while the
hung step is still executing — the worst version, because a still-live `git` or
`tsc` child racing a hard reset is exactly how a box gets an orphan
`.git/index.lock` and a half-reset tree.
**Why it matters:** The first review's finding is answered in the plan's prose
but not in its mechanism, and the failure table now marks the hang row "clear".
**Suggested action:** Say what the bound *does*: give `runCommand` an optional
timeout that kills the child (SIGTERM then SIGKILL) and drive it from
`startAwakeTimeout`; for the in-process steps, either run them as subprocesses
(`bbx migrate --sweep`, `bbx docs refresh` — the shell already did) or state
that they are bounded only by the process-level bound and that a hang there is
the "process dies" row, not the exit-2 row.
**Traces to preference:** `entrypoint.sh:107-110`, quoted by the plan itself —
*"'cannot stop the box from serving' is only true if it cannot hang either"*.

### `update` rewrites the live box's `node_modules` from the new image while the old container is still serving

**Location in plan:** Track B, Direction, `deployment/update` (plan lines
385-391).
**Citation:** *"runs `docker compose run --rm --no-deps -v "$PWD:/deploy" box
bbx-setup` (the pinned, new image; `--no-deps` so Caddy is not started; `run`
publishes no ports, so it coexists with the live container); then `docker
compose up -d`"*.
**Issue:** `bbx-setup` step 6 rewrites the box's symlink farm. Those symlinks
point into `/app/node_modules/.pnpm/<name>@<version>/…`, which is
container-local and version-keyed. The new image's paths need not exist in the
old image (any dependency version bump changes the `.pnpm` directory name). The
old container is still running and serving the same box directory, so between
`bbx-setup` and `up -d` its `node_modules/react` and `node_modules/react-dom`
can be dangling — box-local schemas and views break in the live server, which is
precisely the incident `health-engine.ts:5-11` was written for. The window is
short in the happy path, but it is not short if `up -d` fails (a bad pin, a
disk-full, a compose error): the deployment then sits indefinitely on an old
container whose box points at paths it does not have, with `.env` already
pinned forward.
**Why it matters:** "waits for quiet" bounds agent activity, not the engine's own
module resolution, so the plan's existing mitigation does not cover this.
**Suggested action:** Either stop the box before `bbx-setup`
(`docker compose stop box`, then setup, then `up -d` — the box is going down
anyway one command later), or have `update` roll the `.env` pin back if
`bbx-setup` or `up -d` fails. Add the row to the failure table.
**Traces to preference:** `docs/engineering-principles.md` 4 — the degraded
state here is silent to everything except a view render.

### The ownership refusal's second remedy breaks the image's own assumptions

**Location in plan:** Track B, Direction, `bbx-setup` step 1 (plan lines
358-361).
**Citation:** *"refuse unless `/deploy` is writable by the container user,
printing the two fixes (`chown -R 1000:1000 .` or a compose `user:`
override)"*.
**Issue:** The image's runtime state is built for uid 1000 / the `node` user:
the git identity and `safe.directory` entries are `--global` config in that
user's home (`Dockerfile:115-119`, run after `USER node`), `CLAUDE_CONFIG_DIR`
is `/app/claude-config` owned by `node` (`Dockerfile:88-89, 95`), and the
`claude-auth` / `codex-auth` named volumes inherit that ownership. A compose
`user: "1001:1001"` override lands in a home with none of that: `git commit`
fails with "Please tell me who you are", `/deploy` and `/data/box` are dubious
ownership again, and the credential volumes are unwritable. The refusal text
would be handing the user the fix that produces the next three failures.
**Why it matters:** This is printed in a refusal, at the moment a first-time
Linux user is most likely to copy it verbatim.
**Suggested action:** Print `chown` as the fix. If a `user:` override is to stay
supported, the entrypoint has to set `user.name`/`user.email` and
`safe.directory` per-invocation rather than relying on baked global config —
say so, or drop the second remedy.
**Traces to preference:** `docs/engineering-principles.md` 4 — a printed
recovery that does not recover is worse than no recovery.

### `--no-verify` also skips the box's git-annex pre-commit step, and the plan's safety claim does not cover it

**Location in plan:** Track C, Direction, step 1 (plan lines 435-442).
**Citation:** *"passing `--no-verify`. The box's pre-commit hook validates cards
the author asserts are valid; a checkpoint asserts nothing … large files go
where the box's annex attributes send them, as any commit does."*
**Issue:** The hook has two gates, not one. `install-validation-hooks.ts:220-236`
runs `git annex pre-commit .` first, and its own comment says why:
*"`git annex init` declines to install its own hook when ours exists, so this
line is the only thing running annex at commit time"*, with a hard `exit 1` when
the repo is annexed and `git-annex` is missing. `--no-verify` removes both. The
plan's reassurance covers the `.gitattributes` clean filter (correct — that is
not a hook) but not what `git annex pre-commit` itself does, and not the
missing-binary guard, and cites nothing for either.
**Why it matters:** The checkpoint commit is the one commit in the plan that
writes the user's unreviewed working tree into their history, and asset boxes
are the norm (`docs/assets.md`: twelve boxes migrated to annex).
**Suggested action:** Determine what `git annex pre-commit .` does to a
checkpoint (`annex.thin=false`, unlocked files) and either run it explicitly
before the `--no-verify` commit or cite why skipping it is safe. Track F
scenario 3 already seeds an annexed file — extend it to a *dirty* annexed file
so the checkpoint path is covered, not only the reset path.
**Traces to preference:** the bbx-plan discipline — "Cite, don't assert",
including claims of safety.

### A box scaffolded by an `edge` image records an unresolvable prerelease range in its tracked `package.json`

**Location in plan:** "What already exists" (plan lines 128-132).
**Citation:** *"`defaultBeeBoxSpec` (`package.ts:56-58`) already writes
`^<version>` when the engine runs from under a `node_modules`, which is the
image's case. So the box's `package.json` stays registry-shaped and portable"*.
**Issue:** For an edge image the version is `0.1.0-edge.5.abc1234`, so the box's
tracked `package.json` records `"beebox": "^0.1.0-edge.5.abc1234"`. That is a
legal range, but a caret on a prerelease means `>=0.1.0-edge.5.abc1234 <0.2.0`
with prerelease matching restricted to that exact triple — it is not
"registry-shaped and portable" in any useful sense, it names a build that was
never published to a registry, and it is what a user carries out of the
container when they take the box to a from-source or hub install (a path the
plan explicitly keeps in scope under NOT-in-scope). The claim is true for
release images and quietly false for the channel that produces most images.
**Why it matters:** The plan's argument for dropping `BBX_INIT_BEEBOX_SPEC`
rests on this sentence.
**Suggested action:** Either have `bbx-setup`/`bbx init` write the *release*
triple (drop the prerelease) into the box's `beebox` range, or narrow the claim:
release images write a portable range, edge images write a build-specific one,
and here is what a user leaving an edge container does.
**Traces to preference:** `docs/engineering-principles.md` 3 — the box's
`package.json` is a boundary artifact the user owns.

### The 503 refusal is served unauthenticated on whatever interface the deployment exposes

**Location in plan:** Track D, Direction (plan lines 499-503) and Track C's
refusal text (plan lines 464-471).
**Citation:** *"`bbx serve --refusal <file>`: serves the file's text as a 503 on
every path, no auth, no agents, no box"*, and the refusal text prints *"both
versions, and the two ways out with exact commands"*.
**Issue:** The default compose mapping is loopback-only
(`compose.yaml:25-26`), so for a laptop install this is fine. Under the Caddy
public profile or the Tailscale overlay — both shipped in
`container/deployment/` — the same 503 is reachable from the internet or the
tailnet by anyone, before any login, and it discloses the engine version, the
recorded engine version, and a set of host commands. Soft-launch posture is
explicit that *"local dev **always** requires a username/password login"*
(`issues/decisions/2026-07-20-soft-launch-posture.md`, Decisions); this is a new
unauthenticated surface that the posture decision did not consider because it
did not exist.
**Why it matters:** Small, but it is a deliberate hole in an always-on-auth
posture, and the plan asserts "no auth" as a simplification without weighing it.
**Suggested action:** Say the trade explicitly in Track D: either the refusal
body is version-free and generic when the request does not come from loopback,
or the posture decision is amended to allow it. Either is fine; the silence is
not.
**Traces to preference:** the soft-launch posture's "Dev is never open".

### `smoke-update.sh`'s build-cache claim depends on an unstated `ARG` placement

**Location in plan:** "What will hold this after it ships" (plan lines 788-790)
and Track A, Direction (plan lines 262-264).
**Citation:** *"`smoke-update.sh` builds three images from one tree, so it
caches the build stage."* and *"`Dockerfile` takes `ARG BEEBOX_VERSION` … and
writes it into `package.json` in the build stage before `pnpm release`"*.
**Issue:** Docker invalidates every layer after the first one whose inputs
change. `Dockerfile:34` is `COPY . .` and `:39-41` is `pnpm install
--frozen-lockfile && pnpm --dir beebox release`. If the `ARG` is declared and the
version write happens before that `RUN`, three different `BEEBOX_VERSION` values
mean three full monorepo installs plus three frontend builds — the opposite of
the claim. The claim holds only if the `ARG` is declared *after* the install and
the version write is folded into the release step, which the plan does not say.
Separately, scenario 1 requires `update` to differ in length between `smoke-a`
and `smoke-b`; `update` is baked into the image from `container/deployment/`, so
"from the same tree" needs a stated mechanism (patch a scratch copy of the
context, or a build arg), not just an assertion.
**Why it matters:** The harness is described as "minutes and a 2 GB build"; the
un-cached version is three of those, which is the difference between a harness
that gets run and one that does not.
**Suggested action:** Split the Dockerfile's release `RUN` so the install layer
is version-independent, and say so in Track A. Say how the harness produces two
different `update` scripts from one tree.
**Traces to preference:** `docs/engineering-principles.md` 12 (the maintainer is
usually an agent) — a harness too slow to run is a harness nobody runs.

## NOT in scope (verified)

The first pass's one substantive gap — what happens to a box that leaves the
container — is now answered, and answered in the right place: *"A box leaving
the container for one of those runs `bbx upgrade --to <spec>` there; its
`package.json` is registry-shaped, so that is the designed starting state."*
The prerelease finding above narrows that claim but does not remove it.

Two additions since the first pass are correctly bounded: *"A box that adds its
own npm dependencies inside the container"* (the symlink farm's real limit,
named as a limit rather than hidden) and *"The scan uploader's clone
instruction"*.

The image healthcheck is still neither in scope nor deferred. With
`--refusal` the container being "Up" now means less than it did, which makes the
omission more visible than it was in the first draft.

## Things I checked and found clean

Listed so "looked and it is fine" is distinguishable from "did not look".

- **The Codex bin path is right, and the first review's correction of it was
  itself right.** The plan now says
  `/app/node_modules/beebox/node_modules/.bin/codex`. I expected this to be
  wrong under pnpm's isolated layout and measured it: pnpm creates
  `<pkg>/node_modules/` containing exactly `.bin`, populated with the bins of
  that package's dependencies (`node_modules/tsx/node_modules/.bin` holds
  `esbuild` and `tsx`). So the path exists, and it is the shim, matching
  `deploy.sh:558`'s intent. The same fact means `node_modules/.bin/tsc` is
  available to the farm without `typescript` being installed at `/app` at all.
- **`bbx serve --refusal` is compatible with the command's argument shape.**
  Dirs are variadic (`serve.ts:1-15`), so `bbx serve --refusal <file>` with no
  dirs parses; the flag has to short-circuit before `resolveBoxes`/`findBoxRoot`,
  which is a one-branch change, and the entrypoint's `WORKDIR /app` means the
  no-args cwd fallback must not run. Small, as claimed.
- **Nothing in compose defines a healthcheck today** (`compose.yaml` has no
  `healthcheck:` key), and `caddy`'s `depends_on: box` has no condition — so a
  refusing box does not make Caddy fail to start, and no probe misreads the 503.
- **The symlink farm removes a latent duplicate-engine bug.** Today the box
  installs `file:/app/beebox.tgz`, giving the box a *second* copy of the engine
  package; a box schema importing `beebox/...` therefore loads a different
  module instance than the serving engine. The farm collapses that to one
  realpath. The plan does not claim this and could.
- **No workspace member depends on `beebox` by version**, so stamping
  `package.json`'s `version` in the build stage cannot break `pnpm install
  --frozen-lockfile` through the lockfile's importers. (`grep '"beebox"'
  --include=package.json` finds only the two package names.)
- **`getBoxShape` does not care about the farm** (see "What already exists").
- **`bbx-setup`'s `git init` of `/deploy` has an identity.** The image sets
  `user.name`/`user.email` `--global` for the `node` user
  (`Dockerfile:117-118`), so a commit in `/deploy` works without the entrypoint,
  which `bbx-setup` bypasses when invoked as `docker run … bbx-setup`. This is
  the one place where the argv-forwarding entrypoint's "no git identity from
  `BBX_GIT_NAME`" gap is harmless.
- **Every citation the revision added was opened** and is listed under "What
  already exists"; all resolve to the quoted text.
- **All template sections are present with verbatim headers**, "Subplans: none"
  and "Knowledge audits: skip-with-rationale" are argued, and no open question
  sits inside a first implementation chunk. Implementation order remains
  dependency-correct with the new step 4 (`--refusal`) inserted before the
  entrypoint that needs it.
