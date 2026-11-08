---
title: "Allowlisted environments for Git, CLI, and engine children"
status: active
workstream: child-env-allowlist
issues:
  - ../../../issues/bugs/2026-10-30-server-commits-run-box-hooks-with-the-server-env.md
  - ../../../issues/bugs/2026-10-30-upgrade-and-migrate-spawn-box-code-with-the-callers-whole-env.md
  - ../../../issues/code-quality/2026-10-29-claude-auth-commands-and-gws-spread-the-server-env.md
---
# Allowlisted environments for Git, CLI, and engine children

Several spawn sites still build a child's environment by copying `process.env`.
This plan gives each one an allowlisted environment built from the lists that
already exist, and records each consumer in the credential table and the
every-consumer matrix.

**Issues addressed:** the three in the frontmatter. Related but not addressed:
`issues/bugs/2026-10-30-box-schemas-load-inside-the-server-process.md` (an
execution boundary; an env allowlist cannot close it). Queue grep for
`process.env`, `spread`, `hook`, `fsmonitor`, `env allowlist` found no other
open items on these sites.

## Design

No design section: no person-visible behaviour changes. A child gets fewer
environment variables; every product path must behave as before.

## Smallest fix and budget

Smallest fix for the agent-reachable issue: make `commitEnvironment`
(`src/lib/git/core/commit-env.ts:5`) start from an allowlist. That fix does not
close the problem. The agent can write `.git/config` as well as `.git/hooks/`.
Git then runs agent-chosen commands in four ways:

- `core.fsmonitor` runs on `status`, `diff`, and `add`.
- Filter drivers run on `add`, `checkout`, and `status`.
- `reference-transaction` runs on every ref update.
- `post-checkout` runs on path checkouts such as
  `src/job-cards/restore-to-head.ts:40`, *"simpleGit(boxRoot).raw(["checkout", "HEAD", "--", ...tracked])"*.

The commit-only fix leaves all of these on the server's whole env. So the Git
track covers every Git child in `src/`.

Tracks and estimate (changed lines, additions plus deletions):

| Track | Source | Tests |
|---|---|---|
| 1. Git environment and `boxGit` factory; convert ~38 files of Git spawn sites | ~220 | ~40 |
| 2. CLI children: `claude auth`, Codex CLI sites, gws, prompt logger | ~60 | ~40 |
| 3. Engine children: upgrade, migrate, migration-run, engine-link-spec | ~50 | ~20 |
| 4. Credential table consumers and matrix columns | ~60 | ~80 |

Total about 570 lines, plus issue-body edits. This is not a BIG CHANGE.

## Stated preferences this plan trades against

- `src/core/script-env/allowlist.ts:20`: *"Widen this list only by adding a
  named entry with a reasoned comment — never by reverting to a spread."* Every
  new list here follows that rule.
- `src/lib/credential-env.ts:10`: *"Fail closed: a name in no row and no
  allowlist is inherited by nobody."* The new consumers get rows.
- Memory "minimize invented concepts": reuse `SCRIPT_ENV_PLAIN` and
  `pickBoxSubprocessEnv` rather than new parallel lists. The Git list and the
  package-manager list are the only new lists. Git needs its own
  repository-location variables, and `pnpm`/`npx` need fewer variables than an
  agent gets.
- `beebox/AGENTS.md` "no features beyond the task". The ESLint restriction in
  Track 1 is the only addition beyond the spawn sites. Without it the next
  `simpleGit(boxRoot)` reopens the leak silently.

## What already exists

- `pickBoxSubprocessEnv` and the `agent`/`tooling` lists:
  `src/core/script-env/allowlist.ts:138`. Reused for Track 1's base, Track 2,
  and Track 3's `bbx` children.
- `agentAllowlistEnv()`: `src/core/script-env/core.ts:243`. This is the agent
  list plus `BBX_SPAWN_PROFILE=agent` with nothing injected. Reused for the
  `claude auth` and Codex CLI sites.
- `childProcessEnv(overrides)`: was in `src/lib/env.ts`, a hand list (HOME,
  PATH, XDG_CONFIG_HOME, LANG, LC_ALL, TMP*) with one caller, Git in
  `src/core/moved-card-forwarding.ts`. Replaced by the Git environment with
  `repository: "isolated"`, and removed.
