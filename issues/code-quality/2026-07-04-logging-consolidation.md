---
title: "One way to log everywhere"
workstream: unknown
---

2026-07-04 · boxholder-ruled direction: "there should be one way to log
everywhere more or less. If not then we should fix it."

Current state: `makeLog` (`beebox/src/core/chat-session-log.ts`) is
the only structured logging convention and is used by ~8 chat-session
modules; the rest of the codebase has ~900 raw `console.*` calls with no
convention (no levels, no module tags, no routing).

The task:
1. Decide the house pattern — promote `makeLog` (possibly moving it out of
   the chat cluster to `src/lib/`) or pick something else deliberately.
2. Migrate call sites (mechanical but large; good agent fan-out work).
3. Hold the line — a lint rule against raw `console.*` in `src/` (with a
   narrow allowlist for CLI user-facing output, which is stdout product
   surface, not logging).

Related: the noisy-output policy in the root CLAUDE.md (routine-success
diagnostics shouldn't print at all) — the migration is the moment to delete
logs rather than convert them.
