---
title: "Destination questions create triage follow-up todos"
status: implemented
workstream: jev-triage
issues:
  - ../../../issues/features/2026-09-24-agent-assigned-todos-have-no-pickup.md
---
# Destination questions create triage follow-up todos

A destination may ask whether each incoming item needs agent follow-up. A yes
answer adds an ordinary agent-assigned todo; absent questions do nothing.

**Issues addressed:** [Agent todo pickup](../../../issues/features/2026-09-24-agent-assigned-todos-have-no-pickup.md), partially: normal-sweep eligibility only. Its unapproved separate executor/attempt policy is not implemented or closed. Searched the
issue queue for triage/todo/destination and the existing Gmail preparation plan.
This separates the accepted todo track from that broader unfinished plan.

## Smallest fix and budget

Add one optional landmark field, evaluate it during classification, append an
existing frontmatter todo, and select it
in the existing daily sweep. Estimated changed source: 450–650 lines; tests:
350–500; authored documentation/plan/audit: 200–300. No generated output expected.
Total target is 1,000–1,450 changed lines. No new worker or task type.

## Stated preferences this plan trades against

The human explicitly chose a destination-specific question evaluated for each
item, and said a destination can omit the question. Reuse the normal todo sweep.
`beebox/CLAUDE.md:7`: "Work only on the requested problem." Gmail admission and
other open harness bugs remain separate. The pickup issue quotes the human's caution about out-of-control agent activity; retain the existing scheduled
procedure, its turn/item limits and authority rules instead of adding an executor. The prior accepted direction in
`gmail-admission-and-preparation.md:203` says the sweep must select newly
actionable agent todos on its next scheduled pass, without invented dates.

## What already exists

- `beebox/src/schemas/landmark.ts:118`: `export const LandmarkDestination = z.object({`;
  extend its optional filing fields without changing old cards.
- `beebox/src/services/jev-judge.ts:20`: `type: "noul"`; binary questions already
  share one judgment call with a destination Choice.
- `beebox/src/core/triage/decisions/storage.ts:1`: "Evaluated inputs are immutable
  after creation." Keep evidence/instructions/answers immutable in receipts.
- `beebox/src/core/triage/decisions/replay.ts:70`: "A moved/changed source can be
  reproduced from its preparation or application commit." Preserve an original
  application commit before changing source frontmatter.
- `beebox/src/shared/todo-model.ts:288`: `export const TodoEntrySchema = z`;
  reuse universal frontmatter todos, assigned/by agent, actual created date.
- `beebox/src/core/todo/review-sweep.ts:104`: `return { escalated, stirring, stale };`;
  this excludes fresh undated agent tasks. Add actionable eligibility.
- Connector cards currently bypass staged triage; metadata preservation is
  deferred to the future Gmail admission integration.

## Prior art (external)

No external premise is needed: this uses existing Jev Noul, Git receipts, todo
schemas, and scheduler behavior. No new provider/API/library is introduced.

## Ontology

Destination: an existing landmark `destinations` entry with `for: [triage]`.
`todo-question`: optional nonempty string on that entry; a per-item question,
not an unconditional toggle or a todo body supplied by incoming content.
Todo answer: probability of yes for that destination, recorded with the existing
judgment provenance. Yes means greater than 0.5; ties do not create work.
Agent todo: existing universal frontmatter entry; no new card type.
Actionable: an open agent-assigned todo whose start has arrived (or is absent)
and whose recheck allows review, selected by the existing bounded sweep.

## Tracks / scope

### 1. Destination question and classification

Add `todo-question?: string` to the landmark destination schema and
`todoQuestion?: string` to both compiled destinations and snapshots. Missing
fields retain old behavior. Jev sends a named Noul question per configured
destination in the same call as its Choice, with the same evidence and policy.
Store `todoAnswers?: Record<optionId, probability>` in the judgment; absent on
historical receipts. Only the chosen destination's answer creates a todo.
No-match/unclear creates none. A later correction can use the recorded answer
for its selected destination. Reject missing/malformed configured answers.

The legacy full-agent triage path also receives the question and returns an
optional boolean for its selected destination, so the same landmark configuration
has the same meaning with either engine. Ignore answers when no question exists.
Replay returns the new answers and explicitly reports changed todo outcome.

First chunk: schema, compilation, request construction and classification tests.

### 2. Annotation and provenance

Use a fixed authored todo sentence: review the item and follow up as needed,
quoting the configured question and linking the destination. Jev writes no prose.
Use `assigned: agent`, `by: agent`, actual box-local created date, and a stable
short `triage-<hash>` id derived from destination identity and question. Identity
is scoped to the card; existing entries with the same id win in full, including
completed status and recheck. Never invent deadlines/start dates.

The Jev apply path first commits routed original bytes with its normal trailers,
then annotates and commits the follow-up with the same decision provenance.
This lets existing prepare-again replay recover unmodified original bytes even
when the incoming card was untracked. Store compact mutable application metadata
for the todo write (id, pending/applied state, before/after hashes), saving the
expected hashes before replacing the source. An interrupted annotation accepts
only its recorded before or after bytes. Completed annotation retries return
without recreating or overwriting later edits, sync changes or completed todos.
Historical receipts without annotation keep their previous integrity checks.
No broad digest waiver for unfinished work. Acquire the destination card lock
before the Git lock; use scoped commits and atomic source writes.

