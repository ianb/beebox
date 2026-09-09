# Plan Engineering Review — container-first

Reviewed `beebox/docs/plans/container-first.md` at draft status. Every
`file:line` in the plan was opened. Citation tally: 51 checked, 45 exact, 6
wrong or imprecise (listed under Findings). Searches the planner reported as
empty were redone.

## What already exists

Confirmed as the plan describes, by reading the source:

- `beebox/docker/` holds `Dockerfile`, `entrypoint.sh`, `compose.yaml`,
  `Caddyfile.example`, `compose.tailscale.yaml`, `tailscale-serve.json`,
  `tailscale.env.example`, and the three smoke scripts. The move to
  `container/` is a `git mv` of eleven files.
- The entrypoint contract is real and at the cited place: `entrypoint.sh:35-37`
  (`if [[ $# -gt 0 ]]; then exec "$@"; fi`), converge block `:111-125`, readiness
  `:45-65`, serve `:130`.
- `bbx activity`'s per-box helpers are already path-parameterized:
  `loadRunningScripts(boxRoot)` and `findBusyBlockers(boxRoot, running)`
  (`src/cli/commands/activity.ts:26-27`). Adding an optional path argument is a
  three-line change; nothing else in `activity` is fleet-shaped. This is the
  cleanest claim in the plan.
- `_config/migrations.jsonl` is tracked (`src/core/migrations.ts:161`, and the
  box `.gitignore` written by `writeBoxGitignore` ignores nothing under
  `_config/` except `connectors/*.secret.*` and `schedules/.state/`).
- `.beebox/` is gitignored (`src/core/box/index.ts:255`), so
  `.beebox/converge-failure.json` survives the `revertToSnapshot` (`reset --hard`
  + `clean` without `-x`) as the plan assumes. Verified against
  `upgrade.ts:185-195`, whose comment states the `-x` reasoning explicitly.
- `revertUpgrade`, `getHead`, the `Upgraded-To` trailer, and the typecheck step
  are all where the plan says (`upgrade.ts:259`, `:264`, `:284-290`, `:295-298`,
  `:302`).

Not as the plan describes — see Findings: the site card's path, the
`auth-preflight` line, the `docs-refresh` line, the production `codex` symlink
target, and the `readEngineVersions` range citation.

## Prior art (external) — verified

I did not re-fetch every URL, but I checked the claims that the design rests on
against the repository and against what the cited documents say.

- **Compose `run -v` adds to the service's volumes; it does not replace them.**
  Confirmed against the compose reference the plan already cites. Consequence
  for this plan under Findings ("`/deploy` and `/data/box` alias").
- **Only the project-directory `.env` interpolates.** Correct, and
  `docker/compose.yaml:37-39` already uses `env_file: path: .env, required:
  false` — so `.env` is *both* interpolated into the file and injected into the
  container. `BEEBOX_VERSION` will therefore also appear as a container
  environment variable. Harmless, but the plan should not be surprised by it.
- **`semver` is transitive only.** Redone: `grep '"semver"'` in
  `beebox/package.json` and the root `package.json` returns nothing;
  `pnpm-lock.yaml:8346` is `semver@7.8.1:` as cited. The claim holds.
- **`git tag | wc -l` = 0** and `scripts/release.ts` never writes `version`.
  Both confirmed.
- **git-lfs prior art is aimed at the wrong mechanism.** `docs/assets.md:6-21`
  says all twelve local boxes were converted to **git-annex** on 2026-07-31,
  "738 Git LFS files taken over", and `:193` says the shipped attributes file
  "carries no `filter=lfs` rules at all, so every box gets the same LFS-free
  file." A modern box has no LFS. See Findings.
- **`ubuntu-24.04-arm` free for public repos / manifest-merge pattern** — the
  described shape (one build job per platform, push by digest, merge) matches
  Docker's documented multi-platform CI recipe. No contradiction found.
- **GHCR private by default** — matches the cited GitHub docs. The rollout item
  is correctly flagged as manual.
- No prior art was cited for the one genuinely novel mechanism (an image that
  rewrites the host's compose file *and the update script that is currently
  executing*). Nextcloud AIO is named as "the closest pattern"; the plan does
  not say what AIO does about the self-rewrite problem, and AIO in fact does not
  have it (the mastercontainer drives the Docker socket rather than rewriting a
  script the host is running).

## Stated preferences this plan trades against

The section is present and specific, and each named preference is a real
document at the cited place:

- `boxes-as-packages-v2.md:26` — *"**Versioning** — per-box pinning is the
  mechanism; the fleet staying current is policy"*. Verbatim. The plan names the
  departure and confines it to the container. Honest.
- `upgrade.ts:8-9` — the Ghost-lesson quote is verbatim.
- `migration-sweep.ts:16` — the dirty-box quote is verbatim, and the plan
  correctly frames the checkpoint commit as an exception rather than a
  reinterpretation.
- `installation-story.md:434` — the entrypoint contract quote is verbatim.

One preference the plan does not name and should: `beebox/CLAUDE.md`'s
"**Read before writing**" and the `docs/engineering-principles.md` 4
(never silent) tension in `BBX_SKIP_CONVERGE` — see Findings.

## Could this be simpler? (verified)

The section is a real gate, not prose. It names two simpler versions and
refutes each with a specific failure, and it lists four things dropped as
over-built. That is the strongest section in the plan.

Two of the four "what the fuller plan buys" claims do not survive checking:

- *"the box's code and the serving engine cannot differ (principle 6: the
  mismatch state becomes unrepresentable)"* — true for the engine **package**,
  but the box's `pnpm-lock.yaml` and its `react`/`typescript` devDependencies
  are still separately pinned and still skew (see the `link:` findings). The
  unrepresentability is narrower than claimed.
