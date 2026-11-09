---
title: "Chat activity row shows stages, and Codex steps get real labels"
status: implemented
workstream: chat-activity-stages
issues:
  - ../../../issues/closed/bugs/2026-11-06-codex-chat-later-text-replaces-earlier-text.md
---
# Chat activity row shows stages, and Codex steps get real labels

The chat folds the agent's in-between notes into the collapsed activity row
(plan `implemented-plans/chat-progress-fold.md`). In that row the notes are
easy to miss, the collapsed summary ignores them, and every Codex command
reads "Took a step". This plan shows each note as the start of a stage of
work, names stages in the collapsed summary, and labels Codex steps from the
command types Codex already parses.

**Issues addressed:** `issues/bugs/2026-11-06-codex-chat-later-text-replaces-earlier-text.md`.
Related, not closed here: `issues/features/2026-10-08-long-turn-gives-no-sign-of-progress.md`
(a stage summary is one more sign of progress, but that issue asks a broader
question). Searched the queue for "activity row", "Took a step", "progress
note", "fold": no other open item.

## Design

### Situations

- When Priya Marlowe asks the box to tidy her recipes and the turn runs for
  two minutes, I want the row to say which part of the job it is on, so I can
  tell it is moving and roughly where.
- When Priya opens a finished turn's steps to see why it changed a card, I
  want the agent's notes to stand out from the steps and the steps grouped
  under them, so I can find the part I care about without reading ten lines.
- When a Codex step ran a command with no description, I want the line to say
  something specific (what it read, what it searched, or which command), so
  "Took a step" ten times does not hide everything.
- When Priya watches a live turn, I want a line the agent just wrote not to
  vanish when the next step starts, so I do not think text was lost (the
  reported bug).
- Quiet case: when Priya reads the chat the next day, she does not want stage
  headings or command names in the transcript; the row stays one collapsed
  line above the reply.

### Right place, right time

| Situation | Act, show, or quiet | Surface | Attention |
|---|---|---|---|
| Long turn running | Show the newest note in the row's summary | Live activity row, collapsed | Background, in view |
| Opening a finished turn's steps | Show stages: note as heading, steps under it | Activity row, expanded | Waits to be found |
| Codex step with no description | Show a plain label, or a faded command shorthand | Activity row line | Waits to be found |
| Reading back later | Quiet: one summary line | Activity row, collapsed | Waits to be found |

### Spirit

- **Serves:** "You should be able to see the gears" (`spirit.md:19`): the
  notes say why, and the stages tie each step to the reason given for it.
- **Risks:** "It should feel like a place" if command names make the chat read
  like a terminal. Guard: a command shorthand appears only when nothing plainer
  is known, faded, and only in the expanded row.

### Trust

Display only. The box takes no new action.

### When it goes wrong or does nothing

- A turn with no notes: one stage with no heading; the row looks as today.
- A note before the first step: it heads the first stage. Steps before the
  first note form an unheaded first stage.
- Codex parses a command wrongly (calls a write a "read"): the line says
  "Looked at …" for a command that changed something. Codex's own parser
  decides this; the raw command stays one click away.
- The rollout cannot be read during a live turn (missing, not yet flushed):
  live lines fall back to the command shorthand; the history read at turn end
  supplies the labels.
- A command the shorthand cannot shorten (starts with a quote or `$(`): the
  line says "Ran a command".

### Walkthrough (Codex)

Priya asks a Codex chat to check her views. The agent writes "I'll check the
view setup first." and runs `cat _content/Home.view.card` and
`bbx view check`. The live row reads *I'll check the view setup first · 2
steps*. The agent writes "Two views have a stale filter; fixing them." and
edits two files. The row now reads with the second note. The turn ends with
the reply. History reloads; the row reads *2 stages · 4 steps* (wording is an
open choice), and expanded shows two headed stages: "Looked at Home"
and a faded `bbx view check` under the first (a read outside `_content/`
reads "Checked something in your box", as Claude's Read does); two "Made a change to …"
lines under the second.

## Smallest fix and budget

Smallest fix for the reported bug: keep notes inline while the turn streams
and fold at the end. It removes the "replaced" moment and does nothing for
the boxholder's three other requests (notes obvious, summary mentions them,
labels). Rejected as the whole plan; it is one option inside Track 3.

Chosen: four tracks, about 250 source lines and 300 test lines.

- Track 1, Codex labels in history: about 40 source, 60 test.
- Track 2, step labels and shorthand: about 60 source, 80 test.
- Track 3, stages in the row: about 90 source, 100 test.
- Track 4, live Codex labels from the rollout: about 60 source, 60 test.

## Stated preferences this plan trades against

- 2026-10-22, boxholder: notes are "a peek inside for people who are
  interested"; "fold both kinds". Kept: notes stay folded in the row.
