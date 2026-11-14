---
title: "Activity triggers: agent-written functions that watch what a person does and respond"
status: active
workstream: activity-triggers
issues:
  - ../../../issues/exploration/2026-10-18-interactive-triggers-in-educational-material.md
---
# Activity triggers

A chat agent writes a trigger: a TypeScript function in the box that reads the
activity a person produces in a view or figure and decides whether to respond.
The agent arms it for the current chat with a JSON config. When the function
returns a result, the person sees its text at once, labeled with the trigger's
name, and the agent gets a turn carrying the text, a hidden note, and the
activity. The function may call Jev, the small judging model, to decide or to
compose. Triggers expire by default, may ask for a periodic tick, and leave a
trace the agent can read.

**Issues addressed:** `issues/exploration/2026-10-18-interactive-triggers-in-educational-material.md`
(the general mechanism it asks for; the courseware-only questions in it stay
open). Related, not resolved:
`issues/exploration/2026-09-15-generic-trigger-tag-programmatic-scope-plus-natural-language.md`
(triggers over card and time changes at wakeup; same anatomy, different stream;
see NOT in scope),
`issues/features/2026-10-08-course-session-cannot-open-with-the-tutor.md` (a
turn nobody typed; this plan adds one such turn kind but not a chat opener),
`issues/decisions/2026-11-13-isolate-view-and-figure-code.md` (trigger code
runs on the server in a child process, not in the page; no change to that gap).
Queue searched for "trigger", "stuck", "interactive", "activity log", "tutor":
nothing else open.

## Design

### Situations

- When Juni has the molecule builder open beside the chat and finally bonds
  two H to one O, I want the box to say "That's water" the moment it happens,
  so I don't have to type "did I get it?" and wait.
- When Juni has been moving atoms for four minutes without closing a bond, I
  want the tutor to notice and offer one hint, so I am not stuck in silence
  and not interrupted every few seconds either.
- When Wren builds H-O-H with the bonds on the wrong atoms, I want the tutor to
  react to that particular mistake, so the next thing I read is about what I
  did and not a generic "try again". (The trigger asks the judge which of the
  mistakes the tutor listed this is, and shows the text the tutor wrote for
  that one; the judge does not write prose.)
- When Priya is scrolling a budget view while talking about the month, I do
  not want the box watching for anything; if the agent did set a watch, I want
  to see that it did and be able to say "stop that" in the chat.
- When the tutor's trigger is wrong and never fires, I want the tutor to be
  able to find out why without me reporting it, so the next attempt works.

### Right place, right time

| Situation | Act, show, or quiet | Surface and card | Attention |
|---|---|---|---|
| Juni makes water | show: the trigger's text appears in the chat; then the agent's turn | chat, beside the figure | waits to be found in the chat column; no sound, no banner |
| Juni stuck | quiet until the trigger's tick decides; then show as above | chat | same |
| Wren's wrong bonds | show, the text the tutor wrote for the mistake the judge picked | chat | same |
| Priya's budget | quiet; one line in the chat column says what is being watched, so she can object | chat column, above the composer | background |
| A trigger that never fires | quiet for the person; the trace log and a dry run for the agent | `bbx chat trigger log` and `run` | none |

The response goes to the chat, not a notification: the person is present and
in the view, and the chat is where the agent's own words already appear.

### Spirit

- **Serves:** "It should feel possible" — the agent can build "tell me when I
  get it right" from a function and a command, with no new card type.
  "You should be able to see the gears" — every evaluation, judge call and
  verdict is a trace line the agent reads back; the person sees that a trigger
  is armed and can ask what it is watching for.
- **Risks:** "It should feel like a place" — a place that watches for things
  can feel like surveillance. Guards: the chat column names the watch while it
  is armed; triggers expire by default; the person's "stop watching" ends it.
  "People aren't broken versions of their better selves" — a stuck-detector
  can nag. Guard: the trigger decides once per tick, the agent writes the
  text, and the default expiry ends it; nothing repeats without the function
  choosing to.

### Trust

- **Arming** is automatic for the agent, and visible: the status line in the
  chat column and the agent's own prose. A person's "don't watch me" is an instruction the agent
  records in the usual guidance sinks; nothing in this plan automates that.
- **Firing** shows text the agent wrote or composed. It takes no action on the
  box. The agent's turn after a fire follows the agent's ordinary rules.
- **Judge calls** spend the existing daily Jev budget. No new permission.

### When it goes wrong or does nothing

- The function throws or times out: the person sees nothing new in the chat;
  the status line changes to "Water check: not working"; the agent's next
  message hint says a trigger failed, and `bbx chat trigger log` shows the
  error, the stack, and every trace line the child sent before it died. The
  agent fixes the file; the next evaluation uses it.
- The judge is unavailable or over budget: the function receives an
  `unavailable` verdict and decides. The trace says so.
- Nothing matches: no fire, a trace line per evaluation saying "no result",
  and the status line stays "Watching: Water check".
- The result cannot be delivered to the chat: the activation stops as
  "not working" with the delivery error; nothing is retried; the agent sees
  it in the hint and the trace.
- The trigger expires: the status line goes at the deadline; the agent's
  next hint says one expired; the trace says which and why. The person who
  wanted it back asks the agent, who arms it again.
- The person says "stop watching me": the agent runs `bbx chat trigger disarm`;
  the status line goes at once, and an evaluation already running for it is
  discarded when it returns.

### Walkthrough

Juni has `Molecule_Builder.figure.card` open beside the chat and says "tell
me when I make water." The tutor writes
`src/triggers/water-check.ts` exporting `label`, `trigger` and `tick`, then
runs `bbx chat trigger arm src/triggers/water-check.ts --config '{"target":"H2O"}'`.
The command compiles the file in a child process, calls `label(config)` to
get "Water check", reads `tick` (60 seconds), validates the config, and
writes an activation to `.beebox/triggers/<session>.json` with the default
expiry (20 person turns or 2 hours), and a deadline two hours out. It prints
the activation and the expiry. The command emits `trigger-changed` for the
session; the server's runner starts a tick timer and a deadline timer, and
Juni's chat column shows "Watching: Water check" above the composer. The
tutor replies "I'll say so the moment you get it."

