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

## Revision of 2026-10-19 (after the first implementation)

The first implementation of this plan shipped on the branch (Tracks A–F,
commits `917676083`..`d7dd709e7`). The boxholder then read the stock
summary and gave three decisions that replace Track A:

- The first words are "a bit tool-centered". A box should not describe what
  it can do before it has heard what the person cares about. "A good
  starting conversation is 'what kind of things do you want to do here?'"
  (boxholder, 2026-10-19). Ideas come after hearing.
- "I'll keep it here and bring it back when you ask" is "bad language, very
  unclear. Really it's starting a conversation." The first screen is the
  start of a conversation, not a description.
- Every box can open with that as an active question, so "make the question
  system work for what we're doing. The box should start with questions, and
  the way those questions are presented in the beginning is how we do this
  onboarding" (boxholder, 2026-10-19, verbatim).

Also: "the voice interaction is non-obvious, and a walkthrough there could be
nice"; "maybe a 'Tell me about voice/talking' is a good addition".

Track A below is rewritten for that direction. Tracks B–F stand as shipped.
The parts of the shipped Track A that the new Track A removes are listed in
its "What comes out" bullet. The rest of this document is updated where the
old Track A reached it; the first-round text is kept where it still holds.

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

- When Juni opens her new box for the first time, I want the box to ask me
  what I want to keep track of here, with the cursor ready for my answer, so
  the first thing that happens is a conversation about my life and not a
  description of the software.
- When Juni has just answered, I want the agent to hear her out and then
  offer two or three things the box could do for that, so the ideas are
  about her and not a menu.
- When Juni would rather talk than type, I want one line that says talking
  is possible and shows her how, so the microphone is not a mystery button.
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
  the box to replace it with stock text. (Quiet; the engine never writes a
  root body over a written one, and it no longer writes a stock one.)
- When Tomas opens a chat on a box that has been running for a year, he does
  not want its first screen to interrogate him. (Quiet unless something is
  waiting: the chat shows a question only when one is pending, and one at a
  time.)

### Right place, right time

| Situation | Act, show, or quiet | Surface and card | Attention |
|---|---|---|---|
| Juni, first open | Show | The empty root chat: the box's pending question, "What do you want to keep track of here?", with the composer focused on it; the Box page beside it is empty but for "1 question waiting" | The chat is where she is looking; nothing pushes |
| Juni, just answered | Act | The agent's reply in chat: what it heard back in a sentence, then two or three offers for that | The conversation she started |
| Juni, would rather talk | Show on request | The opener "Tell me about talking instead of typing."; the agent's reply walks through the mic and answers aloud | Found by choice |
| Juni, next morning | Show | Root place page: the agent's summary, the count line, "Also here" | Waits to be found |
| Tomas, Sunday evening | Show | Root place page: count line; the Lending place's summary says what is out | Waits to be found |
| Priya, Browse | Show | Browse opens on her content; empty template folders fold behind "N more" | Waits to be found |
| Idris, schedules | Show on request | Browse's Raw switch shows the box root and its five areas | Found by choice |
| Juni, a dozen lines | Show | The agent's offer in chat when a kind of card grows (Track F) | The agent offers when a list grows |
| Priya, saved cards | Quiet | Her saved arrangement | Nothing new |
| Tomas's own words | Quiet | His summary stays | Nothing new |
| Juni, first open on the phone | Show | The same empty chat: the question, the composer, the voice opener | The first screen is the chat; no card opens |
| Tomas, year-old box, a question pending from a triage run | Show | The empty chat shows that question the same way, with "and 3 more" to the Questions page and "Not now" | One question, not the queue |

The onboarding question is written once, at `bbx init`, as a pending
question card in `_bookkeeping/questions/`, the only place the system looks
for questions (`docs/questions.md`, "Where questions live"). It is answered
the way the person answers anything: by talking in the chat. The agent, once
it has heard enough, marks the card answered and does what the card's
`directive:` says, in the same conversation. The stock openers retire at the
same moment (`briefing.tsx:101-104`, the rule as shipped).

### Spirit

- **Serves:** "The best stuff comes from the people": the first words on the
  screen are a question to the person, and the first words written into the
  box are theirs. The agent's ideas follow what it heard.
- **Serves:** "It should feel like a place": the Box page fills with the
  person's words once they have answered; "tell the story of how it got
  there" is the summary's job once the agent writes it.