- *"The version record and the backwards refusal: the Ghost failure is refused"*
  — refused only when the core triple differs. Two `+edge.<sha>` builds of the
  same triple, or an `edge` build and its release, compare equal and are not
  refused (Finding: "backwards refusal has a hole exactly where `edge` lives").

The simplest version the plan does *not* consider, and should say why it
rejected: **keep the `file:` tarball and have the entrypoint re-run the box
install when the engine version changes**. That fixes the stale-box-engine
problem the plan opens with (`entrypoint.sh:70`) without `link:`, without an
offline store, and without `pnpm install --offline`. It is worse (a per-update
copy of the engine into the box, and a real network install), but it is a
genuine middle rung and its absence makes the `link:` decision look less
examined than it is.

## Failure modes

The table has 18 rows and one declared critical gap, and the gap is the right
one (a box that cannot typecheck under the only engine in the image). The rows
I could check against source are accurate: `git-stale-lock.ts` exists;
`stop_grace_period` is genuinely absent from `compose.yaml` today; the
`--network none` offline check is a real test.

Failure modes the table misses, each written up under Findings:

1. `update` rewrites itself while bash is executing it.
2. The checkpoint commit runs the box's own pre-commit hook, which blocks.
3. `restart: unless-stopped` turns the exit-3 refusal into a crash loop.
4. `bbx converge` has no timeout, where the shell it replaces had 600 s.
5. `git reset --hard` does not revert `_content/docs/generated/`.
6. `+` is not a legal Docker tag character.
7. Offline resolution needs the pnpm *cache* dir, not just the store dir.
8. The box's tracked `pnpm-lock.yaml` will carry `/app/node_modules/beebox`.
9. `/deploy` written by uid 1000 — a new host-ownership surface.
10. `bbx-setup` run twice: `git commit` with nothing staged exits nonzero.

## Agent-flow / user-flow edge cases

Seven of the template's seven cases are marked and each is marked ADDRESSED with
a mechanism, not a hope. "Fabricated free-form value: not applicable; no agent
writes any of these files" is a legitimate skip-with-rationale.

The "Partial migration / transition state" entry is the weakest: it asserts
"Only the boxholder's own test installs are in this state," which is true today
and stops being true the moment anyone runs `edge`. The rewrite of a
user-owned `package.json` dependency line from `file:` to `link:` is described
in one clause and is the single most invasive thing in the plan; it deserves its
own paragraph naming what happens if the rewrite is applied to a box that is
*not* container-hosted (a box moved out of the container onto a from-source
checkout now has a `link:/app/...` dependency that resolves nowhere).

## Findings

### `update` overwrites itself mid-execution

