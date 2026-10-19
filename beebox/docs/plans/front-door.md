---
title: "The front door: what a person meets when they open their box"
status: draft
workstream: front-door
issues:
  - ../../../issues/features/2026-08-23-first-screen-says-nothing-about-what-this-is.md
---
# The front door: what a person meets when they open their box

A person who opens their box on the desktop layout meets the root place page
beside a chat. On a new box that page says nothing about what the box is or
what to do, and Browse lists the storage layout. This plan gives the root
place a stock summary that the agent later rewrites, puts the plate and
waiting questions on the root page, makes Browse open on the person's
content, fixes the words the walks tripped on, and tells people the box can
build them a page.

**Proposal stage.** The boxholder asked to "investigate, propose, then we'll
discuss." The decisions below are proposals with a lean; nothing is settled
until the discussion. Reviewed once by `codex gpt-6-sol` (plan mode,
2026-10-19); the findings and what changed are in
[front-door.review.md](front-door.review.md).

**Issues addressed:** the frontmatter issue. Related, not closed here:

- [First-run experience: the empty box explains nothing](../../../issues/features/2026-07-20-first-run-experience.md):
  its "menu of flows that just work" direction is product work per flow; this
  plan gives the menu a place to appear (the stock summary) and leaves the
  flows to the starter work.
- [A starter declares what it needs and scripts its first turn](../../../issues/features/2026-10-08-starter-manifest-and-scripted-first-turn.md)
  and [Target a few specific, underserved use cases](../../../issues/decisions/2026-10-05-target-specific-underserved-use-cases.md):
  starters are the fuller answer to "what should I try"; the stock summary is
  the version that needs no starter.
- [No visible search box and no home surface](../../../issues/features/2026-08-08-no-visible-search-or-home.md):
  this plan answers the home half (the root place page is home) and leaves
  the search half where it is.
- [Collection views are badly defined](../../../issues/features/2026-08-19-collection-views-are-badly-defined.md)
  and ["Today" view as a recurring procedure](../../../issues/features/2026-05-11-today-view.md):
  the root page's count line is a count over existing todo data, not a
  collection view and not a digest.
- [Give box agents annotated screenshots of the app](../../../issues/features/2026-10-05-box-agent-interface-screenshots.md):
  the "Landmarks page with no on-screen path" finding is the agent guessing
  the screen; that issue owns the fix.

Queue searches run (`bin/issues search`): "home surface", "welcome
orientation first screen", "onboarding empty box", "arrival place page",
"storage folders browse hide"; `bin/issues similar --all --docs` on the
anchor. No duplicate of the anchor was found. Two closed items changed the
ground since the October 9 walks and are cited below:
[place-page-says-nothing-here-while-the-folder-holds-cards](../../../issues/closed/bugs/2026-10-09-place-page-says-nothing-here-while-the-folder-holds-cards.md)
(the "Also here" list) and
[root-onboarding-openers-outlive-the-purpose](../../../issues/closed/bugs/2026-10-09-root-onboarding-openers-outlive-the-purpose.md)
(the briefing rule that removes stock openers).

## What the walks found, against the code on `main` today

Verified on 2026-10-19 against this worktree and its test box
(`~/src/box-worktrees/front-door/test1`).

| Finding (walk) | State today |
|---|---|
| First view is an empty chat (B, C, F, A) | Met. The box index redirects to `/chat` (`main/router.tsx:105`); on the desktop layout arrival opens the root arrival target (`docs/landmarks.md`, "Arrival"). The unstarted chat shows the stock openers and "Start a conversation." (`InteractiveChat/messages.tsx:296`). |
| The page says "Nothing here yet" over a box with cards (C row 14, F row 65) | Met by "Also here" (`docs/landmarks.md`, "The place page"). The test box's root page lists 75 cards there (exhibit, figure 2). |
| The page says nothing about what the app is for (A row 5, F row 65) | Open. The root landmark ships with no body (`defaults.ts:241`: `createLandmarkTemplate({ label, symbol, openers })`); the body is agent-written later (`place-shows-cards.md`, Track C). A new box has no body until the agent writes one. |
| Day two opens on an empty page plus chat (A, 2026-08-25) | Partly met: "Also here" shows the cards. Nothing on the page says what is due or waiting; the only signal is the nav badge (`app-nav-badges.tsx:59`). |
| Browse lists Bookkeeping, Config, Content, Publish, Tmp (C row 44, B2 row 41) | Open for a new box. The root listing is the five areas (`status.ts:80`: "what the box root listing shows, and all it shows"). The fold hides four of them behind "N more" only when something prominent exists (`browse-fold.ts:138-141`: `if (nothingProminent) return { folded: false, lead: [], more: rawOrder(listing) }`). A new box has nothing prominent, so all five show, unfolded. |
| Browse shows many empty template folders (F row 31) | Open. `ensureDirectories` creates every `BOX_DIRS` path with a `.gitkeep` (`structure/core.ts:297-303`): calendar, chat, drive, inbox, incoming, people, places, recipes, reviews, todos. |
| "card" and "This place is the folder /" (B row 2, F row 3) | Open. `PlaceView/view.tsx:59-64`: "No cards to show here yet." / "This place is the folder `/`. Ask in the chat to add the first card." |
| "Landmarks page" with no on-screen path (B row 25) | The page exists; the only route is the place menu's "Find a landmark" (`PlacePill-panels.tsx:90`). The agent reply gave no path: `guide.md:149` SPEAKING already forbids guessing the screen. |
| "The Plate" and "Things to do" for one list (F row 28) | Unverified origin. `grep -rn "Things to"` over `beebox/src` finds no such label; the stock view is titled "The Plate" (`defaults.ts:306`) and every summary line says "on your plate" (`todo/summary.ts:43`). The second name was most likely the agent's own card title in that walk. |
| Empty-box suggestions lead with hobby collections, nothing about reminders (F row 7) | By design today: the `what-can-you-do` skill says "lead with the three inputs that need no setup: photograph something, talk about it, keep track of a kind of thing" (`content-what-can-you-do.ts`). `what-you-could-do.md:176`: "Offer to keep track, to remind ... Do not promise that the box will anticipate." |
| The box can build you a page, discovered by luck (A, 2026-08-25) | Open. `what-you-could-do.md`, "What the agent itself can do", mentions "a custom view when a kind of card wants a better display"; nothing on screen says it. |

