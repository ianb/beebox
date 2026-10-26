---
title: "Questions open beside the chat"
status: draft
workstream: front-door
issues: []
---
# Questions open beside the chat

A new root chat opens the newest pending question as a card beside the chat
instead of writing it into the empty chat. The person answers it by talking in
the chat or declines it by closing its tab, and the agent decides whether a
message answers it. This replaces the empty-chat question line from
[front-door](../implemented-plans/front-door.md), Track A.

**Issues addressed:** none filed. The trigger is the boxholder's report of
2026-10-25 (private box, details not recorded here): an old, long agent-filed
question led the empty root chat, under it "Not now" and the openers. Related,
not closed by this plan:
[mobile-modal-not-split-pane](../../../issues/features/2026-07-23-mobile-modal-not-split-pane.md)
(the phone already shows one card with the composer under it, which this plan
relies on). Searched the queue for "pending question", "question card",
"questions page", "empty chat": no duplicate.

## Design

### Situations

- When Juni opens her new box for the first time, I want the box's question,
  "What do you want to keep track of here?", in front of me with the cursor in
  the composer, so the first thing that happens is a conversation about my life.
- When Tomas starts a new chat on a box that has run for a year and the triage
  agent filed a question last night, I want that question beside the chat, so
  the empty half of the screen holds something the box needs from me.
- When Tomas reads that question and does not want to deal with it, I want to
  close it the way I close any tab and know that this means "not now", so I
  can get on with what I opened the chat for.
- When Tomas types into the chat while the question is beside it, I want the
  agent to treat the message as probably an answer, and to tell me when it
  recorded it, so I do not answer twice or wonder whether it counted.
- When Tomas asks the agent "what was that question about the timezone?" in
  the middle of a long chat, I want it to bring the question back beside the
  chat, so I can answer it now even though I closed it last week.
- When Priya opens a chat beside the Admin page to change a setting, she does
  not want a question pushed over it. (Quiet: arrival never adds to a
  workspace that has cards; `arrival.ts:19`.)
- When Priya returns to a chat she was in yesterday, she does not want a
  question. (Quiet: a chat with a saved arrangement does not arrive;
  `workspace-browser-store.ts:131`.)

### Right place, right time

| Situation | Act, show, or quiet | Surface and card | Attention |
|---|---|---|---|
| Juni, first open | Show | Desktop: the question card in the card pane, the Box page as a second tab behind it, cursor in the composer. Phone: the question card on screen, composer row under it | Fills the empty space; nothing else competes |
| Tomas, new chat, questions pending | Show | Same, with the newest pending question | Waits beside the chat; no notification |
| Tomas, does not want it | Act on his close | Closing the question's tab dismisses the card; the Box page tab is under it on desktop | His gesture |
| Tomas, types a reply | Act | The agent reads the open card, decides, and says one line when it records an answer; the card turns into its answered view | The conversation he started |
| Tomas, brings one back | Show on request | The agent links the card; the link opens it beside the chat (existing link behavior) | Found by asking |
| Priya beside Admin, Priya returning | Quiet | No question opens; the app bar's questions count keeps the number (`AttentionBadgesFace.tsx:75`, `id="bbx-nav-questions"`) | Background |

A new root chat with an empty workspace is the moment: the person has opened a
blank conversation, and the screen has room the box would otherwise fill with
the Box page. A chat opened beside a card, or a chat with history, already has
a subject, so the box stays quiet there.

### Spirit

- **Serves:** "Feedback is everywhere, and it's not all commands"
  (`docs/architecture/spirit.md`): the person answers in their own words in the
  chat, and the agent decides what the words mean.