**Location in plan:** Track B, Direction — `deployment/update` bullet, and the
`bbx-setup` bullet ("writes every file in `container/deployment/` into
`/deploy`").
**Citation:** *"runs `docker compose run --rm --no-deps -v "$PWD:/deploy" box
bbx-setup`; `docker compose up -d`"* — with `update` itself listed among the
files `bbx-setup` writes: *"`container/deployment/` (the files `bbx-setup`
writes: `compose.yaml`, `Caddyfile`, … `update`, …)"*.
**Issue:** `./update` invokes `bbx-setup`, which rewrites `./update` in place,
and then bash continues reading the *same file descriptor at the old byte
offset*. If `bbx-setup` writes with truncate-and-write (`cp`, `>`), the running
script reads whatever bytes now sit at that offset — a partial line, a different
command, or EOF. The plan's own ordering guarantees this happens on **every**
update where the `update` script changed size.
**Why it matters:** The single command the plan promises a user
("*When a release comes out, I want to run one command*") can execute a spliced
half-command against a live box mid-update, after the pin has been rewritten and
before `docker compose up -d`.
**Suggested action:** Require `bbx-setup` to write every owned file
write-to-temp-then-`rename()` (atomic replace leaves the running bash reading
the old inode intact), and say so in the plan as a contract, not an
implementation detail. Add a Track F assertion that an `update` which changes
`update`'s own length completes.
**Traces to preference:** `docs/engineering-principles.md` 4 (resilient and
never silent) — a truncated script fails in a way with no error message at all.

### The checkpoint commit runs the box's pre-commit hook, which is designed to block

**Location in plan:** Track C, Direction, step (1).
**Citation:** *"(1) Dirty tree: `git add -A` and commit `Checkpoint before
engine <serving>` with `Created-By: bbx-converge`."*
**Issue:** `bbx init` installs a per-box `.git/hooks/pre-commit` that runs
`bbx validate --pre-commit` — staged card validation, a link warning, and an
unlisted-binary guard (`beebox/CLAUDE.md`, "Git trailers are structured
metadata" and "Validation"). A dirty tree at container start is very often dirty
*because* something is half-written: a card the user was editing in the web UI,
an agent's partial write interrupted by the restart, an untracked binary the
annex guard rejects. In all of those the checkpoint commit **fails**, and the
plan defines no behaviour for that: it happens at step (1), before
`snapshotSha` exists at step (2), so there is nothing to revert to and no
failure record path defined.
**Why it matters:** The most common reason a tree is dirty at restart is
precisely the reason the commit will be rejected. The container then either
crashes on `set -e` or serves in an undefined state, and the plan's failure
table row "Dirty tree at converge → checkpoint commit, then converge → clear"
is wrong for the common case.
**Suggested action:** Define step (1) failure explicitly: what exit code, what
record, whether the entrypoint serves. Decide whether the checkpoint commit
passes `--no-verify` (it is the engine's own commit of the user's work, not a
card the user is asserting is valid) and state the reasoning either way. Add a
Track F scenario seeding an invalid card in the dirty tree.
**Traces to preference:** `docs/engineering-principles.md` 4 — an undefined
failure at the first step of the new codepath is the definition of silent.

### `restart: unless-stopped` turns the exit-3 refusal into a crash loop

**Location in plan:** Track D, Direction; Track B, `deployment/compose.yaml`.
**Citation:** *"exit 3 exits the container with the refusal text (the box is
newer than the engine; serving would be the Ghost failure)"*, and
*"everything else as today"* — where today is `docker/compose.yaml:20`,
`restart: unless-stopped`.
**Issue:** A container that exits nonzero under `restart: unless-stopped` is
restarted by Docker, forever. The refusal text is printed once per restart and
scrolls; `docker compose ps` shows a flapping container, not a stopped one with
a message. The same applies to the new `BBX_DEPLOY_SHAPE` exit 1.
**Why it matters:** Principle 13 (a control shows the state the system is in).
The plan's most important safety behaviour — the Ghost refusal — presents to the
user as an unstable container rather than as a stated refusal, which is exactly
the reading that makes people delete the volume.
**Suggested action:** Either set `restart: on-failure:N` / drop the restart
policy for the refusal path, or make the refusal a *served* state: start the
server and have it serve only the refusal (the health check already exists in
Track C). Say which, and put the choice in the plan rather than in the
implementation.
**Traces to preference:** `docs/engineering-principles.md` 13, and 4 — a loud
failure that repeats forever is a loud failure nobody can read.

### `bbx converge` drops the 600 s bound the shell it replaces has

**Location in plan:** Track D, Direction; Track C, steps 3–5.
**Citation:** *"Then `bbx converge /data/box`: exit 0 or 2 serves"* — replacing
`entrypoint.sh:111-120`, whose comment states: *"'cannot stop the box from
serving' is only true if it cannot hang either, and a migrator that never
returns would leave the operator staring at a container that starts and never
listens. 600s matches the server deploy."*
**Issue:** The plan removes a bound that the code it replaces documents as
load-bearing, and never reintroduces one. Converge now does strictly *more*
than the block it replaces (a `git add -A` commit over a possibly large tree, a
sweep, a docs refresh, and a full `tsc -p .`), all before the port opens.
**Why it matters:** The plan's own reasoning for the removal is that policy
belongs in the engine where doctests reach it — that argument applies to the
timeout too, and it was dropped rather than moved. A wedged `bbx docs refresh`
now means a container that never listens, with no message.
**Suggested action:** Give `bbx converge` a per-step bound (the existing 600 s,
or a stated new one) implemented with `startAwakeTimeout` per
`beebox/CLAUDE.md`'s time discipline, and add the timeout outcome to the
failure table and to the exit-code vocabulary lock-in.
**Traces to preference:** `docs/engineering-principles.md` 4; the entrypoint's
own comment is the most recent shipped precedent and the plan discards it
without argument.

### `git reset --hard` does not revert the docs refresh

**Location in plan:** Track C, Direction, the failure path.
**Citation:** *"On any failure in 3 to 5: `git reset --hard <snapshotSha>` plus
clean, as `revertUpgrade` does (`upgrade.ts:185-195`)"*, and the Ghost claim
*"A git reset to `snapshot` reverts the record with the data … kept by
construction."*
**Issue:** `bbx docs refresh` (step 4) writes to `_content/docs/generated/`
(`src/core/docs-gen/shared.ts:14`, `DOCS_DIR = "_content/docs/generated"`),
which the box `.gitignore` ignores (`src/core/box/index.ts:255-256`). The reset
does not touch it, and `clean` without `-x` deliberately spares it
(`upgrade.ts:189-194`). So after a step-5 typecheck failure the box is reverted
in its *tracked* state but is left holding the new engine's generated agent
docs — the box's guidance and its data are at different engines, which is the
shape of the failure `docs-refresh.ts:10-15` exists to prevent.
**Why it matters:** The plan asserts a total revert ("kept by construction") and
uses that assertion to justify not thinking further about rollback. The
exception is small and self-healing (the cache is engine-keyed, so the next
successful converge regenerates), but it should be *stated* rather than
discovered by the first person to debug a reverted box.
**Suggested action:** Add one sentence to Track C naming
`_content/docs/generated/` (and any other ignored output of steps 3–5) as
outside the revert unit, with the self-healing argument. Do not add `-x` to the
clean — that would delete `node_modules` and `.beebox/`.
**Traces to preference:** the plan's own cited `upgrade.ts:8-9` Ghost lesson —
"code and data revert as ONE unit" is the claim being audited, so its boundary
belongs in writing.

### `+` is not a legal Docker tag character, and `update edge` produces one

**Location in plan:** Track A, Direction (version grammar); Track B,
`deployment/update`; Track F, `smoke-update.sh`.
**Citation:** *"`MAJOR.MINOR.PATCH+edge.<sha7>` for a main build"*, and
*"pulls the target (`latest` when no argument, then reads the image's
`org.opencontainers.image.version` label and writes that as the pin, so the pin
is always a concrete version)"*, with
`image: ghcr.io/ianb/beebox:${BEEBOX_VERSION:?…}`.
**Issue:** An OCI/Docker tag is `[A-Za-z0-9_][A-Za-z0-9._-]{0,127}` — `+` is not
in the set. So:
(a) `./update edge` pulls the `edge` tag, reads the label
`0.1.0+edge.abc1234`, writes that as `BEEBOX_VERSION`, and the next
`docker compose up -d` tries to pull a tag that is both malformed and
nonexistent. The update leaves the deployment unstartable.
(b) Track F's `smoke-update.sh` "builds two images … with versions
`0.1.0+local.a` and `0.1.0+local.b`" — those work as `--build-arg` values but
cannot be the image tags the compose file references, so the harness as
described cannot run.
(c) `update`'s argument is *"validated against the version grammar before
anything runs"*, but its documented signature is `update [X.Y.Z|edge]` and
`edge` is not in the grammar.
**Why it matters:** This is the plan's central user-facing promise (one command
to update) failing on a documented input, and the harness meant to catch it has
the same defect.
**Suggested action:** Separate the two namespaces explicitly in Track A: the
**engine version string** (may carry build metadata) and the **image tag**
(must not). State the mapping — e.g. the pin written to `.env` is always a tag
that exists (`edge` stays `edge`, or edge builds also get a
`0.1.0-edge.abc1234` prerelease tag, which *is* legal). Fix the `smoke-update`
description to name tags separately from `--build-arg` versions.
**Traces to preference:** `docs/engineering-principles.md` 3 (validate at every
read) — the grammar is validated but never checked against the one consumer
that constrains it.

### Offline install needs the pnpm metadata cache, which the plan does not carry

**Location in plan:** Track B, Direction, "Engine link".
**Citation:** *"The image installs those into `/app` at build (same ranges
`readEngineVersions()` writes, `package.ts:190-210`) with a global
`store-dir=/app/pnpm-store`, so the box install runs `pnpm install --offline`."*
**Issue:** `bbx init` writes the box's deps as **ranges**, not exact versions —
`react: "^18.3.1"`, `typescript: "^5.7.0"`, `@types/node: "^22.0.0"`,
`@types/react: "^18.3.0"` (`package.ts:198-214`, values from
`readEngineVersions()` at `:122-137`) — and the fresh box has no lockfile. An
offline install must therefore *resolve* those ranges, which reads pnpm's
registry **metadata cache**. Since pnpm 9 that cache lives in `cacheDir`
(default `~/.cache/pnpm`), a setting distinct from `store-dir`. The plan names
only `store-dir`. Whether this works is currently an accident of whether the
build-stage `pnpm add` ran as the same user with the same `$HOME` that survives
into the final layer.
**Why it matters:** "Box install offline lacks a package (store incomplete)" is
in the failure table with `--network none` as its test, so the plan expects the
harness to catch it — but the failure mode is resolution metadata, not package
bytes, and it will present as a confusing "Failed to resolve" rather than a
missing tarball.
**Suggested action:** Name both settings in the Direction (`store-dir` **and**
`cache-dir`, or ship a committed lockfile with the box template so `--offline
--frozen-lockfile` needs no resolution at all). The lockfile option is the
stronger one and interacts with the next finding — decide them together.
**Traces to preference:** `docs/engineering-principles.md` 6 (right-sized
defensiveness): the plan defends the store and leaves the resolver undefended.

### The box's tracked `pnpm-lock.yaml` will record `/app/node_modules/beebox`

**Location in plan:** Track B, "Engine link"; Track C, Agent-flow "Partial
migration".
**Citation:** *"`ENV BBX_INIT_BEEBOX_SPEC=link:/app/node_modules/beebox`
replaces the `file:` spec"*, and *"`bbx-setup` replaces the box's `beebox`
dependency with the `link:` spec on its first run against such a box (the one
deliberate rewrite of a user-owned file, committed as part of the converge)."*
**Issue:** The box `.gitignore` written by `writeBoxGitignore`
(`src/core/box/index.ts`) ignores `node_modules/` but **not** `pnpm-lock.yaml`.
So the box's git history — the artifact the plan repeatedly calls "their data, a
git repository only they own" — will carry an absolute path that exists only
inside this image, in the lockfile and in `package.json`, in the converge
commit. Moving that box to a from-source checkout, or to a hub install, yields a
dependency that resolves nowhere; `bbx upgrade --to` (explicitly kept in scope
elsewhere: *"`bbx upgrade --to` and per-box pinning for from-source and hub
installs: unchanged"*) now has a starting state it was never designed for.
**Why it matters:** The plan's stated model is that the box is the durable,
portable root of the three. A container-shaped absolute path committed into it
makes the box less portable than it is today, and the plan does not mention it.
**Why it matters more:** the checkpoint commit (`git add -A`) will sweep the
lockfile in whatever state the install left it, under a commit message that says
"Checkpoint before engine X".
**Suggested action:** State the portability consequence in Track B and decide
one of: gitignore `pnpm-lock.yaml` in a container box; keep the `link:` spec out
of the tracked `package.json` (a `.npmrc` override or a `pnpm.overrides` written
to an ignored file); or accept it and document the exit path ("moving a box out
of the container requires `bbx upgrade --to <spec>`"). Add the chosen answer to
"Agent-flow / partial migration".
**Traces to preference:** `boxes-as-packages-v2.md:26` — the plan already
declares it is departing from per-box pinning; this is the part of that
departure that touches the user's own repository, and it is unstated.

### `/deploy` is a new host-ownership surface the plan treats as unchanged

**Location in plan:** Track B, Direction, `bbx-setup`; and the closing note
*"Ownership note stays; the UID reconciliation in `smoke-vps-install.sh` is
unchanged."*
**Citation:** *"with `/deploy` mounted, it writes every file in
`container/deployment/` into `/deploy` … `git init`s the directory when it has
no `.git` and commits the owned files"*.
**Issue:** The image runs as `node`, uid 1000 (`Dockerfile:80-90`). Today the
container writes only inside `./data/box`. After this plan it writes — and
`git init`s, and commits in — the user's *deployment directory*: `.env`,
`compose.yaml`, `update`, `.gitignore`, and a `.git`. On a Linux host whose user
is not uid 1000 this either fails outright or leaves the user unable to edit
`.env` or run `git` in their own directory without `sudo`, and git will refuse
the repo as "dubious ownership". The UID reconciliation the plan says is
"unchanged" was written for one bind mount and now needs to cover two.
**Why it matters:** The stranger's very first command creates this state, and
the failure is at the boundary where the plan has the least ability to print a
helpful message (the mount is the host's, not the container's).
**Suggested action:** Say what `bbx-setup` does about ownership: refuse when
`/deploy` is not writable as uid 1000 with the `--user "$(id -u):$(id -g)"`
recovery command, or document the `--user` flag as part of the three commands.
Also state whether the `git init` of `/deploy` is wanted at all — a nested
repo containing `data/box` (itself a repo) needs the generated `.gitignore` to
exclude `data/`, which the plan does not say it does.
**Traces to preference:** `docs/engineering-principles.md` 4 — a permission
failure at first contact must name its fix.

### The three commands are never written down

**Location in plan:** header prose and Track E.
**Citation:** *"I want to run three commands in an empty directory"*; Track E:
*"'Run it' with the three commands and a link to `container/README.md`"*.
**Issue:** The plan never states the three commands. This matters concretely,
not editorially: the first `bbx-setup` cannot be `docker compose run` (there is
no compose file yet), so it must be a bare
`docker run --rm -v "$PWD:/deploy" ghcr.io/ianb/beebox:latest bbx-setup` — a
different invocation from the one the plan does specify for `update`, with
different volume semantics (no `./data/box:/data/box` bind, so `bbx init
/deploy/data/box` writes through the `/deploy` mount) and a different image
reference (`latest`, not the `.env` pin that does not exist yet). None of that
is in the plan, and it is the plan's headline promise.
**Why it matters:** Track E's first implementation chunk is
`container/README.md`, "since Tracks B to D are its spec" — but the spec is
missing exactly the sequence the README exists to publish.
**Suggested action:** Write the literal three commands into Track B's Direction,
including the first-run `docker run` form, and note in the plan that
`bbx-setup` must work under both invocations (bare `docker run` with only
`/deploy`, and `docker compose run` with `/deploy` **and** `/data/box`).
**Traces to preference:** the bbx-plan discipline — "Direction … with actual
shapes where known"; this shape is known and is the point of the plan.

### `docker compose run -v` leaves `/deploy/data/box` and `/data/box` aliased

**Location in plan:** Track B, `deployment/update`.
**Citation:** *"runs `docker compose run --rm --no-deps -v "$PWD:/deploy" box
bbx-setup`"*.
**Issue:** `-v` on `compose run` **adds** a volume; the service's own
`./data/box:/data/box` is still mounted. So the same host directory is visible
at two container paths simultaneously. `bbx-setup`'s box work is specified
against `/deploy/data/box` while the entrypoint, the readiness check, the git
`safe.directory` config (`Dockerfile:119`, `/data/box`), and `bbx converge
/data/box` all use the other path. Paths recorded into the box (git config,
lockfile, any absolute path written by `bbx init`) will differ depending on
which invocation wrote them.
**Why it matters:** Two names for one root is the class of thing that produces a
"works on my machine" divergence between the install path and the update path,
and the plan's vocabulary lock-in list names `/deploy` without saying that
`/data/box` is the same bytes.
**Suggested action:** State the aliasing in Track B and pick one rule —
simplest is that `bbx-setup` only ever touches the box through `/deploy/data/box`
and never assumes `/data/box` exists, plus `git config --global --add
safe.directory /deploy/data/box` in the image. Add `--no-deps` reasoning
(already there) and note that `compose run` does not publish ports, so no
conflict with the running container.
**Traces to preference:** `docs/engineering-principles.md` 8 (one way to do each
thing).

### The backwards refusal has a hole exactly where `edge` lives

**Location in plan:** Track C, Direction, step (0).
**Citation:** *"Core triple of `recorded` newer than `serving`: exit 3 with the
refusal text"*, and Track A: *"Build metadata never affects ordering; the core
triple does."*
**Issue:** Two `edge` builds — `0.1.0+edge.aaa` and `0.1.0+edge.bbb` — have
equal core triples, so neither is "newer" and no refusal fires. The same holds
between an `edge` build and the release it precedes. `edge` is precisely where a
user moves backwards (pull `edge`, dislike it, `./update 0.1.0`), and it is the
only channel that moves faster than releases. Meanwhile the string-equality
early exit at step (0) *does* see them as different, so converge runs — a full
forward converge onto an engine that may be older in every way except the
triple.
**Why it matters:** The plan says the Ghost failure is "refused, not documented"
and the failure table marks the row "clear". For the contributor/`edge` audience
it is neither.
**Suggested action:** Either order `edge` builds within a triple (a monotonic
component — build number or commit timestamp — is available in CI), or state
plainly in Track C and in the failure table that the refusal covers releases
only and `edge` users are on their own, and reflect that in the Open design
question about documenting `edge`.
**Traces to preference:** `docs/engineering-principles.md` 4 — the row is marked
"clear" and is silent for one channel.

### `BBX_SKIP_CONVERGE=1` now disables the Ghost guard, not just migrations

**Location in plan:** Track D, Direction.
**Citation:** *"`BBX_SKIP_CONVERGE=1` keeps its meaning."*
**Issue:** Its meaning today (`entrypoint.sh:105-106`) is "skip the sweep and
docs refresh; I would rather run them myself and watch." After this plan the
same variable also skips the version-record read and the backwards refusal —
the plan's central safety property — because that check lives inside `bbx
converge`. "Keeps its meaning" is exactly what does not happen.
**Why it matters:** An escape hatch that quietly grows to cover a safety
interlock is how safety interlocks stop existing. The variable is documented in
the guide; a user who set it once for a slow migration keeps it set.
**Suggested action:** Move the version comparison and refusal *out* of the
skipped region — run it in the entrypoint (or as `bbx converge --check-only`)
regardless of `BBX_SKIP_CONVERGE`, and say so. Or rename the variable so the
change of meaning is visible.
**Traces to preference:** `docs/engineering-principles.md` 6 — the escape hatch
should be sized to the thing it was for.

### Converge's exit-code vocabulary does not cover a crash

**Location in plan:** Track C, "Vocabulary lock-ins"; Track D, Direction.
**Citation:** *"exit codes 0 current or converged, 2 failed and reverted, 3
refused"*, and *"exit 0 or 2 serves; exit 3 exits the container"*.
**Issue:** Exit 1 — the default for an uncaught exception, a zod parse throw, a
missing binary, an OOM — is undefined. The entrypoint runs under `set -euo
pipefail` (`entrypoint.sh:15`), so an unhandled nonzero from `bbx converge`
kills the container, which then crash-loops under `restart: unless-stopped`. A
converge that crashes for a reason unrelated to the box (a transient git lock,
a full disk) therefore takes the box offline permanently, which is the exact
outcome the existing shell comment refuses: *"a box that needs a human … is a
box to look at, not a reason to leave the operator with no server."*
**Why it matters:** The plan inverts a documented, deliberate policy without
naming the inversion. Only exit 3 is meant to stop the server; everything else
should serve.
**Suggested action:** Add exit 1 to the lock-in list with an explicit meaning
("converge crashed — serve anyway, record the failure"), and specify the
entrypoint's handling as "3 stops, everything else serves", not "0 or 2 serve".
**Traces to preference:** `entrypoint.sh:100-103` is the most recent shipped
precedent and states the policy in words.

### `bbx-setup` "idempotent: running it twice changes nothing" is not free

**Location in plan:** Track B, `bbx-setup`.
**Citation:** *"`git init`s the directory when it has no `.git` and commits the
owned files as `Deployment files from beebox <version>` … Idempotent: running it
twice changes nothing."*
**Issue:** A second run has nothing staged, and `git commit` with an empty index
exits nonzero. Under a `set -e` shell script that is a failure, not a no-op. The
plan also does not say what `bbx-setup` does to an **existing** `BEEBOX_VERSION`
line: if it rewrites it to the running image's version, then running `bbx-setup`
from an older image silently downgrades the user's pin; if it does not, the
failure-table row "a `.env` lacking `BEEBOX_VERSION` → adds the line" is the
only defined behaviour and the update path depends on `update` editing the line
itself (which it does — so the two writers of that line should be named as one
rule).
**Why it matters:** `bbx-setup` is run by the user directly (the recovery
command in two error messages) and by `update`. Both callers need it to be
genuinely re-runnable.
**Suggested action:** Specify: commit only when the index is non-empty; and
state the single rule for who may write `BEEBOX_VERSION` (proposal: `update`
writes it, `bbx-setup` only creates it when absent — which also removes the
downgrade path).
**Traces to preference:** `docs/engineering-principles.md` 8 — one writer per
piece of state.

### The image workflow's `permissions` block and cache strategy are missing

**Location in plan:** Track A, Direction, `.github/workflows/image.yml`.
**Citation:** *"Pushes to `ghcr.io/ianb/beebox` with `GITHUB_TOKEN`."*
**Issue:** Three concrete gaps. (1) The existing workflow declares
`permissions: contents: read` (`.github/workflows/pages.yml:8-9`); pushing to
GHCR needs `packages: write` and a `docker/login-action` step against
`ghcr.io`. Without it the first `edge` build fails at push, and the plan's
verification ("verified by its first run on `main`") is the discovery
mechanism. (2) No build cache is specified. The build stage is a full monorepo
`pnpm install --frozen-lockfile` plus a frontend build (`Dockerfile:39-41`) on
**two** architectures on every push to main; `cache-from/to: type=gha` (or a
registry cache) is the difference between minutes and tens of minutes per
commit. (3) The plan does not say how the `X.Y.Z` half of an edge version
(`X.Y.Z+edge.<sha7>`) is derived — presumably from the checked-in
`package.json:3`, but `bin/release` is the only thing that writes that field, so
`edge` builds between releases all carry the *previous* release's triple. That
is defensible but should be stated, and it interacts with the backwards-refusal
hole above.
**Why it matters:** The workflow is the one track verified only after merge
("Verified only after merge"), so anything unstated here is discovered on
`main`.
**Suggested action:** Put the `permissions` block, the login step, and the cache
inputs into Track A's Direction. State the edge-version derivation rule.
**Traces to preference:** `docs/engineering-principles.md` 12 (the maintainer is
usually an agent) — an agent implementing this track from the plan will omit
what the plan omits.

### Multi-arch: `fclones` is amd64-only and the plan does not say what arm64 loses

**Location in plan:** Track A, Direction (per-platform build jobs); Track B
(the Dockerfile changes).
**Citation:** plan: *"one build job per platform (`ubuntu-24.04` for amd64,
`ubuntu-24.04-arm` for arm64)"*. Source: `docker/Dockerfile:69-75`:
*"Upstream ships an amd64 .deb only; on other architectures the image simply
lacks it."*
**Issue:** Publishing an arm64 image makes "on other architectures the image
simply lacks it" a shipped, user-visible difference rather than a local
build-time note. `fclones` is one of the tools the agent guide promises as
"always available on the box host" (`Dockerfile:55-57`, citing
`src/core/agent-guide/chat.ts`). An Apple-silicon or arm VPS user gets an image
whose agent is told it has a tool it does not have.
**Why it matters:** The plan's stated audience for the arm64 build is exactly
the Apple-silicon stranger. A promised-but-absent tool is the failure class the
agent-guide contract exists to prevent.
**Suggested action:** Decide in Track B: build `fclones` from source for arm64,
drop it from both images, or make the agent guide conditional on what is
actually installed. Name the decision; do not let it arrive as a per-arch
accident.
**Traces to preference:** `docs/engineering-principles.md` 4 — a capability the
guide asserts and the image lacks is silent to everyone but the agent.

### The rollback recovery command names git-lfs; boxes use git-annex

**Location in plan:** Prior art; Track C refusal text; failure table row "LFS
content left as pointers".
**Citation:** *"git-lfs: after `git reset --hard`, LFS files can be left as
pointers; `git lfs checkout` resolves them. The rollback text says so."* and the
refusal text *"`git -C data/box reset --hard <snapshot> && git -C data/box lfs
checkout`"*.
**Issue:** `beebox/docs/assets.md:6-21` records that all twelve local boxes were
migrated to **git-annex** on 2026-07-31 ("738 Git LFS files taken over"), and
`:193` that the shipped attributes file "carries no `filter=lfs` rules at all,
so every box gets the same LFS-free file." A box created by today's `bbx init`
has no LFS. So the plan's single documented recovery procedure — printed in the
refusal text a user will actually copy — invokes a mechanism their box does not
use, and says nothing about the mechanism it does. (Whether `reset --hard` +
`clean` is safe for annexed content is the question that actually needs
answering, and `revertUpgrade`'s `clean` without `-x` is the relevant detail.)
**Why it matters:** This is the one command the plan hands a user in their worst
moment, and it was verified against the wrong subsystem. It also means the
"LFS content left as pointers" failure row is testing a hypothetical while the
annex behaviour is untested and unmentioned.
**Suggested action:** Redo the prior-art item against git-annex; verify what
`reset --hard` + `git clean -d` does to an annexed box (unlocked files,
`annex.thin=false` per assets.md) and write *that* into the refusal text.
Keep the LFS note only if pre-migration production boxes are in scope, and say
so.
**Traces to preference:** the bbx-plan discipline — "Cite, don't assert",
including for claims of safety; this claim cites an external issue rather than
the repository's own asset model.

### Wrong path: `site/cards/index.site-page.card`

**Location in plan:** Track E, "Why this needs to change" and Direction.
**Citation:** *"`site/cards/index.site-page.card:20-21` does the same"* and
*"`site/cards/index.site-page.card:18-31`: image first"*.
**Issue:** The file is at the **monorepo root**, `site/cards/index.site-page.card`
— there is no `beebox/site/`. Every other path in the plan is beebox-relative
(`src/…`, `docker/…`, `docs/…`), so this one reads as `beebox/site/…` and
resolves to nothing. The line numbers themselves are right: `:20-21` are the
developer-install and docker-install links, from-source first, and `:18-31` is
the install-guides block. Same mixed rooting applies to
`.github/workflows/pages.yml` and `issues/…` (both root-relative and both fine
only because they are unambiguous).
**Why it matters:** Track E's implementation chunk is a doc edit driven by these
citations; an agent following the plan will look in the wrong tree, and
`pnpm doc-check` will not catch a path inside prose.
**Suggested action:** Prefix root-relative paths consistently (e.g.
`<repo-root>/site/cards/…` or `../../../site/…` as the issue links already do).
**Traces to preference:** the bbx-plan discipline — a citation that does not
resolve is not a citation.

### Three imprecise citations and one misdescribed precedent

**Location in plan:** "What already exists" and Track B.
**Citation and correction, one line each:**
- *"the readiness message `auth-preflight.ts:40` already names that command"* —
  the message is at `src/core/agent/auth-preflight.ts:**41**`, and the plan does
  not give the directory (there is no `src/services/auth-preflight.ts`).
- *"**`bbx docs refresh`** (`src/core/docs-refresh.ts:5-6`, `:24-27`):
  cache-gated on the engine version…"* — `:5-6` is the heading
  `## Why a deploy step at all`; the cache-gating sentence is `:7-9`. `:24-27`
  is correct for the dirty-skip.
- *"`scripts/release.ts` builds the tarball (`:83`, `pnpm pack`)"* — `:83` is
  `"pnpm",`; the `pack` arguments are `:84`. The substantive claim (never writes
  `version`) is correct.
- *"`/usr/local/bin/codex` symlinked to the resolved
  `@openai/codex/bin/codex.js` under `/app` (production's shape,
  `deploy.sh:558`)"* — production's shape is
  `ln -sf /opt/beebox/node_modules/.bin/codex /usr/local/bin/codex`, i.e. the
  pnpm-generated bin shim, not the resolved `.js`. Copying the described shape
  rather than the cited one loses the shim's node-resolution wrapper.
- *"the same ranges `readEngineVersions()` writes, `package.ts:190-210`"* — the
  ranges are produced at `package.ts:122-137` and written at `:198-202`
  (dependencies) and `:210-214` (devDependencies); `:190-210` stops one line
  into the devDependencies block, which is where `typescript` and the
  `@types/*` the sentence is about actually live.
**Why it matters:** Each is small, but the plan's method is "cite, don't
assert", and an implementing agent resolves these literally.
**Suggested action:** Correct the five references.
**Traces to preference:** the bbx-plan discipline.

### The `src/frontend` empty-search claim is narrower than it reads

**Location in plan:** Track E, Direction, last bullet.
**Citation:** *"Searched `src/frontend` for `git clone`, `pnpm`, `checkout`: no
first-run screen text assumes one (only two unrelated component hits)."*
**Issue:** I redid the search. The conclusion about *first-run* screens holds,
but one of the two hits is not unrelated:
`src/frontend/src/components/settings/ScanUploaderSection.tsx:82-87` renders
user-facing instructions reading `git clone <repo>` / `pnpm install --filter
scan-uploader… # from the repo root` / *"bin/scan-uploader runs the CLI straight
from source, so a checkout always stays current"*. That is a Settings page a
container user reaches, telling them to do something they cannot do.
**Why it matters:** Track E's own scope line is *"Every install doc reviewed for
a step that assumes a checkout"* — this is the in-app equivalent, and the search
that was supposed to find it reported it as unrelated.
**Suggested action:** Either add this component to Track E's scope or record it
as a known, deferred container gap with one line of rationale.
**Traces to preference:** the bbx-plan discipline — "Searches that came back
empty are findings"; a search that came back non-empty and was characterized as
empty is a stronger one.

### `container/` at the monorepo root is not registered anywhere

**Location in plan:** Track B, Direction (Layout); Implementation order 4.
**Citation:** *"`git mv beebox/docker container` with path fixes and the guide
moved to `container/README.md` (doc-check clean)"*.
**Issue:** The monorepo root `CLAUDE.md` enumerates the projects that live in
the repository; a new top-level `container/` is not in that list and the plan
does not say it will be added. `beebox/CLAUDE.md`'s Guides table row
*"Docker install (local + VPS) | `docs/docker-install.md`"* points at the file
being moved out of the beebox docs tree. Also worth stating: moving the guide
out of `beebox/docs/` removes it from the tree the docs browser and doc-check
index, which is a deliberate trade (it becomes a project README) but is not
named.
**Why it matters:** Principle 7 (hierarchy is a discoverability contract) is one
of the plan's own justifications for the move; a new root project that the root
map does not mention is the same defect one level up.
**Suggested action:** Add root `CLAUDE.md` and `beebox/CLAUDE.md` Guides-table
updates to Track E's file list (Track B mentions `container/CLAUDE.md` but not
the two maps that point at it).
**Traces to preference:** `docs/engineering-principles.md` 7; and
`beebox/CLAUDE.md` — "new infrastructure isn't done until it's discoverable".