One more finding from the test box, not from a walk: arrival opened a demo
document ("Card themes tour") instead of the root page (exhibit, figure 1),
because that card is the subtree's single entry point
(`landmarks/payload.ts:187-191`). A root with one marked card hands its
front door to that card.

## Design

### Situations

- When Juni opens her new box for the first time, I want the first page to
  say what this is and three things I could do now, so I can start without
  asking the chat what the chat is for.
- When Juni comes back the next morning, I want the page to show what she
  saved and what is on her plate, so she knows the box kept it and what is
  next.
- When Tomas opens the box on a Sunday evening to see whether the stove came
  back, I want the first page to say what is out and what is due, so he does
  not open five cards.
- When Priya opens Browse to find a recipe she saved last month, I want the
  list to show her folders, so she is not reading Bookkeeping and Config.
- When Idris, who runs the box, wants the schedules folder, I want the whole
  layout one switch away, so Browse still reaches everything.
- When Juni's list of what she owes people reaches a dozen lines, I want the
  box to have told her it can build a page for that, so she asks for one on
  purpose and not by luck.
- When Priya returns to a chat where she had cards open, she does not want a
  front page pushed over them. (Quiet; arrival already stays quiet here.)
- When Tomas has written the root summary in his own words, he does not want
  the box to replace it with stock text. (Quiet; the stock text is written
  once, at init.)

### Right place, right time

| Situation | Act, show, or quiet | Surface and card | Attention |
|---|---|---|---|
| Juni, first open | Show | Root place page: stock summary at the top, then "Nothing saved here yet" | Waits to be found; the chat beside it shows the openers |
| Juni, next morning | Show | Root place page: the agent's summary, the count line, "Also here" | Waits to be found |
| Tomas, Sunday evening | Show | Root place page: count line; the Lending place's summary says what is out | Waits to be found |
| Priya, Browse | Show | Browse opens on her content; empty template folders fold behind "N more" | Waits to be found |
| Idris, schedules | Show on request | Browse's Raw switch shows the box root and its five areas | Found by choice |
| Juni, a dozen lines | Show | The stock summary's last sentence and a third opener; later, the agent's offer in chat | Waits to be found; the agent offers when a list grows |
| Priya, saved cards | Quiet | Her saved arrangement | Nothing new |
| Tomas's own words | Quiet | His summary stays | Nothing new |
| Juni, first open on the phone | Show | The empty chat: the stock summary's first two sentences above the openers (Track A, phone) | Waits to be found; no card opens |

The stock summary is written once, at `bbx init`, like the stock openers. The
agent replaces it when it records the box's purpose, which is the moment it
learns what the box is for; the same briefing rule already removes the stock
openers then (`briefing.tsx:101-104`).

### Spirit

- **Serves:** "It should feel like a place": the first page says whose place
  this is and what is in it, and "tell the story of how it got there" is the
  summary's job once the agent writes it.
- **Serves:** "It should feel possible": "oh, I could make it do *that*?" is
  the sentence about asking for a page.
- **Risks:** "The best stuff comes from the people": stock prose is nobody's
  words. Guard: it is short, it is replaced at the first real conversation,
  and a hand-edited root landmark is never rewritten by the engine
  (`defaults.ts:255`: "a real landmark — leave the user's content alone").
- **Risks:** "You should be able to see the gears": hiding the layout from
  Browse hides where things live. Guard: the Raw switch shows the whole box
  root; nothing is removed, only led with content.

### Trust

Shows only, takes no action. The stock summary is template content installed
once. The agent's later rewrite follows the place-summary rule already
decided: keep any sentence the person wrote, ask before removing it
(`place-shows-cards.md`, "Trust").

### When it goes wrong or does nothing

- **The agent records the purpose somewhere other than the briefing** (the
  residual risk the openers fix recorded): the stock summary and openers
  stay. The person sees onboarding text on a box that has a purpose. They can
  say "update the front page" in chat; the agent edits the landmark body.
- **The root has one marked entry point** (the test box): today arrival
  opens that card. With Track B the root page opens and lists the card first
  under "Start here".
- **No todos and no questions:** the count line is absent, as
  `summaryParts` already returns `null` for an empty reduction
  (`summary.ts:41`).
- **A seeded folder has no cards yet** (`recipes/` on a new box): it folds
  behind "N more" until a card lands. A folder the person made themselves
  never folds.
