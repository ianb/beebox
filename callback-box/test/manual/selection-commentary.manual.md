# Manual test: selection commentary (capture in the companion pane)

Reference script for the parts of selection-commentary that can't run
headlessly: the floating "+" geometry, the selection → "+" → click flow, and
the pill/composer behavior. Not run by `pnpm test` (this dir is excluded);
run it by hand (or drive it with `bin/browse`) when touching the feature.

The pure pieces *are* covered automatically — see
`test/frontend/lib/selection-position.doctest.md` (`formatPosition`) and
`test/shared/markdoc-headings.doctest.md` (heading ids / `data-line`). The DOM-walk
(`extractSelection`) was validated against the real rendered DOM via
`bin/browse eval` (see commit notes); the steps below re-confirm it
end-to-end through the actual UI.

## Setup

1. `pnpm dev` (or `bin/workstreams serve`) and open the chat for the test box.
2. Open a document in the companion pane (click a `[label](/store/…)` file link
   in a message). Use a Phase-2 card with frontmatter, headings, and several
   paragraphs.

## Capture flow (Track 2)

1. **Select text in the body, under a heading.** A round **"+"** appears just
   past the end of the selection.
   - It sits correctly even after scrolling the pane (it's `position: fixed`,
     read from the selection rect).
   - Starting a new selection (mousedown) or selecting nothing dismisses it.
2. **Whitespace-only / empty selection → no "+".**
3. **Click the "+".** A `[selectionN]` token is inserted at the composer
   caret and a pill appears above the composer (Track 3). The capture carries:
   - `ref` = the open doc's path, leading-slash absolute.
   - `text` = the verbatim rendered selection.
   - `position` = e.g. `body; heading: <h> (#<slug>); paragraph <n>; ~line <L>`.
4. **Selecting collapses on click** — the highlight clears after capture.

## Composer pills + send (Track 3, typed path)

1. **Pill** shows `selectionN` + a truncated snippet. Clicking it opens a
   popover with the source doc name, the position, and the full text.
2. **Trash (×)** on the pill removes it and strips the `[selectionN]` token
   from the textarea.
3. **Type around the token** (e.g. `compare [selection1] with this`), then
   send. Inspect the outgoing message (session log / debug view): the token is
   replaced inline by
   `<user-selection ref="…" pos="…">…</user-selection>` inside `<typed>`.
4. **Multiple selections**: add two, delete one token by hand, send — the
   surviving token expands inline, the orphaned selection is appended after
   the typed text.
5. **Voice path (Track 4)**: with a selection pending, send a spoken message —
   the `<user-selection>` is appended after the `<speech>` body (no token to
   replace). [Pending Track 4.]

## Position locator — expected shapes (`extractSelection`)

- **Body paragraph under a heading** →
  `body; heading: What this unlocks (#what-this-unlocks); paragraph 2; ~line 83`
- **List item under a heading (plain `.md`, no frontmatter)** →
  `heading: Map: (root) (#map-root); ~line 1` (no `section`, no `paragraph`)
- **Frontmatter field** → `frontmatter` (no heading/paragraph/line)
- **Body text before any heading** → `body` (+ `paragraph N` if in a `<p>`)

Notes / known v1 limits:
- `paragraph` counts `<p>` only; list items and blockquotes get no paragraph
  number (heading + line still locate them).
- `~line` comes from the nearest heading's `data-line`; paragraphs don't carry
  their own line, so it's the heading's line (rough by design).

## Where "+" must NOT appear

- Browse detail panel, full card page, dashboard — anywhere `FileView` is
  rendered without `onAddSelection`. Confirm no "+" on `/browse/<card>`.
