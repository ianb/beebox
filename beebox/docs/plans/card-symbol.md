---
title: "Cards carry a symbol"
status: draft
workstream: sidecar-shell
issues:
  - ../../../issues/features/2026-09-05-cards-carry-a-symbol.md
  - ../../../issues/bugs/2026-09-05-sidecar-tab-label-never-updates.md
---
# Cards carry a symbol

A card gets a mark: one character — an emoji, usually — optionally on a
coloured ground, that stands for the card wherever it is listed. Landmarks
already have this and no other card does, which is backwards: a mark belongs to
a card, not to one schema.

When I pin a document beside chat, I want its tab to be a mark I recognise
rather than eleven characters of truncated filename, so a row of pinned tabs
reads at a glance. When I skim a browse listing or a recent-files panel, I want
the cards I use often to be findable by their mark. And when I retitle a card,
I want every place showing it to say the new thing.

**Issues addressed:**
[cards-carry-a-symbol](../../../issues/features/2026-09-05-cards-carry-a-symbol.md),
[sidecar-tab-label-never-updates](../../../issues/bugs/2026-09-05-sidecar-tab-label-never-updates.md).
The second is not a side quest: the strip cannot draw a mark it has no way to
read, and the fix for both is the same lookup.

Grepped the queue for adjacent items (`symbol`, `icon`, `favicon`, `emoji`,
`landmark`, `tab label`, `title`). Related but not resolved here:
[disallow-dots-in-card-names](../../../issues/decisions/2026-09-05-disallow-dots-in-card-names.md)
(a filename-grammar decision, independent),
[card-level-prominence](../../../issues/features/2026-06-12-card-level-prominence.md)
and [directory-head-cards](../../../issues/features/2026-06-12-directory-head-cards.md)
(both about which cards matter, not how they are marked — a symbol is not
prominence and must not become a way to spell it).

## Stated preferences this plan trades against

- **Principle 8** (*one way to do each thing*): the driving constraint. There
  are already two unrelated mark systems — four near-duplicate landmark symbol
  renderers, and a type-keyed icon table — and this plan must end with fewer,
  not three.
- **Principle 7** (*hierarchy is a discoverability contract*): a universal card
  field lives in `GLOBAL_CARD_FIELDS`, and the one component that draws it
  lives in `components/ui/`. Anyone looking for either should find it without
  being told.
- **Principle 3** (*validate at boundaries*): a colour arrives as a free-form
  string from a card an agent wrote. It is checked where cards are checked.
- **Principle 6** (*right-sized defensiveness*) and **principle 4** (*resilient
  and never silent*): a malformed colour is cosmetic. It must not refuse to
  load the card, and it must not be silently swallowed either — that is what
  the lint-warning channel is for.
- **beebox/CLAUDE.md**, *keep source and docs generic*: the mark is authored per
  box; nothing here ships a default emoji vocabulary.
- **Most recent shipped precedent**: the sidecar work of 2026-09-05 (compact
  pinned tabs, the persisted strip) — this plan extends that surface and inherits
  its shapes.

## What already exists

- `beebox/src/cards/schema.ts:82-87` — `GLOBAL_CARD_FIELDS`: `title`,
  `contains`, `contains-evidence`, `todos`. **Reuse.** This is the universal
  field mechanism; the loop at `:340` records them per schema and skips any name
  the schema declares itself ("schema-wins"), so a type could still override.
- `beebox/src/core/card-io.ts:126-133` — frontmatter validation via
  `schema.frontmatterSchema.safeParse`. A missing required field or a wrong type
  is a hard `CardIOError`.
- `beebox/src/core/card-lint.ts:319-346` — `unknownKeyWarnings()`: an
  undeclared frontmatter key is stripped in memory and reported as a lint
  warning, never an error. **Reuse** — this is the channel a bad colour uses.
