---
title: "bbx remind: one command for check-ins and reminders"
status: draft
workstream: turn-feedback
issues:
  - ../../../issues/bugs/2026-08-25-chat-timer-over-25-days-fires-instantly.md
---
# bbx remind: one command for check-ins and reminders

The chat agent has two ways to come back later: a `<schedule>` tag (a check-in
inside one conversation) and a scheduled-script card with `notify:` (a reminder
that reaches the person anywhere). The tag is read only after the turn ends,
so the agent never learns that a tag was rejected or misfired. The card is
YAML the agent writes by hand. This plan replaces both agent-facing forms with
one `bbx remind` command that answers inside the turn, and caps check-ins at a
length that fits a conversation.

**Issues addressed:**
- [chat-timer-over-25-days-fires-instantly](../../../issues/bugs/2026-08-25-chat-timer-over-25-days-fires-instantly.md) — resolved by this plan.
- Related, already landed in this workstream: [agent-narrated-an-invented-root-cause](../../../issues/bugs/2026-08-25-agent-narrated-an-invented-root-cause.md) (prompt rule, commit `9b238136c`). The misfire triggered it, but the rule covers any internal failure, so it is not tied to this plan.
- Queue search: `bin/issues search "chat schedule"`, `"reminder"`, `"setTimeout"`. No other open issue covers chat timers or reminder authoring.

**Review:** cross-model plan review round 1 (codex gpt-6-astra, 2026-10-18).
Its findings are folded in below; the three that need the boxholder are in
*Open design questions* as D1–D3.

## Design

### Situations

- When Priya says "remind me to check the rice in 20 minutes" while she cooks, I want the box to ring in this chat in 20 minutes, so I can stop watching the clock.
- When Priya tells the box about a lent stepladder and says "check with me in a month whether Tomas got it back", I want a reminder that reaches her phone in a month, even if this chat is long closed, so I can stop carrying it.
- When the agent sets a reminder, I want to see the time it is scheduled for ("Tue 18 Nov, 9:41"), so I can correct it if the box understood "next Tuesday" wrongly.
- When a reminder cannot be set (no channel can reach Priya, or the time is malformed), I want to be told so in the same reply, so I do not stop carrying it.
- When Priya is just talking ("I should call the vet sometime"), she does not want a reminder. The box sets one only when asked, or offers one as a question.

### Right place, right time

| Situation | Act, show, or quiet | Surface and card | Attention |
|---|---|---|---|
| Rice check-in | Act | This chat; the existing schedule pill shows the countdown | Interrupts when it fires (alarm if asked) |
| Month-out reminder | Act | A reminder card in `_config/schedules/`; a notification when due | Background until due, then interrupts at the card's loudness |
| Scheduled time shown | Show | The agent's reply quotes the time `bbx remind` printed | Read in the turn |
| Cannot set | Show | The agent's reply says it is not set and why | Read in the turn |
| Just talking | Quiet | Nothing, or a question in the reply | None |

### Spirit

- **Serves:** "You should be able to see the gears" — the command prints what it made (the card path or the check-in) and when it is scheduled, so the agent repeats a fact, not a hope.
- **Risks:** "It should feel like a place" — a reminder card is a file the person did not write. Guard: the card is the same reminder card the box already uses (`instructions.ts:41-58`, "Example: a reminder"), committed with a plain message, and listed in `bbx scheduled`.

### Trust

Setting a reminder the person asked for is automatic, as today. An unasked
reminder stays a question in the reply. No rung changes.

### When it goes wrong or does nothing

- A check-in longer than the cap: the command refuses, says the cap, and names `--in`/`--at` without `--here`. The agent retries in the same turn; the person sees one reminder.
- No channel can reach the person at the chosen loudness: the command refuses and says how to turn a channel on. The agent tells the person, per `guide.md:468`: *"if nothing can reach the person, say so instead of promising."*
- A malformed, past, or nonexistent local time: the command refuses with the accepted forms.
- The conversation ends: its check-ins end too (D1 defines "ends"). A reminder card is unaffected.
- The card was written but the commit failed: the command says the reminder **is** active, gives its path, and says not to recreate it.

