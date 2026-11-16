---
title: "Composition: copy for publishing, a marks list, and resolving marks"
status: implemented
workstream: composition-editor
issues: []
---
# Composition: copy for publishing, a marks list, and resolving marks

A composition's Copy button wraps every open mark in `[ ]`. A short joiner
the person read and kept ("but") pastes as `[but]`, and a note pastes as
text. This plan gives Copy a publishing form: agent words copy as plain text,
and gaps, notes, and checks must be resolved first. Where they are not, Copy
shows what is left and how to resolve each one. The editor gets a list of the
open marks and bulk actions, each committed on its own after the person's
pending edits.

**Issues addressed:** none filed. The request came from the boxholder in the
composition-editor session (2026-11-16). Searched `issues/` for
"composition", "joiner", "copy": the only related item,
`issues/features/2026-10-08-drafted-message-has-no-copy-control.md`, is the
one the parent plan already addressed; nothing here changes it.

Parent: [composition editor](composition-editor.md) and
its [design](composition-editor.design.md).

## Design

### Boxholder decisions (2026-11-16)

- Copy brackets are unwanted in a publishing copy: "if one phrase has those
  []'s around them in a big document, it's easy not to realize and the
  result looks weird."
- "No published copy without resolving things. BUT, it should be clear to
  the person trying to publish their piece (and maybe unaware or not caring
  about the open notes), how they resolve this."
- Agent words do not block: "maybe proposed text shouldn't be a blocker for
  that." And: "I don't want to encourage people to whitewash their AI text
  just so they can make a publishable version." So publishing never asks
  the person to accept agent words, and the Copy surface offers no accept.
- Accept all "finalizes everything, and commits ... if there's in progress
  edits they should probably get committed first, and then the 'accept all'
  is really a stand-alone commit."
- The editor bar shows a count of open marks; its dropdown lists each one
  and ends with Accept all.

### Situations

- When Priya has read her piece and kept two of the agent's joining words as
  they were, I want Copy to give clean text, so I can paste it into the post
  without hunting for brackets.
- When Priya presses Copy and a gap is still open (or a note she never
  looked at), I want to be told what is left and shown how to clear each
  thing, so I can publish without learning what a "note mark" is.
- When Priya wants another chat or a friend to look at the draft, I want a
  copy that says which words are the agent's and where the holes are, so the
  reader can see the state of the draft.
- When a long piece has one mark left somewhere, I want a count and a list I
  can jump through, so I do not have to read 4,000 words to find it.
- When Priya decides the agent's words are now hers, I want one action that
  accepts them all, recorded apart from her own writing.
- Quiet case: when nothing blocks, Copy copies at once, with no question.
  Agent words that remain go out as plain text and stay marked in the box.

### Right place, right time

| Situation | Act, show, or quiet | Surface | Attention |
|---|---|---|---|
| Copy, nothing blocks | Act | Copy on the composition block (read view) | None: copies at once |
| Copy, gaps/notes/checks open | Show what is left and how to resolve it | A popover under Copy | Waits for the person; no publishing copy until resolved |
| Draft copy for another reader | Act on request | "More copy options" menu beside Copy, in every state; also in the popover | Waits to be found |
| Find the open marks | Show | "N marked" button in the editor bar, a list menu | Waits to be found; the count is visible while editing |
| Accept all agent words | Act on request | Editor marks menu only | Waits to be found |

The check comes at Copy because Copy is where the text leaves the box.
Asking earlier (at Done, at Commit) interrupts writing.

### Spirit

- **Serves:** "People aren't broken versions of their better selves." Reading
  the piece and finding it fine is a decision; the person does not owe the
  box one click per joining word before publishing.
- **Serves:** "You should be able to see the gears." The count shows how many
  marks are open, the list shows where, and each bulk action leaves its own
  commit.
