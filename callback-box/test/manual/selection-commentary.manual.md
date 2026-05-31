# Manual test: selection commentary (capture in the companion pane)

Reference script for the parts of selection-commentary that can't run
headlessly: the floating "+" geometry, the selection → "+" → click flow, and
the pill/composer behavior. Not run by `pnpm test` (this dir is excluded);
run it by hand (or drive it with `bin/browse`) when touching the feature.

The pure pieces *are* covered automatically — see
`test/selection-position.doctest.md` (`formatPosition`) and
`test/markdoc-headings.doctest.md` (heading ids / `data-line`). The DOM-walk
(`extractSelection`) was validated against the real rendered DOM via
`bin/browse eval` (see commit notes); the steps below re-confirm it
end-to-end through the actual UI.

## Setup

1. `pnpm dev` (or `bin/worktrees serve`) and open the chat for the test box.
2. Open a document in the companion pane (click a `view:`/file link in a
   message, or zoom a view). Use a Phase-2 card with frontmatter, headings,
   and several paragraphs.

## Capture flow (Track 2)

1. **Select text in the body, under a heading.** A round **"+"** appears just
   past the end of the selection.
   - It sits correctly even after scrolling the pane (it's `position: fixed`,
     read from the selection rect).
   - Starting a new selection (mousedown) or selecting nothing dismisses it.
2. **Whitespace-only / empty selection → no "+".**
3. **Click the "+".** It should (once Track 3 lands) insert a `[selectionN]`
   token + pill; for Track 2 in isolation it calls `onAddSelection` with:
   - `ref` = the open doc's path, leading-slash absolute.
   - `text` = the verbatim rendered selection.
   - `position` = e.g. `body; heading: <h> (#<slug>); paragraph <n>; ~line <L>`.
4. **Selecting collapses on click** — the highlight clears after capture.

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