- `beebox/src/schemas/landmark.ts:38` — `LandmarkSymbol` is
  `z.union([z.string(), z.object({ src: z.string() })])` under
  `navigation.symbol`. **Rebuild as two universal fields** (see Track A).
- `beebox/src/core/landmark/symbol.ts` — `readLandmarkSymbol()` already splits
  that union into `{ text, src }` and resolves `src` through `resolveRefPath`,
  refusing a path that escapes the box. **Reuse the resolution, retire the
  union-reading.**
- `beebox/src/webapp/trpc/routers/landmarks.ts:32-52,78-119` — `LandmarkPayload`
  carries `symbol: string` and `symbolSrc: string | null` on the wire. **Reuse
  the wire shape**; the plan makes the card's own fields its source.
- Four near-duplicate renderers, all `symbolSrc ? <img> : <span>{symbol || "📍"}</span>`
  at different sizes: `components/landmarks/LandmarkSection.tsx:221-245`
  (the only one imported elsewhere — `pages/browse/components/BrowseLandmarkHeader.tsx:28`),
  `components/session-pickers/ChatsLandmarkCard.tsx:98-116`,
  `components/PlacePill-panels.tsx:38-52`, and `components/PlacePill.tsx:70-87`
  (which renders nothing rather than 📍 when the symbol is empty — the four do
  not even agree on the fallback). **Replace all four.**
- `components/DocumentIcon.tsx:69-74` + `src/shared/favicon.ts:34-40` — turns a
  landmark's mark into the browser tab's favicon via `emojiFaviconUri`, an SVG
  `<text>` with no colour. **Reuse**; it is the existing proof that the mark has
  to stay text to survive into a title.
- `src/frontend/src/file-type-registry.ts:158-178` (`resolveFileTypeUI`),
  `file-types/builtins.tsx:23-52`, `file-types/icons.tsx:32-86` — the *other*
  mark system: card **type** → one of seven fixed SVG glyphs. Its only consumer
  is `components/ui/FileEntry.tsx:152-170`, which already has an icon slot.
  **Reuse the slot, add a per-instance override in front of it.**
- `components/ui/Badge.tsx:16-23` — the chip primitive, but its tones are five
  fixed background/text pairs. **Reuse the sizing and shape conventions, not the
  `tone` mechanism**: an arbitrary per-card colour cannot be a Tailwind class.
- `components/chat/sidecar-tabs.ts` (the `open` case) and
  `components/chat/InteractiveChat-controls.tsx:131-230` — the strip, its
  `SidecarTab` shape, and the compact pinned tab that prompted this. **Reuse.**
- Validation precedents for a syntactically-constrained string:
  `src/schemas/procedure.ts:19` (Zod `.regex()` with a plain-English message),
  `src/schemas/scheduled-script-fields.ts:19-45` (`.refine()` running a real
  parser), `src/schemas/question.ts:112`. **Follow the regex form.**
- Searched for an existing CSS-colour validator anywhere in `src/` and **found
  nothing**; searched for any card field holding a colour and **found nothing**.
  This plan introduces the first one.
- `src/webapp/trpc/routers/files.ts` — **`files.summarize`**: a batch endpoint
  taking up to 200 paths and returning `FileSummary` records
  (`src/core/file-summary.ts:13` — `{ path, type, title, contains, attrs }`,
  with `title` already computed by the per-type loader and falling back to the
  filename). **Reuse and extend.** A first draft of this plan proposed a new
  `cards.identity` procedure after searching for the wrong words; that would
  have been a second endpoint answering a question this one already answers.
- `src/schemas/landmark.ts:121-131` — `landmarkFields` / the standalone
  `LandmarkObject` used by "lightweight readers (the landmarks router,
  triage-instructions, etc.) that parse a landmark file directly rather than
  through the card loader. Unknown keys (global card fields, a stray `type:`)
  are stripped." **This is the obstacle to the landmark fold** — see Track D.