## NOT in scope (verified)

Nine deferrals, each with a one-line rationale, and each is a real boundary
rather than a size excuse. Two are load-bearing and correctly placed:
*"Moving production (`deploy/deploy.sh:713-770`) onto `bbx converge`"* — the
right call, and the plan names the principle-8 cost of not doing it; and
*"`bbx upgrade --to` and per-box pinning for from-source and hub installs:
unchanged"*, which is what makes the `link:` departure bounded.

One thing is missing from the section and belongs in it: **what happens to a
box that leaves the container.** The plan rewrites a user-owned dependency to
an absolute container path and defers nothing about the reverse direction. Given
`bbx upgrade --to` is explicitly kept in scope elsewhere, "moving a box out of
the container" should either be a NOT-in-scope line with a rationale or a
sentence in Track C.

The section also does not defer **an image healthcheck**, which the exit-3 and
converge-timeout findings both point at. Either it is in scope (and Track B's
compose file should have it) or it is a named deferral.

## Things I checked and found clean

Listed so the difference between "looked and it is fine" and "did not look" is
visible.

- **Every `file:line` in the plan was opened.** 45 of 51 were exact in both line
  and quoted text, including all four verbatim preference quotes
  (`upgrade.ts:8-9`, `migration-sweep.ts:16`, `installation-story.md:434`,
  `boxes-as-packages-v2.md:26`) and all six `entrypoint.sh` references.
