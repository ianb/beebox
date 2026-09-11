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

Three channels are assessed. **Runtime** is beebox's own use of the
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
own entries here, labeled as such, with no pin to apply. **Codex** is the
third channel, added 2026-09-05: `@openai/codex` and `@openai/codex-sdk`,
pinned together in `beebox/package.json`, are the binary the box's Codex chats
run (`src/services/codex-sdk-session.ts`, `src/services/codex-binary.ts`) and
what the production server's `codex` symlink resolves to — nothing else
updates Codex on the server, so a model upstream adds is invisible to boxes
until the pin moves. Its releases are read from `openai/codex` on GitHub.
Codex entries here are labeled as such; they carry their own pin.

- **Current pins:** Agent SDK `0.3.266`, Codex `0.153.4` (both `@openai/codex`
  and `@openai/codex-sdk`), all in `beebox/package.json`. The monorepo root
  still carries a second, unmanaged Agent SDK pin at `0.3.226` —
  `issues/code-quality/2026-09-01-agent-sdk-split-pin-root-copy.md`, **partly
  fixed 2026-09-04**: the rewritten updater now reads the manifest pin, so
  `--check` is honest, but the `(binary: 2.1.226)` parenthetical still resolves
  the root copy and `bin/` tooling still imports it.
- **Latest reviewed upstream version:** `0.3.268` (SDK), `2.1.268` (Claude Code), `0.154.0` (Codex)
- **Ledger floor:** `0.3.220` (earlier releases are out of scope)
- **Current recommendation:** `0.3.266` was taken this turn — the newest settled
  version, and the `0.3.265`/`0.3.266` pair together, as required. The gate the
  previous two turns placed on it was **disproven by probe rather than fixed**:
  shell-cwd persistence is per process, so the commit-nudge retry (a new
  process) is unaffected. That issue is closed as `wontfix`
  (`issues/closed/bugs/2026-09-09-agent-shell-cwd-now-persists-across-turns.md`).
  Still open and **important**:
  `issues/bugs/2026-09-10-resumed-sessions-drop-appended-system-prompt.md` —
  resumed chat threads and agents run without beebox's system prompt, which
  `0.3.266` does not change. Pending: `0.3.267` (~44h), `0.3.268` (~19h; see
  its TodoWrite change), Codex `0.154.0` (~40h).

## Codex 0.153.4 — applied 2026-09-05 (boxholder asked for it now)

Bumped ahead of the two-day window at the boxholder's request, once the
default-model decision was made. Verified: beebox typecheck, the Codex
doctests, and the deploy gate's `codex plugin --help`.

## Codex default model — decided 2026-09-05

The boxholder decided Astra as Codex's bundled default is fine; beebox keeps
inheriting the binary's default. `0.153.4` is not held back: take it when it
settles (`issues/closed/decisions/2026-09-04-codex-default-model-becomes-astra.md`).

## Release ledger

### 0.3.268 / Claude Code 2.1.268 — pending (published 2026-09-10T18:43Z, ~19h at this turn)

- **The change that reaches beebox's defaults:** *"Changed the task-tracking
  tools (TaskCreate/Get/Update/List, TodoWrite) to be default tools only on
  Claude 3.x, Opus 4.0–4.7, Sonnet 4.0–4.6 and Haiku 4.5; elsewhere list them in
  `tools`/`allowedTools`."* beebox's `opus`, `sonnet` and `fable` resolve to
  `claude-opus-5`, `claude-sonnet-5` and `claude-fable-5-1`
  (`src/shared/model-ids.ts`), all outside that list, and neither `run.ts` nor
  `claude-chat.ts` passes `tools` or `allowedTools` — so on `0.3.268` Claude box
  agents and chats on the default models lose TodoWrite unless beebox opts it
  back in. beebox only renders and reports it ("Updated task list" in chat
  activity, `known-tools.ts`, the session report, and Codex plan items mapped onto
  a synthetic TodoWrite). Filed as a decision:
  `issues/decisions/2026-09-11-todowrite-leaves-default-tools-on-current-models.md`.
- **Also relevant in 0.3.268:** `resume_reason` on the automatic re-run of a
  turn a host restart interrupted — beebox restarts box children, so this labels
  a situation it produces; `user_message_uuid` on that re-run now names the
  turn's last user prompt. Additive for beebox: `result_index`, `local_command`,
  `hold_on_cache_impact` on `reloadPlugins`, `kind` in context-usage rows,
  `defaultToNo`/`suppressAlwaysAllowRule` hints to `canUseTool` (beebox has no
  `canUseTool`), `setModel()` confirming unknown ids with the API, and
  `pending_permission_requests` always present on `initialize`.
- **Harness, live now** (the installed CLI is already 2.1.268):
  - *"Fixed deny and ask permission rules on symlinked directories … not
    applying when a path was given by its real location, and Bash commands
    ignoring deny rules written on a symlinked path spelling."* That is
    `manual-tests`' `Read(private-issues/**)` exactly — written on the symlinked
    spelling of a symlink-mounted repo. With 2.1.251's Grep/Glob fix, the rule
    now holds on every tool route this ledger has tracked, apart from the
    Bash-argument coverage that 2.1.260 reverted. A sibling fix covers a deny
    rule skipped when an `env -C` or `eval` shared the line.
  - WebFetch now fails after 300 seconds instead of hanging on a server that
    never finishes — box agents use WebFetch, and a hung fetch is a hung turn.
  - A busy loop pinning a CPU core in long-running idle sessions, and a running
    session silently switching to the org default model when another process
    refreshed a stale model-access entry — the concurrency family again.
  - `--continue`/`--resume` no longer waits for SessionStart hooks before showing
    the conversation.
- **Checked and clear:** `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS` was not
  extending SessionEnd hooks that lack a per-hook `timeout`; this repo's
  SessionEnd hook sets `"timeout": 300`. PermissionRequest hooks not firing in
  `--print` mode — no such hook here. `excludeDynamicSections` prompt-cache fix —
  beebox does not use it. The fix for third-party `ANTHROPIC_BASE_URL` endpoints
  failing every turn since 2.1.265 (an Artifact-tool schema regex they reject)
  touches beebox's `BBX_LOG_PROMPTS=1` path only if the local prompt-logger
  proxy rejects that schema; it forwards to Anthropic, so it should not —
  unverified, and debug-only.
- **Action:** Settled path; takeable 2026-09-12 at the earliest — decide the
  TodoWrite issue first.
