# Dev infrastructure: launchers, workstreams, process lifecycle

Contributor entrypoint for `bin/` and the shared router. Detailed fragile
contracts live in `bin/docs/`; read the indicated reference before editing.

## Tests for `bin/` tooling

New root-infrastructure tests are doctests under `bin/test/`, mirroring the
file they test (`bin/lib/<name>.ts` → `bin/test/lib/<name>.doctest.md`), including shell
fixtures and CLI behavior. They run in beebox's suite, under its home and
secret isolation: `cd beebox && pnpm exec tap ../bin/test/<path>.doctest.md`.
Existing `bin/*.test.ts` files are not precedent. Use a traditional test only
when a doctest would be circular and explain why. Router unit tests live in
`workstreams-app/test/router/`.

## Commit safety

Tracked files use repo-relative or `~/` paths. Never widen the home-path
allowlist to fix a leak. The personal blocklist is optional when absent, but a
malformed or tracked list fails closed; diagnostics never print matched private
values. Read [commit guards](docs/commit-guards.md) before changing the guards
or hooks. On a shared branch use `git add <paths> && git commit -- <paths>` (or
`stageAndCommitPaths`); a bare commit can capture another agent's staging.
The pre-commit typecheck covers the whole package, so parallel agents in one
worktree should work in different packages, and each briefing names the other
agent's directories. Never `git reset --hard` or `git checkout .` while another
agent edits the worktree. `main` was rewritten and force-pushed around
2026-09-02, so hashes recorded before then do not resolve: worktree branches
`git merge main`, never rebase or reconcile old hashes (box repos were not
rewritten).

## Commit provenance trailers (`commit-provenance.ts`)

Prepare-commit hooks add `Workstream` and, when unambiguous, `Plan`; failures
warn without blocking. Commit-msg validation blocks nonexistent public `Issue`
basenames and never searches `private-issues/`. Query with
`pnpm commit-provenance --workstream|--plan|--issue <name> [--main]`.
Details: [commit guards](docs/commit-guards.md).

## Router contract

One router on port 3210 serves main and all worktrees. TCP is authenticated;
the Unix socket is the trusted local capability. HTTP wakes and keeps a
worktree active; WebSocket upgrades do neither. Never restart the shared router
or run `panic` from a worktree without the boxholder's permission.

Before changing `ensureRunning`, start/stop/exit handling, pidfiles, or the
`worktrees` map, read [the router protocol](docs/router-protocol.md). For auth,
exposure, environment loading, idle behavior, reloads, and module ownership,
read [router operations](docs/router-operations.md).

## Worktree lifecycle

Hooks and launchers are thin adapters; `bin/workstreams` and
`bin/lib/worktree-*.sh` own state and teardown. Before changing liveness,
cleanup, sweep, launch, or generated mirrors, read
[worktree lifecycle](docs/worktree-lifecycle.md). Its exact-PID detection,
fail-closed behavior (`launching` and `unknown` count as live), self-ancestor exclusion, and nested-agent hook
rules protect live work. `--force` never overrides liveness.

## Lifecycle commands

Use `bin/workstreams list [--json]` as the joined inventory and `create`,
`resume`, `remove`, `close`, `release`, `reset-test`, or `confirm-tested` for
managed state changes. `status` reports raw router state; `down <name>` stops
one worktree. `panic` kills the router, known children, and scoped orphans, so
it requires the shared-router permission above. `agent-liveness
<absolute-path>...` is the destructive-operation oracle. Use both
`BBX_STATE_DIR` and `ROUTER_PORT` for an isolated test router.

`bin/land [branch]` is the checked `--no-ff` landing path. It requires clean
main on `main` and a branch containing main; a refusal means return to the
worktree. It is the landing operation used by `/finish`; `--list` and
`--dry-run` are read-only. Details:
[worktree lifecycle](docs/worktree-lifecycle.md).

## Schedules (`bin/schedules`)