- **Serves:** "People aren't broken versions of their better selves": closing a
  question is a normal choice with no follow-up nag; the question stays
  answerable (`docs/questions.md`, Lifecycle: "Dismissed questions **remain
  answerable**").
- **Risks:** "It should feel like a place": every new chat on a lived-in box
  opens with a question, which can feel like a queue being pushed at the
  person. Guard: one question per new chat, closing it is one gesture, and the
  box stays quiet whenever the person already chose what to look at. The
  backlog policy (many pending questions) is deferred; see NOT in scope.

### Trust

Shows only. The box takes no action on the person's behalf. Two acts move
state, and both are the person's:

- Closing the tab of a pending question dismisses it. This is the existing
  Dismiss transition (`actions.dismiss`), reversible by answering later.
- A chat message answers the question only when the agent judges that it does
  (`prompts.ts:195`, kept in substance). The agent says so in one line, so a
  wrong judgment is visible and the person can correct it in the chat.

### When it goes wrong or does nothing

- **No pending question:** arrival opens the Box page as today.
- **The question query fails:** arrival opens the Box page; the failure goes to
  the console the way a failed place query does (`provider.tsx:104`).
- **The question was answered elsewhere since the chat opened:** the card shows
  its answered view (`QuestionCardView.tsx:59-76`); closing it changes nothing.
- **The agent misreads an unrelated message as an answer:** it says "I've noted
  that as the answer to …"; the person says it was not, and the agent can
  correct the card the way it corrects any record. The answered view in the
  pane shows the recorded answer.
- **The agent misses an answer:** the card stays pending and visible beside the
  chat; the person can say "that was my answer" or use the card's buttons.
- **Dismiss fails on close:** the tab closes and a toast says the question is
  still waiting. The card stays pending; nothing is lost.

### Walkthrough

Tomas, desktop, 40 pending questions, clicks New chat at the root.

1. `routeConversationRequest` resolves a fresh chat with `contextDir: ""`
   (`conversation-intent.ts:60`). The workspace store has no saved arrangement,
   so `arrivalCandidate` is true (`workspace-browser-store.ts:131`).
2. `usePlaceArrival` waits for `landmarks.forDir` and, at the root, for
   `status.questions` (new). `arriveAtPlace` opens the Box page, then the
   newest pending question as the active tab. Focus stays in the composer.
3. Tomas sees the question card beside the empty chat: the prompt, the memo,
   and for a select or confirm question its buttons. A text question shows no
   text box of its own; the card says the answer goes in the chat.
4. Tomas types "Yes, Pacific." The send carries `openCard` = the question path,
   as for any focused card (`use-bound-emission/hook.tsx:117-125`).
5. The agent sees `open-card="_bookkeeping/questions/….question.card"`, reads
   the card, does the directive, runs `bbx answer <path> --via chat "Yes,
   Pacific"`, and says "I've noted that as the answer to '…'".
6. The bus event `question-answered` refreshes `status.questions`; the card
   shows its answered view with "39 more questions".
7. Left behind: the card's `answered-at`, `answered-via: chat`, the commit, and
   the chat message. No follow-up job (`--via chat`).

## Smallest fix and budget

**Smallest fix:** keep the empty-chat line, and filter `pickOpenQuestion` to
short, recent questions. It addresses the report (long, old question) and
nothing the boxholder asked for in the discussion of 2026-10-25: a clear choice
between answering and closing, a question that can be brought back in a chat
that is not new, and an agent that treats the reply as a response.

**Chosen design, one track set:**

| Chunk | Source lines (add + delete) | Test lines |
|---|---|---|
| Arrival opens the question | ~80 | ~80 |
| Close dismisses; card view beside the chat | ~120 | ~100 |
| Agent rule keys on `open-card`; `openQuestion` field removed | ~60 add, ~250 delete | ~60 add, ~200 delete |
| Visual treatment (after the study) | ~80 | ~20 |

About 650 source and 460 test lines changed, most of the deletion from the
empty-chat question line and the `openQuestion` send field. Docs: about 80
lines across `docs/questions.md`, `docs/mobile-contract.md`,
`docs/landmarks.md`. Not a BIG CHANGE.

What the fuller design buys: it reuses the companion pane, the card renderer,
`open-card`, and the tab close button, and deletes a parallel path (a question
line in the chat and a send field of its own) that existed only because the
question lived in the chat.

## Stated preferences this plan trades against

- **Boxholder, 2026-10-25:** "I really like the concept of the flow, that open
  questions fill the blank space"; "the question is mostly what you are
  responding to, not the chat history"; "it's more of a clear choice the user
  makes: answer the question or dismiss it, which is the same as closing a
  tab, but _feels_ like a different choice"; "The agent decides if it actually
  resolves the question." These set the direction.
- **Boxholder, 2026-10-19 (front-door Revision):** the question system is the
  onboarding. Kept: the root question is the first pending question on a new
  box, and it opens beside the first chat.
- **Front-door decision 13** (no option buttons in the chat): kept. The buttons
  are on the card, as on the Questions page; the chat stays free text.
- **Engineering principle 8, one way to do each thing:** the agent learns of
  the question through `open-card` only; the separate `open-question` field
  goes.
- **Memory "minimize invented concepts":** no new attribute, card type, or
  transcript entry; the tab, the card renderer, and dismissal exist.
- **Always-loaded prompt budget** (`core/agent-guide/ledger.yaml:30`,
  `always_loaded_words: 10928`): the rewritten rule must not grow the prompt.

## What already exists

- **Arrival** opens one card in an empty workspace for a fresh chat:
  `arrival.ts:19` *"input.arrive && input.viewport === "desktop" &&
  input.tabCount === 0 && input.target !== null"*; `provider.tsx:101-107`
  `arriveAtPlace`. Reuse; extend to the question and to the phone.
- **Root arrival target** is the landmark: `landmarks/payload.ts:194`
  *"if (dir === "") return relPath;"*. Unchanged; the question opens after it.
- **Phone with a card open** shows the card full-screen with its tab strip and
  the composer row under it (screenshot of test1 at 390×844, 2026-10-25:
  tabs "Browse" and "Pacific timezone" with close buttons, the question form,
  and the Add/Capture/keyboard/mic row). Reuse as is.
- **Question card view**: `QuestionCardView.tsx:27` *"const ANSWERABLE = new
  Set(["pending", "expired", "dismissed"])"* renders `QuestionForm`; answered
  cards render the answer and learning. Modify.
- **`open-card` on every send** for the foreground card:
  `use-bound-emission/hook.tsx:117-125`; prompt `prompts.ts:138` *"the focused
  content card, whether beside the chat or on its own page"*. Reuse.
- **Open-question prompt rule**: `prompts.ts:193-195`. Rewrite.
- **Agent links open cards beside the chat**: `prompts.ts:118` *"Clicking it
  opens the file in the companion pane"*. Reuse for "bring it back".
- **Tab close**: `SidecarTabStrip/view.tsx:126` `onCloseTab`, wired at
  `provider.tsx:276`. Extend at the UI handler, not the reducer, so eviction
  and retargeting never dismiss.
- **Dismiss**: `trpc.actions.dismiss`; only `pending` can be dismissed
  (`docs/questions.md`, Lifecycle). Reuse.
- **Question choice**: `open-question.ts:36` `pickOpenQuestion` (newest pending
  by `askedAt`, then path). Reduce to the choice of a path.
- **Questions refresh on bus events**: `shell.tsx:102-104`. Move with the
  question choice to the provider.

## Prior art (external)

No decision here depends on an external premise; the work recombines the
box's own pane, renderer, and send context. No search made.

## Ontology

No new nouns. Names used:

- **question card**: a `question` card in `_bookkeeping/questions/`
  (`schemas/question.ts`). States `pending | answered | dismissed | expired`.
- **arrival**: the workspace opening a card for a fresh chat with no saved
  arrangement (`arrival.ts`). This plan adds the **arrival question**: the
  path of the newest pending question, opened by root arrival after the
  landmark. It is a value inside arrival, not a new concept.
- **open card**: the foreground card sent as `openCard` / `open-card`.
- **dismiss**: the existing transition. "Not now" is its label to the person;
  closing a pending question's tab performs it.

Removed: the `openQuestion` send field and `open-question` snapshot attribute;
the `OpenQuestion` interface and `OpenQuestionLine`.

## Tracks / scope

### Track A — Root arrival opens the newest pending question

- **What.** At the root, arrival opens the Box page and then the newest
  pending question as the active tab, on desktop. On the phone it opens the
  question alone. The empty chat loses its question line.
- **Why.** The boxholder wants the question to fill the blank space beside the
  chat, on both layouts, and the chat's empty state is the wrong place for a
  long agent question.
- **Direction.**
  - `pickArrivalQuestion(items: readonly QuestionInfo[]): string | null` in
    `components/chat/workspace/WorkspaceProvider/arrival-question.ts`: the
    newest askable pending card's `relativePath` (the existing sort and
    `invalid` rules from `pickOpenQuestion`).
  - `usePlaceArrival` (`provider.tsx:~85-98`) also queries `status.questions`
    when `contextDir === ""` and the store is a candidate, on both viewports.
    `settled` waits for both queries. Its result gains `question: string |
    null`; a failed questions query gives `null` and a console warning.
  - `arrivalOpens` keeps its desktop rule for the landmark. A new pure
    `arrivalPlan({ arrive, viewport, tabCount, landmark, question })` returns
    the ordered paths to open: desktop `[landmark, question]` (question
    omitted when null), phone `[question]` or `[]`. `arrivalWaits` waits on
    the phone too when the context is the root.
  - `arriveAtPlace` dispatches `openCard` for each path in order; the last is
    active. The effect keeps composer focus: arrival dispatches carry a flag
    so the provider skips the focus effect for them (the reducer's
    `WorkspaceFocusEffect` already has `{ kind: "none" }`).
  - Delete from the chat: `EmptyChat`'s `openQuestion` prop and
    `OpenQuestionLine`; `open-question.ts`; the shell's questions query,
    `useOpenQuestionActions`, and their props through `view.tsx`,
    `messages.tsx`, `body-props.ts`; the Theme Studio harness prop.
  - `nav-counts.ts:26-31` comment: the root question is "beside the first
    chat" instead of "its opening line". The rule itself stays.
