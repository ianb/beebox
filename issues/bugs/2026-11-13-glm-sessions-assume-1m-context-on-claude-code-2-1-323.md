---
title: "Claude Code 2.1.323 assumes 1M context for `glm-*` models; long GLM chats could fail every turn"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-sdk-update — reviewing Claude Code 2.1.323
labels: [sdk-update]
---

Claude Code 2.1.323 (bundled by Agent SDK 0.3.323): *"Changed the context
window assumed for a model ID that Claude Code doesn't recognize from 200K to
1M"* and *"sessions on other vendors' models with a smaller window: once full,
they can fail every turn until `/clear`, so set
`CLAUDE_CODE_DISABLE_1M_CONTEXT=1` before they fill."*

beebox runs `glm-*` models through the claude engine against Z.ai's
Anthropic-compatible endpoint. `glmEnvAdditions` (`beebox/src/core/glm-key.ts`)
sets `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` and `API_TIMEOUT_MS`, and
nothing sets a context window. Claude Code does not recognize `glm-*` IDs, so
on 2.1.323 it would plan auto-compaction for a 1M window, past what the GLM
endpoint accepts. A long GLM chat would then fail on every turn until the
person clears it.

The likely fix is one line: add `CLAUDE_CODE_DISABLE_1M_CONTEXT: "1"` (or a
`CLAUDE_CODE_AUTO_COMPACT_WINDOW` matching GLM's real window) to
`glmEnvAdditions`, with a check that the variable reaches the child process.
The sdk-update schedule holds Agent SDK 0.3.323 until this lands. GLM access
ends 2026-12-15, so the fix only needs to cover the weeks until then.