- **Serves:** "It should feel possible": the offers after the answer, and
  the voice walkthrough, are "oh, I could do *that*?" moments tied to what
  the person said.
- **Risks:** a question on the first screen can read as a form. Guard: it
  is one line in the agent's voice, answered in the composer like any
  message, with no field, no submit, and a quiet "Not now".
- **Risks:** "You should be able to see the gears": hiding the layout from
  Browse hides where things live. Guard: the Raw switch shows the whole box
  root; nothing is removed, only led with content.

### Trust

Shows a question and takes no action until the person answers. The
question card is template content installed once, pending, with no
notification: `checkPendingQuestionsAndNotify` runs from wakeup
(`question-alert.ts`), and a fresh box has no wakeup schedule enabled
(`defaults.ts:329-412`: only `refresh-maps`, `gc-procedure-runs`, and
`process-retrospective` are `enabled: true`), so the box does not push "you
have a question" at someone who has not opened it. The agent marks the card
answered only after hearing the person; the answer it records is their
words. The agent's later rewrite of the Box page follows the place-summary
rule already decided: keep any sentence the person wrote, ask before
removing it (`place-shows-cards.md`, "Trust").

### When it goes wrong or does nothing

- **The agent hears the answer but never marks the card answered:** the
  question is still pending, so the next empty chat asks it again. The
  chat-prompt rule tells the agent that a pending question whose answer the
  briefing already holds is answered from the briefing, not re-asked
  (`guide.md:301-306`, "check existing", extended). The person can also say
  "you asked me that" and the agent answers the card.
- **The person does not want to answer:** "Not now" dismisses the card
  (`actions.dismiss`); a dismissed question leaves the chat's empty state
  and stays answerable on the Questions page (`docs/questions.md`,
  "Lifecycle"). Nothing nags: the aging nudge needs a wakeup.
- **An existing box has a long pending backlog** (the test box has 39): the
  chat shows one question, the newest pending, with "and 38 more" to the
  Questions page. Question 10 below is whether existing boxes take part at
  all.
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
  front door there is the chat, which is where the question is, so the phone
  and the desktop show the same first screen. The agent's later summary is
  not shown in the chat: the Box tab is one tap away (decision c).

### Walkthrough

Juni, a new box, desktop layout.

1. She opens the box. The index redirects to `/chat`, a fresh chat; arrival
   finds no saved arrangement and opens the root arrival target, which is now
   always the root place page (Track B).
2. The page shows the root label, "1 question waiting" (Track C), and
   "Nothing to show here yet" (Track E). The chat beside it shows one line
   in the agent's voice, "What do you want to keep track of here?", the
   composer focused with that question as its placeholder, and one opener
   under it, "Tell me about talking instead of typing." (Track A).
3. She types "mostly what I lend people and what I owe". The message goes to
   the agent with the snapshot saying which question it answers. The agent
   asks one thing back ("Just things, or money too?"), hears "both", then
   marks the card answered with her words, writes the purpose into the
   briefing, writes two sentences on the Box page in her words, swaps the
   stock openers for lending ones, and offers two things: a place for loans
   as they happen, and a page of what is out when the list grows.
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

**Smallest fix.** Seed one pending question at init and show the newest
pending question in the empty root chat as text with the composer focused,
no select or confirm rendering, no voice opener. About 120 source and 80
test lines. It gives a new box its first question and nothing else in the
table.

**Chosen design.** Six tracks. Tracks B–F are shipped (about 700 lines).
The revised Track A is about 520 lines of change, of which about 150 remove
the shipped stock summary; total for the plan about 1,200 changed lines
(additions plus deletions), not a BIG CHANGE.

| Track | Source | Tests | What it buys |
|---|---|---|---|
| A. The box starts with questions; the empty chat asks them | 330 (incl. 150 removal) | 190 | A new box opens as a conversation about the person; every pending question has a place to be answered where the person already is |
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
- **Person first, ideas after hearing (boxholder, 2026-10-19):** the first
  screen asks what the person wants to keep track of; the box offers what it
  can do only after it has heard. The revised Track A and Track F's new
  skill rule follow this. It sharpens the 2026-07-21 "no menu" direction:
  not even a short menu, until the person has spoken.
- **The question system is the onboarding (boxholder, 2026-10-19):** "the
  box should start with questions, and the way those questions are
  presented in the beginning is how we do this onboarding." Track A builds
  the presentation on `_bookkeeping/questions/` rather than on a stock body
  and a text-equality flag.
