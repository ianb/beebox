---
title: "Composition: copy for publishing, a marks list, and Accept all"
status: draft
workstream: composition-editor
issues: []
---
# Composition: copy for publishing, a marks list, and Accept all

A composition's Copy button wraps every open mark in `[ ]`. A short joiner
the person read and kept ("but") pastes as `[but]`, and a note pastes as
text. This plan makes Copy produce publishable text, and stops at a decision
when marks are still open. It adds a list of the open marks to the editor, and
an Accept all that commits the person's work first and then commits the
acceptance on its own.

**Issues addressed:** none filed. The request came from the boxholder in the
composition-editor session (2026-11-16). Searched `issues/` for
"composition", "joiner", "copy": the only related item,
`issues/features/2026-10-08-drafted-message-has-no-copy-control.md`, is the
one the parent plan already addressed; nothing here changes it.

Parent: [composition editor](../implemented-plans/composition-editor.md) and
its [design](../implemented-plans/composition-editor.design.md).

## Design

### Situations

- When Priya has read her piece and kept two of the agent's joining words
  as they were, I want Copy to give clean text, so I can paste it into the
  post without hunting for brackets.
- When Priya presses Copy and the piece still has open marks, I want to be
  asked once what to do with them, so I can decide while I can still see
  them, not after the paste.
- When Priya wants another chat or a friend to look at the draft, I want a
  copy that says which words are the agent's and where the holes are, so the
  reader can see the state of the draft.
- When a long piece has one mark left somewhere, I want a count and a list I
  can jump through, so I do not have to read 4,000 words to find it.
- When Priya decides the agent's words are now hers, I want one action that
  accepts them all, so I do not have to do it one mark at a time; and I want
  that recorded apart from my own writing.
- Quiet case: when the piece has no open marks, Copy copies at once, with no
  question and no menu, and the marks button is not shown.

### Right place, right time

| Situation | Act, show, or quiet | Surface | Attention |
|---|---|---|---|
| Copy, no open marks | Act | Copy on the composition block (read view) | None: copies at once |
| Copy, open marks | Show a decision | A popover under Copy | Waits for the person; the copy is not made until they choose |
| Draft copy for another reader | Act on request | An option in the same popover | Waits to be found |
| Find the open marks | Show | "N marked" button in the editor bar, a list menu | Waits to be found; the count is always visible while editing |
| Accept all | Act on request | Last item in the marks menu; also in the Copy popover | Waits to be found |

The decision comes at Copy because Copy is where the text leaves the box.
Asking earlier (at Done, at Commit) interrupts writing; asking after the paste
is too late.

### Spirit

- **Serves:** "People aren't broken versions of their better selves." Reading
  the piece and finding it fine is a decision; the person does not owe the
  box one click per joining word.
- **Serves:** "You should be able to see the gears." The count shows how many
  marks are open, the list shows where, and Accept all leaves its own commit.