- `src/cards/schema.ts:286-296` — `InferCardFields` carries a **second,
  hand-written list** of the global fields at the type level. A field added to
  `GLOBAL_CARD_FIELDS` alone exists at runtime and not in any card's inferred
  type. Two shipped plans already recorded this trap
  (`docs/implemented-plans/todo-annotation.md:292`,
  `docs/implemented-plans/chat-review.md:432`); this plan will not be the third
  to rediscover it.
- `src/core/lint-path-fields.ts:67` — the inventory of frontmatter fields that
  hold box paths, which today knows `navigation.symbol.src` and `entry`. A
  universal `symbolSrc` has to be added here or it silently escapes the
  path-rewriting and lint that every other ref gets.

## Prior art (external)

- Browser pinned tabs are the model the boxholder named: Chrome and Firefox
  shrink a pinned tab to its favicon alone and keep pinned tabs left of the
  scrolling strip. Neither disambiguates duplicate favicons — two pinned tabs
  from one site look identical, and the tooltip carries the difference. This
  plan deliberately goes further (an abbreviation on collision), so the
  behaviour is ours to define and ours to keep stable.
- **Emoji are not one character.** A "single emoji" can be several code points
  (ZWJ sequences, skin-tone modifiers, flags), so `.length` and `[0]` are the
  wrong tools; `Intl.Segmenter` with `granularity: "grapheme"` is the current
  platform answer and is available in every browser we target and in Node 20+.
  Cited because the naive `symbol.slice(0, 1)` truncation is exactly the bug
  this footnote prevents ([MDN: Intl.Segmenter](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter)).
