---
title: "A fired chat check-in turn is not pinned against live-cap eviction, and deletion can overtake its admission"
workstream: maintenance-live-tasks
area: beebox
labels: [chat, schedules]
filed-by: agent
discovered-by: agent
discovered-in: "maintenance-live-tasks / interrupted-chat-wake diff review (Codex), 2026-11-02"
resolution: implemented
---

**Closed (implemented, 2026-11-02):** Fixed in fireChatSchedule: the turn is pinned, and sendFiredTurn's onAdmitted/onDispatch checks abandon it when deletion began (FiredTurnCancelledError). Test in test/webapp/routes/chat/schedule-fire.test.ts.

`fireChatSchedule` (`src/webapp/routes/chat/schedule-fire.ts`) starts a turn
in the check-in's conversation the way the interrupted-chat wake does, but
without two guards the wake now has (`src/webapp/routes/chat/interrupted-wake.ts`):

- **Not pinned.** A person's send holds `registry.pinSession(session)` for the
  turn; a fired check-in does not. With the live-process cap reached, another
  chat's start can pick the check-in's chat as the eviction candidate
  (`src/core/chat/session/registry/cap.ts`, `isHeld` checks pins and
  background work, not a running turn) and stop it mid-turn.
- **Deletion can overtake admission.** `isBlocked` is checked before
  `getOrCreate`; `session.send()` then awaits admission and readiness. A
  deletion that starts in between sees the chat idle and removes it, and the
  pending send continues on the session object it already holds.

Smallest fix: pin for the turn, and recheck `registry.deletion.isBlocked` in
`onAdmitted`/`onDispatch` (`sendFiredTurn` now takes those `checks`).