- `commandEnvironment`: `src/publish/prepare/core/project.ts:21`, a narrow env
  for `pnpm install` in a publish task. It is not reused directly because it
  replaces HOME and TMPDIR with task directories. The box install must use the
  real HOME so pnpm finds its store and `~/.npmrc`. Track 3's list follows its
  shape.
- `server-secrets.ts` seals the server's named secrets
  (`src/lib/server-secrets.ts:17-24`). That remains. This plan covers what the
  seal leaves: provider keys and unlisted variables.
- The every-consumer matrix: `test/credential-visibility/every-consumer.test.ts`.
  It already records `status`, `statusNoBox`, `login`, `logout`, and `gws`.

## Prior art (external)

These Git facts decide the Track 1 scope. All are from the git documentation:

- `core.fsmonitor` names a command that Git runs to query changed files
  (git-config(1), "core.fsmonitor"). evaluated-only.
- The `reference-transaction` hook runs on every reference update (githooks(5)).
  evaluated-only.
- `post-checkout` runs after `git checkout` and after a path checkout, with flag
  0 (githooks(5)). evaluated-only.
- Git sets `GIT_INDEX_FILE` for a hook when `git commit -- <paths>` uses a
  temporary index (githooks(5), "pre-commit"; git-commit(1)). So Git calls made
  inside a hook must keep that variable. evaluated-only.

## Ontology

- **Git environment** (new, `gitEnvironment()` in `src/lib/git/env.ts`): the
  env for every Git child. It is `agentAllowlistEnv()`, plus
  `boxWorkEnvironment()`, plus pass-through of Git's identity (including
  `EMAIL`), date, and repository-location variables when the parent has them.
  `repository: "isolated"` drops the inherited repository variables for a
  caller that points Git at its own scratch repository. It is NOT a spawn
  profile in `lib/spawn-profile.ts`.
- **`boxGit(dir, opts?)`** (new): `simpleGit(dir).env(gitEnvironment(opts))`.
  It replaces bare `simpleGit(dir)`.
- **Package-manager environment** (new, `packageManagerEnvironment()`): the
  env for `pnpm install` and `npx` children.
- **Engine child environment** (new, `engineChildEnvironment()` in
  `script-env/core.ts`): the package-manager list and the tooling list, plus
  `boxWorkEnvironment()`, plus the caller's own `BBX_SPAWN_PROFILE`. The
  package-manager names are included because a migrator such as
  engine-link-spec runs `pnpm install` itself. It is for the `bbx`/`tsx` children of
  `bbx upgrade` and `bbx migrate`.
- **Credential consumers** (existing type, `src/lib/credential-env.ts:46`):
  adds `claudeAuth`, `gws`, `git`, `packageManager`, `engineChild`.

## Tracks / scope

### Track 1 — Git children

**What.** Add `src/lib/git/env.ts` with `gitEnvironment()` and `boxGit()`.
Convert every `simpleGit(...)` and `execFile("git", ...)`/`spawn("git", ...)` in
`src/` to them. `commitEnvironment` becomes `gitEnvironment()` plus the
box-time date stamp.

**Why.** An agent-written hook, fsmonitor command, or filter runs with the env
of the Git child. Today that env is the server's whole env. See *Smallest fix*.

**Direction.**

```ts
/** Git's own variables a child keeps when the parent has them. */
const GIT_PASS_THROUGH = [
  "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_AUTHOR_DATE",
  "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL", "GIT_COMMITTER_DATE",
  // Set by git for a hook; a git call inside the hook must see the same repository and index.
  "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_PREFIX", "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_QUARANTINE_PATH",
  "XDG_CONFIG_HOME", // git's user config at $XDG_CONFIG_HOME/git/config.
];
/** Only for a push or fetch: transport needs the user's agent and proxy. */
const GIT_NETWORK = ["SSH_AUTH_SOCK", "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "NO_PROXY", "no_proxy"];

export function gitEnvironment(opts?: { network?: boolean; overrides?: NodeJS.ProcessEnv }): NodeJS.ProcessEnv;
export function boxGit(dir?: string, opts?: { network?: boolean }): SimpleGit;
```

