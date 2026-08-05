# Agent SDK release applicability

This file is a cumulative, newest-first, callback-box-specific view of Agent SDK
releases. The daily persistent monitor session maintains it. It reads upstream
release notes in light of the SDK surfaces callback-box actually uses. Applied
entries stay here because they can explain regressions and expose future
opportunities elsewhere in the code. The monitor automatically bumps settled
releases and immediately applies callback-box-relevant security, memory, and
correctness fixes.

- **Current pin:** `0.3.222`
- **Latest reviewed upstream version:** `0.3.222`
- **Ledger floor:** `0.3.220` (earlier releases are out of scope)
- **Current recommendation:** No pending releases.

## Release ledger

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