Whether annotation is required comes from immutable snapshot and answer fields,
not the presence of mutable metadata. Save pending annotation metadata after the original-byte routing commit and
before replacing source bytes; the immutable fields still require annotation
if execution stopped before that metadata was saved. A configured question with no
recorded answer (for example unreadable evidence followed by correction) fails
explicitly before applying; prepare and judge again instead of inventing no.
The legacy path uses the same pure merge helper under card locking before its
move, only for a known routed category; repeated attempts keep existing todo
state. It does not gain a receipt or replay subsystem.

Validate that a positive annotation target is a card with valid frontmatter
before moving it; raw files cannot truthfully carry a frontmatter todo. Fail
explicitly rather than claiming annotation success. Existing input cards without
a question remain unaffected.

First chunk: deterministic todo merge + retry/replay regression around real Git.

### 3. Existing sweep

Add an actionable set to the normal todo-review precheck, after escalated and
stirring items and before stale. Select open agent-assigned todos on the plate;
respect future starts, recheck dates/never, terminal status, existing dedup and
25-item cap. Use the same review procedure and verification authority.

Update the shared todo-review instruction/schema's list vocabulary alongside
its precheck. Keep its existing task authority and turn/item bounds.

First chunk: fresh-agent eligibility, future-start/recheck and capped-selection
regressions.

## Could this be simpler?

A boolean destination toggle does not express the human's per-item question.
Adding a todo alone leaves it outside the normal sweep for 45 days. Editing
source bytes without a checkpoint loses exact replay for untracked incoming
cards. Reuse existing Noul, todo metadata, Git history and scheduled procedure;
no new daemon, generic actions framework, calibration UI, or task registry.

## Subplans

None. The two independent implementation workers share the contracts above.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Missing question creates unwanted work | Add request/apply tests | Omitted field skips evaluation/annotation | Visible receipt |
| Missing binary result silently acts as no | Add judge test | Reject malformed result | Explicit error |
| Unclear filing creates work in wrong destination | Add outcome/correction tests | Only resolved destination answer applies | Visible receipt |
| Retry duplicates or reopens a completed task | Add repeated apply tests | Stable id and completed annotation no-op | Explicit state |
| Annotation destroys replay input | Add untracked-card reprepare test | Original routing commit retained | Digest checked |
| Crash after card write but before final receipt | Add pending-after-hash test | Write-ahead before/after hashes | Retryable state |
| Fresh undated task waits 45 days | Add precheck test | Actionable agent set | Normal brief |
| Future or deferred task runs early | Add start/recheck tests | Existing plate state/recheck filters | Asserted |

## Agent-flow / user-flow edge cases

ADDRESSED: wrong field and hand-edit drift through schema validation and one
landmark example. ADDRESSED: stale instructions retain the existing snapshot
checks. ADDRESSED: concurrent todo edits use card lock before Git lock.
ADDRESSED: generated text comes from authored question, not fabricated model
prose. ADDRESSED: incomplete annotation rejects unrelated byte changes.
ADDRESSED: rollout is additive; old destinations and receipts need no migration.
The question asks whether to review, not authorization to pay/send/delete; normal
agent authority remains in force.

## NOT in scope

- Gmail admission before disk and preserving todos through connector refresh:
  connector cards bypass staged triage today; cover preservation when that
  integration lands, as retained in the Gmail preparation plan.
- New task executor, immediate wakeup, or changes to daily review scheduling.
- Quick capture, UI controls, or applying rules to existing box content in bulk.
- Repairing the separate multi-audit guidance cleanup bug.
- Deleting completed todos or retracting existing work when rules change.

## Open design questions

None for the first implementation chunks. A changed question has a changed task
identity; historical completed tasks stay completed. No-question destinations do
not evaluate or annotate. No real box edits or provider experiment is needed.

## Knowledge audits

Use bbx-context and the agent-guide ledger for the convention. Add one focused
knows-about audit with landmark schema/on-demand triage guidance; run on a clean
disposable standalone synthetic box, not the intentionally dirty worktree test1.
Audit explains optional per-item question, ordinary agent todo, and normal sweep.

## What will hold this after it ships

Existing doctests cover request construction, judged results, real Git receipt
apply/replay, todo-review precheck. Add boundary
cases there. One real knowledge audit verifies authoring guidance. No new tier.

## Implementation order

1. Cross-model plan review; adjudicate against the human's per-item question.
2. Schema/judgment and apply/replay contract; sweep in parallel.
3. Integrate both engines, docs and knowledge audit; selected tests and checks.
4. Cross-model finished diff review, fixes and scoped verification; commit.
5. Land only on a new human finish request.

## Rollout shape

Tests first for every substantive boundary above. Optional schema and receipt
fields remain readable without migration. Done means yes/no/absent questions,
idempotent completion, replay, and next-sweep selection all pass, plus
the focused knowledge audit and cross-model review. Work stays in the worktree.

## Implementation evidence

Implemented in this workstream and being landed through the finish procedure.
Actual change size is about 1,350 lines including tests, plan/review and
follow-up issues, within the original total budget.

- Change-selected run: 494 test files, 6,807 assertions passed.
- Focused annotation regression after the frontmatter-preservation review fix:
  24 assertions passed; unknown fields/comments, body and existing todo state
  survive the addition.
- Backend/frontend typecheck, changed-file lint, doc-check and diff whitespace
  checks passed.
- Focused knowledge audit passed on a disposable synthetic box after reading
  the generated installed triage guidance. No real box content was used.
- Claude plan and finished-change reviews were adjudicated in the sibling review.

[Raw-file annotation policy](../../../issues/decisions/2026-09-29-triage-todo-raw-file-policy.md)
remains separate: a positive annotation requires a card, and a missing answer
requires readable evidence plus a new judgment. Connector admission/preservation
is still tracked in the Gmail plan.
