# Agent SDK release applicability

This file is a cumulative, newest-first, callback-box-specific view of Agent SDK
releases. The daily persistent monitor session maintains it. It reads upstream
release notes in light of the SDK surfaces callback-box actually uses. Applied
entries stay here because they can explain regressions and expose future
opportunities elsewhere in the code. The monitor automatically bumps settled
releases and immediately applies callback-box-relevant security, memory, and
correctness fixes.

Two channels are assessed, not one. **Runtime** is callback-box's own use of the
SDK (`src/core/agent/`, `src/core/chat/session/`, `src/services/claude-chat.ts`,
`src/services/scan-vision-claude.ts`, `src/core/sdk-hooks.ts`). **Harness** is
the Claude Code the boxholder and every worker session run in — `.claude/hooks/`,
`.claude/agents/finish.md` and the `/finish` flow, `bin/` worktree tooling,
`bin/land`, and the isolation rules worker sessions run under. Most SDK releases
say only "parity with Claude Code v2.1.N", so the itemized detail lives in the
Claude Code changelog, which is read every turn regardless of whether an SDK
release claims parity. A Claude Code change with zero SDK API surface can still
break this repo — v2.1.218's worktree git isolation silently broke `/finish`'s
merge step for days. Claude Code versions that move harness behavior get their
own entries here, labeled as such, with no pin to apply.

- **Current pin:** `0.3.234` (in `callback-box/package.json` — see the split-pin
  note below; the monorepo root still carries a second, unmanaged pin at
  `0.3.226`)
- **Latest reviewed upstream version:** `0.3.237` (SDK), `2.1.237` (Claude Code)
- **Ledger floor:** `0.3.220` (earlier releases are out of scope)
- **Current recommendation:** `0.3.235` was ~46h at this turn (two hours short,
  for the second day running) and `0.3.236`/`0.3.237` are ~21h/~16h. All three
  should be settled next turn; take the newest on the normal settled path.
  Nothing act-now on either channel. Two items to carry forward: `0.3.236`'s
  `classifierContext` is an addition to a hook shape callback-box already
  builds, and 2.1.236 fixed SIGTERM in SDK mode recording synthetic tool denials
  into transcripts callback-box parses.

## Release ledger

### 0.3.237 — pending (parity with Claude Code 2.1.237)

- **Upstream:** The SDK entry is only "Updated to parity with Claude Code
  v2.1.237". Claude Code 2.1.237 is two items: prompt caching fixed for sessions
  using an LLM gateway or custom base URL, and a new built-in "Concise" output
  style that leads with results and skips preamble.
- **Callback-box applicability:** Nothing on either channel. Callback-box talks
  to the Anthropic API directly, with no gateway or custom base URL, so the
  caching fix does not apply; the output style is an interactive `/config`
  preference with no SDK or repo surface. **Published 2026-08-19T23:58Z, only
  ~5h after `0.3.236`** — a fast-follow worth noting mainly because a same-day
  successor is usually a hotfix, but 2.1.237 reads as ordinary work rather than
  a repair of anything in `0.3.236`.
