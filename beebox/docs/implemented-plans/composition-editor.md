---
title: "Composition editor"
status: implemented
workstream: composition-editor
issues:
  - ../../../issues/features/2026-07-05-writing-skill.md
  - ../../../issues/features/2026-10-08-drafted-message-has-no-copy-control.md
---
# Composition editor

A doc card can mark one region of its body as a composition: the piece of
writing the person is making, as opposed to the notes, sources, and agent
commentary around it. The doc card view offers a Compose mode that edits that
region in CodeMirror 6, autosaves it to disk without a commit, merges the
agent's concurrent edits, and commits on the person's Save.

**Issues addressed:**
- [writing practice](../../../issues/features/2026-07-05-writing-skill.md):
  this plan builds the editing surface and the marks for agent-placed text.
  It does not ship the full writing practice (collection, elicitation, outline
  mode); that issue stays open with this plan linked.
- [drafted message has no copy control](../../../issues/features/2026-10-08-drafted-message-has-no-copy-control.md):
  partly. A composition gets a Copy button. Drafts written as blockquotes in
  chat stay uncovered, so the issue stays open.
- Related, not addressed:
  [suggested edits as tracked changes](../../../issues/features/2026-10-13-suggested-edits-tracked-changes.md)
  (a later layer over the same editor; it chose attachments over inline
  markup, see *NOT in scope*);
  [reader-context sidecar tag](../../../issues/exploration/2026-09-30-reader-context-writing-and-structured-thinking-tag.md)
  (another hidden-annotation tag; no shared code now).
- Searched the queue for "editor", "composition", "boneyard": no other match.

## As built (2026-10-27)

All five tracks shipped. The text below is the plan as written; where it
disagrees with this section, this section is right.

**Where things are:**
- Tags: `src/shared/composition/tags.ts` (not `markdoc-config/tags/composition.ts`).
- Region finder, text export, merge: `src/shared/composition/{region,text,merge}.ts`.
- Cardinality lint: inside `lintBodyMarkdoc` (`src/core/body-markdoc-lint.ts`), not `lint-cards.ts`.
- Read view: `src/frontend/src/components/MarkdownCardView/{Composition.tsx,type-markdown.ts}`.
- Editor: `src/frontend/src/components/MarkdownCardView/compose/`.
- Server: `src/core/composition-file.ts` and `card.readComposition` / `card.writeComposition` in `src/webapp/trpc/routers/card.ts`.

**Differences from the plan:**
- `writeComposition` returns a discriminated result, `{status: "written", ..., commitWarning}` or `{status: "conflict", text, regionHash}`, instead of a tRPC `CONFLICT` error. Text that would break the region is refused with `PRECONDITION_FAILED`.
- The merge re-merges word-level conflicts character by character, which avoids false conflicts.
- `CardBody` owns the compose session and the editor DOM attaches through a portal, so the editor survives a re-render of the card body (found in review).
- The knowledge audits ran as `knows_about` (the instructions live in `card-doc.md`, not the always-on guide); both passed.
- Size was about 2,630 changed lines (about 1,700 source, 900 tests) against an estimate of 1,950.

**Not verified:** no phone pass (implementation order step 6), no dark-mode
check. The failure toast after navigation and the fallback for a composition
removed while composing are covered by unit tests only, not in a browser.

**Open question:** Save commits the whole card, so uncommitted agent edits
outside the region are committed with it under the `Composition-Save: person`
trailer. Today the trailer describes the button press, not the content. The
boxholder decides whether Save should commit only the region.

## Design

See [composition-editor.design.md](composition-editor.design.md).

Decisions the boxholder made in discussion (2026-10-27), which this plan
builds on:

- The region is a Markdoc block tag, `{% composition %}`, understood by doc
  cards only. One composition per card. No destination attribute yet.
- Inside a composition, text is the person's by default. The agent's words
  (joining text, gaps, comments, questions) carry a mark. The base guidance
  tells the agent not to compose; an instruction from the person overrides
  that.
- Marks are inline markup in the card, not attachments, because the agent
  writes inline markup reliably.
- Marks resolve explicitly. Implicit resolution on edit comes later.
- The agent co-edits live; one to two seconds of delay is acceptable.
- Edits go to disk without a commit and autosave. The person's Save commits.
  Commits are checkpoints, labeled with trailers; any commit may carry the
  person's autosaved edits.
- Undo covers whatever is easiest in the editor component; in-memory history
  is enough.
