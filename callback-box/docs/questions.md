# Questions

**Status:** implemented — the design doc for the queue-only question
subsystem; not yet re-verified line-by-line against current code.

Design and implementation history: `docs/implemented-plans/questions-end-to-end.md`.

## Purpose

A question card is the agent **borrowing authority it doesn't have** —
epistemic authority ("is this true / what do you prefer?") or decision
authority ("what do I do with this item?"), usually co-occurring. Two things
follow from that framing:

- **Every answer is precedent, not just a one-shot effect.** When the
  boxholder answers "receipts like this go in `finance/`," the placement is
  the small part; the rule is the valuable part. A question that only moves
  one file and discards the rule wastes half the boxholder's answer.
- **The question declares its learning destination at ask time.** The
  contexts that raise formal questions (jobs, triage, procedures) are prompt
  contexts where the asking agent already knows *why* it's asking and where
  a confirmed belief should live — so declaring the destination is cheap then
  and mechanical later, versus trying to reconstruct it after the fact.

Every answer therefore has up to two products:

- **Directive effect** (`directive:`) — the concrete action the answer
  unblocks (move a file, pick a category, resolve an ambiguity).
- **Durable learning** (`learning:`) — the belief the answer confirms or
  denies, recorded in a knowledge sink as a `source: user-stated` fact. This
  reuses the evidence/confidence vocabulary from
  `docs/implemented-plans/box-retrospectives.md`: inferred beliefs cap at
  `medium` confidence; a question card answered by the boxholder *is* the
  promotion mechanism to boxholder-endorsed fact.

Never auto-answer. A question that goes unanswered ages out of the active
view (see Aging below), but the system never synthesizes a response on the
boxholder's behalf — see Prior art in the plan for why (Claude Code's
`AskUserQuestion` timeout default and LangGraph's indefinite-wait interrupts
were both considered; this system follows the latter).

## Card shape

Schema: `src/schemas/question.ts` (`QuestionSchema`, type `question`).

```yaml
---
status: pending              # pending | answered | dismissed | expired
memo: >                      # why you're asking — so the boxholder can
                              # answer without looking anything up
prompt: "…"                  # the actual question
input:
  type: select                # select | text | confirm
  options:                    # select only — at least 2, unique ids and
    - { id: finance, label: "Finance" }   # case-insensitively-unique labels
    - { id: _other, label: "None of these — write a directive" }
learning:                    # optional
  sink: guide                 # guide | briefing | personality
  ref: config/finance.guide.card   # optional; for sink briefing MUST be the
                                    # root briefing (only it compiles into
                                    # the box CLAUDE.md — see below)
  proposal: >
    Receipts photographed at intake belong in finance/receipts/.
directive: "Move the held file into finance/receipts/."
context:
  - { ref: inbox/triaged/_unsure/receipt.pdf }
asked-at: 2026-07-10T09:00:00-07:00   # set by the creating template
expires-after: P30D          # optional ISO-8601 duration override
---
```

Filled in by the answer/dismiss/expire transitions, never by the asker:
`answer: { text, selected? }`, `answered-at`, `answered-via` (`web | cli`),
`dismissed-at`, `expired-at`. A question's status is single —
exactly the fields owned by its current status may be present; a
`superRefine` (`refineQuestionLifecycle` in `question.ts`) rejects a card
whose bookkeeping contradicts its `status`. Re-answering a `dismissed`/
`expired` question clears the stale `dismissed-at`/`expired-at` fields as
part of the transition.

### Input types and the option-id scheme

- **`select`** — `options: [{id, label}]`, at least two entries, enforced by
  a Zod `superRefine` (an illegal select-with-no-options card can't be
  created or loaded). `id` is the stable machine key an answer resolves to;
  `label` is what the boxholder sees. Ids must be unique; labels must be
  unique case-insensitively (answer resolution matches a typed answer
  against labels with `toLowerCase()`, so two labels differing only in case
  would be ambiguous). An answer may arrive as a letter (`a`, `b`, …
  indexing into `options` in order), a label, or a `selectedId` directly —
  `resolveSelectAnswer`/`resolveSelect` in `src/core/commands/answer.ts`
  normalize all three to the option's `{id, label}` pair.
