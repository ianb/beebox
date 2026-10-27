---
title: "A card body does not remount when only its surroundings change"
status: active
workstream: card-remount
issues:
  - ../../../issues/bugs/2026-10-26-card-contents-button-flickers-on-a-card-with-an-embedded-widget.md
---
# A card body does not remount when only its surroundings change

The shared Markdown renderer makes new React component types whenever a
callback prop or the text changes. React then unmounts and remounts every
link, citation, quote, todo, and embed in the body. In the companion pane,
any workspace state change gives the card a new `onNavigate`, so an embedded
figure is destroyed and rebuilt while the person reads it. This plan makes
the renderer's component types fixed for the life of the page and makes an
embed (`![](…)`) a boundary in both directions.

**Issues addressed:** `2026-10-26-card-contents-button-flickers-on-a-card-with-an-embedded-widget`.
Searched `issues/` (open) for "remount", "re-mount", "flicker", "widget
reset": only this issue matches.

## Design

No design section: this restores already-decided behavior. A card the reader
is reading keeps its state; the contents button expands only while the reader
scrolls (`CardContentsMenu.tsx:7`: *"the button is full while the card
scrolls. When scrolling stops it rests"*).

## Diagnosis (evidence)

Reproduced on this worktree's test1 clone with `_content/docs/Remount_Repro.doc.card`
(eight sections, two external citations, and an embedded d3 figure with two
atom pickers). The fixture is written by `bin/card-remount-check`. Traces
came from a page script that records scroll events on the card desk,
`data-resting` changes on the contents button, removed DOM nodes, node
identity of the picker, the drawing, a citation, and a heading, and React
fiber props of `Markdown`, `CardBody`, and `FileView` sampled every 50 ms.

| Trigger | Card re-rendered? | Remounted |
|---|---|---|
| Idle 30 s, nothing else happening | no | nothing |
| Pick change inside the figure | no | nothing (only the sketch's own SVG redraw) |
| `touch` the card file; write an unrelated file; type in the composer; a plain chat turn | no | nothing |
| Real edit to the card text (append a paragraph) | yes, `children` changed | both citations; picker and drawing kept |
| Switch to another workspace tab and back | yes, `onNavigate` changed | figure (picker, drawing), both citations |
| Agent turn that writes an unrelated, unopened file | yes, `onNavigate` changed twice | figure, both citations |
| Pin or unpin the card's own tab (card stays visible) | yes, `onNavigate` changed | figure, both citations |

One trace shows the whole chain for the reported symptom (times in ms):

```
250748 removed DIV.contents            ← the embed's FileView unmounts
250791 removed DIV.text-warm-700 p-4   ← its "Loading" placeholder, 43 ms later
250799 scroll scrollTop 900 → 1048     ← browser scroll anchoring; the reader did not scroll
250804 resting false                   ← the contents button expands
252002 resting true                    ← 1.2 s later it rests
```

So the "layout loop" in the issue is real but secondary: the remount causes a
height change, scroll anchoring moves the reader 148 px, and that scroll event
expands the button. Any workspace state change during a reading session (an
agent turn, a question arriving, a tab added or pinned) repeats it. The
boxholder's "idle" card was likely open while an agent worked.

The chain in code:

1. `components/chat/workspace/WorkspaceCanvas/view.tsx:47` builds the card's
   navigation callback inline: *"onNavigate={(target, hint) => { reportActivity("navigated", target.path); workspace.open(target, { ...hint, originatingPane: pane }); }}"*.
   The React Compiler memoizes it on `workspace`, the context value, which is
   new on every workspace state change.
2. `components/MarkdownCardView/CardBody.tsx:97-100` rebuilds the embed
   components when it changes: *"const components = useMemo(() => makeEmbedComponents({ onNavigate, … }), [onNavigate, data.path, boxSlug])"*.
3. `components/FigureEmbed.tsx:37` declares the embed component inside that
   factory: *"function Img({ src, alt, title, width }) {"*. A new function is a
   new component type, so React remounts the `FileView` it renders.
4. `components/Markdown/body.tsx:339-357` (the `Markdown` memo) lists
   `onNavigate`, `components`, and `children` among its dependencies and calls
   `buildRenderConfig`, which makes new `Link`, `Img`, `QuoteInline/Block`,
   `SourceInline/Block`, `TodoInline/Block`, `SeeAlso`, `IncludeFile`,
   `Blockquote`, and `Task` types each time (`body.tsx:237-252`, `:266`).

Commit `bc1a231bc` (citation colors) changed only class names in
`Markdown/Source.tsx`; it is not involved. Citations remount because of
step 4, which predates it.

## Smallest fix and budget

**Smallest fix:** make `WorkspaceCanvas`'s `onNavigate` stable (read
`workspace` and `pane` through a ref). This stops the reported trigger only.
A text edit still remounts every citation and link. Any other caller with an
unstable callback, such as `ViewMarkdown` in a box view or a chat message,
still remounts its embeds.

**Chosen:** three tracks.

| Track | Estimated changed lines (source + test) |
|---|---|
| 1. Fixed component types in `Markdown` | ~260 source; the ~65-line DOM test is already written |
| 2. The embed boundary | ~50 source, ~60 test |
| 3. Keep the browser check | 0 (the ~190-line `bin/card-remount-check.ts` is already written) |

About 450 changed lines still to write. Well under the 2,000-line BIG CHANGE line.

## Stated preferences this plan trades against

- The boxholder, on this issue: *"I really dislike remounts! Especially in
  content! We need firmer boundaries!"*, and *"Things like ![]() embeddings
  should generally have good boundaries, the child isn't intended to affect
  the parent and vice versa."* Track 2 implements the second statement.
- `beebox/docs/engineering-principles.md` §11, *Enforcement beats
  convention*: the preset already enables `react-hooks/static-components`
  (`personal-vibe-check/preset/react-rules.ts:30`). It did not catch this,
  because the components are made in a plain factory called from `useMemo`,
  not inside a component body. Track 1 removes the factories, so the
  existing rule covers what remains. DOM tests hold the behavior.
- Memory "minimize invented concepts": Track 1 uses one React context, a
  platform mechanism, and does not add a registry or a stable-callback helper.

## What already exists

- `Markdown` already takes the props the components need (`body.tsx:323-333`).
  Reuse: those props become the context value.
- Module-level components already in the map: `Para`, `Fence`,
  `RedactedInline/Block`, `UnknownTagInline/Block` (`body.tsx:264-281`).
  These did not remount in the traces (the paragraph and heading kept their
  identity). They are the model for the rest.
- `CardContentsMenu` already ignores headings of nested outline roots
  (`CardContentsMenu.tsx:36`: *"if (heading.closest("[data-card-outline]") !== root) continue;"*).
  Track 2 adds the same rule for mutations inside an embed.
- `components/chat/AGENTS.md:145`, *"Workspace card roots survive
  presentation changes"*: the card root does survive. The remount is inside it.
  That section is where the body rule goes.
- A happy-dom test harness exists: `test/helpers/dom-harness.ts:85`,
  *"Mount `element` in a fresh container under `document.body`, effects
  flushed"*, with `rerender` (`:66`) and per-component render counts (`:70`).
  `test/components/Markdown/body.image-card-links.test.ts` already mounts
  `Markdown` with it. Reuse: `test/components/Markdown/body.stable-body.test.ts`
  (written with this plan) mounts a body, re-renders it with a new
  `onNavigate` or appended text, and checks that the link, both citations,
  and the blockquote are the same DOM nodes. It fails today: all four are
  replaced; the heading is kept.
- `Para` drops its wrapper around a lone image by component name
  (`body.tsx:121-125`, `componentDisplayName`, which matches `"Img"` or
  `"Image"`). An embed override must keep the name `Img`.

## Prior art (external)

- React: a component type that changes identity between renders resets its
  subtree's state. <https://react.dev/learn/preserving-and-resetting-state>
  ("Different components at the same position reset state"). Evaluated-only.
- Markdoc's React renderer creates elements from the `components` map by
  name (`renderers.react(tree, React, { components })`, `body.tsx:359`). A new
  map value means a new element type. Confirmed empirically above.

## Ontology

No new nouns. One new internal value:

- **Markdown render context**: the `onNavigate`, `basePath`, `boxSlug`,
  `onJumpToQuote`, `openImageLink`, and `cardPath` of one `Markdown` render,
  provided by `Markdown` to its components. It replaces the existing
  `LinkContext` argument (`markdown-link/link.tsx`). It is not a cache and
  holds no state.
- **Embed**: an in-box `![](…)` target rendered by `FileView mode="embed"`
  (`FigureEmbed.tsx:50-58`). Its identity is the resolved target (path,
  viewer, params, view state). It is NOT a link, and not an image.

## Tracks / scope

### 1. Fixed component types in `Markdown`

- **What:** every component in the render map and in the callers' override
  maps is declared once at module scope. It reads per-render values from a
  `MarkdownRenderContext` that `Markdown` provides.
- **Why:** today a callback or text change makes new types and remounts
  every link, citation, quote, todo, and embed (Diagnosis, table rows 4-7).
- **Direction:**
  - `lib/markdown-render.ts` (beside `lib/box-slug.tsx`; inside
    `components/Markdown/` it would make that directory two units, which
    `pnpm layout-check` rejects): `MarkdownRenderContext =
    createContext<MarkdownRender | null>(null)` and
    `useMarkdownRender(): MarkdownRender`, which throws when it is missing.
  - `makeLink`, `makeImg`, `makeQuoteComponents`, `makeSourceComponents`,
    `makeTodoComponents`, `makeSeeAlsoComponent`, `makeIncludeFileComponent`,
    and `makeEmbedComponents` become exported components (`Link`, `Img`,
    `QuoteInline`, …, and the embed override) that call `useMarkdownRender()`.
    The embed override's function is also named `Img` (in `FigureEmbed.tsx`),
    so `Para`'s lone-image check (`body.tsx:121-125`) still unwraps a
    standalone `![](…)`.
    `Blockquote` and `Task` move to module scope.
  - `buildRenderConfig` keeps only the Markdoc `config`. The component map is
    a module constant `MARKDOWN_COMPONENTS`.
  - The `Markdown` memo depends only on what the transform reads: `children`,
    `tags`, `basePath` (for `includes`), `cardPath`, `bodyLineOffset`. The
    merged map is memoized on `components` alone.
  - Callers' overrides become module constants: `CARD_EMBED_COMPONENTS`
    (CardBody, PdfCardView) and `CHAT_MARKDOWN_COMPONENTS`
    (`chat/markdown-rendering.tsx:136`). Their `useMemo` calls go away.
- **Vocabulary lock-ins:** `MarkdownRenderContext`, `useMarkdownRender`.
- **First chunk:** add the context, convert `Link` and `Img`, and update
  `Quote.quote.test.ts:15` (it calls `makeQuoteComponents`). The next chunk
  converts the rest; `body.stable-body.test.ts` passes after it.

### 2. The embed boundary

- **What:** an embed keeps its mount through any host change that does not
  change the embed's own `src`, and its DOM activity does not drive the
  host's outline.
- **Why:** the boxholder's direction. Parent to child: a host re-render must
  not remount the embed. Child to parent: the embed's own DOM activity must
  not drive the host's machinery. The boundary does not promise zero
  re-renders: the embed reads `onNavigate` from the render context, so a new
  callback re-renders it in place. That keeps state, which is the
  requirement, without a stable-callback helper. Nor does it isolate layout:
  an embed that legitimately reloads still changes height (*NOT in scope*).
- **Direction:**
  - Parent to child: Track 1 already fixes the type. The embed's element
    position is fixed by the Markdown tree, so React reconciles it in place.
    The DOM test passes `Markdown` a module-constant override map whose `Img`
    is a probe that counts mounts in an effect, re-renders the host with a
    new `onNavigate`, and checks one mount. A probe is used because a real
    `FileView` fetches its data over tRPC, which the harness does not serve.
    The probe test verifies reconciliation, not the production maps. Those
    are module constants (Track 1), so their identity cannot change, and
    `bin/card-remount-check` verifies the real figure embed end to end.
  - Child to parent: the embed renders inside `<div data-card-embed>`.
    `CardContentsMenu`'s `MutationObserver` callback ignores records whose
    target is inside `[data-card-embed]`. Today each d3 redraw (each pick)
    runs `readOutline` over the whole front.
- **Vocabulary lock-ins:** `data-card-embed`.
- **First chunk:** the wrapper and the observer filter, with a DOM test that a
  mutation inside `[data-card-embed]` does not re-read the outline.
  `bin/card-remount-check` passes after Tracks 1 and 2.

### 3. Keep the browser check as a dev command

- **What:** `bin/card-remount-check` stays a standalone command.
- **Why:** the DOM tests hold the remount invariant in the ordinary test tier.
  Only a browser shows the visible symptom (scroll anchoring moving the reader,
  the button expanding), and the command reproduces it in about 10 s.
- **Direction:** no change. It is named in the `Markdown/body.tsx` header as
  the way to see the symptom.
- **First chunk:** none.

## Could this be simpler?

The simplest version is the one-line `WorkspaceCanvas` fix (see *Smallest
fix*). It fails on: a text edit (citations and links still remount, table
row 4), any other host with an unstable callback (`ViewMarkdown`, chat), and
every future factory. The boxholder asked for a boundary, not one cause.
Track 1 is the boundary for the body. Track 2 is the boundary for embeds.

A simpler Track 2 is just `memo` on `Embed`. It leaves the child-to-parent
direction (outline re-reads on each redraw). That costs a few lines, so it
stays.

A smoke step was considered for the browser check. It is not needed: the
DOM tests run in the ordinary suite and catch a remount in the body. Per
§11, the enforcement is the tests; the browser command is for seeing the
symptom.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A component used outside `Markdown` (a test, a dev harness) has no context | Track 1 test | `useMarkdownRender` throws | clear |
| A caller passes a new `components` map each render, so its components remount again | `body.stable-body.test.ts` for `Markdown`'s defaults; none per caller | none in code | silent |
| An embed keeps showing a stale target after the text changes its `src` | Track 2 DOM test: new `src` → new target rendered | no memo on the embed, so it re-renders with the new target | clear |
| The embed override loses the `Img` name, so a standalone embed gains a paragraph wrapper | Track 1 test: a lone `![](…)` embed renders no `.bbx-paragraph` | name kept | silent without the test |
| Context value changes re-render every link (no remount, a render cost) | none | accepted: re-render is cheap; remount was the bug | n/a |
| The browser check's box lacks `_content/`, or it can't find the Pin button | n/a (dev command) | `CheckSetupError` classes | clear |

> **Accepted risk:** a caller passing an unstable `components` map. After
> Track 1 only three callers pass one, and each becomes a module constant.
> `ViewMarkdown` passes a box view's own map; a box view that rebuilds it
> per render would remount its own content. That is the view author's code.

## Agent-flow / user-flow edge cases

- Wrong tag / wrong field: not applicable; no agent-facing vocabulary changes.
- Stale ref: an embed whose target moves re-renders through `FileView`'s own
  live refresh. ADDRESSED: unchanged by this plan.
- Two agents touching the same card: a real text edit still re-renders the
  body. With Track 1 it reconciles in place, and the figure's own sketch
  reloads only when its entry file changes (`FigureView/view.tsx:95`).
  ADDRESSED.
- Hand-edit drift, fabricated values, validation UX: not applicable; no
  written format changes.
- Partial migration: none; frontend-only, ships in one piece.

## NOT in scope

Other places where content remounts or re-renders on unrelated state, found
while tracing. Listed, not fixed:

- `WorkspaceCanvas/view.tsx:43-47`: `onViewStateChange`, `onSelectRenderer`,
  `onMoved`, and `onNavigate` are new on every workspace change, so every
  open card's whole `FileView` tree re-renders (no remount after Track 1).
  A render cost, not a correctness bug.
- Chat messages: during streaming, `Markdown`'s memo rebuilds the component
  map on every token (`children` changes), so every link and citation in the
  streaming message remounts per token. Track 1 fixes this as a side effect.
- `FigureView/view.tsx` remounts the sketch when its params change (*"a param
  change reshapes `figure` and remounts the sketch via the FigureMount key"*).
  Intended: the content changed.
- A legitimate embed reload (its entry file changed) still collapses to
  "Loading" and can shift the reader by scroll anchoring. Reserving the last
  height while loading would prevent it. Considered; not now, because it is
  rare and needs a measured-height store.
- `react-hooks/static-components` does not see components made in factories.
  A lint rule against component factories in `components/Markdown/` is
  possible; not now, because after Track 1 none remain and the DOM test
  catches the behavior.

## Open design questions

None. The embed test's seam was settled in Track 2 (a probe `Img` override).

## Knowledge audits

Skip: no agent-facing concept changes. The rule for developers ("Markdown
components are declared once; read per-render values from
`MarkdownRenderContext`") goes in `components/chat/AGENTS.md`'s workspace
section and in the `Markdown/body.tsx` header comment.

## What will hold this after it ships

- `test/components/Markdown/body.stable-body.test.ts` (DOM harness, ordinary
  suite): a new `onNavigate` or appended text keeps the link, citations, and
  blockquote nodes. Written now; fails until Track 1.
- The Track 2 DOM tests: an embed mounts once across a host re-render, and a
  mutation inside it does not re-read the outline.
- `bin/card-remount-check`: the real-browser symptom on a test box, run by hand.
  No new test tier.

## Implementation order

1. Context, `Link`, `Img`; update `Quote.quote.test.ts`. (Track 1, chunk 1)
2. The remaining Markdown components; drop the factories; caller override
   constants. (Track 1)
3. `data-card-embed`, observer filter, embed DOM tests.
   `bin/card-remount-check` passes. (Track 2)
4. Docs: `Markdown/body.tsx` header, `components/chat/AGENTS.md`.

## Implementation notes

- The `Markdown` memo depends on `children`, `basePath`, `tags`, and
  `bodyLineOffset`. `cardPath` moved to the render context: only `TodoInline`
  and `TodoBlock` read it, and the transform does not.
- `IncludeFile` imports the default `Link` directly, as the old factory was
  handed the default `Link`.
- The embed wrapper is `<div data-card-embed class="contents">`, so it adds
  no box to the layout.
- Verified: `body.stable-body.test.ts` and
  `CardContentsMenu.embed-boundary.test.ts` pass, and the latter fails with
  the observer filter removed. `bin/card-remount-check` passes on the test1
  clone. A pick changed to N survived a pin of the card's tab.

## Rollout shape

Done when `bin/card-remount-check` passes on the worktree's test1 clone, the
DOM tests pass, `pnpm typecheck`, lint, and the
change-selected tests pass, and the manual walk of the repro card (pick
atoms, pin the tab, run an agent turn) keeps the picks. No data changes, no
migration. Frontend only; ships in one piece.