- **Vocabulary lock-ins.** `pickArrivalQuestion`, `arrivalPlan`.
- **First implementation chunk.** `pickArrivalQuestion` and `arrivalPlan` with
  `t.check` tests (desktop with and without a question; phone with and without;
  a workspace with tabs opens nothing; an invalid card is never picked), then
  the provider wiring and the chat deletions, with the existing
  `messages.open-question.test.ts` removed and a provider test that a fresh
  root chat opens two tabs with the question active.

### Track B — Answer or close: the card beside the chat

- **What.** Closing a pending question's tab dismisses it. The card view, used
  beside the chat, presents the choice: answer in the chat (or with the
  card's buttons), or "Not now", which closes the tab. An answered card links
  to the Questions page when others are pending.
- **Why.** The boxholder wants a clear choice between answering and
  declining, where declining is closing the tab but reads as a decision.
- **Direction.**
  - `WorkspaceCanvas/view.tsx:37` wraps `onCloseTab`: when the tab's path ends
    in `.question.card` and the cached `status.questions` state is `pending`,
    call `actions.dismiss` and close. On a dismiss error, keep the tab closed
    and show a toast "That question is still waiting." Eviction
    (`evictWorkspaceToCap`) and `retargetCard` do not go through this handler.
  - The tab's close control for a pending question carries the label "Not
    now" (accessible name "Not now: <title>"). Its look is part of Track D.
  - `QuestionCardView` for an answerable card: the prompt and memo as now; for
    `select` and `confirm`, the buttons; for `text`, no text box, with a line
    "Answer in the chat." The confirm form's optional note goes (the chat
    carries notes). The "Dismiss" button becomes "Not now" and also closes
    the tab when the view is in the workspace. The Questions page keeps the
    full `QuestionForm` (`QuestionsList.tsx`), including the text box.
  - A dismissed or expired card stays answerable and renders the same
    answerable view (`QuestionCardView.tsx:27`); closing its tab changes
    nothing. An answered card keeps its answered view and adds one quiet
    link, "N more questions", to the Questions page, shown only when other
    questions are pending. No "Next question": moving through the queue is
    the backlog policy, deferred (NOT in scope).
  - `QuestionCardView` gets an error branch: a failed `status.questions`
    query shows "Couldn't load this question" with a retry, distinct from
    "Question card not found" (today it has no error branch,
    `QuestionCardView.tsx:31-40`).
  - `QuestionsList` gains "Answer in chat" on every answerable row: pending,
    and the dismissed and expired rows in its archive
    (`QuestionsList.tsx:97`). It opens that card as a tab in the Questions
    page's own pane, not the opposite one: `listLinkRoute` sends a list's
    links to the opposite pane (`use-open-beside/open-beside.ts:17-21`), and
    with the chat in that pane the open would replace the chat
    (`state-reducer.ts:35`). The call passes `destinationPane` = the
    Questions page's pane. On the desktop in focus layout (one card pane
    filling the screen, chat hidden), the action then dispatches
    `backToSplit` for that pane (`state-reducer.ts:205`), so the chat is
    beside the question. On the phone the workspace's own rule places it,
    and the composer row is under the card.
    This is the person's way to bring a question back; the agent's way is a
    link (`prompts.ts:118`).
  - The card's select and confirm buttons stay. They are a direct answer
    (`answered-via: web`, which writes the follow-up job, as on the Questions
    page); the answered view that replaces the form is the confirmation. The
    chat agent sees the card answered on the next message and ignores it
    (`prompts.ts:195`, "If the card is already answered, ignore the
    attribute", kept in substance).
- **Vocabulary lock-ins.** Labels "Not now", "Answer in the chat.", "N more
  questions", "Answer in chat", "Couldn't load this question".
- **First implementation chunk.** The close wrapper with a DOM test (closing a
  pending question tab calls dismiss once; closing an answered one does not;
  closing another card does not; a failed dismiss shows the toast), then the
  card view changes with DOM tests per input type.

### Track C — The agent reads the open card as the question

- **What.** The prompt rule keys on `open-card` being a question card; the
  `openQuestion` field and `open-question` attribute are removed.
- **Why.** One signal for one fact (principle 8): the question is the card the
  person is looking at.
- **Direction.**
  - `prompts.ts:193-195` becomes, at no more words: "When `open-card` is a
    `.question.card`, read it. If it is not answered (pending, dismissed, or
    expired: all are answerable, `docs/questions.md`, Lifecycle), the message
    probably answers it; if the message is about something else, reply to
    that and leave the card as it is, except on the root question …" and the rest as today (one
    follow-up at most, directive, learning, `bbx answer --via chat` last, the
    one-line confirmation, the narration rule). The phrase "whose `prompt:`
    was your opening line" goes.
  - Remove `openQuestion` from: `webapp/routes/chat/helpers.ts:96-99,188`;
    `ChatSendInput` (`core/chat/session/messages.ts`); `combineQueuedInputs`
    (`core/chat/session/state.ts:207-256`); `run/start.ts:206-223`;
    `session-context.ts:198-227`; `features.ts:188,210`;
    `card-activity.ts:67` comment; frontend `api-chat.ts`, `chat-actions.ts`,
    `chat-actors.ts`, `dispatch.ts`, `use-bound-emission/hook.tsx:125`,
    `InteractiveChat-card-hooks.ts:17`.
  - `docs/mobile-contract.md:1000-1003`: the body loses `openQuestion`. An old
    tab that still sends it during a deploy is unaffected: `sendBodySchema`
    is a plain `z.object` (`webapp/routes/chat/helpers.ts:46`), which strips
    unknown keys, so the field is dropped without error. The iOS shell never
    sent it (searched `ios-app/`: not found).
  - Knowledge audit `answer-in-chat` (`knowledge-audits.yaml:8779-8803`):
    the prompt names `open-card` instead of `open-question`.
