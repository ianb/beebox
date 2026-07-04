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
3. `ChatScheduleManager` stores schedules in `.callback-box/chat-schedules.json` and sets `setTimeout` timers
4. When a timer fires, `onFire` callback:
   - Broadcasts `schedule-fired` SSE event (alarm/announce data for the frontend)
   - Sends a `<schedule-fired>` message to the agent via `chatSession.send()`
   - Listens for `chatSession.once("done")` to broadcast updated history via SSE

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

Each thread gets its own schedule file at `.callback-box/thread-schedules/<threadRef>.json`. Schedules are cleared when a thread session expires (50 messages or 24 hours).

No alarm or announce support — Telegram schedules are simple wakeup messages. For longer-term reminders, the agent should create a job card instead.

## Key Files

| File | Role |
|------|------|
| `src/core/chat-schedules.ts` | `ChatScheduleManager`, `parseScheduleTags()`, `parseCancelScheduleTags()`, schedule persistence |
| `src/core/chat-session.ts` | `CHAT_SYSTEM_PROMPT` (scheduling instructions for the agent) |
| `src/core/chat-session-pool.ts` | Per-thread schedule managers for Telegram, `deliverResponse` callbacks |
| `src/core/chat-thread-session.ts` | `turn-text` event, `fullTurnText` accumulator, `SCHEDULING` prompt section |
| `src/webapp/routes/chat.ts` | Server-side: schedule creation on turn-text, onFire handler, wires the schedule manager into `webapp/chat-runtime.ts` |
| `src/webapp/trpc/routers/chat-control-procedures.ts` | `schedules` query, `cancelSchedule` mutation |
| `src/frontend/src/components/chat/InteractiveChat-layout.tsx`, `InteractiveChat-controls.tsx` | `SchedulePill`, alarm/TTS |
| `src/frontend/src/components/chat/InteractiveChat-ws.ts` | Subscribes to the box event stream (`schedule-fired`, `chat-history`) over the shared WebSocket |
| `src/frontend/src/components/chat/message-parsing.ts` | `stripUserDisplayTags()`, hidden schedule-fired messages |

## API

- `trpc.chat.schedules` (query) — List active schedules
- `trpc.chat.cancelSchedule` (mutation, `{ label: string }`) — Cancel by label

## Known Issues / Future Work

- **Telegram schedule delivery on restart**: If the server restarts, schedule timers are re-armed from disk but the `deliverResponse` callback (which sends to Telegram) is lost. The schedule fires but the response only goes to the session log, not to Telegram. This is acceptable for short-term timers.