- The output is the clean composition block, with an easy copy.
- CodeMirror 6, editing source text, with tags shown as widgets. Chosen over
  ProseMirror to avoid a Markdoc parser/serializer and to limit scope.
- Formatting does not change authorship. The agent may add paragraph breaks,
  make lists, and rearrange layout without a mark.
- Whitespace normalization is acceptable when it is a semantic no-op. The
  editor unwraps hard-wrapped paragraphs when it reads the composition.
- The rare silent loss of an agent edit (see *Failure modes*) is accepted.
- The size estimate is accepted. The tag name `editorial` stays. No device
  spike before building; CodeMirror is widely used on touch devices.

## Smallest fix and budget

**Smallest fix:** the `composition` and `editorial` tags, their read-view
rendering, a Copy button, and agent guidance. The person edits through chat
or by hand in the source. About 450 changed lines. It fails the first
situation in the design (typing in the draft), which is the reason for the
work.

**Chosen design**, estimated changed lines (additions plus deletions):

| Track | Source | Tests |
|---|---|---|
| 1. Tags, region finder, normalization, plain-text export (shared, pure) | 220 | 190 |
| 2. Doc schema wiring and agent guidance | 70 | 20 |
| 3. Read view: composition block, marks, Copy | 200 | 80 |
| 4. Server: read and write composition | 170 | 160 |
| 5. Editor: CodeMirror, widgets, autosave, merge | 600 | 220 |
| Knowledge audit entry | 20 | — |
| **Total** | **≈1,280** | **≈670** |

**≈1,950 lines.** This is near the 2,000-line BIG CHANGE line; the boxholder
expects this size (2026-10-27), so crossing it does not stop the work. I
report the revised estimate if Track 5 grows past 800 source lines. Authored docs outside this plan: the doc schema
instructions (counted in Track 2). No generated output beyond the regenerated
`box-docs/card-doc.md`.

New dependencies: `@codemirror/state`, `@codemirror/view`,
`@codemirror/commands` (MIT, ≈91 KB gzipped together, measured with esbuild
on a minimal editor), and `node-diff3` (MIT) for the three-way merge. The
editor is lazy-loaded, so readers who never press Compose do not download it.

## Stated preferences this plan trades against

- **Engineering principle 4, "Resilient AND never silent".** Autosave
  failure, merge conflicts, and malformed tags each have a visible state; none
  degrades silently. See *Failure modes*.
- **Engineering principle 13, "A control shows the state the system is in".**
  The editor's save state shows "Saving…", "Saved to disk", "Not saved: …",
  and "Saved" (committed) from the actual write and commit results, not from
  the intent.
- **Engineering principle 10, testability.** The risky decisions (region
  finding, splice, merge-to-changes, conflict-to-note, plain-text export) are
  pure functions in `src/shared/` with `t.check` tests. The CodeMirror wiring
  stays thin.
- **Memory: minimize invented concepts.** Two new tags (`composition`,
  `editorial`), not one tag per mark kind. Secondhand text reuses the existing
  `{% source %}`. Commit labeling reuses trailers. No new card type.
- **Memory: bias toward strict; stop over-engineering rare failures.** The
  lock-free race between the agent's Edit tool and the server's write is
  accepted by the boxholder (see *Failure modes*). Whitespace is normalized
  instead of preserved byte for byte.
- **Shipped precedent: `card.setTheme`** (`src/webapp/trpc/routers/card.ts:181-240`):
  lock, read, splice, `writeFileAtomic`, then emit `file-change`. The write
  mutation copies this shape, minus the commit.
- **Shipped precedent: stable card body** (`docs/implemented-plans/stable-card-body.md`):
  Markdown component maps are module constants. The new components follow it.
