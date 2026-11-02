---
title: "A chat learns why and when its background tasks were cut off"
status: implemented
workstream: maintenance-live-tasks
issues: []
---
# A chat learns why and when its background tasks were cut off

When a chat's run ends while background tasks are live, the next turn hears
from the CLI only that the tasks "didn't finish before the previous session
ended". Since `maintenance-live-tasks`, a run ended by box maintenance also
gets a `<run-ended>` note with the reason. This plan gives the same note, with
a time, for every way a run with live tasks ends, including the ones the server
cannot see happen (a crash or an out-of-memory kill).

**Issues addressed:** none filed. Follows
`docs/implemented-plans/maintenance-live-tasks.md` (Track 3) and the
boxholder's 2026-11-02 request: "give agents insights into terminations".
Searched `issues/` for `run-ended`, `terminat`, `didn't finish`, `OOM` + `chat`:
only `issues/features/2026-11-01-large-box-mode.md` (OOM history), unrelated
to the note.

## Design

The agent meets one element in its next turn's `<chat-app>` snapshot (hidden
from the person's message, `src/shared/chat-tags.ts`):

- Known cause: `<run-ended at="…" cause="…">Your previous run ended at … while
  1 background task was still running, because <cause>. …</run-ended>`
- No cause recorded, server restarted since: "… it was last seen working at T.
  No cause was recorded, and the Bee Box server restarted at T2, so the server
  most likely crashed or was killed (for example, out of memory)."

Causes the server records, worded for the agent:

| Ending | Where | Cause text |
|---|---|---|
| Box maintenance that cannot wait | `pauseForMaintenance` | `box maintenance (<owner reason>)` |
| Server shutdown | `registry/shutdown.ts` | `the Bee Box server shut down` |
| Hung run evicted (4 h silent) | `registry/cap.ts` (sweep, live cap) | `it had produced no output for 4 hours and was treated as hung` |
| Model change requested (may name the same model) | `trpc/routers/chat/control-procedures.ts` | `a model change was requested` |
| Restart requested | same | `a restart was requested` |
| Provider setup gone | `run/core.ts` `sendReadiness` branch | `its provider setup changed` |
| Agent process ended on its own | close handler | `the agent process ended on its own` (the backend exposes no exit code) |
| Chat deleted or reset | — | none: there is no next turn of this conversation |

No design section beyond this: the person sees nothing new; the agent's reply
is how they learn.

## Smallest fix and budget

Smallest: write the note in each `stop`/`restart` path with a cause. That
misses the crash case, which the boxholder's OOM history makes the most
common unexplained one. Chosen: keep a per-session record while tasks are live,
stamped with a cause when the server ends the run; an unstamped record found
later means the server never saw the end. ~120 source, ~80 test lines.

## Stated preferences this plan trades against

- "Minimize invented concepts": reuses the run-ended note file and element;
  the record is that file, written earlier.