- **Risks:** "The best stuff comes from the people", in two directions.
  Quiet adoption: a publishing copy gives agent words as plain text. Guard:
  inside the box those words stay marked; only the person's act (Accept,
  Accept all) unmarks them. Whitewashing: a publishing flow that required
  accepting would teach people to accept to get past it. Guard: Copy never
  offers or requires an accept; Accept all lives only in the editor's marks
  menu.

### Trust

- Copy with nothing blocking: automatic.
- Copy with blockers: shows; it does not act. The resolving actions are the
  person's.
- Bulk actions (Remove all notes, Keep all checked words): confirmation by
  the act. Accept all agent words: a confirmation with a warning (boxholder:
  "Warnings on that button are okay"), since it changes authorship. Each works only on the text the person
  saw: the server refuses when the region changed since the person's view
  (`baseRegionHash`), so a mark the agent added a second ago is not resolved
  unseen.

### When it goes wrong or does nothing

- The agent changes the text between the person's view and a bulk action:
  the server answers `conflict`, nothing is written or committed, and the
  message says "The composition just changed. Look again." If the change
  lands after the first commit: "Your edits were committed; nothing else
  changed. Look again."
- The edit cannot be made cleanly (its self-check refuses, as the
  per-selection Accept does): nothing is committed, and the message says to
  do it one mark at a time.