- **Risks:** "The best stuff comes from the people", through quiet adoption:
  a publishing copy gives the agent's words as plain text. Guard: the copy is
  not made until the person has seen the decision, which names how many
  passages are the agent's. Inside the box the words stay marked until the
  person accepts them. The boxholder accepted this trade on 2026-11-16 ("if
  one phrase has those []'s around them in a big document, it's easy not to
  realize and the result looks weird").

### Trust

- Copy with no open marks: automatic.
- Copy with open marks: a question every time (the popover). No answer is
  remembered; the marks differ each time.
- Accept all: confirmation by the act itself (a menu item the person
  chooses, or a button in the Copy question). It accepts only the text the
  person saw: the server refuses when the region changed since the person's
  view (`baseRegionHash`), so a joiner the agent added a second ago is not
  accepted unseen.

### When it goes wrong or does nothing

- The agent changes the text between the popover opening and Accept all: the
  server answers `conflict`, nothing is written or committed, and the popover
  says "The composition just changed. Look again." The read view refreshes on
  the file change. If the change lands after the first commit, the message
  says "Your edits were committed; nothing was accepted. Look again."
- The accept edit cannot be made cleanly (its self-check refuses, as the
  per-selection Accept does): nothing is committed, and the message says
  "Accept all could not separate these marks; accept them one at a time."
- The first commit (the person's edits) fails: Accept all stops, nothing is
  accepted, and the message says the commit failed. The edits are on disk.
- The accept commit fails after the write: the text is accepted on disk and
  the message says "Accepted, but the Git commit failed", the same wording
  family as Save's `commitWarning` (`src/webapp/trpc/routers/card.ts:292`).
- The clipboard write is refused (Safari after an async step): the button
  flashes "Copy failed", the existing flash (`Composition.tsx:110`). Track 3
  avoids this case by passing a promise to the clipboard (see Prior art).
- Only gaps and notes are open: Accept all is disabled with the reason
  "Gaps and notes stay until you fill or remove them".
- The text is malformed: no marks button and no Accept all; the existing
  malformed message stands. Copy is not shown: the read view checks
  `scanMarks(...).malformed` as well as `findComposition` (today it checks
  only the region, `Composition.tsx:97-100`).

### Walkthrough

1. Priya finishes her piece. The editor bar reads "2 marked". She opens the
   menu: two lines, `joiner "but"` and `joiner "but the street…"`, then
   "Accept all joining words and checks". She chooses the first line; the
   editor scrolls to it and selects the word. It is fine.
2. She presses Done and then Copy on the composition block. The popover says:
   "2 passages are the agent's words." Options: **Accept all and copy**,
   **Copy as plain text**, **Copy draft with marks**.
3. She chooses Accept all and copy. The box commits her uncommitted edits
   (`Composition-Save: person`), then writes the text without the two joiner
   marks and commits that (`Composition-Accept: all`). The clipboard gets the
   clean text. The button flashes "Copied".
4. Records left: two commits on the card; the card text with no joiner marks.

## Smallest fix and budget

Smallest fix: `compositionPlainText` copies joiner and check words plain and
drops notes. About 30 changed lines with tests. It fixes `[but]` but removes
the moment where the person sees that agent words are going out, and gives no
way to find or accept marks in a long piece.

Chosen: four tracks.

| Track | Source | Tests |
|---|---|---|
| 1. Shared mark scanning (move `compose/scan.ts` to `src/shared/composition/marks.ts`) | 20 (imports; the move itself is a rename) | 5 |
| 2. Plain-text modes: `publish` and `draft` | 70 | 70 |
| 3. Accept all on the server (`card.acceptAllComposition`) | 90 | 90 |
| 4. Read view Copy decision popover | 130 | 20 |
| 5. Editor marks menu with Accept all | 130 | 30 |

Total about 655 changed lines, source plus tests. Docs: about 40 lines in the
parent plan's As built and design. Not a BIG CHANGE.

## Stated preferences this plan trades against

- `docs/engineering-principles.md` §8, "One way to do each thing": Accept all
  runs on the server for both the read view and the editor. The editor does
  not get a second, client-side Accept all. Cost: Accept all is not on the
  editor's undo stack (remote changes skip history,
  `Transaction.addToHistory`). Undo is the card history (revert the
  `Composition-Accept: all` commit). The per-selection Accept stays
  client-side and undoable.
- §13, "A control shows the state the system is in": the marks count reads
  the editor's current scan, so it changes with each keystroke; Copy's
  decision reads the card body as on disk, the text Copy copies.
- The parent design's guard against quiet adoption
  (`composition-editor.design.md:64-69`) is relaxed for the publishing copy,
  by boxholder decision (quoted in Spirit).

## What already exists

- `compositionPlainText` (`src/shared/composition/text.ts:150`): plain text
  for the clipboard, every `editorial` mark as `[content]`. Reuse; it gains a
  mode.
- `scanMarks`, `wholeMarkRange`, `acceptChanges`
  (`src/frontend/src/components/MarkdownCardView/compose/scan.ts`): mark
  offsets and the accept edit. Pure; they import only `@shared` modules.
  Move to `src/shared/composition/marks.ts` so the server can use them.
- `writeCompositionFile` (`src/core/composition-file.ts:45`): region write
  with a hash precondition and the closed-early check. Reuse for the accept
  write.
- `writeComposition` (`src/webapp/trpc/routers/card.ts:275-307`):
  `withCardLock`, then `stageAndCommitPaths` with trailers
  `{"Source": "webapp", "Endpoint": "card.writeComposition",
  "Composition-Save": "person"}`. The new procedure follows its shape.
- `stageAndCommitPaths` (`src/lib/git/core/operations.ts:375`): returns
  `null` when nothing differs from HEAD ("if (changed.length === 0) return
  null;", line 384). So "commit the person's edits first" is a call that does
  nothing when there is nothing to commit.
- `CardContentsMenu` (`src/frontend/src/components/CardContents/CardContentsMenu.tsx`):
  a `Menu` of entries that jumps to each. Precedent for the marks list.
- `Popover` (`src/frontend/src/components/ui/Popover.tsx`): a non-modal
  panel anchored to its trigger. Use it for the Copy decision.
- `CompositionSync` (`compose/sync.ts`): `close()` writes unsaved text
  without a commit. Accept all in the editor needs the same flush without
  closing; add `flush()`.

## Prior art (external)

- Safari requires the clipboard write inside the user gesture; it accepts a
  `ClipboardItem` whose value is a promise, resolved after async work:
  <https://webkit.org/blog/10855/async-clipboard-api/>. Evaluated; adopted
  for "Accept all and copy", which copies after a server call. Unverified in
  this repo's browsers; Track 4 checks it on the phone.
- Oral-history bracket convention: already adopted by the parent plan; the
  draft copy keeps brackets and adds a label.

## Ontology

- **Open mark**: an `editorial` mark in the region (joiner, check, gap,
  note). Existing (`EDITORIAL_KINDS`, `src/shared/composition/tags.ts`).
  `source` marks are citations, not open marks.
- **Acceptable mark**: joiner or check. Existing name `ACCEPTABLE`
  (`compose/scan.ts`).
- **Publishing copy** (`mode: "publish"`): joiner and check words plain,
  `source` words plain, notes left out, gaps as `[content]`. New.
- **Draft copy** (`mode: "draft"`): every open mark labelled:
  `[agent: …]`, `[check: …]`, `[gap: …]`, `[note: …]`. New. "agent" is the
  word the editor's joiner title already uses ("agent's words").
- **Accept all**: the accept edit over the whole region, committed alone with
  trailer `Composition-Accept: all`. New trailer.
- **Marks menu**: the editor bar's "N marked" button and its list. New UI;
  no stored state.

## Tracks / scope

### Track 1: shared mark scanning

- **What:** move `compose/scan.ts` to `src/shared/composition/marks.ts`;
  frontend imports follow. Add `acceptAll(text): TextChange[]`, the accept
  edit over the whole text.
- **Why:** the server computes Accept all; the scanner is frontend-only now.
- **Direction:** `git mv`, fix imports, and move its test to
  `test/shared/composition/marks.test.ts`.
  `acceptAll(text) = acceptChanges(text, { marks: scanMarks(text).marks, selection: { from: 0, to: text.length } })`.
- **Vocabulary lock-ins:** module path `@shared/composition/marks`.
- **First chunk:** the move with no behaviour change; tests pass.

### Track 2: plain-text modes

- **What:** `compositionPlainText(text, { mode })` with `"publish" | "draft"`,
  returning `{ text, open: { joiner, check, gap, note } }` (counts) in place
  of `openMarks`.
- **Why:** `[but]` in a published paste; notes pasted as text.
- **Direction:** per kind in `replacementFor`: publish removes joiner/check
  delimiters, removes a note with its words (spacing as `wholeMarkRange`),
  and keeps gaps as `[content]`. Draft writes `[agent: `, `[check: `,
  `[gap: `, `[note: ` and `]`. A check's `note` attribute is appended in the
  draft as ` (why: …)`.
- **Vocabulary lock-ins:** the four draft labels.
- **First chunk:** publish mode with tests for: inline joiner, block joiner,
  note between sentences (one space left), gap, check, and a fence with
  literal tag text left as written (existing test kept).

### Track 3: Accept all on the server

- **What:** `card.acceptAllComposition({ path, baseRegionHash })`.
- **Why:** one Accept all for both surfaces, done under the card lock as two
  commits.
- **Direction:** inside `withCardLock`:
  1. `readCompositionFile`; if the hash differs from `baseRegionHash`,
     return `{ status: "conflict" }`. Nothing written.
  2. Compute and validate the accept edit before any commit. No joiner or
     check marks: `{ status: "nothing" }`. Marks present but `acceptChanges`
     refused (its self-check failed): `{ status: "refused" }`. Neither case
     commits anything.
  3. `stageAndCommitPaths` with Save's message and trailers (the person's
     edits). On failure, return `{ status: "commit-failed" }`. Nothing
     accepted.
  4. `writeCompositionFile` with the accepted text and the same hash. Any
     result other than `written` (an agent wrote in between) returns
     `{ status: "conflict", committedEdits: <commit or null> }`, and the
     message says the edits were committed and nothing was accepted.
  5. `stageAndCommitPaths` with message `Accept agent words: <path>` and
     trailers `{"Source": "webapp", "Endpoint": "card.acceptAllComposition",
     "Composition-Accept": "all"}`. On failure, `commitWarning`.
  6. Emit `file-change`. Return `{ status: "accepted", regionHash, text,
     commits, commitWarning }`.
- **Vocabulary lock-ins:** trailer `Composition-Accept: all`; procedure name.
- **First chunk:** the procedure with tests in
  `test/webapp/trpc/routers/card.composition.test.ts` (the existing
  `makeTmpBox` plus router-caller pattern): the two commits in order with
  their trailers, the conflict case, the nothing case.

### Track 4: read view Copy decision

- **What:** Copy with no open marks copies the publishing copy at once. With
  open marks it opens a `Popover`: a line per kind present, then buttons
  **Accept all and copy** (only when joiners or checks are open), **Copy as
  plain text**, **Copy draft with marks**.
- **Why:** the decision at the moment the text leaves the box.
- **Direction:** lines: "N passages are the agent's words." "N checks."
  "N notes are left out." "N gaps copy as [placeholder]." Accept all and copy:
  `navigator.clipboard.write([new ClipboardItem({ "text/plain": promise })])`
  is called first, inside the click, before any await; Safari needs the
  write call itself in the gesture and accepts deferred contents. The promise
  runs `readComposition` for the hash, compares its text with the region on
  screen, calls `acceptAllComposition`, and resolves to
  `compositionPlainText(result.text, publish)` as a Blob. When the accept
  fails, the promise rejects (no copy) and the popover shows the accept
  message; when the accept succeeds and the clipboard fails, it says
  "Accepted, but the copy failed. Copy again." The Copy button's label drops
  "(N open marks)" for "Copy" plus `aria-haspopup="dialog"` when marks are
  open.
- **First chunk:** the popover with the two copy options (no Accept all), and
  its ui-scan ids.

### Track 5: editor marks menu with Accept all

- **What:** a `Menu` button "N marked" in the editor bar, hidden at 0. Items:
  each open mark, in text order, as its kind and the first 40 characters of
  its words; choosing one selects the words (gap, note: places the cursor
  after the widget) and scrolls it into view. Last item: "Accept all joining
  words and checks", disabled with the reason text when none are open.
- **Why:** finding one mark in a long piece; Accept all where the person
  edits.
- **Direction:** the count and list come from `marksField` (`widgets.ts`) via
  the same `onAcceptable`-style callback, `onMarks(list)`. Accept all:
  `sync.flush()`, then `acceptAllComposition` with `sync`'s current hash; the
  editor takes the result through the existing `remoteChanged()` merge. A
  conflict shows "The composition just changed. Look again." in the status.
  The bar's sticky layout and the `pr-12` Contents room
  (`ComposeEditor.tsx`) stay; at 390px the bar wraps as it does now.
- **First chunk:** the menu list and jump, no Accept all.

## Could this be simpler?

The simplest version is the 30-line publish-mode change alone. It fails the
boxholder's second ask: a decision point when marks are open ("if there are
open marks then it actually leads to a decision point"), and the request for
"an 'accept all' that kind of finalizes everything, and commits". Dropping
the marks list fails the long-piece case the boxholder named. A client-side
Accept all in the editor would be undoable with ⌘Z, but the read view would
need a second implementation (§8); the server one serves both.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Agent edits the region between view and Accept all | Track 3 test | `conflict`, nothing written | Clear: "Look again" |
| First commit fails | Track 3 test (forced failure) | stop before accepting | Clear |
| Accept commit fails after the write | Track 3 test | `commitWarning` | Clear |
| Safari refuses the clipboard after the server call | Phone check, Track 4 | `clipboard.write` called in the gesture with a promised item; accept and copy results reported apart | Clear |
| Marks present but the accept edit refuses | Track 3 test (code-span case from `scan.test.ts`) | `refused`, nothing committed | Clear |
| Agent writes between the first commit and the accept write | Track 3 test (write between steps) | `conflict` with `committedEdits` | Clear |
| Malformed marks in a well-formed region reach Copy | Track 4 check | `scanMarks` gate | Clear: no Copy, malformed message |
| Note removal leaves double spaces or a blank paragraph | Track 2 tests | `wholeMarkRange` spacing | Silent if wrong; the tests catch it |
| Editor has unflushed text at Accept all | Track 5 sync test | `flush()` first | Clear on failure ("Not saved") |
| Accept all merges back into an editor with newer keystrokes | existing merge tests (`sync.test.ts`) | `absorb` three-way merge | Clear: conflicts shown |

No critical gap.

## Agent-flow / user-flow edge cases

- Wrong tag: an agent marks its own words as `check`: Accept all accepts
  them as the person's. ADDRESSED by the existing guidance; a check is meant
  for the person's words (parent plan, check definition).
- Stale ref: the region changed: ADDRESSED by `baseRegionHash` (Track 3).
- Two agents on one card: the chat agent writes without the card lock (the
  parent plan's accepted risk, `composition-editor.md`); the hash check still
  refuses a stale accept. ADDRESSED.
- Hand-edit drift: a hand-typed unknown kind makes the text malformed; no
  Copy, no marks menu. ADDRESSED by existing behaviour.
- Fabricated value, validation UX, partial migration: not applicable; no new
  stored data and no agent-facing input.

## NOT in scope

- A marks menu in the read view: the Copy popover covers the read view's
  moment; the list belongs where the person can act on a mark.
- Blocking Copy on open gaps: the boxholder said "block publishing! (Or warn
  with confirmation.)"; the popover is that confirmation. Revisit if a gap
  gets published by mistake.
- Remembering the person's Copy choice: marks differ each time.
- Accept all for notes or gaps: a note is a comment and a gap is a hole;
  neither is the agent's words to adopt.
- Undo of Accept all in the editor: the commit history is the undo (§8 trade).

## Open design questions

- **Gaps in a publishing copy (boxholder).** Block or confirm? Lean: block.
  With a gap open, the popover offers no publishing copy; it names the gaps,
  jumps to them in the editor, and offers the draft copy. A gap is a hole in
  the text, and a confirmed `[placeholder]` is the bracket-in-a-long-document
  problem this plan exists to fix. The alternative names the option "Copy
  with N placeholders" and copies them bracketed.
- **How separate the accept commit is (boxholder).** Both commits run back
  to back under the card lock, but the chat agent writes without that lock
  (parent plan, accepted risk). An agent write to the card outside the region
  in the milliseconds between the two commits would ride along in the accept
  commit. The first commit has the parent plan's open question: it commits
  any uncommitted agent edits outside the region under `Composition-Save:
  person`. Lean: accept both and say so in the commit message's body. An
  accept-only commit needs a commit built from HEAD's blob with only the
  region replaced: a new git path, for a window measured in milliseconds.

- Should Accept all also offer to remove notes ("Finalize")? Lean no: notes
  are left out of the publishing copy anyway, and removing them loses
  comments the person may not have read.

## Knowledge audits

None: no agent-facing concept. The agent never runs Accept all or Copy. The
trailer `Composition-Accept: all` is for history readers; the parent plan's
guidance on marks is unchanged.

## What will hold this after it ships

- Track 2's plain-text modes: unit tests on the pure function.
- Track 3: router tests against a temp box git repo, beside the existing
  `card.writeComposition` tests, checking commit order and trailers.
- Tracks 4 and 5: the browser walk once (desktop and 390px, plus the phone
  for the clipboard). No new test tier.

## Implementation order

1. Track 1 (move; no behaviour change).
2. Track 2 (publish and draft modes) as functions only; Copy keeps today's
   output until Track 4, so the decision point ships with the publishing
   copy.
3. Track 3 (server Accept all).
4. Track 4 (Copy popover, then Accept all and copy).
5. Track 5 (marks menu, then Accept all in the editor).
6. Parent plan As built and design notes; exhibit.

## Rollout shape

Tests first per track as listed. Done when: Track 2 and Track 3 tests pass;
the browser walk shows the popover, the marks menu jump, and Accept all
leaving two commits (`git log -2` on the test box card); the clipboard works
on the phone after Accept all and copy. No migration: no stored shape
changes.