Juni adds O, H, H, and bonds them. Each handled input is an activity entry
with the sketch's `activity(model)` data, queued by the page and posted to
`activity.record`. After the append, the server sees the batch names Juni's
session, which has an armed activation, and starts the settle timer (one
second after the latest batch, at most three seconds after the first). When
it fires, the runner reads the session's entries from the log and spawns
`bbx chat trigger eval-one` with the activation, the entries above
`lastEvalSeq`, and the history since arming. The child compiles the trigger
file, imports it, and calls `trigger({ reason: "activity", entries, history,
sinceLastActivityMs }, ctx)`. The function reads the last entry's
`activity.molecules`, finds `H2O`, and returns
`{ text: "That's water. Two hydrogens, one oxygen.", note: "Correct on the
first full attempt; 11 actions, no judge call.", done: true }`. The child
has been streaming trace records as JSON lines; its last line is the result.
The runner, under the session's trigger lock, rereads the activation, sees it
is still armed and unexpired, advances `lastEvalSeq`, and delivers a
`<trigger>` message to the session with `user: null`. Delivery returns sent
or queued, so the runner writes `fires: 1`, `state: "done"`, appends the
trace, and emits `trigger-changed`. Juni's chat shows a chip labeled "Water
check" with the text. The tutor's turn starts with the wrapper, which carries
the text, the note, and `entries="11"`; `bbx chat activity` lists Juni's
actions since her last message, since the person cursor has not moved. The
tutor writes "Nice. Want to try ammonia?" or acks. The status line is gone.
Left behind: the trigger file (in git when the agent commits), the activation
with `state: "done"`, the trace lines, and the chat entries.

The stuck case, same session, a second activation "Stuck check" with
`tick: 60`. Juni moves atoms for a while, then stops. Each tick evaluates with
`reason: "tick"`, `entries` empty, `history` holding every entry since
arming, and `sinceLastActivityMs`. The function looks in `history` for the
last entry whose `activity.bonds` grew, finds it eight minutes back, and
returns a hint text the tutor wrote at arm time, without `done`. A later
tick, with the same history, sees `fires: 1` in its input and returns nothing.

## Smallest fix and budget

- Smallest fix: no new mechanism. The view's own code knows the answer and
  calls `reportActivity("explored", "correct")`; the agent sees the count on
  Juni's next message. It fails the first situation: nothing happens until
  Juni types, which is what she asked not to have to do.
