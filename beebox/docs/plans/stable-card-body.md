---
title: "A card body does not remount when only its surroundings change"
status: draft
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
| 1. Fixed component types in `Markdown` | ~260 source, ~40 test |
| 2. The embed boundary | ~70 source |
| 3. Remount check in smoke | ~30 (plus the ~190-line `bin/card-remount-check.ts` already written) |

About 600 changed lines in total. Well under the 2,000-line BIG CHANGE line.

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
  existing rule covers what remains. Track 3 adds a behavior check.
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
- No DOM test environment exists. Frontend component tests use
  `renderToStaticMarkup` (`test/components/MarkdownCardView.markdown-card-view.test.ts:10`),
  which cannot observe a remount. `bin/smoke` drives a real browser on a real
  box (`docs/testing/smoke.md`). Reuse it for the behavior check.

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
  - `components/Markdown/render-context.ts`: `MarkdownRenderContext =
    createContext<MarkdownRender | null>(null)` and
    `useMarkdownRender(): MarkdownRender`, which throws when it is missing.
  - `makeLink`, `makeImg`, `makeQuoteComponents`, `makeSourceComponents`,
    `makeTodoComponents`, `makeSeeAlsoComponent`, `makeIncludeFileComponent`,
    and `makeEmbedComponents` become exported components (`Link`, `Img`,
    `QuoteInline`, …, `EmbedImg`) that call `useMarkdownRender()`.
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
  `Quote.quote.test.ts:15` (it calls `makeQuoteComponents`). The check still
  fails because of the embed. The next chunk converts the rest.

### 2. The embed boundary

- **What:** an embed is isolated from its host card in both directions.
- **Why:** the boxholder's direction. Parent to child: a host re-render must
  not remount or re-render the embed. Child to parent: the embed's own DOM
  activity must not drive the host's machinery.
- **Direction:**
  - Parent to child: `EmbedImg` renders `<Embed target={…} caption={…} />`, a
    `memo` component whose props are the resolved target fields only. It
    reads `onNavigate` from the context when a link inside it is followed,
    so a new callback does not re-render it.
  - Child to parent: the embed renders inside `<div data-card-embed>`.
    `CardContentsMenu`'s `MutationObserver` callback ignores records whose
    target is inside `[data-card-embed]`. Today each d3 redraw (each pick)
    runs `readOutline` over the whole front.
- **Vocabulary lock-ins:** `data-card-embed`.
- **First chunk:** `Embed` plus the wrapper and the observer filter.
  `bin/card-remount-check` passes after this chunk.

### 3. The check runs before merges

- **What:** `bin/smoke` runs the pin/unpin remount step from
  `bin/card-remount-check.ts` against its box.
- **Why:** there is no DOM test tier. The smoke walk is the existing tier that
  drives a real browser, and it runs before any merge touching deployed paths.
- **Direction:** move the fixture, the page scripts, and the verdict into
  `bin/card-remount-check.ts` exports. `bin/smoke.ts` calls them as one step
  with a smoke failure class. The standalone command stays for debugging.
- **First chunk:** the step, about 5 s of extra smoke time.

## Could this be simpler?

The simplest version is the one-line `WorkspaceCanvas` fix (see *Smallest
fix*). It fails on: a text edit (citations and links still remount, table
row 4), any other host with an unstable callback (`ViewMarkdown`, chat), and
every future factory. The boxholder asked for a boundary, not one cause.
Track 1 is the boundary for the body. Track 2 is the boundary for embeds.

A simpler Track 2 is just `memo` on `Embed`. It leaves the child-to-parent
direction (outline re-reads on each redraw). That costs a few lines, so it
stays.

Track 3 could be left out, with the standalone command run by hand. Then the
next factory regresses silently. Per §11, enforcement beats convention.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A component used outside `Markdown` (a test, a dev harness) has no context | Track 1 test | `useMarkdownRender` throws | clear |
| A caller passes a new `components` map each render, so embeds remount again | smoke step (Track 3) catches it for cards | none in code | silent until smoke |
| `Embed` keeps showing a stale target after the text changes its `src` | Track 1 test: same text, new src → new target | memo compares target fields | clear (new figure appears) |
| Context value changes re-render every link (no remount, a render cost) | none | accepted: re-render is cheap; remount was the bug | n/a |
| Smoke box lacks `_content/` or the step can't find the Pin button | the check's setup errors | `CheckSetupError` classes | clear |

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
  possible; not now, because after Track 1 none remain and smoke catches the
  behavior.

## Open design questions

- **Track 3 placement.** Lean: a smoke step. The alternative is a manual dev
  check only. Smoke writes three fixture files into its box; the smoke box is
  a test box, so that is acceptable. Needs the boxholder's yes, since it adds
  about 5 s to every smoke run.

## Knowledge audits

Skip: no agent-facing concept changes. The rule for developers ("Markdown
components are declared once; read per-render values from
`MarkdownRenderContext`") goes in `components/chat/AGENTS.md`'s workspace
section and in the `Markdown/body.tsx` header comment.

## What will hold this after it ships

- The smoke step (Track 3) is the behavior anchor: pin and unpin the tab of a
  card being read; the figure, picker, and citation keep their DOM nodes.
- A tap test in `test/components/Markdown/` renders `Markdown` with
  `renderToStaticMarkup` to confirm the context wiring and the
  missing-context error. It cannot observe remounts; that is the smoke step's
  job. No new test tier.

## Implementation order

1. Context, `Link`, `Img`; update `Quote.quote.test.ts`. (Track 1, chunk 1)
2. The remaining Markdown components; drop the factories; caller override
   constants. (Track 1)
3. `Embed`, `data-card-embed`, observer filter. `bin/card-remount-check`
   passes. (Track 2)
4. The smoke step. (Track 3)
5. Docs: `Markdown/body.tsx` header, `components/chat/AGENTS.md`.

## Rollout shape

Done when `bin/card-remount-check` passes on the worktree's test1 clone, the
smoke walk passes with the new step, `pnpm typecheck`, lint, and the
change-selected tests pass, and the manual walk of the repro card (pick
atoms, pin the tab, run an agent turn) keeps the picks. No data changes, no
migration. Frontend only; ships in one piece.
