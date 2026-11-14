---
title: "Activity triggers: agent-written functions that watch what a person does and respond"
status: draft
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
  did and not a generic "try again".
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
| Wren's wrong bonds | show, text composed from the judge's reading | chat | same |
| Priya's budget | quiet; one line in the companion pane says what is being watched, so she can object | companion pane, the open card | background |
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
  can feel like surveillance. Guards: the pane names the watch while it is
  armed; triggers expire by default; the person's "stop watching" ends it.
  "People aren't broken versions of their better selves" — a stuck-detector
  can nag. Guard: the trigger decides once per tick, the agent writes the
  text, and the default expiry ends it; nothing repeats without the function
  choosing to.

### Trust

- **Arming** is automatic for the agent, and visible: the pane line and the
  agent's own prose. A person's "don't watch me" is an instruction the agent
  records in the usual guidance sinks; nothing in this plan automates that.
- **Firing** shows text the agent wrote or composed. It takes no action on the
  box. The agent's turn after a fire follows the agent's ordinary rules.
- **Judge calls** spend the existing daily Jev budget. No new permission.

### When it goes wrong or does nothing

- The function throws or times out: the person sees nothing new in the chat;
  the pane line changes to "Water check: not working"; the agent's next
  message hint says a trigger failed, and `bbx chat trigger log` shows the
  error and stack. The agent fixes the file; the next evaluation uses it.
- The judge is unavailable or over budget: the function receives an
  `unavailable` verdict and decides. The trace says so.
- Nothing matches: no fire, a trace line per evaluation saying "no result",
  and the pane line stays "Watching: Water check".
- The trigger expires: the pane line goes; the agent's next hint says one
  expired; the trace says which and why. The person who wanted it back asks
  the agent, who arms it again.
- The person says "stop watching me": the agent runs `bbx chat trigger disarm`;
  the pane line goes at once.

### Walkthrough

Juni has `Molecule_Builder.figure.card` open beside the chat and says "tell
me when I make water." The tutor writes
`src/triggers/water-check.ts` exporting `label`, `trigger` and `tick`, then
runs `bbx chat trigger arm src/triggers/water-check.ts --config '{"target":"H2O"}'`.
The command compiles the file in a child process, calls `label(config)` to
get "Water check", reads `tick` (60 seconds), validates the config, and
writes an activation to `.beebox/triggers/<session>.json` with the default
expiry (20 person messages or 2 hours). It prints the activation and the
expiry. The server emits `trigger-changed` for the session; Juni's pane shows
"Watching: Water check" under the figure's tab. The tutor replies "I'll say
so the moment you get it."

Juni adds O, H, H, and bonds them. Each handled input is an activity entry
with the sketch's `activity(model)` data, queued by the page and posted to
`activity.record`. After the append, the server sees the batch names Juni's
session, which has an armed activation, and starts a one-second settle timer.
When it fires, the runner spawns `bbx chat trigger eval-one` with the
activation and the entries since the last evaluation. The child compiles the
trigger file (cached by content), calls `trigger({ reason: "activity",
entries, sinceLastActivityMs }, ctx)`. The function reads the last entry's
`activity.molecules`, finds `H2O`, and returns
`{ text: "That's water. Two hydrogens, one oxygen.", note: "Correct on the
first full attempt; 11 actions, no judge call.", done: true }`. The child
prints the result and the trace lines as JSON. The runner appends the trace,
marks the activation done, and delivers a `<trigger>` message to the session
with `user: null`. Juni's chat shows a chip labeled "Water check" with the
text. The tutor's turn starts with the wrapper, which carries the text and
the note, and an `<activity entries="11" cards="1"/>` hint; it runs
`bbx chat activity` if it wants the steps, then writes "Nice. Want to try
ammonia?" or acks. The pane line is gone. Left behind: the trigger file (in
git when the agent commits), the activation with `state: "done"`, the trace
lines, and the chat entries.

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
| A: activation store, expiry rules, trace log | 260 | 220 |
| B: evaluation child, trigger module contract, judge in ctx | 220 | 150 |
| C: runner: settle, ticks, fire, delivery, hint | 300 | 220 |
| D: `bbx chat trigger` arm, list, disarm, run, log | 260 | 150 |
| E: `<trigger>` message kind, prompt, chip | 170 | 110 |
| F: pane line, `triggers.list`, `trigger-changed` event | 160 | 90 |
| Total | 1,370 | 940 |