- "Bias toward strict": a record whose state is uncertain says so ("no cause
  was recorded") instead of guessing a cause.

## What already exists

- Note file, render and consume: `src/core/chat/session/run/ended-note.ts`;
  read in `composeTurnContent` (`run/start.ts`), removed after dispatch
  (`run/core.ts`, `dispatched()`).
- Live task set and its SDK updates: `run/live-tasks.ts`; SDK updates arrive at
  `run/core.ts` `handleMessage` (`if (msg.type === "task-level")`); every run
  message calls `noteRunMessage` (`run/consume.ts:76`); the close handler is
  `emitClose(code)` in `consumeMessages`.
- Intentional ends go through `endRun` (`live-tasks.ts`) from `stop()` and
  `restart()`.

## Prior art (external)

No decision depends on an external premise.

## Ontology

- **Task record** (the note file, same path `.beebox/chat-run-ended/<session>.json`):
  `{ tasks, lastSeenAt, writer, at?, cause? }`; the first version's
  `{ at, reason, tasks }` still reads as a maintenance cause. Exists while a run
  has live tasks, and after such a run ends until the next turn reads it.
  `writer` is a random id per server process (not a pid, which can be reused).
- **Cause**: agent-facing text from the table above.

## Tracks / scope

### 1. The record lives with the task set

- `createLiveTasks(now, record)` where `record` is
  `{ boxRoot, sessionId: () => string | null, pid }`.
- `observe(tasks)` (SDK updates only): set, then write the record when
  non-empty, or remove it when empty and not `ended`. `set([])` at run start
  and close stays in-memory.
- `noteRunMessage()`: rewrite `lastSeenAt` at most once a minute while tasks
  are live.
- `recordEnd(cause)`: stamp `ended` when tasks are live (from `endRun`).
- `closed()`: stamp `the agent process ended on its own` when tasks are live
  and no end was recorded, then clear in memory. `set([])` at a run's start
  resets the recorded-end flag, so one run's cause never carries to the next.
- `stop(cause?)`, `restart({ cause? })` carry the cause to `endRun`. Callers in
  the table pass theirs.

### 2. The next turn reads only an ended or orphaned record

- `pendingRunEndedNote(boxRoot, sessionId)`: a stamped record → known-cause
  note. An unstamped record another server process wrote → the no-cause note,
  with this server's start time. An unstamped record this process wrote is
  either live or about to be stamped by its close handler → no note. (Plan
  review: deciding orphanhood from "no live run" raced the close handler.)
- `dispatched()` removes the file only if its content is unchanged since the
  read, so a live record written by the new run in between survives. Delivery
  is best effort: a crash between removal and the agent reading its input
  queue loses the note.

## Could this be simpler?

Dropping the heartbeat leaves "last seen working" at the last task change,
which can be hours stale; the minute-throttled rewrite costs one small write a
minute per working chat. Dropping the writer id makes an unstamped record
ambiguous (live run, or a crashed server); it is one field.

## Plan review

Codex `gpt-6-sol`, 2026-11-02, seven findings, all folded in: orphanhood by
writer id, not "no live run" (1); same path and old shape kept (2);
best-effort delivery stated (3); no invented exit code (4); per-run reset of
the end flag (5); model-change wording (6); a random writer id replaces the
pid (7, partly: the id is still needed for 1).

## Diff review

Codex `gpt-6-sol`, 2026-11-02, two findings, both fixed and confirmed in a
verification round: a task update or heartbeat after a stamped end no longer
overwrites the cause; a turn composed while the ended run is still closing
does not take its note (`LiveTasks.ending()`). The underlying silent drop of a
send into a closing run predates this work:
`issues/bugs/2026-11-02-send-during-run-close-silently-dropped.md`.

## Subplans

None.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Record write fails (disk) | No | Logged, chat continues | Clear in journal |
| Live record mistaken for an orphan on the next ordinary turn | New test | `liveRun` check | — |
| New run's live record deleted by the old note's cleanup | New test | Unchanged-bytes check | — |
| Session deleted with a record left | No | Small file under `.beebox/` | Silent; accepted |
| Two server processes for one box (dev) | No | writer differs → "server restarted" wording | Wrong wording, rare; accepted |
| A send starts a new run in the gap before the old run's close handler stamps it | No | New run's `set([])` resets; old record stays unstamped by this writer, then is removed when the new run's tasks settle | Silent loss of one note; rare, accepted |

## Agent-flow / user-flow edge cases

- Agent restarts its tasks after the note: the new run's `observe` writes a
  fresh record. ADDRESSED.
- Person never sends again: record stays; harmless. ADDRESSED.

## NOT in scope

- Telling the person (UI) why tasks stopped: the agent's reply covers it.
- Warning a chat before a deploy ends it: the chat is between turns and the
  box is closed; a warning would need an unprompted turn.
- Reading the journal or kernel log to name an OOM kill: the box user cannot
  read them; "most likely" wording instead.

## Open design questions

None.

## Knowledge audits

None: the note is self-describing text in a turn.

## What will hold this after it ships

`run.maintenance.test.ts` (extended): maintenance cause; agent process exit
with tasks; orphaned record from another pid; an ordinary turn during a live
record gets no note; `dispatched()` keeps a rewritten record. Unit tests of the
record helpers with a fixed clock.

## Implementation order

1. Record helpers + `LiveTasks` changes + tests.
2. Cause threading through `stop`/`restart` callers.
3. Docs (`docs/chat/sessions.md`).

## Rollout shape

Done when change-selected tests, typecheck, lint, layout-check pass and the
cross-model review is adjudicated. No migration: the path is unchanged and
the first version's note shape still reads (plan review finding 2).