`commitEnvironment(boxRoot)` returns `gitEnvironment()` with the existing
box-time `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` logic. Today it blocks
simple-git's override keys (`GIT_CONFIG*`, `GIT_SSH*`, `EDITOR`, …). The
allowlist omits them all, so that filter goes away. The repository-location
names pass through only from the parent's env. A server never has them set,
and an agent cannot set the server's env.

`pushToRemote` (`src/lib/git/core/operations.ts:495`) uses
`boxGit(boxRoot, { network: true })`.

Guards: an ESLint `no-restricted-imports` entry for `simple-git` outside
`src/lib/git/env.ts` (type-only imports allowed). Raw `"git"` spawns
(`execFile`, `spawn`, and their sync forms) get a source scan in
`test/lib/git-env.test.ts` instead of a lint selector. The scan fails on a
`"git"` spawn in `src/` whose call does not contain `gitEnvironment(`.

**Vocabulary lock-ins.** `gitEnvironment`, `boxGit`, `src/lib/git/env.ts`.

**First implementation chunk.** `env.ts` with both functions;
`commitEnvironment` rebuilt on it; the matrix gets a `hook` column that reads
the env from a real `pre-commit` hook through `commitPaths`. The hook writes
`process.env` as JSON; the box is `makeTmpBox({ git: true })`.

### Track 2 — CLI children

**What.** `claude auth status|login|logout` (`src/services/claude-cli.ts:62,98,154`)
start from `agentAllowlistEnv()`. Status adds the box token as today. Login
adds `BROWSER=echo`. The Codex CLI sites start from `agentAllowlistEnv()`
directly (no separate helper; the agent allowlist is the whole answer):

- status and logout: `codex-cli/core.ts:62,151`
- login app-server: `auth-app-server.ts:61`
- plugin commands: `core/agent/ensure-codex-plugin.ts:73`
- history server: `services/codex-history-server.ts:88`

gws (`src/connectors/gmail/gws.ts:108`) gets
`{ ...agentAllowlistEnv(), GOOGLE_WORKSPACE_CLI_TOKEN: token }`. The prompt
logger's `npx` proxy (`core/agent/invoke/prompt-logger.ts:40`) gets
`packageManagerEnvironment()`.

**Why.** These children get the server's provider keys and unlisted variables.
The status probe should answer for the credential an agent run uses
(`src/core/claude-oauth-token.ts`), and an agent run gets the agent list.

**Direction.** gws uses the agent list, not the tooling list the issue
proposed. gws is a third-party CLI that needs no path to the secret store.
`BBX_SECRETS_FILE` and `BBX_GOOGLE_TOKENS_FILE` are tooling-only. Lean strict.

Checked on this Mac (2026-11-08): `claude auth status` with exactly
`agentAllowlistEnv()` (keys `BBX_SPAWN_PROFILE HOME LANG LOGNAME PATH SHELL TERM
TMPDIR USER`) reports `"loggedIn": true, "authMethod": "claude.ai"` from the
keychain.

**First chunk.** The `claude auth` and gws changes. The matrix `status`,
`statusNoBox`, `login`, `logout`, and `gws` columns move from `I` to `-`,
except the injected cells.

### Track 3 — Engine children

**What.**

- `upgrade.ts` `defaultRunner` (`:130`): the runner gets the command's kind.
  `pnpm` gets `packageManagerEnvironment()` plus `boxWorkEnvironment()`. The
  `bbx` and `tsc` steps get `engineChildEnvironment()`.
- `migrate.ts` `runProcedure` (`:97`): `engineChildEnvironment()`.
- `migration-run.ts` `runMigrationScript` (`:115`): `engineChildEnvironment()`
  plus `BBX_MIGRATION_NAME`.
- `engine-link-spec/run.ts` (`:44`): `packageManagerEnvironment()`.

