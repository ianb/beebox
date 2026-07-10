# Questions, end-to-end

Status: proposed 2026-07-10, not yet implemented.

Redesign of the questions subsystem so that it does the job it exists for:
the box asks the boxholder things it cannot decide alone, the boxholder
answers with minimal friction, the answer both acts and **teaches** — every
answer lands as a concrete, durable change to the box's knowledge (guide,
briefing, or personality), not just a one-shot side effect. Resolves
`/issues/2026-06-26-questions-end-to-end-d1.md` and
`/issues/2026-05-19-questions-aging-policy.md`; explicitly rejects
`/issues/2026-06-09-in-chat-interactive-questions.md` (see NOT in scope).

## The purpose frame

A question is the agent **borrowing authority it doesn't have**. Two flavors,
usually co-occurring:

- **Epistemic authority** — "is this true / what do you prefer?" The answer is
  a fact or preference whose home is a knowledge sink as a `user-stated`
  belief (the evidence model of `docs/implemented-plans/box-retrospectives.md`:
  inferred beliefs cap at `medium`; promotion requires the boxholder — a
  question card *is* the promotion mechanism).
- **Decision authority** — "what do I do with this item?" The answer unblocks
  a held item.

**Every answer is precedent.** When the boxholder says "receipts like this go
in `finance/`", the placement is the small part; the rule is the valuable
part. Today's design captures only the placement (the `directive:` moves one
file) and discards the rule. This plan makes both products of an answer
first-class: the immediate effect (`directive:`) and the durable learning
(`learning:` — the belief being tested and the sink it lands in, declared at
ask time). `docs/triage.md:131` already demands this: *"needing to carry both
a rule-update and a placement instruction in one answer. Evolve the question
system to fit this case."*

Design decisions settled with the boxholder (2026-07-10):

- The question declares **where the learning goes** as part of the ask. The
  contexts that solicit formal questions are prompt contexts where we can
  also say where the response lands, so this is cheap at ask time and makes
  recording the answer mechanical.
- Questions are **queue-only**. Interactive chat is a different, synchronous
  situation and does not use this primitive; retrospectives already convert
  chat into learning. No in-chat question tag.
- Surfacing is **web-first and prominent**: a pending-questions indicator in
  the app header, visible on mobile where other nav collapses. Telegram is
  used sparsely — no inline-button answering now. iOS push arrives later with
  the iOS app; the deep-link fixes here are what it will reuse.
- `expired` stays: questions age out of the active view on a schedule but
  **remain answerable** — demote, don't close.
- When the situation is non-interactive (a background job) and the learning
  destination is known, asking is a *good default*, not a failure.

## Stated preferences this plan trades against

- `docs/engineering-principles.md` — findings trace to: **1** (types are
  structure: status union, structured `learning:` instead of prose-only
  directive), **2** (exhaustive dispatch on `input.type`), **3** (validate at
  boundaries: `via` is currently an unvalidated cast; select-without-options
  is currently representable), **4** (resilient AND never silent: the
  answered-but-jobless hole; expiry must be visible, not decay), **8** (one
  way: duplicate raw-Fastify answer route, two frontend `CardInfo` types),
  **10** (testability: the aging sweep gets injected time), **11/12**
  (enforcement beats convention; the maintainer is an agent — schema
  instructions + knowledge audits over tribal knowledge).
- `callback-box/CLAUDE.md` — *"HTTP endpoints go in tRPC by default … Older
  raw routes are tech debt — migrate when you touch the area"*; *"Time
  discipline. Get timestamps via `getBoxTime`/`getBoxTimeISO` … not plain
  `new Date()`"*; the cb-migration boundary (a field removal on cards existing
  boxes already hold needs a migration).
- `callback-box/code-style.md` — Result-vs-throw convention, `withCardLock`
  for same-file RMW, defensiveness rules.
- Shipped precedent: the retrospective evidence model
  (`docs/implemented-plans/box-retrospectives.md`) — confidence/source
  vocabulary, question-as-approval-gate, `Retro-Run:` trailers. This plan
  generalizes that shape rather than inventing a parallel one.

