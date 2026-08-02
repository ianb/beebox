---
title: "cb session --tool-report materializes the whole transcript (worse than the fixed OOM)"
area: callback-box
filed-by: agent
discovered-in: worktree-chat-history-oom-mobile-lock — post-fix sweep
---

`generateSessionReport` / `collectRawEntries`
(`callback-box/src/dev/lib/session-report.ts`) accumulates a `RawEntry` for
every user/assistant line with ALL blocks — including `tool_use.input` AND
`tool_result.content`, which the bounded `parseSessionLog` path deliberately
summarizes or skips — then builds a second Map over all of them and joins the
report into one giant markdown string. Peak memory is strictly larger than the
transcript file. A transcript big enough to have OOM'd `cb serve`
(2026-08-01 incident) is a guaranteed OOM here too.

Reachable from `cb session <id> --tool-report` and `cb session --since …
--tool-report` (which runs it per session in the window,
`cli/commands/session-modes.ts`). CLI-only, so no server blast radius — but it
is the last reader that can still materialize a whole transcript.

Fix shape: stream and emit report sections incrementally to stdout, or cap at
`MAX_SESSION_ENTRIES` (`cli/lib/session-retention.ts`) with the same loud
truncation note the other CLI consumers print.