- **A stray file at the box root:** Browse's content-first view does not list
  it; Raw does, and `bbx validate` already reports it (`box-layout.md`, "The
  closed root vocabulary").
- **Phone layout:** arrival opens no card (landmark-arrival decision c). The
  front door there is the chat with openers, so Track A also shows the stock
  summary's first two sentences above the openers in the empty root chat on
  the phone layout. The agent's later summary is not shown there: the Box
  tab is one tap away, and the chat stays the priority (decision c).

### Walkthrough

Juni, a new box, desktop layout.

1. She opens the box. The index redirects to `/chat`, a fresh chat; arrival
   finds no saved arrangement and opens the root arrival target, which is now
   always the root place page (Track B).
2. The page shows the root label, then the stock summary (Track A): what the
   box is, three things to try, and that she can ask for a page. Below it,
   "Nothing saved here yet. Tell me about something in the chat and I'll
   keep it here." (Track E). "Start something" is hidden because the chat
   beside it shows the same three openers (decision a of landmark arrival).
3. She clicks "Let me tell you what this box is for." and says it is for
   keeping track of what she lends and what she owes. The agent writes the
   purpose into the briefing; the briefing rule (extended in Track A) has it
   replace the stock summary with two sentences in her words and replace the
   stock openers with ones for lending.
4. She lends a ladder and a book. The agent makes two cards in `lending/`.
   The root page's "Also here" lists them; the agent updates the root
   summary in the same turn (the place-shows-cards rule).
5. Next morning she opens the box. Arrival opens the root page: her summary,
   "1 to do" (the ladder is due Friday), and the two cards. She
   clicks the count line; the todo view opens beside the chat.
6. A month later her lending list is twelve cards. The agent, answering a
   question about the stove, offers: "I can make you a page that shows
   what's out and what's due. Want one?" (Track F). She says yes; the agent
   makes a view and marks it primary, so it leads the root page.

## Smallest fix and budget

**Smallest fix.** Give the root landmark a stock body at init and change the
empty-state copy. About 60 source and 40 test lines. It fixes "says nothing
about what this is" for new boxes and nothing else in the table.

**Chosen design.** Six tracks, about 1,100 changed lines (additions plus
deletions), not a BIG CHANGE.

| Track | Source | Tests | What it buys |
|---|---|---|---|
| A. Stock root summary and the replace rule | 170 | 110 | A new box says what it is, on the desktop page and in the phone's empty chat; the agent takes over the words at the first real conversation |
| B. Root arrival always opens the root page | 20 | 30 | One marked card cannot take the front door |
| C. Todo and question counts on the root page | 110 | 70 | Day two says what is due and waiting, where the person looks |
| D. Browse opens on content; seeded empty folders fold | 220 | 140 | Browse reads as the person's folders; the whole box stays one link away |
| E. Words | 60 | 40 | No "card" or "folder /" on the first screen; "landmark" glossed where it is first met |
| F. "The box can build you a page" | 40 | 30 | The discovery stops depending on luck |
| Authored docs (landmarks.md, box-layout.md, glossary, what-you-could-do.md, speaking examples) | 120 | | |

## Stated preferences this plan trades against

- **Content is where the time goes (boxholder, 2026-10-19):** the content
  root is where a person spends all their time; the other storage areas
  are only for jumping out. Track D follows this. It also rules out any
  front-door element that points at the machinery areas.
- **No plate metaphor (boxholder, 2026-10-19):** user-facing words this
  plan adds do not say "plate". Track C's line follows this.

- **Boxholder, 2026-07-20/21** (first-run-experience issue): "a firm menu of
  a few complete flows, each with a real payoff ... NOT an open 'feed me
  anything'", and "Box talks first — incidental plumbing ... not the
  feature." Track A's stock summary is orientation: what this is and the kind of
  thing to say. Its examples are not the flows and are not presented as
  them; the flows stay with the starter issue. It does not make the box
  speak first.
- **Boxholder, 2026-10-08** (landmark arrival, decision 2): "A place with
  exactly one entry point: open that card." Track B makes the root the
  exception. The root is the front door; a nested place is a workroom. See
  Open design questions, question 2.
- **Boxholder, 2026-10-06/07** (box screen): of Dashboard, Browse, History,
  Storage, "I never go to them." Track C puts counts on the root page instead
  of sending anyone to the dashboard.
- **Glossary, user-facing register** (`docs/glossary.md`): "card" is
  acceptable when nothing more specific exists; "place" appears in no label;
  "landmark" is kept pending a better word and glossed on first use. Track E
  keeps "landmark" and adds the gloss on the page itself.
- **Memory of boxholder feedback:** minimize invented concepts; reuse the
  platform mechanism. No onboarding card type, no welcome flag, no new
  surface: the root page, the landmark body, the openers, the briefing rule,
  the fold, and `TodoSummaryLine` carry everything.
- **Engineering principle 8, one way to do each thing:** the count line on
  the root page reads the same `status.navStatus` query the nav badge reads
  (`nav.tsx:120-123`), with the same invalidation, so the two cannot
  disagree.
- **`beebox/AGENTS.md`, no features beyond the task:** starters, an
  onboarding directory, role-marked instructions, UI pointing, and a voice
  demonstration are listed under NOT in scope.

## What already exists

- Root arrival and the place page: `docs/landmarks.md` "The place page" and
  "Arrival"; `PlaceView/view.tsx`; `placeSections` (`sections.ts`). Reuse.
- The landmark body as the place summary, agent-written, with the rule
  "writes the body when it makes a place, and updates it in the same turn
  whenever it changes what the place holds" (`place-shows-cards.md`,
  "Right place, right time"). Reuse; Track A adds the stock version and the
  root-specific replace rule.
- Stock root openers and their fade rule: `STOCK_ROOT_OPENERS`
  (`landmark.ts:111-114`); briefing instructions `briefing.tsx:101-104`:
  "When you record the box's purpose, also edit the root landmark ... remove
  its stock onboarding openers". Reuse the same rule for the body.
- Root landmark install: `installRootLandmark` (`defaults.ts:222-267`)
  installs once and leaves "a real landmark" untouched. Reuse; the stock body
  reaches fresh boxes only (see Failure modes).
- Template stock hashes (`template-stock-hashes.ts`) let an untouched stock
  file take an update. Not used for the root landmark today (it has a role
  the moment it exists), and this plan does not add it: an existing box's
  root body belongs to its agent.