- Next smallest: a view calls a new `fireTrigger(text, note)` helper and the
  server delivers it. Instant, no runner, no judge. It fails the stuck
  situation (no tick), covers only views (figures stay card-unaware by the
  boxholder's rule), and gives the agent no place to put a judge call or a
  condition it can test without a browser.
- Chosen: six tracks, below.

| Track | Source | Tests |
|---|---|---|
| A: activation store, expiry rules, turn counter, trace log | 260 | 220 |
| B: evaluation child, trigger module contract, judge in ctx, streamed trace | 240 | 160 |
| C: runner: settle, ticks, deadlines, admission, delivery, hint | 340 | 260 |
| D: `bbx chat trigger` arm, list, disarm, run, log | 240 | 140 |
| E: `<trigger>` message kind, prompt, chip | 160 | 100 |
| F: status line, `triggers.list`, `trigger-changed` event | 120 | 70 |
| Total | 1,360 | 950 |

Docs about 220 lines (`box-docs/triggers.md`, views and figure instruction
changes, agent-changes, prompt paragraph). About 2,300 changed lines in all:
a **BIG CHANGE**. The size comes from the new process boundary (child
evaluation with its own command), the evaluation lifecycle (settle,
admission under a lock, defined delivery outcomes, deadlines), and the CLI
with five subcommands. The boxholder asked for durable files, per-session
activation with config, default expiry, ticks, and debugging in the
2026-11-13 and 2026-11-14 discussion; each is a track or part of one. The
boxholder approved this size on 2026-11-14 ("go ahead and implement").

## Stated preferences this plan trades against

- Boxholder, 2026-11-14: triggers are durable files; activation is per
  session with a JSON config. Tracks A and D.
- Boxholder: "it will be normal to mix code and jev"; a judge call "should
  just be an available function". Track B: `ctx.judge`.
- Boxholder: expiry is first-class with a default; unlimited only by
  assertion. Track A: `expires` required in the record, `"never"` explicit.
- Boxholder: a trigger "can receive a tick (if it chooses)". Track C: the
  module's optional `tick` export.
- Boxholder: "I do want to be able to debug this". Tracks A and D: trace log,
  dry run, replay.
- Boxholder: the person "generally sees a trigger is active". Track F.
- Boxholder, 2026-11-13 (activity-log plan): canvas-loop stays unaware of
  cards; figures do not write. Triggers read the log; canvas-loop and figures
  are untouched.
- `beebox/docs/engineering-principles.md` §4 (never silent): a failing trigger
  shows in the status line, the hint and the trace. §13 (a control shows the
  state the system is in): the status line shows the activation's recorded
  state, never "watching" while the last evaluation failed.
- `beebox/docs/adding-api-endpoints.md`: tRPC is the default. `triggers.list`
  is a tRPC query.
- Trade: evaluation spawns a process per settled batch, and each child
  compiles the trigger file cold: `bundleView`'s cache is a process-local
  `Map` (`src/webapp/views/compiler/compile.ts:69`), so nothing carries over.
  The cost is a node start plus an esbuild bundle per evaluation: about
  850 to 900 ms for a trivial trigger on the development machine
  (`test/core/triggers/eval.test.ts` prints it). Chosen over in-process
  execution so a throwing or looping trigger cannot take down `bbx serve`;
  precedent `src/webapp/views/compiler/meta-import.ts:111` runs box view code
  the same way with a 3 s timeout and `SIGKILL`. A cache that survives child
  exits is listed under NOT in scope.
- Trade: ticks run on box-wide presence. `livePresence` counts web sessions
  for the whole box with no session identity
  (`src/core/notification/presence.ts:19`), so a person in another chat keeps
  this chat's ticks running. Accepted: a tick costs a process start, spends
  judge budget only when the function asks, and ends at the deadline. A
  per-session presence signal is NOT in scope.

## What already exists

- Activity log writer and reader: `src/core/activity/log.ts:121`
  `export async function recordActivity(` (append under lock, stamps `seq`),
  `:177` `readActivity`, `:79` `lastActivitySeq`. Reuse. The runner hooks the
  tRPC procedure after this call: `src/webapp/trpc/routers/activity.ts:16`
  `const accepted = await recordActivity(ctx.boxRoot, { entries: input.entries, user: ctx.user?.email ?? null });`.
- Per-session window and cursor: `src/core/activity/cursor.ts:100`
  `export async function activityWindow(`, `:130` `advanceForSend`, `:153`
  `bindPendingChat`. Reuse `inSession` matching (`:70`) through a new exported
  `entriesForSession(lines, cursor)`; the runner needs entries above its own
  `lastEvalSeq`, not the hint window.
- Person turns: `src/core/chat/session/state.ts:243` *"One person-turn
  advances the activity cursor once, whatever it merged."* Several queued
  sends merge into one `activityTurn`, so what can be counted is turns, not
  messages. The cursor advance itself can be skipped
  (`src/core/chat/session/run/start.ts:244` *"could not advance the activity
  cursor in time; this turn carries no activity hint"*), so the turn counter
  does not live in the cursor write. It increments in `activityHintFor`'s
  caller before the cursor is attempted, whenever `rawInput.activityTurn` is
  set.
- Delivered user messages: `src/core/chat/session/deliver-user-message.ts:154`
  `export async function deliverUserMessage(opts: {`; `:196` emits
  `chat-user-message` with `user: null`. Reuse for the fire. Codec registry:
  `src/shared/delivered-user-message.ts:54` `interface DeliveredUserMessageByKind {`
  and `:133` `const DELIVERED_MESSAGE_CODECS = {`, enforced with `satisfies`
  (`:138`); `:257` serializes `<kind attrs>\nsummary\n</kind>`. Add a kind.
- Renderer dispatch: `src/frontend/src/components/chat/user-message/user-entry-content.tsx:69`
  `case "call":` in a switch ending `default: return assertNever(part)`. A
  new kind fails typecheck until it has a chip. Chip models: `CallChip.tsx:29`
  (summary line, expands), `ChatMessages/view.tsx:292` `<span>self-note</span>`
  (labeled aside for a non-person message).
- Hint composition: `src/core/chat/session/run/start.ts:216`
  `const activityChildren = [activityHint, runEnded.element ?? ""].filter((child) => child !== "").join("\n");`.
  Add a `<triggers>` child here.
- Prompt paragraphs for delivered kinds: `src/core/chat/session/prompts.ts:79`
  (`<capture>`), `:83` (`<call>`), `:145` (`<activity>`). Add `<trigger>`.
- Judge: `src/services/jev-judge.ts:24` `export interface JudgeInput {`
  (`instructions`, `questions`, `state`, optional `situation`, `model`);
  `src/core/judgment/service.ts:50` `resolveJudgeService`; budget
  `src/core/judgment/budget.ts:65` `reserveJevCalls` (cap 500 per day);
  a complete caller at `src/core/triage/judge.ts:82-89`; judgment card to wire
  shape `src/schemas/judgment/schema.ts:78` `judgmentQuestions`. Reuse all;
  `ctx.judge` is a thin wrapper.
- Presence: `src/core/notification/presence.ts:32`
  `export async function livePresence(` returns `{ activeWeb }`. Ticks run
  only while `activeWeb > 0`.
- Compiling box TypeScript for node: `src/webapp/views/compiler/compile.ts:209`
  `export async function bundleView(` with `target: "node"`; run in a child
  with timeout and `SIGKILL` at `meta-import.ts:111-114`; the CLI precedent
  that spawns a `bbx` subcommand as the child is
  `src/cli/commands/figure/run.ts:161-165` (`bbx figure run-one`). Reuse
  `bundleView`; model the child on `figure run-one`.
- CLI registration: `src/cli/commands/chat/command.ts:285` `.addCommand(activityCommand)`;
  session from the agent's environment `src/core/chat/session/id-file.ts:107`
  `resolveChatSessionId`. Reuse.
- Event bus: `src/core/event-bus/schemas.ts:85` `export const eventSchemas = {`;
  `src/core/event-bus/core.ts:55` `export const EVENT_SCHEMA_GENERATION = 11;`
  must be bumped. Frontend subscription `ws.ts:259` `useBusSubscription({`
  and `ws.ts:314` shows an injected user message at once.
- Pane scope: `src/frontend/src/lib/activity/scope.tsx:44` `usePaneCard()`
  reads `PaneCardContext`; the pane's status element precedent is
  `WorkspaceCanvas/view.tsx:79` (`bbx-companion-updating`, "Updating…",
  positioned out of flow).
- Rotating JSONL with a line cap: `src/core/notification/log.ts`. Model the
  trace writer on it, as the activity log did; do not share code.
- Headless figure runner output: canvas-loop `src/headless/tea-runtime.ts:288`
  logs `activity {…}` per handled input; `bbx figure run` prints it. Replay
  reads those lines.
- Chat deletion removes per-session files at
  `src/core/chat/session/delete/apply/core.ts:255`. Nothing removes
  `.beebox/activity-cursor/<id>.json` today. This plan removes its own
  activation file there and files an issue for the cursor.
- Not found: any agent-guide mention of `bbx chat activity`
  (`src/core/agent-guide/` grepped); the activity command is taught in
  `src/schemas/figure.ts:218`, `src/core/views/doc/core.ts:259` and the
  prompt. Triggers follow the same three places.
- Not found: any existing trigger mechanism in `beebox/src` (121 files use
  the English word; the named ones are connector procedure triggers,
  commit-trailer trigger kinds, the scheduler's `triggeredBy`, and a
  canvas-loop `trigger` param meaning a button). The name is free.

## Prior art (external)

No decision depends on an external premise. The process-per-evaluation
pattern and debounce are ordinary; the judge is in-house.

## Ontology

- **trigger file** (new): `src/triggers/<name>.ts` in the box. A module
  exporting `label(config): string`, `trigger(input, ctx): Promise<TriggerResult | null>`
  and optionally `tick: number` (seconds, floor 10). Identified by its
  box-relative path. NOT a card, NOT a view. Points at nothing.
- **trigger config** (new): the JSON object passed at arm time, given to the
  module as `ctx.config` and `label(config)`. Any shape the module accepts.
- **activation** (new): one armed trigger in one chat session.
  `{ id, file, config, label, tick?, armedAt, armedAtSeq, deadline, lastEvalSeq, lastEvalAt?, turnsSeen, fires, lastFireAt?, expires, state, error?, noticed }`.
  `expires` is `{ turns?: number, minutes?: number }` with at least one
  positive finite limit, or the string `"never"`; `{}` is rejected at arm.
  The default is `{ turns: 20, minutes: 120 }`. `deadline` is `armedAt` plus
  `minutes`, or null when `minutes` is absent (a turns-only limit, or
  `"never"`). `state` is one of: `armed`; `failed` (the last evaluation threw,
  timed out, or the file is missing; still scheduled, and a later evaluation
  that returns normally restores `armed` and clears `error`); and the
  terminal states `done` (the function returned `done: true`), `expired`
  (`turns` or `time`), `disarmed`, and `delivery-failed` (the fire could not
  be delivered; never scheduled or admitted again; the agent disarms or
  re-arms). `noticed` is whether the agent's turn has carried this
  activation's `expired` state in a hint; `delivery-failed` shows in the
  `failed` count instead. Stored in `.beebox/triggers/<session>.json` as
  `{ activations: [...] }`, written under a per-session trigger lock.
  Machine-local, gitignored. NOT a card. Points at a trigger file and a chat
  session.
- **evaluation** (new): one call of the function. Input
  `{ reason: "activity" | "tick", entries: ActivityLine[], history: ActivityLine[], sinceLastActivityMs: number | null, fires: number, lastFireAt: string | null, armedAt: string }`.
  `entries` are the session's lines with `seq` above `lastEvalSeq`, oldest
  first; empty on a tick with nothing new. `history` is the session's lines
  with `seq` above `armedAtSeq`, capped at the most recent 500, so a fresh
  child on a tick can still see what happened since arming. Runs in a child
  process with a 20 s deadline.
- **admission** (new): the runner's check when a child returns, inside one
  hold of the session's trigger lock that lasts through the delivery and the
  state write: the activation still exists, is `armed` or `failed`, and is
  unexpired; otherwise the result is discarded as `stale`. Admission also
  advances `lastEvalSeq` to the highest `seq` the child was given. `disarm`
  takes the same lock, so it runs either before admission (the result is
  stale) or after the write (the message is already in the chat, and the
  activation then becomes `disarmed`).
- **trigger context** (new): `ctx` = `{ config, boxRoot, reason, judge, log }`.
  `judge(input)` takes `JudgeInput` (instructions, questions, state), or
  `{ card: string, state }` for a judgment card, and returns
  `JudgeResult | { kind: "unavailable", reason: string }`. A `JudgeResult`
  holds `noul`, `choice` and `score` answers only
  (`src/services/jev-judge.ts:19`); it never holds prose. The function
  selects or fills in agent-written text from the answers. `log(message)`
  adds a trace record.
- **trigger result** (new): `{ text: string, note?: string, done?: boolean }`.
  `text` is what the person sees (cap 2,000 characters); `note` is for the
  agent; `done: true` ends the activation.
- **fire** (new): the delivery of one result as a `<trigger>` message, with
  three outcomes: delivered (sent or queued), refused (`sent === false`), or
  uncertain (the send threw). Refused and uncertain both set the terminal
  state `delivery-failed` with the error; nothing redelivers and nothing
  evaluates that activation again.
- **`<trigger>` message** (new delivered-user-message kind):
  `<trigger label="Water check" file="src/triggers/water-check.ts" fire="1" entries="11" done?="1">\n<text>…</text>\n<note>…</note>\n</trigger>`.
  Sits in the user slot with `user: null`, like `<call>`. NOT user input.
  `entries` is how many lines the evaluation was given.
- **trace record** (new): one JSON line the child writes as it goes:
  `{ kind: "log" | "judge" | "result" | "error", at, ... }`; a `judge` record
  carries the questions, the verdict and the time. The parent keeps every
  record it received, so a child killed at the deadline still leaves its
  judge calls behind.
- **trace log** (new): `.beebox/triggers.jsonl` plus `.1`. One line per
  evaluation: `{ at, session, activation, label, reason, entries, records, outcome: "none" | "fired" | "suppressed" | "stale" | "error" | "delivery-failed" | "skipped", error?, ms, dryRun? }`.
  Rotates like the notification log.
- **`<triggers>` hint** (new): `<triggers armed="N" failed="F" expired="E"/>`
  child of `<chat-app>`: `armed` is the current count; `failed` counts
  `failed` and `delivery-failed` activations; `expired` counts `expired`
  activations with `noticed: false`. They are marked noticed only when the
  turn is dispatched, through the same `dispatched` callback the run-ended
  note uses (`src/core/chat/session/run/start.ts:207` *"Removed only once the
  turn is dispatched (`dispatched`): a failed start keeps it for the next
  turn."*). `done` and `disarmed` need no notice: the fire message and the
  agent's own command already told it. Omitted when all zero. Sibling of
  `<activity>`. Not a delta since the last turn.
- **`trigger-changed`** (new event): `{ sessionId }`. The status line
  refetches `triggers.list`. Emitted on arm, disarm, expiry, fire, and any
  `state` or `error` change; not on a quiet evaluation.
- Existing names used as is: activity entry and `ActivityLine`
  (`src/core/activity/entry.ts`), activity window, activity cursor, chat
  session, `JudgeInput`/`JudgeResult`, delivered user message, companion
  pane.

## Tracks / scope

### Track A: activation store, expiry rules, trace log

- What: `src/core/triggers/` owns the activation file (zod schema, read,
  write atomically, per-session trigger lock), the expiry decision as a pure
  function `expiryOf(activation, now): null | "turns" | "time"`, the
  `expires` validator (at least one positive finite limit or `"never"`), the
  person-turn counter, and the trace writer and reader (line cap, rotation,
  modeled on the notification log).
- Why: everything else reads and writes these; the expiry decision is the
  risky judgment and belongs in a pure function the unit tier reaches.
- Direction: `armActivation(boxRoot, {sessionId, file, config, label, tick, expires})`
  computes `armedAtSeq` from `lastActivitySeq` and `deadline`;
  `listActivations(boxRoot, sessionId)` applies `expiryOf` at read so a
  deadline that passed while nothing ran reads as `expired`;
  `withActivation(boxRoot, sessionId, id, fn)` reads, lets `fn` patch, and
  writes under the lock; `countPersonTurn(boxRoot, sessionId)` increments
  `turnsSeen` for every armed activation and marks those past `turns` as
  `expired`, called from `src/core/chat/session/run/start.ts` where
  `rawInput.activityTurn !== undefined`, before the cursor advance;
  `appendTrace`, `readTrace(boxRoot, {session?, since?})`. Deleting a chat
  removes `.beebox/triggers/<session>.json`
  (`src/core/chat/session/delete/apply/core.ts:255` neighborhood).
- Vocabulary lock-ins: the activation fields and states above; the file
  paths; `expires` shape and default.
- First chunk: schema, read/write under the lock, the `expires` validator
  (`{}` rejected, `{ turns: 0 }` rejected, `"never"` accepted), `expiryOf`
  with tests for both limits and `"never"`.

### Track B: the evaluation child and the module contract

- What: `bbx chat trigger eval-one` (internal, hidden from `--help` like
  `figure run-one`) reads one JSON job on stdin: the activation, `entries`,
  `history`, `reason`, `sinceLastActivityMs`, `dryRun`. It compiles the
  trigger file with `bundleView(path, { target: "node" })` fresh (each child
  is a new process; the compiler's cache does not survive it), imports it,
  validates the exports, builds `ctx`, and calls `trigger`. It writes trace
  records to stdout as JSON lines as they happen: every `ctx.log`, every
  judge call with its verdict, then one `result` or `error` record last.
  Before importing the module it points `console.log`, `info`, `warn`,
  `error` and `debug` at stderr, so a trigger's own printing cannot sit
  between records; the parent keeps every stderr line and any stdout line
  that is not a record as a `log` record, so nothing the function printed is
  lost and one stray line cannot hide a later judge or result record.
  `ctx.judge` resolves the service (`resolveJudgeService`), reserves one call
  (`reserveJevCalls`), judges, and writes the `judge` record; on
  `unconfigured`, a failed reservation, or a thrown error it returns
  `{ kind: "unavailable", reason }`. The same command with `--inspect` only
  imports the module and prints `{ label, tick }` for the config, for arming.
  The first chunk measures a cold evaluation of a trivial trigger (spawn,
  bundle, import, return) and records the number in this plan.
- Why: agent-written code runs outside the server process; the child has the
  full beebox library for the judge and budget without an IPC protocol; a
  child killed at the deadline still leaves the records it wrote.
- Direction: a types module the box can import,
  `beebox/triggers` → `TriggerModule`, `TriggerInput`, `TriggerContext`,
  `TriggerResult`, published the way `beebox/view-widgets` is for views
  (check `src/webapp/views/compiler/compile.ts` externals and the box
  `package.json` template; the box imports types only). The module contract
  is validated at import: `label` a function, `trigger` a function, `tick` a
  finite number ≥ 10 when present; a bad module is an `error` with a message
  naming the export.
- Vocabulary lock-ins: the export names `label`, `trigger`, `tick`; `ctx`
  fields; result fields; the `beebox/triggers` import path.
- First chunk: the module validator and `ctx.judge` with `BBX_JEV_FAKE`,
  tests for a module missing `trigger`, a `tick` below the floor, a judge
  call when unconfigured.

### Track C: the runner

- What: a `TriggerRunner` per box in the server (beside the chat runtime):
  - `onActivity(sessions)`: after `recordActivity` in the `activity.record`
    procedure, for each distinct bound `chat` in the batch with any `armed`
    or `failed` activation, start the settle timer or push it back: it fires
    1 s after the latest batch but no later than 3 s after the first pending
    batch, so continuous interaction still evaluates every few seconds. On
    fire, read the session's lines from the log once, and evaluate each
    activation in turn (one child per activation, at most one evaluation per
    session in flight; a batch arriving mid-evaluation sets a flag that
    starts a new settle when the evaluation ends).
  - Ticks: for each armed activation with `tick`, an interval timer while
    `livePresence().activeWeb > 0` (box-wide; see Stated preferences); a tick
    with no new entries still evaluates with `reason: "tick"` and the
    history. When nobody is present the tick is skipped and the trace says so
    once per absence.
  - Deadlines: one timer per activation at `deadline`; it marks `expired`
    under the lock and emits `trigger-changed`, so the status line ends on
    time whether or not anything ran.
  - Scheduling: only `armed` and `failed` activations are evaluated on
    activity or tick; terminal states (`done`, `expired`, `disarmed`,
    `delivery-failed`) never are.
  - Admission, fire and write happen inside one hold of the session's
    trigger lock. Reread the activation; if it is gone or terminal, or
    `expiryOf` says expired, the result is traced `stale` and dropped;
    otherwise `lastEvalSeq` advances. An `error` record sets `failed` with
    the error. A normal return (result or none) from a `failed` activation
    restores `armed`, clears `error`, and emits `trigger-changed`. A result
    inside 5 s of `lastFireAt` is traced `suppressed`. Otherwise fire.
  - Fire: truncate `text`, serialize the `<trigger>` message,
    `deliverUserMessage` to the session (target `sessionId`, never new),
    still under the lock. Delivered (sent or queued): write `fires + 1`,
    `lastFireAt`, `done` when asked, trace `fired`. Refused
    (`UserMessageDeliveryError`) or thrown: write `delivery-failed` with the
    error, trace `delivery-failed`, no retry; a thrown send may have gone
    out, and the agent sees both the message and the failed state, which is
    visible rather than duplicated
    (`src/core/chat/session/deliver-user-message.ts:221`, the comment on
    why a throw is not retried). The lock wait for `disarm` and `arm` is the
    activity lock's 5 s; a send or enqueue completes well inside it.
  - Hint: `src/core/chat/session/run/start.ts:216` gets a `<triggers>` child
    computed from the activation file at turn start; the unnoticed `expired`
    activations are marked `noticed` in the `dispatched` callback, not at
    composition.
  - Boot: on server start, scan `.beebox/triggers/*.json`, apply `expiryOf`,
    and start tick and deadline timers for armed activations. On
    `trigger-changed` from another process (the CLI), reload that session's
    timers.
  - Every evaluation, skip, suppression, stale drop and error appends a
    trace line; `trigger-changed` is emitted on `state` or `error` change.
- Why: the stream already lands here; the hint and delivery paths already
  exist; without admission under the lock a disarm or expiry during a judge
  call would still deliver.
- Direction: `src/core/triggers/runner.ts` with injected timers and a
  `spawnEval(job)` function returning an async iterable of trace records, so
  the unit tier runs it with fake timers and a fake child.
- Vocabulary lock-ins: `<triggers armed failed expired/>`; the settle (1 s,
  cap 3 s), child deadline (20 s), fire floor (5 s), tick floor (10 s),
  history cap (500) as named constants.
- First chunk: the settle with its cap and the in-flight flag with fake
  timers and a fake child, asserting that batches every 500 ms produce an
  evaluation within 3 s; no delivery yet.

### Track D: `bbx chat trigger`

- What: `arm <file> --config <json> [--expires <json>|never]`,
  `list [--json]`, `disarm <id|label|--all>`,
  `run <file> --config <json> [--since <seq>|--all] [--reason tick] [--activity <file>] [--json]`,
  `log [--json] [--since <time>] [--all-sessions]`. All resolve the session
  with `resolveChatSessionId`. `arm` runs `eval-one --inspect` to get the
  label and tick, writes the activation, emits `trigger-changed` on the
  event bus (cross-process over SQLite: `src/core/event-bus/core.ts:13`
  *"any process can open the same SQLite DB and emit()"*), and prints the
  label, id and expiry in words. The server's runner listens for the same
  event to start or stop tick timers for that session. `run` is a dry run: it evaluates
  through the same child with `dryRun: true`, delivers nothing, and prints
  the trace in words (or JSON). `--activity <file>` replaces the session's
  entries and history with lines from a JSONL file of `ActivityLine`s (the
  `--json` output of `bbx chat activity` is one such file). Reading `bbx
  figure run` output directly is NOT in scope.
- Why: arming, debugging and replay are the agent's whole interface.
- Direction: `src/cli/commands/chat/trigger/` following `activity.ts`;
  registered at `command.ts:285`.
- Vocabulary lock-ins: the subcommand names and flags above.
- First chunk: `arm`, `list`, `disarm` against Track A, with a CLI test
  under `BBX_CHAT_SESSION_ID`.

### Track E: the `<trigger>` message, prompt, chip

- What: a `trigger` kind in `src/shared/delivered-user-message.ts` (codec
  with `label`, `file`, `fire`, `done`, and `<text>`/`<note>` children; a
  malformed one parses as text like the others). A chip
  `TriggerChip.tsx`: a labeled aside modeled on the self-note aside, eyebrow
  "Water check", body the text, nothing else; the note is not rendered until
  the open question on its visibility is settled. The prompt paragraph: a
  `<trigger>` message means a trigger you armed fired; the person has already
  seen `<text>`; `<note>` is yours; `bbx chat activity` lists what the person
  did since their last message, which includes the actions that fired it;
  add something only if it helps, otherwise `<ack kind="no-response"/>`;
  never write a `<trigger>` yourself. The `<triggers>` hint paragraph beside
  the `<activity>` one, naming `bbx chat trigger list` and `log`.
- Why: without a kind, the raw tag would show; without the paragraph, the
  agent would repeat the text.
- Direction: codec and chip tests mirror the `<call>` ones.
- Vocabulary lock-ins: the tag and attributes; `<text>` and `<note>`.
- First chunk: the codec with round-trip tests.

### Track F: the status line, `triggers.list`, the event

- What: `triggers.list({ session })` tRPC query returns the session's
  activations after `expiryOf`, with `id`, `label`, `state`, `error`. The
  chat column shows one line above the composer when the session has any
  `armed` or `failed` activation: "Watching: Water check" (several:
  "Watching: Water check, Stuck check"); a `failed` one reads "Water check:
  not working". Refetched on `trigger-changed` for the session and on mount.
  A new `trigger-changed` event in the catalog with the generation bumped.
- Why: the person sees that something is watching, and whether it works. The
  line is per session, like the activation, so it does not vanish when the
  companion pane is closed (`WorkspaceCanvas/view.tsx:55` renders the pane
  only while a card is open).
- Direction: a `TriggerStatusLine` component mounted where the ambient
  region sits
  (`src/frontend/src/components/chat/everywhere/BoxConversationShell/view.tsx:94`),
  shown with the transcript, hidden when the list is empty. No popover, no
  details: the agent has `bbx chat trigger list` and `log`, and the person
  asks the agent.
- Vocabulary lock-ins: `triggers.list`, `trigger-changed`.
- First chunk: the query and the line.

## Could this be simpler?

- Simplest: a view calls `fireTrigger(text, note)` and the server delivers
  it. No files, no runner, no judge, no ticks. It fails Juni-stuck (nothing
  runs when nothing happens), fails figures (canvas-loop may not know about
  chat, boxholder 2026-11-13), and leaves the agent without a dry run or
  replay, so a wrong condition is found only by a person.
- Without the child process: import the trigger in the server. Saves the
  `eval-one` command and a spawn per evaluation. A throwing or looping
  trigger then runs inside `bbx serve`; principle §4 forbids limping past
  that, and `meta-import.ts` already chose a child for the same reason.
- Without expiry: fewer fields. A forgotten stuck-detector then ticks and
  spends judge calls for as long as the tab is open; the boxholder asked for
  a default limit.
- Without the status line: the person learns of a watch only when it fires.
  The Priya situation fails; "see the gears".
- Without `history`: a tick sees only new entries, and a fresh child cannot
  tell four minutes without progress from four minutes after success. The
  stuck situation fails; the alternative, trigger-local state across
  evaluations, is a new durable store.
- Without admission under the lock: a judge call that outlives a disarm
  still delivers. Principle §13: the control would say "stopped" while the
  system fired.
- Without replay: the agent debugs against a live person. The JSONL reader
  is small because `bbx chat activity --json` already writes the format.
- Kept out (see NOT in scope): frontend execution, a card type, a condition
  language, wakeup triggers, a details popover, a compile cache across
  children.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| The function throws | to add (B) | `error` record; activation `failed`; trace; hint; status line "not working" | clear |
| The child hangs (infinite loop, awaiting forever) | to add (C, fake child) | 20 s deadline, `SIGKILL`, treated as `error`; records already streamed are kept | clear |
| A child logs, judges, then loops | to add (B/C: the fake child yields two records then never ends) | the `judge` record is in the trace line with the timeout | clear |
| Disarm, expiry or chat deletion while a child runs | to add (C: disarm between spawn and return) | admission rereads under the lock; result traced `stale`, nothing delivered | clear in trace |
| Delivery refused or the send throws | to add (C, fake delivery) | activation `delivery-failed` with the error; no retry; hint and status line | clear |
| Delivery throws, then another batch arrives | to add (C: the example is one fire, a thrown send, a second batch, no second child) | `delivery-failed` is terminal and never scheduled | clear |
| Disarm between admission and the send | to add (C: disarm requested while the fake delivery is pending) | one lock hold covers admission, send and write; disarm waits, then marks `disarmed` | n/a |
| A turn composes the hint and then fails to dispatch | to add (C) | `noticed` is set in `dispatched`; the next turn carries the expiry again | n/a |
| A `failed` activation returns normally | to add (C) | `armed` restored, `error` cleared, `trigger-changed` emitted | clear: line reads "Watching" again |
| The function calls `console.log` | to add (B: a module that prints, then judges) | console routed to stderr; stray stdout kept as `log` records; the judge record survives | clear in trace |
| Batches every 500 ms for a minute | to add (C, fake timers) | settle cap of 3 s from the first pending batch | n/a |
| Deadline passes with no activity and no tick | to add (C) | the deadline timer marks `expired`; `list` applies `expiryOf` at read as well | clear: line goes |
| `expires: {}` or `{ turns: 0 }` | to add (A) | rejected at arm with the rule in the message | clear |
| The trigger file is deleted or fails to compile after arming | to add (B) | `error` naming the file; `failed`; retried next evaluation | clear |
| Judge over budget or unconfigured | to add (B) | `ctx.judge` returns `unavailable`; function decides; trace | clear in trace; the person sees what the function chose |
| Two activity batches land during one evaluation | to add (C) | in-flight flag re-arms the settle timer; entries above `lastEvalSeq` are never skipped | n/a |
| A repeating trigger fires on every entry | to add (C) | 5 s fire floor; `suppressed` trace lines; default expiry | clear in trace |
| Fire while the agent is mid-turn | exists for delivery (`deliverUserMessage` enqueues when busy) | the message is queued and starts the next turn | n/a |
| Server restarts with armed ticks | to add (C) | boot scan restarts timers | n/a |
| Person leaves the tab open overnight | to add (C) | ticks skip when `activeWeb === 0`; the deadline ends the activation | trace says skipped once |
| Another person is active in a different chat of the same box | no test; documented | ticks keep running on box-wide presence until the deadline | trace shows the ticks; accepted (Stated preferences) |
| Entries tagged `pendingChat` before the session is bound | to add (C) | the runner evaluates bound sessions only; entries wait for the next batch after binding | n/a |
| Invalid `--config` JSON or a `label()` that throws | to add (D) | `arm` exits 1 with the parse error or the thrown message | clear |
| Hand-edited activation file fails the schema | to add (A) | the file is ignored with one console warning naming it; `list` says so | clear |
| `text` longer than the cap, or containing `</text>` | to add (E) | truncated with a trace note; children are XML-escaped by the codec | clear |
| Chat deleted while armed | to add (A) | activation file removed with the chat | n/a |
| Trace log grows | to add (A) | rotation at 30 days or 8 MB | n/a |
| The agent writes `<trigger>` in its own reply | not testable; prompt | user-slot codec only; assistant text renders as prose with the tag stripped by the structured-output stripper only if listed, otherwise shown raw | GAP, see edge cases |

No critical gap: every row has handling and a visible face.

## Agent-flow / user-flow edge cases

- **Wrong tag:** the agent writes `<trigger>` in its reply to "fire" one.
  ADDRESSED in the prompt paragraph (Track E: "never write a `<trigger>`
  yourself"); the assistant-side stripper
  (`src/frontend/src/lib/structured-output-parsing.ts:221`) does not list it,
  so a stray one renders as text, which is visible and correctable, not
  silent.
- **Wrong command:** the agent runs `bbx chat activity` expecting trigger
  traces. ADDRESSED: `log` is under `bbx chat trigger`, and the prompt's
  `<triggers>` paragraph names it.
- **Stale ref:** the file moves after arming. ADDRESSED: `failed` with the
  path in the error; `disarm` and re-arm.
- **Two agents:** a scheduled turn and the chat agent both arm in one
  session. ADDRESSED: the activation file is written under a lock; ids are
  unique; both show in the status line.
- **Hand-edit drift:** the boxholder edits `.beebox/triggers/<session>.json`.
  ADDRESSED: schema parse, warn, ignore; `list` reports the file as invalid.
- **Fabricated value:** the agent invents `fire="3"` or a label in prose.
  ADDRESSED: the message is system-written; the agent cannot deliver one.
- **Validation error UX:** `arm` on a module without `trigger`: "src/triggers/x.ts
  exports no `trigger` function" with the import path of the types module.
  ADDRESSED in Track B's validator messages.
- **Expired while the person is mid-task:** the status line vanishes without
  a word. ADDRESSED in part: the agent's next hint says one expired, and the
  trace says why; the agent may re-arm. DEFERRED: whether the person should
  see "stopped watching" in the chat (Open design questions).
- **The trigger-originated turn has no `<activity>` hint:** the cursor
  advances only on a person's send, so the fire's turn carries none.
  ADDRESSED: the `<trigger>` message carries `entries`, and `bbx chat
  activity` lists the window since the person's last message, which holds
  those entries; the prompt paragraph says so.
- **Partial migration:** none; new files and a new message kind. Old chats
  have no activations.

## NOT in scope

- Running trigger code in the page. Considered (boxholder: "might be just
  fine"); not now because the server runner covers views and figures with
  one path and a view can already compute its own result and report it.
- Triggers over card and time changes at wakeup
  (`issues/exploration/2026-09-15-...`). Same anatomy, different stream and
  latency; this plan's module contract is written so a wakeup runner could
  call `trigger({ reason: "wakeup", ... })` later, but no such runner.
- A view firing directly without a trigger file. A later addition if the
  spawn cost shows.
- Arming triggers automatically from a course card when a session opens.
  Depends on the agent-first turn (`issues/features/2026-10-08-...`).
- Isolating view and figure code. Unchanged by this plan.
- A notification when a trigger fires and nobody is present. Fires only
  happen with activity or with presence; the agent can `bbx notify` in its
  turn.
- Removing `.beebox/activity-cursor/<session>.json` on chat deletion. Found
  while reading the delete path; filed as an issue, not fixed here.
- A condition language or a trigger card type. A function is the condition.
- Models other than Jev in `ctx.judge`, and prose generation from the judge.
  Jev answers questions; the trigger picks the text.
- A details popover on the status line (file, last verdict, expiry). The
  agent has `list` and `log`; the person asks the agent. Revisit when a
  person asks what a line means and the agent's answer is not enough.
- A compiled-trigger cache that survives child exits. Measure first.
- Reading `bbx figure run` output as replay input. A small adapter for later;
  `bbx chat activity --json` already produces the replay format.
- Per-session presence for ticks. Box-wide presence is accepted above.
- Trigger-local state across evaluations. `history` covers the stuck case
  without a new store.
- A probe channel from the server to the page (the trigger asks the figure
  for its current state). A trigger sees only what the figure logged, after
  the fact: a `detail` of up to 500 characters and an `activity` object, in a
  4,000-byte line. The convention instead is that a figure logs a compact
  state summary in `activity` on each `modified` entry, so the trigger can
  read the current state from the last entry; the agent that writes the
  trigger can add such entries to the figure. Boxholder, 2026-11-14: "adding
  activity probes is also something the agent can do, and then hopefully
  they build up to be useful." Taught in `box-docs/triggers.md`.

## Open design questions

- **Is the note visible to the person?** The first version shows only the
  text. Lean for later: an expander showing the note, because nothing in a
  box is hidden from its people. The boxholder called it an "internal
  message"; if that means hidden, it stays hidden.
- **Does an expiry say anything in the chat?** Lean no: the status line
  goes, the agent learns of it, and a stuck-detector ending quietly is better
  than a message about itself.
- **Where the status line lives.** This plan puts it in the chat column above
  the composer, per session, after the review found the companion pane
  disappears with its card. The boxholder said the location was open; this
  is the proposal, to confirm.

## Knowledge audits

New agent-facing concepts: the trigger file contract and `bbx chat trigger`.
Add `knows_directly` entries in `beebox/src/dev/knowledge-audits.yaml`:
"the learner wants to be told the moment they build water" → writes
`src/triggers/*.ts` and runs `bbx chat trigger arm`; "why didn't my trigger
fire?" → runs `bbx chat trigger log` or `run`. Run both on the worktree's
test1 clone and record the status comment.

## What will hold this after it ships

- Unit: `expiryOf` and the `expires` validator; activation read/write under
  the lock; trace writer (cap, rotation, read both files); the runner with
  fake timers and a fake child (settle and its cap, in-flight re-arm, tick
  skip on no presence, deadline timer, admission after disarm, fire floor,
  delivery refused and thrown, partial records from a killed child, boot
  scan); the module validator; `ctx.judge` with `BBX_JEV_FAKE` (ready,
  unconfigured, over budget); the codec round trip and malformed input.
- Route: `activity.record` schedules an evaluation for a session with an
  activation and not for one without; `triggers.list` applies `expiryOf`.
- CLI: `arm`/`list`/`disarm`/`run`/`log` under `BBX_CHAT_SESSION_ID` with a
  fixture trigger file and a fake judge; `run --activity` with a JSONL file.
- Frontend: `TriggerChip` renders label and text and not the note;
  `TriggerStatusLine` shows for `armed` and `failed`, hides when empty, and
  stays when the companion pane closes.
- Browser check: a figure beside a chat, arm from a scripted agent turn or
  the CLI, act, see the chip and the line.
- No new test tier. The fake child is a function injected into the runner,
  not a mock of a process.

## Implementation order

1. Track A: store, validator, `expiryOf`, trace, person-turn counter,
   deletion cleanup.
2. Track B: types module, validator, `eval-one` with streamed records,
   `ctx.judge`; the cold-evaluation measurement recorded here.
3. Track C: runner (settle and cap, ticks, deadlines, admission, delivery
   outcomes, boot), hooked into `activity.record`; the `<triggers>` hint.
4. Track E: codec, prompt paragraphs, chip (the fire is visible from here).
5. Track D: `arm`, `list`, `disarm`, then `run` and `log`, then
   `--activity` replay.
6. Track F: `triggers.list`, event, status line.
7. Docs: `box-docs/triggers.md`, views and figure instruction pointers,
   agent-changes entry; knowledge audits; browser check; file the cursor
   cleanup issue.

## Rollout shape

Tests named above, written with each chunk. Done when they pass, the two
knowledge audits pass on test1, and the browser check shows a fire and the
status line. No data migration: activation and trace files start empty. The
courseware box's use is the boxholder's call.

## Plan review (codex gpt-6-astra, round 1)

1. A tick receives only new entries, so a fresh child cannot tell "stuck"
   from "done, then quiet". Accepted: `history` since arming, capped at 500,
   on every evaluation; the stuck walkthrough added.
2. A disarm, expiry or deletion during an evaluation still delivers.
   Accepted: admission under the per-session lock; stale results dropped.
3. Delivery failure undefined; walkthrough and Track C disagreed on order.
   Accepted: deliver, then write; refused or thrown both set `failed` with
   no retry (round 2 made it the terminal `delivery-failed`); `lastEvalSeq` advances at admission regardless of outcome.
4. Continuous batches postpone the settle forever. Accepted: a 3 s cap from
   the first pending batch.
5. Time expiry only checked at evaluation; `{}` admitted. Accepted: a
   deadline timer per activation, `expiryOf` applied at read, and the
   validator requires a positive finite limit or `"never"`.
6. Presence is box-wide; the pane line vanishes with the pane. Accepted in
   two parts: box-wide ticks documented as an accepted trade; the status
   line moved to the chat column, per session, flagged for the boxholder.
7. The cursor hook counts merged turns, can be skipped, and the delta
   counters had no reset on trigger turns. Accepted: expiry counts person
   turns (`turns`), counted before the cursor attempt; the hint reports
   current counts plus unnoticed terminal states instead of deltas; the
   trigger turn's activity access is stated.
8. Jev returns answers, not prose. Accepted: the design and ontology say the
   function selects agent-written text from the verdict.
9. Trace lost when the child is killed. Accepted: records stream as JSON
   lines; the parent keeps what arrived.
10. Popover promised data the query lacked; notes shown while undecided.
    Accepted: popover cut; chip shows text only; `trigger-changed` not
    emitted on quiet evaluations is kept, since the line shows state only.
11. The compile cache is process-local. Accepted: claim removed; cold compile
    measured in Track B's first chunk; a durable cache NOT in scope.

## Plan review (codex gpt-6-sol, round 2)

Verified eight of the eleven round-1 fixes as holding; three needed more, plus
six fresh findings. All accepted:

1. One `failed` state covered both a retryable evaluation error and a
   terminal delivery failure, and `failed` was scheduled and admitted, so a
   thrown send could fire again. Fixed: `delivery-failed` is its own terminal
   state, never scheduled or admitted.
2. Admission and delivery were separate lock holds, so a disarm between them
   still delivered. Fixed: one hold covers admission, send and write; disarm
   takes the same lock.
3. The hint's `expired` attribute counted every terminal state, and `noticed`
   was set at composition, so a failed turn start lost the notice. Fixed:
   `expired` counts only `expired`; `noticed` is set in the turn's
   `dispatched` callback, the run-ended note's pattern.
4. A later normal evaluation never restored a `failed` activation. Fixed:
   normal return restores `armed`, clears `error`, emits `trigger-changed`.
5. `deadline` was null only for `"never"`, undefined for a turns-only limit.
   Fixed: null whenever `minutes` is absent.
6. A trigger's `console.log` would corrupt the stdout record stream. Fixed:
   console routed to stderr before import; stray lines kept as `log` records.
