---
title: "Questions: Later, Figure it out, and a simpler next time"
status: draft
workstream: front-door
issues:
  - ../../../issues/features/2026-10-26-question-backlog-beside-the-chat.md
---
# Questions: Later, Figure it out, and a simpler next time

A question beside the chat (`questions-beside-the-chat.md`, shipped in this
workstream) offers two choices besides answering in the chat: **Later**, which
puts it away, and **Figure it out**, which hands it to an agent in the
background. A daily review takes questions that were put off or have waited
long and either decides each one conservatively or asks it again, made
simpler to decide where it can. An agent's decision is recorded as provisional and is never shown
or used as the person's answer. The question card also gets its final look,
and the app bar's question counter shows and hides the question beside the
chat.

**Issues addressed:**
[question-backlog-beside-the-chat](../../../issues/features/2026-10-26-question-backlog-beside-the-chat.md)
(the review is this plan's answer to a large backlog; the issue's question of
which question to pick stays open, see NOT in scope). Searched the queue for
"auto-answer", "stale question", "dismissed question", "provisional": the
closed `issues/closed/features/2026-06-09-in-chat-interactive-questions.md`
is about in-chat question tags, unrelated. No duplicate.

## Design

### Situations

- When Tomas opens a chat to log a repair and a question about filing receipts
  is beside it, I want to put the question away with one tap, so I can do what
  I came for, and I want it to come back some other day.
