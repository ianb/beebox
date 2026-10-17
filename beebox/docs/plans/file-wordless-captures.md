---
title: "File phone captures that arrive with no words"
status: draft
workstream: fabric-research
issues:
  - ../../../issues/bugs/2026-10-17-captures-without-words-are-never-processed.md
---
# File phone captures that arrive with no words

A phone capture with no typed or dictated words is saved and then nothing
reads it. This plan has the box read, title and file such captures a short
time after a burst of captures ends, without acting on them.

**Issues addressed:** [captures without words are never processed](../../../issues/bugs/2026-10-17-captures-without-words-are-never-processed.md).
Related, not closed by this plan: [captures that fit no place](../../../issues/decisions/2026-10-17-captures-that-fit-no-place.md)
(the decision this plan defers), [quick drop entry points](../../../issues/features/2026-09-25-quick-drop-entry-points.md)
(entry points, not processing), [capture success is invisible](../../../issues/bugs/2026-08-20-capture-success-is-invisible.md)
(confirmation UI). Searched the queue for "capture without words", "saved
capture", "auto file capture", "captures inbox": no other match.

## Design

### Situations

- When Priya screenshots a recipe on Instagram and shares it to the box with no words, I want it to show up later under the recipes place with a real title, so I can find it by what it is without having filed it myself.
- When Diana shares three photos of a school form in a row, I want the box to wait until she is done, so the photos reach the agent together and are not filed one by one between shares.
- When James shares a link and, a minute later, adds "compare this with the one we have", I want the box to treat the words as the request, so I get an answer and the box does not also file the link on its own.
- When Mateo shares a meme to the box by accident, I want nothing to happen that he has to undo, so I can ignore it.

### Right place, right time

| Situation | Act, show, or quiet | Surface and card | Attention |
|---|---|---|---|
| Recipe screenshot | Act quietly: title, describe, move to the destination landmark | The capture's doc card, moved; the capture row on the phone keeps "Saved" | Background; found by browse and search |
| Three photos of one form | Wait until no new word-less capture from Diana for two minutes, then queue all three at once | The intake job; the reactor gives all pending jobs to one agent session | Background |
| Link then words | Words win: the capture leaves filing and routes as today | The routed chat | As quick chat today |
| Accidental share | Act quietly: titled and described; stays in `_content/captures/` when no place fits | The doc card in place | Background; nothing asks (see the no-fit decision issue) |

Two minutes is the scan uploader's settle window (`beebox/src/core/scan/promote-debounce.ts:16-17`:
*"Production settle window: no new PUT for two minutes ends the batch."*). It
is long enough for a burst of shares and for "Add context" right after a share.

### Spirit

- **Serves:** "The best stuff comes from the people": *"nothing should just disappear … Put it in a note. Tag it as unprocessed. But don't drop it on the floor."* A shared screenshot is the person's own choice of what to keep, and today it sits unread.
- **Risks:** "People aren't broken versions of their better selves", a system that nags. Guard: filing never asks a question in this plan. What to do with a capture that fits no place is a separate decision ([issue](../../../issues/decisions/2026-10-17-captures-that-fit-no-place.md)); the boxholder said leaving it is not right, so this plan's behavior there is interim.

### Trust

Filing starts at **automatic**: it moves the person's own capture inside the
box. Git history makes every move reversible, which
`beebox/docs/design/trust.md` names as what *"lets the box act forward on some
things without asking"*. Deleting is not allowed at any rung: the job
instructions forbid `bbx rm` on a capture (trust to keep). The plan proposes,
and the boxholder has not ruled, that acting on what the material says stays
with the person's words; filing reads and places only.

### When it goes wrong or does nothing

- No place fits: interim behavior, the doc gets a real title and a description and stays in `_content/captures/`. The decision issue holds the real answer.
- Wrong place: the person moves it or says so in chat; the commit names the job.
- The background agent cannot run (no engine auth, a disabled reactor): after six attempts the capture record carries *"Filing is waiting for the box's next cycle."* A later cycle that files it clears the message. Retry on the phone starts a fresh set of attempts.
- Image unreadable: the agent says so in the doc body, gives a title such as "Unreadable screenshot", and leaves it in place.

