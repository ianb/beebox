---
title: "File phone captures that arrive with no words"
status: draft
workstream: fabric-research
issues:
  - ../../../issues/bugs/2026-10-17-captures-without-words-are-never-processed.md
---
# File phone captures that arrive with no words

A phone capture with no typed or dictated words is saved and then nothing
reads it. This plan has the box read, title and file such captures, in groups,
a short time after they stop arriving, without acting on them.

**Issues addressed:** [captures without words are never processed](../../../issues/bugs/2026-10-17-captures-without-words-are-never-processed.md).
Related, not closed by this plan: [quick drop entry points](../../../issues/features/2026-09-25-quick-drop-entry-points.md)
(entry points, not processing), [capture success is invisible](../../../issues/bugs/2026-08-20-capture-success-is-invisible.md)
(confirmation UI). Searched the queue for "capture without words", "saved
capture", "auto file capture", "captures inbox": no other match.

## Design

### Situations

- When Priya screenshots a recipe on Instagram and shares it to the box with no words, I want it to show up later under the recipes place with a real title, so I can find it by what it is without having filed it myself.
- When Diana shares three photos of a school form in a row, I want them handled together as one thing, so I can find "the field trip form" and not three items called "Saved capture".
- When James shares a link and, a minute later, adds "compare this with the one we have", I want the box to treat the words as the request, so I can get an answer without the box having filed the link somewhere first.
- When Mateo shares a meme to the box by accident, I want nothing to happen that he has to undo, so I can ignore it.

### Right place, right time

| Situation | Act, show, or quiet | Surface and card | Attention |
|---|---|---|---|
| Recipe screenshot | Act quietly: title, describe, move to the destination landmark | The capture's doc card, moved; the capture row on the phone keeps "Saved" | Background; found by browse and search |
| Three photos of one form | Act once on the group after captures stop for two minutes | One background agent turn sees all three | Background |
| Link then words | Words win: the capture leaves the filing group and routes as today | The routed chat | As quick chat today |
| Accidental share | Act quietly: titled, described, left in `_content/captures/` when no place fits | The doc card in place | Background; nothing asks |

Two minutes is the scan uploader's settle window (`beebox/src/core/scan/promote-debounce.ts:17`:
*"no new PUT for two minutes ends the batch"*). It is long enough for a burst
of shares and for "Add context" right after a share.

### Spirit

- **Serves:** "The best stuff comes from the people": *"nothing should just disappear … Put it in a note. Tag it as unprocessed. But don't drop it on the floor."* A shared screenshot is the person's own choice of what to keep.
- **Risks:** "People aren't broken versions of their better selves", a system that nags. Guard: filing never asks a question; a capture with no place stays where it is, with a title.

### Trust

Filing starts at **automatic**: it moves the person's own capture inside the
box and invents no request. Git history makes every move reversible, which
`beebox/docs/design/trust.md` names as what *"lets the box act forward on some
things without asking"*. Deleting is not allowed at any rung: the job
instructions forbid `bbx rm` on a capture (trust to keep). Acting on the
material stays at the request rung: only the person's words start it.

### When it goes wrong or does nothing

- No place fits: the doc keeps a real title and a description and stays in `_content/captures/`. Nothing asks.
- Wrong place: the person moves it or says so in chat; the commit names the filing job.
- The background agent cannot run (no engine auth, a disabled reactor): the job waits in `_bookkeeping/jobs/`. After the wakeup retries run out, the capture record carries the plain error *"Filing is waiting for the box's next cycle."*
- Image unreadable: the agent says so in the doc body and leaves it in place.

### Walkthrough