Use `bbx-authoring-schedules` to author recurring work and `bin/schedules list`
to inspect runs, overdue work, alerts, and scheduler health. The CLI is the
only store writer; alerts are durable, and a run with neither `alert` nor
`done` is itself an important failure. Headless prompts travel on stdin and
unsupported declared constraints fail closed. Read [schedules](docs/schedules.md)
before changing cadence, locks, heartbeat, launch, lint, or records.

## Document comments (`bin/comments`)

At pickup use `bin/comments list --workstream <name>`; inspect with `show
<path>`, act, then `clear <path> [--id <id>]`. Comments live outside git,
survive culls, mount read-only in worktrees, and have one CLI writer. Comments
on untracked files can outlive a culled workstream and reappear when its name is
reused; report those orphans rather than deleting them.

The external store has `tracked/<path>` namespaces that follow tracked files
and `worktree/<name>/<path>` namespaces for worktree-local files; do not merge
those identities. It lives beside main at `<parent>/dev-comments/` (override
`BBX_COMMENTS_ROOT`). Nothing expires until explicitly cleared. When resolving
a comment into prose, quote the boxholder's stored words rather than
paraphrasing them.

Background: [document comments design](../beebox/docs/plans/document-comments.md).

## Searching the issue queue (`bin/issues`)

The CLI and app share parsing and ranking. Text mode is offline. Explicit
hybrid/semantic mode fails without a complete keyed index; an unspecified mode
may degrade to text with a warning. Private issues are included by default and
may be sent to OpenAI and cached locally. Use `--visibility public` to avoid
reading them or `--mode text` to avoid network egress. See `--help` for forms.

The shared implementation lives in `workstreams-app/src/server/`; do not fork
ranking or parsing into `bin/`. Embedding keys are tried as
`BBX_OPENAI_API_KEY`, `THINKING_OPENAI_API_KEY`, then `SKE_OPENAI_API_KEY` in
the app child's environment. Public and all-visibility indexes stay separate.

Next actions are not frontmatter. They live in `<parent>/dev-issue-actions/`
beside main (override `BBX_ISSUE_ACTIONS_ROOT`), keyed by visibility and slug
so they follow moved issues. The issue browser writes them at once and nothing
commits them; `bin/issues next-action` lists, sets, and clears them from any
checkout. `workstreams-app/src/server/main/issue-next-actions.ts` is the only
reader and writer.

## CODING_FEEDBACK (`bin/coding-feedback`)

A short retrospective note an agent writes at four checkpoints: `plan-reviewed`
(bbx-plan), `implemented` and `review-adjudicated` (cross-model), and `landed`
(the finish agent). `add --checkpoint <c>` reads the body from stdin; `help`
lists the four prompts it answers. Entries live outside git at
`<exhibits store>/<workstream>/coding-feedback/`, with frontmatter naming the
checkout state and the session transcript (`CLAUDE_CODE_SESSION_ID` or
`CODEX_THREAD_ID`, else the newest transcript for this checkout). Only a
retrospective scan reads them; the boxholder does not, and nothing reaches git.

## Skill usage (`skill-usage.ts`)

`node --import tsx bin/skill-usage.ts [--since 60] [--json]` counts how
skills are used in local Claude transcripts and Codex rollouts for this repo:
human and agent invocations, body loads, briefing mentions, a loaded-but-unused
proxy, and labelled recurring instructions and failures. It prints names,
labels, and counts only. The file headers in `bin/lib/skill-usage-*.ts` document the marker shapes.

## Skill lint (`skill-lint.ts`)

`node --import tsx bin/skill-lint.ts [--json] [--quiet]` checks every
`.claude/skills/*/SKILL.md` and `.claude/agents/*.md`: frontmatter `name` and
`description`, body size, reference depth, bare `/skill` or `$skill` sigils in
prose, and backticked repo paths that do not resolve. It prints one line per
finding and exits 1 on any error; Codex-ignored frontmatter keys are `info`,
which `--quiet` hides. Pre-commit runs it when `.claude/` is staged.

## Cross-model runner (`bin/cross-model-run`)