- **Sources:** [Agent SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#03268), [Claude Code 2.1.268](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21268)

### Codex 0.154.0 — pending (published 2026-09-09T22:40Z, ~40h at 2026-09-11; still unsettled)

The first minor-version Codex release since the pin; `@openai/codex-sdk`
published `0.154.0` in lockstep.

- **The one removal, checked clear:** *"The deprecated `codex mcp-server` entry
  point is no longer available."* Nothing in `bin/`, `beebox/src`,
  `beebox/plugins`, `beebox/deploy`, `schedules/` or `.claude/` invokes it.
- **Beebox's plugin install path survives:** `ensure-codex-plugin.ts` drives
  `codex plugin list / marketplace list / add / remove --json`; 0.154.0 changes
  when an existing session *picks up* plugin tools, skills and hooks after an
  out-of-process upgrade (now it does), not the subcommands. The deploy gate's
  `codex plugin --help` will confirm at bump time.
- **Consistent with the default-model decision:** *"fresh sessions and forks
  respect server model defaults unless explicitly overridden"* — beebox leaves
  the model unset on an unconfigured box and inherits, as decided on 2026-09-05.
  The model behind `codex-default` in the usage rows can now move with the
  server as well as with the pin, which strengthens
  `issues/code-quality/2026-09-05-codex-usage-records-sentinel-not-model.md`.
- **Security, relevant to a box cwd:** startup no longer runs workspace-controlled
  helpers before trust is established. beebox runs Codex with the box as the
  working directory, and box content is partly not authored by the boxholder.
- Also: experimental `--worktree` / `/worktree` (Codex worker sessions here get
  their worktrees from `bin/workstreams create`, not Codex), inline answers to
  questions mid-work, and Windows background-server sharing.
- **Action:** Settled path; takeable 2026-09-11, with the deploy gate.
- **Sources:** [Codex rust-v0.154.0](https://github.com/openai/codex/releases/tag/rust-v0.154.0)

### 0.3.267 / Claude Code 2.1.267 — pending (published 2026-09-09T18:28Z, ~20h at this turn)

- **The item that matters, tested rather than read:** *"Changed `systemPrompt`
  recording to default on for custom prompts and appends (a mid-session prompt
  change takes effect at the next compaction); pass `snapshot: false` to keep
  per-request rendering."* "Default on" implies it was off, and beebox has two
  paths that build their append only for a fresh session and send nothing on
  resume — `ChatThreadSession` (`thread.ts:145`) and `runAgent` (`run.ts:264`,
  which carries reactor sessions, procedure review retries and the commit-nudge
  retry). A two-turn probe settled it: an append naming a codename on turn 1,
  a resumed turn 2 asking for the codename.

  | SDK | resume passes | turn-2 answer |
  |---|---|---|
  | `0.3.263` (pinned) | no `systemPrompt` option | `NONE` |
  | `0.3.263` (pinned) | `append: ""` — chat threads' exact shape | `NONE` |
  | `0.3.267` | no `systemPrompt` option | `ZEBRA-7` |

  So **on the current pin, every resumed chat thread runs without
  `CHAT_THREAD_MODE`** — the `<chat-response>` contract, "keep each response
  SHORT", "Do NOT use Markdown", "Do NOT edit the thread file" — and without
  timezone context; only the one-line reminder at `thread.ts:331` survives, and
  its comment blames compaction for a loss that is actually the resume. Resumed
  agents lose their first-invoke prompt the same way. The **main web chat is not
  affected**: `start.ts`'s `buildBackendStartOptions` passes its full prompt on
  every start. Filed as
  `issues/bugs/2026-09-10-resumed-sessions-drop-appended-system-prompt.md`
  (important).

  This is a long-standing beebox bug that `0.3.267` happens to paper over, not a
  regression, and it is why the release is **not act-now**: the fix that works on
  every pin is beebox passing the prompt on resume, as `start.ts` already does.
  Taking `0.3.267` early would also pull in the unsettled `0.3.265` cwd change
  before its own issue is fixed. And `0.3.267` changes the web chat for the
  worse in one respect — its re-passed prompt legitimately varies (timezone,
  landmark note), and under recording those changes wait for a compaction —
  which is why the issue proposes deciding `snapshot` once the pin gets there.
- **Harness, same change on the CLI side:** *"subagents and sessions started with
  `--system-prompt` or `--append-system-prompt` now record the system prompt and
  tool definitions once instead of re-rendering them"*, with
  `--system-prompt-snapshot off` to opt out. The schedule runner passes
  `--append-system-prompt-file schedules/<name>/prompt.md`
  (`bin/lib/launch-headless.sh:67`) on every run, and exactly one schedule —
  this one — is `session: persistent`, resumed daily. Once the installed CLI
  reaches 2.1.267 (it is on 2.1.265 at this turn), **an edit to
  `schedules/sdk-update/prompt.md` will not reach this monitor until its session
  compacts**. Low-frequency, but silent; passing
  `--system-prompt-snapshot off` for persistent sessions would restore it.
  Recorded here rather than filed.
- **Other 2.1.267 items in scope:** resuming a transcript over 5 MB no longer
  drops parallel tool calls and their hook output (this monitor's own session is
  far past 5 MB, and beebox resumes long chat threads); `-p --resume` after a
  slash command no longer inserts a spurious "Continue from where you left off."
  turn (the runner's persistent-session shape); `effort:` frontmatter on
  commands, skills and subagents is honored on pinned-effort models; managed
  `allowedHttpHookUrls` and friends now fail closed when unreadable; a
  backslashed marketplace path could bypass containment (the plugin-path fix's
  sibling); and a long run of prompt-cache fixes around tool lists changing
  between a session and its resume.
- **Additive (SDK):** browser-SDK SSE transport helpers
  (`getCcrEvent`, `getSseLastSequenceNum`, catch-up options) — beebox does not
  use the browser SDK.
- **Action:** Settled path; takeable 2026-09-12, **after** the
  `0.3.265` cwd issue lands, since `0.3.267` includes it.
- **Sources:** [Agent SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#03267), [Claude Code 2.1.267](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21267)

### 0.3.266 / Claude Code 2.1.266 — APPLIED 2026-09-11 with 0.3.265 (published 2026-09-08T23:32Z)

- **Upstream:** A single fix, and it is a repair of the release directly below
  it. `2.1.265` started honoring the undocumented `CLAUDE_CODE_USE_GATEWAY`
  environment variable on its own, where it had previously been ignored unless
  `ANTHROPIC_BASE_URL` **and** `ANTHROPIC_AUTH_TOKEN` were both set. Setups that
  had it alongside an API key, an `apiKeyHelper`, or custom auth headers failed
  **every request** with "Not signed in to the Cloud gateway". `2.1.266` makes
  the variable inert again; no configuration change needed.
- **Beebox applicability:** Not exposed, but worth knowing why rather than
  assuming. `CLAUDE_CODE_USE_GATEWAY` appears nowhere in this repo, and it is not
  in `script-env-allowlist.ts`, so a box agent could not inherit it from the
  boxholder's shell even if it were set there. beebox *does* set
  `ANTHROPIC_BASE_URL` on one path — `BBX_LOG_PROMPTS=1` points agent runs at the
  local prompt-logger proxy (`src/core/agent/prompt-logger.ts`) — which is the
  same family of configuration the regression hit, so this is the shape to
  remember if gateway env ever enters the picture.
- **Action:** Settled path. **Pair it with `0.3.265`:** they are one change and
  its repair, published four and a half hours apart. `0.3.265` settles first by
  the clock, and taking it alone would pin the broken half.
- **Sources:** [Claude Code 2.1.266](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21266)

### 0.3.265 / Claude Code 2.1.265 — APPLIED 2026-09-11 with 0.3.266 (published 2026-09-08T19:05Z; the cwd concern below was DISPROVEN on 2026-09-11)

- **The item that changes beebox's behavior:** *"Fixed non-interactive sessions
  (`-p` with stream-json input, Agent SDK, cloud sessions) resetting the shell
  working directory at each new user message; a `cd` now persists across turns."*
  Every beebox agent and chat thread is a multi-turn SDK session started with
  `cwd: boxRoot`, so until now the agent's shell returned to the box root at
  every message and from `0.3.265` it does not.
  The landing spot is `ensureAgentCommitted` (`src/core/agent/commit.ts`), whose
  two halves stop agreeing about where they are: it checks the tree with
  `getStatus(boxRoot)` — a child process handed the box root explicitly — but
  **resumes the agent session** to do the committing, through a shell that may be
  parked in a subdirectory from an earlier turn. A pathspec-scoped `git add`
  there stages one subtree, `getStatus(boxRoot)` still sees changes, and the
  fallback commit fires; a shell parked outside the box points `git` at another
  repository entirely. Filed as
  `issues/bugs/2026-09-09-agent-shell-cwd-now-persists-across-turns.md`, to be
  fixed **before** the pin crosses rather than after — the pin is `0.3.263`
  today, so nothing is reachable yet.
  **Corrected 2026-09-11 — the paragraph above is wrong, and the issue is closed
  as `wontfix`** (now `issues/closed/bugs/`). A probe on `0.3.266` showed
  persistence is **per process**: a `cd` into `work/sub` survived to a second
  user message in the same process, but a resumed session in a new process —
  which is how `ensureAgentCommitted` runs its nudge — started back at the
  configured cwd, as it does on `0.3.263`. The "parked outside the box" case is
  not reachable on either version, because Claude Code resets a shell that
  leaves the working directory. What the release changes is warm multi-message
  runs, where a subdirectory `cd` now persists; that is benign here.
  Note what does *not* break: chat links and embeds, because
  `src/core/chat/session/prompts.ts:92` already tells agents they resolve from
  the box root "never from your working directory". The assumption this release
  invalidates was already documented here as not holding.
- **Other runtime-relevant fixes:** resume after the previous process died
  mid-tool no longer rewrites the last prompt and now keeps the interrupted tool
  call marked as interrupted (beebox resumes chat threads after box-child
  restarts, so this is the shape it hits); SDK sessions no longer occasionally
  require re-login when a session is closed while its token refreshes — worth
  naming because a spurious re-login is exactly the symptom that invites
  credential-fiddling; and tool results saved to disk are now capped at 1 GB with
  the truncation stated in the preview, the fifth release in the output-volume
  family.
- **Harness:** *"Fixed Claude Code's own git status and diff probes running clean
  filters configured by a nested repository inside the working tree."* This
  checkout has exactly that shape — `private-issues` is a separate repository
  symlink-mounted inside it. Also a plugin-path containment fix (a backslash in a
  plugin path bypassed the symlink check on macOS and Linux); beebox's local
  plugin path has no backslash.
- **Additive:** `user_message_uuid` / `user_message_uuids` now also appear on
  synthetic turns, on turns Claude Code starts itself such as a resume, and on
  results for turns that sent no API request; the field is now set on the first
  reply after each change of the message being answered rather than once per
  turn. beebox still consumes neither.
- **Action:** Applied 2026-09-11 together with `0.3.266` (~67h and ~63h old),
  on the settled path. `pnpm -C beebox test`: **10,037 pass, 0 fail**.
  `sdk-steering-probe`: all four steering behaviors pass — worth noting here,
  since the probe drives several user messages through one process, which is
  exactly where this release's cwd change applies.
- **Sources:** [Agent SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#03265), [Claude Code 2.1.265](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21265)

### 0.3.264 / Claude Code 2.1.264 — never published

`0.3.264` has a parity section in the SDK changelog; npm has no such version and
Claude Code has no `2.1.264` section. The fifth such gap in under three weeks
(`0.3.244`, `0.3.249`, `0.3.253`–`0.3.256`, `0.3.262`).

### 0.3.263 / Claude Code 2.1.263 — APPLIED 2026-09-09, nothing to assess (published 2026-09-06T02:09Z)

- **Upstream:** The SDK entry is parity-only, and 2.1.263 says only "Bug fixes
  and reliability improvements". Checked the tagged `v2.1.263` changelog as well
  as `main`'s — the lesson from 2.1.247, when a section was missing from `main`
  and present at the tag — and it carries the same one line. Genuinely opaque,
  not merely unpublished-yet.
- **`0.3.262` / `2.1.262` never shipped:** the SDK changelog has a `0.3.262`
  parity section, but npm has no such version, and Claude Code has neither a
  `2.1.262` section nor a tag. The fourth such gap in two weeks
  (`0.3.244`, `0.3.249`, `0.3.253`–`0.3.256`).
- **Beebox applicability:** Nothing assessable on either channel.
- **Action:** Applied 2026-09-09 on the settled path (~84h old), the newest
  settled version. An opaque release carries no reviewed benefit, but staying
  current is the point of the lane — and the alternative was holding at
  `0.3.260` while two more releases stacked up behind it.
  `pnpm -C beebox test`: **9,672 pass, 2 fail**, both in
  `test/frontend/lib/ui-scan/annotations.doctest.md`, which reproduces in
  isolation and fails identically at the previous `0.3.260` pin — a `main`-side
  red, filed as
  `issues/bugs/2026-09-09-ui-scan-annotations-table-lists-two-absent-ids.md`
  because the latest `full-suite` run classified itself as an environment
  failure and filed nothing. `sdk-steering-probe`: all four steering behaviors
  pass.
- **Sources:** [Claude Code 2.1.263](https://github.com/anthropics/claude-code/blob/v2.1.263/CHANGELOG.md#21263)

### Codex 0.153.1 – 0.153.4 — APPLIED 2026-09-05 by the boxholder; the first Codex releases this ledger reviewed

All four are GPT-6-Astra plumbing, published between 2026-09-03T21:09Z and
2026-09-04T23:31Z, and all four were inside the two-day window at this turn
(~31h, ~29h, ~9h, ~5h). `@openai/codex` and `@openai/codex-sdk` publish in
lockstep and beebox pins both at the same version, so they move together.

- `0.153.1` — configure Astra through the API "without changing the default
  model or showing it in the model picker".
- `0.153.2` — corrects the Astra Fast tier description from "1.5x" to "2x
  speed, increased usage"; display text only.
- `0.153.3` — adds GPT-6-Astra to the Amazon Bedrock catalogs (Mantle and
  Runtime global/US routes), plus a correction to Astra's guidance for
  asynchronous clarification questions.
- **`0.153.4` — "Fixed Astra's visibility in the bundled model picker and made
  it the bundled default when no model is explicitly configured."**

**Beebox applicability — the fourth one moves a default beebox actually rides.**
`codex-sdk-session.ts:149` includes the model only when a caller supplies one
(`...(options.model === undefined ? {} : { model: options.model })`), and
`codex-chat.ts` passes `opts.model` straight through, so a box whose Codex chat
configures no model runs on whatever the pinned binary defaults to. Taking
`0.153.4` therefore moves those chats onto GPT-6-Astra — different model,
different behavior, different price — with no beebox-side change. And it would
be close to invisible afterwards: `codex-chat.ts:185` writes per-turn usage as
`model: opts.model ?? "codex-default"`, so the ledger records the same string
before and after the switch. Filed as
`issues/decisions/2026-09-04-codex-default-model-becomes-astra.md`.

The same default governs `.claude/skills/cross-model/`, which runs the Codex CLI
for adversarial reviews; note that the skill invokes `codex` from `PATH` (a
global install, "verified around 0.146.x" per its own text) rather than the
workspace pin, so its model default is not governed by this pin at all — a
separate inconsistency worth knowing about, not filed.

- **Action:** Resolved the day after this entry was written, and by the person
  the decision belonged to. The boxholder decided that inheriting the binary's
  default is fine, closed the decision issue, and pinned `0.153.4` ahead of the
  settling window on that basis (`6ee370620`), verified with beebox typecheck,
  the Codex doctests, and the deploy gate's `codex plugin --help`. The
  "deliberately rather than incidentally" this entry asked for is exactly what
  happened. One thread outlived the decision and is carried separately:
  `codex-chat.ts:185` still records usage as `model: opts.model ??
  "codex-default"`, which matters *more* under a policy of inheriting, since the
  model behind that sentinel now changes whenever the pin moves —
  `issues/code-quality/2026-09-05-codex-usage-records-sentinel-not-model.md`.
- **Sources:** [Codex releases](https://github.com/openai/codex/releases) —
  `rust-v0.153.1` through `rust-v0.153.4`

### 0.3.261 / Claude Code 2.1.261 — pending (published 2026-09-04T17:56Z, ~11h at this turn)

- **Upstream (SDK):** `pluginDelivery: 'initialize'` sends `plugins` over stdin
  so the launch command line stops growing with the plugin count (it fixes
  Windows start failures); and a fix for `query()` throwing "Object not
  disposable" in runtimes without a native `Symbol.dispose` — Node ≤22 `vm`
  contexts (Jest's `node` environment, vitest `vmThreads`/`vmForks`) and Node
  <18.18.
- **Beebox applicability (runtime):** Neither bites. beebox passes exactly one
  local plugin in `run.ts`, so the command line is nowhere near a length limit,
  and the deployment is macOS and Linux, not Windows. The `Symbol.dispose` fix
  needs an old Node or a `vm`-based test runner; this repo is on Node 24 and
  runs tap, which does not sandbox tests in `vm` contexts. Recorded because the
  second one is the kind of thing that would show up as an inexplicable test-only
  failure if either of those changed.
- **Beebox applicability (harness), from 2.1.261:**
  - *"Fixed SDK and cloud sessions ignoring a Stop or interrupt sent just after
    the first prompt, before the turn had started; the turn now stops instead of
    running to completion."* This is a boxholder-visible chat bug: press stop
    early enough and the turn kept going. beebox's stop path is `interrupt()`
    (`chat/session/index.ts:374`), so it was the caller on the wrong side of
    this. It joins the interrupt-semantics material in
    `issues/decisions/2026-08-25-chat-stop-and-background-subagents.md`.
  - *"Fixed resuming a session losing hook output and other context around
    parallel tool calls, which changed the resumed request."* beebox resumes
    sessions constantly and registers hooks on both routes (the `hooks` option
    and the local plugin), so a resumed turn silently differing from the
    pre-resume one is squarely in scope.
  - *"Fixed sustained high CPU usage when a background agent could not be
    resumed and its wake-up was retried in a tight loop."* A tight retry loop on
    a laptop that also runs the boxholder's own sessions is worth having fixed.
  - *"Added `bashOutputMaxChars` and `taskOutputMaxChars` settings to raise how
    much command and background-task output Claude receives inline before it is
    saved to a file, up to 128K characters."* The fourth release in the
    output-volume family (2.1.247, 2.1.248, 2.1.252). These are the knobs, if a
    box agent ever needs more of a long command's output inline.
  - *"Fixed `claude -p --resume <file>` adopting a malformed session ID recorded
    in the transcript; it now resumes under a fresh session ID."* This
    schedule's own shape — `session: persistent`, a minted id resumed each run.
  - Also: `--append-subagent-system-prompt-file` for oversized subagent prompts,
    `/skill-doctor` for finding unused skills and what they cost in context, and
    a dangerous-`rm` prompt that now catches `rm -rf` on positional parameters
    and inside double-quoted `sh -c` scripts.
- **Action:** Settled path; takeable 2026-09-06.
- **Sources:** [Agent SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#03261), [Claude Code 2.1.261](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21261)

### 0.3.260 / Claude Code 2.1.260 — APPLIED 2026-09-05 (published 2026-09-03T22:33Z)

**Amends the previous turn's entry: 2.1.259's Bash deny-rule fix was reverted.**

> *"Reverted the 2.1.259 change applying `Read()` deny rules to Bash arguments;
> it denied `npm run build` under a `Read(./**/build/**)` rule in every mode and
> made `cd … && grep` prompt even in auto mode."*

The `0.3.259` entry recorded that fix as closing the Bash route to
`Read(private-issues/**)` in the `manual-tests` schedule. One release later it is
gone: **the Bash route is uncovered again**, and there is now good reason to
think it will stay that way, since the attempted fix broke ordinary commands
badly enough to be pulled within a day. What stands is **2.1.251's Grep/Glob
symlink fix**, which is the one that mattered here — `private-issues` is
symlink-mounted and the triager has both tools. The remaining Bash exposure is
the narrow one the previous entry already described: `manual-tests` allowlists
Bash down to two `bin/schedules` commands, so the deny rule is a second layer
over an allowlist that does the real work. Nothing to do; recorded because a
reader of the `0.3.259` entry alone would believe a guard exists that does not.

Other permission-rule fixes in 2.1.260, checked against the rules this repo
actually passes (`schedules/*/schedule.yaml`):

- *"Fixed `Edit`/`Write`/`Read` permission rules whose path contains parentheses
  being dropped as invalid or ignored by the Bash sandbox, which left
  'read-only' folders writable."* A dropped rule is a silent one, so this is
  worth a real check rather than a glance: no rule here has parentheses **in the
  path** — `Read(private-issues/**)`, `Edit(beebox/src/**)`,
  `Edit(issues/bugs/**)` and the rest use parentheses only as rule syntax.
  Clear.
- *"Fixed one file permission rule with an uncompilable pattern (e.g. an
  unclosed `[`) making every file edit fail."* Every pattern here is a plain
  `**` glob. Clear.
- *"Glob/Grep: Fixed the search path being probed on disk before the permission
  check."* Same tools and same rule as the symlink fix above; the leak is
  existence-of-path rather than contents, and it is now decided in the right
  order.

- **"task output swap refused" has a second trigger, and it is not Mac-specific.**
  *"Fixed intermittent `task output swap refused` errors when many sessions
  share a project directory."* Two turns ago this ledger probed `0.3.251` for
  the macOS variant of this error and found it did not reproduce — but that
  probe ran **one** session, which by construction could not have surfaced this
  trigger. Many sessions sharing a project directory is an ordinary state here:
  the project directory is keyed on cwd, so every chat thread in one box shares
  one, as does every session in a given worktree. And this entry carries no "on
  some Macs" qualifier, so the Linux prod host is not excluded. Searched for
  real occurrences before treating it as urgent — `~/.claude/projects`
  transcripts outside this workstream, `~/src/schedule-runs`, box logs and the
  deploy logs — and found none; the only hits are this monitor's own writing
  about the error. Not act-now on that basis, but this is the item to remember
  if Bash calls start failing intermittently in a busy box: the fix is in
  `2.1.260`, and the current pin (`0.3.258` → CLI 2.1.258) does not have it.
- **Structured output gets diagnosable.** *"Changed
  `error_max_structured_output_retries` results to append the last
  StructuredOutput tool error; validation errors now name the offending key,
  allowed values, and actual length or count."* beebox uses structured output —
  `run.ts` passes `outputFormat: { type: "json_schema", schema }` whenever a
  caller supplies `outputSchema` — and until now a schema the model could not
  satisfy produced a retry-cap error with nothing in it. This is the kind of
  change that only shows its value the day something breaks.
- **Additive, no action:** `user_message_uuid` on `thinking_tokens` system
  messages; four `first_*_ms` latency fields on the success result for remote
  sessions; `rewindFiles()` now failing instead of reporting success when
  checkpoint backups are missing (beebox does not call it). `rate_limit_event`
  now re-emits about every 30 seconds during an exceeded window — beebox drops
  that message type in `adaptSdkMessage`, so the extra frames change nothing
  here.
- **Harness, worth knowing:** a `/diff` panel beside the conversation in
  fullscreen; a likely-cause hint for prompt-cache misses in `/cost`; `/advisor`
  in headless and SDK sessions; and two Fable 5.1 fixes (the `/model` picker not
  offering it, and prompt caching not covering context attached after tool
  results, so it was re-sent uncached every tool-call turn).
- **Action:** Applied 2026-09-05 on the settled path (~54h old), the newest
  settled version. This is the pin that carries the "task output swap refused"
  fix for many sessions sharing a project directory, so the item this ledger
  flagged as the one to watch is now closed by the pin rather than only by luck.
  `pnpm -C beebox test`: **9,176 pass, 0 fail**. `sdk-steering-probe`: all four
  steering behaviors pass.
- **Sources:** [Agent SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#03260), [Claude Code 2.1.260](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21260)

### 0.3.259 / Claude Code 2.1.259 — APPLIED 2026-09-04 (published 2026-09-02T21:22Z; its Bash deny-rule fix was REVERTED in 2.1.260 — see above)

**This entry corrects two earlier ones.** The 2.1.251 entry concluded that
"nothing here runs with permission enforcement on", having searched
`.claude/settings.json`, `beebox/.claude/settings.json`,
`.claude/settings.local.json` and the user-level settings for `deny` rules and
found none; the 2.1.257 entry repeated it. The search looked in the wrong place.
**Permission rules in this repo are passed on the command line by the schedule
runner, not written in settings files** (`schedules/*/schedule.yaml` →
`bin/schedules-agent-command`), and two live schedules use them:

- **`manual-tests`** runs `permissionMode: dontAsk` with an explicit
  `tools: [Read, Grep, Glob, Edit, Write, Bash]`, an `allowedTools` allowlist,
  and `disallowedTools: ["Read(private-issues/**)", "Edit(private-issues/**)"]`.
- **`tour-check`** runs `bypassPermissions` but still passes
  `disallowedTools: ["Edit(beebox/src/**)", "Write(beebox/src/**)"]` — its own
  config calls this "a guard against the ordinary path, not a sandbox".

So the deny-rule fixes this ledger has been filing under "enforcement we do not
use" have been landing on a real rule all along, and one of them lands hard:

- **2.1.251** — *"Fixed Grep and Glob not applying `Read(...)` deny rules to
  files reached through a symlinked search path."* `private-issues` **is** a
  symlink: the private repo is symlink-mounted into the checkout. The
  `manual-tests` triager has `Grep` and `Glob` in its tool list and
  `Read(private-issues/**)` denied, which is exactly the combination that fix
  describes. Before 2.1.251 that deny did not hold for those two tools through
  the symlink. Nothing left the machine either way — a triager reading private
  issue text pulls it into that session's context, and its only write targets
  are `issues/` and two `bin/schedules` commands — but the guard was not the
  guard it was written to be. The installed CLI is 2.1.259, so it holds now.
- **2.1.257** — Bash `Read()`/`Edit()` deny rules did not apply to `< file`
  redirects or reader commands like `tac` and `egrep`.
- **2.1.259** — *"Fixed Bash `Read()` deny rules not covering files given as
  option values (`--ignore-revs-file=.env`, `-f.env`, `@file`), `git diff`/`git
  grep` file operands, or `cd DIR && cat FILE` compounds."* Same rule, the Bash
  route. Exposure here is narrow because `manual-tests` also allowlists Bash
  down to two `bin/schedules` commands, so an arbitrary `cd private-issues &&
  cat …` would not have been permitted to run in the first place — the deny rule
  is the second layer, and it is the layer that was porous.

The rest of 0.3.259 and 2.1.259:

- **`permissionPrompts: 'none'` / `--permission-prompts none`** (SDK and CLI):
  anything that would prompt is auto-denied, while the active permission mode
  keeps deciding. Aimed exactly at "unattended headless hosts", which is what
  every schedule here is. The runner passes `--permission-mode dontAsk` for
  `manual-tests` today; this flag is the orthogonal belt to that mode's braces,
  and 2.1.259 separately fixes *"remote and scheduled sessions doing nothing
  after a connector-tool permission prompt was approved while the session was
  paused"*, which is evidence that prompts do reach scheduled sessions by paths
  a mode does not cover. A hang here reads as a bailed run with no explanation.
  Filed as `issues/code-quality/2026-09-02-unattended-schedules-permission-prompts-none.md`.
- **`user_message_uuids`** (plural) beside `user_message_uuid` on a turn's first
  reply frame and result — every user message the turn answered, so a reply to
  several *merged* messages can be matched to each. beebox merges queued sends
  (the chat session's queue, and `accepted-messages.ts`'s uuid reconciliation),
  so this is the field that would let a reply be attributed to each merged
  message rather than the first. Nothing broken today; recorded next to the
  0.3.246 `user_message_uuid` note as the same thread of work.
- **Concurrency, and this machine's shape.** *"Fixed concurrent sessions
  silently reverting each other's `~/.claude.json` changes — workspace trust no
  longer resets and MCP/project state is no longer lost when running many
  sessions at once."* Many concurrent Claude Code processes is this machine's
  ordinary state (worktree sessions, box agents, schedule runs), so this is the
  second release in a row fixing a concurrency defect that this repo's usage
  pattern is unusually likely to hit (2.1.248's token-refresh lock was the
  first).
- **Another permanent-wedge fix:** *"Fixed a conversation whose thinking was
  rejected once being rejected again on every later turn"* — fourth in the
  family this ledger has tracked (2.1.251's "text content blocks must be
  non-empty", 2.1.258's user-message variant, 2.1.259's thinking rejection).
  Chat threads are the surface that would show it.
- **Resume and attachments:** *"Fixed `--resume` failing (and `--continue`
  opening an empty conversation) when a saved session contains an attachment
  entry with no payload."* beebox chat sends image blocks and resumes sessions
  constantly, and payload-less attachment entries are a shape this repo has
  reasoned about before (the closed multi-MB payload-stripping work). beebox
  does not rewrite Claude Code's transcripts — `history.ts` writes only beebox's
  own history file inside the box — so it is not the producer of such entries,
  but it is the consumer that a failed resume would strand.
- **Worktree isolation, relaxed again:** hook-created worktrees were being
  refused on machines where `git rev-parse` fails with an unexpected message,
  and worktree-isolated sessions were refusing common Bash loops, xargs
  pipelines and launcher-wrapped commands. Hook-created worktrees are precisely
  how this repo makes them (`WorktreeCreate` → `bin/workstreams create`); third
  release running in this family, all in the relaxing direction.
- **Checked and clear:** *"Fixed frontmatter `model:` on custom commands and
  skills being ignored in interactive sessions"* — no skill or command here sets
  `model:` in frontmatter. `.claude/agents/finish.md` does set `model: sonnet`,
  but agent definitions are a different path and were already honored (2.1.248
  spelled out that precedence). `managedMcpServers` and `allowedMcpServers`
  changes need managed settings and MCP servers; this repo has neither.
- **Action:** Applied 2026-09-04 on the settled path (~55h old), the newest
  settled version. `pnpm -C beebox test`: **8,617 pass, 0 fail** — which also
  clears the previous turn's `test/dev/launch-session.doctest.md` red; it was a
  `main`-side failure and `main` has since fixed it. `sdk-steering-probe`: all
  four steering behaviors pass on the first run this time.
- **Sources:** [Agent SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#03259), [Claude Code 2.1.259](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21259)

### 0.3.258 / Claude Code 2.1.258 — APPLIED 2026-09-03 (published 2026-09-01T22:24Z)

- **Upstream:** SDK is parity-only. 2.1.258 is two fixes: *"Fixed Claude Code
  failing to launch on macOS 12 (Monterey), a regression introduced in
  2.1.255"*, and *"Fixed remote and scheduled sessions failing with 'user
  messages must have non-empty content' after a re-sent permission approval
  could not be applied."*
- **Beebox applicability:** The Monterey fix does not apply — this machine runs
  a current macOS and the prod server is Linux. It is worth noting for a
  different reason: **2.1.255 was never published to npm** (see the gap entry
  below), yet it was live enough to break launches on an OS version and need a
  repair three releases later. The "non-empty content" fix is the third in a
  family this ledger has now tracked across three releases (2.1.251's *"text
  content blocks must be non-empty"* chat wedge, 2.1.258's user-message
  variant); the scope here is Claude Code's own remote and `/schedule` sessions,
  not this repo's `bin/schedules` runs, which are plain CLI invocations.
- **Action:** Applied 2026-09-03 on the settled path (~53h old), the newest
  settled version. It carries `0.3.257` with it, so the
  `background_tasks_changed` half of
  `issues/bugs/2026-08-26-chat-task-strip-edge-pairing-and-ambient.md` is no
  longer blocked on the pin — that issue's stated requirement was `0.3.257`+.
  **Verification took more than one pass, and both wobbles were the gates, not
  the release.** `sdk-steering-probe` failed its first scenario on the first run
  ("timed out before the steer answer arrived") and printed its
  do-not-ship verdict; three consecutive re-runs on this same pin passed
  cleanly, so the timeout was the probe's own timing sensitivity rather than a
  steering change — filed as
  `issues/code-quality/2026-09-03-steering-probe-timeout-reads-as-behavior-change.md`,
  because a gate that says "do not ship" for an inconclusive run is a gate whose
  verdicts get discounted. `pnpm -C beebox test` came back **8,524 pass, 6
  fail**, of which `test/hub/hub-scan-token.doctest.md` hit a 303-second timeout
  under load and passes in 3s on its own, and
  `test/dev/launch-session.doctest.md` fails **reproducibly** — but it fails
  identically at the previous `0.3.252` pin (checked by setting the bump aside,
  reinstalling, and re-running), so it is a `main`-side red, not this bump's.
  It expects a launched codex session to read as `whileRunning: "active"` and
  gets `"none"`.
- **Sources:** [Claude Code 2.1.258](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21258)

### 0.3.253 – 0.3.256 — never published (four versions, both channels)

The SDK changelog carries sections for `0.3.253`, `0.3.254`, `0.3.255` and
`0.3.256`, each claiming parity with the matching Claude Code version. **None of
the four exists on npm**, and Claude Code's `2.1.253`–`2.1.256` have no
changelog sections and no git tags. This is the second such gap in a week
(`0.3.249` and `0.3.244` before it), but the first to swallow four consecutive
versions on both channels at once.

They were not merely unpublished, either: `2.1.258` fixes "a regression
introduced in 2.1.255", so at least one of the four shipped somewhere before
being withdrawn. Nothing to review; recorded so a future turn does not go
looking, and as evidence for how much this train is currently churning — which
is the argument for the two-day settling window continuing to earn its keep.

### 0.3.257 — superseded, included in the 0.3.258 pin (published 2026-09-01T17:15Z)

- **Upstream:** Eleven itemized changes plus parity with 2.1.257 — the first
  substantively itemized SDK release since `0.3.247`. `thinkingTokens` on
  `ModelUsage` (and a fix for `thinking_tokens` reporting 0);
  `tool_use_result.resourceLinks` and `task_notification.resource_links` for MCP
  tool results; four `mcp_*` control fixes; Agent tool calls now emitting the
  periodic `tool_progress` heartbeat; a browser-bundle fix for engines without
  native `Symbol.dispose`; a `detail: 'summary'` option on
  `Query.getContextUsage()`; and two background-task lifecycle fixes.
- **Beebox applicability (runtime) — the two lifecycle fixes are the ones that
  matter, and they land on an open issue.**
  - *"Fixed a background Bash task that is still running when a stream-json
    session ends right after an interrupt (stdin closed) never receiving its
    final `task_notification`."* That is beebox's chat stop path exactly:
    `interrupt()` (`src/core/chat/session/index.ts:374`) and then the run ends.
    A background Bash task started in that turn was losing its `settled`
    bookend **upstream**, and the live task strip has no way to clear a task
    whose bookend never arrives. So this is a live producer of the wedge filed
    in `issues/bugs/2026-08-26-chat-task-strip-edge-pairing-and-ambient.md`,
    not merely an adjacent fix.
  - *"Fixed `-p` giving up on a long-running background subagent without
    actually stopping it, so `background_tasks_changed` kept listing it and
    events for it arrived after its `stopped` notification."* This one is a
    **caveat on that issue's proposed fix**: the level signal the issue
    recommends adopting was itself reporting phantom running tasks before
    `0.3.257`. Adopting it against an older bundled CLI would trade a wedged
    strip for one showing work that is already gone. Both notes were added to
    the issue, with the pin requirement it now carries (`0.3.257`+ for the
    level signal, versus `0.3.247` for `ambient`).
- **Beebox applicability (runtime) — checked and clear.** The Agent-tool
  heartbeat is harmless here: `adaptSdkMessage` drops `tool_progress` outright
  (`src/core/chat/session/messages.ts:254`), so the new frames cannot spam the
  transcript or the strip. The MCP fixes and `resourceLinks` additions do not
  apply — beebox configures no MCP servers and hosts none. The browser-bundle
  fix does not apply: nothing imports `@anthropic-ai/claude-agent-sdk/browser`.
  `thinkingTokens` is additive and beebox reads no usage fields beyond
  duration; `getContextUsage()` is not called.
- **Action:** Never installed on its own — `0.3.258` settled hours later and the
  updater takes the newest settled version, so the pin stepped over it on
  2026-09-03. It arrives all the same, which is what the task-strip issue
  needed.
- **Sources:** [Agent SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#03257)

### Claude Code 2.1.257 — harness; one change to check for, and it is clear here (its repetition of the "no enforcement" claim is CORRECTED in the 0.3.259 entry)

~110 items, the largest release this ledger has covered. Nearly all of it is
interactive UI, provider plumbing (Bedrock/Vertex/Foundry/gateway), VS Code, and
`claude agents` polish that no session here touches. What is worth recording:

- **The one potentially breaking change, checked clear.** *"Changed
  `defaultMode: "bypassPermissions"` in `.claude/settings.json` or
  `.claude/settings.local.json` to be ignored, like `"auto"`; set it in user or
  managed settings, or pass `--permission-mode`."* A project-settings key that
  silently stops taking effect is the shape that breaks unattended sessions
  days later — an unattended session that quietly reverts to prompting simply
  hangs. **`defaultMode` appears nowhere in this repo** (searched all settings,
  scripts and docs), and neither channel depends on it: box agents pass
  `permissionMode: "bypassPermissions"` as a `query()` option
  (`src/core/agent/run.ts`), and worker sessions pass
  `--dangerously-skip-permissions` on the command line. Both routes are
  explicitly still supported. Note for the future: beebox *does* write
  `.claude/settings.json` into boxes (`src/core/install-validation-hooks.ts`),
  so if a validation-hook change ever wants a default permission mode, this is
  the door that closed.
- **Worktree isolation, loosened.** *"Fixed worktree-isolated sessions refusing
  Bash loops, `$VAR` reads, `"$(…)"` and heredocs that never touch git as 'too
  complex to verify that it stays inside the worktree'"*, and *"Fixed sandboxed
  git commands in a linked worktree losing write access to the repository's
  common `.git` directory after `cd` into a subdirectory."* This is the same
  machinery whose 2.1.218 tightening broke `/finish` here for days; both
  entries relax over-refusal rather than tighten, so the direction is safe. They
  apply to natively worktree-isolated sessions, which this repo's managed
  sessions are not.
- **Sleep and long turns.** *"Fixed subagents stopping when a response was cut
  off mid-stream by a computer sleep, dropped connection, or server error; they
  now automatically continue."* The laptop this runs on sleeps, and worker
  sessions spawn subagents; this is the subagent counterpart to 2.1.246's
  main-turn continuation fix.
- **Background-task lifecycle, harness side.** Stopping a background command or
  subagent now tells Claude it happened, stopping a background subagent no
  longer leaves its monitors running, and detached background commands (under
  `timeout` or `setsid`) no longer survive a task stop or a Claude Code exit.
  Same theme as the SDK-side fixes above.
- **Memory:** unbounded growth when non-JSONL data is piped into
  `claude -p --input-format stream-json` (now fails fast), and `claude mcp
  add/remove` exhausting memory on a `.mcp.json` that is a FIFO or device-file
  symlink. Neither path is used here.
- **Security, for the record:** plugins could read outside their own directory
  through a symlinked component path; Bash `Read()`/`Edit()` deny rules did not
  apply to `< file` redirects or reader commands like `tac`; certain `[[ ]]`
  conditionals that zsh parses differently were auto-approved; dismissing the
  Remote Control consent prompt counted as consent. As established in the
  2.1.251 entry, the deny-rule and auto-approval items enforce boundaries no
  session here enables — the Remote Control consent fix is the one that touches
  the boxholder, since worker sessions launch with `--remote-control` by
  default.
- **Action:** Nothing to adjust.
- **Sources:** [Claude Code 2.1.257](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21257)

### 0.3.252 — APPLIED 2026-09-02 (published 2026-08-31T17:08Z; parity with Claude Code 2.1.252)

- **Upstream:** SDK says only "parity with Claude Code v2.1.252". 2.1.252 is
  four fixes, and the first one is the reason this turn did more than read:
  *"Fixed Bash commands failing with `task output swap refused (tasks dir moved
  or linked)` on some Macs."*
- **Why that mattered before the bump:** that error is the fallout of
  `2.1.251`'s *"Changed how Bash command output files are created and read back
  when commands run in the sandbox, so a sandboxed command cannot redirect or
  replace them"* — a hardening item recorded in this ledger one turn ago. So
  `0.3.251`, the version the settled path was about to install, is the version
  that broke Bash for some macOS users, and `0.3.252` is the repair. Box agents
  run Bash constantly, and the local ones run on this Mac, so installing
  `0.3.251` blind risked every Bash call in a local box agent failing. The
  changelog's "some Macs" is not something to resolve by reading.
- **What was actually tested.** A scratch install of `0.3.251` in `/tmp`, driven
  by a small `query()` script with `permissionMode: "bypassPermissions"` (what
  box agents use), asked to run one `echo` through the Bash tool:
  - Plain cwd, inherited `TMPDIR`: tool result `is_error=false`, echo output
    returned, result `subtype=success`.
  - Repeated with the cwd reached through a **symlink** and `TMPDIR` pointed at
    a **symlinked** directory — the "tasks dir moved or linked" shape the error
    names: same clean pass, no `task output swap refused` anywhere in the
    stream.
  Two shapes, no reproduction, so `0.3.251` is safe on this machine and the
  settled path was taken as written. Worth knowing why this machine is probably
  not exposed: nothing here relocates the tasks dir. `beebox/src/core/agent/run.ts`
  builds its child env through `buildScriptEnv`, which touches `PATH` and
  `ANTHROPIC_BASE_URL` and sets neither `TMPDIR` nor `CLAUDE_CODE_TMPDIR`, so
  box agents inherit the ordinary macOS temp dir.
- **The other three fixes.** *"Fixed background task notifications with very
  large failure output (for example git errors on a full disk) making the
  conversation exceed the API request size limit"* — third release running in
  the same family as 2.1.247's megabytes-of-hook-output overflow and 2.1.248's
  unwritable-output-file memory growth, and the cited trigger is one this
  deployment has actually had (the prod server hit 100% of its volume on
  2026-08-04). Box agents commit through git, so a disk-full git error is the
  exact shape.
  *"Fixed Remote Control sessions hosted by Claude Desktop or VS Code stalling
  for minutes after a tool finished when the connection to claude.ai was
  degraded"* — worker sessions launch with `--remote-control` by default
  (`bin/launch-worktree-session`), so this is a real quality-of-life fix for the
  boxholder, though it is harness-side and arrives with the installed CLI rather
  than with the pin. *"Fixed 'always allow' not saving in a project that has no
  `.claude/settings.local.json` yet"* — not applicable; nothing here runs with
  permission prompts, per the 2.1.251 entry below.
- **Action:** Applied 2026-09-02 on the settled path (~57h old), the newest
  settled version — the take this entry called for two turns earlier.
  `pnpm -C beebox test`: **8,530 pass, 0 fail**. `sdk-steering-probe`: all four
  steering behaviors pass. It is the natural take,
  and taking it also puts the Bash repair in place before any future change to
  how box agents set up their temp dirs could expose the regression.
- **Sources:** [Agent SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#03252), [Claude Code 2.1.252](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21252)

### 0.3.251 — APPLIED 2026-08-31 (published 2026-08-28T15:36Z; parity with Claude Code 2.1.251)

- **Upstream:** SDK says only "parity with Claude Code v2.1.251". That parity
  line hides ~75 itemized Claude Code entries, assessed immediately below.
- **Action:** Applied 2026-08-31 on the settled path (~81h old), the newest
  settled version — but deliberately, not automatically: `2.1.252` had by then
  revealed that this release broke Bash on some Macs, so it was probed first
  (see the `0.3.252` entry above) and taken only after the failure did not
  reproduce in two shapes on this machine.
  `pnpm -C beebox test`: **8,492 pass, 0 fail**. Note for future turns: that
  green does **not** speak to
  `issues/bugs/2026-08-31-full-suite-red-future-dated-issues-7f47b493.md`, the
  red `test/frontend/trpc-directory-resolution.test.ts` filed on `main` the same
  day — that file does not appear in this suite at all, so the hourly
  `schedules/full-suite/` run covers tests this monitor's gate does not.
  `sdk-steering-probe`: all four steering behaviors pass.
- **Sources:** [Agent SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#03251)

### Claude Code 2.1.251 — harness + runtime (PARTLY CORRECTED 2026-09-02 — see the 0.3.259 entry: the "no enforcement anywhere" claim below is wrong; two schedules pass deny rules on the command line)

~75 items, including the largest batch of security fixes this ledger has
recorded. The single most useful thing to state about them is the frame:

**Nothing here runs with permission enforcement on.** Box agents run
`permissionMode: "bypassPermissions"` (`src/core/agent/run.ts`), and worker
sessions launch with `--dangerously-skip-permissions`
(`bin/launch-worktree-session`). Checked for permission rules that would make
these fixes bite: `.claude/settings.json`, `beebox/.claude/settings.json`
and `.claude/settings.local.json` declare **no `deny` rules at all**, and the
user-level settings declare none either. So the permission-boundary fixes below
are not protections this repo was relying on and lost, nor protections it now
gains — they are enforcement this repo deliberately does not use. The exception
is the boxholder's own interactive sessions, which do run under prompts; that is
the only place these matter here, and the installed CLI is still **2.1.247**, so
they are unfixed on this machine until it auto-updates.

- **The security cluster, for the record:** file tools (Read, Write, Edit)
  followed a symlink swapped inside the working directory *after* the permission
  check, so a read or write could land outside the approved location (a TOCTOU
  race needing an adversarial process on the machine — not this repo's threat
  model); Grep and Glob did not apply `Read(...)` deny rules to files reached
  through a symlinked search path; Bash permission checks auto-approved commands
  assigning an arithmetic expression to an integer shell variable (`OPTIND=1/0`,
  `RANDOM=2+2`); the Workflow tool read — and quoted in errors — a `scriptPath`
  outside what the session may read before the permission check ran; plugin
  commands declared in a marketplace entry could point outside the plugin
  directory; and project settings could enable detailed beta tracing or raw API
  body logging. Several settings-approval tightenings ship alongside
  (`ANTHROPIC_CUSTOM_HEADERS` setting credential/routing headers, sandbox-TLS
  and proxy-injection managed settings, sandbox output-file redirection).
- **Checked and clear — the project-settings `env` restriction.** *"Changed
  project-level `.claude/settings.json` `env` to no longer set
  `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_TMPDIR`, or `TMPDIR`/`TMP`/`TEMP`."* This is
  the one item in the release that could have silently broken this repo, since a
  project `env` block that stops taking effect fails quietly. It does not:
  `.claude/settings.json` and `beebox/.claude/settings.json` have empty
  `env` blocks, and `.claude/settings.local.json` sets only `PATH`, which is
  unaffected. Nothing in `bin/`, `.claude/` or `schedules/` sets any of the
  three restricted variables.
- **Runtime — the wedge worth knowing about.** *"Fixed conversations getting
  stuck on 'text content blocks must be non-empty' errors after a turn where the
  model produced only thinking."* A stuck conversation is a chat thread that
  fails every turn from then on, which in this product is boxholder-visible
  breakage rather than a transient error. Considered for act-now and **not**
  taken, on the same reasoning as the last turn's token-refresh fix: no
  occurrence has been observed here, and `0.3.251` was nine hours old. It
  arrives 2026-08-30 on the settled path. If a box chat thread starts failing
  every turn before then, this is the first thing to check.
- **Runtime — structurally possible, not reachable.** *"Fixed session
  transcripts being silently overwritten when a directory change relocated a
  session onto an existing same-ID transcript."* Silent transcript loss matters
  here because chat history *is* the transcript. `agent/index.ts:114` passes
  `cwd` per **invoke**, not per agent, so resuming one session under a different
  cwd is structurally allowed — and that is exactly the relocation this bug
  punishes. It is not reachable today: no caller anywhere in `beebox/src`
  passes `cwd` at all, so every invoke falls back to `boxRoot` and the value is
  constant for the life of a session. Worth remembering if a caller ever starts
  varying it.
- **Harness — worktree editing, again.** *"Fixed background sessions and their
  subagents being unable to edit files inside a git worktree they created with
  `git worktree add`."* Same family as v2.1.218's worktree git isolation, which
  broke `/finish` here for days. This repo is not exposed the same way — a
  session creates a worktree through the `WorktreeCreate` hook and
  `bin/workstreams create`, and the *new* session works in it rather than the
  creating one — but the pattern of worktree-scoped capability regressions
  landing without warning is now a three-release trend.
- **Additive for hooks:** new `PreModelSwitch` / `PostModelSwitch` hook events
  (block, confirm or annotate a model switch), and `SessionStart` resume hooks
  now receive session staleness and estimated re-cache cost. This repo's
  `SessionStart` hook (`.claude/hooks/session-start-registry.sh`) reads the
  fields it needs and ignores the rest, so the added input is harmless; the
  staleness signal is there if resume behavior ever needs tuning.
- **Also changed, worth knowing:** `CLAUDE_CODE_SUBAGENT_MODEL` now sets the
  *default* subagent model rather than overriding everything (an agent
  definition's `model:` and an explicit per-spawn model win) — nothing here sets
  it; per-model `/effort` defaults; the native binary is ~7.5 MB smaller; and
  `claude ultrareview` / `/ultrareview` now stop early when the cloud session
  fails to start instead of waiting the full 30 minutes.
- **Action:** Nothing to adjust. Settled path.
- **Sources:** [Claude Code 2.1.251](https://github.com/anthropics/claude-code/blob/v2.1.251/CHANGELOG.md#21251)

### 0.3.250 / Claude Code 2.1.250 — superseded; reviewed 2026-08-28 (the previous turn's obligation, discharged)

The last turn recorded these as **unreviewable** rather than reviewed: at that
point neither had a changelog section, a git tag or a GitHub release. Both have
since landed, and the answer is anticlimactic — **2.1.250 says only "Bug fixes
and reliability improvements"**, and the SDK's `0.3.250` says only "parity with
Claude Code v2.1.250". (`0.3.249` also now has a changelog section, for a
Claude Code 2.1.249 that was likewise never tagged; the SDK version itself was
never published to npm.)

So the release was genuinely opaque rather than merely undocumented-yet, and the
previous turn's byte-identical `sdk.d.ts` comparison against `0.3.248` remains
the only substantive thing known about it: no public type surface changed.
Nothing to assess on either channel. The obligation is discharged; no further
re-read is owed.

### 0.3.248 — superseded (published 2026-08-27T20:37Z)

- **Upstream:** One item: a per-server `timeout` for SDK-hosted MCP servers
  (`createSdkMcpServer({ timeout })`), overriding `MCP_TOOL_TIMEOUT` for that
  server's tool calls.
- **BeeBox applicability (runtime):** None. beebox calls
  `createSdkMcpServer` nowhere — it hosts no in-process MCP server, and
  `src/core/agent/run.ts` passes no `mcpServers`. The itemized SDK content is
  therefore empty for us, and everything that matters in this version is the
  Claude Code 2.1.248 it bundles, below.
- **Action:** Never installed on its own — it settled during a quiet upstream
  weekend, and by the time this monitor next bumped, `0.3.251` was the newest
  settled version. Its content (an MCP `timeout` option beebox does not use) is
  included in the current pin.
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
  `beebox/.env` (gitignored, present) and `beebox/deploy/target.env`
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

### 0.3.247 — APPLIED 2026-08-28 (published 2026-08-26T18:05Z)

- **Upstream:** Two items. An optional `ambient` flag on `task_started`,
  `task_notification` and `background_tasks_changed` entries, "so hosts can
  exclude housekeeping tasks from activity indicators". And a fix: the
  `permissionMode` on per-turn `system/init` frames reported the mode at turn
  start rather than the live mode, so a mode switch right after submitting sent
  a stale value.
- **BeeBox applicability (runtime):** The `ambient` flag lands squarely on
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
- **BeeBox applicability (harness):** None from the SDK side.
- **Action:** Applied 2026-08-28 on the settled path (~54h old), the newest
  settled version — the deliberate take flagged two turns running, since
  `issues/bugs/2026-08-26-chat-task-strip-edge-pairing-and-ambient.md` needs
  `ambient`. That issue is no longer blocked on the pin.
  `pnpm -C beebox test`: **8,402 pass, 0 fail** (a 13-minute run against
  the usual 3-4, from machine contention rather than anything in the release).
  `sdk-steering-probe`: all four steering behaviors pass.
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
- **BeeBox applicability (runtime):** `perTaskStopAffordance` is the one
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
- **BeeBox applicability (harness):** None. `perTaskStopAffordance` is an
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
- **BeeBox applicability:** None on either channel. The boxholder's
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
- **BeeBox applicability (runtime):** This is the batch's only release
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
- **BeeBox applicability (harness):** 2.1.243 itself is mostly
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
- **BeeBox applicability:** Nothing assessable on either channel.
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
- **BeeBox applicability:** Nothing assessable on either channel.
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
- **BeeBox applicability (runtime):**
  - **Both cost changes land on a value beebox records.**
    `scan-vision-claude.ts` reads `result.total_cost_usd` per scan batch (and
    `toBatchUsage` reads `result.usage`). The 1.1× data-residency multiplier
    makes that figure larger but *more accurate* where it applies; the
    one-shot/background-subagent change makes it correct as of release rather
    than a turn-end snapshot. Neither breaks anything — but any comparison of
    scan costs recorded across this pin boundary is apples-to-oranges, which is
    worth knowing before reading a cost trend as a regression.
  - `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`: inert. BeeBox passes
    `systemPrompt: { type: "preset", preset: "claude_code", append: … }`
    (`src/core/agent/run.ts`), not an array, and talks to the Anthropic API
    directly rather than through Bedrock/Vertex/Foundry/a gateway.
  - The `background_tasks_changed`-after-repeated-`initialize` item continues the
    thread from `0.3.238`: it further confirms the SDK expects hosts that
    re-`initialize` a running process. BeeBox still is not one — its warm
    pool hands the already-initialized `Query` to `buildRunFromQuery` — so both
    items remain inert here for the same reason.
- **BeeBox applicability (harness):**
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
- **BeeBox applicability (runtime):**
  - **The hook-callbacks-after-re-`initialize` fix is the one worth thinking
    about, and it looks inert here — but the reasoning is worth writing down
    because the blast radius would be large if wrong.** BeeBox registers
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
- **BeeBox applicability (harness):**
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
- **BeeBox applicability:** Nothing on either channel. BeeBox talks
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
- **BeeBox applicability (runtime):**
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
    session's cwd was deleted. BeeBox deletes box directories out from
    under sessions in exactly one place — worktree teardown removing the cloned
    box (`bin/lib/worktree-teardown.sh`, `bin/worktrees sweep`) — so the
    exposure is dev-environment only; prod box directories are not deleted.
  - Not applicable: the `ANTHROPIC_DEFAULT_MODEL` env var (beebox sets
    `model` explicitly per run via `normalizeModelId`), `notify_when_idle` on
    cross-session `SendMessage` (unused), the macOS sandbox wildcard read-deny
    precedence fix (no sandbox rules configured), and the WSL/`powershell.exe`
    subprocess fix (a 2.1.234 regression, Windows-only).
- **BeeBox applicability (harness):** Mostly TUI. Worth knowing:
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
- **BeeBox applicability (runtime):** Nothing act-now. The
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
- **BeeBox applicability (harness):** Two permission-dialog fixes are
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
- **BeeBox applicability (runtime):** **The breaking change does not bite
  here** — checked before bumping rather than after: `ExitReason`,
  `bypass_permissions_disabled`, and `ApiKeySource` appear nowhere in
  `beebox/src`, `beebox/scripts`, or `bin/`. The rest is inert too:
  `vcs_state_changed` is unconsumed, `fromMode` rides cross-session messaging
  beebox does not use, and the new `effort` field on `system`/`init` is
  additive — `adaptSdkMessage` (`src/core/chat/session/messages.ts`) forwards
  only `session_id` from an init message. So `0.3.234` should be an ordinary
  settled bump next turn.
- **BeeBox applicability (harness) — one item worth keeping:**
  **`CLAUDE_CODE_PROJECT_DIR_NAME`** (new in 2.1.234) lets a host choose a short
  name for the per-project transcript directory. BeeBox *derives* that
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
- **BeeBox applicability (runtime):** The todo-tool removal was checked
  rather than assumed and is **inert here**. BeeBox never asks for those
  tools: `buildQueryOptions` (`src/core/agent/run.ts`) and
  `src/services/claude-chat.ts` pass no `tools`/`allowedTools` at all, and the
  one place that does set an explicit surface — `OPERATOR_TOOLS` in
  `src/field-test/run.ts:61` — is `["Bash", "Read"]`. The many `todo` hits in
  `src/` are beebox's own `{% todo %}` card annotation, an unrelated
  concept. Notification hooks are also inert: beebox registers only
  `PreToolUse`/`PostToolUse` (`run.ts`), and runs `bypassPermissions`, so there
  are no pending permission prompts to notify about.
- **BeeBox applicability (harness):** The todo-tool removal **does** land
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
- **BeeBox applicability (runtime):** All three SDK changes are inert —
  `tool_use_result`, `context_usage`, `SDKContextUsage`, and `vcs_state_changed`
  appear nowhere in `beebox/src`. Note the `tool_use_result` shape change
  is *not* the same thing as the Anthropic `tool_result` **content block** that
  beebox does consume (`src/core/agent/render.ts`,
  `src/cli/lib/session-content.ts`, the frontend `SessionLog`); those are
  unaffected. BeeBox also configures no MCP servers, so subagent MCP
  results do not arise.
- **BeeBox applicability (harness) — two items worth keeping:**
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

### Monitor reliability — the SDK pin has split in two (FILED 2026-09-01 as `issues/code-quality/2026-09-01-agent-sdk-split-pin-root-copy.md`)

Not an upstream release; recorded here because it degrades this monitor. The
prediction below held: `pnpm update-agent-sdk --check` on 2026-09-01 reported
"behind: installed 0.3.226, newest mature 0.3.251" with the managed pin already
at `0.3.251`. The filed issue adds what this note did not reach — the root copy
is not only read for reporting, it is *executed*: `bin/agent-quotas-requests.ts`
imports the SDK from `bin/`, which resolves the root install, so that tool
drives the Claude Code binary bundled with `0.3.226`.

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
- **BeeBox applicability:** Nothing on the runtime channel — beebox
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
- **BeeBox applicability (runtime):**
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
    (2.1.229) — the item to watch.** BeeBox replaces files atomically
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
- **BeeBox applicability (harness):**
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
- **BeeBox applicability (runtime):** Additive, nothing act-now, but it
  lands on a surface already flagged in this ledger. BeeBox's token
  accounting reads `result.usage` in `toBatchUsage`
  (`src/services/scan-vision-claude.ts`) and aggregates JSONL assistant-message
  usage in `src/core/usage.ts`; neither consumes agent-tool (`AgentOutput`)
  usage today, so subagent output tokens are simply absent from both. Combined
  with the `usage` vs `modelUsage` note in the 0.3.223 entry, this is the second
  piece of the same picture: cost accounting here undercounts anything outside
  the main loop. No behavior changes by upgrading.
- **BeeBox applicability (harness):** Nothing — no CLI behavior claimed.
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
- **BeeBox applicability (runtime):** Nothing. No API surface changed, and
  none of the fixes touch the query, message-adaptation, or hook paths
  beebox uses.
- **BeeBox applicability (harness):** Effectively nothing to act on.
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
  the 0.3.224 entry below. BeeBox sends no cross-session messages today,
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
- **BeeBox applicability:** Nothing specific to assess. The parity target
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
- **BeeBox applicability:** **Act-now correctness fix, directly in
  beebox's execution shape.** Every beebox query is a headless SDK
  session (`src/core/agent/run.ts`, `src/services/claude-chat.ts`), and none of
  them restrict the toolset — `buildQueryOptions` sets `permissionMode`,
  `maxTurns`, hooks, and system-prompt options but passes no `allowedTools`/
  `disallowedTools`, so box agents have Task and background Bash available and
  can hit this. BeeBox also actively surfaces background-task lifecycle
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
- **BeeBox applicability:** One genuinely adjacent fix, but not reachable;
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
- **BeeBox applicability:** Nothing breaking and nothing act-now.
  - `resumeSessionAt`/`resumeDropsTurn`: unused. BeeBox resumes by
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
- **BeeBox applicability:** BeeBox does not use `sessionStore`, so
  the SDK-specific fix does not touch its resume path. No beebox API or
  message adaptation changed.
- **Action:** Applied in the `0.3.220` to `0.3.222` bump.
- **Sources:** [Agent SDK release](https://github.com/anthropics/claude-agent-sdk-typescript/releases/tag/v0.3.222), [Claude Code 2.1.222](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21222)

### 0.3.221 — applied

- **Upstream:** Tightened `skills` option validation and fixed external
  `mcpServers` missing the first turn. The bundled Claude Code 2.1.221 included
  the matching headless MCP connection fix plus broader security and reliability
  changes.
- **BeeBox applicability:** BeeBox passes neither the `skills`
  option nor external `mcpServers`, so the SDK-specific changes do not affect
  its current query setup. Keep this entry as a pointer if beebox later
  starts configuring either surface.
- **Action:** Applied as part of the `0.3.220` to `0.3.222` bump.
- **Sources:** [Agent SDK release](https://github.com/anthropics/claude-agent-sdk-typescript/releases/tag/v0.3.221), [Claude Code changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21221)

### 0.3.220 — applied

- **Upstream:** Updated the SDK to parity with Claude Code 2.1.220. That bundled
  CLI already included the 2.1.208 fix for unbounded memory growth from large
  tool-result payloads in long-running headless and SDK sessions.
- **BeeBox applicability:** The headless memory fix directly matches
  beebox's resident chat execution shape. Binary verification confirms
  SDK 0.3.220 bundled Claude Code 2.1.220, so the fix was already present at the
  old pin; the later 0.3.222 bump did not introduce it. Keep this correction in
  the ledger when diagnosing the box OOM incident.
- **Action:** Applied before the monitor ledger was introduced.
- **Sources:** [Agent SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#03220), [Claude Code 2.1.208](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21208)
