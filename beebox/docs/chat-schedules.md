# Chat Schedules

Agent-initiated timers set during web chat conversations. The agent uses `<schedule>` XML tags in its responses to set timers that fire later, optionally playing an alarm sound and/or TTS announcement, then waking the agent back up to respond.

## How It Works

### Agent sets a schedule

The agent includes a `<schedule>` tag in its response:

```xml
<schedule label="check back" delay="5m" alarm="true" announce="Time to check in!">
Remember to ask about the meeting outcome.
</schedule>
```

Attributes:
- `label` (required): Display name, also used for cancellation
- `delay` (required): Duration like `30s`, `5m`, `2h`
- `alarm` (optional): Play alarm sound when firing (`true`/`false`)
- `announce` (optional): Text spoken via TTS when firing

The text content inside the tag is context passed back to the agent when the schedule fires.

### Agent cancels a schedule

```xml
<cancel-schedule label="check back" />
```

### Server-side lifecycle

1. `chatSession.on("turn-text")` fires after each agent response
2. `parseScheduleTags()` / `parseCancelScheduleTags()` extract tags from the response text
3. `ChatScheduleManager` stores schedules in `.beebox/chat-schedules.json` and sets `setTimeout` timers. Each entry records the **originating session id** (`sessionId`) so the fire can land back in the conversation that created it.
4. When a timer fires, `fireChatSchedule` (`src/webapp/routes/chat-schedule-fire.ts`):
   - Broadcasts `schedule-fired` SSE event (alarm/announce data for the frontend), before any session work
   - Resumes the **originating session** (`schedule.sessionId`) and sends it a `<schedule-fired>` message, so the reply lands in the right thread rather than whatever chat was last active
   - Broadcasts updated history via SSE once the fired turn completes

### Targeting: originating session, with fallbacks

- **Originating session** — the normal case. The schedule carries the id of the session whose turn created it, and the fire resumes exactly that session.
- **Legacy fallback (most-active)** — entries persisted before the `sessionId` field existed have none; they fall back to the most-active session (`getMostActive`), preserving the old behavior.
- **Fresh-session fallback (unresumable target)** — if the targeted session's turn errors instantly (`is_error=true`, e.g. a pre-v2 session id the SDK refuses to resume — see `issues/bugs/2026-07-11-pre-v2-session-resume-broken.md`), the reminder is re-sent **once** into a brand-new session. If that also fails, it's logged (`console.error`) and given up. A fired schedule's response is never silently lost. The failed-turn signal is the session's `done` event, whose `ChatMessageResult` payload carries `is_error`.

### Frontend display

- `SchedulePill` components (in `InteractiveChat-layout.tsx`/`InteractiveChat-controls.tsx`) show active schedules with live countdown
- Schedules are fetched via the `chat.schedules` tRPC query on mount and after each turn
- User can cancel schedules via the × button on each pill, which calls the `chat.cancelSchedule` tRPC mutation

### Frontend receives the agent's response

The agent's schedule-fired response reaches the UI over the shared WebSocket: the server broadcasts `schedule-fired` (triggers alarm/TTS) and `chat-history` on the box's event-bus stream, and `InteractiveChat-ws.ts` subscribes to that stream via tRPC's `events.subscribe`.

### Hidden system messages

The `<schedule-fired>` message sent to the agent is a user-type message wrapped in XML tags. `stripUserDisplayTags()` (`src/frontend/src/components/chat/message-parsing.ts`) strips these tags for display — if a user message is empty after stripping, it's hidden entirely (visible only in debug view).

### Telegram threads

Telegram threads also support schedules via the `ChatSessionPool`. The pool listens for `turn-text` events from `ChatThreadSession`, parses `<schedule>` tags, and manages per-thread `ChatScheduleManager` instances.

When a schedule fires in a Telegram thread:
1. Pool sends a `<schedule-fired>` message to the thread session
2. Agent responds with `<chat-response>` tags as usual
3. Pool delivers responses to Telegram via the stored `deliverResponse` callback

Each thread gets its own schedule file at `.beebox/thread-schedules/<threadRef>.json`. Schedules are cleared when a thread session expires (50 messages or 24 hours).

No alarm or announce support — Telegram schedules are simple wakeup messages. For longer-term reminders, the agent should create a job card instead.

## Key Files

| File | Role |
|------|------|
| `src/core/chat/schedules.ts` | `ChatScheduleManager`, `parseScheduleTags()`, `parseCancelScheduleTags()`, schedule persistence |
| `src/core/chat/session/index.ts` | `CHAT_SYSTEM_PROMPT` (scheduling instructions for the agent) |
| `src/core/chat/session/pool.ts` | Per-thread schedule managers for Telegram, `deliverResponse` callbacks |
| `src/core/chat/session/thread.ts` | `turn-text` event, `fullTurnText` accumulator, `SCHEDULING` prompt section |
| `src/webapp/routes/chat.ts` | Server-side: schedule creation on turn-text (stamps the originating `sessionId`), wires the schedule manager into `webapp/chat-runtime.ts` |
| `src/webapp/routes/chat-schedule-fire.ts` | `fireChatSchedule` — resolves the target session (originating / most-active / fresh fallback) and injects the fired reminder |
| `src/webapp/trpc/routers/chat-control-procedures.ts` | `schedules` query, `cancelSchedule` mutation |
| `src/frontend/src/components/chat/InteractiveChat-layout.tsx`, `InteractiveChat-controls.tsx` | `SchedulePill`, alarm/TTS |
| `src/frontend/src/components/chat/InteractiveChat-ws.ts` | Subscribes to the box event stream (`schedule-fired`, `chat-history`) over the shared WebSocket |
| `src/frontend/src/components/chat/message-parsing.ts` | `stripUserDisplayTags()`, hidden schedule-fired messages |

## API

- `trpc.chat.schedules` (query) — List active schedules
- `trpc.chat.cancelSchedule` (mutation, `{ label: string }`) — Cancel by label

## Restart and lazy-hub behavior

Schedules persist to `.beebox/chat-schedules.json` and are re-armed when a box's `bbx serve` process boots (overdue-unfired entries fire immediately). Because the timers live in that process, a lazy `bbx hub` (`lazy: true`, which idle-stops boxes) must not stop or fail to start a schedule-holding box: it keeps any box whose `chat-schedules.json` holds an entry running instead of idle-stopping it, and pre-starts such boxes at hub boot (independent of `keepRecent`), so a schedule fires on time even after a hub restart. See `src/hub/CLAUDE.md` (Lazy mode) and `src/hub/pending-schedules.ts`.

## Known Issues / Future Work

- **Telegram schedule delivery on restart**: If the server restarts, schedule timers are re-armed from disk but the `deliverResponse` callback (which sends to Telegram) is lost. The schedule fires but the response only goes to the session log, not to Telegram. This is acceptable for short-term timers.