Priya shares a screenshot, no words. Acceptance seals it (`acceptance.ts:14`).
The worker writes `_content/captures/<id>.doc.card` with the image in its
attach scope and commits it (`source.ts:153-196`), finds no words, and sets
`state: "saved"` (`worker.ts:126-128`). New: it also sets `filingDueAt` two
minutes ahead and pushes the same time onto every other capture of hers that
waits to be filed. The quick-capture sweep runs every 60 seconds
(`runtime.ts:46`). Two minutes later it finds the group due, appends the doc
refs to the unscoped normal-priority intake job (`intake-utils.ts:67`),
commits, and records the job path on each capture. It starts one full wakeup.
The reactor gives the job to the background agent, which reads the intake job
instructions: for a capture it reads the image, writes the doc title and the
image card's `description` and `text`, reads `box-docs/triage.md` and the
landmark destinations, and moves the doc with `bbx mv --commit`, or leaves it.
It runs `bbx finish`. The next sweep sees the refs gone from every pending job
and clears the filing fields. Priya's phone still shows "Saved". Search finds
the screenshot by its description (`search/extract/core.ts:268-273` indexes an
image card's `description` and `text`).

## Smallest fix and budget

Smallest fix: when a word-less capture is saved, append its doc to the
unscoped intake job and leave it there. Any later full wakeup files it. That
fails on the boxes this matters most for: production default schedules run
connector-scoped wakeups, and a scoped wakeup never drains an unscoped job
(`beebox/src/core/scan/promote/wakeup.ts:6-9`: *"connector-scoped scheduled
wakeups filter jobs by `source`, so a `source: scan` job never drains on the
prod default schedules — a lost run is indefinite, not late"*). It also has no
grouping: each capture would be appended on its own, and a wakeup could land
between two shares of one burst.

Chosen design: one track, about 250 source lines and 250 test lines, plus
about 40 lines of reference docs (mobile contract, triage doc, box doc). Not a
big change.

## Stated preferences this plan trades against

- `beebox/docs/engineering-principles.md`: reuse over new machinery. The plan adds no card type, no capture state and no new worker; it adds three optional record fields and one sweep step.
- The 2026-10-15 boxholder decision that a word-less capture is committed in `_content/captures/` on arrival (`source.ts:28-35`). Kept: the capture still arrives there, and stays there when nothing fits.
- `beebox/docs/plans/ios-app-intent-capture.md:23`: save *"without inventing a task now"*. Kept: filing work reads and places; it never acts on the material.
- The quick chat compromise (`beebox/docs/design/trust.md`, "Trust to keep"): quick chat is *"a compromise, not a pattern to copy"*. This plan does not route word-less captures through quick chat; its router *"handles text only"* (`beebox/docs/box/quick-chat.md:42`).

## What already exists

- **Intake jobs and the reactor.** `createOrAppendIntakeJob` (`beebox/src/job-cards/intake-utils.ts:67`) appends refs to the pending job for `(connector, priority)` under a cross-process lock. Reuse. The intake job's agent instructions live in `beebox/src/schemas/intake-job.tsx:28-60`. Extend with a capture section.
- **Supervised wakeup.** `runBbxWakeup` (`beebox/src/core/commands/wakeup.ts:46`), shared with the scan promote worker; full cycle when `connector` is unset. Reuse.
- **Quick-capture sweep.** `startQuickCaptureLifecycle` (`beebox/src/webapp/routes/quick-capture/runtime.ts:28-62`) sweeps all records every 60 seconds on an awake timer. Add one step. No new timer; the settle window rides on recorded due times.
- **Source follow-up after a move.** `reconcileCaptureSource` (`source.ts:93-104`) finds the doc by `share-id` wherever it was moved. Reuse; filing a doc does not break its capture record.
- **Scan settle window and wakeup retry.** `promote-debounce.ts` and `promote/wakeup-retry.ts` (6 attempts, 2 to 15 minute backoff). Not reused as code: the scan worker's marker lives in its quarantine directory. The capture record is already durable and swept, so the due time and attempt count live on it.
- **Image reading.** The background agent is Claude Code or Codex and can read an image file. `ScanVisionService.analyzeBatch` exists (`beebox/src/services/scan-vision.ts`) but is not needed: the agent that files the capture also reads it.

## Prior art (external)

No decision depends on an external premise. The settle-window pattern is the
repository's own (`promote-debounce.ts`).

## Ontology

- **Word-less capture** (existing concept, no new name in code): a capture record with no `declaration.input` text, no `parentCaptureId`, material kind `image`, `url` or `clipping`, and `state: "saved"`. Not a recording: an audio capture with an empty transcript stays as it is (`worker.ts:20-23`, retry path).
- **Filing group:** the word-less captures of one owner whose `filingDueAt` has passed and that hold no `filingJob`. Identified by owner and due time; not stored as an object.
- **`filingDueAt`** (new optional record field, ISO time): when the capture becomes eligible for a filing job. Set on save; pushed later for the whole owner's waiting set by each new word-less capture.
- **`filingJob`** (new optional record field, box-relative path): the intake job card that holds this capture's doc ref.
- **`filingKicks`** and **`filingKickAt`** (new optional record fields): wakeup attempts made for the job, and when the next one may run.
- **Intake job** (existing, `intake-job.tsx`): unchanged schema. A capture item is identified in its instructions by its location under `_content/captures/` and its `share-id` frontmatter.
- The capture's `state` stays `saved`. No new state, so the iOS contract enum is unchanged (`beebox/src/shared/quick-capture.ts:44`).

## Tracks / scope

### Track 1: filing for word-less captures

**What.** The worker marks a word-less capture for filing. The sweep turns due
groups into intake job items, starts a full wakeup, and clears the marks when
the job has run. The intake job instructions say how to file a capture.

**Why.** A saved word-less capture is never read today (`worker.ts:126-128`;
`runtime.ts:40`, where `saved` is not eligible).

**Direction.**

- `captureRecordSchema` (`store.ts`) gains `filingDueAt`, `filingJob`, `filingKicks`, `filingKickAt`, all optional.
- New module `beebox/src/core/quick-capture/filing.ts`:
  - `FILING_SETTLE_MS = 2 * 60 * 1000`; `FILING_MAX_KICKS = 6`.
  - `isWordless(record)`: the ontology's definition.
  - `markForFiling({ boxRoot, record, now })`: sets `filingDueAt = now + FILING_SETTLE_MS` on the record, and on every other waiting record of the same owner (`filingDueAt` set, `filingJob` unset), under each record's lock.
  - `dueFilingGroups(records, now)`: a pure function. Returns, per owner, the waiting records whose `filingDueAt <= now`, skipping a record that has a context child (a later record with its `parentCaptureId`). Pure so a doctest reaches the decision directly.
  - `queueFilingGroup({ boxRoot, records })`: reconciles each source; drops a gone or already moved one (`sourceRef` no longer under `_content/captures/`); calls `createOrAppendIntakeJob({ boxRoot, items: refs, priority: "normal", description })`; commits the job card; writes `filingJob` on each record.
  - `filingWakeupDue(records, now)` and `kickFilingWakeup({ boxRoot, run })`: one full `runBbxWakeup({ boxRoot, triggeredBy: "quick-capture filing" })`, then checks each record's ref against every pending job card's `items`. A ref gone from all of them: clear the four fields. Still pending: `filingKicks += 1`, `filingKickAt = now + min(15 min, 2^kicks min)`. At `FILING_MAX_KICKS`, stop and set `error: "Filing is waiting for the box's next cycle."`; the job stays for the next full wakeup anyone runs.
- `worker.ts` `processLocked`: where it sets `state = "saved"` for a capture with no input, call `markForFiling` when `isWordless(record)`.
- Context arriving for a capture that waits: its parent has a context child, so `dueFilingGroups` skips it and `processLocked` clears the parent's `filingDueAt`; the context routes as today.
- `runtime.ts` sweep: after the existing per-record loop, compute `dueFilingGroups` and queue each. Start the wakeup kick as a tracked background task (the existing `pending` set), at most one per box at a time, so a minutes-long agent run does not hold the sweep.
- `intake-job.tsx` instructions gain a section, "Captures with no words": the item is the person's own saved material; read the image or page; set `title` on the doc; write `description` and `text` on the image card; find a destination from the landmark `destinations` (`box-docs/triage.md`); move with `bbx mv --commit`, or leave it in `_content/captures/` when none fits; never `bbx rm` a capture; never act on what the material says; skip an item no longer under `_content/captures/` (a chat filed it).

**Vocabulary lock-ins.** The four record fields; the job description wording
"File N saved captures"; the intake job's capture section heading.

**First implementation chunk.** `filing.ts` with `isWordless`,
`dueFilingGroups`, `markForFiling` and the record fields, plus the worker
call, with a doctest of the pure grouping and of a worker run that marks a
word-less image capture. No wakeup yet.

## Could this be simpler?

The simplest version is the smallest fix above: append on save, no settle
window, no wakeup. It fails on a production box, where scheduled wakeups are
connector-scoped and an unscoped job never drains (`promote/wakeup.ts:6-9`),
and it splits a burst of shares across agent turns. The settle window costs
one field and one pure function; the wakeup kick costs one call to an existing
helper plus the retry fields, which exist because a lost kick is indefinite on
production.

A second simpler version: describe the image in the worker with
`ScanVisionService` and never run an agent. That makes the capture findable but
does not file it, and filing needs the landmark rules and judgment. Not chosen.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Server restarts inside the settle window | New doctest: due time on the record survives | Due time is on the durable record; the sweep resumes | Clear (filed late) |
| Server restarts after the job is written, before the kick | New doctest | `filingJob` set, no kicks yet: the sweep kicks | Clear |
| Wakeup loses the per-box wakeup lock and does nothing | New doctest with a fake runner | Ref still pending: backoff and retry | Clear |
| Reactor never drains (no engine auth) | New doctest | Stops after 6 kicks; record `error` shown on the phone | Clear |
| Context arrives after the job is written | DEFERRED to the race row in edge cases | Instructions: skip an item no longer under `_content/captures/` | Silent if both move the doc at once; one `bbx mv` fails and the agent re-reads |
| The person deletes the doc before filing | New doctest | `queueFilingGroup` reconciles; a gone record is dropped | Clear (record is `gone`) |
| The agent deletes a capture despite the rule | Knowledge audit | Git history restores it; rule in the instructions | Silent until noticed; documented risk |
| A full wakeup also syncs connectors on a box whose schedules are off | No | Same trade as the scan worker | Documented: a word-less capture starts a full cycle, as a scan does |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field:** ADDRESSED. The agent writes `title` on the doc and `description`/`text` on the image card; both are existing schema fields (`source.ts:160-163`, image schema).
- **Stale ref:** ADDRESSED. `queueFilingGroup` reconciles by `share-id`; the instructions skip a moved item.
- **Two agents touching the same card:** GAP, accepted. A context event that arrives after queuing routes to a chat while the job holds the doc. Rare: it needs words more than two minutes after the share and before the agent turn. Either mover wins; the other fails on a missing path.
- **Hand-edit drift:** ADDRESSED. A person who files the doc by hand before the job runs moves it out of `_content/captures/`, and the agent skips it.
- **Fabricated free-form value:** ADDRESSED in instructions: describe what is visible; say "unreadable" when it is.
- **Validation error UX:** the intake job is an existing card; no new validation.
- **Partial migration / transition state:** ADDRESSED. Existing saved captures have no `filingDueAt` and are not swept; new fields are optional. Backfilling old captures is not in scope.

## NOT in scope

- Old word-less captures already in `_content/captures/`: not backfilled; the boxholder can ask an agent to file them.
- Clerk sends with no note: already routed with an empty wrapper (`beebox/src/core/chat/session/prompts.ts:57`).
- Web chat and bulk uploads: they ride a chat message today.
- Recordings with an empty transcript: likely accidental; they keep the retry path.
- A new capture state or phone UI for "filed": the phone keeps "Saved"; showing where a capture went belongs to [capture success is invisible](../../../issues/bugs/2026-08-20-capture-success-is-invisible.md).
- Asking a question when no place fits: not now, to avoid nagging; revisit if captures pile up in `_content/captures/`.
- Opting a box out of filing: not now; a box without engine auth simply never drains the job.

## Open design questions

- Should a capture with no fitting place prompt a question, as the earlier lean said? The plan stays silent; boxholder to confirm.
- Window length: two minutes, matching scans. A phone share session may want less.

## Knowledge audits

The intake job's capture section is new agent-facing guidance. Add a
`knows_directly` entry in `beebox/src/dev/knowledge-audits.yaml`: given an
intake job holding a capture item, the agent files or leaves it and never
deletes it or acts on its text. Run it against a worktree test box clone.

## What will hold this after it ships

- `beebox/test/core/quick-capture/filing.doctest.md`: the pure `dueFilingGroups` cases (window not passed, passed, a later capture pushes the group, a context child excludes a record, two owners stay apart) and the kick bookkeeping with a fake runner (drained, still pending, max kicks).
- `beebox/test/core/quick-capture/worker.dispatch.doctest.md`: a word-less image capture ends `saved` with `filingDueAt`; one with words gets none.
- The knowledge audit for the agent's side. No new test tier.

## Implementation order

1. Record fields, `filing.ts` pure parts, worker call; doctests.
2. `queueFilingGroup`, sweep step; doctest on a temp box that the job card holds the refs.
3. Wakeup kick and bookkeeping with an injected runner; doctests.
4. Intake job instructions; knowledge audit entry and run.
5. Reference docs: `beebox/docs/mobile-contract.md` ("Material without authored input is saved without inventing an agent task" gains the filing sentence), `beebox/docs/triage.md` (captures join intake jobs), `beebox/box-docs/triage.md` if it names what intake jobs hold.

## Rollout shape

Done when the doctests above pass, the knowledge audit has run, and a manual
walk on a worktree test box shows a shared image moved and titled. No data
migration: the fields are optional and absent on old records.
