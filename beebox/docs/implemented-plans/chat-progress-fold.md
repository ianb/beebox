---
title: "Chat progress notes fold away when the turn ends"
status: implemented
workstream: knowledge-audit-refresh
issues:
  - ../../../issues/closed/bugs/2026-10-08-chat-agent-narrates-implementation-steps.md
---
# Chat progress notes fold away when the turn ends

The chat agent writes lines between its steps. There are two kinds. Claude 5
models write *progress updates* (thinking blocks marked `progressUpdate`),
shown as gray lines. Any model can write plain text before a tool call ("I'll
build a loan card type. Let me read how schemas work first."), shown as
full-size reply prose between the activity rows. Both stay in the transcript.
This plan folds both kinds into the activity row; the reply is the text after
the last tool call. The newest line shows until the next step folds it, and a
turn with no visible reply keeps its last line. The prompt then stops treating
these lines as part of the reply.

**Issues addressed:** `issues/bugs/2026-10-08-chat-agent-narrates-implementation-steps.md`.
Related, closed: `2026-10-08-chat-activity-row-speaks-in-commands-and-files`
(the activity row's wording; this plan reuses that row),
`2026-08-06-chat-agent-narrates-internal-bookkeeping` (the prompt rule).

## Design

### Situations

- When Priya Marlowe asks the box to set up a loan tracker and it takes a
  minute, I want to see that it is working and roughly on what, so I can wait
  without wondering whether it stalled.
- When Priya comes back to that chat the next day, I want to read what she
  asked and what the box answered, so she can pick up without wading through
  how it got there.
- When Priya wonders why the box made a loans page instead of a list, I want
  to open the steps and read the agent's own notes, so I can see the gears.
- When the agent ends a turn with its answer written only as a note (no reply
  text), I want that answer still in front of me, so it is not lost in a fold.
- Quiet case: when Priya is reading a long reply that is still streaming, she
  does not want older status lines piling up above it.

### Right place, right time

| Situation | Act, show, or quiet | Surface | Attention |
|---|---|---|---|
| Waiting on a long turn | Show the newest note only | Chat, the live turn's status line | Background, in view |
| Reading back later | Quiet: notes folded | Activity row, collapsed | Waits to be found |
| Asking why | Show on request | Activity row, expanded | Waits to be found |
| Answer only in a note | Show the last note as the turn's visible text | Chat, the turn | In view |
| A callout or spoken line before a step | Show it, as today | Chat, in place | In view |

The notes were written for the person, but they describe the work, not the
result. Their moment is while the work runs. Afterward they belong with the
other steps.

### Spirit

- **Serves:** "You should be able to see the gears": every note stays in the
  record, one tap away, next to the steps it describes.
- **Risks:** the same section, if folding hides something the person needed.
  Guard: a turn with no reply text keeps its last note visible, and every
  note stays in the expanded row.

### Trust

Display only. The box takes no new action.

### When it goes wrong or does nothing

- The agent puts its answer in a note and writes no reply: the last note
  shows as the turn's text.
- The agent writes a technical note ("Now the schema."): it shows briefly
  while the turn runs, then folds. The prompt's plain-words rule still applies.
- A turn with no notes: nothing changes.
- Prose display off: notes stay hidden, as today (`view.tsx:230` renders an
  update only when `showProse`).

### Walkthrough

Priya types "set up a tracker for what I've lent out". The live turn shows
"Setting up a place for your loans…" under a moving activity row. The agent
writes a second note, "Logging the drill and the ladder", which replaces the
first. The turn ends with "You now have a Loans page…". The status line goes
away; the activity row reads "made 3 changes" and, expanded, lists each step
with the two notes between them. The transcript on disk is unchanged.

## Smallest fix and budget

Smallest fix: drop update groups after the turn ends. It loses the
no-reply-text fallback and the notes in the expanded row. Rejected.

Chosen: one frontend track (about 80 source lines, 90 test lines), a prompt
edit (2 lines), and an audit-runner flag so `speak-outcome-not-mechanics`
grades the reply, not the folded lines (about 25 source, 35 test lines). Two
moves keep files under the line limit: the grouping code moves to
`components/chat/assistant-parts.ts`, and the audit runner's tool-call tally
moves to `runner/tool-use-behavior.ts`.

## Stated preferences this plan trades against

- The 2026-10-09 resolution kept notes visible because "a model sometimes puts
  its whole answer there" (`message-parsing.ts:424-426`). This plan keeps that
  case visible and folds the rest.
- The boxholder, 2026-10-22: notes are "a peek inside for people who are
  interested"; prompt pressure should match how prominent they are in the UI.
- The boxholder, 2026-10-22, on folding plain pre-tool text as well as
  updates: "ok, sure, fold both kinds."

## What already exists

- `groupIntoParts` (`src/frontend/src/components/chat/message-parsing.ts:428`)
  turns a progress-update block into an `UpdateGroup` that renders outside
  any activity group (`ChatMessages/view.tsx:230`).
- The live turn renders through the same `AssistantMessage` as a finished
  turn (`everywhere/InteractiveChat/message-items.tsx:178-190`, entry uuid
  `live-…`). Its entry comes from `buildStreamEntry` (`lib/stream-entry.ts`),
  which put all tools first and all streamed text last: "Tools come first,
  then the text block". Live text before a tool call had no position.
- `ActivityGroup` (`ChatMessages/activity-rendering.tsx:163`) renders
  thinking and tool parts, collapsed when there is more than one step.
  Extend its parts with a note part rendered as a line.
- `hasProgressUpdate` (`message-parsing.ts:488`) keeps a turn visible when its
  only text is a no-response ack. Unchanged.
- Prompt: `src/core/chat/session/prompts.ts:27` says a note before a tool call
  "is shown to the user in full"; line 23 is the bookkeeping rule.

## Prior art (external)

No decision depends on an external premise.

## Ontology

- **Progress note** (existing: "progress update", `UpdateGroup`): text the
  model writes for the person before a tool call. Keep the code name.
- **Live turn** (existing: the streaming tail): the turn in progress.
- **Activity part** (existing): gains a `note` member.
- **Reply** (existing idea, now a rule): text after the last tool call.
- `streamTextOffset` (new field on a live stream block): where the streamed
  text stood when the block arrived.

## Tracks / scope

### Track 1: fold notes

- **Direction:** one rule for live and finished turns, so no `live` flag.
  - `groupIntoParts(entries, { fold })` (`assistant-parts.ts`): an update, or
    text before the last tool call, becomes an activity `note` part.
  - Exceptions: text with `<speech>` stays; a folded text's callouts render in
    place as a callouts-only text group; when no text after the last tool call
    has visible content (bare `<ack>` or none yet), the last foldable line
    stays visible.
  - Debug view passes `fold: false`.
  - Live order: the chat machine stamps each streamed tool or update with
    `streamTextOffset`; `buildStreamEntry` puts the text before that offset
    ahead of the block.
  - `ActivityGroup`: a note renders as a plain line; a group with a note keeps
    the collapsible wrapper even with one step; the summary counts steps only.
- **First chunk:** the grouping function and its tests.

### Track 2: prompt

- `prompts.ts:27`: a note before a tool call shows briefly while you work and
  then folds into the steps; put the answer in reply text.
- `prompts.ts:23`: return to its pre-2026-10-22 length, dropping the
  "Setting up a place for your loans" example added that day.
- The agent guide's line on command descriptions (`guide.md`, SPEAKING) stays.

### Track 3: audit grades the reply

- Audit field `final_reply: true`: text checks run on the last assistant
  message's text after its last tool call, not on notes between steps.
  Set it on `speak-outcome-not-mechanics`.

## Could this be simpler?

Folding only progress updates would leave the plain pre-tool text, the kind
the audit and the walks saw, where it is. Folding by one rule for live and
finished turns needs no `live` prop; the cost is the stream offset, one field
set in one machine action.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Answer only in a note, then folded | New grouping test | Last note stays visible | Silent without the test |
| Live turn finalizes and the status line jumps | Same render path, keyed by turn | Same rule live and finished | Clear |
| Part of an answer written before a last step folds | No | Prompt: put the answer in the final reply | Silent; accepted |
| Live text lands on the wrong side of a tool | Stream-entry and live grouping tests | `streamTextOffset` | Silent without the tests |
| Note dropped entirely | New test: notes appear in the activity parts | Note part | Silent without the test |
| Audit grades notes after the fold | New runner test | `final_reply` flag | Clear |

## Agent-flow / user-flow edge cases

- Prose off: unchanged, notes hidden. ADDRESSED.
- Debug view: renders raw blocks; unchanged. ADDRESSED.
- Codex and older Claude models write no progress-update blocks
  (`writesProgressUpdates`, `src/shared/model-ids.ts:73`). Their pre-tool
  text folds by the same rule. ADDRESSED.

## NOT in scope

- Rewording the activity row summary.
- Removing notes from the stored transcript.

## Open design questions

None.

## Knowledge audits

`speak-outcome-not-mechanics` gains `final_reply: true` and is rerun.

## What will hold this after it ships

Unit tests on `groupIntoParts` (live and finished, with and without reply
text, callouts and speech), on `buildStreamEntry` ordering, and on the audit
runner's reply extraction. A browser check of one
live turn before landing.

## Implementation order

1. Track 1 with tests; browser check on the worktree's test box.
2. Track 2.
3. Track 3; rerun the audit.

## Rollout shape

Done when the new grouping and runner tests pass, the existing chat tests
pass, a live turn on the test box shows one status line that folds at the end,
and `speak-outcome-not-mechanics` passes 2/2. No data migration.