- **In-chat question tag, rejected 2026-07-10** (`issues/closed/features/2026-06-09-in-chat-interactive-questions.md`,
  wontfix: "synchronous chat is a different situation from the async
  question queue — in chat the agent just asks in prose"). This plan
  reopens part of it and says which part: the agent still asks in prose in
  chat and creates no card for it, and the chat gets no option buttons or
  structured reply (the review of 2026-10-19 held that buttons for every
  pending card would be the rejected structured answer by another name).
  What changes is where a *pending card* can be answered: the chat's empty
  state shows the newest one as text, and the person answers in words. The
  boxholder's 2026-10-19 direction ("the box should start with questions,
  and the way those questions are presented in the beginning is how we do
  this onboarding") is the authority for that much. `docs/questions.md`
  ("Surfacing") already names inline questions in chat as the intended
  replacement for the retired header badge while its "NOT in scope" rejects
  them; Track A's docs item reconciles the two with this split.

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

- The question system (`docs/questions.md`; `src/schemas/question.ts`):
  text, select, and confirm questions; `createTextQuestionTemplate` and
  siblings (`question.ts:201-252`) with `memo`, `prompt`, `directive`,
  `learning`, `askedAt`; state derived from timestamps (`questionState`,
  `question.ts:97`); `answer` allowed from pending, expired, or dismissed
  (`answer.ts`), always writing a follow-up job (`answer.ts:252-260`);
  `answered-via` is `web | cli` (`question.ts:150`); the tRPC
  `actions.answer` and `actions.dismiss` (`routers/actions.ts:22-48`);
  `status.questions` returning every card with `state`, `prompt`, `memo`,
  `inputType`, `options`, `answer` (`status.ts:225-249`, `state.ts:154-157`);
  `QuestionForm` dispatching on input type (`QuestionForm.tsx:252-266`);
  `QuestionCardView` as the card renderer; the nav count `pendingQuestions`
  (Track C's line already shows it). Follow-up jobs run in the reactor cycle
  from `bbx wakeup` (`reactor/engine/cycle.ts`, `wakeup/job-refs.ts`), which
  a fresh box has no schedule for (`defaults.ts:329-412`), or from the web's
  `wakeup.force` mutation (`routers/wakeup.ts:63-80`), which nothing in the
  front door calls.
- The `<chat-app>` snapshot (`chat/session/prompts.ts:120-143`): each user
  message is prepended with situational attributes the frontend declares on
  send (`openCard`, `cardActivity`, `cardState`, `channel`;
  `chat/session/messages.ts:86-112`); the send payload is part of the mobile
  contract (`docs/mobile-contract.md:993`), where an optional field is an
  additive change.
- The chat's empty state (`InteractiveChat/messages.tsx:148-162`,
  `EmptyChat`): openers as buttons (`ChatOpeners`), "Start a conversation.",
  and, as shipped in round one, the stock summary's lead sentence. The
  composer placeholder is "Type a message..." (`InteractiveChat-composer/view.tsx:123`,
  `InteractiveChat-mobile-row.tsx:66`).
- Agent-side: `bbx answer` and `bbx dismiss` exist as agent-audience
  commands (`surface-data.ts:75`); the guide's QUESTIONS section
  (`guide.md:290-317`) tells the agent to ask in prose in chat and to check
  existing cards before asking.

## Prior art (external)

No decision here depends on an external premise. The one pattern borrowed is
ordinary: a file manager that opens on the user's home folder rather than the
filesystem root. Evaluated-only; no acknowledgement entry.

## Ontology

- **Root place** (exists): the directory `""`, whose landmark card is
  `_content/<Name>.landmark.card` (`root-dir.ts`). Its label is the box slug.
- **Place summary** (exists, `place-shows-cards.md`): the landmark card's
  body, agent-written markdown.
- **Onboarding question** (new term, no new field or type): a pending
  question card `bbx init` writes to `_bookkeeping/questions/`, like any
  other question. It is "onboarding" only by being the first pending
  question a new box has; nothing marks it. The shipped **stock summary**
  (`STOCK_ROOT_SUMMARY`, the text-equality flag `stockSummary`, the
  compiled `**Front page:**` line) comes out.
- **The chat's open question** (new presentation, no new noun in the UI):
  the newest pending question, rendered in the empty root chat as the
  agent's line, with its answer taken from the composer (text), from option
  buttons (select), or Yes/No buttons (confirm). The person sees a question
  and a place to answer; "question card" is never said.
- **Answering in chat** (new `answered-via` value `chat`): the agent marks
  the card answered from the conversation with `bbx answer --via chat`,
  which records the answer and writes no follow-up job, because the agent
  applies the directive and learning in the same conversation (question 9
  below).
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

### Track A — The box starts with questions; the empty chat asks them

- **What.** `bbx init` writes one pending question card. The empty root chat
  shows the newest pending question as the agent's opening line and takes
  the answer from the composer or from option buttons. The agent, having
  heard the person, marks the card answered from the conversation and acts
  on it there. The shipped stock summary comes out.
- **Why.** The first screen says nothing about what this is (table, row 3),
  and the boxholder's decisions of 2026-10-19 (Revision, above): the first
  screen is the start of a conversation, person first, and the question
  system is the onboarding.
- **Direction.**
  - **Seed.** `installRootQuestion` in `defaults.ts`, beside
    `installRootLandmark`, writes
    `_bookkeeping/questions/<stamp>-what-to-keep-track-of.question.card` with
    `createTextQuestionTemplate` (`question.ts:227`): `prompt` "What do you
    want to keep track of here?"; `memo`, in the agent's voice, one sentence
    ("I'd like to know what this box is for before I suggest anything.");
    `learning: { sink: briefing, proposal: "This box is for <what the person
    said>." }`; `directive`: "Write the purpose into the briefing in the
    person's words, write two or three sentences on the Box page (the root
    landmark's body) in their words, and replace the stock openers with ones
    for what they said." `expires-after` is left to the default. Aging runs
    at `bbx finalize` on the wakeup cadence (`docs/questions.md`, "Aging"),
    and a fresh box has no wakeup schedule enabled, so on such a box the
    question stays pending, and stays the first screen, until it is answered
    or dismissed. That is the intended behavior: a box that has never been
    told its purpose keeps asking, quietly, with "Not now" one tap away.
    Fresh install only; the repair path does not seed, and
    a box that already has questions is untouched. The install is
    idempotent by filename stamp like the other seeded files.
  - **Which question the chat shows.** `status.questions` already returns
    every card with `state`, `prompt`, `memo`, `inputType`, `options`
    (`status.ts:225-249`) but not `asked-at`; `QuestionInfo`
    (`status.ts:36-43`) gains `askedAt?: string` read from the card. The
    chat's shell (`InteractiveChat/shell.tsx`, which already queries
    `landmarks.forDir` for the openers) adds `trpc.status.questions.useQuery`
    and picks the newest pending by `askedAt`, then by path; a card marked
    `invalid` (`status.ts:44-49`) is never shown in the chat, since it has
    no prompt, and counts toward "and N more" so it is still reachable. One
    question at a time; the count of other pending ones shows as "and N
    more", a link to the Questions card (`SYSTEM_CARD_PATHS.questions`)
    through `useOpenBeside`.
    Only the root chat (`contextDir === ""`) shows a question; a place's
    chat shows its openers as today. Only an unstarted chat shows it: once
    a message exists, the empty state is gone.
  - **How it looks.** `EmptyChat` (`messages.tsx:148-162`) gains
    `openQuestion?: OpenQuestion | null`. It renders the `prompt` as one
    line in the agent's voice where the stock lead was, with the `memo`
    under it in the quiet style when the card has one (the Questions page
    shows the memo for the same reason, `QuestionForm.tsx:48`: the person
    should know what "this" is before answering). The presentation is text
    for every input type: a `select` question's options are listed in the
    line itself ("Finance, Personal, or something else?") and a `confirm`
    question reads as a yes-or-no sentence; the person answers by typing or
    speaking, and the agent passes the label when it answers the card
    (`resolveSelectAnswer` already matches typed labels, `answer.ts:60-80`).
    No option buttons: that would be the in-chat structured answer the
    2026-07-10 decision rejected, and typing works for every type
    (question 13). The composer's placeholder becomes the prompt and the
    composer is focused (the composer already takes a placeholder,
    `InteractiveChat-composer/view.tsx:123`, and the mobile row the same,
    `InteractiveChat-mobile-row.tsx:66`). A quiet "Not now" calls
    `actions.dismiss`. Clicking the line focuses the composer. The openers
    render beneath, then "Start a conversation." as today.
  - **How the answer travels.** The person's message is an ordinary chat
    message. The send payload gains an optional `openQuestion?: string`
    (box-relative card path): the client sends it on *every* message in the
    root chat while the shown question is still pending, not only the first,
    so the agent that missed it on one turn still sees it on the next. It
    surfaces on the `<chat-app>` snapshot as `open-question="…"`, next to
    `open-card`. The field has the same hops as `openCard`, each named here
    because a field added to only two of them is silently dropped: the HTTP
    parser (`webapp/routes/chat/helpers.ts`), `ChatSendInput`
    (`chat/session/messages.ts:86-112`), the queued-send combiner
    (`chat/session/state.ts:213-222`, which rebuilds its output from named
    fields; latest wins, as for `openCard`), snapshot assembly
    (`chat/session/run/start.ts:205-222`, `composeSendSnapshot`), and the
    prompt's snapshot section (`prompts.ts:120-143`). The server does not
    mark the card answered on send: the agent does, after hearing.
    Additive change to the mobile contract (`mobile-contract.md:993`); the
    iOS app sends nothing and is unaffected (bbx-ios-overlap).
  - **How the agent answers.** `bbx answer` gains `--via chat`
    (`answered-via` enum gains `chat`, `question.ts:150`). With `via: "chat"`
    the command records the answer and writes no follow-up job
    (`answer.ts:252-260` becomes conditional). The order of operations is
    the durable path: the agent **does the directive first, then answers
    the card**. While the work is not done the card is still pending, and
    the pending card is the work item: the chat shows it again, and the
    snapshot keeps naming it. An answered card is terminal
    (`docs/questions.md`, "Lifecycle"), so answering is the last step, never
    the first. The chat system prompt (`chat/session/prompts.ts`) gains a
    short section, "An open question in this chat": when the snapshot names
    `open-question`, read the card; hear the person out (one follow-up at
    most before acting); do what its `directive:` says and record its
    `learning:` as a `user-stated` fact; then `bbx answer <path> --via chat
    "<their answer in their words>"`. If the briefing already holds the
    answer, answer the card from the briefing without asking again
    (`guide.md:301-306`). A message under `narration="on"` never answers a
    card (`prompts.ts:196-200`: the person is thinking aloud and does not
    expect replies); the agent waits for a message that is a reply. In a
    shared chat the `user` attribute names who answered, and the answer text
    records it ("Juni: mostly lending"); anyone in the chat may answer, as
    anyone in the chat may edit the briefing. Never create a question card
    for something asked in chat (`guide.md:294-296`, unchanged).
  - **The agent's first reply.** The same prompt section says: after the
    answer, reflect it back in a sentence and offer two or three things the
    box could do for *that*, in the person's terms; no capabilities before
    hearing (Track F's skill rule carries the same rule for later turns).
  - **Voice walkthrough.** `STOCK_ROOT_OPENERS` (`landmark.ts:111-114`)
    becomes one opener, "Tell me about talking instead of typing." "Let me
    tell you what this box is for." goes: it is the question's answer in
    another form. "What can you do?" goes: tool-centered. The
    `what-can-you-do` skill (Track F) gains the walkthrough rule: tap the
    mic, say a sentence, tap again; the agent answers the first spoken
    message aloud (`<speech>`); on a desktop with no microphone permission
    yet, say what the browser will ask.
  - **What comes out** (shipped in round one): `STOCK_ROOT_SUMMARY`,
    `STOCK_ROOT_SUMMARY_LEAD`, `isStockRootSummary`
    (`src/shared/stock-root-summary.ts`); the body on fresh install
    (`defaults.ts`, both `createLandmarkTemplate({ ...template, body })`
    calls; the repair path keeps a written body as fixed in round one);
    `LandmarkPayload.stockSummary`; `FRONT_PAGE_STOCK_LINE` and
    `compileBriefing`'s `stockSummary` option; `readRootPlace` returns to
    openers only; `EmptyChat`'s `stockSummaryLead`; the briefing rule text
    about "replace its stock summary" becomes "when the root question is
    answered, write the purpose and the Box page in the person's words and
    retire the stock openers". `createLandmarkTemplate({ body })` stays: it
    is correct and tested, and the agent's templates may use it.
  - **Docs.** `docs/questions.md` "Surfacing" gains the chat's empty state
    as a surface and its "NOT in scope" item is reworded to say what stays
    rejected (an in-chat question *tag*) and what this adds (answering a
    *pending card* from the chat); `docs/landmarks.md` loses the stock
    summary paragraph and gains the opener change; the glossary gains a
    "question" entry in the user-facing register ("something the box is
    waiting to hear from you"; never "question card" to the person);
    `box-docs/card-question.md` gains `--via chat`.
- **Vocabulary lock-ins.** `installRootQuestion`; the send-payload field
  `openQuestion` and snapshot attribute `open-question`; `QuestionInfo.askedAt`;
  `answered-via: chat`; `EmptyChat.openQuestion`; the labels "and N more",
  "Not now", and the opener "Tell me about talking instead of typing."
- **First implementation chunk.** The seed with a `t.check` test (fresh box
  has one pending text question with the prompt, learning sink `briefing`,
  and a directive; repair seeds nothing; a box with questions is untouched);
  `answered-via: chat` with the no-job branch and a test (a chat answer
  records the answer and leaves `_bookkeeping/jobs/` empty; a web answer
  still writes the job); the `open-question` field through every hop, with
  a combiner test (two queued sends, the first carrying it, the combined
  input keeps it) and a snapshot test; `askedAt` on `QuestionInfo` with a
  test whose filenames sort opposite to their `asked-at` values; then the
  chat empty state with a DOM test for a text question, a select question
  listed inline, the memo line, the "and N more" count, the invalid-card
  case, and the place-chat quiet case. The removal of the stock summary is
  the first commit, so the tree never carries both.

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

- **What.** The idea reaches the person two ways: the agent's offers right
  after the person answers the opening question (Track A's prompt rule) and
  a rule in the `what-can-you-do` skill. A third
  stock opener was considered and is question 6's alternative: a one-click
  "build me a page" on an empty box promises a flow the box has not been
  walked through, which the 2026-07-21 direction warns against.
- **Why.** Table row 11.
- **Direction.**
  - `content-what-can-you-do.ts`: two more rules. "Ideas after hearing: do
    not list what the box can do until the person has said what they care
    about; when they ask what the box can do on a box whose purpose is
    blank, ask the open question first." And the voice walkthrough (Track
    A): tap the mic, say a sentence, tap again; answer the first spoken
    message aloud; on a desktop without microphone permission, say what the
    browser will ask.
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

The simplest version is the round-one Track A: a stock body and new empty
copy, about 100 lines. It shipped, and the boxholder rejected it on the
2026-10-19 preferences above (tool-centered, not a conversation). The
revised Track A's own simplest form is the "Smallest fix" above: one seeded
question shown as text in the empty chat. The fuller track adds select and
confirm rendering (so every pending question can be answered there, not
only the onboarding one, which is what "the question system is the
onboarding" asks for), the snapshot attribute (so the agent knows what it is
hearing), and `--via chat` (so a chat answer does not leave a job that no
fresh box runs). It still fails on three cases the walks reported, each
traced to a preference:

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
| The agent hears the answer, does the work, and never runs `bbx answer` | Knowledge audit `front-door-answer-in-chat` | The card stays pending; the chat shows it again and the snapshot keeps naming it; the "answer from the briefing" rule closes it next time | Clear to the agent; the person may see the question once more |
| The turn stops between the directive and `bbx answer` | The audit checks the order; no unit test can | Same: pending card, work partly done; the agent finishes from the briefing | Clear to the agent |
| An existing box with a pending backlog opens on a stale triage question | Questions 10 and 11 record the choice | One question, its memo under it, "and N more", "Not now" | Visible |
| Root arrival opens the page over a deliberately marked entry point | Track B test | The card leads under "Start here" | Clear |
| A chat answer leaves a follow-up job no fresh box ever runs | Track A test: chat answer writes no job | `--via chat` skips the job; the agent applies the directive in the conversation | Cannot happen; a web or CLI answer keeps its job |
| The agent answers the card before hearing enough | Chat-prompt rule: one follow-up at most, then answer | An answered card is terminal (`docs/questions.md`, "Lifecycle": "A new question is asked instead of reopening one"); the briefing and the Box page stay editable in the same conversation, so a correction is one more sentence from the person | Visible in the agent's reflected-back sentence |
| A select question has many or long options | DOM test with six options | Options are listed inline as text; above six the line says "…or one of N more, on the Questions page" with the link | Visible: the link |
| The count line and the nav badge disagree | No | Same query (`status.navStatus`), same invalidation | Cannot happen while both read it |
| `status.navStatus` fails | Track C DOM test | "Counts unavailable" with retry; distinct from zero | Clear |
| An inert root landmark with a person-written body is repaired | Round-one test (kept) | Repair keeps the body and adds no stock text | Clear |
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
- **Two people share the chat** (`user` attribute on messages): the first
  to answer answers; the agent records whose words they were in the answer
  text.
- **The person answers a different question than the one shown** (types
  about something else): the agent reads the message, not the attribute, as
  the truth; if it is not an answer, it does not mark the card and replies
  to what was said. The question shows again next time.
- **Narration on** (`narration="on"`): the open question is still shown, but
  the agent's reply follows the narration rule (silent by default,
  `prompts.ts:200`); it marks the card when the narration clearly answers
  it, else leaves it.
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
- **An in-chat question tag** (the agent asks mid-conversation with
  structured options): rejected 2026-07-10; the agent asks in prose. This
  plan surfaces pending *cards*, nothing more.
- **Seeding the onboarding question on existing boxes**: question 10's
  alternative; not done unless chosen.
- **A second onboarding question** ("who are you", "what should I call
  you"): one question is the conversation's start; more would be a form.
  The agent asks the rest in prose as it comes up.
- **Running the follow-up job from the web after a web answer** (the
  `wakeup.force` mutation): the Questions page's existing gap, not the front
  door's.

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

Later the same day, after seeing the shipped stock summary (Revision, above):

- **Question 1, reopened:** the stock summary is withdrawn. The first screen
  is a question the box asks and the person answers in the chat, built on
  the question system (Track A, revised). Questions 8–12 below are the
  choices inside that.
- **Question 6, amended:** the voice walkthrough is a stock opener, "Tell
  me about talking instead of typing."; "What can you do?" and "Let me tell
  you what this box is for." go.

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

8. **Who marks the card answered.** The person types in the chat either way.
   - *The agent, after hearing (Track A).* The conversation can go one more
     turn before the card is answered; the recorded answer is the person's
     words as the agent heard them. The agent must remember to do it; the
     "answer from the briefing" rule covers a miss.
   - *The UI, on send.* The first message is written to the card as the
     answer, immediately, with the web path's follow-up job. Simple and
     certain, but "mostly lending… wait, also money" is two messages and one
     answer, and the job runs only at a wakeup a fresh box does not have.
   - **Lean:** the agent.

9. **Whether a chat answer writes a follow-up job.**
   - *No job for `--via chat` (Track A).* The agent applies the directive in
     the conversation. A miss is caught by the retrospective, which already
     mines chats for learning (`glossary.md`, "retrospective").
   - *Always a job.* One path for every answer; on a fresh box the job sits
     in `_bookkeeping/jobs/` until a wakeup, and the stalled-jobs health
     check (`health/checks/stale.ts:62`) reports it after its threshold.
   - **Lean:** no job for chat.

10. **Whether existing boxes take part.** "Every box can open with that as
    an active question" (boxholder).
    - *Every box shows its newest pending question in the empty root chat
      (Track A).* The test box would open with the newest of its 39. A
      year-old box with nothing pending shows openers as today.
    - *Also seed the onboarding question on existing boxes whose briefing
      has no purpose.* Every current box asks it once. A migration, and a
      box whose purpose is simply unrecorded gets asked by surprise.
    - *New boxes only.* Existing boxes' queues stay on the Questions page.
    - **Lean:** the first. Showing is cheap and reversible ("Not now"); seeding
      is a migration and is not.

11. **Which pending question shows when several are pending.**
    - *Newest pending.* The freshest thing the box wanted to know; old ones
      are aging toward expiry anyway.
    - *Oldest pending.* Queue order; on a backlog box the first screen is
      the stalest question.
    - **Lean:** newest.

12. **Where the agent learns that a message answers a question.**
    - *The `<chat-app>` snapshot (Track A).* The attribute travels with
      every message while the question is pending, like `open-card`; one
      additive field in the send payload, carried through its five hops.
    - *The compiled briefing lists pending questions.* No payload change,
      but the agent has to guess which message answers which, and the
      briefing compiles at session start, not per message.
    - **Lean:** the snapshot.

7. **The agent's later summary on the phone.** Withdrawn with the stock
   summary: the phone's first screen is the chat, which asks the question
   while one is pending and shows the openers after. The Box tab holds the
   summary.

13. **How a select or confirm question is answered in the chat.**
    - *Text only (Track A).* Options are listed in the question's line; the
      person types or says one; the agent passes the label. No new control,
      and the 2026-07-10 decision against structured in-chat answers stands.
    - *Option buttons.* `ChatOpeners` already renders a row of buttons, so
      the cost is small; a tap is faster than typing on the phone. It is the
      structured answer that decision rejected, for every pending card.
    - **Lean:** text only, and revisit buttons as their own question once
      pending questions have lived in the chat for a while.

## Knowledge audits

Two new agent-facing rules get `knows_directly` entries in
`src/dev/knowledge-audits.yaml`:

- `front-door-answer-in-chat` (replaces `front-door-stock-summary`, which
  audited the withdrawn stock summary): a chat-mode prompt whose
  `<chat-app>` snapshot names `open-question` and whose message is
  "mostly what I lend people and what I owe". Correct: hears them out (at
  most one follow-up), then `bbx answer … --via chat` in their words, writes
  the briefing purpose and the Box page, retires the stock openers, and
  offers two or three things for lending; does not list capabilities first
  and does not create a question card.
- `front-door-offer-a-page`: "The box holds fourteen loan cards and no view
  over them. The person asks whether the stove is back. What do you offer
  after answering?" Correct: a page or view that shows what is out and what
  is due, offered, not built.

Both run against the worktree's test box clone before the plan is called
done; the status comment is recorded here. Round one, 2026-10-19 (Claude, a
disposable copy of the clone): `front-door-stock-summary` and
`front-door-offer-a-page` both passed with no file reads. The offer-a-page
run answered first, then offered "a page that shows what's out" in one
sentence and said it would ask, not build; its first run failed only on a
too-narrow "does not build" pattern, loosened after reading the transcript.
`front-door-answer-in-chat` has not run yet.

## What will hold this after it ships

- `rootLineParts`, `arrivalTarget`, `foldListing`, and
  `createLandmarkTemplate` are pure; unit tests reach each decision.
- The place page and Browse copy: frontend DOM tests
  (`frontend-dom-harness.md`), one per surface; they are the regression
  anchor for the copy and the line's presence on the root only.
- The briefing and landmark instruction text: the `schemas.briefing-compile`
  test pins the opener list; the chat prompt's "Answering a question in
  chat" section is pinned by the prompt test that exists for its siblings;
  the two knowledge audits check that an agent acts on the rules.
- The seed, the no-job answer branch, and the snapshot attribute: unit tests
  in `defaults.landmark.test.ts`, `answer` tests, and the snapshot test.
- The journey walks (`docs/plans/user-story-journeys.md`) are the tour; they
  are not the regression test.

## Implementation order

Tracks B–F are shipped on the branch. The revised Track A, in order:

1. Remove the stock summary (one commit): the constant and its module, the
   install body, the payload field, the compiled line, the chat's lead
   sentence, and their tests; `createLandmarkTemplate({ body })` and the
   repair fix stay.
2. Seed: `installRootQuestion` and its tests.
3. `answered-via: chat` and the no-job branch; `bbx answer --via chat`.
4. The send-payload field and the `<chat-app>` attribute, with the mobile
   contract note.
5. The chat empty state: `openQuestion`, text/select/confirm, "and N more",
   "Not now", composer placeholder and focus; DOM tests.
6. Openers: one stock opener; the briefing and landmark rule text.
7. The chat prompt section and the skill rules (ideas after hearing; voice
   walkthrough); the knowledge audit `front-door-answer-in-chat` run.
8. Docs: `questions.md` (surfacing, NOT in scope wording), `landmarks.md`,
   glossary "question", `card-question.md`.

## Rollout shape

Tests first: Track B's `forDir` case; Track A's seed, no-job answer, and
snapshot cases and its empty-chat DOM cases; Track C's `rootLineParts`
cases; Track D's three fold fixtures; Track E's two DOM assertions. Done
when those pass, the two knowledge audits pass against the test box clone,
and the exhibit shows a fresh box's first screen on desktop and phone, the
agent's first reply after an answer, and Browse. Data shape: `answered-via`
gains a value and the send payload an optional field; no migration.
Existing boxes change behavior in Browse's root, the root arrival rule, the
root page's count line, the empty copy, and, per question 10, the empty
root chat showing their newest pending question.

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
