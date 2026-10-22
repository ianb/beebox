---
title: "A place shows the person's cards"
status: implemented
workstream: place-shows-cards
issues:
  - ../../../issues/closed/bugs/2026-10-09-place-page-says-nothing-here-while-the-folder-holds-cards.md
  - ../../../issues/decisions/2026-10-08-structured-card-front-hides-its-facts.md
  - ../../../issues/closed/features/2026-10-09-place-page-tiles-omit-the-card-summary.md
  - ../../../issues/closed/bugs/2026-10-08-chat-card-embed-puts-every-field-before-the-body.md
---
# A place shows the person's cards

Arrival opens a place page, and in the October walks that page often said
"Nothing here yet" while the folder held the person's cards. This plan gives
each place an agent-written summary (the landmark card's new body), a fallback
list of the place's ordinary cards, and a one-line summary under each card's
title on tiles, card pages and chat embeds.

**Issues addressed:** the four in the frontmatter. Related, not closed:

- [Browse, plate, and folder counts disagree](../../../issues/bugs/2026-10-08-browse-and-plate-counts-do-not-name-what-they-count.md):
  not changed here. The Browse folder count stops at nested places if taken
  from the place walk, so it needs its own design (plan review finding 5).
- [Collection views are badly defined](../../../issues/features/2026-08-19-collection-views-are-badly-defined.md):
  "Also here" is a fallback list, not a collection view.
- [A course needs a learner-facing study home](../../../issues/features/2026-09-21-course-study-home-last-next-uncertain.md):
  a course landmark's body can say last, next, and uncertain. This plan does
  not add course-specific guidance.
- [Fold search and browse summaries onto summarize](../../../issues/code-quality/2026-09-20-fold-search-and-browse-summaries-onto-summarize.md):
  Track B adds two more `summarize` consumers. It does not fold the existing
  hand-written ones.

Queue searches run (`bin/issues search`): "landmark body", "place page",
"summarize", "No body content", "where things stand", "entry-point",
"folder count", "Go to", "openers disabled". No duplicate was found.

Two faults from the same walks are outside this plan: the "The open chat is
in another place" wording read as an error (A row 24, D-2 rows 40-41), and A's
openers stayed disabled after one use (A row 46). Both were already filed and
fixed:
[place-go-to-line-reads-as-an-error](../../../issues/closed/bugs/2026-10-09-place-go-to-line-reads-as-an-error.md),
[place-page-openers-stay-disabled-after-one-send](../../../issues/closed/bugs/2026-10-09-place-page-openers-stay-disabled-after-one-send.md).

## Decisions from the boxholder (2026-10-11)

- Keep landmark arrival and keep improving it: *"I think it's worth
  experimenting with a bit longer."*
- Agent-written landing text, as the landmark body: *"Let's try them, yes.
  They could just be the landmark body."*
- The fallback list and the summary line were the planner's leans in the same
  exchange; "try them" is read as accepting both. Plan review confirms.

## Design

### Situations

- When Tomas opens Lending one evening, I want a few lines that say who has
  what and what is due, so I can answer "is the stove back?" without opening
  five cards.
- When Juni comes back the day after starting the box, I want the first page
  to show the three things she made, so she knows the box kept them.
- When Wren picks Chemistry after a week away, I want the place to say where
  she left off and what is next, so she can start without asking.
- When Priya scans the Inventory place, I want each tile to say where the item
  is and how many, so she can find the tray without opening each card.
- When Priya opens one inventory item, I want its location and quantity on
  the card, so she does not see "No body content" and look for the facts.
- When Wren asks in chat "show me what you've recorded", I want the summary
  and the prose first, so the answer reads as an answer.
- When Tomas has rewritten a sentence of the Lending summary himself, he does
  not want the agent to rewrite it on the next change. (The quiet case.)
- When Priya returns to a chat where she had cards open, she does not want a
  place page pushed over them. Arrival already stays quiet here; this plan
  keeps that.

### Right place, right time

| Situation | Act, show, or quiet | Surface and card | Attention |
|---|---|---|---|
| Tomas, Lending | Show | Place page: the landmark body at the top | Waits to be found |
| Juni, next day | Show | Root place page: "Also here" lists her cards | Waits to be found |
| Wren, Chemistry | Show | Chemistry place page body | Waits to be found |
| Priya, Inventory tiles | Show | Tile: title, then the type's summary line | Waits to be found |
| Priya, one item | Show | Card front: location and quantity above the empty body | Waits to be found |
| Wren, chat embed | Show | Embed: title, summary line, body, then fields | She asked |
| Tomas's own words | Quiet | The agent keeps his sentence | Nothing new |
| Priya, saved cards | Quiet | Her saved arrangement, unchanged | Nothing new |

The agent writes the body when it makes a place, and updates it in the same
turn whenever it changes what the place holds. That is the moment the agent
knows what changed. A later reactor pass would have to rediscover it.

### Spirit

- **Serves:** "It should feel like a place", and its demand that the box
  "tell the story of how it got there. Not a changelog — a narrative." The
  body is that narrative for one place.
- **Risks:** "The best stuff comes from the people." Agent prose can push the
  person's own words aside. Guard: the guidance tells the agent to link the
  person's cards, quote their words, and keep any sentence the person wrote.
- **Risks:** "You should be able to see the gears." A summary can drift from
  the cards. Guard: the cards stay listed below the body, so a drifted claim
  sits next to the cards that contradict it. A freshness line was considered
  and cut: file mtimes cannot say when the prose was written (plan review
  finding 2).

### Trust

The body is the agent's own summary of a place, written automatically. It
changes nothing the person made, and git keeps every version. A sentence the
person wrote moves the body down a rung: the agent keeps it, and asks before
removing it. The fallback list and the summary line only show; they take no
action.

### When it goes wrong or does nothing

- **No body yet** (new box, new place): the tiers and "Also here" show the
  cards. When nothing is listed, the page says "No cards to show here yet."
  and names the folder. It no longer claims the folder is empty: the walk
  skips cards of unknown types and background cards.
- **Body wrong:** the person says so in chat, in their own words, and the agent
  rewrites it.
- **Type has no summary line:** the tile shows the title only, as today.
- **Many cards:** "Also here" shows the 10 most recently changed, then "and
  32 more", which opens the folder in Browse.

### Walkthrough

Juni, the F-newcomer box, the day after her first chat.

1. She opens the box on the desktop layout. Arrival opens the root place page
   ("Box") beside a fresh chat.
2. The root landmark has no body: the agent recorded no box purpose yet. The
   page shows "Start something" with the two stock openers.
3. Below, "Also here" lists her cards, most recently changed first: "Spanish
   practice plan", "Things to ask the landlord", "Groceries", then the box's
   briefing. The landmark, chat logs and capture staging are background and do
   not appear.
4. She clicks "Things to ask the landlord". It opens as a panel.
5. She types "Remember I want to learn Spanish this year." The agent records
   it in the briefing and edits the root landmark's openers, as
   `box-docs/card-briefing.md` already directs. The always-loaded agent guide
   tells it that a change to what a place holds means updating that place's
   summary, so it writes the root body: two lines naming the Spanish plan and
   the landlord list, with links.
6. The open place page refreshes on the file change and shows the body above
   "Also here".

## Smallest fix and budget

**Smallest fix:** list ordinary cards in a last section, so "Nothing here
yet" is true when it shows (about 150 source lines and 100 test lines). It
fixes the anchor bug. It does not give the person a summary of the place, and
tiles stay title-only.

**Chosen design: three tracks.**

| Track | Source | Tests | Notes |
|---|---|---|---|
| A. "Also here" and background defaults | ~200 | ~170 | server walk, payload group, frontend section, empty-state copy |
| B. Summary line and card faces | ~300 | ~250 | link detail, card.get detail, header line, empty-body rule, embed order, record summary |
| C. Landmark body | ~120 | ~100 | schema body, place page body |
| Guidance and audits | — | — | ~120 lines of box-docs, agent guide and schema instructions, 4 audit entries |

About 1,150 changed source and test lines, plus about 150 lines of authored
guidance. Below the 2,000-line BIG CHANGE line.

The fuller design buys what the walkers asked for beyond "not empty": a
readable place (C), scannable tiles (B), and card fronts that show their
facts (B).

## Stated preferences this plan trades against

- **Minimize invented concepts; prefer primitives** (boxholder memory). Track
  A excludes staging and chat-log cards by setting `prominence: background` on their
  types, the existing level for "for the agent, not the reader"
  (`src/shared/prominence.ts:14`: *"`background` — for the agent, not the
  reader: logs, state, imports, scratch, generated intermediates."*). It adds
  no exclusion list. Cost: those types also fold in Browse.
- **Arrange context, don't automate judgment** (boxholder memory). Track C
  refreshes the body through guidance in the turn that changed the place, not
  through a reactor that rewrites summaries on a schedule. The trigger lives
  in the always-loaded agent guide, because the landmark type doc loads only
  when the agent edits a landmark (`src/core/agent-guide/guide.md:393`).
- **Card-reading-properties decision**
  ([closed design](../../../issues/closed/features/2026-09-27-card-properties-design-session.md)):
  a bodied type keeps its fields in Properties. Track B keeps that rule and
  adds two narrow exceptions: an empty body, and the summary line.
- **The tiers keep a place short** (landmark-arrival Track C). "Also here" is
  capped at 10 and sits last, so a curated place still reads curated.

## What already exists

- **Prominence walk** — `src/core/landmark/prominence-index.ts:244`
  `state.cardBoxPaths.add(boxPath);` runs before `:248`
  `if (level === "ordinary") return;`. Reuse: ordinary cards are already
  reached. The walk records no mtime, so the walk gains one.
- **Per-file stat** — `src/core/landmark/prominence-cache.ts:49` already calls
  `fs.stat(absPath, {bigint:true})` per card and keys the parse cache on it
  (`:88`). Reuse: the mtime is available.
- **Groups** — `ResolvedGroup` is `{ label; children; count }`, and its count
  "may exceed children.length when capped" (`resolve/core.ts:32-39`).
  `placeSections` already turns groups into sections (`PlaceView/sections.ts:45`).
  Reuse: "Also here" is a group.
- **Type default prominence** — `src/cards/schema.ts:593-594`:
  `config.prominence ?? (category === "system" ? "background" : "ordinary")`;
  `landmark.ts:185` sets `prominence: "background"` explicitly. Reuse: the
  same option on three more types.
- **Summary hook** — `src/core/loader-registry.ts` exports `summarize`, which
  validates a fields bag and runs the type's hook (the private `cardParts`,
  `:76`). The schema requires `type` (`src/cards/schema.ts:553`); normal
  loading injects it from the filename (`src/core/card-io.ts:123`), and the
  cached raw reader does not (`card-io.ts:258`). The tile path must inject it
  the same way, or a valid card with no on-disk `type:` loses its detail. Box
  schemas can define it (`docs/box/schemas.md:185-205`, the `plant` example
  sets `detail`). The A-lending `loan` type is box-authored and sets a detail
  (`A-lending/reports/2026-10-08.md:26`). Reuse.
- **Detail rendering** — `src/frontend/src/components/ui/FileEntry.tsx:94-96`
  renders `detail` as a truncated muted line. Reuse its styling.
- **Link title read** — `resolve/link-build.ts` `cardTitle` already reads each
  linked card's frontmatter through `readFrontmatterCached`. Reuse: the summary
  comes from the same fields, with no extra read.
- **Card body rendering** — `MarkdownCardView/CardBody.tsx:106-122` renders a
  markdown body with links resolved against the card path. Reuse for the
  landmark body. `RendererProps.data.body` already reaches `PlaceView`
  (`file-type-registry.ts`, `body?: string`).
- **Agent-maintained prose precedent** — the briefing body is agent-written
  and edited "when you learn something that changes how any agent should
  understand this box" (`box-docs/card-briefing.md`). `card-briefing.md:50-55`
  already tells the agent to edit the root landmark when it records the box's
  purpose. Reuse that trigger for the root body.
- **`contains:` staleness** — not affected. Landmarks are `searchable: false`
  (`src/schemas/landmark.ts:176`), and search refresh drops non-searchable
  types before the `contains` sidecar sees them
  (`src/core/search/refresh/core.ts:147`).

## Prior art (external)

No design decision here depends on an external premise. The mechanisms
(cards, landmarks, `summarize`, prominence) are this codebase's own.

## Ontology

- **Place** (exists: a landmark's directory, `docs/landmarks.md`). Not a new
  noun.
- **Place page** (exists: `PlaceView`, the landmark card's front).
- **Place summary** (new term, no new field): the landmark card's `body`. It
  is markdown, agent-written, short. It is not the briefing, which is guidance
  for agents; not `contains:`, which is a search sentence; not an entry-point
  card, which is a separate card arrival opens instead of the place page.
- **Also here** (new group label): the place's ordinary cards not already in
  a tier. Identified by the place directory. It is a `ResolvedGroup`, not a
  new type.
- **Summary line** (exists as `FileSummary.detail`, `src/core/file-summary.ts`:
  *"A second line the card type wrote about itself — a status, a count, a
  date."*). The plan uses the name `detail` in code and "summary line" in
  prose.
- **Background** (exists: `ProminenceLevel`). Three more types default to it:
  `chat`, `capture-session`, `upload-batch`. `briefing` stays ordinary: the
  person reads it as their own page (`src/schemas/briefing.tsx:62-63`).

## Tracks / scope

### Track A — "Also here" and background defaults

- **What.** The place page lists the place's ordinary cards in a last group,
  "Also here", most recently changed first, capped at 10. Chat logs and
  capture staging become background, so they leave that list.
- **Why.** A place lists only `entry-point` and `primary` cards
  (`sections.ts:38-39`), and the agent rarely marks cards. Five of six arrival
  walks met "Nothing here yet" over a folder with cards (anchor issue).
  Without the type defaults, the root list would fill with chat logs and
  capture staging: `chat.ts:73` and `capture-session.tsx:55` are `synced`,
  so ordinary, and `tmp-capture/` is not in `WALK_SKIP_DIRS`
  (`prominence-index.ts:70`).
- **Direction.**
  - Schemas: add `prominence: "background"` to `chat`, `capture-session`,
    `upload-batch` (the same option `landmark.ts:185` uses). Chat husks are
    reached from Recent chats, which enumerates sessions on its own
    (`src/core/chat/session/list/core.ts`); capture sessions and upload
    batches are staging. In Browse they move to the dimmed "more" tier when a
    folder has a primary card (`src/shared/browse-fold.ts:135`).
  - Walk: `PrunedSubtree` gains `ordinary: { boxPath: string; mtimeMs: number }[]`,
    filled in `addCardEntry` before the ordinary return, from the stat
    `readFrontmatterCached` already takes. `readFrontmatterCached` returns the
    mtime with the fields (one signature change, its callers updated).
  - Payload: `loadLandmarkPayload` (`webapp/trpc/routers/landmarks/payload.ts`),
    when `expandsAsGroups` is set, appends a group
    `{ label: "Also here", children, count }`: ordinary cards minus refs already
    in `links` or another group, sorted by `mtimeMs` descending with the path
    as tie-break (local "recently changed" order, as the expand sorter's
    "modified" order already is, `resolve/core.ts:265`; a checkout or sync can
    reorder it), children built
    with `buildLink({ source: "derived" })` for the first 10, `count` the full
    total. An empty list adds no group. The menus omit `expandsAsGroups` and
    are unchanged.
  - Frontend: `PlaceView` renders the group like any other. `LandmarkGroup`
    already shows a plain "+N more" when `count > children.length`
    (`LandmarkSection.tsx:201`); it gains an optional `onMore` that turns that
    same slot into an action. The place page passes one that opens
    `browseCardTarget({ directory })`, so the group shows one overflow
    count. `EmptyPlace` copy changes from
    "Nothing here yet." to "No cards to show here yet." (`view.tsx:55-66`),
    because the walk skips unknown types and background cards and cannot
    promise the folder is empty.
- **Vocabulary lock-ins.** Group label "Also here"; `PrunedSubtree.ordinary`;
  `ALSO_HERE_CAP = 10`.
- **First implementation chunk.** The three schema defaults and the walk's
  `ordinary` list, with `prominence-index.doctest.md` cases: an ordinary card
  and a briefing are listed with their mtimes; a chat husk and a capture
  session are not; a nested place's card is not.

### Track B — Summary line and card faces

- **What.** A card type's summary line shows under the title on place tiles,
  on the card page, and in a chat embed. A bodied card whose body is empty
  shows its type fields on the front. A chat embed shows the body before the
  fields. The built-in `record` type gains a summary line.
- **Why.** The loan's "Idris has it · back by 2026-10-17" appeared on no
  surface the walker looked at (tiles issue); an inventory record showed only
  its title and "No body content" (decisions issue, B row 34); the embed put
  every field before the prose (embed issue).
- **Direction.**
  - Server, tiles: `ResolveOptions` gains `cardSchemas: Map<string, CardSchema>`
    (built once per `forDir` call with the existing per-box cache).
    `cardTitle` in `link-build.ts` becomes `cardIdentity`, returning
    `{ title, detail }` from the cached frontmatter through the exported
    `summarize`, with `type` injected from the filename as `card-io.ts:123`
    does.
    `ResolvedLink` gains `detail?: string`.
  - Server, card page: the `card.get` response gains `detail?: string`, from
    the exported `summarize` on the fields it already loaded
    (`routers/card.ts`).
  - Client data: `FileData` (`file-type-registry.ts:25`) gains
    `detail?: string`, and `useFileData` copies it
    (`components/file-view-data.ts:173` builds `FileData` field by field and
    would drop it otherwise).
  - Frontend: `LinkTile` renders `detail` under the title in the
    `FileEntry` style. `CardThemeSurface.tsx:104-106` and `ChatHeader`
    (`FileView/view.tsx`) render it under the `<h2>`.
  - Empty body: `splitCardFields` gains `bodyEmpty: boolean`; type fields go to
    the front when `embed || hasBodyField !== true || bodyEmpty`. "Empty" uses
    the rule `CardBody` already applies (`body.trim() === ""` after
    `blankLeadingTitleHeading`), moved to one shared helper. All three callers
    (`MarkdownCardView/view.tsx:24`, `PersonView/view.tsx:150`,
    `CardProperties.tsx:38`) pass it, so Properties and the front agree. With
    fields on the front, `CardBody` hides "No body content".
  - Embed order: in `mode === "embed"`, `MarkdownCardView` renders title,
    detail, body, then the field block, with `title` removed from that block
    (embed mode puts it on the front today, `card-field-faces.ts:30`). Page
    mode is unchanged.
  - `record.tsx` `summarize` adds `detail`: location text and quantity value,
    joined by " · ", omitted when both are absent.
  - Chat prompt (`prompts.ts:108`): one sentence saying an embed shows the
    whole card, prose first, so a link suits "where is X" and an embed suits
    "show me X".
- **Vocabulary lock-ins.** `ResolvedLink.detail`; `card.get` `detail`;
  `splitCardFields({ hasBodyField, bodyEmpty, mode })`; `cardIdentity`.
- **First implementation chunk.** `splitCardFields` `bodyEmpty` and the shared
  empty-body helper, plus a `link-build` case: a box-authored card with no
  on-disk `type:` still gets its detail; with `card-field-faces.doctest.md` cases (bodied type,
  empty body → front; bodied type with body → Properties; embed unchanged).

### Track C — Landmark body

- **What.** A landmark card may carry a markdown body, the place summary. The
  place page shows it first. The agent writes it when it makes a place and
  updates it in the turn that changes what the place holds.
- **Why.** The boxholder's direction: agent-composed landing text, as the
  landmark body. C's walker wanted "where things stand" as four lines and got
  it only from chat (C row 47).
- **Direction.**
  - Schema: `landmark.ts` fields gain `body: body(z.string())`. Today a body
    on a landmark fails to load: `card-io.ts:338-342` throws
    *"declares no body, but file has body content"*.
  - `landmark.ts` instructions: replace *"A landmark is pure YAML frontmatter
    (no body)"* (`:192`) and *"If a landmark genuinely needs prose, write a doc
    card and link to it"* with a "Place summary" section:
    - what the body is for: where things stand, in a few lines, with links to
      the cards;
    - when to write it: when you make a place, and in the same turn as any
      change to what the place holds that makes it untrue;
    - keep the person's words: link and quote their cards; keep a sentence the
      person wrote; ask before removing one;
    - length: under about eight lines; the cards are listed below it.
  - Same change in `docs/landmarks.md:34`, the header comment `landmark.ts:6`,
    and the generated `box-docs/card-landmark.md`.
  - The trigger goes in the always-loaded agent guide's LANDMARKS section
    (`src/core/agent-guide/guide.md:378-396`). The landmark type doc loads
    only before editing a landmark (`guide.md:393`), so a turn that saves a
    loan would never meet a rule kept there. The guide line: "When you add,
    move, or change cards in a place, check its landmark's summary in the same
    turn: write one if the landmark has none, and update it if it no longer
    holds." The "write one if none" clause seeds existing places, which ship
    without a body.
  - `box-docs/card-briefing.md:50-55`: when recording the box's purpose, also
    write the root landmark's body.
  - Place page: `PlacePage` gains `body?: string`; `PlaceView` passes
    `data.body`. It renders through the shared `Markdown` component, first,
    above "Start something".
  - `CardFacts` special case for landmarks (landmark-arrival Track C,
    *"merges the split's `front` into `properties`"*) becomes redundant once
    the type has a body field; remove it.
- **Vocabulary lock-ins.** "Place summary".
- **First implementation chunk.** The schema `body` field and a `card-io`
  doctest that a landmark with a body loads and one without still loads; the
  `forDir` doctest that `parseLandmarkFields` reads a landmark with a body.

### Implementation notes (2026-10-11)

- The "Also here" group is built inside `resolveLandmark`
  (`resolveAlsoHere`, `resolve/derived-links.ts`), switched on by
  `ResolveOptions.alsoHere`, which the payload sets from `expandsAsGroups`.
  The layout check forbids `payload.ts` importing `buildLink`. The group
  carries `alsoHere: true`; the page keys on that mark, not on the label.
- `alsoHere(ordinary, { shownRefs, cap })` lives in `src/shared/also-here.ts`.
  Shown refs are compared without `?query`/`#fragment`. A card that vanishes
  between the walk and the build keeps a struck-through row.
- Tile titles now come from `summarize`, so records show their name. Memo
  tiles still show the filename, because the cached read has no body.
- The empty-body test uses one heading rule for all callers: `title:`, else
  `name:`. "No body content" is hidden whenever the front shows fields.
- The landmark merge in `CardFacts` stays: a landmark with an empty body would
  otherwise send its fields to a front the place page does not draw.
- `installRootLandmark` keeps an agent-written body when it repairs an inert
  root landmark.

## Could this be simpler?

- **Simplest:** Track A alone, without the type defaults, plus an exclusion
  list in the payload for `chat/` and `tmp-capture/`. It fixes the empty page.
  It fails on Tomas's situation: a list of five loan titles does not say who
  has what, per the walkers' tile and front complaints (A R6, B row 57). An
  exclusion list is also a second mechanism beside prominence (minimize
  invented concepts).
- **A stale line under the body:** cut. A landmark's mtime also moves on an
  opener edit, and a checkout resets mtimes, so "written before the latest
  changes" would be false in ordinary use. A dependable line needs a recorded
  body write time, which is new durable state; revisit if drift shows up in
  walks.
- **Without the card-page summary line** (tiles only): saves about 40 lines.
  The A walker's complaint was the card front itself (rows 37, 38, 78). Kept.
- **A reactor that refreshes bodies at wakeup:** not built. Guidance in the
  turn that made the change is cheaper and knows what changed. If the knowledge
  audits or the next walks show agents skip the update, a reactor is the
  follow-up.

## Subplans

None.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A root place with thousands of ordinary cards: payload sorts all of them | New: payload doctest with 30 cards checks cap and count | Sort is O(n log n) on an already-walked list; children capped at 10 | Clear ("and N more") |
| A card changes between walk and `buildLink`: missing target | Existing `derived-read` problem path (`derived-links.ts`) | Yes | Clear (struck-through row) |
| Setting `chat` to background folds chat husks in Browse | New: Browse listing doctest | Intended; Recent chats is the chat surface | Clear |
| A box schema's `summarize` throws on a tile | `cardParts` falls back to the base summary | Yes (`loader-registry.ts`) | Silent on the tile (title only), warned in the server log |
| A checkout or sync resets mtimes, so "Also here" picks a different 10 | Doctest: path tie-break gives a stable order for equal mtimes | Order is described as "recently changed", not "newest" | Clear: every card is still reachable through "and N more" |
| `parseLandmarkFields` (lightweight reader) rejects a body | New: `forDir` doctest with a body | To verify in chunk C1 | Would be silent (place unreadable); chunk C1 tests it first |
| The agent saves a card and never updates the body | Audit `landmark-body-after-card-save` asks from the card-save situation, not from a landmark edit | Fallback list still shows the cards below the body | Silent drift in the body; the cards beside it are correct |
| The agent overwrites a sentence the person wrote | Knowledge audit `landmark-body-keeps-person-words` | Guidance only | Silent in the UI; git keeps the old text |
| An empty-body bodied card with many fields now shows them all on the front | `card-field-faces.doctest.md` cases | Same rendering as a bodiless type today | Clear |

> **Accepted risk:** the agent overwriting the person's sentence in a body is
> handled by guidance and git history only. A per-sentence authorship marker
> would be a new concept for a case no walk has shown yet.

## Agent-flow / user-flow edge cases

- **Wrong field.** The agent writes the place summary into the briefing, or
  the reverse. ADDRESSED: both instructions name the other ("the briefing is
  for agents; the body is for the person"), and audit
  `landmark-body-vs-briefing` checks it.
- **Stale ref.** A body links to a card that moved. ADDRESSED: body links
  render through `Markdown`, which shows a broken link the same as in any
  card body. `bbx validate` reports a broken body ref as a warning only
  (`src/core/card-lint/core/lint-cards.ts:181`); it does not keep the page
  right.
- **Two agents on one card.** Two chats in the same place both update the
  body. ADDRESSED as for any card: the later write wins and git keeps both.
  Not new to this plan.
- **Hand-edit drift.** The person edits the body by hand. ADDRESSED: the
  guidance keeps their sentences.
- **Fabricated value.** The body claims a fact no card holds. DEFERRED: the
  guidance says to link the card behind each claim; no check enforces it.
- **Validation error UX.** A landmark with a body on an old server fails to
  load. ADDRESSED: server and schema ship together; boxes get the guidance on
  their next guidance refresh, after the server change.
- **Transition state.** Existing landmarks have no body: the page shows the
  tiers and "Also here", as on a new box.
- **Single entry-point place.** Arrival opens the entry-point card, so the body
  is not what the person sees first. ADDRESSED by guidance: prefer the body
  over making a separate entry-point doc for "where things stand".

## NOT in scope

- Plate and todo count wording ("0 later", "2 on your plate · 1 later"):
  different surface; stays in the counts issue.
- A reactor or schedule that refreshes place summaries: wait for evidence
  that turn-time updates fail.
- The `contains:` sentence as a tile fallback for types with no summary line:
  it is written for search, and its tone was not checked on tiles.
- Fixing the latent `contains` basis for empty-body cards (an empty body
  hashes as "" and ignores field edits): file as its own issue.
- The Browse folder count: the place walk stops at nested places, so it is
  not a drop-in. Stays in the counts issue.
- A freshness line under the body: needs a recorded write time.
- Course-specific body guidance (last / next / uncertain): the study-home
  issue owns it.
- The "open chat is in another place" wording and the disabled openers:
  already fixed under their own issues.
- Phone layout: arrival opens no card there (landmark-arrival decision c);
  unchanged.

## Open design questions

- Should "Also here" fold when the place has a body? Lean: no; keep it open,
  capped at 10. Revisit after a walk.
- Should the summary line also show in search results and Browse rows? Lean:
  later, under the fold-summaries issue.

## Knowledge audits

Four `knows_directly` entries in `beebox/src/dev/knowledge-audits.yaml`,
beside the Landmarks block (line 3352):

- `landmark-body-purpose`: what a landmark's body is for.
- `landmark-body-after-card-save`: asked as "You just saved a new loan card in
  the Lending place. Is anything else to update?" It must be answerable from
  the always-loaded guide, without reading the landmark type doc.
- `landmark-body-vs-briefing`: which card holds a place summary for the
  person, and which holds guidance for agents.
- `landmark-body-keeps-person-words`: what to do with a sentence the person
  wrote in a place summary.

Update `landmark-roles` if its expected answer says a landmark has no body.
All run with `pnpm knowledge-audit run --box ~/src/box-worktrees/place-shows-cards/test1 --filter landmark-body`.

## What will hold this after it ships

- Doctests, in the existing files: `prominence-index.doctest.md` (ordinary
  list, background defaults), `landmarks.place.doctest.md` (Also here group,
  cap, count, dedup, body fields), `PlaceView/sections.doctest.md` and
  `view.place-page.doctest.md` (body first, "and N more", empty copy),
  `card-field-faces.doctest.md` (empty body), `MarkdownCardView` doctest
  (embed order, title once),
  `schemas.card-loaders.doctest.md` (record detail).
- The decisions that carry risk are pure functions: the Also-here selection
  (`alsoHere(ordinary, { shownRefs, cap })`) and `splitCardFields`. Each is tested
  directly.
- The knowledge audits hold the agent behavior.
- No new test tier.

## Implementation order

1. A1: background defaults and the walk's `ordinary` list.
2. A2: payload "Also here" group and the frontend section with "and N more".
3. B1: `bodyEmpty` in `splitCardFields`, shared empty-body helper.
4. B2: `detail` on `ResolvedLink` and `card.get`; tile and header line;
   `record` detail.
5. B3: embed order and the chat-prompt sentence.
6. C1: landmark `body` field; loaders and validate checked.
7. C2: place page body.
8. C3: guidance (schema instructions, landmarks.md, card-briefing.md, agent
   guide), regenerated box-docs, knowledge audits run.
9. Exhibit of the walk: Juni's root page before and after, Tomas's Lending
    page with a body and tile summaries, an inventory item front.

Each step is one commit or a few. The plan ships whole, when the boxholder
says so.

## Rollout shape

Real-agent check after C3, on the worktree's test box: in a chat bound to a
place whose landmark has no body, ask the agent to save an ordinary card
there, and confirm the same turn writes the landmark body. Repeat with a
place that has a body the new card makes untrue. The knowledge audits check
what the agent says; this checks what it does.

Tests first per chunk, as named in each track's first chunk and in *What will
hold this*. Done when those doctests pass, the change-selected suite passes,
and the four audits pass on the worktree's test box. No migration: the body
is optional, existing landmarks load unchanged, and the type defaults need no
data change.
