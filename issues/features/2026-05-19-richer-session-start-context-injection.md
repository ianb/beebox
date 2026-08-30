---
title: "richer session start context injection"
workstream: unknown
area: beebox
---

Currently the boxholder agent gets the date but not derived context that frequently matters in conversation. Cheap additions:

- **Day of week (named)** — comes up constantly ("plans this weekend," "Tuesday's call," "the Monday meeting"). The agent currently has to compute or guess.
- **Phase of day** — morning / afternoon / evening / late-night. "What's left on today" reads differently at 9am vs 9pm; offering to schedule something "later today" means different things.
- **Time since last session** — lets the agent calibrate between quick continuity ("picking up where we left off") and full re-orientation ("it's been three weeks, here's what's still pending").
- **Near-horizon time-sensitivity** — anything scheduled in the next few hours / today that's worth being aware of before answering.

**Channel / device.** Desktop web vs. mobile web vs. Telegram (and any future channel) currently look the same to the agent, but the appropriate output shape differs: on mobile, tables, multi-column structures, and long-form prose with headers don't render well; on desktop they're fine. The agent should know the channel and adapt output mode (length, structure complexity) without the user having to ask. Same intelligence, different presentation.

Implementation is trivial (compute at session start, inject into context) but the quality dividend is real because these are things conversations *constantly* reference and currently the agent has to derive or fudge.

**IMPLEMENTED (web chat, June 2026)** — as read-only attributes on the per-turn `<chat-app>` snapshot, computed by `src/core/session-context.ts`: `local-time` (named weekday + box-local clock + phase of day) and `channel` (`web-desktop`/`web-mobile`, classified from the request User-Agent) on every message; `last-activity` (from the most-active pointer's `savedAt`) and `calendar` (next 24h of `store/calendar/`) on the first message of a brand-new session only. Deliberately in message text rather than the system prompt: the warm-pool backend reuses a prewarmed subprocess only on an exact system-prompt match, so the prompt must stay time-invariant. Remaining: Telegram thread sessions (`chat-thread-session.ts`) don't use the snapshot and got none of this — wire it up when touching that area.