## What already exists

- **Schema** — `src/schemas/question.ts:37-72`: `status
  (pending|answered|expired)`, `memo`, `prompt`, `input {type:
  select|text|confirm, options [{id,label}]}`, `directive`, `context
  [{ref,text?}]`, `answer {text,selected?}`, `answered-at`, `answered-via`,
  `answered-by`. Reused and extended. Three template builders
  (`question.ts:83-122`); the confirm template (`question.ts:113-122`) emits
  `input: { type: "confirm" }` with no options.
- **Answer command** — `src/core/commands/answer.ts` (`executeAnswer`,
  `resolveSelectAnswer:95-127`, `resolveConfirmAnswer:132-151`,
  `resolveAnswer:158-194`, `createFollowupJob:200-226`). Reused; the
  resolution logic is sound after the two 2026-06/07 fixes (`4c7f3b9a`,
  `41550e32`). Known defects fixed in Track B: the follow-up job is created
  *after* the answer commit (lines 295-321) so a job-write failure strands an
  answered question; `createFollowupJob` uses `new Date()` (line 205)
  violating time discipline; `answered-via` is set by unvalidated cast
  (line 289: `via as "web" | "cli" | "api"`).
- **Follow-up job** — `src/schemas/question-followup-job.ts` (template at
  50-65, agent instructions at 23-45): generic reactor job carrying
  `question-ref`, `directive`, `answer`. Reused; instructions extended for
  learning capture.
