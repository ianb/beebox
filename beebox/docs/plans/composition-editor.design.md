---
title: "Composition editor: design"
status: draft
workstream: composition-editor
issues: []
---
# Composition editor: design

**Parent plan:** [composition-editor.md](composition-editor.md)

## Situations

- When Priya has talked a newsletter piece through in two voice memos, and the
  agent has arranged her sentences into a draft with two gaps and one joining
  sentence it wrote, and she sits down at her laptop with twenty minutes, I want
  to fill the gaps and fix sentences by typing in the draft itself, so I can
  make the piece mine without dictating each change in chat.
- When Priya asked the agent in chat to apply the notes she spoke on her drive,
  and she is rewriting the opening paragraph while it works, I want its changes
  to the later paragraphs to appear without moving my cursor or losing my
  typing, so I can keep writing.
- When the agent is unsure what the transcript said ("in this new world, I
  ran"), I want to confirm or correct that one phrase in place, so I can clear
  the doubt in a second.
- When the piece reads the way Priya wants, I want to copy only the piece,
  without the notes and sources around it, so I can paste it into the post or
  email it is for.
- When Priya reaches a version she likes, I want to save it as a point in the
  card's history, so I can go back to it after more rounds.
- When a doc card holds ordinary notes, a plan, or a reference page, I want no
  compose control and no new marks, so I can read it as before. (The person
  does not want this feature here.)
- When Priya asks the agent to "just write me a two-line reply", I want the
  agent to do it, so I can send it. (Instructions override the guidance; the
  editor does not enforce authorship.)

## Right place, right time

| Situation | Act, show, or quiet | Surface and card | Attention |
|---|---|---|---|
| Sitting down to work on a draft | Show | The doc card's view: the composition block has a Compose button | Waits to be found |
| Agent edits while she types | Act (merge) and show | The open editor; changed text arrives in place | Background |
| Transcript doubt | Show | Inline mark in the composition, in the read view and the editor | Waits to be found |
| Copy the finished piece | Show | Copy button on the composition block | Waits to be found |
| Save a version | Act on request | Save button in the editor; a commit with trailers | Waits to be found |
| Ordinary doc card | Quiet | No composition tag, so nothing new renders | None |
| Instruction to compose | Act | Chat; the agent writes into the card as asked | None |

The moment is the person's choice to open the editor. The box never opens it,
never prompts to finish a draft, and never counts open marks in a
notification. Marks are visible in the plain read view too, so a person who
only reads on the phone still sees what is unresolved.

## Spirit

- **Serves:** "The best stuff comes from the people" — inside a composition the
  default is the person's words; the agent's words carry a visible mark.
- **Serves:** "It should feel possible" — the agent's arrangement is a start
  the person finishes with their own hands, not a draft to approve.
- **Risks:** "You should be able to see the gears" — autosaved edits sit on
  disk without a commit, and a later agent commit can carry them. Guard: the
  person's Save writes a commit with trailers that name it as the person's
  editor save, and the editor shows whether its text is saved to disk.
- **Risks:** "The best stuff comes from the people", through quiet adoption —
  a joining sentence the person never replaces reads as theirs once copied.
  Guard: a joining mark has no accept action; it leaves only when the person
  replaces or deletes it, and a copy keeps open marks visible in brackets.

## Trust

- **Agent edits to the composition** stay at the conversation rung of
  [trust.md](../design/trust.md): the agent changes the composition on
  instruction, as the writing practice says ("the document changes only on
  instruction"). The guidance states this; the editor does not enforce it.
  An instruction moves it; nothing records standing trust to compose.
- **Formatting** (paragraph breaks, lists, order of the person's sentences)
  is automatic and unmarked. It keeps the person's words, so it keeps their
  authorship.
- **Marks** are placed by the agent and resolved only by the person: accept (a
  transcript check), dismiss (a note), or replace by typing (a gap or a joining
  sentence). No mark resolves automatically. Implicit resolution on edit is
  deferred until real use shows which marks it suits.
- **Merging agent changes** into the open editor is automatic. It changes only
  what the agent changed on disk, which the agent already did; the merge only
  shows it.
- **Save (commit)** is automatic on the button; there is no confirm step,
  because a commit loses nothing.

## When it goes wrong or does nothing

- **The agent writes a malformed tag.** The editor shows the raw text with a
  warning style; the card's validation error names the line. Nothing is hidden.
- **The agent and the person change the same paragraph.** The editor keeps the
  person's text and shows the agent's version of that span in place, marked
  "agent's version, not merged", with "Use this" and "Dismiss". It is shown in
  the editor only, not written into the card; the agent's commit keeps its
  version in history.
- **A disk write fails** (network, server error). The save state reads "Not
  saved" with the error and retries. The text stays in the editor's memory
  only; closing the tab then shows a leave-page warning, and past it the
  unsaved text is lost.
- **The card has no composition.** No Compose button. The person or the agent
  adds one by asking in chat ("make the draft a composition").
- **The card has two compositions.** `bbx validate` warns on the card (body
  Markdoc findings are warnings, so commits still pass); the read view renders
  both blocks and offers no Compose button on either.
- **Nothing to do.** A composition with no marks shows no count and no prompt.

## Walkthrough

1. Priya opens `Newsletter_Draft.doc.card` from chat. The card view renders the
   agent's preface, then the composition as a framed block, then the
   revision notes. Inside the block, a gap reads as a tinted "gap: connect the
   two halves" chip, and one sentence carries a dotted underline: the agent
   wrote it.
2. She presses Compose. The block becomes an editor over the same text. The
   chips stay chips; the cursor steps over each one as one unit.
3. She types her bridging sentence after the gap chip, then presses the chip's
   × to remove it. The editor writes the card to disk a moment later. The save
   state reads "Saved to disk".
4. In chat she says "apply the economics note from my drive". The agent edits
   the last paragraph on disk. Within two seconds the paragraph changes in her
   editor; her cursor in the first paragraph does not move. Undo still undoes
   only her own typing.
5. She deletes the agent's joining sentence and writes her own. The underline
   is gone with the text.
6. She presses Save. The box writes what is on screen and commits the card
   with trailers naming her editor save. The save state reads "Saved".
7. She presses Copy on the composition block and pastes into the post.
   One transcript check is still open, so the pasted text contains it in
   brackets, and she fixes it there or goes back.

Records left behind: the card file; the agent's commits; her Save commit with
its trailers; no other file.
