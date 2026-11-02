---
title: "An interrupted chat wakes itself to decide about its unfinished work"
status: draft
workstream: maintenance-live-tasks
issues: []
---
# An interrupted chat wakes itself to decide about its unfinished work

A chat whose background tasks were cut off learns why on its next turn
(`docs/implemented-plans/chat-termination-notes.md`). That turn comes only
when someone writes to the chat, so research cut at 03:00 waits until morning.
This plan has the server start that turn itself, once, when the run was
interrupted from outside, so the agent decides whether to restart the work.

**Issues addressed:** none filed. Boxholder, 2026-11-02: "Yes, I think that
wake up (specifically when it is interrupted) would be good". Searched
`issues/` for `wake`, `resume after`, `unprompted`: nothing on this.

## Design

When the server can run chats again and a chat has an unread run-ended note
whose cause was an interruption, the server sends that chat one turn: an
`<interrupted-wake>` element, hidden from the person's view like
`<schedule-fired>`, with the `<run-ended>` note in the snapshot as usual. The
agent decides to restart, drop, or ask; its reply is what the person sees.

| Cause | Interruption? | Wake |
|---|---|---|
| Box maintenance (deploy, dev reload) | yes | yes |
| Server shut down | yes | yes |
| Server crashed or was killed (unstamped record from an earlier server) | yes | yes |
| Agent process ended on its own | yes | yes |
| Hung (4 h silent) eviction | no: the work itself stalled | no |
| Restart / model change requested, provider setup gone | no: someone acted, or the run cannot start | no |

Safeguards:
- One wake per note: the record gets `wokenAt` at dispatch (a refused start
  leaves the note eligible; that chat is retried after 10 minutes). If the
  claim cannot be written, the turn is abandoned.
- At most two wakes per chat in 24 hours (`.beebox/chat-wakes.json`), so an
  agent that restarts work that keeps crashing the server (out of memory)
  cannot loop. Past the limit the note waits for the person.
- An unstamped record wakes only when no live run holds that session's
  chat-active lock (`loadActiveChats`, `src/core/schedule/state.ts`). One
  server serves a box: each `bbx serve` kills the previous one
  (`src/webapp/server/app.ts:318-319`, `killPreviousServer`), so another
  writer's record is from a dead process.
- No wake while the box has a live maintenance owner, while the chat is busy,
  or for a chat being deleted or that cannot be resumed (same checks as a chat
  check-in, `webapp/routes/chat/schedule-fire.ts`).

## Smallest fix and budget

Smallest: at server start, wake every chat with a note. Misses the in-process
"agent process ended on its own" case and wakes after requested restarts.
Chosen: a 30 s poll in the chat routes over the notes directory, with the
cause table above. ~130 source, ~90 test lines.

## Stated preferences this plan trades against

- Boxholder: "specifically when it is interrupted": the table excludes
  hung and requested endings.
- "Minimize invented concepts": reuses the run-ended record, the check-in
  turn path (`sendFiredTurn`, `fireChatSchedule`'s checks), and the hidden-tag
  convention of `<schedule-fired>`.

## What already exists

- Record, causes, render: `src/core/chat/session/ended-note.ts`; cause
  strings passed at `registry/cap.ts`, `registry/shutdown.ts`,
  `src/webapp/trpc/routers/chat/control-procedures.ts`, `run/core.ts`.
- Server-started turn: `sendFiredTurn` and the checks in `fireChatSchedule`
  (`webapp/routes/chat/schedule-fire.ts`), wired in `webapp/routes/chat/register.ts:239`.
- Hidden system tags: `stripUserDisplayTags` (`frontend/src/components/chat/message-parsing.ts`),
  and `src/cli/lib/session-real-user.ts` counts only `<typed>`/`<speech>`/`<external-input>`
  as the person.

## Prior art (external)

None needed.

## Ontology

- **End cause** (new shape for the existing cause string): `{ text, wake }`.
- **`wake`** on a stamped record; an unstamped record from another server
  process counts as `wake: true`; the first notes' `{ at, reason, tasks }` too.
- **`wokenAt`** on the record: set once the server sent the wake.
- **Wake log** `.beebox/chat-wakes.json`: `{ [sessionId]: string[] }` of wake
  times, pruned to 24 h.

## Tracks / scope

1. `ended-note.ts`: `EndCause`, named causes, `wake` stamped, `wakeCandidates(boxRoot)`
   (records with a note to give, `wake`, no `wokenAt`), `markWoken`. Callers
   pass named causes.
2. `webapp/routes/chat/interrupted-wake.ts`: `startInterruptedWakes(deps)`,
   30 s unref interval, first pass 5 s after start; per candidate: skip under
   a live maintenance owner, skip a busy session, apply the check-in checks,
   enforce the 24 h limit, `markWoken`, then `sendFiredTurn` with
   `<interrupted-wake at="…">`. Stopped on chat shutdown.
3. Frontend strips `<interrupted-wake>`. No prompt change: the element says
   what it is.

## Could this be simpler?

Without the 24 h limit a crash-looping workload wakes the chat on every
restart; the limit is one small file. Without the poll (start-only) the
in-process case never wakes.

## Plan review

Codex `gpt-6-sol`, 2026-11-02, seven findings. Folded in: liveness of an
unstamped record by the chat-active lock plus the one-server rule (1);
explicit legacy cause mapping (2); claim at dispatch with retry backoff (3);
claim must be written or the turn is abandoned (5); citation paths (7).
Rejected: concurrent pollers (4), since one server serves a box; replacing
the poll with events (6): one 30 s pass over a small directory covers
startup, maintenance end and in-process ends with one code path.

## Diff review

Codex `gpt-6-astra`, 2026-11-02, five findings, all fixed: the claim
refuses a record replaced since selection (1); shutdown or deletion during a
wake's admission abandons it (`onAdmitted`/`onDispatch` checks) (2, 4); the
wake turn is pinned like a person's send (3); each wake runs on its own, so a
stuck turn holds up no other chat (5). Findings 2, 3 and 5 also apply to the
existing check-in path (`fireChatSchedule`), which is unchanged.

## Subplans

None.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Wake turn fails to start | New | `wokenAt` already set; note stays for the person | Logged |
| Server crashes again during the wake | No | `wokenAt` set; limit counts it | Next note waits after 2 |
| A second server for the box | — | Not possible: `killPreviousServer` | — |
| Person sends during the wake | — | Session busy → their message queues | Clear |

## Agent-flow / user-flow edge cases

- Agent restarts the work and it is interrupted again: a new note, a new wake,
  until the 24 h limit. ADDRESSED.
- Person is reading the chat when the wake runs: they see the agent's reply
  appear, as with a check-in. ADDRESSED (no new UI).

## NOT in scope

- A UI marker for "the chat woke itself": the agent's reply says so.
- Waking for hung or requested endings: excluded by the boxholder's wording.

## Open design questions

None.

## Knowledge audits

One line in the chat prompt describing `<interrupted-wake>`; no audit: it is
self-describing.

## What will hold this after it ships

Legacy records: the first notes (`reason`) and stamped records from before
`wake` map by cause text; an unknown stamped cause does not wake. Integration: a wake runner
test with the fake backend: a stamped interruption wakes once; a hung one does
not; a second pass does not re-wake; the third note in 24 h does not wake.

## Implementation order

Tracks 1 → 2 → 3, one commit each or together.

## Rollout shape

Done when change-selected tests, typecheck, lint, layout-check pass and the
cross-model review is adjudicated. Notes left by earlier versions wake once,
which is the intent.