- The count line: `TodoSummaryLine` and `summaryParts` (`todo/summary.ts:39-49`);
  `DirectoryTodos` deliberately skips the root ("The box root gets no line —
  its summary is the plate and the nav badge", `DirectoryTodos.tsx:11-12`).
  Track C gives the root its line on the place page, from the nav counts.
- Nav counts: `NavCounts` (`core/nav-counts.ts:22-29`), read by the nav from
  `status.navStatus` (`nav.tsx:120`; `status.ts:167-169`: "the one query
  every page mounts"), invalidated on card and question events
  (`nav.tsx:125-`). Reuse that query, not `status.status`, which is the
  dashboard's fuller payload.
- Browse fold: `foldListing` (`browse-fold.ts:124-173`) and the compact/raw
  listing switch (`BrowseSidebarBody/hook.ts`, a per-viewer listing
  preference owned by the sidebar body, not navigation). Browse's directory
  is always a string in view state, `""` for the box root
  (`browse-card-state.ts:51`). Track D changes where Browse starts and what
  the crumb root is; it does not make the listing switch navigate.
- Root listing filter: `filterRootListing` (`status.ts:338-340`): "At the
  box root, list ONLY the underscore areas." Unchanged; Track D changes what
  Browse opens on, not what the server lists.
- Display vocabulary: `toDisplayPath` (`display-path.ts`): `_content` paths
  display bare; the root displays as `/`. Reuse.
- `what-can-you-do` skill (`content-what-can-you-do.ts`) and the package doc
  `box-docs/what-you-could-do.md`. Track F edits both.
- The `Place` renderer's empty state: `EmptyPlace` (`view.tsx:55-66`). Track E
  rewrites its copy.
- "Home" exists as the pill label for a chat bound to no place
  (`place-label.ts:50`: `HOME_PLACE = { label: "Home", dir: null }`). The
  root landmark's label is the box slug by boxholder decision
  (`defaults.ts:234-238`: "Named for the box, not the literal word 'Box'").
  Unchanged.

## Prior art (external)

No decision here depends on an external premise. The one pattern borrowed is
ordinary: a file manager that opens on the user's home folder rather than the
filesystem root. Evaluated-only; no acknowledgement entry.

## Ontology

- **Root place** (exists): the directory `""`, whose landmark card is
  `_content/<Name>.landmark.card` (`root-dir.ts`). Its label is the box slug.
- **Place summary** (exists, `place-shows-cards.md`): the landmark card's
  body, agent-written markdown.
- **Stock summary** (new term, no new field): the body `installRootLandmark`
  writes at init, `STOCK_ROOT_SUMMARY` beside `STOCK_ROOT_OPENERS` in
  `schemas/landmark.ts`. Identified by text equality with the constant; the
  briefing rule and a test refer to it. It is not a new card and not a flag.
- **Count line** (exists as `TodoSummaryLine` on cards and directories): on
  the root page it reads the nav counts, so it is `onPlateTodos` and
  `escalatedTodos` only (no "later", "parked", or "done": the nav counts do
  not carry them). The questions count joins it as a second part.
- **Content-first Browse** (new behavior, no new noun): compact mode opens
  on `_content` and treats it as the top; the crumb root `/` goes there. Raw
  mode opens on the box root `""` as today.
- **Empty template folder** (new term for the fold): a directory under
  `_content` with no cards anywhere below it and no landmark. Folded in
  compact mode. Not a schema concept; `DirectorySummary` already carries the
  card rollup the fold needs (`browse-fold.ts:44-48`; `fileCount` in
  `status.ts:112-113` counts `.card` files with `readdir(..., { recursive: true })`).
- **Arrival target** (exists): unchanged for nested places; the root's is
  always its landmark card after Track B.

## Tracks / scope

### Track A — Stock root summary and the replace rule

- **What.** `installRootLandmark` writes a body after the frontmatter. The
  briefing rule that removes stock openers also replaces the stock summary.
- **Why.** The first page says nothing about what the box is (table, row 3).
- **Direction.**
  - `schemas/landmark.ts`: `export const STOCK_ROOT_SUMMARY: string`, the
    text below. `createLandmarkTemplate` gains `body?: string`, appended
    after the frontmatter block with one blank line.
  - `defaults.ts:241`: pass `body: STOCK_ROOT_SUMMARY` for the fresh
    install only. The repair branch (`:256-258`) writes
    `templateContent + body` today; with a body in the template it would
    prepend stock prose to a person's summary. It builds its template
    without `body` and keeps the existing body as today; when that body is
    empty it uses the stock one.
  - `briefing.tsx:101-104`: extend to "remove its stock onboarding openers
    ... and replace its stock summary (the body) with two or three sentences
    in the person's words about what this box is for and what is in it; keep
    any sentence they wrote." The landmark schema instructions
    (`landmark.ts:221`, "remove them once the person knows what the box is
    for") say the same from the landmark's side.
  - The compiled briefing already emits the root place's openers for the
    agent (`briefing.tsx:14-15`; `readRootOpeners`, `compile/core.ts:77-82`,
    reads the root landmark's frontmatter). That reader also returns the
    body; `compileBriefing` emits `**Front page:** still the stock text.`
    when the trimmed body equals `STOCK_ROOT_SUMMARY`, so the agent sees the
    stock state on every turn, the way it sees the openers.
  - Phone layout: the empty root chat (`messages.tsx:293-299`) shows the
    stock summary's first two sentences above the openers when the chat's
    `contextDir` is `""` and the root landmark body is stock. The body
    arrives on the chat's openers source, `landmarks.forDir`
    (`InteractiveChat/shell.tsx:63`), as `LandmarkPayload.stockSummary: boolean`,
    computed in `loadLandmarkPayload` from the body it already reads. Not
    shown on the desktop layout, where the page shows the whole text; not
    shown once the body is the agent's.
  - The stock text, first person, the register the agent will continue in.
    It orients; it is not the first-run menu of flows (boxholder, 2026-07-20/21),
    and its examples are examples of what to say, not promised flows:

    > This is your box. Tell me about things you want to keep track of and
    > I'll keep them here, in your words, and bring them back when you ask.
    > You could photograph something and tell me about it, talk through a
    > plan, or name a kind of thing to keep, like what you've lent out or
    > what's due. When a list gets long, ask me for a page that shows it the
    > way you want.

- **Vocabulary lock-ins.** `STOCK_ROOT_SUMMARY`; `createLandmarkTemplate({ body })`;
  the compiled line `**Front page:**`; the openers payload field `stockSummary`.
- **First implementation chunk.** The constant, the template option, the
  install call, the root-landmark reader returning the body, and `t.check`
  tests on a fresh box: the root landmark's body equals the constant; the
  repair branch leaves an existing body alone and adds the stock body only
  to an empty one; the compiled briefing carries the front-page line while
  the body is stock and drops it after a one-word edit.

### Track B — Root arrival always opens the root page

- **What.** `arrivalTarget` returns the landmark card when `relDir === ""`.
- **Why.** A single marked card takes the front door (test box finding).
- **Direction.** `landmarks/payload.ts:187`: one condition. The entry point
  still leads the page under "Start here". Nested places keep the rule.
  This revisits decision 2 of landmark arrival (2026-10-08, "a place with
  one entry point opens that card") for the root only; the test box's case
  may be a poor entry-point choice rather than a wrong rule, so question 2
  below carries both options.
- **Vocabulary lock-ins.** None.
- **First implementation chunk.** The condition and a `forDir` test: a root
  with one entry point has `arrival` equal to its landmark path; a nested
  place with one keeps the card.

### Track C — Todo and question counts on the root page

- **What.** The root place page shows one quiet line under the summary:
  "3 to do · 1 overdue · 2 questions waiting". The line does not say
  "plate": the boxholder does not want that metaphor (decision, 2026-10-19).
  Each count opens its surface beside the chat: the todo view
  (`plate.todo-view.card`, whose own title is out of scope here) and the
  questions card (`SYSTEM_CARD_PATHS.questions`).
- **Why.** Day two says nothing about what is due (table, row 4); the nav
  badge is the only signal and the walks did not read it.
- **Direction.**
  - `PlacePage` gains `rootCounts?: NavCounts | "unavailable"`; `PlaceView`
    passes them when `payload.dir === ""`, from `trpc.status.navStatus.useQuery`,
    the query the nav already mounts and invalidates on card and question
    events. A failed query passes `"unavailable"`.
  - A pure `rootLineParts(counts)` in `components/todo/summary.ts` returns
    `SummaryPart[] | null`: `null` when every count is zero; `"N to do"`
    and `"N overdue"` when `onPlateTodos > 0`; `"N questions waiting"`
    when `pendingQuestions > 0`. It does not call `summaryParts`, whose
    reduction shape (`open`, `done`, `parked`) the nav counts do not carry.
  - `TodoSummaryLine` today takes a reduction and one `openAction` and calls
    `summaryParts` itself (`TodoSummaryLine.tsx:18-22`). The presentational
    part becomes `CountsLine({ parts, actions })`, where `actions` maps a
    part key to an `OpenAction`; `TodoSummaryLine` keeps its signature and
    renders `CountsLine(summaryParts(reduction), { open: openAction })`. The
    root page renders `CountsLine(rootLineParts(counts), { open: plate,
    questions: questionsCard })` through `useOpenBeside`
    (`use-open-beside/hook.ts`, as `DirectoryTodos` does).
  - `"unavailable"` renders a quiet "Counts unavailable" with a retry link;
    zero renders nothing. The two states look different.
  - Position: after the summary body, before "Start something".
- **Vocabulary lock-ins.** `rootLineParts`; `CountsLine`; `PlacePage.rootCounts`.
- **First implementation chunk.** `rootLineParts` with tests for zero,
  plate-only, questions-only (the case that must not vanish), and both;
  `CountsLine` extracted with `TodoSummaryLine`'s existing tests unchanged;
  then the page wiring with a frontend DOM test
  (`docs/implemented-plans/frontend-dom-harness.md`) that the line renders on
  the root page, not on a nested place, and shows "Counts unavailable" on a
  failed query.

### Track D — Browse opens on content; seeded empty folders fold

- **What.** Browse starts at `_content` and its crumb root goes there; the
  box root (the five areas) is one link away at the bottom of the content
  listing, "Whole box". A seeded template folder with no cards below it
  folds behind "N more".
- **Why.** Table rows 5 and 6.
- **Direction.**
  - This is a navigation change, not a listing-mode change. Browse's
    directory is always a string (`browse-card-state.ts:51`, `""` for the
    box root), and the compact/raw switch is a listing preference inside
    `BrowseSidebarBody` (`hook.ts`), so the switch cannot move the page
    between roots and this plan does not ask it to.
  - `browse-card-state.ts`: the Browse card with no `dir` parameter parses to
    `directory: "_content"` instead of `""`; `""` stays valid and reachable
    (direct links, "Whole box", the place page's folder links). History and
    back/forward are unchanged: every directory is still a URL.
  - `BrowseBreadcrumbs` gains `rootPath` (`"_content"`); the root crumb `/`
    goes there, as today's `/` reads bare for content paths
    (`display-path.ts:79`). At the box root (`""`) the crumb shows "Whole
    box" and the trail is the area names, as today.
  - `BrowseSidebarList` at `_content` appends a quiet "Whole box" row that
    opens `""`. At `""` the five areas list as today; the fold's root case
    (`browse-fold.ts:138-141`) is unchanged.
  - `foldListing`: a dir is a *seeded empty folder* when its path is one of
    the `_content` template paths (`BOX_DIRS` entries under `_content`,
    `box-layout-spec.ts:34-147`, passed in as `seeded: boolean` on
    `ListingDir`), it has no landmark, and `summary.cardCount === 0`
    (`fileCount`, `status.ts:112-113`, a recursive `readdir` counting
    `.card` files). It goes to `more`, not dimmed, after plain dirs, and the
    `nothingProminent` early return folds these too (`folded: true` when any
    exist). A person's own empty folder, a folder of plain files, and a
    folder whose count failed are not seeded paths and show as today.
  - The place page's `EmptyPlace` link and "Also here" overflow open the
    place's directory, unchanged.
- **Vocabulary lock-ins.** `ListingDir.seeded`; `ListingDirSummary.cardCount`;
  `BrowseBreadcrumbs.rootPath`; the row label "Whole box".
- **First implementation chunk.** The fold change with `browse-fold` tests:
  a new box's `_content` listing (ten seeded empty folders, two cards) leads
  with the cards and folds the folders with `folded: true`; a seeded folder
  with one card below stays where it is today; a person's empty `taxes/`
  folder is not folded; the box root listing is unchanged.

### Track E — Words

- **What.** The first-screen copy and the one gloss.
- **Why.** Table rows 7 and 8.
- **Direction.**
  - `EmptyPlace` (`view.tsx:55-66`): "Nothing to show here yet. Tell me
    about something in the chat and I'll keep it here." It does not claim
    the folder is empty: the walk skips background cards and unknown types
    (`place-shows-cards.md`, Track A, chose "No cards to show here yet" for
    that reason), and it drops "card" and the path. The folder link becomes
    a quiet second line, "Open <label> in Browse".
  - The place menu row (`PlacePill-panels.tsx:90`), where a newcomer first
    meets the word: "Find a landmark" gains a hint line under it, "the
    places you jump to most", the gloss the glossary asks the agent to give
    on first use. The Landmarks page gets the same line as a subtitle.
  - Keep "Start a conversation." and the composer placeholder.
  - "The Plate" is unchanged. The root label is question 5b: the install
    names it for the box (`defaults.ts:234-238`) while the glossary's "box"
    entry says the root place is "Home" (`glossary.md`, "box"); the two
    disagree today and one must change.
- **Vocabulary lock-ins.** None new; the glossary's "landmark" gloss moves
  onto the page.
- **First implementation chunk.** The copy and the two DOM tests that assert
  it, plus the display-path leak check still passing (no path in the copy).

### Track F — "The box can build you a page"

- **What.** The idea reaches the person two ways: the stock summary's last
  sentence (Track A) and a rule in the `what-can-you-do` skill. A third
  stock opener was considered and is question 6's alternative: a one-click
  "build me a page" on an empty box promises a flow the box has not been
  walked through, which the 2026-07-21 direction warns against.
- **Why.** Table row 11.
- **Direction.**
  - `content-what-can-you-do.ts`: one more bullet: "Say once that the person
    can ask for a page: 'When a list grows, ask me for a page that shows it
    the way you want.' When the box already holds a dozen cards of one kind
    with no view, make the offer concrete for that kind."
  - `what-you-could-do.md`, "Plans, and keeping track": add "what you owe
    and what's due" to the examples, and keep its line that the box does not
    yet anticipate: offer the list, not the reminder.
- **Vocabulary lock-ins.** None.
- **First implementation chunk.** The skill text and the package doc, and
  the knowledge audit (below).

## Could this be simpler?

The simplest version is Track A alone: a stock body and new empty copy, about
100 lines. It fails on three cases the walks reported, each traced to a
preference:

- Day two still says nothing about what is due (journey A's closing ask,
  "what's out, what I owe, what's due"). Track C is the cheapest answer: one
  line from the counts query the nav already mounts (principle 8).
- Browse still reads as the storage layout to a newcomer ("a filing cabinet,
  not a place for friendships"). Track D changes no server listing and
  invents no view; it changes which directory Browse starts on and which
  seeded folders fold. The smaller alternative, folding the four machinery
  areas even when nothing is prominent, is question 4's second option.
- On the test box the stock body is never seen, because arrival opens a
  marked card. Track B is one condition.

Considered and dropped as more than the plan needs: an onboarding card type
or directory (the 2026-07-21 idea), a first-run flag, a welcome dialog, a
home view card, and not seeding the template folders at init (`getBoxDir(` has 82
call sites outside tests; whether each tolerates a missing directory is
unverified, and the fold makes the question moot).

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| The agent records the purpose outside the briefing; stock summary and openers stay | No (the openers fix recorded this as residual) | The compiled `**Front page:**` line shows the agent the stock state every turn (Track A) | Clear to the agent; the person sees stale onboarding text until they say so |
| An existing box never gets the stock body (install is once; "a real landmark" is untouched) | Track A test for the repair branch | By design: an existing box's agent owns its body; the briefing rule still applies when the purpose is recorded | Silent and accepted: existing boxes have agents and cards already |
| Root arrival opens the page over a deliberately marked entry point | Track B test | The card leads under "Start here" | Clear |
| The count line and the nav badge disagree | No | Same query (`status.navStatus`), same invalidation | Cannot happen while both read it |
| `status.navStatus` fails | Track C DOM test | "Counts unavailable" with retry; distinct from zero | Clear |
| An inert root landmark with a person-written body is repaired | Track A test | Repair keeps the body and adds no stock text | Clear |
| The phone's empty chat shows stock text after the agent rewrote the body | Track A test on `stockSummary` | The flag is computed from the body on each openers read | Clear |
| A person's hand-made empty folder folds out of sight | Track D fold test (`taxes/` case) | Only seeded template paths fold | Cannot happen |
| A seeded folder holding only plain files (a PDF in `drive/`) folds | Track D test | It is in "N more" with its count; Raw and direct links show it | Clear, one click |
| Compact Browse on `_content` hides a stray root file | No | `bbx validate` reports it; Raw shows it | Clear through validate, silent in Browse |
| A folder with a card of an unknown type counts as non-empty and does not fold | Track D test | Intended: a file the person put there is theirs | Clear |
| The third opener reads wrong on a box whose purpose is not lending-shaped | No | The agent replaces all three when it records the purpose | Clear in the walk, cosmetic |
| Phone layout: no arrival, so the stock summary is not met | n/a | Chat shows the three openers | See Open design questions |

No critical gap: every row has handling or a test, and the two silent rows
are accepted with the reason beside them.

## Agent-flow / user-flow edge cases

- **Wrong field:** the agent writes the summary into `contains:` or the
  briefing body instead of the landmark body. ADDRESSED: the landmark schema
  instructions name the body as the place summary (`landmark.ts`, "where
  things stand goes in the place summary"); the compiled front-page line
  says where the stock text is.
- **Stale ref:** the plate view card is missing or renamed; the plate count
  opens nothing. GAP, small: `useOpenBeside` with a missing card shows the
  card's missing state; Track C's first chunk checks it.
- **Two agents touching the same card:** chat agent rewrites the root body
  while the reactor edits the landmark's links. ADDRESSED by the existing
  card edit path (parse, change, reserialize); same as any landmark edit
  today.
- **Hand-edit drift:** the boxholder edits the stock body by one word; the
  agent's "is it stock?" check fails and treats it as theirs. ADDRESSED and
  intended: an edited body is the person's.
- **Fabricated value:** none introduced; the counts are computed.
- **Validation error UX:** `createLandmarkTemplate({ body })` produces a card
  the landmark schema already accepts (body is free markdown). ADDRESSED.
- **Transition state:** boxes created before this plan have no stock body
  and keep today's behavior. ADDRESSED by design (see Failure modes).

## NOT in scope

- **Starters and the menu of flows** (first-run-experience; starter manifest
  issue): product work per flow; the stock summary only names three.
- **An onboarding directory or landmark, role-marked instructions, UI
  pointing, voice demonstration** (first-run-experience mechanism ideas):
  each is its own design; none is needed for the table's rows.
- **Agent-first turns** (box talks first): "incidental plumbing, not the
  feature" (boxholder, 2026-07-21); first-run-openers chose suggestions.
- **Renaming the root place or "landmark"**: boxholder decisions stand
  (slug label; "landmark" pending a better word).
- **Not seeding template folders**: unverified caller tolerance; the fold
  covers the symptom.
- **Reminders and notifications**: undesigned (`interaction-model.md`); the
  front door promises the list, not the nudge.
- **Search**: its own issue and card.
- **A today digest or dashboard redesign**: the today-view issue; the
  dashboard moved to the avatar menu by boxholder decision.
- **Phone-layout arrival**: decision c of landmark arrival.
- **Course landmarks**: courses are a plugin.
- **Existing boxes' root bodies**: their agents own them.

## Open design questions

Each is a choice for the discussion, with a lean and the consequence for a
person using the box.

### Decisions from the discussion (2026-10-19)

The boxholder settled these; the questions below stay as the record of the
alternatives.

- **Question 1:** yes, the stock summary (Track A).
- **Question 2:** yes, the root always opens its page (Track B).
- **Question 3:** the count line stays, but the word "plate" goes. The
  boxholder does not like the plate metaphor and said it is a term the
  agent focuses on more than they do. The line reads "3 to do · 1 overdue ·
  2 questions waiting". Renaming the stock todo view ("The Plate") and the
  "on your plate" summary wording elsewhere is a separate issue, not this
  plan.
- **Question 4:** Browse always starts at the person's content (Track D).
  Stated as a principle: the content root is where a person spends all
  their time; the other areas are for jumping out, an escape hatch, and
  nothing on the front door should send a person there.
- **Question 5b:** keep the slug; fix the glossary.
- Questions 5, 6, and 7 were not discussed; their leans stand.

1. **What the first page says on an empty box.** A "stock summary" is a
   short paragraph the box ships with in the root place's body; the agent
   replaces it when it learns the box's purpose.
   - *Stock summary on the root page (Track A).* Juni's first page says what
     the box is and three things to try; the words stop being stock at her
     first real conversation. Cost: about 190 lines.
   - *Chat-only orientation.* Richer text under the openers in the empty
     chat. Juni's first page stays "Nothing saved here yet"; day two is
     unchanged.
   - *On the phone,* where arrival opens no card: show the stock summary's
     first two sentences above the openers in the empty chat (Track A's
     phone part), or leave the phone's first screen as chat and openers.
   - **Lean:** the stock summary, on both layouts. The place page is already
     where desktop arrival puts the person, the body is already the agreed
     home for "where things stand", and the anchor issue asks for a sentence
     on the first screen, which on the phone is the chat.

2. **Whether the root always opens its page.** Today a place with exactly one
   marked entry point opens that card instead of the page.
   - *Root page always (Track B).* The front door is the page; a marked card
     leads it under "Start here". A person who marked one card as the thing
     to see first gets the page with that card at the top.
   - *Keep the rule* (decision 2 of 2026-10-08). A box with one marked card
     opens on that card; the summary and count line are one click away on
     the Box tab. The test box's case may be a poorly chosen entry point,
     not a wrong rule.
   - **Lean:** root page always; nested places keep the rule. Cost: one
     condition. This revisits a decision, so it is the boxholder's call.

3. **What day two shows.** The "count line" is the one-line count already
   shown on cards and folders ("3 on your plate · 1 overdue").
   - *Count line plus questions on the root page (Track C).* Tomas sees what
     is due and what the box is asking, where he is looking. Cost: about
     150 lines.
   - *Rely on the agent's summary.* The agent is already asked to keep the
     root body current; no new line. Fails when the agent has not updated
     it, and a count is a fact the page can state itself.
   - **Lean:** the count line.

4. **How much of the storage layout Browse shows, and to whom.**
   - *Browse starts on the person's content; the whole box is one link away
     (Track D).* Priya sees her folders; Idris clicks "Whole box". Everyone
     has both; direct links to any directory still work.
   - *Always fold the four machinery areas behind "N more", even on a new
     box.* Smaller change (the fold's early return); the newcomer still sees
     "Content/" as a folder name and the ten seeded folders inside it.
   - *Role-based: owners see the layout, members do not.* The UI does not
     know roles today; a new concept for one listing.
   - **Lean:** start on content, and fold seeded empty folders there.

5. **Which words change.** Proposed: the empty-state copy loses "card" and
   "folder /" and does not claim the folder is empty; "Find a landmark"
   keeps its name and gains the gloss "the places you jump to most" under
   it in the menu and on the page; "The Plate" stays.
   - The alternative is to rename "Find a landmark" to something like "All
     places"; the glossary says "place" appears in no label, so that is a
     glossary change first.
   - **Lean:** the proposed set only.

   5b. **What the root place is called.** The install names it for the box
   (the slug, so a fleet's tabs differ); the glossary says the root place is
   "Home". Both are recorded as boxholder decisions and they disagree.
   - *Keep the slug; fix the glossary.* The pill and menu say "juni-box";
     "Home" stays the label for a chat bound to no place.
   - *"Home" everywhere; the box name in the tab title only.* The pill says
     Home; the "Box: <name>" menu row carries the name.
   - **Lean:** keep the slug and fix the glossary; the walker's "three uses
     of box" complaint came from a fixture whose label was literally "Box",
     which a fresh box no longer does.

6. **How a person learns the box can build pages.**
   - *Two light mentions (Track F):* the summary's last sentence and a
     skill rule that offers a page when a kind of card grows. Juni meets the
     idea on day one and is offered it when it matters.
   - *Also a third stock opener* ("Build me a page for what I owe and what's
     due."). One click on day one; but it invites a flow nobody has walked
     end to end, which the 2026-07-21 direction warns against.
   - *A visible control* ("New page…" on the place page) that sends an
     opener. A new control for one sentence.
   - **Lean:** the two mentions.

7. **The agent's later summary on the phone.** Track A shows the stock text
   in the phone's empty chat; once the agent has written the real summary,
   the phone's first screen is chat and openers again, and the summary is on
   the Box tab. Should the agent's summary also show there? Lean: not now;
   walk the phone after this lands.

## Knowledge audits

Two new agent-facing rules get `knows_directly` entries in
`src/dev/knowledge-audits.yaml`:

- `front-door-stock-summary`: "You just recorded the box's purpose in the
  briefing. What else do you change, and where?" Correct: the root landmark's
  openers and its body (the stock summary), in the person's words.
- `front-door-offer-a-page`: "The box holds fourteen loan cards and no view
  over them. The person asks whether the stove is back. What do you offer
  after answering?" Correct: a page or view that shows what is out and what
  is due, offered, not built.

Both run against the worktree's test box clone before the plan is called
done; the status comment is recorded here. Run 2026-10-19 (Claude, a
disposable copy of the clone): both pass with no file reads. The offer-a-page
run answered first, then offered "a page that shows what's out" in one
sentence and said it would ask, not build; its first run failed only on a
too-narrow "does not build" pattern, loosened after reading the transcript.

## What will hold this after it ships

- `rootLineParts`, `arrivalTarget`, `foldListing`, and
  `createLandmarkTemplate` are pure; unit tests reach each decision.
- The place page and Browse copy: frontend DOM tests
  (`frontend-dom-harness.md`), one per surface; they are the regression
  anchor for the copy and the line's presence on the root only.
- The briefing and landmark instruction text: the `schemas.briefing-compile`
  test pins the opener list and gains the front-page line; the two knowledge
  audits check that an agent acts on the rule.
- The journey walks (`docs/plans/user-story-journeys.md`) are the tour; they
  are not the regression test.

## Implementation order

1. Track B (one condition, unblocks seeing Track A on the test box).
2. Track A: constant, template option, install and repair, briefing and
   landmark rules, compiled line, the phone's empty-chat sentences, tests.
3. Track E: copy and gloss, with Track A's text reviewed together on the
   exhibit.
4. Track C: `rootLineParts`, page wiring, DOM test.
5. Track D: fold change and tests; then Browse's start directory, crumb
   root, and "Whole box" row.
6. Track F: skill and package doc; knowledge audits run.
7. Docs: `landmarks.md` (place page, arrival), `box-layout.md` (Browse's
   view of the root), glossary note under "landmark", `what-you-could-do.md`.

## Rollout shape

Tests first: Track B's `forDir` case; Track A's fresh-box and repair cases
and the compiled line; Track C's `rootLineParts` cases; Track D's three
fold fixtures; Track E's two DOM assertions. Done when those pass, the two
knowledge audits pass against the test box clone, and the exhibit shows a
fresh throwaway box's first page and Browse beside the test box's. No data
shape changes; no migration. Existing boxes change behavior only in Browse's
compact root, the root arrival rule, the root page's count line, and the
empty copy.

## Scenario walks

Walked against the code on 2026-10-19; each hop names where it would run.

- **Juni, first open, desktop.** `/` → `main/router.tsx:105` redirect to
  `/chat` → fresh conversation, `unstarted` → arrival: no saved arrangement,
  `landmarks.forDir({ dir: "" })` → `arrival` is the landmark card (Track B)
  → `PlaceView` renders the body (Track A text) → `startSomething` hides
  "Start something" (same place, chat shows openers) → `placeSections`
  returns `empty` → `EmptyPlace` (Track E copy). The chat shows the two
  stock openers and "Start a conversation."
- **Juni, first open, phone.** Same route; the phone layout skips arrival
  (`arrival.ts`) → the empty chat (`messages.tsx:293`) reads `stockSummary`
  from the openers payload → two sentences above the openers.
- **Juni says what the box is for.** The agent edits the briefing →
  briefing path rule loads (`briefing.tsx` instructions) → it edits
  `_content/<slug>.landmark.card`: openers and body → the place page
  refetches on file change (`useRefetchOnFileChange`).
- **Juni, next morning.** Arrival again (new tab, no saved arrangement) →
  body is hers → Track C line from `status.navStatus` → "Also here" lists
  the cards (`payload.ts`, "Also here" group).
- **Priya, Browse.** Avatar menu → Browse card → `BrowsePage`, directory
  `_content` (new default) → `status.browse({ path: "_content" })` →
  `foldListing` folds the seeded empty folders → her folders and cards lead.
- **Idris, schedules.** Same page → "Whole box" row → directory `""` →
  `status.browse({ path: "" })` → five areas → Config → schedules.
- **Test box today.** Figure 1 of the exhibit: arrival opened "Card themes
  tour". After Track B it opens the Box page with that card under "Start
  here".