```ts
const PACKAGE_MANAGER_ENV = [
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TMP", "TEMP", "TZ",
  "LANG", "LC_ALL", "LC_CTYPE", "NO_COLOR", "TERM",
  "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME", // pnpm's store and config on Linux.
  "PNPM_HOME", "COREPACK_HOME",
  "CI", // deploy sets CI=true so pnpm does not prompt (deploy/deploy.sh:717, deploy/server-bin/bbx-box-install:66).
  "npm_config_update_notifier",
];
```

`npm_config_*` are not passed in general. They can carry registry tokens, and
an outer pnpm script's config leaks into the box install
(`src/scripts/smoke-external-box.ts:81-89` strips them for that reason).

**Why `engineChildEnvironment` forwards the caller's `BBX_SPAWN_PROFILE`.**
Today the spread forwards it, and an operator shell is `unset`, which counts as
`agent` (`src/lib/spawn-profile.ts:8-11`). Setting `tooling` would widen what a
`bbx procedure run` may do locally. Dropping it changes nothing for `unset`
callers. Forwarding keeps today's behaviour for every caller. These children
are engine code at the caller's trust level, so the allowlist's reason for
never inheriting the marker (`allowlist.ts:36-40`, a tooling parent handing it
to an agent child) does not apply.

**First chunk.** The four sites plus the two helpers.

### Track 4 — Table and matrix

Add consumers `claudeAuth`, `gws`, `git`, `packageManager`, and `engineChild`
to `CredentialConsumer`, and to `DENY_ALL` as `deny`. Non-deny cells:

- `claudeAuth`: `CLAUDE_CODE_OAUTH_TOKEN` inject.
- `gws`: `GOOGLE_WORKSPACE_CLI_TOKEN` inject.

Matrix columns: `hook`, `codexCli`, `promptLog`, `upgradeInstall`,
`upgradeBbx`, `migrateProc`, `migrator`. `observedTable` maps them onto the new
consumers. The header comment's "Not governed here" paragraph goes.

## Plan review (codex gpt-6-astra, 2026-11-08)

Five findings, all accepted except part of the last:

1. `BBX_NO_URLCHECK` was missing from every list, so the post-commit hook
   (`install-validation-hooks.ts:149`) would restart background URL checks under
   the test suite. Added to `SCRIPT_ENV_PLAIN`.
2. Passing the repository variables through would let an ambient
   `GIT_INDEX_FILE` reach the scratch repository in
   `moved-card-forwarding.ts`. Added `repository: "isolated"`.
3. The engine child dropped `CI` and the XDG names before a nested `pnpm`. The
   engine child now includes the package-manager list.
4. `EMAIL` added to the Git identity names.
5. Per-site coverage: the matrix has one Codex column (status). The other four
   Codex sites use the same one-call `agentAllowlistEnv()`. A recorder per site
   was judged not worth its test code. The raw-`git` source scan and the ESLint
   fence cover the Git sites.

## Could this be simpler?

