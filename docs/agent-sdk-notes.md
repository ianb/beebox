# Agent SDK release applicability

This file is a cumulative, newest-first, beebox-specific view of Agent SDK
releases. The daily persistent monitor session maintains it — the
`sdk-update` schedule (`schedules/sdk-update/`, `bin/schedules list`), whose
`run` script parses the **Latest reviewed upstream version** line below to
decide whether there is anything to start a session for. Keep that line's
shape. It reads upstream
release notes in light of the SDK surfaces beebox actually uses. Applied
entries stay here because they can explain regressions and expose future
opportunities elsewhere in the code. The monitor automatically bumps settled
releases and immediately applies beebox-relevant security, memory, and
correctness fixes.

Two channels are assessed, not one. **Runtime** is beebox's own use of the
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

- **Current pin:** `0.3.246` (in `beebox/package.json` — see the split-pin
  note below; the monorepo root still carries a second, unmanaged pin at
  `0.3.226`, which is why `pnpm update-agent-sdk` ends by printing
  "Now at 0.3.226" even when the managed pin moved)
- **Latest reviewed upstream version:** `0.3.250` (SDK), `2.1.250` (Claude Code)
- **Ledger floor:** `0.3.220` (earlier releases are out of scope)
- **Current recommendation:** `0.3.246` was taken this turn as the newest settled
  version, so `perTaskStopAffordance` is now available to
  `issues/decisions/2026-08-25-chat-stop-and-background-subagents.md`. Pending:
  `0.3.247` (~29h, carries the `ambient` flag the task-strip issue needs — take
  it next turn), `0.3.248` (~3h) and `0.3.250` (~1h). None act-now.
  **`0.3.250` and `2.1.250` are recorded as unreviewable, not as reviewed** —
  they had no changelog section, no git tag and no GitHub release at review
  time. Their entry says what to re-read next turn.

## Release ledger

### 0.3.250 / Claude Code 2.1.250 — pending, UNREVIEWABLE at this turn (re-read next turn)

Both published ~1h before this turn (`0.3.250` 2026-08-27T22:28Z, `2.1.250`
minutes earlier) and **neither is documented anywhere yet**: no section in
either `main` CHANGELOG, no `v0.3.250`/`v2.1.250` git tag, no GitHub release,
and the claude-code npm tarball ships no changelog. `0.3.249` was never
published at all, so this is a two-version gap in a train that is currently
churning.

What could be established without release notes: the SDK's **public type surface
is unchanged**. `sdk.d.ts` from the `0.3.248` and `0.3.250` tarballs is
byte-identical, so `0.3.250` adds, removes and renames nothing beebox
compiles against. That bounds the risk of the version existing; it says nothing
about behavior, which is where the Claude Code half lives.