- **Vocabulary lock-ins.** None new; `open-question` is retired.
- **First implementation chunk.** The prompt rewrite with
  `prompts.open-question.test.ts` updated, the field removal through every hop
  with `features.attention-context.test.ts` updated, and the ledger lint
  passing; then the audit edit and a run.

### Track D — How the question looks beside the chat

- **What.** A visual treatment that makes the question read as the thing the
  chat answers: half-background, sharing the desk the chat sits on, possibly
  pointing toward the chat. The phone has no pane borders, so its treatment is
  a variant of the same idea.
- **Why.** The boxholder wants the reply to be "heavily implied" to answer
  the question, and was not convinced by a "distinct frame".
- **Direction.** A study first: two or three variants on test1 at desktop and
  phone widths, as one exhibit (`bin/exhibits add`), for the boxholder to
  react to. Candidates: (1) the card on the desk material with no raised
  surface, prompt in larger type, memo and buttons quieter; (2) the same with a
  notch on the pane edge facing the chat (on the phone, toward the composer);
  (3) the composer band tinted to continue the question's surface while a
  pending question is the open card. The treatment applies only to
  `QuestionCardView` in the workspace and must work in every theme
  (`bbx-theme` tokens).
- **Vocabulary lock-ins.** Decided after the study.
- **First implementation chunk.** Not before the study; the boxholder picks.

