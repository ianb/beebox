# Chat check-ins

A check-in is an agent-initiated timer that comes back to **one conversation**:
an alarm, "check back this afternoon", a nudge if the user goes quiet. It can
play an alarm sound or a TTS announcement, then wakes the agent in that
conversation. It is at most 12 hours long (`CHECK_IN_MAX_MS`,
`src/core/chat/schedules/check-in.ts`) and ends when its conversation ends. A
reminder for another day is a reminder card (`bbx remind --at|--in`, see
`card-scheduled-script` instructions), which reaches the person wherever they
are. The code still calls a check-in a `ChatSchedule`.

## How it works

### The agent sets a check-in

From inside its turn, with `bbx remind --here`:

```bash
bbx remind --here 5m "Ask about the meeting outcome" --label "check back" --alarm --announce "Time to check in!"
bbx remind cancel "check back"
```

The command calls the `chat.addCheckIn` / `chat.cancelCheckIn` tRPC
procedures (`src/webapp/trpc/routers/chat/check-in-procedures.ts`) with the
chat's session id, so a refusal (over 12 hours, a bad duration, a chat being
deleted) comes back to the agent before it answers. Cancel is scoped to the
conversation.

### The legacy tag

Older turns used a tag in the response text, and a session may still copy it:

```xml
<schedule label="check back" in="5m" alarm="1" announce="Time to check in!">
Remember to ask about the meeting outcome.
</schedule>
<cancel-schedule label="check back" />
```

The tag is no longer in the agent prompt. The server still reads it after the
turn (`chatSession.on("turn-text")` in `src/webapp/routes/chat/register.ts`),
with the same cap. A tag that is unreadable or refused is not dropped quietly:
the server queues a `<self-note>` into the session saying it was not set, so
the agent's next turn corrects what it told the user.

### Server-side lifecycle

1. `ChatScheduleManager.addSchedule` (`src/core/chat/schedules/core.ts`) refuses a check-in over the cap, saves `.beebox/chat-schedules.json` **before** arming, and undoes the entry if the save fails. Each entry records its **originating session id** (`sessionId`).
2. `armTimer` waits out Node's 2^31−1 ms timer limit in steps for any entry saved before the cap, so a long entry never fires early.
3. When a timer fires, `fireChatSchedule` (`src/webapp/routes/chat/schedule-fire.ts`) first checks the target, then broadcasts `schedule-fired` (alarm/announce data), resumes the originating session, and sends it a `<schedule-fired>` message.

### A check-in never moves to another conversation

`fireChatSchedule` drops the fire, with a `console.warn` naming the label and
before any alarm, when:

- the entry has no `sessionId` (persisted before that field existed; its conversation is unknown);
- the session is being deleted, or cannot be resumed (`resolveSessionAvailability` says `unavailable`; an archived chat is one);
- the fired turn fails or the chat's model can no longer run.

Deleting a chat detaches its check-ins (`detachForSession`); archiving one does
too. There is no fresh-session fallback (boxholder, 2026-10-18: if the
conversation ends, the check-in ends).

### Frontend display

- `SchedulePill` components (in `InteractiveChat-layout/view/ChatComposerSection.tsx`/`InteractiveChat-controls.tsx`) show active schedules with live countdown
- Schedules are fetched via the `chat.schedules` tRPC query on mount and after each turn
- User can cancel schedules via the × button on each pill, which calls the `chat.cancelSchedule` tRPC mutation

### Frontend receives the agent's response

The agent's schedule-fired response reaches the UI over the shared WebSocket: the server broadcasts `schedule-fired` (triggers alarm/TTS) and `chat-history` on the box's event-bus stream, and `InteractiveChat/ws.ts` subscribes to that stream via tRPC's `events.subscribe`.

### Hidden system messages

The `<schedule-fired>` message sent to the agent is a user-type message wrapped in XML tags. `stripUserDisplayTags()` (`src/frontend/src/components/chat/message-parsing.ts`) strips these tags for display — if a user message is empty after stripping, it's hidden entirely (visible only in debug view).

## Key files

| File | Role |
|------|------|
| `src/core/chat/schedules/core.ts` | `ChatScheduleManager`, `parseScheduleTags()`, `parseCancelScheduleTags()`, schedule persistence |
| `src/core/chat/schedules/check-in.ts` | `CHECK_IN_MAX_MS` and the errors `addSchedule` throws |
| `src/webapp/trpc/routers/chat/check-in-procedures.ts` | `addCheckIn`, `cancelCheckIn` (used by `bbx remind --here`) |
| `src/core/chat/session/prompts.ts` | `CHAT_SYSTEM_PROMPT` ("Coming back later" teaches `bbx remind`) |
| `src/webapp/routes/chat/register.ts` | Server-side: legacy tag parsing on turn-text (stamps the originating `sessionId`, self-notes a rejection), wires the schedule manager into `webapp/chat-runtime.ts` |
| `src/webapp/routes/chat/schedule-fire.ts` | `fireChatSchedule` — checks the originating session, then injects the fired check-in or drops it |
| `src/webapp/trpc/routers/chat/control-procedures.ts` | `schedules` query, `cancelSchedule` mutation |
| `src/frontend/src/components/chat/InteractiveChat-layout/view/ChatComposerSection.tsx`, `InteractiveChat-controls.tsx` | `SchedulePill`, alarm/TTS |
| `src/frontend/src/components/chat/everywhere/InteractiveChat/ws.ts` | Subscribes to the box event stream (`schedule-fired`, `chat-history`) over the shared WebSocket |
| `src/frontend/src/components/chat/message-parsing.ts` | `stripUserDisplayTags()`, hidden schedule-fired messages |

## API

- `trpc.chat.schedules` (query) — List active schedules
- `trpc.chat.cancelSchedule` (mutation, `{ label: string }`) — Cancel by label

## Restart and lazy-hub behavior

Schedules persist to `.beebox/chat-schedules.json` and are re-armed when a box's `bbx serve` process boots (overdue-unfired entries fire immediately). Because the timers live in that process, a lazy `bbx hub` (`lazy: true`, which idle-stops boxes) must not stop or fail to start a schedule-holding box: it keeps any box whose `chat-schedules.json` holds an entry running instead of idle-stopping it, and pre-starts such boxes at hub boot (independent of `keepRecent`), so a schedule fires on time even after a hub restart. See `src/hub/AGENTS.md` (Lazy mode) and `src/hub/supervisor/pending-schedules.ts`.
