---
title: "A card's contents menu stays still while the card changes under the reader"
status: draft
workstream: contents-menu-stable
issues:
  - ../../../issues/bugs/2026-11-03-card-contents-menu-collapses-and-reappears.md
---
# A card's contents menu stays still while the card changes under the reader

The contents menu of a long Markdown card expands and collapses while the
reader is not scrolling, when agents edit the card. This plan makes the menu
expand only for the reader's own scrolling, toggles the expanded look without
a React render, and takes the outline from the Markdown being rendered instead
of re-reading the DOM on every mutation.

**Issues addressed:** `issues/bugs/2026-11-03-card-contents-menu-collapses-and-reappears.md`.
Related and closed: `issues/closed/bugs/2026-10-26-card-contents-button-flickers-on-a-card-with-an-embedded-widget.md`
(same symptom; its cause was embed remounts, fixed by
`beebox/docs/implemented-plans/stable-card-body.md`). Searched open `issues/`
for "contents menu", "contents button", "scroll anchoring", "remount": no other
open item.

## Design

No design section: this restores already-decided behavior. The header comment
of `CardContentsMenu.tsx:5-6` states the intent: *"Scrolling is when the reader
wants to know where they are, so the button is full while the card scrolls."*
A scroll the reader did not make is outside that intent.

## Smallest fix and budget

**Reproduction (this worktree's test1 clone, dev build, chat side panel,
`/chat?card=/_content/repro/long-report.doc.card`).** A probe sampled the
card front, the outline root, the first heading, and the menu element every
5 ms, and counted `data-resting` changes.

| Trigger | Remounts (front, outline root, heading, menu) | Menu expand/collapse flips |
|---|---|---|
| 6 in-place text edits to the open card, reader at the top | 0 | 0 |
| 6 new cards created in the same folder | 0 | 0 |
| 4 edits by atomic rename (`mv` over the file) | 0 | 0 |
| frontmatter edit, then a box git commit | 0 | 0 |
| A real chat agent: 3 edits to the open card and 2 new cards | 0 | 0 |
| 4 edits that grow the intro paragraph, reader scrolled to section 3 | 0 | **8** (4 expand, 4 collapse) |