- **`text`** — no `options`; the answer is free text.
- **`confirm`** — no `options`; the answer is normalized to `selectedId:
  "yes" | "no"` (the UI sends this directly as Yes/No buttons, with an
  optional free-text `answer` note carried alongside), or accepted as typed
  free text (`yes`/`y`/`true`/`1`, `no`/`n`/`false`/`0`) for API/CLI callers.
  `confirm` and `text` must NOT carry `options` — the same `superRefine`
  rejects one that does.

## Where questions live

**All question cards live in `box/questions/`.** This is the only place the
system looks for questions: `getSystemState` (`src/core/state.ts`) globs
`box/questions/**/*.question.card` to build the pending-question list that
feeds the header badge, the questions page, and the aging sweep. A question
card written anywhere else (e.g. inside a capture session's `.attach/`
scope, which scan-import used to do) is invisible to all of that — no page,
no badge, no notification, no aging. If a question needs to reference
material that lives elsewhere (an attach-scope file, a held inbox item),
that's what `context: [{ref, text?}]` is for — the card itself stays in
`box/questions/`.

## Lifecycle

```
pending ──answer──> answered
   │                    ^
   ├──dismiss──> dismissed ──answer──┘
   │                                 │
   └──(30d)──> expired ──answer──────┘
```

- **`pending`** — awaiting a response. The only status a question is created
  with.
- **`answered`** — terminal: the card no longer accepts a fresh answer
  (`answer.ts` allows answering only from `pending`, `expired`, or
  `dismissed`). A new question is asked instead of reopening one.
- **`dismissed`** — the boxholder declined to answer via the Dismiss
  affordance (`cb dismiss` / `actions.dismiss`). Only a `pending` question
  can be dismissed. Dismissed questions **remain answerable** — an
  un-dismissal is the boxholder's prerogative.
