---
title: "Codex-engine boxes run chat title and review passes with tools and box guidance"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — cross-model review of the title-run fix, 2026-10-09
---

The chat title and review passes ask for a prompt-only run. `PASS_OPTIONS` in
`beebox/src/core/chat/review/reviewer.ts:214` sets `loadBoxContext: false` and
`tools: []`. The Claude adapter honors both. On a box whose
`_config/box.json` sets `agentEngine: "codex"`, `createAgent`
(`beebox/src/core/agent/invoke/core.ts:174`) selects the Codex adapter, and the
options do not reach the run:

- `createCodexAgent` builds its run options at
  `beebox/src/core/agent/codex-agent.ts:35` and copies neither `tools` nor
  `loadBoxContext`.
- `runCodexAgent` always expands the box `CLAUDE.md` into the system prompt
  (`beebox/src/core/agent/codex-run/core.ts:78`).
- Every Codex thread runs with `sandboxMode: "danger-full-access"` and
  `approvalPolicy: "never"`
  (`beebox/src/services/codex-sdk-session/core.ts:150`).

Result: on a Codex box, a title pass gets the transcript in its prompt, and it
also has the box guidance and a shell with full access. The prompt's "Do not use
any tools" line is the only restraint. This is the defect that
[chat-title-run-is-a-full-agent-session](../closed/bugs/2026-10-09-chat-title-run-is-a-full-agent-session.md)
fixed for Claude. The earlier
[structured-output-passes-load-full-box-context](../closed/code-quality/2026-07-30-structured-output-passes-load-full-box-context.md)
added `loadBoxContext` without a Codex path.

Smallest remedy (from the review): give the Codex adapter an enforced
prompt-only mode for these passes, and honor `loadBoxContext: false` by
skipping the `CLAUDE.md` expansion. The prompt-only mode must be enforced by the
Codex session (a sandbox or tool setting), not by the prompt. Which Codex SDK
setting removes shell access is not checked here.

Exposure: no local box under `~/src/boxes/` or `~/src/box-worktrees/` sets
`agentEngine: "codex"` (one sets `"claude"`; the rest omit it, which means
Claude). Production box configs were not read.