- **Action:** ~16h old, inside the settling window.
- **Sources:** [Agent SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#03237), [Claude Code 2.1.237](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21237)

### 0.3.236 — pending

- **Upstream (SDK):** One real API item: `PostToolUse` hooks can return
  `hookSpecificOutput.classifierContext`, a short host-asserted note about a tool
  call's result that the auto mode permission classifier reads alongside that
  result. The bundled Claude Code 2.1.236 is large; its relevant items are below.
- **Callback-box applicability (runtime):**
  - **`classifierContext` lands on a shape callback-box already builds.**
    `src/core/sdk-hooks.ts` returns `hookSpecificOutput` with
    `hookEventName: "PostToolUse"` today (the card-validator hook, registered in
    `buildQueryOptions` alongside the git-mv nudge). So this is a one-field
    addition to an object callback-box already constructs, not new plumbing.
    It is **inert at present** — the field feeds the auto mode permission
    classifier, and every callback-box query runs `permissionMode:
    "bypassPermissions"`, where no classification happens. Recorded as a genuine
    opportunity rather than a change: if callback-box ever runs box agents under
    auto mode, the card validator could assert *why* a card write was
    invalid/valid straight into the classifier's view.
  - **`SIGTERM in print/SDK mode no longer records an interrupted turn or
    synthetic tool denials before exiting` (2.1.236) — the most callback-box-
    shaped item in this batch.** SIGTERM to an SDK session is routine here, not
    exceptional: `src/core/agent/stream.ts:66` documents the SDK transport
    SIGTERMing the CLI with a SIGKILL fallback, `cb serve` forwards SIGTERM
    (`src/cli/commands/serve.ts:162`), `cb hub` idle-collects children, and the
    dev router stops worktrees after five minutes. Pre-fix, each of those wrote
    an interrupted turn plus synthetic tool denials into the transcript — and
    callback-box *reads* those transcripts (`src/cli/lib/session-entry.ts`
    grafts `tool_result` blocks onto their `tool_use`, and sessions resume from
    them). So this is a real correctness improvement to transcript fidelity.
    **Not marked act-now**: the damage is polluted transcript content, not a
    hang, crash, or leak, and `0.3.236` settles within a day. If a resumed box
    agent is ever seen reacting to tool denials that never happened, this is the
    cause.
  - Two fixes in 2.1.236 repair regressions that are **live at the current
    pin**, both dating to 2.1.229 (bundled in `0.3.229`, applied here 2026-08-15):
    clipboard copy, background housekeeping, background sessions, and local MCP
    logs breaking after a session's working directory is removed; and skills
    hot-reload in SDK sessions erroring on every skills change after the
    session's cwd was deleted. Callback-box deletes box directories out from
    under sessions in exactly one place — worktree teardown removing the cloned
    box (`bin/lib/worktree-teardown.sh`, `bin/worktrees sweep`) — so the
    exposure is dev-environment only; prod box directories are not deleted.
  - Not applicable: the `ANTHROPIC_DEFAULT_MODEL` env var (callback-box sets
    `model` explicitly per run via `normalizeModelId`), `notify_when_idle` on
    cross-session `SendMessage` (unused), the macOS sandbox wildcard read-deny
    precedence fix (no sandbox rules configured), and the WSL/`powershell.exe`
    subprocess fix (a 2.1.234 regression, Windows-only).
- **Callback-box applicability (harness):** Mostly TUI. Worth knowing:
  auto mode now sets aside `Monitor` allow rules so Monitor commands are
  reviewed like Bash; the auto mode git-status check can no longer be fooled by
  `status.showUntrackedFiles=no` into reporting a clean tree; a slash-command
  typo now reports instead of running the closest fuzzy match; and session
  recaps are capped at 400 characters. None requires a repo change.
- **Action:** Published 2026-08-19T18:49Z, ~21h old, inside the settling window.
- **Sources:** [Agent SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#03236), [Claude Code 2.1.236](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21236)

### 0.3.235 — pending (parity content from Claude Code 2.1.235)

- **Upstream:** The SDK entry is only "Updated to parity with Claude Code
  v2.1.235". That release is mostly terminal-UI and interactive polish; the
  items with any bearing here are an optional `spellcheck` setting, a fix for
  whole-prompt-cache invalidation when a language server disconnects or
  reconnects mid-session, a fix for Shift+Tab in the permission prompt's comment
  field approving the edit and granting session-wide edit permission instead of
  closing the field, a fix for the Agent tool advertising a general-purpose
  default in sessions where that agent is unavailable (an omitted
  `subagent_type` now errors with the available agents listed), permission
  dialogs whose display text and "don't ask again" scope now always match what a
  grant would cover (with "don't ask again" withheld when contents cannot be
  fully displayed), reduced memory and CPU while cloud sessions such as
  `/ultrareview` run in the background, and an embedded-`grep` improvement in
  native macOS/Linux builds where pathological patterns now fail fast instead of
  exhausting memory.
- **Callback-box applicability (runtime):** Nothing act-now. The
  `subagent_type` fix is inert — callback-box defines no custom agents for box
  sessions (no `agents/` in `callback-box/templates`, and no `subagent_type` or
  `agentType` anywhere in `src/`), so box agents get the default agent set. The
  cache-invalidation fix needs a language server, which headless box agents do
  not run.
  - **The embedded-`grep` memory improvement is the one item to keep in view.**
    Box agents use Grep constantly over box content, prod runs Linux, and the
    fix is specifically "fail fast instead of exhausting memory" on pathological
    patterns — a memory characteristic in a tool on callback-box's hot path.
    It is deliberately **not** marked act-now: the trigger is a pathological
    regex the model would have to emit, so reachability is speculative rather
    than demonstrated, which is the same bar applied to 0.3.229's file-watcher
    handle leak and 2.1.229's whitespace-only 400. With `0.3.234`/`0.3.235` both
    settling within a day, waiting costs one turn. If a box agent is ever seen
    dying on memory during a search, start here.
- **Callback-box applicability (harness):** Two permission-dialog fixes are
  worth noting for the boxholder's own interactive sessions, since both prevent
  granting *more* than intended: Shift+Tab in the comment field no longer
  silently grants session-wide edit permission, and "don't ask again" is now
  withheld when the contents behind it cannot be fully displayed. Worker
  sessions are unaffected — they run `--dangerously-skip-permissions`, so no
  prompt appears. The background-cloud-session memory/CPU improvement applies to
  this repo's `/code-review ultra` usage. The `subagent_type` error-listing fix
  lands on the dev repo's custom `.claude/agents/finish.md`, making an
  unavailable-agent spawn fail legibly instead of silently defaulting.
- **Action:** Published 2026-08-18T18:25Z. Still pending. Re-reviewed
  2026-08-20 at ~46h — two hours short of the window, the same near-miss as
  `0.3.234` hit the day before, since this monitor runs at a fixed hour and
  upstream publishes slightly later in the day. Upstream text unchanged, still
  nothing act-now.
- **Sources:** [Agent SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#03235), [Claude Code 2.1.235](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21235)

### 0.3.234 — applied

- **Upstream (SDK):** Removed the unused `bypass_permissions_disabled` member
  from the `ExitReason` type — the value was never emitted, and upstream warns
  that **TypeScript consumers with an explicit `case` branch for it get a
  compile error on upgrade** (runtime unaffected). Corrected the `ApiKeySource`
  type to the values `system/init` actually reports (`ANTHROPIC_API_KEY`,
  `apiKeyHelper`, `/login managed key`, `none`). `vcs_state_changed` now reports
  the directory the shell finished in (an inner `cd` is reflected). A peer
  `origin` injected by the host may declare the sending session's permission
  class (`fromMode`). `SDKSystemMessage` (`system`/`init`) gains an optional
  `effort` field, set on Remote Control bridge init frames.
- **Callback-box applicability (runtime):** **The breaking change does not bite
  here** — checked before bumping rather than after: `ExitReason`,
  `bypass_permissions_disabled`, and `ApiKeySource` appear nowhere in
  `callback-box/src`, `callback-box/scripts`, or `bin/`. The rest is inert too:
  `vcs_state_changed` is unconsumed, `fromMode` rides cross-session messaging
  callback-box does not use, and the new `effort` field on `system`/`init` is
  additive — `adaptSdkMessage` (`src/core/chat/session/messages.ts`) forwards
  only `session_id` from an init message. So `0.3.234` should be an ordinary
  settled bump next turn.
- **Callback-box applicability (harness) — one item worth keeping:**
  **`CLAUDE_CODE_PROJECT_DIR_NAME`** (new in 2.1.234) lets a host choose a short
  name for the per-project transcript directory. Callback-box *derives* that
  directory name itself: `encodeProjectDir`
  (`src/core/chat/session/transcript-paths.ts`) reproduces Claude Code's
  "replace every non-alphanumeric with `-`" encoding of the cwd, and
  `history.ts` enumerates the candidate directories from it. If that env var is
  ever set — by callback-box, or by a host wrapping it — the directory name
  stops being a function of the cwd and callback-box's session discovery would
  look in the wrong place. Nothing sets it today. This is the same fragile
  assumption the 0.3.224 entry flagged from the other direction (the >200-char
  sanitized-prefix collision); the file already has a `CB_CLAUDE_PROJECTS_DIR`
  override for the root, but no equivalent for the per-project directory name.
- **Other 2.1.234 harness items:** A fix landed for **accepting the "Try the new
  fullscreen renderer?" prompt restarting the session without its permission
  mode** (e.g. `--dangerously-skip-permissions`), tool allow/deny rules, model
  or effort flags. That is the flag every worker session in this repo launches
  with (`bin/CLAUDE.md`), so pre-fix a worker that accepted that prompt would
  silently drop to a permission-prompting session it cannot answer — the
  2.1.218 failure shape. Fixed upstream; no repo change needed. Also: session
  titles now read as short names, `/permissions` and `/add-dir` work mid-turn,
  the built-in `claude-api` skill's context cost dropped from ~200k to ~25k
  tokens, teammates now inherit the leader's model (the "Default teammate
  model" setting is gone), and the stale-`CLAUDE_CODE_OAUTH_TOKEN` reminder no
  longer leaks into a resumed turn — the continuing thread on callback-box's
  documented server auth path. The NT-namespace (`\??\`) path hardening is
  Windows-only.
- **Action:** Published 2026-08-17T18:20Z; held one extra turn on 2026-08-19 at
  ~46h. Applied 2026-08-20 via `pnpm update-agent-sdk` at ~70h as the newest
  settled version. The `ExitReason` breaking change predicted inert here did in
  fact land clean — typecheck passed with no `case`-branch fallout. Verified:
  `pnpm -C callback-box test` 7415/7415 pass, and
  `scripts/sdk-steering-probe.ts` holds all four steering behaviors.
- **Sources:** [Agent SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#03234), [Claude Code 2.1.234](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21234)

### Monitor gap — two turns lost to a working-tree collision

The 2026-08-16 and 2026-08-17 turns both stopped at the precondition check: a
tracked file (`issues/bugs/2026-08-09-transcript-flush-wait-full-timeout-real-sdk.md`)
carried an uncommitted edit both days, so the monitor reported the collision and
made no changes. Recorded because it explains why `0.3.232` and `0.3.233` sat
settled-but-unapplied for three days rather than being taken the morning each
cleared. Nothing was missed on the act-now axis — both were reviewed on
2026-08-15 and neither carried a callback-box-relevant security, memory, or
correctness fix — but the lesson is that this monitor's liveness depends on a
clean tree, and a single long-lived uncommitted file stalls it indefinitely.

### 0.3.233 — applied

- **Upstream (SDK):** Notification hooks now fire for pending permission prompts
  on the SDK path, matching the interactive REPL. Todo/task-tracking tools
  (`TaskCreate`/`TaskGet`/`TaskUpdate`/`TaskList`, `TodoWrite`) are no longer in
  the default tool surface on Opus 4.8, Sonnet 5, Fable 5, Mythos 5, and newer
  models; keep them by naming them in `tools`/`allowedTools` or setting
  `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`. Claude Code 2.1.233 adds the same removal
  plus: opt-in Bash memory cgroups on Linux (`CLAUDE_CODE_TOOL_MEMORY_LIMIT`),
  `CLAUDE_CODE_WEBFETCH_CACHE_TTL_MS`, a fix for idle Linux sessions pinning a
  CPU core when sandboxing is on, a fix for bundled skill aliases reporting
  "Unknown command" in `-p` mode when a user/project skill shadows them, an NT
  `\??\` device-prefix path-validation fix (NTLM credential-leak vector), and a
  **revert of 2.1.232's Bash permission changes** for Cygwin-style symlinks and
  input redirections (`< file`).
- **Callback-box applicability (runtime):** The todo-tool removal was checked
  rather than assumed and is **inert here**. Callback-box never asks for those
  tools: `buildQueryOptions` (`src/core/agent/run.ts`) and
  `src/services/claude-chat.ts` pass no `tools`/`allowedTools` at all, and the
  one place that does set an explicit surface — `OPERATOR_TOOLS` in
  `src/field-test/run.ts:61` — is `["Bash", "Read"]`. The many `todo` hits in
  `src/` are callback-box's own `{% todo %}` card annotation, an unrelated
  concept. Notification hooks are also inert: callback-box registers only
  `PreToolUse`/`PostToolUse` (`run.ts`), and runs `bypassPermissions`, so there
  are no pending permission prompts to notify about.
- **Callback-box applicability (harness):** The todo-tool removal **does** land
  here — worker sessions on Opus/Sonnet 5 lose `TodoWrite` and the `Task*` tools
  from their default surface, changing how agents track multi-step work in this
  repo. `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` restores them if that turns out to
  matter. Also relevant: the skill-shadowing fix touches `-p` mode, which is how
  the `cross-model` skill invokes `claude -p`, and this repo carries a large
  local skill set that could shadow bundled aliases. The Linux CPU-pinning fix
  and Bash memory cgroups are prod-side opportunities (`cb hub` runs Linux),
  though sandboxing is not enabled for box agents.
- **Action:** Published 2026-08-14T18:52Z. Applied 2026-08-18 via
  `pnpm update-agent-sdk` at ~93h as the newest settled version — later than the
  usual two days because the monitor was blocked for two turns (see the gap note
  above). Verified: typecheck clean, `pnpm -C callback-box test` 7201/7201 pass,
  and `scripts/sdk-steering-probe.ts` holds all four steering behaviors.
- **Sources:** [Agent SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#03233), [Claude Code 2.1.233](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21233)

### 0.3.232 — applied (parity content from Claude Code 2.1.232)

- **Upstream (SDK):** Subagent MCP `tool_result` frames whose result carries
  `_meta` now emit `tool_use_result` as `{ content, _meta }` instead of a bare
  value. `/context` result messages carry a structured `context_usage` payload
  (new `SDKContextUsage` type). `vcs_state_changed` events now populate `branch`
  for push operations. The bundled Claude Code 2.1.232 is a large release; its
  callback-box-relevant items are below.
- **Callback-box applicability (runtime):** All three SDK changes are inert —
  `tool_use_result`, `context_usage`, `SDKContextUsage`, and `vcs_state_changed`
  appear nowhere in `callback-box/src`. Note the `tool_use_result` shape change
  is *not* the same thing as the Anthropic `tool_result` **content block** that
  callback-box does consume (`src/core/agent/render.ts`,
  `src/cli/lib/session-content.ts`, the frontend `SessionLog`); those are
  unaffected. Callback-box also configures no MCP servers, so subagent MCP
  results do not arise.
- **Callback-box applicability (harness) — two items worth keeping:**
  - **Subagent forking is now on by default**: a `subagent_type: "fork"`
    subagent inherits the full conversation and prompt cache, and non-teammate
    agent spawns in interactive sessions now run in the background by default.
    This repo leans on subagents heavily (root CLAUDE.md makes them discretionary
    and encouraged) and ships a custom `.claude/agents/finish.md`. A default
    flip to background spawning changes the shape of any flow that expects a
    spawned agent's result inline. Nothing observed broken; flagged because it
    is a default change to the mechanism `/finish` and fan-out work ride on.
  - **Nested git repositories no longer inherit trust from a parent
    directory** — each now requires its own trust confirmation. This is the
    2.1.218-shaped risk (a permission/isolation tightening that an unattended
    session cannot answer), so the surfaces were enumerated: the nested repos in
    this checkout are `.deploy-checkout/.git` and the symlink-mounted
    `private-issues/`. Neither is used as a *session project root* today —
    `.deploy-checkout` is driven by `deploy.sh` over shell git, and
    private-issues is committed from inside it via shell git — so no trust
    prompt is currently reachable. Boxes are standalone repos
    (`~/src/boxes/test1/.git`) with the agent cwd at `<box>/content` inside
    them, not nested in a parent repo. Revisit if a worker session is ever
    started with cwd inside a nested repo.
  - Security fixes in this release do not apply: the PowerShell
    `$PSDefaultParameterValues` bypass and the Git Bash Cygwin-symlink bypass
    are Windows-only, and `sandbox.ripgrep` tier-restriction plus the Linux
    sandbox protected-path hardening land on sandbox config this repo does not
    set (`.claude/settings.json` carries only `statusLine` and hooks).
  - The `< file` Bash permission-check change from this release **was reverted in
    2.1.233**, so the friction noted at the time never needs acting on.
  - Also here: a fix for a startup race that could silently unregister a plugin
    marketplace via concurrent `known_marketplaces.json` writes — the third
    plugin-integrity fix in four releases, and this monorepo ships plugins.
- **Action:** Published 2026-08-13T21:31Z. Applied 2026-08-18, carried in by the
  settled bump to `0.3.233`. The subagent-forking default and the nested-repo
  trust change noted above have therefore been live in the bundled CLI since
  this bump.
- **Sources:** [Agent SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#03232), [Claude Code 2.1.232](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21232)

### Validation note — the 0.3.228 test failure did not reproduce

On 2026-08-14 a bump to `0.3.228` was reverted: `test/core/box/file-watcher.doctest.md`
hit tap's 300s timeout twice under it (3 reported failures = that file plus its
cascade), while the suite was clean at `0.3.227`. That looked like a possible
regression and was reported as suggestive-but-unproven.

**It did not reproduce.** This turn's bump to `0.3.231` — which contains
everything `0.3.228` introduced — ran a clean 6980/6980. Combined with the file
passing standalone in ~16s at the time and the test ledger showing it failing 5
times across 92 historical runs, the 2026-08-14 failure is best read as
load/timing flake in that doctest, not an SDK regression. Recorded so the
earlier caution is not left standing as an unresolved suspicion against
`0.3.228`. The underlying flake in `file-watcher.doctest.md` is a real test-suite
issue, but it belongs to the repo, not to this ledger.

### Monitor reliability — the SDK pin has split in two (needs a decision)

Not an upstream release; recorded here because it degrades this monitor.

Commit `db2ed936` ("Use SDK-backed Claude quota cache") added a **second**
`@anthropic-ai/claude-agent-sdk` pin at the monorepo root (`package.json`),
currently `0.3.226`. `bin/update-agent-sdk.ts` rewrites only
`callback-box/package.json` (its `MANIFEST` constant), so after this turn's bump
the two pins diverge: callback-box `0.3.227`, root `0.3.226`.

The concrete breakage is in the updater's own reporting and gate:
`installedVersion()` and `bundledCliVersion()` both read
`<root>/node_modules/@anthropic-ai/claude-agent-sdk`, which resolves the **root**
pin. That is why this turn's run ended with "Now at 0.3.226 (bundled CLI:
2.1.226)" even though the bump succeeded — `pnpm -C callback-box list` and
callback-box's own resolution both confirm `0.3.227`. Left alone, the next run's
`compareVersions(target, current)` check compares the target against the root
pin, so the script will read as perpetually behind.

Severity is limited: the root import is **type-only**
(`bin/agent-quotas.ts` imports `SDKControlGetUsageResponse` as a type; the other
root consumers are `bin/doctor.ts` and the updater itself), so no box agent runs
the root copy and prod is unaffected — it installs callback-box's pin from the
lockfile. **This turn deliberately did not touch the root pin**: the monitor's
commit scope is `docs/agent-sdk-notes.md`, `callback-box/package.json`, and
`pnpm-lock.yaml`, and unrelated files are out of bounds. Wanted from the
boxholder: either teach `update-agent-sdk.ts` to rewrite both manifests (and read
the version it actually manages), or drop the root pin in favor of the workspace
one.

### 0.3.231 — applied (parity with Claude Code 2.1.231)

- **Upstream:** SDK entry is only "Updated to parity with Claude Code v2.1.231".
  The itemized content is Claude Code 2.1.231's single fix: MCP OAuth sign-in
  failing with a redirect URI mismatch for servers that use a pre-registered
  OAuth client, such as Slack.
- **Callback-box applicability:** Nothing on the runtime channel — callback-box
  configures no `mcpServers` (still true as of this turn). On the harness
  channel it only affects a boxholder session signing in to a pre-registered
  MCP OAuth server; no repo surface, nothing to adjust.
- **Action:** Published 2026-08-13T08:31Z. Applied 2026-08-15 via
  `pnpm update-agent-sdk` at ~56h as the newest settled version, carrying
  `0.3.228` and `0.3.229` in with it. Verified: typecheck clean,
  `pnpm -C callback-box test` 6980/6980 pass, and
  `scripts/sdk-steering-probe.ts` holds all four steering behaviors.
- **Sources:** [Agent SDK release](https://github.com/anthropics/claude-agent-sdk-typescript/releases/tag/v0.3.231), [Claude Code 2.1.231](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21231)

### 0.3.230 — never published to npm (evidence for the settling window)

The SDK changelog carries a `0.3.230` entry ("Updated to parity with Claude Code
v2.1.230"), but **npm has no `0.3.230`** — the registry goes `0.3.229` →
`0.3.231` — and the Claude Code changelog has no `2.1.230` either. So a release
was cut and then withdrawn upstream this week. Nothing to apply; recorded because
it is direct, current evidence that the two-day settling window earns its keep,
and a caution against reading the changelog as the list of installable versions.

### 0.3.229 — applied

- **Upstream (SDK):** Added `terminal_slash_commands` to the system init message
  so Remote Control clients can hide terminal-oriented commands. Changed
  conversations whose messages alone exceed the API's 32 MB limit to end the turn
  with `terminal_reason` `"api_error"` instead of `"image_error"`, with
  `StopFailure` `error_details` of `"request_body_over_limit: …"`. It also
  carries Claude Code 2.1.229, a large release whose relevant items are below.
- **Callback-box applicability (runtime):**
  - `terminal_slash_commands` on system/init is additive and inert here —
    `adaptSdkMessage` (`src/core/chat/session/messages.ts`) forwards only
    `session_id` from a `system`/`init` message.
  - The 32 MB `terminal_reason` change is also inert: `terminal_reason`,
    `StopFailure`, `error_details`, and `image_error` appear nowhere in
    `callback-box/src`. Worth knowing if chat ever surfaces *why* a turn died,
    since image-heavy box threads are the ones that hit a 32 MB body.
  - **`Fixed SDK and --input-format stream-json sessions getting a 400 API error
    when a whitespace-only message was submitted` (2.1.229).** Names
    callback-box's exact session type, so it was checked: **not reachable.**
    The `/chat/send` body schema refines on `v.trim().length > 0`
    (`src/webapp/routes/chat-helpers.ts:97`), so a whitespace-only body is
    rejected at the HTTP boundary before it can reach the SDK. Transcription
    routes return text to the client, which then posts it through that same
    guarded route. Not act-now for that reason alone.
  - **`Fixed a file-watcher handle leak after atomic file replacements`
    (2.1.229) — the item to watch.** Callback-box replaces files atomically
    everywhere (`writeFileAtomic`, `src/lib/atomic-write.ts`, described in
    CLAUDE.md as the write every small state store uses), and prod runs resident
    `cb hub` + per-box `cb serve` with long-lived agent sessions — the shape
    where a per-replacement handle leak accumulates. Not marked act-now because
    the reachability is inferred rather than demonstrated (it is unconfirmed
    whether a headless SDK session watches box files at all), and this repo has
    prior heap-OOM history that was diagnosed, not guessed at. Given `0.3.229`
    settles tomorrow anyway, the cost of waiting is one day. If resident-process
    handle or memory growth shows up, start here.
  - `Fixed a crash to the error screen (including on --resume) when a tool call
    had a non-string glob, file_path, or command value` — callback-box resumes
    sessions constantly, so a resume-path crash is in-shape; the trigger is a
    malformed tool call, which is model behavior rather than anything the repo
    controls. Good to have, not act-now.
  - `Fixed dynamic workflows inside CPU-limited containers using the host
    machine's core count` — relevant to the documented Docker/VPS install
    (`callback-box/docs/docker-install.md`), where a container CPU limit is
    normal.
  - Vertex/Bedrock SSE keepalives and the `ANTHROPIC_BASE_URL` gateway fixes do
    not apply — callback-box talks to the Anthropic API directly.
- **Callback-box applicability (harness):**
  - **`Changed /commit-push-pr so git/gh commands with dangerous flags
    (--force, --amend, --no-verify, etc.) are no longer auto-approved`.** This is
    the 2.1.218-class item in the release, so it was checked directly: **no
    exposure.** Nothing in `.claude/` or `bin/` references `/commit-push-pr`, and
    `.claude/agents/finish.md`, `bin/land`, and
    `bin/lib/worktree-teardown.sh` contain no `--force`, `--amend`, or
    `--no-verify`. The `/finish` flow merges `--ff-only`, which is not on the
    dangerous list. Nothing to adjust — but this is the pattern to keep watching:
    a permission tightening that turns an unattended worker's git step into a
    prompt it cannot answer.
  - `Fixed one-shot claude plugin commands leaving a stray liveness file that
    could prevent cleanup of outdated plugin versions` — pairs with the
    symlinked-dev-checkout plugin-cache fix in the 2.1.228 entry; this monorepo
    ships plugins from local checkouts.
  - `Improved workflow fan-outs to stagger same-prefix sibling agents so
    subsequent agents read the cached prompt prefix` — a straight cost win for
    this repo's fan-out worker sessions. No action.
  - `Updated /login to repeat the CLAUDE_CODE_OAUTH_TOKEN override warning after
    a successful login` — touches the token path this ledger flagged in the
    2.1.224–2.1.226 backfill as callback-box's documented server auth.
  - Not applicable: self-hosted-runner items, sandbox IPv6 bracketing (no
    sandbox rules configured), Windows path fixes, IDE-diagnostics stalls, and
    the VSCode/Remote Control UI items.
- **Action:** Published 2026-08-12T19:30Z. Applied 2026-08-15, carried in by the
  settled bump to `0.3.231`. The file-watcher handle-leak fix flagged above is
  therefore now present at the pin; if resident-process handle or memory growth
  was ever going to improve from it, this is the release that did it.
- **Sources:** [Agent SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#03229), [Claude Code 2.1.229](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21229)

### Claude Code 2.1.228 — harness channel (no pin)

The boxholder's harness is already on 2.1.228 (verified `claude --version` this
turn); it auto-updates independently of our SDK pin, so there is nothing to
apply. Recorded because several items land squarely on this repo's workflow.

- **Session cleanup deleting contents inside a project's memory folder
  (fixed).** The most consequential item here: this session's persistent memory
  lives in a project memory folder, so the pre-fix behavior was silent data
  loss of durable notes. **Checked this machine — intact:** `MEMORY.md` indexes
  54 memories and 54 files exist, with no indexed-but-missing and no
  unindexed-orphan files. So this repo appears never to have been bitten, or
  was already past it. Keep as the explanation if memories ever go missing on a
  checkout still running an older CLI.
- **Write tool now lets newer models overwrite an existing file they haven't
  read this session** (matching Edit's rules; older models still require the
  read). A real loosening of a safety property in both channels: worker
  sessions in this repo and box agents editing cards can now blind-overwrite.
  Nothing to change today, but if a card or doc is ever clobbered wholesale
  rather than edited, this is the mechanism.
- **Background plugin-cache cleanup deleting a plugin's cache when its only
  version is a symlinked development checkout (fixed).** Directly relevant:
  this monorepo ships Claude plugins from local checkouts (the canvas-loop
  plugin, `callback-box/plugins/`), which is exactly the symlinked-dev-checkout
  shape that was being collected.
- **Skills synced from claude.ai hardened** — they no longer shadow local
  commands or MCP prompts, descriptions are sanitized and labeled, and their
  bodies no longer run `!` commands or expand `@` files. This repo's skills are
  all local (`.claude/skills/`) and unaffected; the hardening removes a path by
  which a synced skill could have shadowed one of them.
- **Not applicable:** the `self-hosted-runner` fixes (unused), Windows Git Bash
  discovery, `/tui` model reversion, marketplace settings-merge headers,
  cross-session inbox-on-first-start (no cross-session messaging here), and the
  interactive redraw/terminal-glyph/compaction-progress polish. Remote Control
  `/resume` history leaking into a connected session is a boxholder-session
  privacy fix with no repo surface.
- **Sources:** [Claude Code 2.1.228](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21228)

### 0.3.228 — applied

- **Upstream:** One change, and it is a real API item rather than a parity
  line: agent tool results (`AgentOutput`) now carry through
  `usage.output_tokens_details`.
- **Callback-box applicability (runtime):** Additive, nothing act-now, but it
  lands on a surface already flagged in this ledger. Callback-box's token
  accounting reads `result.usage` in `toBatchUsage`
  (`src/services/scan-vision-claude.ts`) and aggregates JSONL assistant-message
  usage in `src/core/usage.ts`; neither consumes agent-tool (`AgentOutput`)
  usage today, so subagent output tokens are simply absent from both. Combined
  with the `usage` vs `modelUsage` note in the 0.3.223 entry, this is the second
  piece of the same picture: cost accounting here undercounts anything outside
  the main loop. No behavior changes by upgrading.
- **Callback-box applicability (harness):** Nothing — no CLI behavior claimed.
- **Action:** Published 2026-08-11T17:49Z. A direct bump to it on 2026-08-14 was
  reverted on a test failure that did not reproduce (see the validation note
  above); applied 2026-08-15, carried in by the settled bump to `0.3.231`.
- **Sources:** [Agent SDK release](https://github.com/anthropics/claude-agent-sdk-typescript/releases/tag/v0.3.228), [Agent SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#03228)

### 0.3.227 — applied (parity with Claude Code 2.1.227)

- **Upstream:** The SDK entry says only "Updated to parity with Claude Code
  v2.1.227". The itemized content is Claude Code 2.1.227: fixed feature flags
  being evaluated without the user's subscription tier when a session started
  with an expired login token, which could wrongly prompt Max plan users to
  enable usage credits for Fable; fixed every Bash command failing under
  `claude-code-action` with `allowed_non_write_users` on GitHub-hosted runners;
  fixed `/tui` bringing back a conversation rewound to before its first message;
  improved the slash-command menu's selection highlighting and glyph handling;
  improved performance with fewer event-loop stalls on file-not-found
  suggestions and at-mention size checks.
- **Callback-box applicability (runtime):** Nothing. No API surface changed, and
  none of the fixes touch the query, message-adaptation, or hook paths
  callback-box uses.
- **Callback-box applicability (harness):** Effectively nothing to act on.
  - The `claude-code-action` fix does not apply: this repo's only GitHub
    workflow is `.github/workflows/pages.yml`, and nothing references
    `claude-code-action` or `allowed_non_write_users`.
  - `/tui` rewind and the slash-command menu are interactive-only surfaces that
    no hook, agent, or `bin/` tool depends on.
  - The expired-login-token feature-flag fix is a boxholder-session nuisance
    (a spurious Fable usage-credits prompt on Max), not a repo behavior change;
    it needs no adjustment to `.claude/` or `bin/`.
- **Action:** Published 2026-08-10T21:06Z; held one extra turn on 2026-08-12 at
  ~43h. Applied 2026-08-13 via `pnpm update-agent-sdk` at ~67h as the newest
  settled version. Verified: typecheck clean, `pnpm -C callback-box test`
  6830/6830 pass, and `scripts/sdk-steering-probe.ts` holds all four steering
  behaviors.
- **Sources:** [Agent SDK release](https://github.com/anthropics/claude-agent-sdk-typescript/releases/tag/v0.3.227), [Claude Code 2.1.227](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21227)

### Claude Code 2.1.224–2.1.226 — harness/deployment backfill (no pin)

Recorded 2026-08-11. These CLI versions were reviewed when their SDK
counterparts landed, but only through the runtime lens; this entry backfills the
harness and deployment channel. All three are already present in the bundled CLI
at the current pin (`0.3.226` bundles Claude Code 2.1.226), so nothing here is
outstanding work — it is durable evidence.

- **2.1.225 — long-lived `CLAUDE_CODE_OAUTH_TOKEN` clobbered by a transient
  401.** Upstream: a transient 401 replaced a long-lived
  `CLAUDE_CODE_OAUTH_TOKEN` with a stored login's short-lived token, breaking
  headless sessions until restart. **This is the most deployment-relevant item
  in the range.** `CLAUDE_CODE_OAUTH_TOKEN` is callback-box's documented server
  auth path (`callback-box/docs/docker-install.md`,
  `docs/plans/installation-story.md`), and box agents on a Docker/VPS install
  are exactly the long-running headless sessions described. Keep this as the
  explanation for any past "box agent stopped working until the service was
  restarted" report on a token-authenticated install. Fixed as of the current
  pin.
- **2.1.225 — cross-session messages parked without notice or expiry in headless
  sessions and during startup.** Pairs with the `crossSessionInbound` note in
  the 0.3.224 entry below. Callback-box sends no cross-session messages today,
  so this is latent, not active.
- **2.1.224 — removed the 200-subagent-per-session spawn cap.** Concurrency and
  depth limits still apply. Relevant to this repo's heavy fan-out worker
  sessions: a long-lived session no longer refuses new agents after 200. No
  action, but it removes a ceiling worth knowing about.
- **2.1.224 — sandbox filesystem deny entries with a trailing slash silently
  bypassable.** Not applicable: `.claude/settings.json` configures only
  `statusLine` and hooks — no sandbox permission rules — and worker sessions run
  unsandboxed by design (`bin/CLAUDE.md`).
- **2.1.224 — plugin install records corrupted when the same plugin is installed
  in multiple projects.** Worth noting because this monorepo ships plugins
  (`callback-box/plugins/`, the canvas-loop Claude plugin). No corruption has
  been observed here; recorded so a future "plugin vanished from one checkout"
  symptom has a known cause.
- **2.1.226 — "bug fixes and reliability improvements"** with nothing itemized;
  no harness surface to assess.
- **Sources:** [Claude Code 2.1.224](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21224), [2.1.225](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21225), [2.1.226](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21226)

### 0.3.226 — applied

- **Upstream:** "Updated to parity with Claude Code v2.1.226." The matching
  Claude Code 2.1.226 entry says only "Bug fixes and reliability improvements" —
  no itemized changes to evaluate.
- **Callback-box applicability:** Nothing specific to assess. The parity target
  names no behavior callback-box depends on, and the release adds no API
  surface. Nothing relevant, nothing act-now.
- **Action:** Published 2026-08-08T01:48Z. Deliberately not taken in the
  `0.3.225` act-now bump: the act-now fix callback-box needed landed in
  `0.3.225`, and `0.3.226` adds nothing that justifies skipping its settling
  window. Re-reviewed 2026-08-09 at ~38h old (upstream text unchanged, still
  short of the window) and again 2026-08-08+62h on 2026-08-10, when it cleared.
  Applied 2026-08-10 via `pnpm update-agent-sdk` as the newest settled version.
  Verified: typecheck clean, `pnpm -C callback-box test` 6680/6680 pass, and
  `scripts/sdk-steering-probe.ts` holds all four steering behaviors. The bundled
  Claude Code binary is now 2.1.226, matching the parity claim.
- **Sources:** [Agent SDK release](https://github.com/anthropics/claude-agent-sdk-typescript/releases/tag/v0.3.226), [Claude Code 2.1.226](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21226)

### 0.3.225 — applied (act-now)

- **Upstream:** Single fix — background subagents in headless/SDK sessions never
  resumed when a background shell command or Monitor they had left running
  completed, so the subagent never saw the result. No Claude Code parity claim.
- **Callback-box applicability:** **Act-now correctness fix, directly in
  callback-box's execution shape.** Every callback-box query is a headless SDK
  session (`src/core/agent/run.ts`, `src/services/claude-chat.ts`), and none of
  them restrict the toolset — `buildQueryOptions` sets `permissionMode`,
  `maxTurns`, hooks, and system-prompt options but passes no `allowedTools`/
  `disallowedTools`, so box agents have Task and background Bash available and
  can hit this. Callback-box also actively surfaces background-task lifecycle
  events in the chat UI: `adaptTaskMessage`
  (`src/core/chat/session/messages.ts`) normalizes `task_started`,
  `task_progress`, `task_updated`, and `task_notification` into `task`
  messages. The upstream symptom — a subagent that never resumes — would
  present here as a background task that starts, ticks, and then never settles,
  wedging the turn. Unlike 0.3.224's >200-char path bug, there is no
  precondition that callback-box fails to meet; it only needs a subagent to
  background a command, which is ordinary agent behavior.
- **Action:** Applied this turn as an act-now bump from `0.3.222`, skipping the
  settling window. Pinned to `0.3.225` specifically: it is the newest version
  *required* by the act-now fix, and taking `0.3.226` instead would pull an
  unsettled release that adds nothing needed. Verified with
  `pnpm -C callback-box typecheck` (clean), `pnpm -C callback-box test`
  (6444/6444 pass), and `scripts/sdk-steering-probe.ts` (all four steering
  behaviors hold: mid-tool injection, boundary race, priority-now soft
  interrupt, priority-later queueing).
- **Sources:** [Agent SDK release](https://github.com/anthropics/claude-agent-sdk-typescript/releases/tag/v0.3.225), [Agent SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#03225)

### 0.3.224 — applied

- **Upstream:** Added `crossSessionInbound` and `dialogExpiry` settings —
  cross-session messages sent to a session running with bypassed permissions
  are held for approval, while messages to other sessions auto-deliver; added
  `subkind: 'peer-send-message'` to the `task-notification` member of
  `SDKMessageOrigin`; added a `source: 'archive'` plugin config variant to
  `Settings` (`url` + optional `sha256`, install from a zip over HTTPS); added
  sandbox credential-masking fields to `Settings` (`decode: 'jwt'` with
  `maskClaims`, `extract`/`onExtractNoMatch` on `envVars`, `awsPairs`/`sigv4`
  for AWS SigV4 re-signing); fixed long (>200 char) project paths resolving to
  another project's session directory under a shared sanitized prefix, so
  session list/get/rename/tag/fork/delete and `/resume` no longer cross
  projects. No Claude Code parity claim.
- **Callback-box applicability:** One genuinely adjacent fix, but not reachable;
  the rest is unused surface.
  - Cross-project session directories: this is the closest thing to a
    correctness fix for callback-box, because callback-box owns the same
    encoding — `src/core/chat/session/transcript-paths.ts` maps an SDK cwd to
    `~/.claude/projects/<encoded-cwd>/`, and
    `src/core/chat/session/history.ts:145` enumerates every such directory a
    box's sessions can live in. **The >200-char precondition does not hold on
    real paths**: the longest encoded project directory on this machine is 137
    chars and the longest box cwd is 77 (`~/src/box-worktrees/<name>/test1/content`);
    prod boxes at `/home/callback/boxes/<slug>/content` are shorter still. So
    this is not act-now — but it is worth keeping as evidence if a box is ever
    placed under a deeply nested path, where the symptom would be a session
    resolving into a *different* box's transcripts.
  - `crossSessionInbound`/`dialogExpiry`: callback-box has no cross-session
    `SendMessage` usage at all, so nothing is inbound to hold. Note for later:
    callback-box runs `permissionMode: "bypassPermissions"` in all three of its
    query call sites (`src/core/agent/run.ts:72`,
    `src/services/claude-chat.ts:96`, `scripts/sdk-steering-probe.ts:78`), which
    is exactly the mode whose inbound messages are held for approval. If
    callback-box ever adopts cross-session messaging, unattended box agents would
    stall on that default and would need `crossSessionInbound` set explicitly.
  - `subkind: 'peer-send-message'`: additive optional field. `adaptTaskMessage`
    (`src/core/chat/session/messages.ts`) switches on `subtype` and terminates
    with `assertNever`, so a new *field* on `task_notification` does not affect
    it. (A new task *subtype* would be a compile error by design — that guard
    is working as intended and did not fire here.)
  - Archive plugin source and sandbox credential masking: callback-box ships its
    plugins from a local path (`plugins/`) and configures no SDK sandbox
    credential masking. Nothing relevant.
- **Action:** Published 2026-08-07T01:39Z. Never bumped to on its own merits —
  it was still inside the settling window, with no act-now fix callback-box
  could reach. Carried in by the `0.3.225` act-now bump on 2026-08-08, so the
  cross-project session-directory fix is now present at the pin.
- **Sources:** [Agent SDK release](https://github.com/anthropics/claude-agent-sdk-typescript/releases/tag/v0.3.224), [Agent SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#03224)

### 0.3.223 — applied

- **Upstream:** Added the `resumeDropsTurn` option (paired with
  `resumeSessionAt`) so a truncating resume must declare the turn it drops;
  result messages for repeated 529 overload failures now carry
  `api_error_status: 529`; bare headless runs (`-p` / `query()` without
  `canUseTool`) now emit `system/permission_denied` stream events when a tool
  call is auto-denied; documented that on stream-json results `usage` is
  main-loop-only and per-turn while `modelUsage` is cumulative across the whole
  query pipeline and is the field intended for cost accounting. No Claude Code
  parity claim in this release.
- **Callback-box applicability:** Nothing breaking and nothing act-now.
  - `resumeSessionAt`/`resumeDropsTurn`: unused. Callback-box resumes by
    session id (`resumeSessionId` in `src/core/chat/session/start-run.ts`) and
    never truncates a resume, so the new option does not apply.
  - `system/permission_denied`: callback-box passes no `canUseTool`, so it is a
    bare headless consumer and will start seeing these events.
    `adaptSdkMessage` (`src/core/chat/session/messages.ts:165`) returns `null`
    for unrecognized `system` subtypes, so the new event is silently dropped
    rather than mishandled. Agent runs use
    `permissionMode: "bypassPermissions"` (`src/core/agent/run.ts:72`), so
    auto-denials should be rare there. This is a future opportunity if we ever
    want to surface denied tool calls in the chat UI.
  - `api_error_status: 529`: `isTransientClaudeFailure`
    (`src/services/scan-vision-claude.ts:239`) currently decides retry-worthiness
    by regex-matching `/rate.?limit|overloaded|529|429/` against the result
    subtype/error text. The new structural field is the intended replacement for
    exactly that text match — worth switching to once pinned, keeping the regex
    as a fallback for 429/rate-limit cases the field does not cover.
  - `usage` vs `modelUsage`: `toBatchUsage`
    (`src/services/scan-vision-claude.ts:228`) computes scan token accounting
    from `result.usage`, which upstream now documents as main-loop-only and
    per-turn. Scan batches are single-turn, but any subagent or
    query-pipeline calls would be excluded, so the reported batch token counts
    can undercount. `modelUsage` is the documented field for cost accounting.
    Note `src/core/usage.ts` is unaffected — it aggregates token usage from
    session JSONL assistant messages, not from SDK result messages.
- **Action:** Published 2026-08-05T22:50Z; cleared the settling window on
  2026-08-07 but was overtaken before a settled bump ran. Carried in by the
  `0.3.225` act-now bump on 2026-08-08. The two scan-vision follow-ups above are
  now live opportunities at the current pin — `api_error_status: 529` and
  `modelUsage` are both available to use.
- **Sources:** [Agent SDK release](https://github.com/anthropics/claude-agent-sdk-typescript/releases/tag/v0.3.223), [Agent SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#03223)

### 0.3.222 — applied

- **Upstream:** Fixed `query({ sessionStore, resume })` dropping user settings
  in the resumed subprocess. The bundled Claude Code 2.1.222 also included
  security, connection-handling, hook-policy, and reliability fixes.
- **Callback-box applicability:** Callback-box does not use `sessionStore`, so
  the SDK-specific fix does not touch its resume path. No callback-box API or
  message adaptation changed.
- **Action:** Applied in the `0.3.220` to `0.3.222` bump.
- **Sources:** [Agent SDK release](https://github.com/anthropics/claude-agent-sdk-typescript/releases/tag/v0.3.222), [Claude Code 2.1.222](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21222)

### 0.3.221 — applied

- **Upstream:** Tightened `skills` option validation and fixed external
  `mcpServers` missing the first turn. The bundled Claude Code 2.1.221 included
  the matching headless MCP connection fix plus broader security and reliability
  changes.
- **Callback-box applicability:** Callback-box passes neither the `skills`
  option nor external `mcpServers`, so the SDK-specific changes do not affect
  its current query setup. Keep this entry as a pointer if callback-box later
  starts configuring either surface.
- **Action:** Applied as part of the `0.3.220` to `0.3.222` bump.
- **Sources:** [Agent SDK release](https://github.com/anthropics/claude-agent-sdk-typescript/releases/tag/v0.3.221), [Claude Code changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21221)

### 0.3.220 — applied

- **Upstream:** Updated the SDK to parity with Claude Code 2.1.220. That bundled
  CLI already included the 2.1.208 fix for unbounded memory growth from large
  tool-result payloads in long-running headless and SDK sessions.
- **Callback-box applicability:** The headless memory fix directly matches
  callback-box's resident chat execution shape. Binary verification confirms
  SDK 0.3.220 bundled Claude Code 2.1.220, so the fix was already present at the
  old pin; the later 0.3.222 bump did not introduce it. Keep this correction in
  the ledger when diagnosing the box OOM incident.
- **Action:** Applied before the monitor ledger was introduced.
- **Sources:** [Agent SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#03220), [Claude Code 2.1.208](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21208)