`bin/cross-model-run --engine codex|claude [--prompt-file <path>]` runs one
read-only reviewer in the foreground and saves `<out>.prompt.md`, `<out>.log`
(raw), and `<out>.md` (final answer) under `scratch/cross-model/`. Codex runs
`exec -s read-only -o`; Claude runs `-p` with only Read/Grep/Glob and
`--setting-sources user`, so the project SessionEnd hook cannot remove the
worktree. Judgment lives in the `cross-model` skill. Exit 127/124/1 means
missing engine, timeout, or failure/empty answer.

## Private-issues shadow repo (`private-issues`)

Every checkout mount remains a symlink. Roots are derived and identity marked;
mutations serialize through the CLI lock. Cleanup removes a private worktree
only when merged and strictly clean, otherwise preserving and reporting an
orphan. Never force, auto-commit, or turn the mount into a directory.
`.gitignore` uses `/private-issues` without a trailing slash. Content rules:
`issues/AGENTS.md`; background:
`beebox/docs/implemented-plans/private-issues-shadow-repo.md`.

The identity check requires both `.beebox-private-issues` and the
`beebox.privateIssues` Git config. Main points to the private primary tree;
worktrees point to `<parent>/private-issues-worktrees/<name>` on
`worktree-<name>`. Locations derive from an explicit checkout through
`git rev-parse --git-common-dir`. Safety checks rerun after taking the mkdir
lock. Deletions count as dirty intentional work, and every sweep reports
private worktree/branch orphans. Public-worktree deletion therefore removes
only a symlink.

## Production deploy state (`bin/deploy-status`)

Read-only report of the deployed commit against `main` and `HEAD`, the last
deploy record, the deploy lock, hub health, disk, and pending box migrations
(`--json` for machines). Use it instead of improvised SSH; the
`deploy-status` skill holds the judgment rules. Sources:
[deploy README](../beebox/deploy/README.md#checking-deploy-state).

## `/<worktree>/dev/` serving

`/<name>/dev/` serves tracked HTML and rendered Markdown without cold-starting
the worktree; `/<name>/dev/docs/` is the document browser. See `dev/README.md`.

## Compatibility pointers

The following headings retain historical anchors while routing to the current
owner.

### Home-directory leak guard (`path-leak-check.ts`)

See [commit guards](docs/commit-guards.md#home-paths).

### Commit blocklist (`commit-blocklist-check.ts`)

See [commit guards](docs/commit-guards.md#personal-blocklist).

### Landing a worktree branch (`land`)

See [commit guards](docs/commit-guards.md#provenance-and-landing).

### Router architecture

See [router operations](docs/router-operations.md#topology).

### The router is a fail-closed authenticating proxy

See [router operations](docs/router-operations.md#authentication-and-exposure).

### `beebox/.env` is loaded into every dev process

See [router operations](docs/router-operations.md#environment-isolation).

### Idle shutdown + self-healing tabs

See [router operations](docs/router-operations.md#activity-and-reloads).

### Backend staleness

See [router operations](docs/router-operations.md#activity-and-reloads).

### Orphan resistance

See [worktree lifecycle](docs/worktree-lifecycle.md#teardown-and-sweep).

### `bin/workstreams` is the agent-neutral control surface

See [worktree lifecycle](docs/worktree-lifecycle.md#ownership-and-roots).

### Worktree lifecycle hooks

See [worktree lifecycle](docs/worktree-lifecycle.md#sessions-and-generated-guidance).

### Codex worktree sessions

See [worktree lifecycle](docs/worktree-lifecycle.md#sessions-and-generated-guidance).

### Headless agent sessions (`bin/lib/launch-headless.sh`)

See [schedules](docs/schedules.md#headless-sessions).

### Linting a schedule (`bin/schedules lint`)

See [schedules](docs/schedules.md#validation).

### Multiple agents sharing one worktree

See [commit safety](#commit-safety). Subject agents in a usability experiment
cannot be warned in their briefing, so the environment has to hold on its own:
give each subject a randomly named directory (siblings copy each other's
output), verify `node_modules` after a round (subjects repair breakage with
`rm -rf node_modules` or `pnpm install --force`), and classify failures by
cause (format, environment, behavior) rather than counting them.