Docs about 220 lines (`box-docs/triggers.md`, views and figure instruction
changes, agent-changes, prompt paragraph). About 2,300 changed lines in all:
a **BIG CHANGE**. The size comes from the new process boundary (child
evaluation with its own command), the CLI with five subcommands, and the
frontend's two surfaces. The boxholder asked for durable files, per-session
activation with config, default expiry, ticks, and debugging in the
2026-11-13 and 2026-11-14 discussion; each is a track or part of one. Approval
for this size is requested with the plan.

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
  shows in the pane line, the hint and the trace. §13 (a control shows the
  state the system is in): the pane line shows the activation's recorded
  state, never "watching" while the last evaluation failed.
- `beebox/docs/adding-api-endpoints.md`: tRPC is the default. `triggers.list`
  is a tRPC query.
- Trade: evaluation spawns a process per settled batch. Cost is a few hundred
  milliseconds and a node start per evaluation. Chosen over in-process
  execution so a throwing or looping trigger cannot take down `bbx serve`;
  precedent `src/webapp/views/compiler/meta-import.ts:111` runs box view code
  the same way with a 3 s timeout and `SIGKILL`.

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
- Person-turn hook: `src/core/activity/cursor.ts:148` writes the cursor once
  per person turn (`src/core/chat/session/state.ts:243` *"One person-turn
  advances the activity cursor once, whatever it merged."*). The message
  counter for expiry increments here.
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
  `{ id, file, config, label, tick?, armedAt, lastEvalSeq, lastEvalAt?, messagesSeen, fires, expires, state, error? }`.
  `expires` is `{ messages?: number, minutes?: number }` or `"never"`;
  the default is `{ messages: 20, minutes: 120 }`. `state` is `armed`,
  `done` (the function returned `done: true`), `expired` (`messages`,
  `time`), `disarmed`, or `failed` (the last evaluation threw, timed out, or
  the file is missing; still armed, retried on the next evaluation).
  Stored in `.beebox/triggers/<session>.json` as `{ activations: [...] }`.
  Machine-local, gitignored. NOT a card. Points at a trigger file and a chat
  session.
- **evaluation** (new): one call of the function. Input
  `{ reason: "activity" | "tick", entries: ActivityLine[], sinceLastActivityMs: number | null, fires: number, armedAt: string }`.
  `entries` are the session's lines with `seq` above `lastEvalSeq`, oldest
  first; empty on a tick with nothing new. Runs in a child process with a
  20 s deadline.
- **trigger context** (new): `ctx` = `{ config, boxRoot, reason, judge, log }`.
  `judge(input)` takes `JudgeInput` without `state`'s wrapping, or
  `{ card: string, state }` for a judgment card, and returns
  `JudgeResult | { kind: "unavailable", reason: string }`. `log(message)`
  adds a trace line.
- **trigger result** (new): `{ text: string, note?: string, done?: boolean }`.
  `text` is what the person sees (cap 2,000 characters); `note` is for the
  agent only; `done: true` ends the activation.
- **fire** (new): the delivery of one result as a `<trigger>` message.
- **`<trigger>` message** (new delivered-user-message kind):
  `<trigger label="Water check" file="src/triggers/water-check.ts" fire="1" done?="1">\n<text>…</text>\n<note>…</note>\n</trigger>`.
  Sits in the user slot with `user: null`, like `<call>`. NOT user input.
- **trace log** (new): `.beebox/triggers.jsonl` plus `.1`. One line per
  evaluation: `{ at, session, activation, label, reason, entries, judgeCalls: [{question, verdict, ms}], logs, result: "none" | "fired" | "error", error?, ms, dryRun? }`.
  Rotates like the notification log.
- **`<triggers>` hint** (new): `<triggers armed="N" fired="F" expired="E" failed="X"/>`
  child of `<chat-app>`, counts since the agent's last turn; omitted when all
  zero. Sibling of `<activity>`.
- **`trigger-changed`** (new event): `{ sessionId }`. The pane refetches
  `triggers.list`.
- Existing names used as is: activity entry and `ActivityLine`
  (`src/core/activity/entry.ts`), activity window, activity cursor, chat
  session, `JudgeInput`/`JudgeResult`, delivered user message, companion
  pane.

## Tracks / scope

### Track A: activation store, expiry rules, trace log

- What: `src/core/triggers/` owns the activation file (zod schema, read,
  write atomically, per-session lock), the expiry decision as a pure function
  `expiryOf(activation, now, messagesSeen): null | "messages" | "time"`, the
  message counter hook called from `advanceForSend`, and the trace writer and
  reader (line cap, rotation, modeled on the notification log).
- Why: everything else reads and writes these; the expiry decision is the
  risky judgment and belongs in a pure function the unit tier reaches.
- Direction: `armActivation(boxRoot, {sessionId, file, config, label, tick, expires})`,
  `listActivations(boxRoot, sessionId)`, `updateActivation(boxRoot, sessionId, id, patch)`,
  `countPersonTurn(boxRoot, sessionId)` (called where
  `src/core/activity/cursor.ts:148` writes the cursor; it also marks
  `expired` by messages), `appendTrace`, `readTrace(boxRoot, {session?, since?})`.
  Deleting a chat removes `.beebox/triggers/<session>.json`
  (`src/core/chat/session/delete/apply/core.ts:255` neighborhood).
- Vocabulary lock-ins: the activation fields and states above; the file
  paths; `expires` shape and default.
- First chunk: schema, read/write, `expiryOf` with tests for both limits,
  `"never"`, and the default.

### Track B: the evaluation child and the module contract

- What: `bbx chat trigger eval-one` (internal, hidden from `--help` like
  `figure run-one`) reads one JSON job on stdin: the activation, the entries,
  `reason`, `sinceLastActivityMs`, `dryRun`. It compiles the trigger file with
  `bundleView(path, { target: "node" })` (cache keyed by file content), imports
  it, validates the exports, builds `ctx`, calls `trigger`, and prints one
  JSON line: `{ result, trace }` or `{ error, trace }`. `ctx.judge` resolves
  the service (`resolveJudgeService`), reserves one call
  (`reserveJevCalls`), judges, and records the call in the trace; on
  `unconfigured`, a failed reservation, or a thrown error it returns
  `{ kind: "unavailable", reason }`. The same command with `--inspect` only
  imports the module and prints `{ label, tick }` for the config, for arming.
- Why: agent-written code runs outside the server process; the child has the
  full beebox library for the judge and budget without an IPC protocol.
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
    or `failed` activation, start or restart a 1 s settle timer. On fire,
    read entries above the lowest `lastEvalSeq` among that session's
    activations, and evaluate each activation in turn (one child per
    activation, at most one evaluation per session in flight; a batch
    arriving mid-evaluation sets a flag that re-arms the settle timer when
    the evaluation ends).
  - Ticks: for each armed activation with `tick`, an interval timer while
    `livePresence().activeWeb > 0`; a tick with no new entries still
    evaluates with `reason: "tick"`. Presence is checked each tick; when
    nobody is present the tick is skipped and the trace says so once.
  - Time expiry: checked before each evaluation and each tick.
  - Fire: on a result, truncate `text`, serialize the `<trigger>` message,
    `deliverUserMessage` to the session (target `sessionId`, never new),
    update `fires`, set `done` if asked. A floor of 5 s between fires of one
    activation; a result inside the floor is traced as `suppressed` and not
    delivered.
  - Hint: `src/core/chat/session/run/start.ts:216` gets a `<triggers>`
    child from counts the runner keeps per session since the agent's last
    turn (reset where the activity cursor advances).
  - Boot: on server start, scan `.beebox/triggers/*.json` and start tick
    timers for armed activations.
  - Every evaluation, skip, suppression and error appends a trace line and
    emits `trigger-changed` when the activation's `state` or `error` changed.
- Why: the stream already lands here; the hint and delivery paths already
  exist.
- Direction: `src/core/triggers/runner.ts` with injected timers and a
  `spawnEval(job)` function, so the unit tier runs it with fake timers and a
  fake child.
- Vocabulary lock-ins: `<triggers armed fired expired failed/>`; the settle
  (1 s), deadline (20 s), fire floor (5 s), tick floor (10 s) as named
  constants.
- First chunk: the settle and in-flight logic with fake timers and a fake
  child, no delivery yet.

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
  entries with lines from a JSONL file of `ActivityLine`s, or with `bbx
  figure run` output, recognized by lines starting `activity {`, each becoming
  an entry with `kind: "explored"` and that object as `activity`.
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
  "Water check", body the text, an expander showing the note and the file
  path. The prompt paragraph: a `<trigger>` message means a trigger you armed
  fired; the person has already seen `<text>`; `<note>` is yours; add
  something only if it helps, otherwise `<ack kind="no-response"/>`; never
  write a `<trigger>` yourself. The `<triggers>` hint paragraph beside the
  `<activity>` one.
- Why: without a kind, the raw tag would show; without the paragraph, the
  agent would repeat the text.
- Direction: codec and chip tests mirror the `<call>` ones.
- Vocabulary lock-ins: the tag and attributes; `<text>` and `<note>`.
- First chunk: the codec with round-trip tests.

### Track F: the pane line, `triggers.list`, the event

- What: `triggers.list({ session })` tRPC query returns activations for the
  session with `label`, `state`, `error`, `lastEvalAt`, `tick`. The companion
  pane shows one line under the tab strip when the session has any `armed`
  or `failed` activation: "Watching: Water check" (several: "Watching: Water
  check, Stuck check"); a `failed` one reads "Water check: not working". A
  tap opens a popover with each activation's label, file, state in words
  ("checked 4 seconds ago, nothing yet"; "asked the judge, answer: not yet";
  "not working: <error>"), and expiry. Refetched on `trigger-changed` for the
  session and on mount. A new `trigger-changed` event in the catalog with the
  generation bumped.
- Why: the person sees that something is watching, and what state it is in.
- Direction: a `TriggerStatusLine` component in
  `WorkspaceCanvas/view.tsx` beside the tab strip row, hidden when the list
  is empty; the popover uses the existing `Popover`. Which card is watched is
  not modeled: activations are per session, so the line shows whenever the
  pane is visible.
- Vocabulary lock-ins: `triggers.list`, `trigger-changed`.
- First chunk: the query and the line without the popover.

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
- Without the pane line: the person learns of a watch only when it fires.
  The Priya situation fails; "see the gears".
- Without replay: the agent debugs against a live person. The headless
  figure runner already prints the lines; the parser is small.
- Kept out (see NOT in scope): frontend execution, a card type, a condition
  language, wakeup triggers.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| The function throws | to add (B) | `error` result; activation `failed`; trace; hint; pane "not working" | clear |
| The child hangs (infinite loop, awaiting forever) | to add (C, fake child) | 20 s deadline, `SIGKILL`, treated as `error` | clear |
| The trigger file is deleted or fails to compile after arming | to add (B) | `error` naming the file; `failed`; retried next evaluation | clear |
| Judge over budget or unconfigured | to add (B) | `ctx.judge` returns `unavailable`; function decides; trace | clear in trace; the person sees what the function chose |
| Two activity batches land during one evaluation | to add (C) | in-flight flag re-arms the settle timer; entries above `lastEvalSeq` are never skipped | n/a |
| A repeating trigger fires on every entry | to add (C) | 5 s fire floor; `suppressed` trace lines; default expiry | clear in trace |
| Fire while the agent is mid-turn | exists for delivery (`deliverUserMessage` enqueues when busy) | the message is queued and starts the next turn | n/a |
| Server restarts with armed ticks | to add (C) | boot scan restarts timers | n/a |
| Person leaves the tab open overnight | to add (C) | ticks skip when `activeWeb === 0`; time expiry ends the activation | trace says skipped once |
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
  unique; both show in the pane line.
- **Hand-edit drift:** the boxholder edits `.beebox/triggers/<session>.json`.
  ADDRESSED: schema parse, warn, ignore; `list` reports the file as invalid.
- **Fabricated value:** the agent invents `fire="3"` or a label in prose.
  ADDRESSED: the message is system-written; the agent cannot deliver one.
- **Validation error UX:** `arm` on a module without `trigger`: "src/triggers/x.ts
  exports no `trigger` function" with the import path of the types module.
  ADDRESSED in Track B's validator messages.
- **Expired while the person is mid-task:** the pane line vanishes without a
  word. ADDRESSED in part: the agent's next hint says one expired, and the
  trace says why; the agent may re-arm. DEFERRED: whether the person should
  see "stopped watching" in the chat (Open design questions).
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
- Models other than Jev in `ctx.judge`.

## Open design questions

- **Is the note visible to the person on expand?** Lean yes: the chip shows
  the text, and the expander shows the note and the file, because nothing in
  a box is hidden from its people. The boxholder called it an "internal
  message"; if that means hidden, the expander shows only the file.
- **Does an expiry say anything in the chat?** Lean no: the pane line goes,
  the agent learns of it, and a stuck-detector ending quietly is better than
  a message about itself.
- **Indicator when no companion card is open.** Lean none: the line lives in
  the pane; a tick-only trigger with no card showing surfaces when it fires.

## Knowledge audits

New agent-facing concepts: the trigger file contract and `bbx chat trigger`.
Add `knows_directly` entries in `beebox/src/dev/knowledge-audits.yaml`:
"the learner wants to be told the moment they build water" → writes
`src/triggers/*.ts` and runs `bbx chat trigger arm`; "why didn't my trigger
fire?" → runs `bbx chat trigger log` or `run`. Run both on the worktree's
test1 clone and record the status comment.

## What will hold this after it ships

- Unit: `expiryOf`; activation read/write and lock; trace writer (cap,
  rotation, read both files); the runner with fake timers and a fake child
  (settle, in-flight re-arm, tick skip on no presence, fire floor, time
  expiry, boot scan); the module validator; `ctx.judge` with `BBX_JEV_FAKE`
  (ready, unconfigured, over budget); the codec round trip and malformed
  input; the `bbx figure run` line parser.
- Route: `activity.record` schedules an evaluation for a session with an
  activation and not for one without; `triggers.list`.
- CLI: `arm`/`list`/`disarm`/`run`/`log` under `BBX_CHAT_SESSION_ID` with a
  fixture trigger file and a fake judge.
- Frontend: `TriggerChip` renders label, text, expander; `TriggerStatusLine`
  shows for `armed` and `failed`, hides when empty.
- Browser check: a figure beside a chat, arm from a scripted agent turn or
  the CLI, act, see the chip and the line.
- No new test tier. The fake child is a function injected into the runner,
  not a mock of a process.

## Implementation order

1. Track A: store, `expiryOf`, trace, person-turn counter, deletion cleanup.
2. Track B: types module, validator, `eval-one`, `ctx.judge`.
3. Track C: runner (settle, ticks, fire floor, boot), hooked into
   `activity.record`; fire via `deliverUserMessage`; the `<triggers>` hint.
4. Track E: codec, prompt paragraphs, chip (the fire is visible from here).
5. Track D: `arm`, `list`, `disarm`, then `run` and `log`, then replay.
6. Track F: `triggers.list`, event, pane line, popover.
7. Docs: `box-docs/triggers.md`, views and figure instruction pointers,
   agent-changes entry; knowledge audits; browser check; file the cursor
   cleanup issue.

## Rollout shape

Tests named above, written with each chunk. Done when they pass, the two
knowledge audits pass on test1, and the browser check shows a fire and the
pane line. No data migration: activation and trace files start empty. The
courseware box's use is the boxholder's call.