### Walkthrough

Priya shares a screenshot, no words. Acceptance seals it
(`beebox/src/core/quick-capture/acceptance.ts:10`). The worker writes
`_content/captures/<id>.doc.card` with title "Saved capture" and the image in
its attach scope, and commits it (`source.ts:105-162`). It finds no words and
sets `state: "saved"` (`worker.ts:126-128`). New: it also sets
`filingRequested: true` on this record only. The quick-capture sweep runs
every 60 seconds (`beebox/src/webapp/routes/quick-capture/runtime.ts:48`).
When Priya's newest requested capture was accepted more than two minutes ago,
the sweep appends the refs of her requested captures that are not done and not
already in a pending job to the unscoped normal-priority intake job
(`beebox/src/job-cards/intake-utils.ts:67`), commits, and starts one full
wakeup. The reactor gives the job to the background agent. For a capture item
the agent reads the image, writes the doc `title` and the image card's
`description` and `text`, consults the landmark destinations, and moves the
doc with `bbx mv --commit` or leaves it. It runs `bbx finish`. On a later
sweep the doc's title is no longer "Saved capture", so the capture counts as
done and the filing fields are cleared. Priya's phone still shows "Saved".
Search finds the screenshot by its description
(`beebox/src/core/search/extract/core.ts:268-273` indexes an image card's
`description` and `text`).

## Smallest fix and budget