The last row is the reported symptom. The scroller moved from 1500 to 2597
with no input: browser scroll anchoring keeps the reader's place when the
text above grows, and each anchoring adjustment is a `scroll` event. The
handler at `CardContentsMenu.tsx:126-129` treats every scroll event as the
reader scrolling: *"const onScroll = () => { setScrolling(true); … setTimeout(() => setScrolling(false), REST_AFTER_MS);"*.
The earlier plan recorded the same chain with a remount as the trigger
(`stable-card-body.md`: *"scroll scrollTop 900 → 1048 ← browser scroll
anchoring; the reader did not scroll"*). No remount was reproduced here; see
Track 3.

**Smallest fix:** ignore scroll events that no reader input started. This
alone stops the reported flicker.

**Chosen:** the smallest fix plus the two changes the boxholder approved:
the expanded look set as a DOM attribute (no React render per scroll), and
the outline taken from the Markdown tree. Estimate: ~150 changed source
lines, ~150 changed test lines (two DOM-reading tests replaced). No docs
beyond this plan and the issue.

## Stated preferences this plan trades against

- The boxholder on this issue: *"the use of render to handle the collapsing
  seems fragile, but also there's some rerender/remount happening."*
- The boxholder on the earlier issue (`2026-10-26-…-embedded-widget.md`):
  *"I really dislike remounts! Especially in content! We need firmer
  boundaries!"* This plan adds no remount and no remount-prone pattern; the
  outline context is provided once per card surface.
- Memory/feedback: minimize invented concepts. The outline handoff uses a
  React context, the ordinary primitive for a parent reading a descendant.
  No new attribute or registry; `data-card-outline` stays as the DOM root for
  heading lookup.

## What already exists

- `makeHeadingNode` (`shared/markdoc-config/tags/core.ts:90-106`) emits
  `new Tag(\`h${level}\`, { id, … }, children)`, so the transformed tree
  already holds each heading's tag, id, and text. Reuse.
- `Markdown` (`components/Markdown/body.tsx:356-366`) memoizes `tree` on
  `[children, basePath, tags, bodyLineOffset]`. The outline is derived from
  that memo. Reuse.
- `buildOutline` and `currentSection` (`CardContents/outline.ts`) are pure and
  tested (`test/components/CardContents/outline.test.ts`). Reuse unchanged.
- `insideEmbed` and the first-outline-root rule (`CardContentsMenu.tsx:36,45-48`)
  keep embedded cards' headings out. Kept for the DOM position lookup.
- The CSS treatment (`themes/card-themes.css:159-165`) already shows the full
  button on `:hover`, `:focus-within`, and an open dropdown. Reuse; only the
  attribute flips.
- `bin/card-remount-check` checks that the card body does not remount when the
  workspace changes. Reuse as a regression check.

## Prior art (external)

- Scroll anchoring (CSS Scroll Anchoring, `overflow-anchor`) adjusts
  `scrollTop` after layout changes above the anchor node and fires `scroll`
  events. Evaluated-only: https://drafts.csswg.org/css-scroll-anchoring/ .
  The plan does not turn anchoring off: it keeps the reader's place, which is
  what the reader wants while an agent edits above.
- There is no "isTrusted"-style flag that distinguishes a user scroll from an
  anchoring scroll; both are trusted `scroll` events. Hence the input-event
  rule in Track 1. Evaluated-only.

## Ontology

No new nouns. Existing: *outline entry* (`OutlineEntry`, `outline.ts:8`),
*outline item* (`OutlineItem`, `outline.ts:16`), *outline root*
(`[data-card-outline]`, `body.tsx:386`). New names: `CardOutlineContext`
(the setter a card surface hands its document's `Markdown`), and the
`data-scrolling` attribute, which replaces `data-resting` with the opposite
meaning.

## Tracks / scope

### Track 1 — Expand only for the reader's scrolling, without a render

- **What:** the menu wrapper gets `data-scrolling` set and cleared directly
  through a ref. It is set on a scroll event only when reader input is recent
  or a reader scroll is already in progress.
- **Why:** the reproduction above.
- **Direction:** in the scroll-tracking effect, listen on the scroller for
  `wheel`, `touchstart`, `touchmove`, `pointerdown` (scrollbar drag) and on
  `document` for `keydown` of scroll keys (Space, PageUp/Down, Home, End,
  arrows). Each records `lastInput = performance.now()`. A key counts only
  when its target is the body or inside the scroller and is not editable
  (`input`, `textarea`, `[contenteditable]`), so arrow keys in the chat
  composer do not arm it. A `pointerdown` counts only when its target is the
  scroller itself (a scrollbar drag), so selecting text in the card does not. `onScroll`: if
  `now - lastInput < INPUT_MS` (500 ms) or the attribute is already set,
  set `data-scrolling` and restart the 1.2 s timer that removes it. A touch
  fling continues to scroll after `touchend`; the "already set" chain covers
  it. `jump()` records input before `scrollIntoView`, so a jump from the menu
  shows the new section's name. CSS changes to
  `.bbx-card-contents:not([data-scrolling], :hover, :focus-within, :has([aria-expanded="true"]))`.
  The `scrolling` state and `restTimer` ref are deleted. The label still
  follows the current section through `current` state, which changes only
  when the section changes (`setState` with an equal value does not render).
- **Vocabulary lock-ins:** `data-scrolling` on `.bbx-card-contents`.
- **First chunk:** this track with its test. No open questions.

### Track 2 — The outline from the Markdown tree

- **What:** `Markdown` with `outline` derives its outline entries from its
  transformed tree and hands them to the card surface through
  `CardOutlineContext`. The menu receives `entries` as a prop. The
  MutationObserver and `sameOutline` are deleted. The DOM is read only to find
  heading elements for the current-section label and for a jump.
- **Why:** the observer re-reads on any DOM change in the front, and
  `sameOutline` counts new heading nodes with the same text as a change
  (`CardContentsMenu.tsx:57`: *"&& a.headings.get(item.id) === b.headings.get(item.id)"*),
  which restarts the scroll effect. A body that is briefly empty unmounts the
  menu (`readOutline` returns `null`).
- **Direction:**
  - `outline.ts`: `export function outlineEntries(tree: RenderableTreeNode): OutlineEntry[]`
    walks Markdoc `Tag`s; a tag named `h1`–`h6` with a string `id` becomes an
    entry, its text the concatenated strings under it; it does not descend
    into a heading. Same-value check: `sameEntries(a, b)` on id, level, text.
  - `CardContents/CardOutlineContext.ts`: `createContext<((entries: readonly OutlineEntry[] | null) => void) | null>(null)`.
  - `body.tsx`: when `outline`, `useMemo(() => outlineEntries(tree), [tree])`;
    a layout effect publishes the entries when they change; a separate
    layout effect publishes `null` on unmount only, so a re-render never
    passes through `null`. Both are layout effects so ordering is fixed when
    one body replaces another in one commit: React runs a deleted fiber's
    layout cleanups in the mutation phase, before the new fiber's layout
    effects, so the old `null` cannot clear the new outline. The rendered body is wrapped in
    `<CardOutlineContext.Provider value={null}>`, so an embedded card's own
    `Markdown outline` (which renders `CardBody` again) cannot publish to the
    outer card. This replaces the "first outline root" rule.
  - `CardContents/CardOutlineContext.ts` also exports `useCardOutline()`:
    `useState<readonly OutlineEntry[] | null>(null)` with a setter that keeps
    the previous array when `sameEntries`. `CardThemeSurface.tsx` calls it,
    provides the setter around `children`, and passes `entries` to
    `CardContentsMenu`. Tests use the same hook, so array identity is
    asserted at the boundary the menu sees.
  - `CardContentsMenu.tsx`: `items = useMemo(() => buildOutline(entries ?? []), [entries])`.
    `headingElements(front)` (the old `readOutline` DOM pass, positions only)
    runs inside `findCurrent` and `jump`. The dropdown list (rendered only
    while open, `ui/Dropdown.tsx:308`) is a small `ContentsList` that reads
    `headingElements` in a layout effect and lists only items whose heading
    is on screen. A body in compose mode replaces its composition region with
    the editor host (`MarkdownCardView/Composition.tsx:103`), so its headings
    are in the tree but not on screen; they drop out of the open list, as
    they did when the outline was read from the DOM.
- **Vocabulary lock-ins:** `CardOutlineContext`, `outlineEntries`.
- **First chunk:** after Track 1. No open questions.

### Track 3 — The reported remount

- **What:** find any remount or re-render on a text-only edit in the chat side
  panel.
- **Finding:** no remount on a successful re-read (table above). A failed
  re-read remounts the whole body. `components/FileView/view.tsx:185-200`:
  *"if (stale === null && !sectionMissed) return content; return (<>{stale === null ? null : <FileStaleNotice …/>}…{content}</>);"*.
  The body's position in the tree changes from the element itself to the
  third child of a Fragment, so React unmounts and remounts it. `stale` is set
  when a refetch fails (`lib/file-load-state.ts:72`: *"const stale =
  query.isRefetchError ? describeQueryFailure(query.error) : null;"*): the
  file is briefly missing, or the box restarts or answers 502. Reproduced:
  deleting the card file for 2 s showed "Not up to date / Card not found",
  and the probe saw the outline root and its headings replaced twice (notice
  on, notice off). The same wrapper flips on `sectionMissed` (a `#fragment`
  URL whose heading appears or disappears).
- **Direction:** `withBodyNotices` always returns the same Fragment shape:
  the two optional notices as `null`-or-element slots, then `content`. The
  body then keeps its position whether a notice shows or not.
  `bin/card-remount-check` had rotted (it opened `/chat?card=_content/…`,
  which now answers "Invalid card path"); its URL gets the leading `/`. It
  gains two steps after pin/unpin, each checked for replaced body nodes:
  (a) text appended to the intro, above the reader, checked also for the
  contents menu showing `data-scrolling` (the reported symptom); (b) the card
  file missing for 2 s, then restored. The fixture file is restored at the
  end, so the next run's fixture check passes. A text-only edit re-renders
  `CardBody` (new `children`); that render is expected, and the check is on
  node identity, which a remount breaks and a re-render keeps.
- **Not fixed here:** a re-read that lands on a half-written file
  (`card.get` with no frontmatter or an empty body) changes the rendered
  shape and so remounts. Whether box writers are atomic is a server question;
  filed as its own issue.

## Could this be simpler?

The simplest version is Track 1's input rule alone, keeping the React state:
it stops the reported flicker. It leaves (a) a render of the button per
scroll start and stop, which the boxholder named as fragile, and (b) the
outline's dependence on DOM mutations, where an empty body or a re-created
heading node rebuilds or unmounts the menu. Tracks 1's attribute and Track 2
are what the boxholder approved for those two. Track 2 deletes more than it
adds in `CardContentsMenu.tsx` (observer, `sameOutline`, `readOutline`'s
outline half).

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A real reader scroll by a device that sends no input event the menu listens to (e.g. an assistive-tech scroll) does not expand the menu | no | label still updates; menu shows on focus/hover | silent but harmless: the button stays usable at rest |
| A component override drops a heading's children, so an outline item has no DOM element | new test: missing element is skipped in `findCurrent`, `jump` no-ops | yes | silent: that item does nothing |
| An embedded card's `Markdown outline` publishes into the outer card | new test | null provider | would be visible as extra items |
| Same-text re-render publishes a new array and re-runs the scroll effect | new test (array identity stable) | `sameEntries` | silent churn |
| A failed re-read (stale notice) remounts the body | new test | stable Fragment shape | was silent: embeds reset, outline rebuilt |
| The body unmounts and remounts in one commit | covered by React batching of the two setter calls | yes | n/a |

Residual risks after cross-model diff review (codex gpt-6-sol), accepted:

- A scrollbar drag may not reach the page as a `pointerdown` (Chromium can
  handle scrollbar input on the compositor). Then the button stays at rest
  during the drag; the label still follows the section. Not testable here:
  the test browser uses overlay scrollbars of width 0.
- The section label recomputes on scroll and on a size change of the card
  front (`ResizeObserver`). An edit that moves headings but leaves the
  front's height the same leaves the label stale until the next scroll.
- While a card composes, headings inside the composition region are not on
  screen and drop out of the open list. If every heading is in that region,
  the list opens empty. Which headings to show while composing is a product
  decision for the boxholder.

## Agent-flow / user-flow edge cases

- Two agents touching the same card: ADDRESSED. Edits change the text; the
  outline updates only when headings change, and anchoring scrolls do not
  expand the menu (Track 1).
- Reader scrolling while an agent edits: ADDRESSED. The chain keeps the menu
  full; an anchoring scroll during it just extends it.
- Jump from the menu: ADDRESSED (records input).
- Wrong tag / stale ref / hand-edit drift / fabricated value / validation UX /
  partial migration: not applicable; no agent-facing vocabulary or data shape.

## NOT in scope

- Turning off scroll anchoring on the card desk: it keeps the reader's place
  while an agent writes above.
- Published pages' contents list (`issues/exploration/2026-10-20-published-page-contents-list.md`).
- Remounts in other surfaces (box view, chat message bodies): the earlier plan
  covered them.

## Open design questions

none

## Knowledge audits

None: no agent-facing concept. Purely frontend behavior.

## What will hold this after it ships

- `outline.test.ts`: `outlineEntries` over a transformed tree (nested inline
  markup, headings in a blockquote, levels).
- New `CardContentsMenu.reader-scroll.test.ts` (happy-dom, `dom-harness`): a
  bare `scroll` event leaves `data-scrolling` unset; `wheel` then `scroll`
  sets it; the attribute clears after the rest delay; no React render of the
  menu on scroll (render counter).
- New `body.outline.test.ts`: `Markdown outline` under a capturing
  `CardOutlineContext` publishes the headings; re-rendering with a text-only
  change keeps the same array; an inner `Markdown outline` does not publish.
- The two DOM-reading tests (`read-outline`, `embed-boundary`) are replaced by
  the above.
- New `FileView/view.body-notices.test.ts`: a body under `withBodyNotices`
  keeps the same DOM node and component instance when `stale` turns on and
  off (a mount counter in the body).
- `bin/card-remount-check` stays the browser check for remounts.

## Implementation order

1. Track 1 + test. Commit.
2. Track 2 + tests; delete the old tests. Commit.
3. Track 3: `withBodyNotices` shape + test, the `card-remount-check` URL fix,
   the half-written-read issue filed. Commit.
4. Issue updated; before/after browser evidence as one exhibit.

## Rollout shape

Done when the three new tests pass, `outline.test.ts` passes, typecheck,
layout-check, lint pass, `bin/card-remount-check` passes, and the browser
repro (grow the text above a scrolled reader) shows 0 flips. No data shape
change, no migration, no knowledge audit.