### Walkthrough

Priya types "check with me in a month whether Tomas returned the stepladder".
The agent runs `bbx remind --in 30d "Did Tomas return the stepladder?" --context _content/lending/lent.card`.
The command computes the instant from box time, checks that a channel reaches
her at the card's loudness, writes
`_config/schedules/remind-did-tomas-return-the-stepladder-<stamp>.scheduled-script.card`
with `at` (explicit offset), `once: true`, `requested-by: boxholder`, and
`notify:`, commits it, and prints
`Reminder scheduled for Tue 2026-11-18 09:41 CST: "Did Tomas return the stepladder?" (_config/schedules/remind-….scheduled-script.card)`.
The agent replies "I'll remind you on Tue 18 Nov." On the first scheduler tick
at or after that time the scheduler sends the notification and deletes the
card. Tapping it opens a new chat with the lending card as context.

## Smallest fix and budget

**Smallest fix:** clamp `armTimer`'s delay to 2^31−1 ms and re-arm
(`core.ts:290-301`), and log a rejected tag. This makes a 30-day chat timer fire
on time. It does not fix the problem the boxholder named: a chat timer is the
wrong tool for a month-out reminder, the hub keeps a box awake for as long as a
chat schedule is pending (`src/hub/AGENTS.md:55`, *"Chat schedules override
idle-stop"*), and a rejected tag is still silent to the agent.

**Chosen design:** four tracks, plus a fifth if D2 is accepted. Estimated
~330 source lines and ~300 test lines (additions plus deletions); Track 5 adds
~40 and ~60. Authored docs and prompt text ~80 lines. Not a big change. The
fuller design buys in-turn errors and one surface for the agent; the
boxholder chose it over "keep two surfaces, cap the tag" on 2026-10-18.

## Stated preferences this plan trades against

- **Code-style defensiveness rule 5, "User-initiated actions never silently no-op".** The tag's silent skip (`tags.ts:23-33`, `log("Skipping <schedule> tag without 'in' attribute"); continue;`) violates this. A command with an exit code satisfies it.
- **Memory: minimize invented concepts; prefer primitives.** `bbx remind` is a new verb. It adds no stored shape: check-ins stay `ChatSchedule` entries, reminders stay scheduled-script cards. Keeping the `<schedule>` tag parser is a second way to make a check-in; Track 4 bounds it.
- **The boxholder: "the scheduler's ergonomics are a bit weighty for the agent".** The command writes the card; the agent no longer writes YAML for the common case. The card format stays documented for edits and watches.
- **Bias toward strict.** The command refuses (exit 1) on an over-cap check-in, a past, malformed, or nonexistent time, or no reachable channel, rather than warning and proceeding.
- **`beebox/AGENTS.md`: "Long-running timeouts use `startAwakeTimeout`".** Check-ins keep `setTimeout`; the 12 h cap is what makes that tolerable. Moving them is NOT in scope.

## What already exists

- `ChatScheduleManager.addSchedule` (`src/core/chat/schedules/core.ts:156`) — stores and arms a check-in with a `sessionId`. **Reuse, with one change:** it arms before saving (`core.ts:184-185`) and `saveToDisk` only logs a write failure (`core.ts:386`), so a "set" reply can survive only until restart. Track 1 makes a save failure undo the entry and throw.
- `chat.schedules` / `chat.cancelSchedule` tRPC procedures (`src/webapp/trpc/routers/chat/control-procedures.ts:425-434`). **Extend** with session-scoped add and cancel. `cancelByLabel` (`core.ts:231`) cancels the first match box-wide.
- `boxClient()` (`src/cli/lib/box-client.ts:45`) — tRPC client authenticated with `BBX_AGENT_TOKEN`. `resolveChatSessionId` (`src/core/chat/session/id-file.ts:103`) finds the running chat's session. `bbx chat ui` (`src/cli/commands/chat/ui.ts:26-48`) is the precedent for a session-scoped agent command. **Reuse.**
- `createScheduledScriptTemplate` (`src/schemas/scheduled-script/schema.tsx:228`) — validates and serializes a card, but requires `runs:` (`fields["runs"] = options.runs;`). **Extend** with `notify` and `requestedBy`.
- `parseDuration` (`src/scheduled-script-duration.ts`, re-exported at `schema.tsx:18`) — units `s/m/h/d/w`. **Reuse.**
- `bbx notify --check` (`src/cli/commands/notify/command.ts:174`, private `check()`) — succeeds when any channel reaches the person, but `dot` uses APNs only (`core/notification/channels.ts:31`). **Export the reachability logic and evaluate it for the card's loudness.**
- Box timezone loader (`src/core/box/config.ts:177`) and `getBoxTime` (`src/lib/time.ts:50`). An offset-less `at` is read by `new Date(script.at)` in the server process's zone (`due.ts:42`), which may differ from the box's. **The command converts in the box zone and writes an explicit offset.**
- Path-scoped commit helper (`src/lib/git/core/operations.ts:369`). **Reuse** for the card commit.
- `bbx chat self-note` route (`src/webapp/routes/chat/send-routes.ts:104`) — injects a note into a session transcript. **Reuse** to tell a session that a tag was rejected (Track 4).

## Prior art (external)

No decision depends on an external premise beyond Node's timer limit:
`setTimeout` delays above 2^31−1 ms become 1 ms with a `TimeoutOverflowWarning`
(https://nodejs.org/api/timers.html#settimeoutcallback-delay-args). Evaluated-only.

## Ontology

- **Check-in** — a `ChatSchedule` entry (`core.ts:26-40`), identified by `id`, owned by one `sessionId`, fires back into that conversation as `<schedule-fired>`. Not a notification to the person's phone. The UI calls it a schedule pill; the agent-facing word becomes "check-in".
- **Reminder** — a scheduled-script card with `at`, `once: true`, `requested-by: boxholder`, and `notify:` (`instructions.ts:41-58`). Identified by its card path. Reaches the person wherever they are. Not tied to a conversation.
- **Check-in cap** — 12 hours. A longer check-in is refused.
- **`bbx remind`** — the agent's verb for both. `--here` selects a check-in; its absence selects a reminder.

## Tracks / scope

### Track 1 — check-in cap and honest persistence in the manager

- **What:** `addSchedule` refuses a duration above `CHECK_IN_MAX_MS` and refuses when the save fails; `armTimer` clamps to 2^31−1 ms as a backstop for entries persisted before the cap.
- **Why:** the overflow fires a long timer at once (`core.ts:297`, `setTimeout(..., delay)` with no bound); a failed save is reported as success.
- **Direction:** `export const CHECK_IN_MAX_MS = 12 * 60 * 60 * 1000;`, `class CheckInTooLongError`, and `class CheckInNotSavedError` in `core.ts`. `addSchedule` saves before arming; on a write error it removes the entry and throws. The `turn-text` handler (`register.ts:133-146`) catches per tag, so one rejected tag does not abort cancellations or callout notifications after it.
- **Vocabulary lock-ins:** `CHECK_IN_MAX_MS`, `CheckInTooLongError`, `CheckInNotSavedError`.
- **First chunk:** constant, errors, save-before-arm, clamp, per-tag catch. Tests in `core.addSchedule.test.ts`: 20m accepted; 13h refused; a save failure leaves no armed timer; a persisted 30d entry is armed without firing.

### Track 2 — server procedures for a session's check-ins

- **What:** `chat.addCheckIn({ sessionId, in, label, alarm?, announce?, content })` and `chat.cancelCheckIn({ sessionId, label })`.
- **Why:** the check-in timers live in the `bbx serve` process; the CLI must reach them, and cancel must not hit another chat's same-label check-in.
- **Direction:** returns `{ id, label, firesAt }`. `BAD_REQUEST` for a bad or over-cap duration; `NOT_FOUND` for a session being deleted (`ScheduleForDeletingSessionError`, `core.ts:52`) or ended (D1); `INTERNAL_SERVER_ERROR` naming `CheckInNotSavedError`. The open chat's pills refresh when the turn's transcript entry lands (`hooks.ts:84`), as today; no new bus event.
- **First chunk:** both procedures, tested against a real manager in a temp box, including two sessions with the same label.

### Track 3 — `bbx remind`

- **Forms:**
  - `bbx remind --here <duration> <text> [--label <l>] [--alarm] [--announce <text>]` — a check-in in the current chat (session from `resolveChatSessionId`).
  - `bbx remind (--in <duration> | --at <datetime>) <title> [--body <text>] [--loudness dot|quiet|loud] [--context <card>]` — a reminder card, committed.
  - `bbx remind cancel <label>` — cancels a check-in in this chat. A reminder card is removed as any card is (`bbx trash`); the output of the create form says so.
- **Output:** one line naming what was made and when it is scheduled, in the box zone with weekday and zone abbreviation, e.g. `Check-in "rice" in 20m (18:42 CDT), this chat.` / `Reminder scheduled for Tue 2026-11-18 09:41 CST: "…" (_config/schedules/remind-….scheduled-script.card)`.
- **Card identity:** `_config/schedules/remind-<slug>-<yyyymmddhhmm-of-creation>.scheduled-script.card`, created exclusively (`wx`). A fresh name per reminder matters because scheduler state is keyed by the filename stem (`core/schedule/state.ts:151`), `once` cleanup deletes only the card (`tick-utils.ts:189`), and an `at` card is due only while `!ctx.lastRun` (`due.ts:44`): reusing a name would inherit a finished reminder's state and never fire.
- **Time:** `--at` without an offset is read as box-zone wall time; a nonexistent (spring-forward) or ambiguous (fall-back) local time is refused with "add an offset". When the box has no timezone (`loadBoxTimezone` returns `null`, `config.ts:177`), an offset-less `--at` is refused with the same remedy, and the echo uses UTC. `--in` adds to `getBoxTime`. A past instant is refused. The card's `at` carries the offset.
- **Refusals (exit 1):** `--here` without a chat session; over-cap `--here` (names `--in`); bad, past, or nonexistent time; no channel reaches the person at the card's effective loudness (the default per `instructions.ts:28` when `--loudness` is omitted); `box-client-unavailable` (names the missing env var).
- **Partial success (exit 0, stderr warning):** the card is written but the path-scoped commit fails. Message: `Reminder is active (… path …); the commit failed: <git error>. Do not recreate it.`
- **Registration:** `src/cli/entry/surface-data.ts` with `audience: "agent"` and a smoke run of `bbx remind --help`.
- **First chunk:** template extension and the reminder form. Tests over a temp box with `BBX_NOTIFY_FAKE=1`: card content and commit; same title twice gives two cards; create → simulated success state → create same title → second is due; past-time and no-channel refusals; browser-only box with `--loudness dot` refused; box zone differs from host zone; a spring-forward time refused.

### Track 4 — agent-facing guidance and the tag

- **What:** the chat prompt's Scheduling section (`prompts.ts:175-183`) is rewritten around `bbx remind`; `guide.md:482` and the skills content (`guidance-sync/skills/content.ts:173,187`) point at it; the reminder example in `instructions.ts:41-58` shows the command first and the card it writes. `docs/chat/schedules.md` and `docs/notifications.md` follow.
- **The tag:** `<schedule>` leaves the prompt. Any session can still emit one, for example by copying its own earlier turns, so the parser stays with the same cap. A rejected tag (over-cap, missing `in`, bad duration) gets a self-note into that session — `Your <schedule label="…"> was not set: <reason>. Use bbx remind.` — so the agent's next turn sees it. This is a fallback, not the in-turn error the command gives. Removing the parser is a later cleanup.

### Track 5 — reminder cards are not held back by chat activity (pending D2)

- **What:** a due card whose action is `notify:` (no `runs:`) is exempt from the active-chat busy blocker and the engine-quota gate.
- **Why:** `runTick` returns before reading any card while a chat is active (`tick.ts:91-102`), and chats can stay active for hours (`tick-helpers.ts:63-66`); every due card also passes the engine-quota gate (`tick-helpers.ts:138-141`). A notify card runs no agent and no shell, so neither guard protects anything for it, and a reminder is delayed exactly while the person is talking to the box.
- **Direction:** the busy-blocker check moves after card parsing for chat blockers only: notify cards run, other cards defer as today. Script and procedure blockers still defer everything.
- **First chunk:** the split and a tick test with an active chat lock: a due notify card sends; a due `runs:` card defers.

## Could this be simpler?

The simplest version is the clamp alone (see Smallest fix). It fails the
month-out case's second half: the reminder lands only in a chat the person may
never reopen, and the box stays awake for a month under a lazy hub. The next
simplest is the boxholder's rejected option: cap the tag and show a "not set"
notice after the turn. That fails "tell me in the same reply": the agent has
already said "Reminder set" by the time the server reads the tag. The command
is the smallest form that returns an answer before the agent speaks.

Cut after review: cancelling reminder cards through `bbx remind cancel` (the
agent removes a card as any card), and a new bus event for pill refresh.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Agent passes `--here 30d` | Track 3 test | Refusal naming `--in` | Clear (exit 1) |
| A session emits `<schedule in="30d">` | Track 4 test | Cap; self-note to the session | Clear to the agent one turn late |
| One rejected tag in a turn with a `<cancel-schedule>` after it | Track 1 test | Per-tag catch | Clear (cancel still applies) |
| Persisted entry over 2^31−1 ms from before the change | Track 1 test | Clamp and re-arm | Clear (fires on time) |
| `chat-schedules.json` write fails | Track 1 test | Undo and throw | Clear (exit 1) |
| `--here` outside a chat (a job, a schedule) | Track 3 test | Refusal: no session | Clear |
| Server not running / `BBX_AGENT_TOKEN` missing | Track 3 test | `box-client-unavailable` names the var | Clear |
| No channel reaches the person at this loudness | Track 3 test | Refusal, names Admin → Host → Notifications | Clear |
| `--at` with no offset, box zone ≠ host zone | Track 3 test | Converted in box zone, written with offset | Clear (echoed) |
| Same title as a finished reminder | Track 3 test | Fresh filename per reminder | Clear (fires) |
| Commit fails after the card is written | Track 3 test | Partial-success message | Clear: "active, do not recreate" |
| Reminder due while a chat is active | Track 5 test | Notify cards skip the chat blocker (D2) | Without Track 5: silent delay |
| Notification send fails once at fire time | Existing: `run-action.ts:73`, `state.ts:236` | Failure recorded; health shows it; `at` card not retried | **Silent to the person** (D3) |
| Box clock shifted in tests vs chat manager's `Date.now()` | — | Check-ins keep `Date.now()` | Documented risk, as today |

> **Critical gap (D3):** a reminder whose single send attempt fails at fire
> time is never retried: the failure sets `lastRun`, and `at` is due only while
> `!lastRun`. This exists today for hand-written reminder cards. This plan does
> not add retry machinery; D3 asks whether to accept and document it or file it
> as its own fix.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field:** the agent uses `--here` for a reminder. ADDRESSED: over-cap refusal; under the cap the prompt's rule ("`--here` only comes back to this conversation") covers it, and the `remind-check-in` audit checks it.
- **Stale ref:** `--context` names a card moved before the reminder fires. ADDRESSED by existing behavior: the notification's `Context:` line is text, and the tap opens a new chat.
- **Two agents touching the same card:** two turns create reminders with the same title. ADDRESSED: each gets its own file.
- **Hand-edit drift:** the person edits the card's `at` by hand. ADDRESSED: it stays an ordinary scheduled-script card validated by the existing schema.
- **Fabricated free-form value:** the agent invents a time for "next week". ADDRESSED: the command echoes the resolved time, and the prompt tells the agent to repeat it.
- **Validation error UX:** ADDRESSED: each refusal is one sentence that names the fix.
- **Partial migration:** ADDRESSED in Track 4: the tag parser stays, capped, with a self-note on rejection.

## NOT in scope

- Natural-language times ("next Tuesday") in the command — the agent resolves them; the echo catches mistakes.
- Repeating reminders (`rrule`, `cron`) — the card format already covers them; the command does one-shot only.
- Watches ("tell me when…") — stay hand-written cards with `bbx changes` / `bbx judge`.
- Moving check-ins to `getBoxTime` or `startAwakeTimeout` — separate concern; the cap bounds the exposure.
- Session-scoped pill listing and the pill's box-wide cancel (`control-procedures.ts:425-434`) — existing UI behavior, unchanged.
- Retrying a failed reminder send — see D3.
- Removing the `<schedule>` parser — a later cleanup.

## Open design questions

- **D1 — what "the conversation ends" means for a check-in.** Today a fire into an unavailable or failing session falls back to a brand-new chat (`schedule-fire.ts:154-158`, `:177-190`), and deletion is the only event that cancels (`detachForSession`). Lean: a check-in fires only into its own conversation, never a fresh one; deleting **or archiving** the chat (`control-procedures.ts:201`) cancels its check-ins; a chat that is merely idle or evicted keeps them. A dropped fire logs at `console.warn` with the label.
- **D2 — Track 5.** Lean: include it. A reminder held for hours while the person is chatting is the failure this plan exists to remove; the change is local to `runTick`.
- **D3 — one-attempt delivery.** Lean: accept and document it in this plan, and file an issue for bounded retry (code-style rule 9: bound a retry in time, then a visible terminal state).
- **The 12 h cap.** Lean: 12 h covers "check back this afternoon" and an evening alarm; anything longer is a reminder.

## Knowledge audits

- Update `remind-vs-schedule` (`knowledge-audits.yaml:8284`): expects `bbx remind --at|--in`, still fails on `<schedule `.
- Add `remind-check-in`: "remind me to check the rice in 20 minutes" → `bbx remind --here 20m`; fails on a card or a `<schedule` tag.
- Both run against the worktree's test1 clone before landing; status comments recorded.

## What will hold this after it ships

Unit tests over the manager (cap, clamp, save failure), the procedures (temp
box, real manager), the command (temp box, `BBX_NOTIFY_FAKE=1`), and the tick
(Track 5). Time resolution, slug naming, and loudness reachability are pure
functions in the command module, tested directly. The two knowledge audits
hold the agent's choice. No new test tier.

## Implementation order

1. Track 1 (manager cap, save-before-arm, clamp, per-tag catch) — closes the overflow on its own.
2. Track 2 (procedures), with D1's fire-target change.
3. Track 3 (command): template extension, reminder form, `--here`, `cancel`.
4. Track 5 if D2 is accepted.
5. Track 4 (prompt, guide, skills content, docs, audits).

## Rollout shape

Done when: Track 1–3 (and 5) tests pass; `bbx remind --help` smoke passes; the
two audits pass on the worktree's test1 clone; a manual run on test1 sets a
2-minute check-in that fires in its chat, and a 2-minute reminder card whose
notification is sent (`BBX_NOTIFY_FAKE=1` log line `sent (fake)`) while a chat
is active. No data migration: existing chat schedules and cards keep their shapes.
