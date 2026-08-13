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

- **Current pin:** `0.3.227` (in `callback-box/package.json` — see the split-pin
  note below; the monorepo root now carries a second, unmanaged pin)
- **Latest reviewed upstream version:** `0.3.231` (SDK), `2.1.231` (Claude Code)
- **Ledger floor:** `0.3.220` (earlier releases are out of scope)
- **Current recommendation:** `0.3.228` clears the 48h window within hours of
  this turn and `0.3.229` tomorrow; take them on the normal settled path.
  Nothing act-now on either channel. Watch `0.3.229`'s file-watcher handle-leak
  fix (see its entry) — it is the most callback-box-shaped item in the backlog.

## Release ledger

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

### 0.3.231 — pending (parity with Claude Code 2.1.231)

- **Upstream:** SDK entry is only "Updated to parity with Claude Code v2.1.231".
  The itemized content is Claude Code 2.1.231's single fix: MCP OAuth sign-in
  failing with a redirect URI mismatch for servers that use a pre-registered
  OAuth client, such as Slack.
- **Callback-box applicability:** Nothing on the runtime channel — callback-box
  configures no `mcpServers` (still true as of this turn). On the harness
  channel it only affects a boxholder session signing in to a pre-registered
  MCP OAuth server; no repo surface, nothing to adjust.
- **Action:** Published 2026-08-13T08:31Z, ~8h old, inside the settling window.
- **Sources:** [Agent SDK release](https://github.com/anthropics/claude-agent-sdk-typescript/releases/tag/v0.3.231), [Claude Code 2.1.231](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21231)

### 0.3.230 — never published to npm (evidence for the settling window)

The SDK changelog carries a `0.3.230` entry ("Updated to parity with Claude Code
v2.1.230"), but **npm has no `0.3.230`** — the registry goes `0.3.229` →
`0.3.231` — and the Claude Code changelog has no `2.1.230` either. So a release
was cut and then withdrawn upstream this week. Nothing to apply; recorded because
it is direct, current evidence that the two-day settling window earns its keep,
and a caution against reading the changelog as the list of installable versions.

### 0.3.229 — pending

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
- **Action:** Published 2026-08-12T19:30Z, ~21h old, inside the settling window.
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

### 0.3.228 — pending

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
- **Action:** Published 2026-08-11T17:49Z, ~22h old, inside the settling window.
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