- **Producers** — triage guesses (`src/core/triage/routing.ts:93-126`,
  `createGuessQuestion`: one select question per `guess`-confidence item,
  options = categories + `_other`); scan-import
  (`src/core/commands/scan-import-cards.ts:94-113,125-151,153-177`); the
  retrospective integrate step
  (`templates/procedures/process-retrospective.procedure.card:165-191` —
  *"a proposed briefing correction becomes a question card quoting the
  evidence"*). All reused; triage and retro gain `learning:`.
- **Knowledge sinks + evidence model** — personality card
  (`config/main.personality.card`), guide cards
  (`src/schemas/guide-elements.tsx:19-30`, `ConfidenceLevel`,
  `BeliefSource`), briefing card (`src/schemas/briefing.tsx`, compiled into
  the box `CLAUDE.md` via `src/core/docs-gen/claude-md.ts:20`). Reused as-is
  — `learning.sink` is exactly the retro sink vocabulary minus `question`
  itself. No new store.
- **Surfacing** — `QuestionsPage`/`QuestionsList`
  (`src/frontend/src/components/questions/QuestionsList.tsx`),
  `QuestionForm.tsx` (widget choice at line 28: `hasOptions = …` — options
  presence, not `input.type`, decides the widget, which is why confirm
  renders as a textarea), dashboard `AttentionCards.tsx` (links to the raw
  card view), notification sweep `src/core/question-alert.ts:50-91` (latch
  file `.callback-box/notified-questions.json`; single question deep-links to
  `/<box>/browse/<path>` — a page with **no answer form**, since the
  `question` file type registers only an icon,
  `src/frontend/src/file-types/builtins.tsx:30`). All reworked in Tracks C/D.
- **Notification plumbing** — `notifyBoxholder`
  (`src/core/notify-boxholder.ts:67`) fans out to web-push +
  Telegram-message output cards; `checkPendingQuestionsAndNotify` runs from
  `cb finalize` (`src/cli/commands/finalize.ts:32`); the scheduler daemon
  ticks every box every 60s (`src/core/schedule/scheduler.ts:216` is the
  model for a time-based sweep, with per-task latch state via
  `src/core/schedule/state.ts`). Reused: the aging sweep rides this pattern.
- **Prompt surface** — `questionsSection`
  (`src/core/agent-guide/cards.ts:174-181`) and the where-to-record table
  (`src/core/agent-guide/behavior.ts:78-84`, *"When in doubt, ask"*). Both
  rewritten in Track E. Note `cards.ts:178` currently promises *"Set
  `answered-by` to your agent name so the answer routes back to you"* —
  **nothing reads `answered-by` anywhere in the codebase**; the field and the
  promise are removed.
- **Locks/commits** — `withCardLock` (`src/lib/card-lock.ts`),
  `stageAndCommitPaths` (`src/lib/git.ts`). Reused; Track B moves the job
  write inside the existing lock + commit.
- **Dead/duplicated code touched** — raw-Fastify `POST /api/actions/answer`
  (`src/webapp/routes/actions.ts:57-114`) duplicates the tRPC procedure
  (`src/webapp/trpc/routers/actions.ts:10-50`) the frontend actually uses;
  hand-written `CardInfo` (`src/frontend/src/api.ts:58-68`) vs the
  tRPC-derived one in `AttentionCards.tsx:13`. Both consolidated (principle 8).

## Prior art (external)

- **Web-push action buttons are not viable cross-browser**: `Notification.
  actions` is Chromium-only; Firefox and Safari don't implement it
  (https://caniuse.com/mdn-api_notification_actions,
  https://bugzilla.mozilla.org/show_bug.cgi?id=1225110). Supports the
  decision to invest in the web surface + deep links instead of notification
  buttons. iOS web push requires an installed PWA (iOS 16.4+) with thin
  action support (https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide).
- **Telegram inline keyboards** would work (callback_query + 64-byte
  `callback_data`, ack-then-edit pattern: https://core.telegram.org/bots/api,
  https://gramio.dev/telegram/methods/answercallbackquery) but require a new
  inbound branch — deferred, Telegram is sparsely used here (NOT in scope).
- **Never auto-answer on timeout**: Claude Code's AskUserQuestion 60s
  "proceed with best judgment" default drew significant criticism as unsafe
  (https://github.com/anthropics/claude-code/issues/30740). LangGraph
  interrupts have no timeout at all — they wait indefinitely
  (https://docs.langchain.com/oss/python/langgraph/interrupts). This plan's
  expiry **never synthesizes an answer**; it only demotes visibility.
- **Expire-with-defined-fallback, remind-then-escalate** is the production
  HITL pattern: HumanLayer timeout-driven escalation
  (https://www.humanlayer.dev/docs/quickstart-python), Slack Wait-for-
  Response 1-30-day expiry with an explicit expired branch
  (https://api.slack.com/best-practices/blueprints/approval-workflows),
  Temporal/Cloudflare durable-async-state approval cookbooks
  (https://docs.temporal.io/ai-cookbook/human-in-the-loop-python).
- **Auto-close discards signal** — GitHub stale-bot criticism converges on
  "label, don't close" (https://github.com/actions/stale,
  https://news.ycombinator.com/item?id=28998374). Supports expired-stays-
  answerable: demote from the active view, preserve the card and the signal.
- No integrated prior art was found combining notification actions with a
  question-card lifecycle; the closest analogues are the Slack/Telegram
  strip-buttons-after-answer UX patterns above.

## Tracks / scope

Ordered by implementation dependency, then surface size.

### Track A — Schema and lifecycle vocabulary

**What.** Extend `QuestionSchema` with the learning declaration and lifecycle
fields; retire `answered-by`; tighten validation.

**Why.** The card cannot express the thing questions are for (where the
learning lands), can express illegal states (a select with no options), and
carries a field that is documented as load-bearing but read by nothing.

**Direction.**

```yaml
learning:            # optional — where the answer's durable knowledge lands
  sink: guide | briefing | personality
  ref: config/finance.guide.card      # optional: the specific target card
  proposal: >                         # the belief being tested, quotable
    Receipts photographed at intake belong in finance/receipts/.
asked-at: 2026-07-10T09:00:00-07:00   # set by all templates at creation
expires-after: P30D                   # optional ISO-8601 duration override
status: pending | answered | dismissed | expired
dismissed-at: …                        # set on dismissal (like answered-at)
expired-at: …                          # set by the aging sweep
```

- `learning.sink` reuses the retro sink vocabulary
  (`src/core/retro/observations.ts:19`) minus `question`. No `claude-md`
  sink: the briefing already compiles into the box CLAUDE.md
  (`src/core/docs-gen/claude-md.ts:20`), so briefing *is* the CLAUDE.md path.
- `answered-by` removed from schema, templates, and instructions.
- Zod `superRefine`: `input.type === "select"` requires `options` with ≥ 2
  entries (illegal state made unrepresentable — principle 1/3). `confirm`
  and `text` must NOT carry `options`.
- Schema `instructions` rewritten: drop the `answered-by` promise; document
  `learning:` ("state what you are trying to learn and where it should be
  recorded — when the destination is known, asking is cheap"); document the
  four statuses; keep the directive guidance.
- `question-followup-job` template/schema gain a `learning` passthrough
  (same shape) so the follow-up agent doesn't need to re-read frontmatter
  shape from the question, and its `instructions` gain the learning step —
  see Track B.

**Vocabulary lock-ins.** Field names `learning.sink/ref/proposal`,
`asked-at`, `expires-after`, `dismissed-at`, `expired-at`; status values
`dismissed`, `expired` (now real); sink names identical to retro's.

**Migration.** Removing `answered-by` and requiring select-options are shape
changes on cards existing boxes hold (cb-migration territory). Migration
script: strip `answered-by:` from existing question cards; backfill
`asked-at:` for pending questions from the card's git add date; verify no
existing select question violates the options refinement. Run per
`docs/migrations.md` on test1 + prod boxes. The two live test1 retro
questions also get their directives fixed: they instruct edits to the
briefing's `<agent-needs-to-know>` element, a tag retired by the Markdoc
migration (current vocabulary is `{% correction %}`, `src/schemas/
briefing.tsx:91-94`) — answered today they would mis-execute.

**First chunk.** Schema change + template updates + migration script +
schema doctest (`test/schemas/question.doctest.md`: refinements, statuses,
learning shape) landing together.

### Track B — Answer round-trip integrity

**What.** Make answering atomic, typed, and correct for every question type;
consolidate the duplicate route; cover with doctests.

**Why.** Concrete defects: (1) the follow-up job is written after the answer
commit, so a failure between them permanently strands the answer —
`loadPendingQuestion` (`answer.ts:78-86`) then rejects the retry with
*"Question is not pending (status: answered)"*; (2) confirm answers arriving
as anything but literal yes/no tokens hard-fail (`answer.ts:144-150`); (3)
`new Date()` at `answer.ts:205` and the `via` cast at `answer.ts:289`; (4)
`resolveSelectAnswer`, `resolveConfirmAnswer`, and `createFollowupJob` have
zero test references; (5) the raw route duplicates the tRPC procedure.

**Direction.**

- **Atomicity**: build the follow-up job content *inside* the `withCardLock`
  span and commit question + job in one `stageAndCommitPaths` call (one
  commit, message `Answer question: <name>`, trailer `Answered-Via`). The
  job file is new and uniquely named, so including it under the question's
  card lock adds no contention. A pre-commit failure leaves the question
  pending and the answer retryable (principle 4: no silent loss; no
  reconciliation sweep needed because the window no longer exists).
- **Confirm**: `resolveAnswer` accepts `selectedId: "yes" | "no"` for
  confirm questions directly (the new UI's path), with optional `answer`
  text carried as a note into `answer.text`; typed free-text still
  normalizes via `resolveConfirmAnswer`.
- **Status guard**: answering allowed for `pending` and `expired` (and
  `dismissed` — an un-dismissal is a boxholder's prerogative); only
  `answered` is terminal. New `dismiss` command (`cb dismiss` /
  `actions.dismiss` tRPC mutation) flips `pending → dismissed` with
  `dismissed-at`, same lock + commit discipline, no follow-up job.
- **Hygiene**: `getBoxTimeISO` for the job timestamp; `via` validated by a
  Zod enum in `AnswerArgsSchema`; delete the raw-Fastify answer route
  (`src/webapp/routes/actions.ts:57-114`) and move its doctest coverage to
  the tRPC procedure; collapse the frontend to the tRPC-derived `CardInfo`.
- **Follow-up instructions** (`question-followup-job.ts:23-45`) rewritten to
  a two-product contract: (1) execute `directive:` with the answer; (2) if
  `learning:` is present, record the confirmed belief in the declared sink
  with `source: user-stated` (or record the decline against the proposal —
  a "no" is also learning); (3) even without `learning:`, ask whether the
  answer generalizes and record the rule if it does. Follows the retro
  integrate step's evidence discipline (quote the answer, ref the question).

**First chunk.** Atomic commit + status-guard change + `answer.ts` doctest
(`test/core/commands/answer-command.doctest.md`: select by letter/label/id,
confirm by selectedId+note, text, expired-answerable, already-answered
rejection, single-commit assertion).

### Track C — Type-driven answer UI and prominent surfacing

**What.** The form renders by `input.type`; questions are visible from every
page; every surface lands on an answerable view.

**Why.** `QuestionForm.tsx:28` chooses the widget by options-presence, so
confirm questions render as a blank textarea whose submissions the backend
then rejects unless they are literally yes/no. The dashboard is low-traffic
(boxholder: surfacing belongs in the header, visible on mobile). The
notification deep link lands on a raw card view with no form.

**Direction.**

- `QuestionForm` switches exhaustively on `input.type` (frontend `.tsx`
  switch, every case listed, no default — code-style exhaustiveness):
  `confirm` → Yes/No buttons + optional note field (submits
  `{selectedId, answer?}`); `select` → existing card-style radios (submits
  the label; backend resolves, unchanged contract); `text` → textarea.
  `memo` and `learning.proposal` are shown with the prompt — the boxholder
  should see what the box is trying to learn before answering. A Dismiss
  affordance calls the new dismiss mutation.
- **Header indicator**: a badge in the app header (`AppNav`) showing the
  pending-question count, visible in the collapsed mobile nav, linking to
  the questions page; fed by the existing `status.questions` query +
  `question-answered`/`card-created` bus invalidation
  (`QuestionsList.tsx:24-34` is the pattern). This is the primary "there is
  activity" surface.
- **Question renderer**: register a `question` file-type renderer
  (`src/frontend/src/file-types/builtins.tsx:30` currently registers only an
  icon) that shows the card with an embedded `QuestionForm` when answerable,
  and the recorded answer + what-was-learned when answered — so
  `/browse/<path>` deep links (notifications, dashboard, context refs)
  always land somewhere actionable.
- Answered/dismissed/expired archive in `QuestionsList` shows the answer
  text and status, not just a status word; expired questions render with the
  form still available (demoted, not closed).

**First chunk.** Type-driven `QuestionForm` + confirm submission path,
verified against the Track B backend by driving the live app (`bin/browse`).

### Track D — Aging: nudge, expire, preserve signal

**What.** The queue drains or demotes instead of accumulating silently.

**Why.** `expired` has been dead vocabulary since the schema was written;
`issues/2026-05-19-questions-aging-policy.md` sketched the policy;
`docs/architecture/spirit.md:81` states the intent (*"at some point the box
should figure out that the question is moot and move on, rather than nagging
forever"*).

**Direction.**

- A sweep alongside `checkPendingQuestionsAndNotify`, driven from the same
  `cb finalize` call site (`finalize.ts:32`) — it already runs every wakeup,
  which is the right cadence (nothing here needs minute precision).
  Per-question state extends the existing latch file
  (`.callback-box/notified-questions.json`) with `firstSeenAt`/`nudgedAt`.
- **Nudge at 7 days pending** (default): one re-notification through
  `notifyBoxholder`, marked as a reminder, latched so it fires once.
- **Expire at 30 days pending** (default): set `status: expired` +
  `expired-at`, commit with a trailer (`Expired-By: question-aging`), drop
  from the active list/header count and the notification set. The card stays
  in `box/questions/` and stays answerable (Track B). Never auto-answer
  (prior art: the AskUserQuestion timeout backlash).
- `expires-after:` on the card overrides the 30-day default per question
  (time-sensitive questions can be shorter; evergreen ones can set a long
  duration). Nudge fires at half the expiry window when overridden.
- Time injected (`getBoxTime` / `CB_TIME`) so the sweep is doctestable
  (principle 10).
- **Signal, not decay**: expiry/dismissal are visible statuses on durable
  cards, so agents encountering the area see what was asked and ignored;
  Track E's ask-discipline tells agents to check them before asking again.
  Automated cross-question aggregation ("this class of ask never gets
  answered — stop asking") is deferred (NOT in scope) — the durable statuses
  created here are the substrate it would read.

**First chunk.** The sweep + its doctest
(`test/core/question-aging.doctest.md`: nudge-once latch, override, expiry
commit, expired excluded from pending count) behind the finalize call.

### Track E — Creation discipline and prompt surface

**What.** Make asking happen at the right times, with the learning
destination declared, without re-asking what's already been asked.

**Why.** Only three producers ask today, none declare learning, and the
guide's *"When in doubt, ask"* (`behavior.ts:84`) has no operational teeth —
no decision rule, no dedup discipline, and a false promise about
`answered-by` routing.

**Direction.**

- `questionsSection` (`agent-guide/cards.ts:174-181`) rewritten around the
  decision rule: *interactive chat → just ask in conversation (not a card);
  non-interactive (jobs, triage, procedures) + you know where the learning
  goes → create a question card with `learning:`; ambiguity that blocks a
  job → finish by asking, never guess past it; before asking, check
  `box/questions/` including answered/dismissed/expired cards — an existing
  answer is a `user-stated` fact, a dismissal/expiry is a signal the
  boxholder didn't care to answer that.*
- Triage (`createGuessQuestion`, `routing.ts:93-126`) populates `learning:`
  — sink `guide`, ref the relevant guide card, proposal derived from the
  guess (e.g. *"items like <summary> belong in <category>"*) — so answering
  a triage question durably teaches triage, not just placement of one item.
  The directive keeps the placement instruction (the two-product contract).
- Scan-import questions get `learning:` only where a durable rule is
  plausible; its unsure-page questions are usually pure decision authority —
  the follow-up job's "does this generalize?" step covers the exception.
- The retro integrate prompt
  (`process-retrospective.procedure.card:165-191`) updated: its question
  cards declare `learning: {sink: briefing, proposal: …}` and stop
  referencing the retired `<agent-needs-to-know>` element (current briefing
  vocabulary: `{% correction %}`).
- Remove every `answered-by` mention from prompts and schema instructions.

**First chunk.** Guide + schema-instruction rewrite with its knowledge-audit
entries (below), run against test1.

### Track F — Docs, audits, and issue reconciliation

**What.** `docs/questions.md` (the subsystem's design doc: purpose frame,
lifecycle, learning contract, aging policy — currently the only design prose
lives inside `docs/triage.md` §5, which gets a pointer); knowledge audits
(below); close out the three issues (`questions-end-to-end-d1` →
implemented; `questions-aging-policy` → implemented;
`in-chat-interactive-questions` → closed `wontfix` with the decision note:
synchronous chat is a different situation, retros convert chat to learning).

## Subplans

None. The one candidate — Telegram callback answering — is out of scope
rather than a subplan, because the boxholder's channel usage doesn't justify
it now; the iOS app's push story will re-open surfacing as its own plan.

## Failure modes

> **Critical gap (existing, fixed by Track B):** answer commit succeeds →
> follow-up job write fails → question is `answered`, no job exists, retry
> rejected, answer + directive silently lost. The atomic single-commit
> design removes the window entirely.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Job write/commit fails mid-answer | Track B doctest (single-commit assertion) | Track B: both files in one commit inside the lock; failure leaves question pending, retryable | Clear (command returns the error; nothing partial committed) |
| Two concurrent answers (web + CLI) | Track B doctest | `withCardLock` serializes; second sees `answered` and is rejected | Clear ("Question is not pending") |
| Confirm submitted with unknown `selectedId` | Track B doctest | Zod/`resolveAnswer` reject with typed error | Clear |
| Select question authored without options | Track A schema doctest | `superRefine` rejects at validation (creation + `cb validate` + load) | Clear, at the boundary |
| Follow-up agent's sink target (`learning.ref`) missing/moved | No (agent-mediated) | Instructions: resolve by sink type; create the guide entry/card if absent; note the substitution in the job commit | Clear (visible in commit/report) |
| Aging sweep latch file corrupt/missing | Track D doctest (missing-file case) | Same behavior as today's notify latch: rebuilt from scratch; worst case one duplicate nudge and `firstSeenAt` resets | Visible (a duplicate notification), not harmful |
| Expiry commit races a simultaneous answer | Track D doctest | Expiry runs under `withCardLock` per card; loser sees non-pending status and skips | Clear |
| Deep link opened after question was answered | Manual + renderer doctest via `cb render` | Track C renderer shows the answered state instead of a form | Clear |
| Notification channels absent (no push subs, no Telegram) | Existing (`question-alert.doctest.md`) | `notifyChannels` guard (`notify-boxholder.ts:36-41`); header badge still shows | Clear — web surface is primary |
| Migration meets a hand-edited card that fails schema | Migration dry-run step | `cb validate` pass in the runbook before/after; script reports per-card | Clear |
| `via` arrives as a junk string | Track B doctest | Zod enum in `AnswerArgsSchema` (replaces the cast) | Clear |

## Agent-flow / user-flow edge cases

- **Wrong field** (learning proposal stuffed into `directive:`, or vice
  versa) — **ADDRESSED**: schema instructions define the two-product split
  with an example; the follow-up job's "does this generalize?" step recovers
  the learning even when the asker only wrote a directive; knowledge audit
  verifies recall.
- **Stale ref** (`context.ref` or `learning.ref` points at a moved/archived
  card) — **ADDRESSED** (agent-mediated): follow-up instructions say to
  re-resolve by sink type and note the substitution; a dangling `context.ref`
  degrades to answering with less context, which the `memo` field exists to
  survive (*"so the user can answer without looking anything up"*,
  `question.ts:60`).
- **Two agents touching the same card** — **ADDRESSED**: all status
  transitions (answer, dismiss, expire) go through `withCardLock` +
  status-guard; Track B/D doctests cover the races.
- **Hand-edit drift** (boxholder edits a question card by hand, breaks
  YAML/enum) — **ADDRESSED**: cards validate on load; `answer` returns the
  parse error; per-box pre-commit runs `cb validate --staged`. The select
  `superRefine` also catches a hand-deleted options array.
- **Fabricated free-form value** (agent invents a `learning.proposal` not
  grounded in evidence) — **ADDRESSED** by convention, not code: the retro
  precedent requires quoting evidence in `memo`/`context`; the boxholder
  sees the proposal on the answer form (Track C) before endorsing it —
  the human is the gate, which is the point of the feature.
- **Validation error UX** — **ADDRESSED**: the worst current message
  (*"Confirm questions require yes/no answer"* after the UI itself offered a
  free textarea) becomes unreachable from the UI (buttons); select errors
  already enumerate options (`answer.ts:117-124`); tRPC surfaces
  `BAD_REQUEST` messages to a toast (existing pattern).
- **Partial migration / transition state** — **ADDRESSED**: all new fields
  optional, old cards load unchanged during the window; the only breaking
  change (`answered-by` removal, select refinement) lands in the same commit
  as its migration script; boxes migrate per `docs/migrations.md`. A
  question created pre-migration and answered post-migration works — the
  answer path never touches the removed field.

## NOT in scope

- **In-chat interactive questions** — rejected, not deferred: synchronous
  chat is a different situation; the agent just asks in prose and the
  retrospective converts chat into learning. The 2026-06-09 issue closes
  `wontfix` (Track F).
- **Telegram inline-button answering** — Telegram is sparsely used by the
  boxholder; the callback_query inbound branch isn't worth its maintenance
  today. The deep-link + header work is channel-agnostic groundwork.
- **Web-push action buttons** — Chromium-only (prior art); revisit with the
  iOS app's push story.
- **Question batching** (one card covering N held items, triage.md:230) —
  deferred by explicit decision; atomic cards keep learning capture and
  lifecycle per-question; batching, when it comes, belongs in the surfacing
  layer (answer several in one sitting), not the card shape.
- **Automated stop-asking aggregation** (detecting that a class of question
  never gets answered) — the durable expired/dismissed statuses are the
  substrate; the detector (likely a retro concern) needs its own design.
- **Email/digest channel** — no digest mechanism exists; out of scope.
- **`answered-via` device breakdown, analytics** — no consumer.

## Open design questions

- Exact default durations (7d nudge / 30d expire) are tunable constants, not
  design questions; they land as named constants with the sweep.
- Whether the *ask itself* should also record the proposal as a
  hypothesis-confidence belief in the sink (so the agent acts on it while
  the question is pending, retro-style). Discussed 2026-07-10 without a firm
  ruling; **not** in this plan's chunks — the `learning.proposal` field is
  deliberately shaped so that a later plan can add "record as hypothesis at
  ask time" without a schema change. Lean: revisit after the base loop is
  observed in use.

## Knowledge audits

New agent-facing concepts → entries in `src/dev/knowledge-audits.yaml`, run
(not just written) against test1 before the plan completes:

- `knows_directly`: where does an answered question's learning get recorded,
  and what marks it (`learning.sink`, `source: user-stated`).
- `knows_directly`: the ask decision rule — when a background job hits
  blocking ambiguity, what does it do (question card with `learning:` +
  finish by asking), and what does it check first (existing
  answered/dismissed/expired questions).
- `knows_directly`: what `dismissed`/`expired` mean and that expired
  questions remain answerable.
- Skip-with-rationale for the aging sweep internals: purely infrastructural,
  no agent needs to recall latch mechanics.

## Implementation order

1. **A** — schema + templates + migration + schema doctest. Unblocks
   everything.
2. **B** — atomic answer + confirm/selectedId path + dismiss command +
   status guard + hygiene (time, `via`, route dedup, `CardInfo`) + answer
   doctests. Depends on A (statuses, learning passthrough).
3. **C** — type-driven form + header badge + question renderer + archive.
   Depends on B (confirm submission contract, dismiss mutation).
4. **D** — aging sweep + doctests. Depends on A (statuses, `expires-after`)
   and B (expired-answerable guard); independent of C.
5. **E** — prompt rewrite + triage/retro/scan `learning:` population +
   knowledge audits authored. Depends on A's vocabulary; lands after B so
   the promises are true when written.
6. **F** — `docs/questions.md`, audits **run**, issues closed, doc-check
   clean.

Each chunk is a commit-sized unit with its tests; the plan ships as one unit
(merge to main only on the boxholder's explicit go).

## Rollout shape

- **Tests first, as design tools**: the named doctests above
  (`question.doctest.md`, `answer-command.doctest.md`,
  `question-aging.doctest.md`, the tRPC answer/dismiss route doctest
  replacing the raw-route one) define done-when. Frontend verified by
  driving the live app (`bin/browse`) for: confirm one-tap answer, select
  answer, dismiss, header badge count, deep-link-to-renderer, expired card
  still answerable. `cb render` SSR check for the question renderer.
- **Knowledge audits** land with Track E and are executed (status comment
  recorded in `knowledge-audits.yaml`) before completion.
- **Migration**: scripted, run first on a scratch clone of test1, then
  test1, then prod boxes per `docs/migrations.md`; `cb validate` clean
  before and after. Small blast radius (a handful of question cards exist).
- **User-story re-audit**: after implementation, re-run the user-story
  method scoped to questions (reader agents → adversarial verification →
  `bin/browse` checks, per `docs/reports/user-stories-audit-2026-06-26.md`'s
  method note) as the acceptance pass — the subsystem this plan exists to
  fix was flagged by exactly that method.