## Could this be simpler?

The simplest version: open the question in the pane at arrival (Track A) and
change nothing else. The person could still answer by typing, because
`open-card` already names the card. It fails on three boxholder asks: closing
the tab would not dismiss, so the same question returns in every new chat
until it expires (30 days); a text question would show its own text box beside
the composer, two places to type the same answer; and the agent's rule would
still talk about `open-question`, which no client would send. Tracks B and C
are the minimum for those. Track D is a study before any code, because the
boxholder said the look needs iteration.

Not built: a transcript entry for the question, a `bbx` command to post a
question into a chat, and a per-tab "opened by arrival" flag. Each was
considered in the discussion; the pane and the existing link made them
unnecessary.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `status.questions` fails at arrival | New provider test | Arrival opens the landmark only; console warning | Clear (console); the person sees the Box page |
| The picked question is answered between arrival and render | Existing view behavior | Card shows the answered view | Clear |
| The card's own `status.questions` query fails | New DOM test | Error branch with retry (Track B) | Clear |
| "Answer in chat" opens over the chat pane, or with the chat hidden | New DOM tests: chat in one pane and Questions in the other, the chat pane still shows the chat after the click; Questions in focus layout, the layout is split after the click | `destinationPane` = the Questions page's pane; `backToSplit` from focus | Clear |
| Dismiss on close fails (lock, network) | New DOM test | Toast "That question is still waiting." | Clear |
| Tab evicted at the cap while pending | New reducer-level test that eviction never calls dismiss | Dismiss lives in the UI handler only | Silent by design: the question stays pending |
| The person closes a dismissed or answered question's tab | New DOM test | No dismiss call when the cached state is not `pending` | Clear (no change) |
| Agent answers from a message that was not an answer | Knowledge audit | Agent's one-line confirmation names the question; answered view shows the answer | Clear |
| Agent ignores a reply that was an answer | Knowledge audit | Card stays pending beside the chat | Clear |
| Arrival on the phone hides an empty chat the person wanted | Provider test for the phone plan | The chat is one tap away ("Chat" in the app bar) | Clear |
| An old client still sends `openQuestion` during a deploy | Parser test that a body with it parses and drops it | `z.object` strips unknown keys (`helpers.ts:46`) | Silent by design: a reload fixes it |