- When Tomas reads a question he has no opinion about ("which folder for
  receipts?"), I want to tell the box to decide for itself, so the question is
  gone and nothing waits on me.
- When Juni has put off the same question three times, I want the box to ask
  it differently next time (concretely, or split into a part it can decide and
  a smaller part for me), so the question becomes one I can answer.
- When the box decided something for Tomas and he later sees it, I want it to
  say plainly that the box decided, not that he did, so he can correct it in
  his own words.
- When Priya is in the middle of a chat and wants the question she put away,
  I want to tap the question counter and get it beside the chat, and tap again
  to put it away without declining it.
- When a question asks for something risky (delete, send, spend), Diana does
  not want the box to decide it without her. (The box never decides it; the
  review asks it again.)

### Right place, right time

| Situation | Act, show, or quiet | Surface and card | Attention |
|---|---|---|---|
| Put it away | Act on the tap | "Later" on the card, or the tab's ✕: the question leaves the rotation | The person's gesture |
| Decide for me | Act in the background | "Figure it out": the question leaves at once; a background chat named for the question does the work | Background; the chat is findable in the chat list |
| Put off repeatedly | Act, later | The daily review rewrites or splits the question and asks it again | Waits to be found: the question comes back beside a new chat |
| Sees a box decision | Show | The card and the Questions page say "The box decided for now: …" with "Answer it yourself" | Waits to be found |
| Wants it back mid-chat | Show on request | The question counter opens the newest waiting question beside the chat; tapping again puts it away | The person's gesture |
| Risky question | Show, later | The box does not decide it; the review asks it again, with a sentence on why only the person can decide | Waits to be found: beside a new chat |

### Spirit

- **Serves:** "Messy is fine": "Questions can go unanswered for days — and at
  some point the box should figure out that the question is moot and move on,
  rather than nagging forever" (`docs/architecture/spirit.md`).
- **Serves:** "People aren't broken versions of their better selves": a
  put-off question is a signal that the question is hard to answer, not that
  the person failed; the box simplifies the question.
- **Risks:** "You should be able to see the gears": a decision the person did
  not make. Guard: the decision is recorded on the card as provisional, with
  its reasoning and how to undo it; the background chat is in the chat list;
  learning goes in as `basis: inferred`, never `user-stated`.

### Trust

This plan adds the first rung below "question" for a question that will not be
answered: the box acts on its own, conservatively and reversibly.

- **Figure it out** starts at "automatic, provisional": the agent does the
  conservative, reversible choice and records it. It never takes an
  irreversible or outward-facing action (delete, send, spend, publish).
- A later answer from the person supersedes the provisional decision; the
  follow-up of that answer reconciles the two, reversing what it can, and
  says what it reversed and what it could not.
- This changes a stated rule. `docs/design/trust.md`: "A question, the first
  rung, is never auto-answered, because silence is not consent." It still
  holds: a provisional decision is not an answer. The card stays unanswered,
  the person can still answer it, and nothing records the decision as the
  person's. The docs change says so.

### When it goes wrong or does nothing

- **Figure it out fails to start** (the chat cannot start): the question stays
  put away (Later), and a toast says the box could not start on it.
- **The agent cannot decide safely:** it says so in its background chat and
  leaves the question put away; the daily review asks it again.
- **The provisional decision is wrong:** the person answers the question from
  the Questions page or the card; the follow-up reconciles, reversing what it
  can and saying what it could not.
- **Nothing to review:** the review's precheck skips, and no agent runs.

### Walkthrough

Tomas, desktop, a triage question "Which folder for this receipt?" beside a new
chat.

1. He clicks "Figure it out". The tab closes. The card gets `dismissed-at`
   (the Later transition) in one commit.
2. The server starts a background chat with a client-composed message naming
   the question and the `figure-it-out` skill. The chat list shows it.
3. The agent reads the card and its context, follows the skill: the receipt
   goes to a holding folder the triage rules already name as the fallback,
   with a note. It runs `bbx question decide <path> --decision "Filed in
   Inbox/Receipts for now" --reasoning "…" --undo "Move it to the folder you
   name"`.
4. The card now carries `provisional:`. The Questions page shows it under
   "The box decided for now", with the form to answer it.
5. Left behind: the background chat, the commits, the `provisional:` block.
   No `answered-at`.

## Smallest fix and budget

**Smallest fix:** relabel the card's "Not now" as "Later" and stop there. It
gives the person the first choice and nothing else asked for: no background
decision, no simplification, no labeling of box decisions.

**Chosen design, tracks and estimates (additions plus deletions):**

| Track | Source | Tests |
|---|---|---|
| A. Card look and buttons beside the chat | ~180 | ~80 |
| B. Counter shows and hides the question | ~80 | ~60 |
| C. `provisional:` field and the `bbx question` commands | ~260 | ~220 |
| D. The two skills | ~180 (prose) | ~40 |
| E. Figure it out runs in the background | ~140 | ~100 |
| F. The daily question review | ~260 | ~160 |

About 1,100 source and 660 test lines, plus about 150 lines of docs. Total
near 1,900: close to a **BIG CHANGE** (over 2,000). What drives it is six
small surfaces, each modeled on an existing one (todo-review, dismiss,
capture delivery, `what-can-you-do`). If the count passes 2,000 during
implementation, I stop and report before going on.

## Stated preferences this plan trades against

- **Boxholder, 2026-10-25 and 2026-10-26:** "Later replaces dismiss"; "I want
  pressing 'figure it out' to make things happen in the background. The idea
  is the question goes away"; "figure-it-out should refer to
  simplify-question, as that's one way to figure things out"; "refactoring
  questions is fine without fancy labeling, the questions didn't get
  answered. It's only answers that need labeling"; "Figure it out is probably
  entirely prompting, like we might just have a named skill"; simplifying
  means "simpler for the user to decide" or "simpler for the user to
  understand", not "simpler text"; the card look: "the question pasted onto a
  stub card", cut off, not faded; the counter "could be the question counter
  in the toolbar".
- **`docs/design/trust.md`, never auto-answer:** kept in substance; see Trust.
- **Memory: arrange context, don't automate judgment:** the decisions are made
  by an agent following a skill; code only gathers the brief and records the
  outcome.
- **Memory: minimal concepts:** one optional field; Later is the existing
  dismiss transition with a new label; the background run reuses chat
  delivery; the review copies the todo-review procedure.
- **Engineering principle 8, one way:** one command records a box decision
  (`bbx question decide`); the button and the review both use it.
- **Always-loaded prompt budget** (`core/agent-guide/ledger.yaml:30`): each
  skill's `description` is always loaded; the bodies are not. Two short
  descriptions; raise the budget by their word count with a ledger note, as
  `browser-task` did.

## What already exists

- **Dismiss transition:** `core/commands/dismiss.ts:44-52`,
  `withQuestionTransition({ allowedStates: ["pending"] })`, sets
  `dismissed-at`. Reuse as Later.
- **Answer allows dismissed:** `core/commands/answer.ts` (~240)
  `["pending","expired","dismissed"]`, deleting `dismissed-at`. Reuse: a
  person's later answer supersedes.
- **Guarded transition:** `core/question-transition.ts`
  (`withQuestionTransition`). Reuse for `reraise` and `decide`.
- **Background chat from the server:** `core/chat/session/deliver-user-message.ts:129`
  `deliverUserMessage` with `target.sessionId: null` starts a fresh session
  and sends; used by capture (`core/capture/prepare/deliver.ts:164`) and bulk
  upload (`core/bulk-upload/worker/core.ts:194`). Reuse.
- **Client-composed turns:** `deliverUserMessage` already sends every
  delivered message as `{ text: message, clientComposed: true }`
  (`deliver-user-message.ts:181`), so the background message is never taken
  for the person's words. No change needed.
- **Box skills:** `core/box/guidance-sync/skills/core.ts` `buildBoxSkills()`
  lists `{ name, content }`; content in `content-what-can-you-do.ts`;
  written to `<box>/.claude/skills/<name>/SKILL.md` on every docs refresh.
  Reuse.
- **Daily agent review:** `templates/procedures/todo-review.procedure.card`
  (precheck `bbx engine todo-review check`, exit 75 to skip; one agent step;
  validate `bbx engine todo-review verify`), seeded in
  `core/box/structure/defaults.ts:416` with `enabled: true`. Copy its shape.
- **Arrival, close-dismisses, the card view:** this workstream's
  `WorkspaceProvider/arrival.ts`, `components/questions/question-tab.ts`,
  `QuestionCardView.tsx`, `questions/QuestionForm/view.tsx`.
- **Question counter:** `app-bar-faces/AttentionBadgesFace.tsx:72`, a `Link`
  to `/questions`.

## Prior art (external)

No decision depends on an external premise. Searched nothing.

## Ontology

- **question card** (exists, `schemas/question.ts`): states `pending |
  answered | dismissed | expired` (`questionState`, `question.ts:97`).
- **Later** (label, exists as dismiss): the person puts the question away.
  `dismissed-at` now means "put away, by the person or by Figure it out"; the
  schema instruction's "the boxholder declined to answer" becomes "put away
  for now". Meaning broadens, no data changes: existing dismissed cards are
  correctly "put away". Not a decline forever.
- **provisional decision** (new, field `provisional:` on the question card):
  `{ decision: string, reasoning: string, undo: string, "decided-at":
  datetime }`. What the box did in place of an answer. Not an answer: it never
  sets `answered-at`, never writes `answer:`, and its learning is `basis:
  inferred`. Present only with `dismissed-at` or `expired-at` (a decided
  question is out of the rotation); a later answer keeps it, as history.
- **reraise** (new transition): `dismissed` to `pending`, by an agent after
  simplifying. Deletes `dismissed-at` and sets `asked-at` to now: it is asked
  again, so it is the newest question and opens beside the next new chat,
  and its aging clock restarts.
- **figure-it-out** (new box skill): decide a question without the person.
- **simplify-question** (new box skill): make a question simpler to decide or
  to understand: rewrite, make concrete, or split. Referenced by
  figure-it-out as one way to figure it out.
- **question review** (new stock procedure `question-review`): daily; brief of
  put-off and long-waiting questions; an agent applies the skills.

## Tracks / scope

### Track A — The card beside the chat: stub look, Later, Figure it out

- **What.** Beside the chat, the question card is the stub card: the card's
  paper with its title and folded corner, cut off with a straight edge a few
  lines down, and the question on a rounded patch pasted over it, with the
  notch on the pinned action row (pointing at the chat on the desktop, down at
  the composer on the phone). No answer controls beside the chat for any
  input type: a select question lists its options in the prompt's line. The
  pinned row holds "Later" and "Figure it out". The tab's ✕ is "Later".
- **Why.** The boxholder chose this look (exhibit "A question on a stub card,
  cut off") and wants spoken, long answers rather than taps.
- **Direction.**
  - `QuestionForm/view.tsx`: `beside` mode renders `QuestionContext` and a new
    `BesideRow` (Later, Figure it out); no `TextForm`, `SelectForm`,
    `ConfirmForm`. The "Answer in the chat" reveal button stays when the chat
    is hidden. Options listed with `openQuestionLine`'s rule, restored as a
    small pure function in `QuestionForm/options-line.ts`.
  - Styles in a new `components/questions/QuestionForm/beside.css` keyed on
    `[data-question-beside]`, using theme tokens (`--bbx-*`), not literal
    colors; the patch color is a new token with a value per theme family.
  - `NOT_NOW` becomes `LATER = "Later"`; the close label and button use it,
    and the Questions page's "Dismiss" becomes "Later" too ("Putting away…"
    while it runs). The command stays `dismiss`.
  - The answered view beside the chat keeps the stub look, with the recorded
    answer and "N more questions".
- **Vocabulary lock-ins.** "Later", "Figure it out", `data-question-beside`.
- **First implementation chunk.** `options-line.ts` with tests; `beside` mode
  with DOM tests for each input type (no answer controls, the two buttons, the
  options line); then the CSS with screenshots in three themes.

### Track B — The counter shows and hides the question

- **What.** In a chat, the app bar's question counter toggles the newest
  pending question beside the chat. Elsewhere, or with no pending question,
  it links to the Questions page as today.
- **Why.** The boxholder: a question-specific show and hide, separate from the
  pane's "−".
- **Direction.** `AttentionBadgesFace` takes an optional `onToggleQuestion`;
  when set, the questions segment is a button. `app-nav-badges.tsx` passes it
  when `useWorkspace()` is non-null: if the foreground card is a pending
  question, dispatch `closeTab` directly (no dismiss: hiding is not Later);
  else open `pickArrivalQuestion(items)` with `useAnswerInChat`'s open-and-
  reveal. The label says which: "Show the question" or "Put the question
  away", with the count.
- **Vocabulary lock-ins.** `onToggleQuestion`.
- **First implementation chunk.** A pure `questionToggle(state, items)`
  returning `{ kind: "open", path } | { kind: "hide", path } | { kind:
  "page" }` with tests; then the wiring and a DOM test of the segment.

### Track C — `provisional:` and the `bbx question` commands

- **What.** The optional field, two commands, and their web and display
  surfaces.
- **Why.** The skills need one honest way to record a box decision and one
  way to ask a simplified question again.
- **Direction.**
  - `schemas/question.ts`: `provisional` optional object (`decision`,
    `reasoning`, `undo`, `decided-at`); refinement: `provisional` requires
    `dismissed-at`, `expired-at`, or `answered-at` (a later answer keeps it).
    Instructions text gains three sentences; `box-docs/card-question.md` the
    same.
  - `bbx question decide <path> --decision --reasoning --undo`: one guarded
    transition, `allowedStates: ["pending", "dismissed", "expired"]`: sets
    `provisional`, and `dismissed-at` when pending. Refuses an answered card
    and a card that already has `provisional` (no silent overwrite of an
    earlier decision).
  - `bbx question reraise <path>`: `allowedStates: ["dismissed"]`, deletes
    `dismissed-at`, sets `asked-at` to now; refuses a card with
    `provisional`.
  - Both register in `core/commands.ts` and `cli/commands.ts` like `dismiss`.
  - `QuestionInfo` (`webapp/trpc/routers/status.ts:37`) gains `provisional`.
  - `QuestionsList`: dismissed or expired cards with `provisional` render in a
    section "The box decided for now", each with the decision, the reasoning,
    and the answer form ("Answer it yourself").
  - `QuestionCardView`: the same labeling.
  - The `question-followup` job's instructions gain one sentence: when the
    card carries `provisional`, compare it with the answer; where they
    differ, reverse what the box did as far as the `undo` text and the git
    history allow, and say in the commit what was and was not reversed.
    This is reconciliation with a reported outcome, not a guaranteed undo.
- **Vocabulary lock-ins.** `provisional`, `decided-at`, `bbx question decide`,
  `bbx question reraise`.
- **First implementation chunk.** Schema field with parse tests (requires a
  closing timestamp; an answered card keeps it); `decide` and `reraise` core
  commands with `t.check` tests on a temp box for each allowed and refused
  state.

### Track D — The two skills

- **What.** `figure-it-out` and `simplify-question`, as box skills.
- **Why.** "Figure it out is probably entirely prompting."
- **Direction.** `content-figure-it-out.ts` and `content-simplify-question.ts`
  beside `content-what-can-you-do.ts`, listed in `buildBoxSkills`.
  - **figure-it-out**, in order: read the card, its `context:`, and its git
    history (how often it was put away). Two ways to be called, with
    different endings:
    - **Handed off** (the button): the person wants it gone. Decide it
      conservatively (below), or, when only the person can decide it,
      simplify the card in place with simplify-question and leave it put
      away. Never `bbx question reraise` here: the review brings it back.
    - **Review** (the daily procedure): every question ends decided or asked
      again. Ask again with `bbx question reraise`, simplified, or as it is
      with a sentence in the memo saying why only the person can decide it.
      So Later always comes back.
    Deciding conservatively: the reversible choice that changes least; never
    delete, send, spend, publish, or overwrite the person's words; do it;
    record it with `bbx question decide`; any learning goes to its sink with
    `basis: inferred`. Never write `answer:` or run `bbx answer` for a
    question the person did not answer.
  - **simplify-question:** the goal is simpler to decide or to understand, not
    shorter: make it concrete with the actual item, give the default the box
    would pick, split the part the box can decide from the part only the
    person can (decide the first with `bbx question decide` on this card, ask
    the second as a new card). Edit the card in place. Joining several
    questions into one is not in this version (NOT in scope).
  - Descriptions: one sentence each. Ledger entries and the budget raise.
- **Vocabulary lock-ins.** Skill names `figure-it-out`, `simplify-question`.
- **First implementation chunk.** Both content files and the registration with
  the skills test updated; knowledge audits (below) run.

### Track E — Figure it out runs in the background

- **What.** The button puts the question away and starts a background chat
  that runs figure-it-out on it.
- **Why.** "The idea is the question goes away."
- **Direction.**
  - tRPC `actions.figureOut({ questionPath })`: runs the dismiss transition,
    emits `question-dismissed`, then `deliverUserMessage({ target: { sessionId:
    null, contextDir: "" }, message })` (already client-composed). The message:
    `Figure out the question at <path>, which the person handed to you from
    the question card. Use the figure-it-out skill.` Returns the session id.
  - A delivery failure after the dismiss returns an error; the client shows a
    toast; the question stays put away (the review sees it). A delivery that
    starts but whose agent fails later leaves the same state: put away, no
    `provisional`; the background chat shows the failure, and the review
    takes the question after 3 days. "Started" is all the button promises.
  - The client: the button closes the tab (no second dismiss: the close
    handler's `dismissesOnClose` sees it is no longer pending).
- **Vocabulary lock-ins.** `actions.figureOut`.
- **First implementation chunk.** The mutation with a test using a
  test-double registry (the dismiss lands, the message is delivered, a
  delivery failure leaves the card dismissed and returns an error).

### Track F — The daily question review

- **What.** A stock procedure that reviews put-off and long-waiting questions
  with the skills.
- **Why.** "A simplifying process could be applied so next time it comes up
  it's simpler."
- **Direction.**
  - `templates/procedures/question-review.procedure.card`, the todo-review
    shape: precheck `bbx engine question-review check` prints a brief and
    exits 75 when nothing qualifies; one agent step: "Work every question in
    the brief with the figure-it-out skill"; validate `bbx engine
    question-review verify` records each listed path with the run time in a
    machine latch, `.beebox/reviewed-questions.json`, as the aging sweep's
    nudge latch does (`.beebox/notified-questions.json`), and fails (severity
    `review`, as todo-review's verify) for any listed dismissed question that
    is still dismissed without `provisional`: Later must come back.
  - Qualifies: dismissed with no `provisional`, `dismissed-at` at least 3
    days ago; or pending with `asked-at` at least 14 days ago; and in either
    case not in the latch within the last 14 days. A dismissed question ends
    reraised or decided (the skill's review ending), so the latch matters
    only for old pending ones simplified in place. At most 5 per run, oldest first. A lost latch
    only means a question is reviewed again early.
  - Schedule in `defaults.ts`: `question-review`, cron `0 6 * * *`,
    `notBefore: "20h"`, `enabled: true` (the precheck skips when idle, as
    todo-review does). `installSchedules` installs it into existing boxes
    too, by decision (open question 4).
- **Vocabulary lock-ins.** `question-review`, `bbx engine question-review
  check|verify`.
- **First implementation chunk.** The pure selection with tests (thresholds,
  the latch, the cap); the check and verify commands (verify fails on a
  dismissed question left as it was); the procedure card
  and the schedule seed with an init test.

## Could this be simpler?

The simplest version is Track A alone with "Figure it out" absent: Later and
the look. It fails the boxholder's three asks: a decision the person can hand
off, a simpler question next time, and honest labeling of box decisions. The
next simpler version drops Track F and keeps the button: then a question put
away with Later never comes back, which turns Later into a silent decline, the
opposite of its name. Track B is small and asked for. Track C's field is the
one durable addition; without it a box decision has nowhere to be labeled
except prose in a chat, which the Questions page cannot show.

Not built: a new question state (the field does it without touching every
state consumer); a reactor job type (the background chat starts at once and is
visible); a Later counter (git history answers "how often").

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Figure it out: dismiss lands, chat fails to start | New mutation test | Error to client, toast; card stays dismissed; review picks it up after 3 days | Clear |
| Figure it out: chat starts, agent fails later | None (agent run) | Card stays dismissed without `provisional`; the background chat shows the failure; review picks it up | Clear in the chat list |
| `decide` twice on one card | New command test | Refused when `provisional` exists | Clear |
| Agent runs `bbx answer` instead of `decide` | Knowledge audit | Skill says never. Not enforced in code, by decision (open question 3): `bbx answer` accepts a dismissed card (`answer.ts:221`), as it must for a person's answer relayed from chat | Visible only in the background chat and git; the audit guards |
| Agent decides something irreversible | Knowledge audit | Skill forbids; the background chat is visible | Clear after the fact |
| `decide` on an answered card | New command test | Refused by allowed states | Clear |
| `reraise` on a card with `provisional` | New command test | Refused | Clear |
| Review runs every day on the same left question | New selection test | The latch: a question reviewed in the last 14 days is skipped | Clear (a lost latch reviews early, no harm) |
| Counter hides by dismissing | New DOM test | Hide dispatches `closeTab` directly, not `onCloseTab` | Clear |
| Theme without the patch token | Screenshot in three themes | Token has a default | Clear |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field:** ADDRESSED. `provisional` vs `answer`: the skill
  names the command; the schema refuses `provisional` without a closing
  timestamp, and `answer` without `answered-at` (existing).
- **Stale ref:** ADDRESSED. The button's question may be answered between
  render and click: the dismiss transition refuses a non-pending card and the
  mutation returns that error.
- **Two agents touching the same card:** ADDRESSED. Every write goes through
  `withQuestionTransition`'s lock; a chat answer and a background decide race
  safely; the loser is refused.
- **Hand-edit drift:** ADDRESSED. A hand-written `provisional` with no closing
  timestamp fails to parse and shows as invalid on the Questions page.
- **Fabricated free-form value:** ADDRESSED. `decision` is the agent's own
  words by design; nothing presents it as the person's.
- **Validation error UX:** ADDRESSED. Command refusals name the state.
- **Partial migration / transition state:** ADDRESSED. Additive field; old
  dismissed cards enter the review, which is intended.

## NOT in scope

- **Which question opens beside a new chat** (the backlog issue's first
  question): newest stays. Revisit with data from the review.
- **Spoken replies to voice answers:** belongs with the voice work.
- **Rewriting how agents ask questions** (open questions over yes/no): the
  simplify-question skill covers re-asking; changing first asks is a guidance
  change to file separately.
- **A "never ask again" choice:** Later plus Figure it out cover it.
- **Joining questions:** the boxholder mentioned it; joining needs a durable
  "superseded by" relation (`context:` is only "related",
  `schemas/question.ts:181`). Later, if simplifying by rewrite and split is
  not enough.

## Open design questions

1. Thresholds (3 days after Later, 14 days pending, 5 per run). Lean: start
   there; they are constants in one module.
2. The patch color per theme family. Settled with screenshots in Track A.
3. **No code guard against an agent answering** (boxholder, 2026-10-26: "code
   doesn't have to block an agent from answering at all. Usually the agent
   will answer on behalf of a user who answered in chat anyway"). The skill
   and the audit carry the rule.
4. **The review runs on existing boxes** (boxholder, 2026-10-26: "Yes, let it
   go through existing boxes"): the schedule ships `enabled: true` and
   `installSchedules` installs it everywhere.

## Knowledge audits

- `figure-it-out-conservative`: a receipt-folder select question handed off;
  expects a reversible choice and `bbx question decide`, never `bbx answer`.
- `figure-it-out-leaves-risky`: a question about deleting old photos; expects
  it left, with a reason.
- `simplify-question-concrete`: a vague question put off three times; expects
  a concrete rewrite or a split, then `bbx question reraise`.
- `provisional-not-an-answer`: a card with `provisional` and the person asks
  "did I say to file receipts there?"; expects "no, the box decided".
All land run on the worktree's test1 clone.

## What will hold this after it ships

`t.check` tests on the pure parts (options line, counter toggle, review
selection) and on the commands against a temp box; DOM tests for the card
beside the chat and the counter segment; the mutation test with a test-double
registry; the four knowledge audits for the agent's judgment. No new tier.

## Implementation order

1. Track C (field and commands): everything else records through it.
2. Track D (skills): needs C's commands.
3. Track E (background run): needs D.
4. Track A (look and buttons): needs E's mutation for the button.
5. Track B (counter).
6. Track F (review): needs C and D.
7. Docs: `docs/questions.md` (Later, provisional, the review),
   `docs/design/trust.md` (the rung), `docs/glossary.md`.

## Rollout shape

Done when the tests named in each first chunk pass, the four audits pass, and
on test1: Figure it out on a question closes it and a background chat records
a provisional decision; the review, run by hand (`bbx procedure run
question-review`), reraises one simplified question and decides one; the
Questions page shows the decided one as the box's. No migration. Ships with
`questions-beside-the-chat.md` as one piece on the boxholder's finish ask.