- **The source-editor plan** (`docs/plans/source-editor.md`) chose deliberate
  Stage/Save and no autosave ("No autosave-and-commit. The buffer is purely
  client-side until Stage or Save is clicked."). This plan autosaves to disk,
  on the boxholder's direction, because the agent co-edits and must see the
  person's text on disk. The two plans share no code now. If source-editor is
  built later, it can reuse the CodeMirror dependency and the
  region-precondition write shape.

## What already exists

- **Scoped Markdoc tags per schema.** `src/cards/schema.ts:255`:
  `markdocTags?: Readonly<Record<string, Schema>>`. Merged over core tags by
  `withScopedTags` (`src/shared/markdoc-config/scoped.ts:10-13`), which lint
  and the renderer share "so they cannot disagree". Only precedent:
  `src/plugins/recipe/base.ts:41` `markdocTags: recipeTags` and
  `src/plugins/recipe/view.tsx:99`
  `<Markdown card={card} tags={recipeTags} components={components}>`.
  **Reuse.**
- **Doc card rendering.** Doc cards use the generic frontmatter renderer
  (`src/frontend/src/renderers/markdown-card.tsx:13-14`, priority 30). The body
  renders in `CardBody.tsx:102-112`, which passes
  `components={CARD_EMBED_COMPONENTS}` and no `tags`. **Extend**: CardBody
  takes the scoped tags and components for the card's type (Track 3).
- **Body lint.** `lintBodyMarkdoc(bodyText, scopedTags)`
  (`src/core/body-markdoc-lint.ts:45`) runs `validate` with the scoped tags and
  maps every finding to `severity: "warning"` (`:73`). So a malformed
  composition never blocks a commit. **Reuse.**
- **Card write with lock.** `withCardLock(filePath, fn)`
  (`src/lib/card-lock.ts:123`) and the `card.setTheme` shape above. **Reuse.**
- **Commit with trailers.** `stageAndCommitPaths(boxRoot, {paths, message, trailers})`
  (`src/lib/git/core/operations.ts:374-397`); trailers appended as `Key: value`
  lines (`:399-404`). Webapp convention: `{"Source": "webapp", "Endpoint": "card.setTheme"}`
  (`card.ts:225`). **Reuse.**
- **Raw file write route.** `PUT /api/files/*` refuses cards
  (`files-write.ts:70`: "Card writes go through the card API or bbx create
  (cards validate)"), and its ETag is mtime+size (`file-etag.ts:9-11`), not
  content. **Not reused**; a card mutation is the documented path.
- **File-change events.** `useFileData` resyncs on a matching `file-change`
  (`src/frontend/src/components/file-view-data.ts:113-126`). The payload is
  `{event, path, timestamp}` only (`src/core/event-bus/schemas.ts:91-95`). The
  watcher coalesces at 50 ms (`src/core/box/file-watcher.ts:66`) and does not
  filter by writer. **Reuse** the subscription; the editor fetches the region
  itself.
- **Lazy loading.** `lazyComponent(load, pick)`
  (`src/frontend/src/lib/lazy-component.tsx:75`). **Reuse** for the editor.
- **Copy button.** `Fence` in `src/frontend/src/components/Markdown/body.tsx:170-189`
  uses `<Button … flash={{ label: "Copied" }} …>` with
  `navigator.clipboard.writeText`. **Reuse** the `Button` `flash` pattern;
  `Fence` itself is not exported and stays as is.
- **Automatic commits of dirty files.** Batch agent runs fall back to
  `stageAll` (`src/core/agent/invoke/commit.ts:59-92`); tick housekeeping
  commits everything at rest (`src/cli/tick-helpers.ts:223-243`); wakeup
  pre-actions `stageAll` (`src/cli/commands/wakeup/steps.ts:61-63`). Chat
  agents commit by their own git commands (`src/core/chat/session/prompts.ts:199`:
  "Commit file changes with a message describing what changed and why.").
  All of these can carry autosaved composition edits. The boxholder accepted
  this ("commits are checkpoints").
- **Agent edits.** Box agents edit cards with Claude Code's Edit/Write tools
  on disk; a PostToolUse hook runs `bbx validate --hook`
  (`src/core/install-validation-hooks.ts:2-6`). No hook commits.
- **Doc schema instructions.** `src/schemas/doc.tsx:36-104`, "## Body" at
  `:58-73`; generates `box-docs/card-doc.md`. **Extend.**
- **Quoting law.** `src/core/agent-guide/guide.md:39-55`. Unchanged; inside a
  composition the person's words need no `{% quote %}` (the region makes the
  claim). The guidance says so explicitly.
- Searched the frontend and its `package.json` for CodeMirror, ProseMirror,
  and a diff library: found none.

## Prior art (external)

- CodeMirror 6 replace decorations, `EditorView.atomicRanges`, and
  `Transaction.remote` / `Transaction.addToHistory`:
  <https://codemirror.net/docs/ref/>. **Adopted** (dependency).
- iOS Safari selection handles missing in `@codemirror/view` ≥6.35.1, fixed
  and closed 2026-04-15: <https://github.com/codemirror/dev/issues/1538>.
  Evaluated; the browser walk includes one pass on a phone.
- Backspace across atomic ranges with replace decorations misbehaves:
  <https://discuss.codemirror.net/t/backspace-on-decoration-with-atomic-ranges-not-working-correctly/6641>.
  Evaluated; Track 5 adds a delete keymap for marks.
- `node-diff3` (MIT) three-way merge: <https://github.com/bhousel/node-diff3>.
  **Adopted** (dependency).
- No Markdoc-aware editor exists (searched npm and GitHub for Markdoc editor;
  nearest are Gravity UI markdown-editor for YFM and Milkdown). Finding.
- Oral-history transcription reserves square brackets for editorial
  insertions (cited in the writing-practice issue). **Adopted** as the
  plain-text form of an open mark on Copy.
- Research notes for the editor choice: kept in the session; the ranking and
  the reasons are summarized in *Design* above.

ACKNOWLEDGEMENTS.md: CodeMirror and node-diff3 are dependencies, not adopted
designs; no entry needed. The bracket convention has no single author.

## Ontology

- **Composition** — the region of a doc card body between
  `{% composition %}` and `{% /composition %}`, each on its own line.
  Identified by the card path (one per card). Not a card type, not a file.
  New: `src/shared/markdoc-config/tags/composition.ts`.
- **Composition text** — the source text strictly between the two tag lines.
  This is what the editor edits and what Copy exports.
- **Editorial mark** — `{% editorial kind="…" %}…{% /editorial %}`, inline or
  block, placed by the agent inside a composition. Content is the agent's
  words, except for `check`. Kinds (closed enum):
  - `joiner` — agent-written text meant to read as part of the piece until the
    person replaces it. No accept action.
  - `gap` — a description of missing content. Removed when resolved.
  - `note` — a comment for the person. Removed when resolved.
  - `check` — wraps the person's text the agent is unsure of (a transcript
    doubt); the `note` attribute says why. Accept removes the tag and keeps
    the text.

  Not a `todo` (todos are collected box-wide, `core.ts` "universal
  capture-in-place annotation"); not a `quote` (inside a composition the
  person's words are the default).
- **Secondhand mark** — the existing `{% source ref="…" usage="…" %}`
  (`src/shared/markdoc-config/tags/core.ts:150`) around text that came through someone else's paraphrase.
  No new noun.
- **Region hash** — SHA-256 of the composition text, computed by the server.
  The write precondition. Not the file ETag (`file-etag.ts`, mtime+size).
- **Base text** — the composition text the editor last synced with the disk,
  after normalization. The base of the three-way merge.
- **Normalized text** — composition text with soft line breaks inside each
  paragraph joined by a space, trailing spaces removed, and runs of blank
  lines reduced to one. It renders the same as the input.
- **Save** — the person's explicit commit of the card: the editor's current
  text is written through the same hash-checked path, then committed, with
  trailers `Source: webapp`, `Endpoint: card.writeComposition`,
  `Composition-Save: person`. Distinct from autosave, which writes the same
  way without a commit.
- **Compose mode** — the editor replacing the rendered composition block in
  the card view. Per-view React state; not stored.

## Tracks / scope

### Track 1 — Tags, region finder, plain-text export

- **What:** the two Markdoc tag schemas and three pure functions shared by
  server and frontend.
- **Why this needs to change:** nothing marks a region or an agent's words
  today; the server and the editor must agree on where the region is.
- **Direction:** `src/shared/markdoc-config/tags/composition.ts` exports
  `compositionTags = { composition, editorial }`.
  - `composition`: block only; no attributes. `validate` errors when inline.
  - `editorial`: `kind` required, `matches: ["joiner","gap","note","check"]`;
    `note: String` optional (used by `check`). Transform to
    `EditorialInline` / `EditorialBlock` by `node.inline`, like `quote`.
  - `findComposition(body: string): CompositionRegion | CompositionProblem`
    with `CompositionRegion = {textStart, textEnd}` (offsets into the body)
    and `CompositionProblem = {problem: "none" | "multiple" | "inline" |
    "unclosed"}`. It parses with Markdoc and uses node `lines`.
  - `spliceComposition(body, region, text): string`.
  - `normalizeComposition(text: string): string`. Uses the Markdoc parse's
    paragraph nodes (`lines`) and joins the soft line breaks inside each
    paragraph, removing the continuation line's indent. Hard breaks (two
    trailing spaces or `\`), fences, tables, headings, and tag lines are
    untouched; trailing spaces on other lines are removed; three or more
    newlines become two. Idempotent.
  - `compositionPlainText(text: string): {text, openMarks: number}`.
    Normalizes first, so a hard-wrapped paragraph pastes as one line. Removes
    `source` tags and keeps their content; renders each open `editorial` as
    `[content]`; leaves other Markdown as written.
  - Cardinality: `lintBodyMarkdoc` validates per node, so it cannot see two
    compositions. The doc-card lint path (`src/core/card-lint/core/lint-cards.ts:277-283`)
    also calls `findComposition` when the schema's scoped tags include
    `composition`, and warns on `multiple`, `inline`, and `unclosed`.
- **Vocabulary lock-ins:** tag names `composition`, `editorial`; kind values;
  the `note` attribute.
- **First implementation chunk:** the tag file and the three functions with
  `t.check` tests covering: no region, one region, two regions, inline
  `composition`, unclosed tag, splice preserving bytes outside the region,
  normalization (a wrapped paragraph, a wrapped list item, a hard break kept,
  a fence kept, and idempotence), plain-text export with each kind and with
  `source`, and a lint test that a doc card with two compositions warns.

### Track 2 — Doc schema wiring and guidance

- **What:** doc cards declare the tags; the doc instructions teach them.
- **Why:** without `markdocTags` the tags render as `unknown-tag`
  (`scoped.ts:36-42`) and lint flags them.
- **Direction:** `DocSchema` gets `markdocTags: compositionTags`. The
  instructions get a "## Compositions" section (about 25 lines):
  - When to make one: the person is turning material into a piece of
    writing of their own. Put the piece in the one composition; keep sources,
    notes, and revision notes outside it.
  - Inside it, the text is the person's. Do not add or change words there
    except on their instruction. Mark every word of yours with
    `{% editorial %}`, by kind. Use `{% source %}` for secondhand lines.
  - Formatting is free and needs no mark: paragraph breaks, lists,
    headings, and moving the person's sentences into an order. It keeps the
    words, so it keeps the authorship.
  - Write each paragraph on one line; do not hard-wrap inside a composition.
  - Do not use `{% quote %}` inside a composition.
  - The person may edit while you work. Re-read the card before each edit.
- **Vocabulary lock-ins:** the section heading, which the knowledge audit
  checks.
- **First implementation chunk:** the schema field, the instructions section,
  regenerated `box-docs/card-doc.md`, and a lint test that a doc card with
  both tags validates clean and one with `kind="other"` warns.

### Track 3 — Read view: composition block, marks, Copy

- **What:** the composition renders as a framed block with Copy and Compose
  buttons; marks render as styled spans and blocks.
- **Why:** marks must be visible to a person who only reads (design: the
  phone reader), and Copy is the exit.
- **Direction:**
  - `CardBody` takes optional `tags` and `components` and merges them with
    `CARD_EMBED_COMPONENTS`. A small module-scope map in
    `src/frontend/src/renderers/` keys scoped tags and components by card
    type (`doc` only now); the generic renderer looks the type up. The maps
    are module constants (stable-card-body rule).
  - `CompositionBlock` renders its children in a frame with a header: Copy
    (label "Copy", flash "Copied"; if `openMarks > 0`, the label reads
    "Copy (2 open marks)") and Compose. It shows Compose only when
    `findComposition` returns a region.
  - `EditorialInline` / `EditorialBlock`: joiner = dotted underline with an
    accessible label "agent's words"; gap and note = tinted chip; check =
    the person's text with a wavy underline and the note as a tooltip and
    accessible description. An unknown `kind` still reaches these components
    (unknown-tag rewriting checks tag names only, `scoped.ts:36`), so they
    render it in the warning style with the label "unknown mark: <kind>".
- **First implementation chunk:** CardBody props and the type map; the three
  components; tests for render output (including `kind="draft"`) and for
  `body.stable-body.test.ts` still passing with the new components.

### Track 4 — Server: read and write

- **What:** a tRPC query and a mutation on the `card` router.
- **Why:** `PUT /api/files/*` refuses cards (`files-write.ts:70`) and checks
  mtime, not content; the editor needs a precondition on the region only, so
  agent edits elsewhere in the card (revision notes) do not conflict.
- **Direction:**
  - Both procedures resolve the path with `resolveCardPath` and then reject
    any card whose type is not `doc` (`resolveCardPath` checks containment
    only, `src/webapp/trpc/card-path.ts:22`).
  - `card.readComposition({path}) → {text, regionHash} | {problem}`.
  - `card.writeComposition({path, baseRegionHash, text, commit}) →
    {regionHash, commit: string | null}`, or `CONFLICT` with
    `{text, regionHash}` of the current region. Under `withCardLock`: read
    the file, find the region, compare hashes, splice, `writeFileAtomic`,
    and, when `commit` is true, `stageAndCommitPaths` with message
    `Save composition: <path>` and trailers
    `{"Source": "webapp", "Endpoint": "card.writeComposition", "Composition-Save": "person"}`.
    Then emit `file-change`. No validation gate. Save is this call with
    `commit: true` and the editor's current text, so a Save pressed before the
    autosave debounce commits what is on screen.
- **Vocabulary lock-ins:** the two procedure names and the trailer values.
- **First implementation chunk:** both procedures with tests: write splices
  only the region; a stale base gives `CONFLICT` with the current region; a
  change outside the region does not conflict; `commit: false` makes no
  commit; `commit: true` writes the given text and commits it with the
  trailers; a non-doc card is rejected.

### Track 5 — Editor

- **What:** the lazy-loaded CodeMirror editor that replaces the block in
  Compose mode.
- **Why:** the person types in the draft (design, first situation).
- **Direction:**
  - `src/frontend/src/components/Composition/editor/` with `scan.ts` (pure:
    source text → mark ranges, via Markdoc parse with locations; malformed
    tags yield no ranges and a `malformed` flag), `widgets.ts` (replace
    decorations, atomic ranges, mark buttons, delete keymap), `sync.ts`
    (autosave and merge), `ComposeEditor.tsx` (view and save state).
  - Mark actions: gap and note "×" removes the tag and content; check "✓"
    removes the tag and keeps the content; joiner has no button and is
    removed by delete (the whole mark at once). `source` delimiters become
    small atomic widgets; the content stays editable; "×" removes the
    delimiters and keeps the content.
  - Autosave: 800 ms after the last keystroke; one write in flight; the next
    waits.
  - Normalize on read: on entering Compose and on each remote read, the
    editor applies `normalizeComposition` to the disk text before using it.
    If the text changed, the next autosave writes the normalized form. The
    agent's wrapped lines therefore never reach the merge as line changes.
  - Sync: on `file-change` for the card path, call `readComposition`. If the
    hash equals the last synced hash, stop (own echo or a change outside the
    region). Else normalize and merge.
  - Merge (pure, `src/shared/composition-merge.ts`):
    `mergeComposition(base, local, remote) → {merged, conflicts}` with
    `node-diff3`. Its string inputs split on whitespace and drop it, so the
    function tokenizes itself with `text.split(/(\s+)/)`, which keeps each
    separator as a token and makes the merge a plain join. A conflict hunk keeps the local side in `merged`; each
    conflict also returns `{from, to, remote}`: the range of the local side
    in `merged`, and the remote text. Then `diffToChanges(local, merged)` gives minimal CodeMirror
    changes, dispatched with `Transaction.remote.of(true)` and
    `Transaction.addToHistory.of(false)`.
  - Conflict display: the editor shows each conflict's remote text as a
    widget after `to` ("agent's version, not merged", with "Use this", which
    replaces `from`–`to` with the remote text, and "Dismiss"). The range maps
    through later edits like any CodeMirror range. It is not written to the card, because remote text can hold
    tag syntax that would break a wrapping tag. The next autosave writes the
    person's side. The agent's version stays recoverable from git when the
    agent committed it, which chat agents do after edits
    (`src/core/chat/session/prompts.ts:199`); otherwise it lives only in the
    widget. Open conflict widgets trigger the same `beforeunload` warning as
    a pending write; past that warning an uncommitted agent version is lost.
    Accepted: it needs a same-span edit by both sides and an uncommitted
    agent write.
  - On `CONFLICT` from a write: merge with the returned region, then write
    again with the new base.
  - Save state (principle 13): "Saving…", "Saved to disk", "Not saved:
    <error>, retrying", "Saved" (after a commit). A `beforeunload` warning
    while a write is pending or failed. Save cancels the pending autosave
    timer and waits for any write in flight before it sends.
  - Exit Compose cancels the autosave timer, writes the current text if it
    differs from the last write, waits for that write, then returns to the
    read view. A failed write keeps the editor open with "Not saved".
- **Vocabulary lock-ins:** none beyond Track 4.
- **First implementation chunk:** `scan.ts` and `composition-merge.ts` with
  tests (pure). The merge tests cover edits on both sides of a tag, a
  paragraph split by the agent while the person types in it, and a same-span
  conflict. Then the
  editor view with widgets; then sync, with a test that Save before the
  debounce commits the on-screen text.

## Could this be simpler?

- **Simplest version:** tags, read view, and Copy only (≈450 lines); edits go
  through chat. It fails the core situation: the person types in the draft
  without dictating. The boxholder asked for an editor; this is the floor,
  not the goal.
- **Next simplest:** an editor with whole-file write and an mtime
  precondition (reuse a card variant of `PUT /api/files/*`), no merge; on
  conflict, reload and lose local typing, or block. It fails the second
  situation (the agent edits while the person types). Under principle 4,
  dropping the person's typing on a conflict is silent loss. The region hash
  and the merge are what let the agent's edits to the revision notes not
  interrupt the person at all.
- **Cut from this plan:** a crash cache in `localStorage` (the
  source-editor plan has one). Autosave runs every 800 ms, so the window is a
  write that fails and a tab closed past the `beforeunload` warning.
  Accepted.
- **Cut:** a conflict screen. A conflict shows as a widget in place, in the
  editor only.
- **Cut:** a separate save mutation. Save is a write with `commit: true`.

## Subplans

- [composition-editor.design.md](composition-editor.design.md) — the product
  design.

## Failure modes

> **Accepted risk (boxholder, 2026-10-27):** the agent's Edit tool writes without `withCardLock`. If
> it writes between `writeComposition`'s read and its atomic rename (a few
> milliseconds), the agent's change is overwritten. Claude Code's Edit
> refuses to write a file modified since its last read (Claude Code tool behavior,
> not verified by a test here), which covers the reverse order. The overlap needs an
> agent write landing inside a single server request. The loss is silent and
> the overwritten bytes are not restored unless the agent committed first.
> Closing it means making the agent's writes take a lock the server also
> takes, which is a new subsystem. Not built.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Agent writes `{% editorial kind="draft" %}` (bad kind) | Track 2 lint test; Track 3 render test | Lint warning; read view shows "unknown mark: draft" in warning style; editor shows raw text | Clear |
| Agent leaves a tag unclosed inside the composition | Track 1 (`unclosed`), Track 5 scan test | No Compose button for a broken region; scan `malformed` shows raw text with warning style | Clear |
| Agent adds a second composition | Track 1 lint test | Read view hides Compose; lint warns | Clear |
| Agent and person change the same paragraph | Merge test | Local kept; remote shown as an editor widget with Use this / Dismiss | Clear |
| Agent hard-wraps a paragraph it edits | Track 1 normalization test | Unwrapped on the editor's next read; the autosave writes it back unwrapped | Clear (renders the same) |
| Normalization changes rendering | Track 1 tests (hard break, fence, list) | Joins only soft breaks inside paragraphs | Clear |
| Save pressed before autosave fires | Track 5 sync test | Save sends the on-screen text with `commit: true` | Clear |
| Direct call to the write mutation on a non-doc card | Track 4 test | Rejected with `BAD_REQUEST` | Clear |
| Autosave write fails (network, 500) | Track 5 sync test with a failing client | "Not saved" state, retry, `beforeunload` | Clear |
| Write races an agent edit elsewhere in the card | Track 4 test | Region hash unchanged, no conflict; splice keeps the agent's change | Clear |
| Own write echoes as `file-change` | Track 5 sync test | Hash equal to last synced, ignored | Clear (no-op) |
| `file-change` missed (WebSocket drop) | Covered by `useLiveRefresh` reconnect resync | Resync then merge | Clear |
| Composition removed by the agent while Compose is open | Track 4 test (`problem: "none"`) | Editor shows "The composition was removed from this card" and stops autosave | Clear |
| `bbx upgrade` with autosaved, uncommitted edits | Not tested here | `upgrade.ts:52` refuses with "has uncommitted changes" | Clear |
| Tick housekeeping commits the person's edits mid-session | Not tested here | Accepted: commits are checkpoints | Clear in `git log` |
| Pasted text contains `{% … %}` | Track 5 scan test | It becomes a tag if valid, raw text if not | Clear |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field:** the agent uses `{% quote %}` or `{% todo %}`
  for its own words inside a composition. ADDRESSED: guidance (Track 2);
  knowledge audit. Not enforced by lint; a quote inside a composition is not
  invalid, only redundant.
- **Stale ref:** a `source ref` in a composition points at a moved card.
  ADDRESSED by existing ref tracking for `source`.
- **Two agents touching the same card:** chat agent and reactor. ADDRESSED:
  both use the Edit tool, which re-reads; the editor merges either.
- **Hand-edit drift:** the person types `{% editorial kind=gap %}` in the
  editor. ADDRESSED: scan treats it as a tag if Markdoc parses it; lint warns
  otherwise.
- **Fabricated free-form value:** the agent writes a joiner without marking
  it. GAP: the editor cannot detect unmarked agent text. Guidance and the
  knowledge audit are the only guard. The writing practice issue tracks the
  larger question.
- **Validation error UX:** lint messages name the line and tag
  (`body-markdoc-lint.ts:72-73`). ADDRESSED.
- **Partial migration / transition state:** existing doc cards have no
  composition and render as before. No migration. ADDRESSED.

## NOT in scope

- **Moving the text directly into a post or email** — the boxholder deferred
  it; Copy is the exit.
- **A destination attribute** on `composition` — no use yet.
- **Implicit resolution** of marks on edit — explicit first.
- **More than one composition per card** — boxholder decision.
- **Suggested edits as tracked changes** — a later layer; that issue chose
  attachment files, which this plan does not build.
- **Realtime character-level co-editing (Yjs)** — one to two seconds is
  acceptable; CodeMirror keeps that path open.
- **A crash cache** — see *Could this be simpler?*.
- **Editing the rest of the card** in Compose mode — chat or the source view.
- **The full writing practice** (elicitation, outline mode, boneyard
  retrieval) — the writing-practice issue.
- **Rich-text clipboard** (`text/html`) on Copy — plain text first; see open
  questions.

## Open design questions

- **Copy and Markdown syntax.** Copy keeps Markdown as written (`*emphasis*`
  stays as asterisks). Lean: fine for LinkedIn-style plain posts; revisit with
  real examples, as the boxholder said.
- **Mobile editing.** Compose is offered on the phone too. If the phone pass
  in the browser walk shows touch problems, file an issue; hiding Compose
  below a width is the fallback.

## Knowledge audits

New agent-facing concepts: the composition region and the editorial mark.
Add to `beebox/src/dev/knowledge-audits.yaml`:

- `knows_directly`: "Inside a `{% composition %}`, words the agent adds go in
  `{% editorial %}` with a kind; the agent changes composition text only on
  the person's instruction."
- `knows_directly`: "A doc card has at most one composition; sources and
  revision notes stay outside it."

Run with `pnpm knowledge-audit run --box ~/src/boxes/test1 --filter <id>`
and record the status comment, in the Track 2 chunk.

## What will hold this after it ships

- `t.check` tests on the pure functions: `findComposition`,
  `spliceComposition`, `compositionPlainText`, `scan`, `mergeComposition`,
  `diffToChanges`. These hold the decisions.
- tRPC tests for the two procedures against a temporary box (the existing
  card-router test pattern).
- `body.stable-body.test.ts` and `bin/card-remount-check` hold the
  no-remount rule for the new components.
- No new test tier. The CodeMirror widget behavior on touch is checked once
  by hand in the browser walk; it is not held by an automated test.

## Implementation order

1. Track 1 (tags and pure functions).
2. Track 2 (schema, guidance, knowledge audit run).
3. Track 3 (read view and Copy). Depends on 1 and 2.
4. Track 4 (mutations). Depends on 1.
5. Track 5 (editor). Depends on 3 and 4.
6. Browser walk of the design walkthrough on a test1 clone card, with an
   exhibit, and one pass on a phone (selection, backspace across a mark,
   undo after a remote change).

## Rollout shape

- Tests first for each pure function (Track 1, merge, scan), then the
  mutations. Done when the tests named in each track pass, `pnpm typecheck`
  and `pnpm layout-check` pass, and the browser walk matches the
  walkthrough in the design.
- Knowledge audits land run, in Track 2.
- No data migration: the tags are additive; existing doc cards are
  unchanged. The boxholder's example card can be converted by asking the
  agent after this ships.