**This entry is not a review.** The next turn must re-read
`https://github.com/anthropics/claude-code/blob/v2.1.250/CHANGELOG.md` (and the
SDK's `0.3.250` section) once the tag lands, and replace this with a real
assessment. Recording it as reviewed would retire it from the briefing
permanently — the ledger's header advances to `0.3.250`/`2.1.250` because the
`run` script needs a single high-water mark, so this note is the only thing
keeping the obligation visible.

### 0.3.248 — pending (published 2026-08-27T20:37Z, ~3h at this turn)

- **Upstream:** One item: a per-server `timeout` for SDK-hosted MCP servers
  (`createSdkMcpServer({ timeout })`), overriding `MCP_TOOL_TIMEOUT` for that
  server's tool calls.
- **beebox applicability (runtime):** None. beebox calls
  `createSdkMcpServer` nowhere — it hosts no in-process MCP server, and
  `src/core/agent/run.ts` passes no `mcpServers`. The itemized SDK content is
  therefore empty for us, and everything that matters in this version is the
  Claude Code 2.1.248 it bundles, below.
- **Action:** Settled path; takeable 2026-08-29.
- **Sources:** [Agent SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#03248)

### Claude Code 2.1.248 — harness only (bundled by 0.3.248); one item wants the boxholder

~50 items. **Note the channel split before reading the rest**: harness fixes do
not arrive through this ledger's pin. The pin governs the CLI bundled for *box
agents*; the CLI the boxholder and every worker session run is a separately
installed Claude Code that auto-updates on its own schedule. At this turn that
installed CLI is **2.1.247** (`claude --version`), so everything below is fixed
upstream but **not yet present on this machine**.

- **`/ultrareview` was uploading credential-adjacent files, and this repo has
  some.** *"Fixed `/ultrareview` and locally seeded cloud sessions uploading
  uncommitted edits to `prod.env`-style and `*.tfvars` files, or to editor swap,
  temp, and backup copies of credential files (e.g. `key.pem.tmp`, `id_rsa.swo`);
  they now stay on your machine."* This repo carries exactly that shape of file:
  `beebox/.env` (gitignored, present) and `beebox/deploy/server-ip`
  (gitignored via `deploy/.gitignore`). The upload went to the boxholder's own
  cloud session rather than anywhere public, so this is not a disclosure to a
  third party — but it is credentials leaving the machine, and the installed
  2.1.247 still has the behavior. The fix arrives when Claude Code
  auto-updates; until then it is worth not launching `/ultrareview` from a tree
  with uncommitted edits to those files. Reported to the boxholder this turn.
- **Token-refresh contention no longer bounces a session to the login screen.**
  *"Fixed being sent to the login screen when another Claude Code process held
  the token refresh lock while the session token had expired; the request now
  fails with a retryable error instead."* This machine routinely runs many
  Claude Code processes at once — worktree sessions, box agents, scheduled runs
  — so lock contention at expiry is ordinary here rather than exotic. The
  symptom is the nastiest kind to diagnose: a mid-run session appearing to have
  lost its credentials, which invites exactly the "fix the credentials" reflex
  that this repo's practice forbids. Considered for act-now and **not** taken:
  no occurrence has been observed here, the failure is transient and clears on
  a rerun, and `0.3.248` was under three hours old at this turn on a train that
  had just skipped `0.3.249`. The settling window is worth more than the fix is
  urgent.
- **The hourly prompt-cache miss.** *"Fixed a prompt-cache miss (and lost
  extended-thinking context) roughly once an hour in long sessions, caused by
  tool definitions being re-rendered after an OAuth token refresh."* Long
  sessions are the norm here (chat sessions, worker sessions, this monitor). The
  lost extended-thinking context is the part that matters more than the cost.
- **Worktree locking — the protection does not reach this repo's teardown.**
  *"Fixed a backgrounded worktree session losing its checkout: the background
  session now holds the worktree's lock while it runs, so cleanup and
  `git worktree remove` leave it alone."* That protection is enforced by
  `git worktree remove` refusing a locked worktree, and this repo never calls
  it: `wt_remove_now_locked` (`bin/lib/worktree-teardown.sh:592-601`) renames the
  directory into a trash dir and prunes the registration, deliberately, because
  the trash form survives being killed mid-delete. A `mv` does not consult the
  lock. What protects a live session here is `wt_other_agent_live`'s argv/cwd
  process inspection, which probably does catch the case upstream fixed — a
  background session's worker has its cwd inside the worktree — so this is
  hardening rather than a demonstrated defect, filed as
  `issues/code-quality/2026-08-27-worktree-sweep-ignores-git-worktree-lock.md`.
- **`claude rm` and merged-but-unpushed branches.** *"Fixed `claude agents` and
  `claude rm` refusing to delete a session ('has commits that are not pushed
  anywhere') when its worktree branch was already merged into your checked-out
  default branch (e.g. local `main`) but not yet pushed."* This is precisely
  this repo's model: `bin/land` fast-forwards local `main` and nothing is ever
  pushed, so every finished worktree branch looked unpushed to that check.
- **Hook diagnostics.** Background sessions no longer wait silently when a
  `PermissionRequest` or `PreToolUse` hook prints an invalid answer (the
  `claude agents` row now names the hook and the schema error), and a stdout
  `{…}` object that isn't valid JSON is now reported as a hook error rather than
  silently treated as plain text. This repo's hooks print plain text or exit
  non-zero, so neither changes their meaning — but the third release running to
  improve hook and background-session failure visibility is a trend worth
  noticing, given how much of this repo's automation is hooks.
- **New capability, not adopted:** `--restricted` / `CLAUDE_CODE_RESTRICTED=1`
  strips command- and code-running tools plus `WebFetch`, confines file tools to
  the working directory, and **refuses `bypassPermissions`**. Box agents run
  `permissionMode: "bypassPermissions"` by design, so this is incompatible with
  the current agent model rather than an upgrade to it; it is the shape to
  remember if untrusted-content execution ever needs a sandboxed tier. Also
  added: `experimental.cacheTtl` in agent frontmatter (a per-agent prompt cache
  TTL), which `.claude/agents/` could use once cache behavior is worth tuning.
- **Free win:** the Workflow tool's description dropped from ~5.7k to ~1k
  tokens, with the authoring reference moved into a bundled skill — every
  session's prompt gets cheaper.
- **Not applicable, checked:** `/usage-credits` and the AWS-Marketplace
  Enterprise billing surface, server-managed settings diagnostics, gateway and
  `apiKeyHelper` sign-in fixes, self-hosted-runner labels, the Windows
  `claude agents` keyboard fixes, and the Claude Desktop/Cowork 30-day
  transcript-retention fix (that one governs desktop-written sessions;
  beebox reads SDK-written transcripts, though it is a reminder that
  transcript retention is upstream-controlled and chat history depends on it).
- **Action:** Nothing to adjust in the repo. One item reported to the boxholder;
  one issue filed.
- **Sources:** [Claude Code 2.1.248](https://github.com/anthropics/claude-code/blob/v2.1.248/CHANGELOG.md#21248)

### 0.3.247 — pending (published 2026-08-26T18:05Z, ~29h at this turn)

- **Upstream:** Two items. An optional `ambient` flag on `task_started`,
  `task_notification` and `background_tasks_changed` entries, "so hosts can
  exclude housekeeping tasks from activity indicators". And a fix: the
  `permissionMode` on per-turn `system/init` frames reported the mode at turn
  start rather than the live mode, so a mode switch right after submitting sent
  a stale value.
- **beebox applicability (runtime):** The `ambient` flag lands squarely on
  code beebox already wrote, and reading the shipped types rather than the
  changelog line is what made it assessable. Pulled `0.3.247`'s `sdk.d.ts`:
  `ambient` is documented as "true for housekeeping tasks the CLI does not
  surface as user work (**every `skip_transcript` task, plus auto-started
  live-update watchers**)", and `skip_transcript` is still present alongside it.
  So this is a **superset, not a rename** — nothing breaks, but
  `adaptTaskMessage` (`src/core/chat/session/messages.ts:126,148`) filters on
  `skip_transcript` alone, which means the watcher class reaches the chat
  transcript and the live task strip dressed as user work.
  Reading the same types surfaced a second thing the changelog does not mention:
  `background_tasks_changed`'s documentation now spells out that consumers
  needing only "is background work running" should replace their set with each
  payload rather than pairing edges, "so a missed bookend cannot wedge a stale
  running indicator". beebox's strip
  (`src/frontend/src/components/chat/background-tasks.ts`) pairs edges and
  consumes `background_tasks_changed` nowhere, so a dropped `settled` — a parked
  and resumed session, a CLI restart — leaves a task showing as running with no
  event able to clear it. Both are filed as one item:
  `issues/bugs/2026-08-26-chat-task-strip-edge-pairing-and-ambient.md`.
  The `permissionMode` fix does not apply: `src/core/agent/run.ts` sets
  `permissionMode: "bypassPermissions"` once and never switches mid-session.
- **beebox applicability (harness):** None from the SDK side.
- **Action:** Settled path — nothing act-now. Takeable 2026-08-28, and worth
  taking deliberately: the filed issue needs `ambient`. Still pending as of
  2026-08-27; re-read at that turn and nothing changed.
- **Sources:** [Agent SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#03247)

### Claude Code 2.1.247 — harness only (no SDK pin of its own; bundled by 0.3.247)

Note for future turns: 2.1.247's section was **not in `main`'s `CHANGELOG.md`**
at review time — `main` still started at 2.1.246. It was read from the tagged
`v2.1.247` copy instead
(`raw.githubusercontent.com/anthropics/claude-code/v2.1.247/CHANGELOG.md`). A
missing section on `main` is not evidence of an unitemized release; check the
tag before recording one as opaque.

~33 items. What touches this repo:

- **Two hook-output failure modes, both fixed.** *"Fixed a hook or background
  agent that printed megabytes of error output being able to overflow the
  conversation and wedge the session on 'Prompt is too long'"* and *"Fixed
  unbounded memory growth when a hook's or background task's output file could
  not be written; the file now notes where output was lost."* Every session here
  runs hooks that can fail loudly — `vibe-check lint --hook` on `Edit|Write`,
  `bbx validate --hook` from the `beebox-claude` plugin that box agents
  load, plus the SessionStart/SessionEnd/Worktree hooks. Checked how much they
  can actually emit: the shell hooks print single-line status messages, and the
  two validators print per-file diagnostics — a wall of ESLint errors is tens of
  KB, not the megabytes the overflow needs. So this is a real hazard class for
  this repo that this repo has not been observed to reach; welcome, not act-now.
- **Subagents no longer die on a first-call model 404.** They now fall back
  through the session's model chain, and the error handed to the parent includes
  error type, status, request id and model. This repo passes explicit model
  overrides when spinning up workers (`launch-worktree-session --model`), and
  beebox passes `model: normalizeModelId(...)` into `query()` — a typo or
  a retired id used to kill the subagent outright with little to go on.
- **Sonnet 5's default auto-compact window moves to its full 1M context**
  (~967K rather than ~934K). Long box agent sessions on Sonnet get slightly more
  room before compaction; the note matters mainly as the explanation if
  compaction timing looks different.
- **Checked and clear — `~/.claude/settings.json`.** *"Fixed the Bash sandbox's
  after-command cleanup deleting a dotfile-managed `~/.claude/settings.json`
  symlink (nix/home-manager, stow) when it is repointed outside the sandbox's
  writable area."* A settings-deleting bug is worth confirming rather than
  assuming: on this machine that path is a regular file (`-rw-------`), not a
  symlink, so the sandbox cleanup had nothing to unlink.
- **Checked and clear — `--agent`.** *"Fixed `/compact` and 'Summarize from
  here' in sessions started with `--agent` summarizing under the default system
  prompt instead of the conversation's own."* This looks like a direct hit and
  is not one: `--agent` in this repo is `bin/launch-worktree-session`'s and
  `bin/workstreams resume`'s **own** flag selecting the CLI (`claude` vs
  `codex`), never Claude Code's `--agent <name>`. No session here is started
  that way, so no worker session has been compacting under the wrong prompt.
- **Background sessions that lost their host.** *"Fixed a background session
  showing 'opening…' forever in `claude agents` after its terminal host process
  died; the row now fails within seconds with the reason, and Enter restarts
  it."* Alongside 2.1.246's 45-second startup fix, this is the second release in
  a row repairing background-session startup visibility — the failure shape that
  reads here as a scheduled run that simply never reported.
- **Not applicable, checked:** the MCP-failure disclosure improvement is scoped
  to Bedrock/Vertex/Foundry sessions and sessions with telemetry disabled —
  neither applies here (no telemetry-disabling env or setting in `bin/`,
  `.claude/`, or `deploy/`). Plugin marketplace hardening is for
  marketplace-installed plugins; beebox's is a local path plugin.
  Terminal-hyperlink hardening, Zed `/terminal-setup`, Cyrillic Ctrl shortcuts,
  mouse-report escapes and the arrow-key/Enter race are all interactive-terminal
  concerns no headless session touches.
- **New surface worth knowing:** the `SendFeedback` tool, which lets Claude
  draft a feedback report for review at `/feedback` (disable via the
  `feedbackDrafts` setting). It is draft-only and human-gated, so a box agent
  cannot send anything, but it is a new tool present in every session.
- **Action:** Nothing to adjust. Arrives with `0.3.247`.
- **Sources:** [Claude Code 2.1.247](https://github.com/anthropics/claude-code/blob/v2.1.247/CHANGELOG.md#21247)

### 0.3.246 — APPLIED 2026-08-27 (published 2026-08-25T19:15Z)

- **Upstream:** Four additions, no fixes. Optional `user_message_uuid` on error
  result messages and on the first assistant message or `stream_event` of each
  turn, linking a reply or failure back to the user message that triggered it.
  `modelUsage[*].costBasis` (`'list' | 'managed' | 'unknown'`) reporting which
  price table `costUSD` came from. `modelPricing` in the `managedSettings`
  option. And `perTaskStopAffordance`: with it set, `interrupt()` aborts only
  the current turn and leaves background agents and workflows running;
  without it — and always for one-shot string prompts — they stop with it.
- **beebox applicability (runtime):** `perTaskStopAffordance` is the one
  that matters. beebox calls `interrupt()` on the chat stop path
  (`src/core/chat/session/index.ts:374`, via
  `webapp/trpc/routers/chat-control-procedures.ts:212`), in
  `services/claude-chat.ts:273`, and in the field-test operator turns — all of
  which today mean "stop the background subagents too". Whether the chat stop
  button should keep that meaning is a real product question, not a flag flip,
  so it is filed as a decision rather than acted on:
  `issues/decisions/2026-08-25-chat-stop-and-background-subagents.md`.
  `user_message_uuid` is worth remembering next to the chat session's own uuid
  reconciliation (`src/core/chat/session/transcript-sync.ts`,
  `accepted-messages.ts`), which correlates by hand today; no work filed yet
  because the field only appears on the live stream and the reconciliation
  reads the on-disk transcript. `costBasis` and `modelPricing` are additive:
  beebox budgets with `maxBudgetUsd` but reads no cost fields, and sets
  no managed settings.
- **beebox applicability (harness):** None. `perTaskStopAffordance` is an
  SDK option; worker sessions are unaffected.
- **Action:** Applied 2026-08-27 on the settled path (~52h old), the newest
  settled version. `pnpm -C beebox test`: **8,386 pass, 0 fail**.
  `sdk-steering-probe`: all four steering behaviors pass. This is the pin that
  makes `perTaskStopAffordance` available, so the chat-stop decision issue is no
  longer blocked on the pin.
- **Sources:** [Agent SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#03246)

### Claude Code 2.1.246 — harness only (no SDK pin; 0.3.246 does not claim parity with it)

The largest itemized Claude Code release this ledger has seen, ~55 entries.
Almost all of it is interactive-UI polish that no worker session or box agent
touches. What is actually relevant here, in order:

- **Background sessions now open on a slept or slow machine.** *"Fixed
  background sessions failing to open after 45 seconds when Claude Code's
  starting directory had been deleted, the machine had slept, or the host is
  slow to start processes."* This is the schedule runner's exact environment —
  a laptop that sleeps, running scheduled sessions, in worktrees that get
  created and removed. A 45-second startup failure here reads as a bailed run
  with no explanation, which is the least diagnosable failure this repo has.
  The same release also fixes background sessions failing with
  `EACCES` when another Claude Code process is re-installing the npm package at
  that moment — plausible on a machine where several worktree sessions and a
  scheduled run overlap — and, on macOS, headless sessions leaving stale
  entries in `~/.claude/sessions` after an unclean exit.
- **Worktree deletion, checked and clear.** *"Fixed the background retention
  sweep removing git worktrees under `.claude/worktrees/` that you created
  yourself when an old background-session record pointed at them."* A
  worktree-destroying bug is worth checking rather than assuming: this repo is
  **not** exposed. `.claude/hooks/worktree-create.sh` deliberately does not
  forward Claude Code's proposed `<repo>/.claude/worktrees/<name>` path — it
  hands creation to `bin/workstreams create`, which places worktrees as
  siblings of the monorepo (`~/src/beebox-worktrees/`, `~/src/box-worktrees/`)
  because beebox's `file:../personal-vibe-check` dep only resolves there.
  No repo worktree has ever lived under the swept directory.
- **Bash permission checks on malformed commands.** *"Fixed Bash permission
  checks to always require approval for malformed commands with a dangling `&&`
  or `||` operator."* A permission-bypass class fix; it tightens, so nothing to
  adjust. Related: the release adds a startup warning for allow rules with a
  wildcard **before** the subcommand (`Bash(git * main)`). Checked the rules
  worker sessions actually run under — this repo's `.claude/settings.json` has
  no `permissions` block at all, and every user-level Bash rule is the ordinary
  `Bash(cmd:*)` trailing-wildcard form (`Bash(git mv:*)`, `Bash(node -e:*)`).
  No rule matches the warned shape, so no new startup noise and no rule that
  was quietly broader than it looked.
- **Non-interactive turns no longer die mid-stream.** *"Improved non-interactive
  sessions (`-p`, SDK, cloud sessions) to automatically continue a response cut
  off mid-stream by a server error, connection loss, or stall instead of ending
  with an error."* Directly relevant to every box agent turn and chat turn, both
  of which run through the SDK. Expect fewer spurious `is_error` turns of the
  kind `src/core/chat/session/messages.ts` logs. It also means a turn can now
  consume more wall-clock and more of its `maxTurns` budget before giving up;
  nothing to change, but it is the explanation to reach for if turn durations
  drift upward after this reaches the pin.
- **Concurrent launches from several worktrees.** *"Fixed `/ultrareview` runs
  and cloud sessions launched at the same time from one repository (e.g. from
  several worktrees) sometimes starting with another launch's uncommitted
  changes."* This repo runs many worktrees at once against one repository, so
  the shape is familiar, but the bug is confined to `/ultrareview` and cloud
  sessions — the cross-model review this repo actually runs is local Codex, and
  `/ultrareview` is boxholder-triggered and rare. Worth knowing that
  simultaneous launches were mixing trees; nothing to fix here.
- **Memory:** *"Fixed memory growing with session length in the fullscreen and
  Ctrl+O transcript views."* Interactive views only — the boxholder's own
  sessions benefit, box agents never render them. Likewise *"Fixed the Write
  tool reporting 'Out of memory' or freezing for a long time after overwriting
  a very large existing file"*, which box agents could in principle hit when
  rewriting a large card, though nothing has reported it.
- **Not applicable, checked:** the third-party-gateway credential leak fix
  (telemetry carrying the `ANTHROPIC_BASE_URL` API key) and the resumed-session
  400 on proxy-written tool blocks both need a third-party endpoint, which this
  repo does not use. The plugin fixes (duplicate SHA cache dirs, doubled
  `<plugin>:` skill names, `skills/*/SKILL.md` skills reporting 0,
  `${CLAUDE_PLUGIN_ROOT}` unresolved in hook errors) look aimed at
  `beebox/plugins/beebox-claude`, which box agents load as a local
  plugin from `run.ts` — but that plugin ships hooks only, no skills, and its
  `hooks.json` uses no `${CLAUDE_PLUGIN_ROOT}`, so none of them bite.
- **Action:** Nothing to adjust. The background-session and non-interactive
  continuation fixes are improvements this repo wants; they arrive with a
  future pin.
- **Sources:** [Claude Code 2.1.246](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21246)

### 0.3.245 — superseded (parity with Claude Code 2.1.245)

- **Upstream:** SDK says only "parity with Claude Code v2.1.245". 2.1.245 is a
  single-line release: *"Fixed a crash on startup on Linux distributions that
  ship glibc 2.44 (for example Arch Linux, CachyOS and Fedora Rawhide)."*
- **beebox applicability:** None on either channel. The boxholder's
  machine is macOS and the prod server is Debian-family, well below glibc 2.44.
  Recorded so the parity line is not mistaken for something unread.
- **Action:** Never installed on its own — `0.3.246` settled first and the
  updater takes the newest settled version. Its content (a Linux glibc 2.44
  startup fix, irrelevant here) is included in the current pin.
- **Sources:** [Claude Code 2.1.245](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21245)

### 0.3.244 — never published

The SDK changelog carries a `0.3.244` section ("parity with Claude Code
v2.1.244"), but npm has no such version — `npm view … time` skips straight from
`0.3.243` to `0.3.245`. Claude Code's changelog likewise jumps 2.1.243 → 2.1.245.
Both were pulled before or shortly after publish. Nothing to review, and
`update-agent-sdk` reads the registry rather than the changelog, so it will
never try to install it. Noted only so a future turn does not go looking for a
missing version.

### 0.3.243 — APPLIED 2026-08-26 (published 2026-08-24T23:07Z)

- **Upstream:** Four itemized changes plus parity with 2.1.243. Optional
  `queued_turn_count` on result messages (how many queued user sends were still
  pending when the result was produced). Fixed `mcp_status` reporting a remote
  MCP server as connected after its connection dropped — it now reports pending
  while reconnecting, then connected or failed. Fixed managed `disableAllHooks`
  also disabling hook callbacks registered through the `hooks` option; those now
  keep running, matching `allowManagedHooksOnly`. And a shape change: Read tool
  PDF results now deliver the `document` block (or page `image` blocks for
  `pages` reads) **inside** the `tool_result` content instead of as a separate
  `user` message after it.
- **beebox applicability (runtime):** This is the batch's only release
  that touches shapes beebox parses.
  - *PDF result shape.* Boxes hold PDF cards (the `document` → `pdf` card-type
    migration is in `src/core/migrations.ts`), so box agents do read PDFs.
    `src/core/agent/render.ts` renders user messages by walking only
    `tool_result` blocks, and `extractToolResultText` keeps only `text` items —
    so before this change a PDF's trailing `document` user-message rendered as
    nothing, and after it the block rides inside a `tool_result` whose text
    parts are empty, rendering as `↳ (no content)`. Cosmetic either way, no
    crash, no type error; recorded because "a tool result that used to print
    nothing now prints `(no content)`" is exactly the kind of diff that gets
    misread as a regression.
  - *`disableAllHooks`.* beebox registers `gitMvNudgeHook` through the
    `hooks` option in `src/core/agent/run.ts` and a `PostToolUse` validator
    through its local plugin. The fix only matters where a **managed** settings
    source sets `disableAllHooks`; neither this machine nor the prod box does,
    so nothing was silently off. Worth keeping in mind if managed settings ever
    arrive — the failure mode was silent hook loss.
  - *MCP reconnect.* `run.ts` passes no `mcpServers`, but `settingSources`
    defaults to `["user", "project"]`, so user-level MCP servers do load into
    box agent sessions. A server that dropped previously stayed reported as
    connected forever; now it reconnects or fails visibly. Correctness, arrives
    with the pin, no code change.
  - `queued_turn_count` is additive; the chat session tracks its own queue.
- **beebox applicability (harness):** 2.1.243 itself is mostly
  configuration and `/usage` surface — a Loops breakdown in `/usage`, a
  `modelPicker` setting, `promptCacheTtl`/`subagentPromptCacheTtl` (explicitly
  for API-key and cloud-provider users, which this account is not), a
  `modelPricing` managed setting, Console keyless sign-in, `/status` additions,
  and the model each subagent ran on now shown in `/tasks`. The one worth
  noting: *"Fixed remote MCP servers in non-interactive (`-p`) and SDK sessions
  never recovering after a dropped connection"* — the harness-side half of the
  SDK's `mcp_status` fix, and it applies to scheduled runs, which are exactly
  the long-lived non-interactive sessions where a connection has time to drop.
- **Action:** Applied 2026-08-26 on the settled path (~48h old) — the newest
  version past the window, ahead of the equally-settled `0.3.242`.
  `pnpm -C beebox test`: **8,235 pass, 0 fail** — the 27 webapp failures
  recorded against the `0.3.241` bump were pre-existing and have since been
  fixed on `main`. `sdk-steering-probe`: all four steering behaviors pass.
- **Sources:** [Agent SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#03243), [Claude Code 2.1.243](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21243)

### 0.3.242 — superseded, nothing relevant (parity with Claude Code 2.1.242)

- **Upstream:** SDK says only "parity with Claude Code v2.1.242", and **2.1.242
  has no changelog section at all** — Claude Code's changelog jumps 2.1.243 →
  2.1.241. So this is a published version whose contents are not documented
  anywhere, the third such pin in a short run (2.1.240 and 2.1.241 both said
  only "bug fixes and reliability improvements").
- **beebox applicability:** Nothing assessable on either channel.
- **Action:** Never installed on its own — `0.3.243` settled in the same turn
  and the updater takes the newest settled version, so the pin stepped straight
  over it. Its (undocumented) contents are included in the current pin.
- **Sources:** [Agent SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#03242)

### 0.3.241 — APPLIED 2026-08-25 (parity with Claude Code 2.1.241)

- **Upstream:** SDK entry is only "Updated to parity with Claude Code v2.1.241",
  and 2.1.241 itself says only "Bug fixes and reliability improvements" — nothing
  itemized to assess. This is the second consecutive opaque Claude Code release
  (2.1.240 said the same), so two pins in a row carry changes this ledger cannot
  characterize. Not a concern by itself; noted because a run of unitemized
  releases is exactly when a harness change like v2.1.218's worktree isolation
  could pass through unremarked, and the only defense is noticing behavior
  afterward rather than reading about it first.
- **beebox applicability:** Nothing assessable on either channel.
- **Action:** Applied 2026-08-25 on the settled path (~71h old) — it was the
  only version past the two-day window. `pnpm -C beebox test`: 7,866 pass,
  27 fail, all 27 in `test/webapp/login-redirect.doctest.md` and
  `test/webapp/mobile-spa-fallback.doctest.md` and **pre-existing** — confirmed
  by re-running both files at the previous `0.3.240` pin, where they fail
  identically. They exercise `src/webapp/base-prefix.ts`, which imports nothing
  from the SDK. `sdk-steering-probe`: all four steering behaviors pass.
- **Sources:** [Agent SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#03241), [Claude Code 2.1.241](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21241)

### Live bug found while reviewing 2.1.239 — `encodeProjectDir` no longer matches Claude Code (FILED 2026-08-25 as `issues/bugs/2026-08-25-encode-project-dir-underscore-mismatch.md`; re-verified still live at that date)

Claude Code 2.1.239 lists: *"Fixed `claude -c`/resume picking up sessions from a
different directory whose path differed only by characters like `_`, `-`, or
`.`"*. That is exactly the collision beebox's own code documents, so the
on-disk encoding was checked rather than assumed — and **beebox's encoder
is wrong today, independent of any release in this ledger.**

`encodeProjectDir` (`beebox/src/core/chat/session/transcript-paths.ts`)
collapses *every* non-alphanumeric character to `-`:

    return cwd.replace(/[^\dA-Za-z]/g, "-");

with a comment asserting that "paths with `_`, `.`, spaces, etc. all collapse to
the same shape." **Claude Code does not do that — it preserves `_` and `.`.**
Verified against the real store: for the box path
`~/src/box-worktrees/tool_arg_preview/test1`, the directory
Claude Code actually created keeps the underscores, while the name
`encodeProjectDir` computes does not exist on disk at all. 27 of the 5,343
project directories on this machine contain a character beebox would have
collapsed, and the oldest dates to 2026-05-12 — so this is long-standing, not a
regression introduced by 2.1.239 or by any bump this ledger has made.

**Impact:** session discovery silently misses for any box or worktree whose path
contains `_` or `.`. `getSessionLogPath` resolves to a directory that does not
exist, and `history.ts`'s candidate enumeration is built from the same encoder,
so a chat in such a box would find no transcripts rather than fail loudly. Boxes
under plain `~/src/boxes/<name>/content` are unaffected; the exposure is
underscore- or dot-named worktrees (`box-worktrees/tool_arg_preview/test1` is a
real example on this machine) and any `*.moved-to` box directory.

**Not fixed here.** This monitor's commit scope is the ledger, the pin, and the
lockfile; changing `transcript-paths.ts` is application work that wants its own
change and its own test. Recorded as durable evidence, which is what this file
is for. **Status 2026-08-24: still unfixed and unfiled** — `transcript-paths.ts` still
carries the collapsing regex at line 28, last changed 2026-08-20 (before this
was found), and no issue for it exists under `issues/bugs/`. Re-checked each
turn until it moves.

**Prior art worth reading before fixing this.**
`issues/closed/bugs/2026-07-11-pre-v2-session-resume-broken.md` records the same
class of failure from the other direction: *"Pre-v2-migration chat sessions are
unresumable on prod (project-dir hash changed with `content/`); schedule-fire
responses into them vanish silently."* It was closed `wontfix` for the
data-repair half, with the delivery-loss half fixed separately by falling back
to a fresh session. Two things carry over. First, this repo has already been
bitten once by the project-dir name changing underneath it, so the encoder is a
known-fragile joint rather than a novel suspicion. Second, and more useful: the
observed symptom there was **silent** — responses vanishing rather than an
error — which is exactly what the `_`/`.` mismatch would produce today. Whoever
fixes the encoder should check whether the same fresh-session fallback already
masks this one in the schedule-fire path, because if it does, the bug can be
live in production without ever surfacing a failure. The fix is presumably to stop collapsing `_` and `.` — but the exact
upstream rule should be derived from observed directory names rather than
guessed, and 2.1.239 may have just changed the disambiguation behaviour on top
of it, so whoever picks this up should re-derive the encoding against a current
CLI before editing.

### 0.3.240 — applied (parity with Claude Code 2.1.240)

- **Upstream:** SDK entry is only "Updated to parity with Claude Code v2.1.240",
  and 2.1.240 itself says only "Bug fixes and reliability improvements" — nothing
  itemized to assess on either channel.
- **Action:** Published 2026-08-22T13:07Z. Applied 2026-08-24 via
  `pnpm update-agent-sdk` at ~51h as the newest settled version, carrying
  `0.3.239` in with it. Verified: typecheck clean, `pnpm -C beebox test`
  7848/7848 pass, and `scripts/sdk-steering-probe.ts` holds all four steering
  behaviors.
- **Sources:** [Agent SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#03240), [Claude Code 2.1.240](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21240)

### 0.3.239 — applied

- **Upstream (SDK):** `total_cost_usd` / `modelUsage.costUSD` now include the
  1.1× US-only-inference (data residency) multiplier when the response reports
  `inference_geo: "us"`. A result held back for background subagents in one-shot
  mode now reports `total_cost_usd`, `duration_api_ms` and `modelUsage` as of its
  release rather than the turn-end snapshot. Fixed
  `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` in an array `systemPrompt` being sent as
  literal text on Bedrock/Vertex/Foundry/gateway providers. A repeated
  `initialize` on a running process is now followed by a
  `background_tasks_changed` snapshot.
- **beebox applicability (runtime):**
  - **Both cost changes land on a value beebox records.**
    `scan-vision-claude.ts` reads `result.total_cost_usd` per scan batch (and
    `toBatchUsage` reads `result.usage`). The 1.1× data-residency multiplier
    makes that figure larger but *more accurate* where it applies; the
    one-shot/background-subagent change makes it correct as of release rather
    than a turn-end snapshot. Neither breaks anything — but any comparison of
    scan costs recorded across this pin boundary is apples-to-oranges, which is
    worth knowing before reading a cost trend as a regression.
  - `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`: inert. beebox passes
    `systemPrompt: { type: "preset", preset: "claude_code", append: … }`
    (`src/core/agent/run.ts`), not an array, and talks to the Anthropic API
    directly rather than through Bedrock/Vertex/Foundry/a gateway.
  - The `background_tasks_changed`-after-repeated-`initialize` item continues the
    thread from `0.3.238`: it further confirms the SDK expects hosts that
    re-`initialize` a running process. beebox still is not one — its warm
    pool hands the already-initialized `Query` to `buildRunFromQuery` — so both
    items remain inert here for the same reason.
- **beebox applicability (harness):**
  - `Fixed WebFetch retaining expired page content in memory for the whole
    session instead of the intended 15 minutes` — a real memory fix in a tool
    box agents can use, and resident box sessions are exactly where per-session
    retention accumulates. Not act-now: beebox fetches most external
    content server-side through its own connectors (`article-fetcher`,
    `feed-fetcher`) rather than the agent's WebFetch tool, so agent WebFetch use
    is incidental, and the fix arrives with the next settled bump anyway.
  - Checked and clear: this repo has no `.worktreeinclude`, so the `**/`
    pattern fix does not apply, and no `.md` under `.claude/` or
    `beebox/plugins/` starts with a UTF-8 BOM, so the silently-ignored
    agents/skills/commands fix has nothing to repair here.
  - `Fixed /resume in all-projects mode telling you to cd into a deleted
    directory (e.g. a removed worktree)` — this repo removes worktrees
    routinely, so the improvement is welcome; nothing to change.
  - Not applicable: the Bedrock/Vertex/proxy fixes, cloud-session plugin sync,
    Alpine/musl add-ons, and the JetBrains and terminal-rendering items.
- **Action:** Published 2026-08-21T17:23Z. Applied 2026-08-24, carried in by the
  settled bump to `0.3.240`. Both cost-accounting changes are therefore live:
  scan-vision `total_cost_usd` figures recorded from this pin forward are not
  comparable with earlier ones.
- **Sources:** [Agent SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#03239), [Claude Code 2.1.239](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21239)

### Cadence note — the fixed check hour costs a day per release

Three turns running, the newest release has been 2–3 hours short of the 48h
window at check time: `0.3.234` at ~46h on 08-19, `0.3.235` at ~46h on 08-20,
`0.3.236` at ~45h on 08-21. The cause is structural, not upstream flakiness —
this monitor runs at a fixed hour (~16:04Z) and the SDK has been publishing at
roughly 18:00–19:00Z, so a release is always ~2h shy on its second morning and
gets taken on its third. The effect is a consistent one-day lag between "settled"
and "applied", not a correctness problem: nothing act-now has been delayed by it,
since an act-now finding bypasses the window entirely. Recorded so the pattern
reads as a known property of the schedule rather than a series of coincidences.
Moving the run ~3h later, or treating the window as 45h, would close it.

### 0.3.238 — applied

- **Upstream (SDK):** Added `is_backgrounded` and `spawn_depth` to
  `task_started` events for subagent tasks (`is_backgrounded` also on background
  Bash tasks). Added `suppressOriginalPrompt` to `UserPromptExpansion` hook
  output. Added a `command_lifecycle` state `refused` for cross-session peer
  messages a receive-side policy declines. **Fixed SDK hook callbacks silently
  not applying after a host re-sends `initialize` to an already-running CLI**;
  the response now reports `hooks_applied`. Fixed
  `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION` near-limit behavior. Changed
  `vcs_state_changed` push events to emit one event per pushed branch.
- **beebox applicability (runtime):**
  - **The hook-callbacks-after-re-`initialize` fix is the one worth thinking
    about, and it looks inert here — but the reasoning is worth writing down
    because the blast radius would be large if wrong.** beebox registers
    hooks on every query: `PreToolUse: [gitMvNudgeHook()]` plus the local
    harness plugin in `src/services/claude-chat.ts`, and
    `PreToolUse`/`PostToolUse` (git-mv nudge + card validator) in
    `src/core/agent/run.ts`. It also runs a warm-subprocess pool — `startup({
    options: queryOptions })` spawns and initializes a CLI ahead of time, and
    `warmCompatible`/`warmSlotKey` decide whether a later `start()` may consume
    that slot. Crucially, the consuming path hands the **already-initialized
    `Query` straight to `buildRunFromQuery`**; beebox never re-sends
    `initialize` with a fresh options object to a running CLI, and
    `warmCompatible` exists precisely so a slot is only reused when its baked
    options already match. So the host-side pattern the fix describes is not one
    beebox performs. **If that inference is wrong** — i.e. if the SDK's own
    warm-start path re-initializes internally — the symptom would be the git-mv
    `PreToolUse` nudge and the card-validator `PostToolUse` hook silently not
    firing on warm-started chats, which is exactly the kind of failure that
    leaves no trace. The new `hooks_applied` field in the initialize response is
    the thing that would make it observable; worth wiring into a chat-backend
    assertion if hook silence is ever suspected.
  - `is_backgrounded` / `spawn_depth` on `task_started` are additive on a shape
    beebox already adapts — `adaptTaskMessage`
    (`src/core/chat/session/messages.ts`) normalizes `task_started` into the
    wire `task` message, switching on `subtype` with an `assertNever`
    terminator, so new *fields* pass through harmlessly. A genuine UI
    opportunity: the chat companion pane could distinguish a backgrounded
    subagent from a foreground one, and show nesting depth.
  - Inert: `suppressOriginalPrompt` (beebox registers no
    `UserPromptExpansion` hook), `command_lifecycle: refused` (no cross-session
    messaging), `vcs_state_changed` per-branch push events (still unconsumed
    anywhere in `src/`), and the prompt-suggestion env var (unused).
- **beebox applicability (harness):**
  - **`Fixed unbounded memory growth in long interactive sessions: subagent tool
    results are now released once they leave the recent display window`** — the
    headline memory item, but it is scoped to *interactive* sessions and a
    *display* window, i.e. renderer retention, so it should not touch headless
    box agents. It does apply to the boxholder's own long sessions and to
    worker sessions. Noted rather than dismissed because this repo has prior
    heap-OOM history in prod; if resident memory ever regresses, confirm whether
    the release applies to SDK mode before ruling it in.
  - `Fixed leftover /tmp/claude-*-cwd files when a Bash command is killed, times
    out, or is interrupted` — small, but box agents run many Bash commands that
    get killed or time out, so the leak accumulates steadily on a long-lived
    deployment. Worth knowing when auditing temp-file growth.
  - `Fixed worktree-isolation Bash refusals telling you to remove a redirect
    when the command had none` — message quality only, but it confirms
    worktree-isolation refusals (the v2.1.218 mechanism that broke `/finish`)
    remain live and are still being tuned. Nothing to change.
  - Not applicable: plugin-marketplace `headersHelper` (this monorepo ships
    plugins from local paths, not url marketplaces), all `self-hosted-runner`
    flags, the MCP `server/discover` ordering fix (no MCP servers configured),
    and the Remote Control and cross-session messaging fixes.
- **Action:** Published 2026-08-20T18:02Z. Applied 2026-08-23 via
  `pnpm update-agent-sdk` at ~70h as the newest settled version. Verified:
  typecheck clean, `pnpm -C beebox test` 7529/7529 pass, and
  `scripts/sdk-steering-probe.ts` holds all four steering behaviors. The
  hook-callbacks-after-re-`initialize` fix analysed above is therefore now live
  at the pin — no behavior change was observed, consistent with the conclusion
  that beebox never performs that re-initialize.
- **Sources:** [Agent SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#03238), [Claude Code 2.1.238](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21238)

### 0.3.237 — applied (parity with Claude Code 2.1.237)

- **Upstream:** The SDK entry is only "Updated to parity with Claude Code
  v2.1.237". Claude Code 2.1.237 is two items: prompt caching fixed for sessions
  using an LLM gateway or custom base URL, and a new built-in "Concise" output
  style that leads with results and skips preamble.
- **beebox applicability:** Nothing on either channel. beebox talks
  to the Anthropic API directly, with no gateway or custom base URL, so the
  caching fix does not apply; the output style is an interactive `/config`
  preference with no SDK or repo surface. **Published 2026-08-19T23:58Z, only
  ~5h after `0.3.236`** — a fast-follow worth noting mainly because a same-day
  successor is usually a hotfix, but 2.1.237 reads as ordinary work rather than
  a repair of anything in `0.3.236`.
- **Action:** Applied 2026-08-22 via `pnpm update-agent-sdk` at ~64h as the
  newest settled version, carrying `0.3.236` in with it. Verified: typecheck
  clean, `pnpm -C beebox test` 7496/7496 pass, and
  `scripts/sdk-steering-probe.ts` holds all four steering behaviors.
- **Sources:** [Agent SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#03237), [Claude Code 2.1.237](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21237)

### 0.3.236 — applied

- **Upstream (SDK):** One real API item: `PostToolUse` hooks can return
  `hookSpecificOutput.classifierContext`, a short host-asserted note about a tool
  call's result that the auto mode permission classifier reads alongside that
  result. The bundled Claude Code 2.1.236 is large; its relevant items are below.
- **beebox applicability (runtime):**
  - **`classifierContext` lands on a shape beebox already builds.**
    `src/core/sdk-hooks.ts` returns `hookSpecificOutput` with
    `hookEventName: "PostToolUse"` today (the card-validator hook, registered in
    `buildQueryOptions` alongside the git-mv nudge). So this is a one-field
    addition to an object beebox already constructs, not new plumbing.
    It is **inert at present** — the field feeds the auto mode permission
    classifier, and every beebox query runs `permissionMode:
    "bypassPermissions"`, where no classification happens. Recorded as a genuine
    opportunity rather than a change: if beebox ever runs box agents under
    auto mode, the card validator could assert *why* a card write was
    invalid/valid straight into the classifier's view.
  - **`SIGTERM in print/SDK mode no longer records an interrupted turn or
    synthetic tool denials before exiting` (2.1.236) — the most beebox-
    shaped item in this batch.** SIGTERM to an SDK session is routine here, not
    exceptional: `src/core/agent/stream.ts:66` documents the SDK transport
    SIGTERMing the CLI with a SIGKILL fallback, `bbx serve` forwards SIGTERM
    (`src/cli/commands/serve.ts:162`), `bbx hub` idle-collects children, and the
    dev router stops worktrees after five minutes. Pre-fix, each of those wrote
    an interrupted turn plus synthetic tool denials into the transcript — and
    beebox *reads* those transcripts (`src/cli/lib/session-entry.ts`
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
    session's cwd was deleted. beebox deletes box directories out from
    under sessions in exactly one place — worktree teardown removing the cloned
    box (`bin/lib/worktree-teardown.sh`, `bin/worktrees sweep`) — so the
    exposure is dev-environment only; prod box directories are not deleted.
  - Not applicable: the `ANTHROPIC_DEFAULT_MODEL` env var (beebox sets
    `model` explicitly per run via `normalizeModelId`), `notify_when_idle` on
    cross-session `SendMessage` (unused), the macOS sandbox wildcard read-deny
    precedence fix (no sandbox rules configured), and the WSL/`powershell.exe`
    subprocess fix (a 2.1.234 regression, Windows-only).
- **beebox applicability (harness):** Mostly TUI. Worth knowing:
  auto mode now sets aside `Monitor` allow rules so Monitor commands are
  reviewed like Bash; the auto mode git-status check can no longer be fooled by
  `status.showUntrackedFiles=no` into reporting a clean tree; a slash-command
  typo now reports instead of running the closest fuzzy match; and session
  recaps are capped at 400 characters. None requires a repo change.
- **Action:** Published 2026-08-19T18:49Z. Applied 2026-08-22, carried in by the
  settled bump to `0.3.237`. The `classifierContext` opportunity and the SIGTERM
  transcript-fidelity fix noted above are therefore now live at the pin.
- **Sources:** [Agent SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#03236), [Claude Code 2.1.236](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21236)

### 0.3.235 — applied (parity content from Claude Code 2.1.235)

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
- **beebox applicability (runtime):** Nothing act-now. The
  `subagent_type` fix is inert — beebox defines no custom agents for box
  sessions (no `agents/` in `beebox/templates`, and no `subagent_type` or
  `agentType` anywhere in `src/`), so box agents get the default agent set. The
  cache-invalidation fix needs a language server, which headless box agents do
  not run.
  - **The embedded-`grep` memory improvement is the one item to keep in view.**
    Box agents use Grep constantly over box content, prod runs Linux, and the
    fix is specifically "fail fast instead of exhausting memory" on pathological
    patterns — a memory characteristic in a tool on beebox's hot path.
    It is deliberately **not** marked act-now: the trigger is a pathological
    regex the model would have to emit, so reachability is speculative rather
    than demonstrated, which is the same bar applied to 0.3.229's file-watcher
    handle leak and 2.1.229's whitespace-only 400. With `0.3.234`/`0.3.235` both
    settling within a day, waiting costs one turn. If a box agent is ever seen
    dying on memory during a search, start here.
- **beebox applicability (harness):** Two permission-dialog fixes are
  worth noting for the boxholder's own interactive sessions, since both prevent
  granting *more* than intended: Shift+Tab in the comment field no longer
  silently grants session-wide edit permission, and "don't ask again" is now
  withheld when the contents behind it cannot be fully displayed. Worker
  sessions are unaffected — they run `--dangerously-skip-permissions`, so no
  prompt appears. The background-cloud-session memory/CPU improvement applies to
  this repo's `/code-review ultra` usage. The `subagent_type` error-listing fix
  lands on the dev repo's custom `.claude/agents/finish.md`, making an
  unavailable-agent spawn fail legibly instead of silently defaulting.
- **Action:** Published 2026-08-18T18:25Z; held an extra turn on 2026-08-20 at
  ~46h. Applied 2026-08-21 via `pnpm update-agent-sdk` at ~70h as the newest
  settled version. Verified: typecheck clean, `pnpm -C beebox test`
  7460/7460 pass, and `scripts/sdk-steering-probe.ts` holds all four steering
  behaviors. The embedded-`grep` memory improvement flagged above is therefore
  now live at the pin.
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
- **beebox applicability (runtime):** **The breaking change does not bite
  here** — checked before bumping rather than after: `ExitReason`,
  `bypass_permissions_disabled`, and `ApiKeySource` appear nowhere in
  `beebox/src`, `beebox/scripts`, or `bin/`. The rest is inert too:
  `vcs_state_changed` is unconsumed, `fromMode` rides cross-session messaging
  beebox does not use, and the new `effort` field on `system`/`init` is
  additive — `adaptSdkMessage` (`src/core/chat/session/messages.ts`) forwards
  only `session_id` from an init message. So `0.3.234` should be an ordinary
  settled bump next turn.
- **beebox applicability (harness) — one item worth keeping:**
  **`CLAUDE_CODE_PROJECT_DIR_NAME`** (new in 2.1.234) lets a host choose a short
  name for the per-project transcript directory. beebox *derives* that
  directory name itself: `encodeProjectDir`
  (`src/core/chat/session/transcript-paths.ts`) reproduces Claude Code's
  "replace every non-alphanumeric with `-`" encoding of the cwd, and
  `history.ts` enumerates the candidate directories from it. If that env var is
  ever set — by beebox, or by a host wrapping it — the directory name
  stops being a function of the cwd and beebox's session discovery would
  look in the wrong place. Nothing sets it today. This is the same fragile
  assumption the 0.3.224 entry flagged from the other direction (the >200-char
  sanitized-prefix collision); the file already has a `BBX_CLAUDE_PROJECTS_DIR`
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
  longer leaks into a resumed turn — the continuing thread on beebox's
  documented server auth path. The NT-namespace (`\??\`) path hardening is
  Windows-only.
- **Action:** Published 2026-08-17T18:20Z; held one extra turn on 2026-08-19 at
  ~46h. Applied 2026-08-20 via `pnpm update-agent-sdk` at ~70h as the newest
  settled version. The `ExitReason` breaking change predicted inert here did in
  fact land clean — typecheck passed with no `case`-branch fallout. Verified:
  `pnpm -C beebox test` 7415/7415 pass, and
  `scripts/sdk-steering-probe.ts` holds all four steering behaviors.
- **Sources:** [Agent SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#03234), [Claude Code 2.1.234](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21234)

### Monitor gap — two turns lost to a working-tree collision

The 2026-08-16 and 2026-08-17 turns both stopped at the precondition check: a
tracked file (`issues/bugs/2026-08-09-transcript-flush-wait-full-timeout-real-sdk.md`)
carried an uncommitted edit both days, so the monitor reported the collision and
made no changes. Recorded because it explains why `0.3.232` and `0.3.233` sat
settled-but-unapplied for three days rather than being taken the morning each
cleared. Nothing was missed on the act-now axis — both were reviewed on
2026-08-15 and neither carried a beebox-relevant security, memory, or
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
- **beebox applicability (runtime):** The todo-tool removal was checked
  rather than assumed and is **inert here**. beebox never asks for those
  tools: `buildQueryOptions` (`src/core/agent/run.ts`) and
  `src/services/claude-chat.ts` pass no `tools`/`allowedTools` at all, and the
  one place that does set an explicit surface — `OPERATOR_TOOLS` in
  `src/field-test/run.ts:61` — is `["Bash", "Read"]`. The many `todo` hits in
  `src/` are beebox's own `{% todo %}` card annotation, an unrelated
  concept. Notification hooks are also inert: beebox registers only
  `PreToolUse`/`PostToolUse` (`run.ts`), and runs `bypassPermissions`, so there
  are no pending permission prompts to notify about.
- **beebox applicability (harness):** The todo-tool removal **does** land
  here — worker sessions on Opus/Sonnet 5 lose `TodoWrite` and the `Task*` tools
  from their default surface, changing how agents track multi-step work in this
  repo. `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` restores them if that turns out to
  matter. Also relevant: the skill-shadowing fix touches `-p` mode, which is how
  the `cross-model` skill invokes `claude -p`, and this repo carries a large
  local skill set that could shadow bundled aliases. The Linux CPU-pinning fix
  and Bash memory cgroups are prod-side opportunities (`bbx hub` runs Linux),
  though sandboxing is not enabled for box agents.
- **Action:** Published 2026-08-14T18:52Z. Applied 2026-08-18 via
  `pnpm update-agent-sdk` at ~93h as the newest settled version — later than the
  usual two days because the monitor was blocked for two turns (see the gap note
  above). Verified: typecheck clean, `pnpm -C beebox test` 7201/7201 pass,
  and `scripts/sdk-steering-probe.ts` holds all four steering behaviors.
- **Sources:** [Agent SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#03233), [Claude Code 2.1.233](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21233)

### 0.3.232 — applied (parity content from Claude Code 2.1.232)

- **Upstream (SDK):** Subagent MCP `tool_result` frames whose result carries
  `_meta` now emit `tool_use_result` as `{ content, _meta }` instead of a bare
  value. `/context` result messages carry a structured `context_usage` payload
  (new `SDKContextUsage` type). `vcs_state_changed` events now populate `branch`
  for push operations. The bundled Claude Code 2.1.232 is a large release; its
  beebox-relevant items are below.
- **beebox applicability (runtime):** All three SDK changes are inert —
  `tool_use_result`, `context_usage`, `SDKContextUsage`, and `vcs_state_changed`
  appear nowhere in `beebox/src`. Note the `tool_use_result` shape change
  is *not* the same thing as the Anthropic `tool_result` **content block** that
  beebox does consume (`src/core/agent/render.ts`,
  `src/cli/lib/session-content.ts`, the frontend `SessionLog`); those are
  unaffected. beebox also configures no MCP servers, so subagent MCP
  results do not arise.
- **beebox applicability (harness) — two items worth keeping:**
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
`beebox/package.json` (its `MANIFEST` constant), so after this turn's bump
the two pins diverge: beebox `0.3.227`, root `0.3.226`.

The concrete breakage is in the updater's own reporting and gate:
`installedVersion()` and `bundledCliVersion()` both read
`<root>/node_modules/@anthropic-ai/claude-agent-sdk`, which resolves the **root**
pin. That is why this turn's run ended with "Now at 0.3.226 (bundled CLI:
2.1.226)" even though the bump succeeded — `pnpm -C beebox list` and
beebox's own resolution both confirm `0.3.227`. Left alone, the next run's
`compareVersions(target, current)` check compares the target against the root
pin, so the script will read as perpetually behind.

Severity is limited: the root import is **type-only**
(`bin/agent-quotas.ts` imports `SDKControlGetUsageResponse` as a type; the other
root consumers are `bin/doctor.ts` and the updater itself), so no box agent runs
the root copy and prod is unaffected — it installs beebox's pin from the
lockfile. **This turn deliberately did not touch the root pin**: the monitor's
commit scope is `docs/agent-sdk-notes.md`, `beebox/package.json`, and
`pnpm-lock.yaml`, and unrelated files are out of bounds. Wanted from the
boxholder: either teach `update-agent-sdk.ts` to rewrite both manifests (and read
the version it actually manages), or drop the root pin in favor of the workspace
one.

### 0.3.231 — applied (parity with Claude Code 2.1.231)

- **Upstream:** SDK entry is only "Updated to parity with Claude Code v2.1.231".
  The itemized content is Claude Code 2.1.231's single fix: MCP OAuth sign-in
  failing with a redirect URI mismatch for servers that use a pre-registered
  OAuth client, such as Slack.
- **beebox applicability:** Nothing on the runtime channel — beebox
  configures no `mcpServers` (still true as of this turn). On the harness
  channel it only affects a boxholder session signing in to a pre-registered
  MCP OAuth server; no repo surface, nothing to adjust.
- **Action:** Published 2026-08-13T08:31Z. Applied 2026-08-15 via
  `pnpm update-agent-sdk` at ~56h as the newest settled version, carrying
  `0.3.228` and `0.3.229` in with it. Verified: typecheck clean,
  `pnpm -C beebox test` 6980/6980 pass, and
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
- **beebox applicability (runtime):**
  - `terminal_slash_commands` on system/init is additive and inert here —
    `adaptSdkMessage` (`src/core/chat/session/messages.ts`) forwards only
    `session_id` from a `system`/`init` message.
  - The 32 MB `terminal_reason` change is also inert: `terminal_reason`,
    `StopFailure`, `error_details`, and `image_error` appear nowhere in
    `beebox/src`. Worth knowing if chat ever surfaces *why* a turn died,
    since image-heavy box threads are the ones that hit a 32 MB body.
  - **`Fixed SDK and --input-format stream-json sessions getting a 400 API error
    when a whitespace-only message was submitted` (2.1.229).** Names
    beebox's exact session type, so it was checked: **not reachable.**
    The `/chat/send` body schema refines on `v.trim().length > 0`
    (`src/webapp/routes/chat-helpers.ts:97`), so a whitespace-only body is
    rejected at the HTTP boundary before it can reach the SDK. Transcription
    routes return text to the client, which then posts it through that same
    guarded route. Not act-now for that reason alone.
  - **`Fixed a file-watcher handle leak after atomic file replacements`
    (2.1.229) — the item to watch.** beebox replaces files atomically
    everywhere (`writeFileAtomic`, `src/lib/atomic-write.ts`, described in
    CLAUDE.md as the write every small state store uses), and prod runs resident
    `bbx hub` + per-box `bbx serve` with long-lived agent sessions — the shape
    where a per-replacement handle leak accumulates. Not marked act-now because
    the reachability is inferred rather than demonstrated (it is unconfirmed
    whether a headless SDK session watches box files at all), and this repo has
    prior heap-OOM history that was diagnosed, not guessed at. Given `0.3.229`
    settles tomorrow anyway, the cost of waiting is one day. If resident-process
    handle or memory growth shows up, start here.
  - `Fixed a crash to the error screen (including on --resume) when a tool call
    had a non-string glob, file_path, or command value` — beebox resumes
    sessions constantly, so a resume-path crash is in-shape; the trigger is a
    malformed tool call, which is model behavior rather than anything the repo
    controls. Good to have, not act-now.
  - `Fixed dynamic workflows inside CPU-limited containers using the host
    machine's core count` — relevant to the documented Docker/VPS install
    (`beebox/docs/docker-install.md`), where a container CPU limit is
    normal.
  - Vertex/Bedrock SSE keepalives and the `ANTHROPIC_BASE_URL` gateway fixes do
    not apply — beebox talks to the Anthropic API directly.
- **beebox applicability (harness):**
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
    2.1.224–2.1.226 backfill as beebox's documented server auth.
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
  plugin, `beebox/plugins/`), which is exactly the symlinked-dev-checkout
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
- **beebox applicability (runtime):** Additive, nothing act-now, but it
  lands on a surface already flagged in this ledger. beebox's token
  accounting reads `result.usage` in `toBatchUsage`
  (`src/services/scan-vision-claude.ts`) and aggregates JSONL assistant-message
  usage in `src/core/usage.ts`; neither consumes agent-tool (`AgentOutput`)
  usage today, so subagent output tokens are simply absent from both. Combined
  with the `usage` vs `modelUsage` note in the 0.3.223 entry, this is the second
  piece of the same picture: cost accounting here undercounts anything outside
  the main loop. No behavior changes by upgrading.
- **beebox applicability (harness):** Nothing — no CLI behavior claimed.
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
- **beebox applicability (runtime):** Nothing. No API surface changed, and
  none of the fixes touch the query, message-adaptation, or hook paths
  beebox uses.
- **beebox applicability (harness):** Effectively nothing to act on.
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
  settled version. Verified: typecheck clean, `pnpm -C beebox test`
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
  in the range.** `CLAUDE_CODE_OAUTH_TOKEN` is beebox's documented server
  auth path (`beebox/docs/docker-install.md`,
  `docs/plans/installation-story.md`), and box agents on a Docker/VPS install
  are exactly the long-running headless sessions described. Keep this as the
  explanation for any past "box agent stopped working until the service was
  restarted" report on a token-authenticated install. Fixed as of the current
  pin.
- **2.1.225 — cross-session messages parked without notice or expiry in headless
  sessions and during startup.** Pairs with the `crossSessionInbound` note in
  the 0.3.224 entry below. beebox sends no cross-session messages today,
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
  (`beebox/plugins/`, the canvas-loop Claude plugin). No corruption has
  been observed here; recorded so a future "plugin vanished from one checkout"
  symptom has a known cause.
- **2.1.226 — "bug fixes and reliability improvements"** with nothing itemized;
  no harness surface to assess.
- **Sources:** [Claude Code 2.1.224](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21224), [2.1.225](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21225), [2.1.226](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21226)

### 0.3.226 — applied

- **Upstream:** "Updated to parity with Claude Code v2.1.226." The matching
  Claude Code 2.1.226 entry says only "Bug fixes and reliability improvements" —
  no itemized changes to evaluate.
- **beebox applicability:** Nothing specific to assess. The parity target
  names no behavior beebox depends on, and the release adds no API
  surface. Nothing relevant, nothing act-now.
- **Action:** Published 2026-08-08T01:48Z. Deliberately not taken in the
  `0.3.225` act-now bump: the act-now fix beebox needed landed in
  `0.3.225`, and `0.3.226` adds nothing that justifies skipping its settling
  window. Re-reviewed 2026-08-09 at ~38h old (upstream text unchanged, still
  short of the window) and again 2026-08-08+62h on 2026-08-10, when it cleared.
  Applied 2026-08-10 via `pnpm update-agent-sdk` as the newest settled version.
  Verified: typecheck clean, `pnpm -C beebox test` 6680/6680 pass, and
  `scripts/sdk-steering-probe.ts` holds all four steering behaviors. The bundled
  Claude Code binary is now 2.1.226, matching the parity claim.
- **Sources:** [Agent SDK release](https://github.com/anthropics/claude-agent-sdk-typescript/releases/tag/v0.3.226), [Claude Code 2.1.226](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21226)

### 0.3.225 — applied (act-now)

- **Upstream:** Single fix — background subagents in headless/SDK sessions never
  resumed when a background shell command or Monitor they had left running
  completed, so the subagent never saw the result. No Claude Code parity claim.
- **beebox applicability:** **Act-now correctness fix, directly in
  beebox's execution shape.** Every beebox query is a headless SDK
  session (`src/core/agent/run.ts`, `src/services/claude-chat.ts`), and none of
  them restrict the toolset — `buildQueryOptions` sets `permissionMode`,
  `maxTurns`, hooks, and system-prompt options but passes no `allowedTools`/
  `disallowedTools`, so box agents have Task and background Bash available and
  can hit this. beebox also actively surfaces background-task lifecycle
  events in the chat UI: `adaptTaskMessage`
  (`src/core/chat/session/messages.ts`) normalizes `task_started`,
  `task_progress`, `task_updated`, and `task_notification` into `task`
  messages. The upstream symptom — a subagent that never resumes — would
  present here as a background task that starts, ticks, and then never settles,
  wedging the turn. Unlike 0.3.224's >200-char path bug, there is no
  precondition that beebox fails to meet; it only needs a subagent to
  background a command, which is ordinary agent behavior.
- **Action:** Applied this turn as an act-now bump from `0.3.222`, skipping the
  settling window. Pinned to `0.3.225` specifically: it is the newest version
  *required* by the act-now fix, and taking `0.3.226` instead would pull an
  unsettled release that adds nothing needed. Verified with
  `pnpm -C beebox typecheck` (clean), `pnpm -C beebox test`
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
- **beebox applicability:** One genuinely adjacent fix, but not reachable;
  the rest is unused surface.
  - Cross-project session directories: this is the closest thing to a
    correctness fix for beebox, because beebox owns the same
    encoding — `src/core/chat/session/transcript-paths.ts` maps an SDK cwd to
    `~/.claude/projects/<encoded-cwd>/`, and
    `src/core/chat/session/history.ts:145` enumerates every such directory a
    box's sessions can live in. **The >200-char precondition does not hold on
    real paths**: the longest encoded project directory on this machine is 137
    chars and the longest box cwd is 77 (`~/src/box-worktrees/<name>/test1/content`);
    prod boxes at `/home/beebox/boxes/<slug>/content` are shorter still. So
    this is not act-now — but it is worth keeping as evidence if a box is ever
    placed under a deeply nested path, where the symptom would be a session
    resolving into a *different* box's transcripts.
  - `crossSessionInbound`/`dialogExpiry`: beebox has no cross-session
    `SendMessage` usage at all, so nothing is inbound to hold. Note for later:
    beebox runs `permissionMode: "bypassPermissions"` in all three of its
    query call sites (`src/core/agent/run.ts:72`,
    `src/services/claude-chat.ts:96`, `scripts/sdk-steering-probe.ts:78`), which
    is exactly the mode whose inbound messages are held for approval. If
    beebox ever adopts cross-session messaging, unattended box agents would
    stall on that default and would need `crossSessionInbound` set explicitly.
  - `subkind: 'peer-send-message'`: additive optional field. `adaptTaskMessage`
    (`src/core/chat/session/messages.ts`) switches on `subtype` and terminates
    with `assertNever`, so a new *field* on `task_notification` does not affect
    it. (A new task *subtype* would be a compile error by design — that guard
    is working as intended and did not fire here.)
  - Archive plugin source and sandbox credential masking: beebox ships its
    plugins from a local path (`plugins/`) and configures no SDK sandbox
    credential masking. Nothing relevant.
- **Action:** Published 2026-08-07T01:39Z. Never bumped to on its own merits —
  it was still inside the settling window, with no act-now fix beebox
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
- **beebox applicability:** Nothing breaking and nothing act-now.
  - `resumeSessionAt`/`resumeDropsTurn`: unused. beebox resumes by
    session id (`resumeSessionId` in `src/core/chat/session/start-run.ts`) and
    never truncates a resume, so the new option does not apply.
  - `system/permission_denied`: beebox passes no `canUseTool`, so it is a
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
- **beebox applicability:** beebox does not use `sessionStore`, so
  the SDK-specific fix does not touch its resume path. No beebox API or
  message adaptation changed.
- **Action:** Applied in the `0.3.220` to `0.3.222` bump.
- **Sources:** [Agent SDK release](https://github.com/anthropics/claude-agent-sdk-typescript/releases/tag/v0.3.222), [Claude Code 2.1.222](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21222)

### 0.3.221 — applied

- **Upstream:** Tightened `skills` option validation and fixed external
  `mcpServers` missing the first turn. The bundled Claude Code 2.1.221 included
  the matching headless MCP connection fix plus broader security and reliability
  changes.
- **beebox applicability:** beebox passes neither the `skills`
  option nor external `mcpServers`, so the SDK-specific changes do not affect
  its current query setup. Keep this entry as a pointer if beebox later
  starts configuring either surface.
- **Action:** Applied as part of the `0.3.220` to `0.3.222` bump.
- **Sources:** [Agent SDK release](https://github.com/anthropics/claude-agent-sdk-typescript/releases/tag/v0.3.221), [Claude Code changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21221)

### 0.3.220 — applied

- **Upstream:** Updated the SDK to parity with Claude Code 2.1.220. That bundled
  CLI already included the 2.1.208 fix for unbounded memory growth from large
  tool-result payloads in long-running headless and SDK sessions.
- **beebox applicability:** The headless memory fix directly matches
  beebox's resident chat execution shape. Binary verification confirms
  SDK 0.3.220 bundled Claude Code 2.1.220, so the fix was already present at the
  old pin; the later 0.3.222 bump did not introduce it. Keep this correction in
  the ledger when diagnosing the box OOM incident.
- **Action:** Applied before the monitor ledger was introduced.
- **Sources:** [Agent SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#03220), [Claude Code 2.1.208](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21208)