The simplest version is the commit-only `commitEnvironment` fix plus the four
CLI sites. It fails on a box whose agent writes `core.fsmonitor` into
`.git/config`. The next `git status` from the server runs the agent's command
with the server's env. The issue's own direction ("audit other hook-firing
`simpleGit` calls") ends at "all of them". The fuller Track 1 is a mechanical
conversion behind one factory, plus a lint rule that keeps it true.

A second simplification was considered and rejected: one shared list for every
consumer. Git needs `GIT_INDEX_FILE` pass-through. `pnpm` should not get
`CODEX_HOME` or `BBX_*` config. The `bbx` children need the tooling list's
store path.

Scale of the risk, stated plainly: under the hub, a box server's `process.env`
is already the hub's allowlist with named secrets sealed. On Linux an agent
running as the server's user can read `/proc/<pid>/environ`
(`src/lib/server-secrets.ts:9-10`). So this plan is defense in depth for
production. It matters most for a single-process dev or self-hosted server
started from a full shell env.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `bbx validate --pre-commit` in a hook reads the real index instead of the `git commit -- paths` temporary index, because its own Git calls dropped `GIT_INDEX_FILE` | Track 1 adds one: a path commit with a staged invalid card outside the paths must pass, and one with an invalid card inside must fail | `GIT_PASS_THROUGH` | Silent (wrong validation) without the test |
| Push over SSH loses the agent socket | No; manual check on a box with an SSH remote is not available | `network: true` keeps `SSH_AUTH_SOCK` | Clear: `pushToRemote` returns `error` |
| Git loses the user identity from `~/.gitconfig` | Covered: HOME is allowlisted | — | Clear: git refuses to commit |
| `pnpm install` in `bbx upgrade` cannot find its store or registry config | `test/cli/upgrade*` run with the fake runner, so no | The list keeps HOME, XDG_*, PNPM_HOME | Clear: install step fails, upgrade reverts |
| A `bbx` migration child needs an env name the tooling list lacks | Partly: migrate tests spawn real children | The tooling list is what scheduled `bbx` children already run on | Clear: the child errors |
| Dev tools under husky (`src/dev/doc-check`) lose `GIT_INDEX_FILE` | Pre-commit runs them on every commit | `GIT_PASS_THROUGH` | Clear: doc-check fails on commit |
| Codex login/history server needs an unlisted variable | `test/services/codex-*` | Agent runs of Codex already work on this list | Clear: Codex errors |
| A new bare `simpleGit(` import is added later | The ESLint restriction | — | Clear: lint error |

No critical gap.

## Agent-flow / user-flow edge cases

- Wrong tag / wrong field: no agent-facing vocabulary. ADDRESSED (none added).
- Stale ref: not applicable; no references are written.
- Two agents touching the same card: unchanged; Git locking is untouched.
- Hand-edit drift: an agent's own hook script still runs. It now sees the agent
  list. ADDRESSED by design.
- Fabricated free-form value: not applicable.
- Validation error UX: a hook's validation output is unchanged.
- Partial migration / transition state: none. Envs are rebuilt per spawn, and
  there is no stored state.

## NOT in scope

- `issues/bugs/2026-10-30-box-schemas-load-inside-the-server-process.md`:
  schema code runs in the server and reads `process.env` directly. That needs
  an execution boundary.
- Reading `/proc/<pid>/environ` as the server's user: an OS-user boundary,
  already noted in `server-secrets.ts`.
- `execWithTimeout` shell spawns and other non-Git spawn sites outside the
  three issues: the audit of `spawn(`/`execFile(` without `env` beyond the
  named sites is out. Any found in passing get filed.
- Neutralizing `core.hooksPath`/`core.fsmonitor` with `-c` flags: that would
  also disable the box's own validation hooks.
- Test-only and `src/scripts/` smoke tools that spread `process.env` for Git
  identity (`test/user-stories/journeys/prepare/core.ts:102`): test fixtures,
  not server paths.

## Open design questions

- Whether the scan test or an ESLint `no-restricted-syntax` rule should guard
  raw `"git"` spawns. Lean: the scan test, because the selector would need to
  inspect the options object. It is settled for chunk 1 either way: the import
  restriction is the rule.

## Knowledge audits

Skip: purely infrastructural. No agent-facing concept changes.

## What will hold this after it ships

- `every-consumer.test.ts` pins every new column, and its table check ties
  `credential-env.ts` to observed cells. A spread reintroduced at any of these
  sites turns its column to `I`.
- `test/lib/git-env.test.ts`: the pass-through decision and the network
  extras as a pure function; the path-commit index case through a real hook.
- The ESLint import restriction holds the `boxGit` boundary.

## Implementation order

1. Track 1 chunk: `git/env.ts`, `commitEnvironment`, the `hook` matrix column,
   the path-commit index test. Commit.
2. Track 1 conversion of the remaining Git sites, the ESLint restriction, and
   the scan test. Commit.
3. Track 2. Commit.
4. Track 3. Commit.
5. Track 4 table consumers. These may land with each track's column. Then the
   issue-body updates the re-review notes asked for. Commit.
6. Cross-model diff review; fixes; report.

## Rollout shape

Done when these pass: `every-consumer.test.ts` with the new columns,
`test/lib/git-env.test.ts`, change-selected tests for every converted file,
`pnpm typecheck`, `pnpm lint`, and `pnpm layout-check`. A real commit goes
through the box's installed pre-commit hook in a `makeTmpBox` box. No data
migration and no knowledge audit.
