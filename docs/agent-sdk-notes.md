# Agent SDK release applicability

This file is a cumulative, newest-first, callback-box-specific view of Agent SDK
releases. The daily persistent monitor session maintains it. It reads upstream
release notes in light of the SDK surfaces callback-box actually uses. Applied
entries stay here because they can explain regressions and expose future
opportunities elsewhere in the code. The monitor automatically bumps settled
releases and immediately applies callback-box-relevant security, memory, and
correctness fixes.

- **Current pin:** `0.3.226`
- **Latest reviewed upstream version:** `0.3.226`
- **Ledger floor:** `0.3.220` (earlier releases are out of scope)
- **Current recommendation:** No pending releases. The pin is at the newest
  stable version.

## Release ledger

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