- **`.beebox/` is gitignored at `src/core/box/index.ts:255`** — exactly as
  claimed, and the interaction the plan depends on (failure record survives
  `revertToSnapshot`) is sound: `upgrade.ts:189-194` documents that `clean`
  omits `-x` specifically to spare `.beebox` and `node_modules`.
- **`_config/migrations.jsonl` is tracked** — `migrations.ts:161`, and nothing
  in `writeBoxGitignore` ignores it. The plan's "a git reset reverts the record
  with the data" is correct for the manifest.
- **`bbx activity [boxRoot]` is a genuinely small change** —
  `loadRunningScripts` and `findBusyBlockers` both already take a box root
  (`activity.ts:26-27`); only the `loadBoxesConfig()` fan-out at `:21` is
  fleet-shaped. No hidden per-fleet state.
- **`bbx status` and `/healthz` share one reader** — `runHealthChecks` at
  `health.ts:217`, `health-engine.ts` exists and already reads
  `getInstalledEngineVersion`. The new converge check lands in the right file
  and the "same text in both surfaces" claim is structurally supported.
- **`@openai/codex` is a runtime dependency at `package.json:120`** and
  `codex-binary.ts:11` resolves `@openai/codex/bin/codex.js`, so the in-container
  device flow works today as claimed. `compose.yaml:33`'s `claude-auth` named
  volume is the pattern the `codex-auth` volume copies; that part is clean.
