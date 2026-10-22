---
title: "Codex-engine boxes run chat title and review passes with tools and box guidance"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — cross-model review of the title-run fix, 2026-10-09
resolution: implemented
---

Fixed in bug-burndown-3 (2026-10-19): the Codex adapter now honors `loadBoxContext: false` and `tools: []`.

The chat title and review passes ask for a prompt-only run. `PASS_OPTIONS` in
`beebox/src/core/chat/review/reviewer.ts:214` sets `loadBoxContext: false` and
`tools: []`. The Claude adapter honors both. On a box whose
`_config/box.json` sets `agentEngine: "codex"`, `createAgent`
(`beebox/src/core/agent/invoke/core.ts:174`) selects the Codex adapter, and the
options do not reach the run:

- `createCodexAgent` builds its run options at
  `beebox/src/core/agent/codex-agent.ts:35` and copies neither `tools` nor
  `loadBoxContext`.
- `runCodexAgent` always expands the box `AGENTS.md` into the system prompt
  (`beebox/src/core/agent/codex-run/core.ts:78`).
- Every Codex thread runs with `sandboxMode: "danger-full-access"` and
  `approvalPolicy: "never"`
  (`beebox/src/services/codex-sdk-session/core.ts:150`).

Result: on a Codex box, a title pass gets the transcript in its prompt, and it
also has the box guidance and a shell with full access. The prompt's "Do not use
any tools" line is the only restraint. This is the defect that
[chat-title-run-is-a-full-agent-session](2026-10-09-chat-title-run-is-a-full-agent-session.md)
fixed for Claude. The earlier
[structured-output-passes-load-full-box-context](../code-quality/2026-07-30-structured-output-passes-load-full-box-context.md)
added `loadBoxContext` without a Codex path.

Smallest remedy (from the review): give the Codex adapter an enforced
prompt-only mode for these passes, and honor `loadBoxContext: false` by
skipping the `AGENTS.md` expansion. The prompt-only mode must be enforced by the
Codex session (a sandbox or tool setting), not by the prompt. Which Codex SDK
setting removes shell access is not checked here.

Exposure: no local box under `~/src/boxes/` or `~/src/box-worktrees/` sets
`agentEngine: "codex"` (one sets `"claude"`; the rest omit it, which means
Claude). Production box configs were not read.

## Resolution

2026-10-19, bug-burndown-3. `createCodexAgent` now forwards `loadBoxContext`
and `tools` to `runCodexAgent`.

- `loadBoxContext: false` skips Bee Box's `@`-include expansion and sets Codex's
  `project_doc_max_bytes = 0`. A probe against Codex 0.163.0 showed Codex loads
  the `cwd` `AGENTS.md` itself, so skipping the expansion alone was not enough.
- `tools: []` runs the thread in Codex's `read-only` sandbox with web search
  off. The session blocks writes and network; a probe confirmed a write under
  this sandbox fails with "Operation not permitted". Codex cannot remove its
  shell through the SDK (the tool set is many feature flags that change per
  version), so a prompt-only pass can still read files. A non-empty `tools`
  list leaves a Codex run unrestricted; no caller passes one.

Regression test: `beebox/test/core/agent/codex-agent.prompt-only.test.ts`.