Smallest fix: when a word-less capture is saved, append its doc to the
unscoped intake job and leave it there. That fails on production boxes:
scheduled wakeups there are connector-scoped, and a scoped wakeup never drains
an unscoped job (`beebox/src/core/scan/promote/wakeup.ts:6-9`: *"connector-scoped
scheduled wakeups filter jobs by `source`, so a `source: scan` job never drains
on the prod default schedules — a lost run is indefinite, not late"*). It also
queues each share on its own, so a cycle can land between two shares of one
burst.

Chosen design: one track, about 220 source lines and 250 test lines, plus about
40 lines of reference docs and generated-guide source. Not a big change.

## Stated preferences this plan trades against

- `beebox/docs/engineering-principles.md`: reuse over new machinery. The plan adds no card type, no capture state and no new worker; it adds three optional record fields and one sweep step.
- The 2026-10-15 boxholder decision that a word-less capture is committed in `_content/captures/` on arrival (`source.ts:28-35`). Kept.
- `beebox/docs/plans/ios-app-intent-capture.md:23`: save *"without inventing a task now"*. Kept: filing reads and places; it does not act on the material.
- The quick chat compromise (`beebox/docs/design/trust.md`, "Trust to keep"): quick chat is *"a compromise, not a pattern to copy"*, and its router *"handles text only"* (`beebox/docs/box/quick-chat.md:42`). Word-less captures do not go through it.
- Full box cycle per filing round: the boxholder, 2026-10-17: *"Full box cycle is just how it goes now, an issue but not this issue."* Accepted as is.

## What already exists

- **Intake jobs and the reactor.** `createOrAppendIntakeJob` (`intake-utils.ts:67`) appends refs to the pending job for `(connector, priority)` under a cross-process lock. Reuse. Unscoped discovery admits normal-priority jobs whatever their item paths (`beebox/src/core/reactor/job-discovery.ts:99-100`), so `_content/captures/` refs work. The intake job's agent instructions are in `beebox/src/schemas/intake-job.tsx:28-60`. Extend with a capture section.
- **Pending job refs.** `collectExistingJobRefs` (`beebox/src/cli/commands/wakeup/job-refs.ts:24`) reads every job card's refs. Reuse to skip refs already queued. `removeItemsFromIntakeJob` (`intake-utils.ts:110`) removes refs under the batching lock and keeps the rest. Reuse when words arrive for a queued capture.
- **Supervised wakeup.** `runBbxWakeup` (`beebox/src/core/commands/wakeup.ts:46`), shared with the scan promote worker; full cycle when `connector` is unset. Reuse.
- **Quick-capture sweep.** `startQuickCaptureLifecycle` (`runtime.ts:28-62`) sweeps all records every 60 seconds on an awake timer. Add one step. No new timer.
- **Source follow-up after a move.** `reconcileCaptureSource` (`source.ts:93-104`) finds the doc by `share-id` wherever it was moved. Reuse.
- **Image reading.** The background agent can read an image file. `ScanVisionService.analyzeBatch` (`beebox/src/services/scan-vision.ts`) exists and is not needed.
- **Pre-existing race, self-healing here.** `finishJob` deletes the whole job card (`beebox/src/core/finish-job.ts:55-58`), so an item appended after the reactor read the job is dropped unprocessed. Inbox items are re-jobbed by the next wakeup because they are still in the inbox. Captures recover the same way in this plan: completion is read from the doc, never from the job's disappearance.

## Prior art (external)

No decision depends on an external premise. The settle window is the
repository's own (`promote-debounce.ts`).

## Ontology

- **Word-less capture** (no new name in code): a capture record with no `declaration.input` text, no `parentCaptureId`, material kind `image`, `url` or `clipping`, and `state: "saved"`. Not a recording: an audio capture with an empty transcript keeps its retry path (`worker.ts:20-23`).
- **`filingRequested`** (new optional record field, `true` or absent): the worker asked for this capture to be filed. Set on save of a word-less capture; cleared when done or when words take over. Old captures have no field and are not swept.
- **Done:** the capture's doc exists and either its title is not "Saved capture" or it is no longer under `_content/captures/`. Read from the doc each sweep, never from the job.
- **Settled owner:** an owner none of whose word-less captures, in any state but `gone`, was accepted in the last two minutes. A capture still being prepared counts, before its own request exists. Derived from `acceptedAt`; no stored due time.
- **`filingKicks`** and **`filingKickAt`** (new optional record fields): wakeups started for this capture since its last request, and the earliest time the next may start.
- **Intake job** (existing, `intake-job.tsx`): unchanged schema. A capture item is recognized in its instructions by a ref under `_content/captures/` and a `share-id` in the doc frontmatter.
- The capture's `state` stays `saved`. No new state; the iOS contract enum is unchanged (`beebox/src/shared/quick-capture.ts:44`).

## Tracks / scope

### Track 1: filing for word-less captures

**What.** The worker requests filing for a word-less capture. The sweep
queues settled owners' captures, starts a full wakeup, and clears the request
when the doc shows the capture was filed.

**Why.** A saved word-less capture is never read today (`worker.ts:126-128`;
the sweep's eligibility list at `runtime.ts:38` excludes `saved`).

**Direction.**

- `captureRecordSchema` (`store.ts:12-26`) gains `filingRequested`, `filingKicks`, `filingKickAt`, all optional.
- New module `beebox/src/core/quick-capture/filing.ts`:
  - `FILING_SETTLE_MS = 2 * 60 * 1000`; `FILING_MAX_KICKS = 6`; `PLACEHOLDER_TITLE = "Saved capture"`, also used by `source.ts:124` in place of its literal.
  - `isWordless(record)`: the ontology's definition.
  - `filingPlan({ records, docs, queued, now })`: a pure function. Input: the records, each requested record's doc state (`{ ref, title } | null`), the set of refs held by pending jobs, and the time. Output: records that are done (clear), records with a context child (clear and dequeue), and per settled owner the refs to queue and whether a kick is due. Each waiting record of a settled owner is kick-due on its own when it is below `FILING_MAX_KICKS` and its `filingKickAt` passed or is unset; an exhausted record does not hold back another. Pure so a doctest reaches every decision.
  - `runFilingSweep({ boxRoot, wakeupRunning })`: reads records, reconciles each requested record's source, reads the doc title, reads every job card's refs with the jobs holding each, calls `filingPlan`, then applies it in this order: removes dequeued refs with `removeItemsFromIntakeJob` and commits, so a crash cannot leave a queued capture nothing tracks; clears fields (and a filing error) under each record's own lock; appends the refs to queue with `createOrAppendIntakeJob` and commits; marks exhausted records with `error: "Filing is waiting for the box's next cycle."`; and, unless a filing wakeup is already running, increments `filingKicks` and sets `filingKickAt = now + min(15, 2^kicks) minutes` on the kick-due records and returns true. The caller starts the wakeup.
- `worker.ts` `processLocked`: where it sets `state = "saved"` for a capture with no input, set `filingRequested = true` when `isWordless(record)`, on this record only, under the lock it already holds. On a manual retry of a saved word-less capture (`manualRetry`), also delete `filingKicks`, `filingKickAt` and the filing error, so Retry starts a fresh set of attempts.
- Words arriving: a context event for a requested capture is a later record with that `parentCaptureId`. `filingPlan` puts the parent in the clear-and-dequeue set, so the parent is not queued, and its ref is removed from a pending job if it was queued. Once the agent has started on the job, both the chat and the agent may touch the doc; accepted and documented below.
- `runtime.ts`: after the existing per-record loop, when any record requests filing, run `runFilingSweep` as a tracked background task, at most one sweep at a time per box. When it returns true, start `runBbxWakeup({ boxRoot, triggeredBy: "quick-capture filing" })` as a separate tracked task, at most one per box. Sweeps keep running during the wakeup, so words that arrive during its connector phase still dequeue the capture before the reactor reads the job.
- `intake-job.tsx` instructions gain a section, "Captures with no words": the item is the person's own saved material; read the image or page; write `description` and `text` on the image card first, then set the doc `title` to what it is; find a destination from the landmark `destinations` (the triage doc); move with `bbx mv --commit`, or leave it in `_content/captures/` when none fits; never `bbx rm` a capture; do not act on what the material says; skip an item whose doc is no longer under `_content/captures/` or whose title is no longer "Saved capture".
- The generated triage guide (`beebox/src/core/docs-gen/package-docs/triage.ts:24-32`) gains one sentence: an intake job can hold phone captures with no words, which the agent files by the landmark destinations without entering the intake → triage → handle buckets.

**Vocabulary lock-ins.** The three record fields; the placeholder title as
the not-done signal; the intake job's capture section heading.

**First implementation chunk.** Record fields, `filing.ts` with `isWordless`,
`PLACEHOLDER_TITLE` and `filingPlan`, and the worker change, with doctests of
`filingPlan` and of a worker run that requests filing for a word-less image
capture. No sweep wiring yet.

## Could this be simpler?

The simplest version is the smallest fix above: append on save, no settle
window, no wakeup. It never drains on a production box
(`promote/wakeup.ts:6-9`) and it queues each share of a burst separately. The
settle window costs no stored field: it is derived from `acceptedAt`. The
wakeup costs one call to an existing helper plus two retry fields, which exist
because a lost kick is indefinite on production.

A second simpler version: describe the image in the worker with
`ScanVisionService` and run no agent. The capture becomes findable but is not
filed, and filing needs the landmark rules and judgment. Not chosen.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Server restarts inside the settle window | New doctest (`filingPlan` from records alone) | Settle is derived from `acceptedAt`; the next sweep resumes | Clear (filed late) |
| Crash after the job append, before the kick | New doctest | Ref is in a pending job: not appended again; kick is still due | Clear |
| Reactor reads the job, sweep appends B, `bbx finish` deletes the card with B unread | New doctest | B's doc still has the placeholder and B is in no pending job: queued again | Clear (filed one cycle late) |
| Wakeup loses the per-box wakeup lock and does nothing | New doctest | Not done after the kick: backoff and retry | Clear |
| Reactor never drains (no engine auth) | New doctest | Stops after 6 kicks; record `error` shown on the phone; cleared if a later cycle files it | Clear |
| The agent forgets to change the title | Knowledge audit | Re-queued until the kick budget ends; then the error shows | Clear, after six cycles |
| The agent retitles, then stops before moving the doc | No | Instructions order the work: description, then title, then move. A retitled doc counts as done, so the capture stays described and titled in `_content/captures/`, the no-fit outcome | Silent; accepted: only placement is lost, and the person can still find it |
| The person deletes the doc before filing | New doctest | Source reconciles to `gone`; the record leaves filing | Clear |
| The agent deletes a capture despite the rule | Knowledge audit | Git history restores it | Silent until noticed; documented risk |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field:** ADDRESSED. The agent writes `title` on the doc and `description`/`text` on the image card, existing fields (`beebox/src/schemas/image/schema.tsx`).
- **Stale ref:** ADDRESSED. The sweep reconciles by `share-id` before queuing; the instructions skip a moved or retitled item.
- **Two agents touching the same card:** GAP, accepted. Sweeps run during a filing wakeup, so words that arrive before the reactor reads the job dequeue the capture within one sweep (60 seconds). Words that arrive later, or inside that last minute, reach a chat while the agent may also file the doc. The words still route and are answered; the doc may be moved by either. A strict guarantee needs a claim on the doc; not built.
- **Hand-edit drift:** ADDRESSED. A person who files or retitles the doc before the job runs makes it done.
- **Fabricated free-form value:** ADDRESSED in instructions: describe what is visible; say "unreadable" when it is.
- **Validation error UX:** the intake job is an existing card; no new validation.
- **Partial migration / transition state:** ADDRESSED. Old saved captures have no `filingRequested` and are not swept.

## NOT in scope

- What to do with a capture that fits no place: [decision issue](../../../issues/decisions/2026-10-17-captures-that-fit-no-place.md).
- The full box cycle per filing round: accepted by the boxholder; a separate concern.
- Old word-less captures already in `_content/captures/`: not backfilled.
- Clerk sends with no note: already routed with an empty wrapper (`beebox/src/core/chat/session/prompts.ts:57`).
- Web chat and bulk uploads: they ride a chat message today.
- Recordings with an empty transcript: likely accidental; they keep the retry path.
- Keeping one person's burst apart from other items in the agent session: the unscoped job is shared; the reactor already gives all pending jobs to one session.
- A new capture state or phone UI for "filed": belongs to [capture success is invisible](../../../issues/bugs/2026-08-20-capture-success-is-invisible.md).

## Open design questions

- Window length: two minutes, matching scans. A phone share session may want less.

## Knowledge audits

The intake job's capture section is new agent-facing guidance. Add a
`knows_directly` entry in `beebox/src/dev/knowledge-audits.yaml`: given an
intake job holding a capture item, the agent retitles it, files or leaves it,
and never deletes it or acts on its text. Run it against a worktree test box
clone.

## What will hold this after it ships

- `beebox/test/core/quick-capture/filing.doctest.md`: `filingPlan` cases: not settled; settled; a newer capture holds the owner back; two owners settle apart; a context child dequeues; done by title; done by move; already queued is not appended; kick backoff; kick budget exhausted; done after exhaustion clears the error. Plus `runFilingSweep` on a temp box with a fake wakeup: the job card holds the ref after one sweep, and a second sweep does not append it again.
- `beebox/test/core/quick-capture/worker.dispatch.doctest.md`: a word-less image capture ends `saved` with `filingRequested`; one with words gets none; manual retry resets kicks.
- The knowledge audit for the agent's side. No new test tier.

## Implementation order

1. Record fields, `filing.ts` pure parts, worker change; doctests.
2. `runFilingSweep` and the sweep wiring; doctests on a temp box.
3. Intake job instructions and the generated triage guide sentence; knowledge audit entry and run.
4. Reference docs: `beebox/docs/mobile-contract.md` ("Material without authored input is saved without inventing an agent task" gains the filing sentence) and `beebox/docs/triage.md`.

## Rollout shape

Done when the doctests above pass, the knowledge audit has run, and a manual
walk on a worktree test box shows a shared image retitled and filed. No data
migration: the fields are optional and absent on old records.