- **`semver` really is transitive-only.** No direct dependency in either
  `package.json`; `pnpm-lock.yaml:8346` as cited. Writing a bespoke grammar
  module is justified.
- **`package.json:3` is `0.1.0`, there are zero git tags, and
  `scripts/release.ts` does not write `version`** — Track A's premise holds
  completely.
- **`.dockerignore` exists at the monorepo root**, so the CI build context is
  not the whole worktree. I looked for this expecting a problem; there is none.
- **The template's sections are all present**, in order, with the headers
  verbatim, plus the "Issues addressed" block. Frontmatter has `status: draft`,
  a bare `workstream:`, and an `issues:` list; all six issue files named in the
  prose exist at their given paths. "Subplans: none" and "Knowledge audits:
  skip-with-rationale" are both argued rather than "N/A".
- **The declared critical gap is the right one** and is not disguised: a box
  that cannot typecheck under the only engine present is genuinely unsolvable
  inside a single-engine image, and the plan says so above the table rather than
  burying it in a row.
- **Open design questions are outside the first chunks.** The release-number
  question is resolved in Track A's chunk ("The first tag is `v0.1.0`"); the
  `edge`-documentation and every-start-converge questions do not block any first
  chunk. The discipline holds here.
- **Implementation order is dependency-correct** as written: the grammar module
  is a leaf, converge depends on it, the entrypoint depends on converge and the
  image, `update` depends on the entrypoint, the harnesses depend on `update`,
  and docs come last "so the commands documented are the commands that ran".
  I looked for a cycle and found none.