No critical gap: every row has handling, and the one silent row is the
intended outcome.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field:** ADDRESSED. One signal (`open-card`) replaces
  two; the agent cannot confuse them (Track C).
- **Stale ref:** ADDRESSED. The rule says read the card and act only if it is
  pending; an answered card is ignored (`prompts.ts:195`, kept).
- **Two agents touching the same card:** ADDRESSED by the existing guarded
  transition (`docs/questions.md`, the lifecycle table). A web answer and a
  chat answer race; the second gets the "not answerable" outcome. The chat
  agent already reads the card before answering.
- **Hand-edit drift:** ADDRESSED. An unparseable card is never picked
  (`invalid`), as today.
- **Fabricated free-form value:** ADDRESSED. The agent records the person's
  words (`--via chat "<their words>"`), as today.
- **Validation error UX:** ADDRESSED. `bbx answer` on a non-answerable card
  already returns a clear refusal.
- **Partial migration / transition state:** ADDRESSED. No data change. During
  a deploy an old tab may send `openQuestion`; the parser drops it
  (`helpers.ts:46`), so for that tab's messages the agent does not see the
  question unless the card is open. Accepted: a reload fixes it.
- **Shared chat:** ADDRESSED. Each person's client has its own workspace; the
  card is open for whoever opened it, and `open-card` comes from the sender's
  client.
- **Focus on a card other than the question:** ADDRESSED. `open-card` is the
  foreground tab; if the person switches to the Box page tab, messages no
  longer carry the question, which is right.

## NOT in scope

- **The backlog** (40 pending questions; which to pick, how often a closed or
  ignored question returns, batching). The boxholder: "it'll open interesting
  questions about how to deal with these." File an issue at the end of this
  work.
- **"Next question" and any automatic progression** through pending
  questions: part of the backlog policy.
- **Snooze** ("ask me tomorrow"). Closing is a dismiss; bringing back is by
  asking or from the Questions page.
- **Questions in place chats** (non-root `contextDir`). The place's own
  arrival stays as it is.