- 2026-11-08, boxholder: make notes more obvious, have the summary say
  something about them, show the stage structure; the "chunk" word is wrong.
- 2026-11-08, boxholder, on reading the rollout during a live turn: "not a
  terrible overhead ... would improve the output". Approved.
- `activity-wording.ts:1-6`: the row speaks in "terms a non-technical person
  reads as 'the box is working on my stuff', not as commands run on their
  computer". The command shorthand trades against this; the boxholder asked
  for it, and it applies only when no plain label is known.
- Precedent `chat-progress-fold.md`: one grouping rule for live and finished
  turns, "so no `live` flag". Track 3's fold-while-streaming option would add
  that flag; the lean below avoids it.

## What already exists

- `groupIntoParts` (`src/frontend/src/components/chat/assistant-parts.ts:79`)
  folds updates and pre-tool text into `ActivityPart` `{ type: "note" }`.
  Reuse; stages are derived from its `parts`, so grouping is unchanged.
- `ActivityGroup` (`ChatMessages/activity-rendering.tsx:168`) renders parts in
  order; a note is `<div className="my-1 text-card-pen">`. Change.
- `summarizeActivity` (`ChatMessages/activity-wording.ts:54`): notes count only
  when nothing else is there: `"noted progress"`. Change.
- `describeToolCall` Bash (before this plan): `description ?
  capitalize(description) : "Took a step"`. Change the fallback.
- `describeFileTool`, `describeSearch` (`activity-wording.ts:153, 204`) give
  Read/Grep/Glob their lines. Reuse for Codex read/search/list actions.
- Codex history: `entriesFromThread` (`core/chat/session/codex-transcript/core.ts:154`)
  maps app-server items through `normalizeCodexToolItem`
  (`services/codex-tool-activity.ts:96`), which keeps only `command`. The
  app-server item already carries `commandActions` and `agentMessage.phase`:
  `codex app-server generate-ts` (0.164.0) gives
  `CommandAction = { type: "read", command, name, path } | { type: "listFiles",
  command, path } | { type: "search", command, query, path } | { type:
  "unknown", command }`, and `phase: MessagePhase | null` on `agentMessage`.
  A real `thread/read` on a local exec thread returned both populated
  (`phase: "commentary"`; `commandActions: [{ type: "read", name: "AGENTS.md",
  path: "/…/AGENTS.md" }]`). Reuse; no rollout read for history.
- Live Codex: `codex-chat.ts:164` pushes `codexSdkToolChatMessage(item)`; the
  SDK item has no parsed command. The rollout records it:
  `item_completed` → `{ type: "CommandExecution", id, command: [bash, "-lc",
  cmd], parsed_cmd: [{ type: "read" | "search" | "list_files" | "unknown", … }] }`.
  `findCodexRollout` and `codexHomeDir` (`services/codex-rollout-model.ts:39, 56`)
  locate the file. Reuse.
- Turn end: `STREAM_RESULT` → `refreshing` (`machines/chatMachine/machine.ts:328`)
  replaces the live entry with history, so a finished turn always shows Track
  1's labels whatever Track 4 managed.
- Tool input flows unchanged to the row both live
  (`chat-actors.ts:191-198`, `input: block.input`) and from history
  (`codex-transcript/core.ts:176`, `input: tool.input`). New fields ride in
  `input`; no type change to `SessionContentBlock`.

## Prior art (external)