- **`CSS.supports("color", value)`** is the one honest browser-side colour
  validator, and it does not exist in Node, so a card validated on the server
  cannot use it ([MDN: CSS.supports](https://developer.mozilla.org/en-US/docs/Web/API/CSS/supports_static)).
  A regex over the syntaxes we mean to accept is the portable option; the plan
  takes it and accepts that it is narrower than CSS.
- React sets inline styles through CSSOM property assignment rather than by
  concatenating declaration text, so an arbitrary string in
  `style={{ backgroundColor: value }}` cannot inject a second declaration — an
  invalid value is dropped by the browser. This covers declaration injection and
  nothing else: the `background` shorthand would still accept a `url(…)`, which
  is why Track A assigns the longhand properties only.
- Searched for prior art on "abbreviate a title into initials" as a named
  pattern and **found nothing worth citing** — it is chat-app avatar behaviour
  (Slack, Google), consistently "initials of the first two words", which is what
  Track C adopts.

## Tracks / scope

### Track A — the field, and one component that draws it

**What.** Four optional universal fields, and a single `CardMark` component that
is the only place in the app that turns them into pixels. The four landmark
renderers are deleted in favour of it.

**Why this needs to change.** A mark is a property of a card; today only one
schema can have one, and the code that draws it exists four times with three
different fallbacks. Adding a fifth copy for the sidecar would be the wrong
answer to the boxholder's ask.

**Direction.**

```ts
// beebox/src/cards/schema.ts — GLOBAL_CARD_FIELDS
symbol: z.string().optional(),            // the mark: text, usually one emoji
symbolSrc: z.string().optional(),         // a box ref to an image, for marks text can't carry
symbolForeground: z.string().optional(),  // any CSS colour; hsl() preferred
symbolBackground: z.string().optional(),
```

Two fields rather than landmark's `string | { src }` union, because agents
author these: a union asks the author to know two shapes for one idea, it cannot
be lint-checked per key, and the wire already splits it
(`landmarks.ts:32-52`). The union is what makes landmarks special; splitting it
is what stops them being special.

`CardMark` (`components/ui/CardMark.tsx`) takes
`{ symbol, symbolSrc, foreground, background, size, boxSlug, fallback }` and
renders, in order: the image when `symbolSrc` resolves; else the symbol's
**first grapheme** (`Intl.Segmenter`, not `[0]`) on the coloured ground; else
`fallback` — which callers supply (📍 for a landmark tile, the type icon for a
file row, initials for a tab), because the four current copies disagreeing about
📍 is a symptom of the fallback belonging to the caller, not the mark.

**This is not a one-edit change.** Four places move together: the runtime
declaration (`GLOBAL_CARD_FIELDS`), the hand-written type list in
`InferCardFields` (`schema.ts:286-296`) or every typed reader silently cannot
see the fields, the enumerations in `docs/adding-schemas.md:72` and the
`bbx-guide-schemas` skill, and `test/core/search/contains-evidence.doctest.md:31`,
which asserts today's global-key set.

Colour handling, stated honestly:

- The **type** is `z.string().optional()`, so a non-string value (`symbolBackground: 3`)
  is a hard load error like every other mistyped field. That is the existing
  contract and this plan does not carve an exception into it. Note for authoring:
  an unquoted `#3a7` is a YAML **comment**, so hex needs quotes — a lint warning
  catches the resulting empty value.
- An invalid colour *string* is a **lint warning** (`card-lint.ts`'s channel)
  and is ignored at render. Cosmetic input does not get to make a card
  unreadable (principle 6), and does not get to fail silently either
  (principle 4).
- `isCssColour()` (`src/shared/css-colour.ts`) accepts **four forms and
  nothing else** (boxholder, 2026-09-05 — "anything else is weird"):
  `#rgb`, `#rrggbb`, `hsl(…)`, `rgb(…)`. No named colours, no `hsla()`/`rgba()`
  spellings (both functions take an optional alpha inside the modern syntax),
  no `color-mix()`, `lab()`, `oklch()`. This is far narrower than CSS on
  purpose: the only complete validator is `CSS.supports()`, which does not
  exist in Node, so a server-side check that claimed completeness would be
  lying. The lint message lists the four accepted forms rather than saying the
  value is invalid CSS.
- The renderer assigns **`color` and `backgroundColor` only** — never the
  `background` shorthand, which accepts images and URLs and is a different
  failure surface than the one the inline-style note below covers.

**Vocabulary lock-ins.** The four field names above; `CardMark`;
`isCssColour`; "mark" as the word for the rendered thing and "symbol" for the
field.

**First implementation chunk.** The four fields in `GLOBAL_CARD_FIELDS` plus
`isCssColour` and its lint warning, with a doctest for the validator and one for
"a card with a symbol round-trips through parse and reserialize". No UI.

### Track B — one source of card identity, live

**What.** A tRPC procedure that answers "for these paths: title, symbol,
symbolSrc, colours", invalidated on `file-change`. Every surface that lists
cards it has not loaded uses it.

**Why this needs to change.** The sidecar strip holds a path and a string
captured when the tab opened; only an activated tab fetches its card. So a
pinned tab restored from `sessionStorage` has no title and no symbol, and
retitling a card leaves its tab saying the old thing while the body below it
updates — [the filed bug](../../../issues/bugs/2026-09-05-sidecar-tab-label-never-updates.md).
A mark drawn from the open-time label would be stale in exactly the same way.

**Direction.** Extend what exists rather than adding a parallel endpoint:
`FileSummary` (`src/core/file-summary.ts:13`) gains the mark fields, and
`files.summarize` — already batched, already capped at 200, already returning a
computed `title` with a filename fallback — carries them. The frontend gets a
`useCardIdentities(paths)` hook over that procedure which subscribes to
`file-change` for the paths it holds and invalidates just those, the same bus
subscription `FileView` uses (`components/file-view-data.ts`).

Adding fields to `FileSummary` touches every loader that builds one, so the
first chunk is the type plus the generic fallback path; per-type loaders inherit
the fields without changes because the marks come from frontmatter, not from
per-type attrs.

The tab's stored `label` stops being the display name and becomes what it always
was — the text the link that opened it used — a *fallback* for a card whose
identity has not arrived yet. The persisted strip keeps the last known title so
a restored strip is not blank for a beat.

**Vocabulary lock-ins.** The mark fields on `FileSummary`; `useCardIdentities`.

**First implementation chunk.** The `FileSummary` fields and their extraction,
plus a route doctest over `files.summarize`: three paths with one missing, a
card with no symbol, and a card with no title (the existing filename
fallback).

### Track C — the strip: mark, abbreviation, ambiguity

**What.** A pinned tab shows its mark alone when that mark is unique among the
pinned tabs; the mark plus a short abbreviation when it is not; the abbreviation
alone when the card has no mark. Unpinned tabs show the live title with the mark
beside it.

**Why this needs to change.** This is the ask. A compact pinned tab currently
shows eleven characters of truncated display name, which is neither a name nor a
mark.

**Direction.** Two pure functions in `components/chat/tab-identity.ts`:

```ts
export function abbreviateTitle(title: string): string;   // "Acids Bases Lesson Plan" → "AB"; "Bread" → "Br"
export function markAmbiguity(tabs: SidecarTab[]): ReadonlySet<string>;  // symbols worn by more than one PINNED tab
```

Ambiguity is computed over the **pinned set only**. That is what keeps a card's
face stable: the pinned set changes when you pin, unpin, or close a pinned tab —
all deliberate acts — whereas the open set churns every time you follow a link.
A mark that changed because you opened something unrelated would make identity
depend on what else is on screen.

`abbreviateTitle` takes the initials of the first two words, or the first two
graphemes of a single word, uppercased — the chat-avatar convention. It runs on
the *title*, which Track B is what makes available.

What this does **not** settle: the boxholder also asked about abbreviating "when
they don't fit", which is the unpinned tab's problem and is CSS truncation
today. Treat the rule above as the first pinned-tab behaviour to live with and
browser-test, not as the final answer to every title-fit case.

**Vocabulary lock-ins.** `abbreviateTitle`, `markAmbiguity`, and the rule that
ambiguity is pinned-scoped.

**First implementation chunk.** The two pure functions and their doctest,
including the cases that matter: two pinned tabs sharing 🍳, a pinned tab whose
card has no symbol, a title of one word, a title that is a single emoji, and an
unpinned tab sharing a symbol with a pinned one (not ambiguous — different set).

### Track D — landmarks stop being the special case

**What.** `navigation.symbol` folds into the card's own `symbol`/`symbolSrc`.
The landmark schema loses its copy, `readLandmarkSymbol` reads the card fields,
and the four renderers become `CardMark`.

**Why this needs to change.** It is half the ask, and it is what makes the
universal field true rather than merely additional. Leaving both would give the
box two spellings of one idea (principle 8).

**Direction.** A migration moves `navigation.symbol` on every landmark card:
a string becomes `symbol:`, a `{ src }` becomes `symbolSrc:`, both at the card's
top level. `LandmarkPayload` keeps its wire shape, so no frontend component
changes for the fold itself — they change because they are being replaced by
`CardMark`. The landmark schema keeps `navigation.label`, `links`, `expand`.

**The obstacle, which is most of this track's work.** Landmarks are not read
through the card loader in the paths that matter: `landmarkFields` /
`LandmarkObject` (`src/schemas/landmark.ts:121-131`) is a standalone object
schema whose own doc comment says unknown keys — "global card fields" among them
— are **stripped**, and `loadLandmarkPayload`
(`src/webapp/trpc/routers/landmarks.ts:104`) reads `fields.navigation` alone.
`core/landmark/summaries.ts` and `core/landmark/box-identity.ts` follow the same
pattern. A migrated landmark carrying a top-level `symbol:` would therefore
render as *no symbol at all* until each of those readers learns the card's own
fields. So the order within this track is: teach the lightweight readers first,
then migrate, then delete the nested field — not the other way round.

**Vocabulary lock-ins.** None new; this track removes one.

**First implementation chunk.** The migration script plus a doctest over a
fixture box holding one text landmark, one `{ src }` landmark, and one with no
symbol.

## Could this be simpler?

**The simplest version** is Track A's `symbol` field alone, drawn only in the
sidecar strip, with no colours, no `symbolSrc`, no identity endpoint, and
landmarks left as they are. Perhaps a day's work.

What the fuller plan buys, in order of how much it buys:

- **Track B is not optional.** Without it the strip has nothing to draw: a
  pinned tab that has never been activated has no card data at all. The simple
  version would have to fetch each open card in full, or draw marks only on tabs
  you have already clicked — which is the opposite of what a pinned tab is for.
- **Track D is the ask**, not scope creep: "landmark should not be a special
  case" was the direction. Skipping it leaves two spellings.
- **Colours are the most cuttable thing here.** They are cosmetic, they
  introduce the app's first free-form colour input, and everything else works
  without them. They stay because the boxholder asked, and because the
  validate-then-warn shape is small — but if the plan has to shrink, this is the
  cut.
- **`symbolSrc` is not extra work**; it is the existing landmark image form,
  which Track D has to carry somewhere.

**Rejected as over-built:** a per-card colour *palette* (a theme, rather than
two colours); marks on directories as well as cards; a symbol picker UI — the
field is authored in the card, like every other field; and any attempt to derive
a mark automatically from the card's type or title, which would make every card
wear one and turn the signal off.

## Subplans

None. Four tracks, each one surface, with a settled shape.

## Failure modes

> **Critical gap:** a card whose `symbol` holds a long string — an agent writes
> `symbol: "recipe"` — would stretch every row and tab that draws it, silently,
> in every surface at once. Closed by `CardMark` rendering the first *grapheme*
> only (never the raw string) and by a lint warning when the value is more than
> one grapheme, so the author finds out.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `symbol` holds a word, not a mark | yes — `CardMark` doctest + lint doctest | yes — first grapheme rendered, lint warning | clear |
| A multi-code-point emoji is cut mid-sequence into a replacement box | yes — grapheme doctest (ZWJ family, flag, skin tone) | yes — `Intl.Segmenter` | would be visible garbage; tested |
| `symbolBackground` is not a colour | yes — `isCssColour` doctest | yes — ignored at render, lint warning | clear |
| A valid colour makes the mark unreadable (dark on dark) | no | no — accepted; the author picked both | visible to the author immediately |
| `symbolSrc` points outside the box | yes — existing `readLandmarkSymbol` doctest | yes — refused, resolves to null | clear (logged) |
| `cards.identity` is asked for 200 paths at once | no | partly — it is a per-path read; the caller (the strip) is capped at 12 unpinned + pinned | silent until slow; see open question 2 |
| A card is deleted while its tab is open | yes — route doctest (missing path omitted) | yes — the tab keeps its fallback label | clear |
| Identity arrives after first paint, so the strip visibly re-labels | no automated test | yes — the persisted strip carries the last known title | visible flicker; browser-checked |
| The landmark migration runs twice | yes — migration doctest | yes — idempotent (no `navigation.symbol` left to move) | clear |
| A migrated landmark loses its mark because a lightweight reader strips global fields | yes — landmarks-router doctest over a migrated fixture | yes — Track D teaches the readers before migrating | would be silent (a landmark simply renders 📍); tested |
| A universal `symbolSrc` escapes path lint and path rewriting | yes — lint doctest | yes — `lint-path-fields.ts:67` gains the field | would be silent (a moved image quietly 404s) |
| A field added to `GLOBAL_CARD_FIELDS` but not to `InferCardFields` | yes — a typed-read doctest | yes — both edited in A1 | silent at the type level; two prior plans hit it |
| A box on the server has a landmark form the migration does not expect | no | no | **would be silent** — the migration reports what it changed and what it skipped, and the skip list is the check |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — GAP worth naming: `symbol` and `symbolSrc` are
  adjacent, and an agent handed an image path may write it into `symbol`. A
  `symbol` value that looks like a path (contains `/` or ends in an image
  extension) gets its own lint warning naming `symbolSrc`.
- **Stale ref** — ADDRESSED: `symbolSrc` resolves through `resolveRefPath` and
  yields null when the target is gone (`core/landmark/symbol.ts`); `CardMark`
  falls back.
- **Two agents touching the same card** — ADDRESSED: `symbol` is one scalar in
  frontmatter; the existing card-lock discipline covers it.
- **Hand-edit drift** — ADDRESSED: the boxholder typing `symbol: 🍳` by hand is
  the intended authoring path; the lint warnings above are what catch a typo.
- **Fabricated free-form value** — this is the real risk. Nothing stops an agent
  giving every card it writes a different emoji, and a box where everything is
  marked is a box where nothing is. Handled as authoring guidance, not
  validation (see Knowledge audits) — a rule that says *most cards have no
  symbol*.
- **Validation error UX** — ADDRESSED: the lint warnings name the field and say
  what to write instead, in the channel agents already see on save.
- **Partial migration / transition state** — ADDRESSED: during Track D some
  landmark cards carry `navigation.symbol` and some carry `symbol`;
  `readLandmarkSymbol` reads the new field and falls back to the old one until
  the migration has run everywhere, then loses the fallback.

## NOT in scope

- **Browse rows, both `FileView` headers, the browse detail panel, and landmark
  link tiles** — every one of them has room for a mark and none of them has one
  today. Deferred deliberately: each wants its own layout judgment, and adding
  five surfaces at once is how a mark becomes noise before anyone has lived with
  it. `FileEntry` is the exception and is in scope, because it is the shared list
  row and it already has the icon slot the per-instance override has to win.
- **Replacing the type-icon table** (`file-type-registry.ts`). The card's mark
  wins where it exists; where it does not, the type icon stays exactly as it is.
- **A symbol on directories** — a directory is not a card and has no
  frontmatter. The landmark of a directory is the existing answer.
- **`symbolSrc` beyond carrying the landmark form forward** — no new image
  authoring, no upload flow, no sizing story.
- **Colour in the browser favicon** — `emojiFaviconUri` stays as it is; a title
  and a favicon take the character, not the ground.
- **The filename-grammar decision**
  ([disallow-dots](../../../issues/decisions/2026-09-05-disallow-dots-in-card-names.md))
  — unrelated, and not a prerequisite.

## Open design questions

1. **Does the image form (`symbolSrc`) belong in this plan at all?** *(needs the
   boxholder)* The decision was "text only, for now", and the issue parks the
   image form as a separate question — but "landmark should not be a special
   case" pulls the other way, and the image form is **in use**: ten-plus
   landmark cards in one of the boxholder's own boxes carry the `{ src: … }`
   form today, so dropping it would break real cards. So the
   options are (a) universal `symbolSrc`, which is what this plan assumes and
   what fully retires the special case; (b) text-only universal `symbol`, with
   landmarks keeping a private nested field for images — a smaller plan that
   leaves a residual special case; or (c) drop image symbols, which breaks real
   cards and is not on the table. Lean: (a), because (b) leaves the exact thing
   the ask wanted gone. This is the one question that changes the plan's shape.
2. **Does `symbol` deserve a per-type default?** A `question` card with no
   symbol could fall back to a type mark rather than the SVG glyph table. Lean:
   no, not in this plan — it is the "every card wears one" failure in a
   different costume, and the type icon already covers the case.
3. **Whether an unpinned tab draws the mark at all.** It has room for the title,
   so the mark is decoration there rather than identification. Lean: yes, small
   and leading — it is what teaches the mark before you pin anything — but this
   is the first thing to try both ways in the browser.
4. **`files.summarize` already caps at 200 paths**, which the strip never
   approaches. The deferred surfaces (browse listings) could. Lean: leave the
   cap alone and let a surface that needs paging bring it when it lands.

## Knowledge audits

Required: this adds agent-facing vocabulary. Agents write most cards, so the
value of the field depends entirely on their restraint with it.

- `knows_directly`: a box agent, asked "when should a card you write have a
  `symbol`?", answers that most cards should not — that a symbol is for a card
  returned to often, and that a box where every card has one has none.
- `knows_directly`: asked how to give a card an image mark, the agent names
  `symbolSrc` rather than putting a path in `symbol`.

Both land in `beebox/src/dev/knowledge-audits.yaml` **and are run**
(`pnpm knowledge-audit run --box <absolute path to a test box> --filter card-symbol`),
with the status recorded — an audit that has never run is unverified in both
directions.

## What will hold this after it ships

- **`test/frontend/tab-identity.doctest.md`** — `abbreviateTitle` and
  `markAmbiguity`. Cheap, pure, and the place the ambiguity rule is written down
  executably.
- **`test/cards/card-symbol.doctest.md`** — the universal fields parse,
  reserialize in schema order, and survive a card that declares none of them;
  `isCssColour` accepts `hsl(210 40% 50%)`, `#3a7`, `#33aa77`, `rgb(1 2 3)` and
  rejects `rebeccapurple`, `hsla(…)`, `color-mix(…)`, `javascript:…`, `#3a7f`,
  and an empty string.
- **`test/cards/card-lint-symbol.doctest.md`** — the three warnings: a
  multi-grapheme symbol, a bad colour, a path-shaped symbol.
- **`test/webapp/routes/cards-identity.doctest.md`** — the batch read, including
  a missing path and a card with no title.
- **A migration doctest** over a fixture box for Track D, run before and after,
  asserting idempotence.
- **`bin/browse` verification** for what no doctest reaches: two pinned tabs
  sharing a symbol show abbreviations, a unique one shows the mark alone,
  retitling a card updates its tab without a reload, and a coloured mark renders
  its ground.
- No new test tier and no new mock.

## Implementation order

1. **A1** — the four fields in `GLOBAL_CARD_FIELDS`, `isCssColour`, the lint
   warnings, and their doctests. Nothing renders yet.
2. **A2** — `CardMark`, with the grapheme rule and caller-supplied fallback.
3. **D1** — the lightweight landmark readers (`LandmarkObject`,
   `loadLandmarkPayload`, `summaries.ts`, `box-identity.ts`) learn the card's own
   fields, with `readLandmarkSymbol` preferring them and falling back to
   `navigation.symbol`. Nothing has moved yet, so this chunk changes no output.
4. **D2** — the migration; then the four landmark renderers become `CardMark`,
   the landmark schema drops its nested `symbol`, and the fallback is removed.
5. **B1** — the `FileSummary` mark fields and the `files.summarize` doctest.
6. **B2** — `useCardIdentities`, the strip's labels become live, the persisted
   strip carries the last known title. **This is where the stale-label bug
   closes**, before any mark is drawn in the strip.
7. **C1** — `abbreviateTitle` / `markAmbiguity` and their doctest.
8. **C2** — the strip renders marks by the Track C rules.
9. **D3** — `FileEntry`'s icon slot prefers the card's mark over the type icon.
10. **Knowledge audits written and run**; then a cross-model review before
    calling it done.

## Rollout shape

Tests first for A1, B1, C1 and the migration — in all four the decision is the
artifact.

**Done when:** the doctests above pass; `pnpm typecheck` and `pnpm exec eslint`
are clean on the touched files; the four `bin/browse` checks pass on a box with
at least two pinned tabs sharing a symbol; the knowledge audits have been run
and their status recorded; `bin/smoke` passes at `/finish`.

**Migration.** One scripted, idempotent pass over landmark cards, per
`docs/migrations.md` — it runs to completion or not at all, and reports both what
it moved and what it skipped, because the skip list is the only way an
unexpected landmark form on the server becomes visible. Every other field is
additive: a card with no symbol is exactly a card as it is today.