- **A notification or badge change.** The nav badge and aging are unchanged.
- **iOS native composer.** The native shell sends nothing for questions; it
  inherits the web pane.

## Open design questions

1. **Track D's look.** Settled by the study exhibit.
2. **Card buttons beside the chat.** The plan keeps select and confirm
   buttons as a direct answer, so a click answers without the chat agent.
   The alternative is text-only cards beside the chat, so every answer goes
   through the agent. Lean: keep the buttons; a yes/no is faster to tap, and
   the answered view shows what was recorded. The boxholder decides.

## Knowledge audits

`answer-in-chat` (`knowledge-audits.yaml:8779-8803`) changes its prompt to
`open-card="_bookkeeping/questions/what-to-keep-track-of.question.card"` and
keeps its expectations. Add one entry, `open-card-not-an-answer`: a pending
select question is the open card, and the person writes about an unrelated
task; the agent replies to the task and leaves the card pending. Both land
run against the worktree's test1 clone.

## What will hold this after it ships

- `t.check` tests on the pure decisions: `pickArrivalQuestion`,
  `arrivalPlan`.
- Frontend DOM tests (existing harness,
  `docs/implemented-plans/frontend-dom-harness.md`) for the close wrapper and
  `QuestionCardView` per input type.
- The provider's arrival test for the two-tab open and the phone case.
- Prompt and snapshot tests (`prompts.open-question.test.ts`,
  `features.attention-context.test.ts`) for the rule text and the removed
  attribute.
- The two knowledge audits for the agent's judgment.
No new test tier.

## Implementation order

1. Track C prompt and field removal (independent; the agent rule then works
   with any client that shows the card).
2. Track A arrival and chat deletions (depends on 1 for the agent to see the
   question through `open-card`).
3. Track B close-dismisses and the card view (depends on 2 for the pane case).
4. Track D study exhibit; then the chosen treatment.
5. Docs: `docs/questions.md` "The empty root chat" becomes "Beside a new
   chat", and its "Header badge" item (`questions.md:271`, "retired 2026-08")
   is corrected: the app bar shows the count today
   (`AttentionBadgesFace.tsx:75`); `docs/landmarks.md` arrival paragraph; `docs/mobile-contract.md`.
   File the backlog issue.

## As implemented (2026-10-26)

Deviations from the tracks above, each with its reason:

- **"Answer in chat" placement.** It calls `workspace.open` with no pane hint,
  then `revealConversationActions` (`workspace/history.ts:42`) on the
  desktop. The workspace already opens a card opposite the visible chat,
  which is the Questions page's own pane, and the reveal actions cover both
  the focus layout and a split with two card panes. No `destinationPane`
  was needed (`components/questions/question-tab.ts`, `useAnswerInChat`).
- **Where "Not now" lives.** The provider's `onCloseTab` dismisses
  (`useDismissOnClose`); the card's own "Not now" button calls the same
  close, so there is one path. The card is "beside the chat" only in
  companion mode (`RendererProps.mode`), so an embed in a chat message keeps
  the Questions-page form.
- **The card refreshes on the bus** (`useLiveRefresh` in
  `QuestionCardView`): the agent answers from the CLI, and without it the
  card kept its form after the chat answer.
- **No provider-level DOM test for arrival.** No such harness exists for
  `WorkspaceProvider`; the decisions are pure and tested
  (`arrival.test.ts`), and the two-tab open, the phone open, closing as a
  dismiss, and a chat answer were checked on test1 in the browser
  (exhibit "How a question looks beside a new chat").

- **From the diff review (codex gpt-6-sol).** Question arrival also requires
  an unstarted chat (`WorkspaceProvider`'s `unstarted`, from
  `conversation.unstarted`): an existing chat opened in a new browser tab has
  no saved arrangement either, and must not open a question over its
  history. With the chat hidden on the desktop, a text question's "Answer in
  the chat" is a button that reveals the chat.

## Rollout shape

Done when: the tests named in each track's first chunk pass; the two
knowledge audits pass on the worktree's test1 clone; a desktop and a phone
screenshot of a new root chat on test1 show the question beside the chat with
the composer focused; closing it on each layout dismisses the card (checked in
the card's frontmatter). No migration; no data shape change. Ships as one
piece on the boxholder's finish ask.
