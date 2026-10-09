---
title: "Chat title and review runs are full agent sessions: they can use box tools and often fail to return structured output"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — D-chemistry, C-reconnecting, A-lending, B-inventory, F-newcomer journey walks, 2026-10-09
resolution: implemented
---

Fixed 2026-10-09: the title and review passes run with `tools: []` and no box settings (`PASS_OPTIONS` in `beebox/src/core/chat/review/reviewer.ts`, threaded through `AgentInvokeOptions.tools`). A real title run on the test box made one `StructuredOutput` call and no other tool call, with no `[structured-output-enforce]` retry.

The chat title run (and the nightly chat review) is a full Claude Code session. Only one sentence in the prompt says not to use tools. Two symptoms follow from this one cause.

**Tools.** In the second D-chemistry walk, title run `b396a29b` called `Read` on the attach folder, `Bash` (`ls -la` on it) and `Read` on the progress card. It then wrote a balancing lesson. It wrote nothing to the box. The prompt embeds the chat transcript, which can carry text from outside.

**Structured-output retries.** Most title runs answered in plain text first and needed `[structured-output-enforce]`. Transcripts: C `2321b18e`, D `1d6b6836`, A `29d734c4`, B `7e7bba14` and `ad670476`, F `40897bd3`. The title still arrived, at the cost of one more model call. In the second D walk both title runs for the place chat `df2994b9` failed ("Structured output: no JSON found" at 12:35:44, "Reached maximum number of turns (4)" at 12:36:44). The model continued the lesson ("I'll wait for your reasoning here"), then refused the enforce message ("I'm going to ignore that. We're in the middle of a chemistry lesson"). `.beebox/chat-review/state.json` shows `titleAttempts: 2` and `titleFailedSpanId`. The chat stayed untitled: the switcher showed "Pick up where I left off" and the chip showed "Conversation".

## Mechanism

- `createSdkChatReviewer` (`beebox/src/core/chat/review/reviewer.ts:214-232`, review at `:238-252`) calls `agent.invokeStructured` with `loadBoxContext: false` and `maxTurns: 4`. It passes no tool restriction.
- `buildQueryOptions` (`beebox/src/core/agent/invoke/run.ts:75-110`) sets `permissionMode: "bypassPermissions"` and passes no `tools` or `allowedTools`. `loadBoxContext: false` drops box settings and hooks, but `cwd` stays the box root, so `Read` and `Bash` reach the box.
- The prompt says "Do not use any tools" (`reviewer.ts:138`, `:161`). That is the only guard.
- The title instructions arrive after the full Claude Code system prompt and tool list, and the user prompt ends with the chat transcript (`reviewer.ts:192-203`). A small model that sees a live conversation tends to continue it. Hypothesis, not tested: this is why the first answer is plain text.
- The chat session path accepts `opts.tools` (`beebox/src/services/claude-chat/core.ts:132`). The invoke path in `run.ts` has no equivalent.
- A failed title is retried at most `MAX_REVIEW_ATTEMPTS = 2` times per span (`state.ts:24`, `run/title.ts:128`). The next span may retry.

## Direction

Smallest change: run the title and review calls with no tools (`tools: []`) and no box access. A plain completion call would also remove the tool list from the prompt. Unverified: whether `tools: []` also removes the structured-output retries. Measure the retry rate before and after.

Related: [conversation-keeps-placeholder-title](../../closed/bugs/2026-10-08-conversation-keeps-placeholder-title.md) (the title job these runs belong to).

Reports: [D2](../../../beebox/test/user-stories/journeys/D-chemistry/reports/2026-10-09-2.md) (rows R1, R2), [C](../../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-09.md) (R1), [D](../../../beebox/test/user-stories/journeys/D-chemistry/reports/2026-10-09.md), [A](../../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-09.md), [B](../../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-09.md) (R3), [F](../../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-09.md) (R1).