- The first commit (the person's edits) fails: the action stops, nothing is
  resolved, and the message says the commit failed. The edits are on disk.
- The second commit fails after the write: the change is on disk and the
  message says "Done, but the Git commit failed", Save's wording family
  (`src/webapp/trpc/routers/card.ts:292`).
- A bulk action has nothing to do (no notes, say): its control is not shown.
- The text is malformed: the read view keeps its bar with Edit, withholds
  Copy, and says "A tag in this composition is broken; edit it to fix the
  tag." Today a null copy hides the whole bar, Edit included
  (`Composition.tsx:97-118`); malformed becomes its own state.
- The clipboard write fails: the existing "Copy failed" flash
  (`Composition.tsx:110`). The publishing copy is made inside the click, with
  no server call before it.

### Walkthrough

1. Priya finishes her piece and presses Done, then Copy. The piece has two
   agent "but"s, one gap, and one note she never opened.
2. The popover says "Before you publish: 2 things to resolve." Under it:
   - "1 gap: a sentence on cost. Write it, or remove the gap." [Go to it]
   - "1 note from the agent: 'Shorter?'" [Remove note] [Go to it]
   - Below a rule: [Copy draft with marks].
   Nothing mentions the two "but"s; they do not block.
3. She chooses Remove note. The box commits her pending edits (none), then
   removes the note and commits that (`Composition-Resolve: remove-notes`).
   The popover now lists only the gap.
4. She chooses Go to it. The editor opens with the gap selected. She types
   the sentence (the gap's ×, then her words), presses Done, then Copy. Copy
   copies at once; the "but"s go out as plain words and stay marked in the
   card.
5. Records left: the note-removal commit, her edits (autosaved; committed at
   her next Commit or the box's housekeeping).

## Smallest fix and budget

Smallest fix: `compositionPlainText` copies joiner and check words plain and
drops notes. About 30 changed lines with tests. It fixes `[but]` but lets a
gap's placeholder and an unread check go out, which the boxholder ruled out
("no published copy without resolving things").

| Track | Source | Tests |
|---|---|---|
| 1. Shared mark scanning (move `compose/scan.ts` to `src/shared/composition/marks.ts`) | 25 (imports; the move is a rename) | 5 |
| 2. Plain-text forms: `publish` and `draft`, and blockers | 70 | 70 |
| 3. Bulk resolve on the server (`card.resolveComposition`) | 100 | 90 |
| 4. Read view Copy and its resolve popover; open the editor at a mark | 150 | 20 |
| 5. Editor marks menu with bulk actions | 140 | 30 |

Total about 700 changed lines, source plus tests. Docs: about 40 lines in the
parent plan's As built and design. Not a BIG CHANGE.

## Stated preferences this plan trades against

- `docs/engineering-principles.md` §8, "One way to do each thing": every
  bulk action runs through one server procedure, from the read view and the
  editor. Cost: a bulk action is not on the editor's undo stack (remote
  changes skip history, `ComposeEditor.tsx:107`). Undo is the card history
  (revert the commit). The per-selection Accept and the widgets' × and ✓
  stay client-side and undoable.
- §13, "A control shows the state the system is in": the editor's count
  reads the editor's current scan; Copy reads the card body on disk, the
  text it copies.
- The parent design's guard against quiet adoption
  (`composition-editor.design.md:64-69`) is relaxed for the publishing copy
  and replaced by the guards in Spirit, by boxholder decision.

## What already exists

- `compositionPlainText` (`src/shared/composition/text.ts:150`): plain text
  for the clipboard, every `editorial` mark as `[content]`. Reuse; it gains
  a form.
- `scanMarks`, `wholeMarkRange`, `acceptChanges`
  (`src/frontend/src/components/MarkdownCardView/compose/scan.ts`): mark
  offsets, spacing on removal, and the accept edit with its self-check.
  Pure; they import only `@shared` modules. Move to
  `src/shared/composition/marks.ts` so the server can use them.
- `writeCompositionFile` (`src/core/composition-file.ts:45`): region write
  with a hash precondition and the closed-early check. Reuse.
- `writeComposition` (`src/webapp/trpc/routers/card.ts:275-307`):
  `withCardLock`, then `stageAndCommitPaths` with trailers
  `{"Source": "webapp", "Endpoint": "card.writeComposition",
  "Composition-Save": "person"}`. The new procedure follows its shape.
- `stageAndCommitPaths` (`src/lib/git/core/operations.ts:375`): returns
  `null` when nothing differs from HEAD ("if (changed.length === 0) return
  null;", line 384). So "commit the person's edits first" does nothing when
  there is nothing to commit.
- `CardContentsMenu`
  (`src/frontend/src/components/CardContents/CardContentsMenu.tsx`): a
  `Menu` of entries that jumps to each. Precedent for the marks list.
- `Popover` (`src/frontend/src/components/ui/Popover.tsx`): a non-modal
  panel anchored to its trigger. Use it for Copy's resolve list.
- `useComposeSession` (`Composition.tsx:57-81`): `startCompose()` opens the
  editor. It gains a target mark.
- `CompositionSync` (`compose/sync.ts`): `close()` writes unsaved text
  without a commit. The editor's bulk actions need the same flush without
  closing; add `flush()`.

## Prior art (external)

No external premise decides anything here. The publishing copy is written
inside the click with no await, so the async-clipboard limits of Safari
(<https://webkit.org/blog/10855/async-clipboard-api/>) do not apply.
Evaluated only. The bracket convention for the draft copy is already the
parent plan's.

## Ontology

- **Open mark**: an `editorial` mark in the region (joiner, check, gap,
  note). Existing (`EDITORIAL_KINDS`, `src/shared/composition/tags.ts`).
  `source` marks are citations, not open marks.
- **Agent words**: a joiner's words. The editor already titles them "agent's
  words" (`widgets.ts`). Never a blocker.
- **Blocker**: an open gap, note, or check. Each stops the publishing copy.
- **Publishing copy** (`form: "publish"`): agent words and `source` words
  plain; defined only when there are no blockers. New.
- **Draft copy** (`form: "draft"`): every open mark labelled `[agent: …]`,
  `[check: …]`, `[gap: …]`, `[note: …]`. New.
- **Resolve action**: `accept-joiners` (Accept all agent words),
  `keep-checks` (Keep all checked words), `remove-notes` (Remove all notes),
  or one mark: `keep-check` / `remove-note` with the mark's `index`.
  Committed alone with trailer `Composition-Resolve: <action>`. New trailer.
  Gaps have no resolve action: each needs words or a removal in the editor.
- **Mark index**: a mark's 0-based place among the open marks in text order.
  Normalization joins lines but never adds, drops, or reorders marks, so the
  read view (normalizing the disk text) and the editor (showing normalized
  text) count the same marks. The receiver checks the kind at that index and
  refuses on a mismatch.
- **Marks menu**: the editor bar's "N marked" button and its list. New UI;
  no stored state.

## Tracks / scope

### Track 1: shared mark scanning

- **What:** move `compose/scan.ts` to `src/shared/composition/marks.ts`;
  frontend imports follow. Add `resolveEdit(text, action): TextChange[] |
  "nothing" | "refused"`.
- **Why:** the server computes the bulk edits; the scanner is frontend-only
  now.
- **Direction:** `git mv`, fix imports, move its test to
  `test/shared/composition/marks.test.ts`. `accept-joiners` and
  `keep-checks` call `acceptChanges` over the whole text, restricted to
  one kind (`acceptChanges` gains a `kinds` option, default both).
  `remove-notes` deletes each note with `wholeMarkRange` spacing, then
  rescans and refuses a malformed result, as `acceptChanges` does.
- **Vocabulary lock-ins:** module path `@shared/composition/marks`; the
  three action names.
- **First chunk:** the move with no behaviour change; tests pass.

### Track 2: plain-text forms and blockers

- **What:** `src/shared/composition/copy.ts`: `publishingCopy(text)`
  returns `ready` with the text, `blocked` with each blocker's kind, words,
  check reason, and mark index, or `malformed`. `draftCopy(text)` returns the
  labelled text. `openMarks(text)` lists the open marks for both.
  `compositionPlainText` (`text.ts`) takes a `mark` function per tag; it
  cannot import `marks.ts` (which imports it), so the forms live in
  `copy.ts`.
- **Why:** `[but]` in a published paste; a gap or note pasted as text.
- **Direction:** publish removes joiner delimiters and keeps the words.
  Draft writes `[agent: `, `[check: `, `[gap: `, `[note: ` and `]`; a check's
  `note` attribute is appended as ` (why: …)`.
- **Vocabulary lock-ins:** the four draft labels.
- **First chunk:** both forms with tests: inline joiner, block joiner,
  blocked by gap / note / check, draft labels, and a fence with literal tag
  text left as written (existing test kept).

### Track 3: bulk resolve on the server

- **What:** `card.resolveComposition({ path, baseRegionHash, action })`.
- **Why:** one implementation for both surfaces, under the card lock, as two
  commits.
- **Direction:** inside `withCardLock`:
  1. `readCompositionFile`; if the hash differs, `{ status: "conflict" }`.
  2. `resolveEdit(text, action)`; `nothing` or `refused` returns that
     status. Then the same splice-and-refind check `writeCompositionFile`
     makes (factored into `checkCompositionWrite`), so a `problem` is found
     before any commit. Nothing committed.
  3. `stageAndCommitPaths` with Save's message and trailers (the person's
     pending edits). Failure: `{ status: "commit-failed" }`.
  4. `writeCompositionFile` with the edited text and the same hash. Any
     `conflict` (an agent wrote in between): `{ status: "conflict",
     committedEdits }`; `problem` (not reachable after step 2's check, kept
     distinct): `{ status: "problem", committedEdits }`.
  5. `stageAndCommitPaths` with message `<Action>: <path>` (e.g. "Remove
     notes") and trailers `{"Source": "webapp", "Endpoint":
     "card.resolveComposition", "Composition-Resolve": action}`. Failure:
     `commitWarning`.
  6. Emit `file-change`. Return `{ status: "resolved", regionHash, text,
     commits, commitWarning }`.
- **Vocabulary lock-ins:** procedure name; trailer `Composition-Resolve`.
- **First chunk:** `remove-notes` with tests in
  `test/webapp/trpc/routers/card.composition.test.ts` (the existing
  `makeTmpBox` plus router-caller pattern): two commits in order with their
  trailers, the conflict case, the nothing case, the refused case.

### Track 4: read view Copy and its resolve popover

- **What:** Copy runs the publishing form. No blockers: copies at once.
  Blockers: opens a `Popover` headed "Before you publish: N things to
  resolve", one row per blocker, then [Copy draft with marks].
- **Why:** the boxholder's decision point, with the way through spelled out.
- **Direction:** rows, in text order:
  - gap: "Gap: <words>. Write it, or remove the gap." [Go to it]
  - note: "Note from the agent: <words>" [Remove note] [Go to it]
  - check: "The agent asked about: <words> (<why>)" [Keep as written]
    [Go to it]
  - When two or more of a kind: a row-group action [Remove all notes] /
    [Keep all checked words].
  "Go to it" calls `startCompose({ at: { index, kind } })`; the editor opens
  with that mark selected and scrolled below the sticky bar, or with no
  selection when the kind at that index differs. "Remove note" and "Keep as
  written" call `resolveComposition` with the one-mark action, so a row has
  the same outcomes as a bulk action: `resolved` removes the row (the read
  view re-renders from the file change); `resolved` with `commitWarning`
  removes it and shows the warning; `conflict` or `problem` keeps the row and
  shows "The composition just changed. Look again." A "More copy options"
  menu button beside Copy holds "Copy draft with marks" in every state.
  The Copy button reads "Copy" always; with blockers it carries
  `aria-haspopup="dialog"`. No accept of agent words appears here.
- **First chunk:** Copy with the publishing form, the More menu with the
  draft copy, the malformed state, and the popover with gap rows and Go to
  it.

### Track 5: editor marks menu with bulk actions

- **What:** a `Menu` button "N marked" in the editor bar, hidden at 0. Items:
  each open mark in text order, kind and first 40 characters; choosing one
  selects it and scrolls it into view. Then, for kinds present: "Accept all
  agent words", "Keep all checked words", "Remove all notes".
- **Why:** finding one mark in a long piece; the bulk actions where the
  person edits.
- **Direction:** the list comes from `marksField` (`widgets.ts`) via an
  `onMarks(list)` callback, as `onAcceptable` does. A bulk action:
  Accept all agent words carries a warning in the menu item's description,
  "The agent's N passages will be marked as yours from now on. A new commit
  records it; earlier versions keep the marks.", and
  asks once in a confirm popover naming the count before it runs; the other
  two run on choice. Then `sync.flush()`, `resolveComposition` with the
  sync's hash; the editor
  takes the result through `remoteChanged()`. A conflict shows "The
  composition just changed. Look again." in the status. The bar's sticky
  layout and Contents room stay; at 390px the bar wraps as it does now.
- **First chunk:** the list and jump, no bulk actions.

## Could this be simpler?

The simplest version is the 30-line publish change alone. It fails "no
published copy without resolving things". Dropping the resolve rows and
showing only "3 marks open; edit to fix" fails "it should be clear ... how
they resolve this" for a person who does not know the mark kinds. Dropping
the marks list fails the long-piece case. A client-side bulk action in the
editor would be undoable with ⌘Z, but the read view would need a second
implementation (§8).

Track 4's one-mark actions reuse `writeComposition` instead of adding
per-mark actions to `resolveComposition`; one procedure per scope.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Agent edits the region between view and a bulk action | Track 3 test | `conflict`, nothing written | Clear: "Look again" |
| Agent writes between the first commit and the write | Track 3 test | `conflict` with `committedEdits` | Clear |
| The edit refuses (malformed result) | Track 3 test | `refused`, nothing committed | Clear |
| First commit fails | Track 3 test (forced failure) | stop before the edit | Clear |
| Second commit fails after the write | Track 3 test | `commitWarning` | Clear |
| A blocker counted wrongly, so Copy publishes a gap | Track 2 tests (each kind) | `blocked` result has no text | Silent if wrong; the tests catch it |
| Malformed marks in a well-formed region reach Copy | Track 4 check | `scanMarks` gate | Clear: no Copy, malformed message |
| Go to it lands on the wrong mark after the text changed | Track 5 test (hard-wrapped paragraph before the mark) | mark index plus kind check; mismatch selects nothing | Clear: the editor opens without a selection |
| A one-row action meets a conflict or a failed commit | Track 3 tests (same procedure) | row stays on conflict; warning on commit failure | Clear |
| Malformed marks hide Edit | Track 4 check | malformed is its own read-view state | Clear: message plus Edit |
| Editor has unflushed text at a bulk action | Track 5 sync test | `flush()` first | Clear on failure ("Not saved") |

No critical gap.

## Agent-flow / user-flow edge cases

- Wrong tag: an agent marks its own words as `check`: "Keep as written"
  then adopts them. ADDRESSED by the existing guidance; a check is for the
  person's words (parent plan, check definition).
- Stale ref: the region changed: ADDRESSED by `baseRegionHash`.
- Two agents on one card: the chat agent writes without the card lock (the
  parent plan's accepted risk); the hash check refuses a stale action.
  ADDRESSED.
- Hand-edit drift: a hand-typed unknown kind makes the text malformed; no
  Copy, no marks menu. ADDRESSED.
- Fabricated value, validation UX, partial migration: not applicable; no new
  stored data and no agent-facing input.

## NOT in scope

- An accept of agent words anywhere on the Copy surface: boxholder decision
  (whitewashing).
- A marks menu in the read view: Copy's popover lists the blockers; the full
  list belongs where the person edits.
- A bulk action for gaps: each gap needs words or a deliberate removal.
- A commit holding only the resolve change, separate from agent writes to
  the rest of the card in the same moment (see Open design questions).
- Undo of a bulk action in the editor: the commit history is the undo.

## Open design questions

- **How separate the resolve commit is.** Both commits run back to back
  under the card lock, but the chat agent writes without that lock (parent
  plan, accepted risk). An agent write to the card outside the region in the
  milliseconds between the commits would ride along in the second commit. The
  first commit has the parent plan's open question: it commits uncommitted
  agent edits outside the region under `Composition-Save: person`. Lean:
  accept both and say so in the commit body. An edit-only commit needs a
  commit built from HEAD's blob with only the region replaced: a new git
  path, for a window measured in milliseconds.

- **Markdown or plain text in the publishing copy.** The publishing copy
  keeps Markdown syntax (`**bold**`, `[link](url)`, `## Heading`); paragraphs
  are separated by one blank line. A target such as a social post wants the
  syntax removed. Boxholder (2026-11-16): "W/ and w/o markdown is another
  copy option... hrm". Not built in this plan; lean: a later "Copy as plain
  text" beside the publishing copy, rendering from the Markdoc tree.

## Knowledge audits

None: no agent-facing concept. The agent never runs Copy or a resolve
action. The trailer `Composition-Resolve` is for history readers; the parent
plan's guidance on marks is unchanged.

## What will hold this after it ships

- Track 1 and 2: unit tests on the pure functions (edits, forms, blockers).
- Track 3: router tests against a temp box git repo, beside the existing
  `card.writeComposition` tests, checking commit order and trailers.
- Tracks 4 and 5: one browser walk (desktop and 390px). No new test tier.

## Implementation order

1. Track 1 (move; then `resolveEdit`).
2. Track 2 (forms and blockers) as functions; Copy keeps today's output until
   Track 4, so the publishing copy ships with its resolve list.
3. Track 3 (server resolve).
4. Track 4 (Copy popover: gap rows and Go to it, then note and check rows).
5. Track 5 (marks menu, then bulk actions).
6. Parent plan As built and design notes; exhibit.

## Rollout shape

Tests first per track as listed. Done when the Track 1–3 tests pass and the
browser walk shows: Copy at once with only agent words open; the popover
with a gap, a note, and a check, each resolved by its row; Go to it
selecting the mark; Accept all agent words from the marks menu leaving two
commits (`git log -2` on the test box card). No migration: no stored shape
changes.