- ChatGPT and Codex apps collapse `commentary` messages above the answer
  (noted in the issue's finding, 2026-11-08). Evaluated only.
- Codex's `parsed_cmd` / `commandActions` is Codex's own command classifier;
  adopted as data, not code. No acknowledgement needed: we read its output.

## Ontology

- **Note** (existing, `ActivityPart` `note`): a line the agent wrote between
  steps. Unchanged.
- **Stage** (new, frontend only): a note and the steps after it, up to the
  next note. The first stage may have no note. Derived; never stored.
  Not "chunk" (boxholder rejected it). The user-facing word is an open choice.
- **Step** (existing word in the summary): one tool call the summary
  counts, which excludes hidden tools (TodoWrite) and thinking. Today's
  `countToolCalls` (`activity-rendering.tsx:119`) also counts thinking; it
  decides only whether a group gets the collapsible wrapper, and the new
  summary uses the step count, tested in Track 3.
- **Command action** (new, from Codex's `CommandAction`): Codex's parse of a
  command: read, search, listFiles, unknown. Stored on a Codex Bash step's
  `input.actions`.
- **Command shorthand** (new): the first words of a command, e.g.
  `bbx view check`, plus "+N" for more commands. A pure function of the
  command string.
- **Commentary** (Codex's `phase: "commentary"`): Codex marks an in-between
  message. Mapped to the existing progress update (`thinking` +
  `progressUpdate: true`, `session-content.ts:45`), which already folds as a
  note.

## Tracks / scope

### Track 1: Codex labels in history (done)

- **What:** carry `commandActions` into a Codex Bash step's input, and map a
  `commentary` agent message to a progress update.
- **Why:** finished Codex turns show "Took a step" for every command, and a
  commentary message after the last command shows as reply text.
- **Direction:**
  - `codexToolItemSchema` `commandExecution` gains `commandActions:
    z.array(commandActionSchema).optional()`. `normalizeCodexToolItem` sets
    `input.actions` to the parsed list, dropping each action's `command` copy.
  - `entriesFromThread`: `agentMessage` with `phase === "commentary"` becomes
    `{ type: "thinking", text, progressUpdate: true }`.
- **Vocabulary lock-ins:** `input.actions: Array<{ type: "read"; name: string;
  path: string } | { type: "search"; query: string | null; path: string | null }
  | { type: "listFiles"; path: string | null } | { type: "unknown" }>` on a
  Bash tool block.
- **First chunk:** the schema, the normalizer, the commentary mapping, and
  fixture tests in `test/core/chat/session/codex-transcript/core.test.ts`.

### Track 2: step labels

- **What:** describe a Bash step from its actions, else from a shorthand.
- **Why:** "Took a step" says nothing.
- **Direction:** in `activity-wording.ts`, Bash without description:
  1. all actions `read` → the Read line for the first path, "and N more";
  2. all `search` → the Grep line for the first query;
  3. all `listFiles` → "Looked through your box";
  4. otherwise → shorthand of `input.command` (`commandShorthand`, pure,
     exported); the line renders it faded and monospace (presentation is an
     open choice);
  5. no usable shorthand → "Ran a command".
  `commandShorthand`: split on top-level `&&`, `||`, `;` (quote-aware); drop
  `cd …` and `VAR=…` prefixes; in the first command (first pipeline stage)
  keep leading bare words (`/^[A-Za-z][\w.:-]*$/`, a path keeps its basename)
  up to three; "+N" counts the remaining commands.
- **Vocabulary lock-ins:** `commandShorthand(command: string): { head: string;
  more: number } | null`.
- **First chunk:** `commandShorthand` and the action labels with tests in
  `chat.activity-wording.test.ts`.

### Track 3: stages in the row

- **What:** split an activity group's parts at each note into stages; render
  each note as a heading with its steps under it; name stages in the
  collapsed summary.
- **Why:** the boxholder asked for notes to stand out and for the stage
  structure to show.
- **Direction:**
  - `splitStages(parts: ActivityPart[]): Stage[]` with `interface Stage { note:
    string | null; parts: ActivityPart[] }` (pure, in `assistant-parts.ts`).
  - Expanded: a heading per noted stage (ink color, normal size, first line
    bold or not per the choice), its steps indented under it.
  - Collapsed summary: one of the options in *Open design questions*.
  - Fold while streaming: lean is to keep the single grouping rule and show
    the newest folded note in the row's summary. While a turn streams, the
    newest line shows as text below the row (`keptLine`,
    `assistant-parts.ts:87`); when the next step arrives it folds and becomes
    the newest note, so it moves from below the row into the row's header.
    No live flag and no live commentary marker are needed. The other option,
    notes inline until the turn ends, needs `groupIntoParts` to know the turn
    is live.
- **First chunk:** `splitStages` with tests. Rendering waits on the choices.

### Track 4: live Codex labels from the rollout (dropped, see Open design questions)

- **What:** while a Codex chat turn runs, read the rollout's
  `CommandExecution` records and attach their `parsed_cmd` to the live step.
- **Why:** a long live turn otherwise shows shorthand for reads and searches
  until the turn ends.
- **Direction:** `services/codex-rollout-tail.ts`:
  `class CodexRolloutTail { constructor(codexHome, threadId); actionsFor(command: string): Promise<CommandAction[] | null> }`.
  It reads bytes after its last offset, parses complete lines, queues
  `CommandExecution` records by display command, and returns the oldest match
  (same `codexDisplayCommand` on both sides). `codex-chat.ts` routes every
  push in a turn (agent messages, tools, and the result) through one per-turn
  promise chain, so a delayed tool cannot be passed by a later message or the
  result. The tool waits at most 250 ms; on timeout or any error it pushes
  without actions and warns once per turn.
- **First chunk:** the tail class with a fixture rollout test.

## Could this be simpler?

Simplest: Track 1 plus a shorthand, no stages, no rollout. Finished Codex
turns get real labels, and the row stays as today. That fails the boxholder's
first two asks (notes obvious, summary about notes). Stages are a frontend
derivation over existing parts with no stored state, so their cost is
rendering only.

Track 4 is the optional part. Without it, a live Codex turn shows shorthand
for every command and the labels appear at turn end. Codex box chats mostly
run `bbx` commands (`unknown` to Codex's parser), so shorthand covers most
live lines either way. Keep Track 4 last and cut it if the exhibit shows the
shorthand is enough; the boxholder approved the cost, not the necessity.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| App-server omits `commandActions` (older Codex) | New normalizer test | Optional field, shorthand fallback | Clear (shorthand shows) |
| `commentary` message is the turn's only text | Existing kept-line test covers updates | `keptLine` (`assistant-parts.ts:81`) | Clear |
| Shorthand mangles a quoted command | New shorthand tests | Falls back to "Ran a command" | Clear |
| Rollout not flushed when the item arrives | New tail test | 250 ms cap, then no actions | Silent live; fixed at turn end |
| Rollout match pairs the wrong command (same text twice) | New tail test | Oldest-first queue per command | Silent; same label either way |
| Waiting on the rollout reorders live items or lets the result pass a tool | New codex-chat test with a delayed tail | One chain for messages, tools, and result | Silent without the test |
| Stage split drops a step or note | New `splitStages` test | Pure split, total-count check in test | Silent without the test |

No critical gap: each silent row has a test.

## Agent-flow / user-flow edge cases

- Wrong tag / wrong field: not applicable; no agent-written vocabulary.
  ADDRESSED.
- Claude-engine turns: same row. Claude Bash steps carry `description`, so
  Track 2 changes only description-less calls (rare). Claude notes come from
  progress updates and pre-tool text; stages apply the same way. ADDRESSED
  (Track 3 tests include a Claude-shaped turn).
- Prose display off: notes are hidden (`view.tsx:230`); a hidden note starts
  no stage heading. ADDRESSED in Track 3 by passing the existing flag.
- Debug view: `fold: false`; unchanged. ADDRESSED.
- Stored history: Codex history comes from Codex's thread store; Claude's from
  its transcript. Nothing new is persisted. ADDRESSED.
- Partial rollout line at end of file: only complete lines are parsed.
  ADDRESSED in Track 4.

## NOT in scope

- Track 4, live labels from the rollout: dropped (see *Open design
  questions*). A finished turn gets Codex's parse from history.
- Naming stages from Codex `todo_list` items. Considered: box chats rarely
  produce a plan, and a todo item does not line up with notes. Not now.
- Labels for unknown MCP tools ("Took a step" stays there).
- A heartbeat or elapsed time for long turns (the related feature issue).
- Prompt changes about how agents write notes.

## Open design questions

None. Decided 2026-11-08: the options were shown to the boxholder as an
exhibit of two real Codex turns (newest-note, count, and today's-wording
summaries; heading and per-stage-fold notes; faded command words, "Ran …"
text, and "Took a step" plus command; fold-now and inline-until-end
streaming). The boxholder asked to finish without choosing, so the leans
landed: the newest note's first line and the step count in the folded
summary; notes as headings over their steps; faded command words; notes fold
as steps arrive (the existing rule). No user-facing noun for a stage.

Revised 2026-11-08 after use: the command words read as noise in a real
turn (`cat +2`, `sed +2`, `ls`, `ls`, `mkdir +10`), and the boxholder chose
to go back to "Took a step" for a command Codex did not parse as a read,
search, or listing. `command-shorthand.ts` was removed. The opened row's
summary line now gives only the step count, since the newest note heads its
stage just below it.

Track 4 was dropped: in both test turns Codex classified every command as
`unknown`, including a multi-file `cat`, so live lines would show the same
command words with or without the rollout read.

## Knowledge audits

None: no agent-facing concept changes. The prompt still says notes fold into
the steps (`prompts.ts:27`).

## What will hold this after it ships

Unit tests on the pure parts: normalizer fixture (Track 1), `commandShorthand`
and action labels (Track 2), `splitStages` and summary wording (Track 3), the
rollout tail against a fixture file (Track 4). A browser check of one live
Codex turn on the worktree's test box, which is also the exhibit.

## Implementation order

1. Track 1 with tests.
2. Track 2's `commandShorthand` and action labels with tests.
3. Track 3's `splitStages` with tests.
4. Exhibit: a dev-only switch renders the options; screenshots of a real
   Codex turn; ask the boxholder.
5. Track 3 rendering and Track 2 presentation per the answers; remove the
   switch.
6. Track 4, unless the boxholder drops it.

## Rollout shape

Done when the new tests pass, the existing chat and Codex transcript tests
pass, and the browser check passes: a live Codex turn on the test box that
writes text, runs a command, and writes more text. Both texts stay reachable
while it streams (below the row or in its header and expanded list) and after
reload, with stage headings and labelled steps. No data migration: nothing stored changes.