- **`expired`** — aged out of the active view by the aging sweep without an
  answer. Expiry **demotes visibility, it does not close the question** —
  the card stays in `box/questions/` and remains answerable. Only a
  `pending` question can expire (this is the sweep's own transition).

Before asking something new, agents are expected to check `box/questions/`
including `answered`/`dismissed`/`expired` cards, not just `pending` ones —
see "The decision rule for agents" below.

### Aging: nudge, then expire — never auto-answer

Implemented in `src/core/question-aging.ts` (`ageQuestions`), run from the
same `cb finalize` call site as the pending-question notification sweep
(`checkPendingQuestionsAndNotify`, `src/core/question-alert.ts`) — both ride
`cb finalize`'s existing per-wakeup cadence.

- **Nudge at 7 days pending** (default: `DEFAULT_NUDGE_AFTER_MS`). One
  re-notification through `notifyBoxholder`, latched (`.callback-box/
  notified-questions.json`, the `nudged` map) so it fires exactly once per
  question.
- **Expire at 30 days pending** (default: `DEFAULT_EXPIRE_AFTER_MS`). Sets
  `status: expired` + `expired-at`, commits with trailer `Expired-By:
  question-aging`, drops the question from the active list/header
  count/notification set. Never synthesizes an answer.
- **`expires-after:` on the card overrides both defaults** for that
  question — a time-sensitive ask can expire sooner, an evergreen one can
  last (or never) expire on the default clock. When overridden, the nudge
  fires at half the expiry window rather than the flat 7-day default.
- **Age is computed from the card's durable `asked-at` field, never from
  latch state.** A lost or corrupt latch file can only cause a duplicate
  nudge — it can never reset a question's age or block its expiry. The
  latch's only job is nudge-dedup.
- **Expiry is not notification-channel-gated.** `checkPendingQuestionsAndNotify`
  exits early with no channels configured, but the aging sweep's expiry half
  always runs — only nudge *delivery* depends on a channel existing (the
  header badge is the channel-independent surface).
- Time comes from `getBoxTime`/`getBoxTimeISO` (`CB_TIME`-honoring), never
  `new Date()`, so the sweep is doctestable with frozen time
  (`test/core/question-aging.doctest.md`).

## The answer round-trip

Answering, dismissing, and expiring all go through the same guarded
transition helper: `withQuestionTransition` in
`src/core/commands/question-transition.ts`.

**Why a guard, not just `withCardLock`.** `withCardLock`
(`src/lib/card-lock.ts`) only serializes read-modify-write within one Node
process; CLI answer, web answer, `cb finalize`, and the scheduler are
different processes. `withQuestionTransition` composes two locks:

1. The cross-process file lock (`src/lib/file-lock.ts`, one lock file per
   question under `.callback-box/question-locks/`) serializes across
   processes.
2. `withCardLock` serializes overlapping in-process callers on top.

After both locks are held, the card is **re-read and its status re-checked**
against the caller's `allowedStatuses` — so a transition that lost a race
(another process already committed a different status) sees the winner's
committed state and is rejected with a clear error, rather than clobbering
it.

**One commit, write-order matters.** Inside the guard, the caller's `plan`
returns a list of writes plus a commit message/trailers.
`applyAndCommit` writes every file, then commits them **all in one
`stageAndCommitPaths` call**. For `answer`, the plan lists the follow-up job
file **before** the answered card — the card's status flip is the commit
point, so the companion job must already exist on disk when it lands. A
crash between the two writes leaves `job + still-pending-question`
(harmless — answering again just creates a second job), never the
unrecoverable `answered-card-with-no-job` state that existed before this
guard.

**Rollback on commit failure.** The filesystem writes aren't atomic with the
git commit. If `stageAndCommitPaths` fails, `applyAndCommit` unstages the
paths and restores every touched file to its pre-write snapshot (or deletes
it, if it didn't exist before) — so a failed transition leaves the card
exactly as it was on disk and stays retryable, instead of stranding an
`answered`-on-disk card that rejects retries.

**Status guards per transition:**

| Command | Allowed from | Sets | Follow-up job |
|---|---|---|---|
| `answer` (`src/core/commands/answer.ts`) | `pending`, `expired`, `dismissed` | `answered`, `answer`, `answered-at`, `answered-via` | Yes |
| `dismiss` (`src/core/commands/dismiss.ts`) | `pending` | `dismissed`, `dismissed-at` | No |
| aging sweep's expire (`src/core/question-aging.ts`) | `pending` | `expired`, `expired-at` | No |

### Follow-up job: the two-product contract

Answering creates a `question-followup-job` card
(`src/schemas/question-followup-job.ts`) carrying `question-ref`,
`directive`, the resolved `answer` text, and (when present) the question's
`learning` passthrough. Its instructions tell the executing agent to do, in
order:

1. Execute `directive:` using `answer:`.
2. **If `learning:` is present, record it** in `learning.sink` as a
   `source: user-stated` belief — quote the answer, ref the question card
   (same evidence discipline as the retrospective's integrate step). A "no"
   is also learning: record the decline against the proposal rather than
   dropping it. For sink `briefing`, only the **root** briefing compiles
   into any agent's context (`compileBriefings` only compiles the root —
   directory briefings are an explicit TODO,
   `src/core/docs-gen/compile.ts:74-101`), so `learning.ref` must resolve to
   the root briefing even if it names something else; the job instructions
   say to resolve and note the substitution.
3. **If `learning:` is absent, still ask whether the answer generalizes** —
   many answers are precedent even when the asker didn't declare a
   destination. Record it if it does; skip if it's genuinely a one-off (the
   common, correct outcome — not a failure).

This is where `learning.sink`/`source: user-stated` actually lands: the
follow-up job is the only writer of the belief, and it always writes with
that source tag, never a higher-confidence one — a question answer is a
boxholder statement, which is exactly what `user-stated` means in the retro
evidence model.

## Surfacing

- **Header badge** — retired 2026-08 with the nav link row
  (`docs/plans/top-nav-ia.md`): the app bar no longer carries a
  pending-question count, and Questions has no nav presence unless a box
  pins `/questions` in its `nav.card`. The intended replacement is inline
  questions in chat (not built). Until then the Dashboard's attention cards
  (fed by the same `status.questions` tRPC query, invalidated on
  `question-answered`/`card-created`/`question-expired` bus events) are the
  in-app "there is activity" signal.
- **Questions page** (`QuestionsPage` / `QuestionsList.tsx`) — the full list:
  pending at the top, an archive of answered/dismissed/expired below
  showing the recorded answer and status (not just a status word). Expired
  questions render with the answer form still available — demoted, not
  closed.
- **Browse renderer** — the `question` file-type renderer
  (`src/frontend/src/renderers/question.tsx`) registers on `/browse/<path>`
  deep links (from notifications, dashboard, `context:` refs): shows the
  embedded `QuestionForm` when the question is answerable, or the recorded
  answer plus the `learning:` proposal once it's answered. The proposal is
  what the box wanted to learn, stated at ask time — not a record of what was
  actually learned; that recording happens separately, in the follow-up
  job's commits. Every deep link into a question card lands somewhere
  actionable, never a bare frontmatter dump.
- **Type-driven form** (`QuestionForm.tsx`) — dispatches exhaustively on
  `input.type`: `confirm` → Yes/No buttons + optional note; `select` →
  radios (submits the label; the backend resolves it); `text` → textarea.
  `memo` and `learning.proposal` render above the widget — the boxholder
  sees what the box is trying to learn before answering. A Dismiss
  affordance is available while `pending`.
- **Notifications + nudges** — `checkPendingQuestionsAndNotify`
  (`question-alert.ts`) notifies once per newly-pending question through
  `notifyBoxholder` (push + Telegram); the aging sweep's nudge is a second,
  one-time reminder at the 7-day/half-window mark. Both are best-effort
  fan-out on top of the header badge, which is the surface that always
  works regardless of channel configuration.

## The decision rule for agents

Where an agent is deciding whether to ask, and how, is the operative
question — not a separate policy from the lifecycle above. Stated in
`questionsSection` (`src/core/agent-guide/cards.ts`), which is always-on
agent-guide context:

- **In chat, just ask.** A synchronous conversation is not a question-card
  situation — the boxholder is right there. Never create a question card
  for something answerable in the reply. (This is also why in-chat
  interactive questions were rejected as a separate primitive — see NOT in
  scope below.)
- **In a job, triage pass, procedure, or wakeup**, creating a question card
  with `learning:` declared is a **good default** when the learning
  destination is known — not a fallback for having failed. If the situation
  blocks on ambiguity it can't resolve, the agent finishes by asking rather
  than guessing past it.
- **Before asking, check `box/questions/`** — including `answered`,
  `dismissed`, and `expired` cards, not just `pending` ones. An existing
  answer is a `user-stated` fact; don't re-ask it. A dismissal or expiry is
  itself a signal ("the boxholder didn't care to answer that") that raises
  the bar for asking again.
- Always set `directive:` — without it the answer's immediate effect goes
  nowhere (the follow-up job still records `learning:` if declared, even
  with no directive). Set `expires-after:` for a question that should age
  out sooner (or later) than the defaults.

## NOT in scope

- **In-chat interactive questions.** Rejected, not deferred
  (`issues/closed/2026-06-09-in-chat-interactive-questions.md`): synchronous
  chat is a different situation from the async queue — the agent just asks
  in prose, and retrospectives convert chat into learning. `box/questions/`
  is the only structured-question primitive.
- **Telegram inline-button answering.** The deep-link + header work is
  channel-agnostic groundwork; the `callback_query` inbound branch isn't
  built. Telegram is used sparsely enough that this isn't worth its
  maintenance yet.
- **Web-push action buttons.** Chromium-only across browsers; revisit with
  the iOS app's push story.
- **Question batching** (one card covering several held items at once).
  Atomic cards keep learning capture and lifecycle per-question; batching,
  if it comes, belongs in the surfacing layer, not the card shape.
- **Automated stop-asking aggregation** (detecting that a whole class of
  question never gets answered, and suppressing it). The durable
  `expired`/`dismissed` statuses created here are the substrate a future
  detector would read; the detector itself is undesigned.

See `docs/implemented-plans/questions-end-to-end.md` for the full rationale, prior art,
and failure-mode analysis behind these decisions.
