---
title: "Bounded reactor batches and capped intake jobs"
status: implemented
workstream: box-isolation-followups
issues: []
---
# Bounded reactor batches and capped intake jobs

A reactor batch puts every pending job, with every referenced card pasted in,
into one agent prompt. On a production box an intake job grew to 300 items,
the prompt passed the model's limit, and every run failed. This plan caps how
many items one intake job holds, gives the batch prompt a size budget, and
splits the oversized jobs already on disk.

All paths are relative to the monorepo root.

**Issues addressed:** none filed. Searches of `issues/` (open and closed) and
`private-issues/` for "prompt is too long", "too long", "batch prompt",
"intake job", "append intake", "INTAKE_BATCH", "context window",
"reactor-batch": nothing about this failure. Related, not resolved here:
`issues/bugs/2026-10-27-wakeup-child-notices-bypass-the-box-server.md`
(filed when the job-check plan landed; a different gap).

## Design

No design section: an engine bug fix. Nothing a person sees changes, except
that queued work drains again.

## Smallest fix and budget

**The production finding (2026-10-27, after the job check deployed).** The job
check started a run on a production box. The reactor-batch session ended with
the model API error "Prompt is too long" (the agent transcript's last
assistant message); `bbx wakeup exited with code 1`; 0 jobs processed. An
earlier reactor-batch session on that box the same day likely failed the same
way. Measured on that box:

| Job | Items | Card | Inlined refs |
|---|---|---|---|
| `<ts>-scan.intake.job.card` (description says "Triage 3 inbox items") | 300 | 22.5 KB | about 3.1 MB; largest ref 48 KB |
| `<ts>-inbox-low.intake.job.card` | 240 | | about 74 KB |
| `contains-backfill` | 25 | | about 31 KB |
| two `question-followup` jobs | 1 each | small | small |

The loop is self-reinforcing: the session fails, the intake job stays, new
items keep being appended to it, and the next prompt is bigger.

**Boxholder decision (verbatim, the box name replaced):** *"Two engine
changes. An intake job takes at most about 25 items, and later items start a
new job. The batch prompt has a size budget: jobs that don't fit wait for the
next cycle, and a reference past the budget is listed by path for the agent
to open instead of being pasted in. Then split [a production box]'s 300-item
job into jobs of 25. They drain over several runs, each still under the
24-a-day cap. Estimated a few hundred lines, through the plan-and-review
flow."*

**Smallest fix.** Stop inlining refs: list every ref by path. About 10 lines in
`buildJobDescription`. It fixes this box's prompt, but a 300-item job is still
one job the agent cannot finish in 30 turns, so it never drains, and the
appenders keep growing it. It also makes every small job slower (the agent
must open each ref).

**Chosen design: three tracks.**

| Track | Source lines (add + delete) | Test lines |
|---|---|---|
| A. Item cap at the one intake-job writer, and scan import commits its jobs | ~85 | ~100 |
| B. Split oversized intake jobs during a wakeup, resumable | ~70 | ~75 |
| C. Hard prompt budget, per-job inline cap, prompt wording, and cycle rotation | ~135 | ~135 |

Total about 290 source and 310 test lines (the cross-model review added the
scan commit, stable split names, the hard limit on the assembled prompt, and
the system-prompt change: about 50 source and 60 test lines). Authored docs about 40 lines
(`beebox/src/core/reactor/DESIGN.md`, the intake-job instructions,
`beebox/docs/design/processing.md`). No generated output. Not a BIG CHANGE.

## Stated preferences this plan trades against

- **Boxholder decision** above: an item cap of about 25, a prompt budget with
  path listing past it, and a split of the existing job.
- **Code style: "Nothing retries forever"** (`beebox/code-style.md`,
  Defensiveness item 9). A job that does not fit must still run: the oldest
  job is always selected, so no job waits forever for room.
- **Principle 4, resilient and never silent**
  (`beebox/docs/engineering-principles.md:49`). Every ref left out of the
  prompt is listed by path in the prompt; every split and every deferred job
  is logged.
- **Principle 8, one way** (`beebox/docs/engineering-principles.md:95`). The
  cap lives in the one function every appender calls
  (`createOrAppendIntakeJob`), not in each caller.
- **Principle 10, testability**. Selection and the cap are pure functions.
- **Shipped precedent.** The job check (`beebox/docs/implemented-plans/on-demand-job-triggers.md`),
  whose backoff and daily cap bound how fast the backlog drains; the
  low-priority overdue cap of 5 per cycle (`beebox/src/core/reactor/engine/cycle.ts:120-127`,
  *"draining the whole backlog into a single agent prompt is its own
  incident"*), the same concern for one class of job.

## What already exists

**Why the intake job grew.**

- Every intake writer calls `createOrAppendIntakeJob`
  (`beebox/src/job-cards/intake-utils.ts:67-74`). Its callers:
  `beebox/src/cli/commands/wakeup/steps.ts:342` (step 4b, unjobbed inbox
  items), `beebox/src/core/commands/scan-import/session-discard.ts:92` (scan
  import), `beebox/src/core/quick-capture/filing-sweep.ts:86` (wordless
  captures). No other writer (searched every `createOrAppendIntakeJob` and
  `createIntakeJobTemplate` caller).
- It appends to the first pending intake job with the same
  `(connector, priority)` key, with no size limit
  (`intake-utils.ts:150-158`: *"if (existing) { await
  appendToIntakeJob(...)"*). The match is on frontmatter only
  (`:182-193`), so a legacy `<ts>-scan.intake.job.card` with no `connector`
  and normal priority is the unscoped normal job that every scan, filing, and
  step-4b append joins.
- Step 4b tries to batch: `steps.ts:330-333` *"Create batched intake job
  files (each batch its own file so the agent can finish each within its turn
  limit)"*, `INTAKE_BATCH_SIZE = 10` (`:339`). But each batch goes through
  `createOrAppendIntakeJob`, which appends it to the same existing job. The
  batching has no effect once one job of that key exists.
- **The description mismatch.** An append overwrites the description with
  the caller's (`intake-utils.ts:223` *"fields.description =
  opts.description;"*), which describes only the items of that call. So a
  300-item job says "Triage 3 inbox items". `removeItemsFromIntakeJob`
  already rewrites it from the count (`:131-132`).
- New intake filenames are `<YYYY-MM-DDTHH-MM-SS>-<stem>.intake.job.card`
  (`intake-utils.ts:161-164`, `beebox/src/job-cards/core.ts:23-29`). The stem
  comment says *"Distinct per batching key, so two jobs created in the same
  second never share a name"* (`intake-utils.ts:50-53`); with several jobs per
  key that no longer holds. `answer.ts:183-192` adds an 8-character random
  suffix for the same reason.

**Why the prompt is unbounded.**

- Discovery returns every pending job; with any normal-priority job present,
  every low-priority job is selected too (`cycle.ts:145-147`). Only the
  low-priority-only path caps at 5 (`:127`, `:159`).
- `processBatchJobs` (`beebox/src/core/reactor/engine/batch-jobs.ts:29-85`)
  builds one description per job and sends them all in one prompt
  (`buildReactorUserPrompt`, `beebox/src/core/reactor/prompts.ts:37-47`).
- `buildJobDescription` (`batch-jobs.ts:103-149`) inlines the full content of
  every inline-safe ref (`:122-141`); intake `items` are `cardRef()`
  (`beebox/src/schemas/intake-job.tsx`, `items: z.array(cardRef())`), so each
  item's card is pasted in.
- One session per cycle: 30 turns, `maxBudgetUsd: 10` (`batch-jobs.ts:59-72`).
- The engine knows no model's context size: searched `src/` for
  "contextWindow", "context window", prompt byte limits, and token counting;
  nothing. The batch model is the box's effective model
  (`loadEffectiveBoxModel`, `batch-jobs.ts:55`), which may be Claude, Codex, or
  an OpenRouter model (`beebox/src/frontend/src/components/admin/AgentEngineSection.tsx:14`).

**The reactor loop and the job check.**

- `runReactor` loops up to `maxCycles` and stops when no job remains or a
  cycle processed none (`beebox/src/core/reactor/engine/core.ts:131-156`).
  The processed count is a set difference over the cycle's own job cards
  (`cycle.ts:178-209`), so unselected jobs simply stay "remaining".
- Job order: normal before low, oldest first by filename stamp
  (`beebox/src/core/reactor/job-discovery.ts:103-109`).
- The job check starts a full wakeup with `TRIGGER_MAX_CYCLES = 3`
  (`beebox/src/core/schedule/job-check/start.ts:21`). It charges every due
  job when a run starts (`beebox/src/core/schedule/job-check/core.ts:145`,
  `stampStarted`); a charged job left after the run is due again at +1 h,
  then +6 h, then daily (`rules.ts:41-45`), for 7 days from first sight
  (`rules.ts:13`, `:47-49`); at most 24 runs a day (`rules.ts:10`). A changed
  card is due at once with attempts reset (`rules.ts:71`).
- Stale-job cleanup deletes a job only when all its refs are gone
  (`steps.ts:92-185`).

## Prior art (external)

**Assumption, stated plainly: the reactor needs a long-context model.** The
budget assumes the box's model has a context window of at least about 128,000
tokens. A short-context model (for example an 8,000-token model an admin adds
by OpenRouter ID, `beebox/src/shared/chat-models.ts:17-20`) cannot run the
reactor agent at all: its system prompt, the agent guide, and the tool
definitions alone exceed such a window. So there is no per-model budget.

At three to four bytes per token for English and YAML, 160 KB is about 40,000
to 55,000 tokens, which leaves more than half of a 128,000-token window for
the system prompt, the guide, and 30 turns of tool output. Claude models take
200,000 tokens (Anthropic model overview,
<https://docs.claude.com/en/docs/about-claude/models/overview>; not re-fetched
for this plan). The error seen was from a 3.1 MB prompt, about 800,000 tokens.
Evaluated-only; no exact tokenizer is needed for this margin. No other
decision depends on an external premise.

## Ontology

- **Intake job** (existing, `intake-job` schema). A job card holding `items`
  (refs) to triage, keyed by `(connector, priority)`.
- **Item cap** (new constant, `INTAKE_JOB_MAX_ITEMS` = 25). The most items one
  intake job may hold. Replaces step 4b's local `INTAKE_BATCH_SIZE` (one
  constant, one place).
- **Follow-on intake job** (new behavior, no new type). A further intake job
  with the same key, created when the existing ones are full. Filename
  `<stamp>-<stem>-<8 hex>.intake.job.card`.
- **Split chunk** (new term). One of the jobs a split makes from an oversized
  job. Filename `<original base>-part-NN.intake.job.card`, where the original
  base is the original filename without `.intake.job.card` and `NN` is the
  1-based chunk index, zero-padded to two digits. Stable: the same original
  always yields the same names.
- **Oversized intake job** (new term). An intake job holding more than the
  item cap. Only legacy cards and hand edits can be one after Track A.
- **Batch prompt budget** (new constant, `BATCH_PROMPT_BUDGET_BYTES` =
  160 KB). A hard limit on the UTF-8 bytes of the assembled reactor-batch
  user prompt, the output of `buildReactorUserPrompt` with its ambient line
  and framing included. Bytes, not tokens.
- **Per-job inline budget** (new constant, `JOB_INLINE_BUDGET_BYTES` = 40 KB).
  The most bytes of pasted ref content one job description may carry; refs
  past it are listed by path.
- **Listed ref** (new term). A ref named in the prompt under "Not pasted in
  (open these with your tools)", not inlined.
- **Job given by path** (new term). A selected job whose own card does not fit
  the budget left: the prompt names its card path and size and tells the agent
  to open it, with its type's instructions; nothing of the card is pasted.
- **Attempted set** (new, in memory, one `runReactor` call). Jobs already put
  into a batch in this run. A later cycle of the same run does not select
  them again.

## Tracks / scope

### Track A — Item cap at the one intake-job writer

**What.** `createOrAppendIntakeJob` never lets a job pass 25 items. Items
past the cap go to a new job with the same key.

**Why.** The appenders grow one job without limit, which is what produced the
300-item job and keeps feeding it.

**Direction.**

- `beebox/src/job-cards/intake-utils.ts`, inside the existing per-key lock
  (`withIntakeKeyLock`, `:82-100`):
  1. Find pending jobs with the same key that hold fewer than
     `INTAKE_JOB_MAX_ITEMS` items. Choose the **newest** (latest filename
     stamp), so an older job's content, and therefore its job-check hash and
     backoff, stays still.
  2. Append up to the room left.
  3. Put the rest into new jobs of at most 25 items each.
  4. Return every job path written (`Promise<string[]>`; today a single
     `string`). Every caller commits every returned path.
- **Description.** A new job holding only this call's items keeps the
  caller's description (it is accurate). A job that received appended items
  gets the count-derived text `removeItemsFromIntakeJob` already writes
  (`intake-utils.ts:131-132`: "Triage N inbox items" or "Triage N capture
  items"). This fixes the mismatch.
- **Names.** `timestampedJobFilename` gets an optional suffix; intake jobs use
  an 8-character random hex suffix, as `answer.ts:191-192` does. The stamp
  stays first, so `job-discovery.ts:27` still parses the age.
- Step 4b: drop its local `INTAKE_BATCH_SIZE` loop (`steps.ts:334-350`) and
  pass all items at once; the writer chunks them. Its commit already stages
  the returned paths (`steps.ts:257-266`).
- **Scan import commits its jobs** (review finding 3). Both scan paths commit
  the imported files first and then queue the intake job, which today nothing
  commits: `beebox/src/core/commands/scan-import/command.ts:327-336` (photo)
  and `beebox/src/core/commands/scan-import/pdf.ts:161-171` (PDF). The job
  check counts only committed jobs (`beebox/src/core/schedule/job-check/core.ts:84-93`),
  so a scan's job would never start a run. `queueCommittedSessionIntake`
  (`session-discard.ts:87-97`) commits every returned path in one commit
  (`Queue scan intake: <k> job(s)`, trailer `Created-By: scan-import`) and
  returns `string[] | null`. Both callers print `Intake jobs:` with the list
  (or the existing "not created" line) and return `intakeJobPaths` in their
  `data` in place of `intakeJobPath`. **A failure to commit** (round-2 review
  finding 1) is caught and logged, and the job paths it wrote are put back as
  `HEAD` has them: a new card is removed, an appended card loses the append
  (`git checkout HEAD --` under the box git lock). Step 4b alone would not
  recover: it counts every job's refs as held (`job-refs.ts:38`), and the job
  check skips a dirty job, so the items would wait for nothing. Put back, they
  are unjobbed inbox cards, and the next wakeup's step 4b jobs and commits
  them. (Retrying the commit was the alternative; a commit refused by the
  box's hook fails again.) The restore compares `git ls-tree` names with
  box-relative paths; `ls-tree` without `--full-name` names paths relative to
  the working directory (the box root), so in a package box, whose repository
  is one level up, they are box-relative already (verified with a test; diff
  review finding 2 assumed repository-relative names).
- **A write that fails partway** (diff review finding 3). When
  `createOrAppendIntakeJob` throws after writing some files (the append
  landed, a new job's write failed), it puts back the appended job's previous
  text and removes the new files before rethrowing, so no item is held by a
  job no caller commits. It undoes its own writes rather than restoring from
  `HEAD`: the appended job may hold another writer's uncommitted items.
- Wordless filing already commits the returned job (`filing-sweep.ts:86-88`);
  it stages the returned list.

**Vocabulary lock-ins.** `INTAKE_JOB_MAX_ITEMS`, the filename shape
`<stamp>-<stem>-<8 hex>.intake.job.card`, `createOrAppendIntakeJob` returning
`string[]`.

**First chunk.** The cap, newest-with-room choice, chunking, description rule,
and suffix, with tests; callers updated for `string[]`; scan import committing
its jobs, with its own test. No open question.

### Track B — Split oversized intake jobs during a wakeup

**What.** Every wakeup (full or scoped) splits any intake job over the cap
into jobs of at most 25, before it creates new intake jobs.

**Why.** Track A stops new growth but leaves the 300-item and 240-item jobs.
The boxholder asked for a split. Doing it in the wakeup makes it happen on the
next run on every box, as the box's user, inside the sandbox, committed, with
no operator step.

**Why generic, not one named job** (review finding 6, coordinator decision).
The split touches only intake-job cards with more than 25 items. With the cap
in place, only intake jobs written before the cap can be over it, so on a box
with none the step does nothing. Oversized pre-cap jobs exist on more than one
production box (a 300-item job on one, a 240-item job on another), so a
one-job operator step would have to be repeated per box and per job. It never
splits a job of another type, and it does not touch a hand-edited non-intake
job of any size.

**Direction.**

- New `splitOversizedIntakeJobs(boxRoot)` in `beebox/src/job-cards/intake-utils.ts`,
  called from `runWakeupCycle` right after step 4a (`cleanupStaleJobs`,
  `beebox/src/cli/commands/wakeup/command.ts:167-175`) and before step 4b. It
  runs before the reactor step in the same wakeup, so the reactor sees only
  capped jobs.
- For each intake job with more than 25 items, under its key lock: for each
  chunk index `k`, the chunk holds items `[25(k-1), 25k)` of the original's
  list, with the same `connector` and `priority` and a count-derived
  description, at the stable name `<original base>-part-NN.intake.job.card`.
  A chunk file that already exists is left as it is (it is from an
  interrupted split, and may since have received appended items). Each chunk
  is published with `writeFileAtomic` (`beebox/src/lib/atomic-write.ts`), so
  a partial chunk exists only as a temp sibling, never under its final name
  (round-2 review finding 2): an existing chunk is a complete one. Then the
  original is deleted. The names start with the original's stamp, so the
  chunks keep the original job's place in the oldest-first order
  (`job-discovery.ts:103-109`).
- **Resumable** (review finding 5). A split stopped after writing some chunks
  leaves the original in place. The next wakeup's split derives the same
  names, skips the chunks already present, writes the rest, and deletes the
  original. It never makes a second set of chunks.
- One commit per split job: `Split intake job <name> into <k> jobs of at most
  25 items`, trailers `Triggered-By: bbx wakeup`, `Phase: intake-split`, the
  same form step 4b's commit uses (`steps.ts:257-266`). Logged in the wakeup
  output.
- **A refused split commit** (diff review, coordinator decision). When the
  commit fails (a hook refuses it, a git error), the split is put back as
  scan import does: the original comes back from `HEAD` and the chunks are
  removed (`beebox/src/job-cards/restore-to-head.ts`), so the next wakeup
  finds the oversized original and splits it again. Uncommitted chunks would
  otherwise hold the items while the job check skips them. That wakeup then
  skips its reactor step, which would be sent the restored job whole, and
  exits 1 (round-2 verification). **Accepted, not
  recovered:** a process killed between deleting the original and the commit
  leaves uncommitted chunks; the window is one unlink and one commit inside a
  wakeup.
- Job check effect: the chunks are new paths, so each is first seen now (a
  fresh 7-day lifetime) and due at once. The original's entry is pruned
  (`rules.ts` drops entries for files no longer present).

**Vocabulary lock-ins.** `splitOversizedIntakeJobs`, commit phase
`intake-split`.

**First chunk.** The split function and the wakeup call, with tests. No open
question.

### Track C — Batch prompt budget, per-job inline cap, and cycle rotation

**What.** A cycle sends only the jobs that fit a byte budget, pastes refs
only up to a per-job budget and lists the rest by path, always sends the
oldest job, and does not resend a job within the same run.

**Why.** The batch prompt has no bound (`batch-jobs.ts:29-46`). Even with
capped jobs, 25 scan sessions at about 10 KB each, plus every other pending
job, can be several hundred KB.

**Direction.**

- **Units: bytes.** The engine runs Claude, Codex, and OpenRouter models and
  has no tokenizer or context-size table (searched, What already exists). A
  fixed byte budget with a wide margin (Prior art) is engine-independent and
  testable.
- **Per-job description** (`buildJobDescription`, `batch-jobs.ts:103-149`):
  the job card text and the type's instructions are included. Refs are pasted
  in order while their total stays within `JOB_INLINE_BUDGET_BYTES` (40 KB). A
  ref that would cross it, and every ref after it, goes into a final section:
  ```
  #### Not pasted in (open these with your tools)
  - _content/inbox/…/A.capture-session.card (48 KB)
  ```
- **Job given by path.** The same function can also produce the smallest form
  of a job: its header, a line `This job's card is too large to paste
  (<size>). Open it before you start: <path>`, and its type's instructions.
- **A hard limit on the assembled prompt** (review finding 2). New pure
  `selectBatch(jobs, { assemble, budget })` in `batch-jobs.ts`, called by
  `processBatchJobs`. `assemble` builds the user prompt from the chosen
  descriptions (`buildReactorUserPrompt` with its ambient line), and each
  choice is measured on the prompt it would produce, so the framing, the job
  count in the "Please process" line, and the `\n\n` separator between
  descriptions (`prompts.ts:42-46`) all count (round-2 review finding 3; a
  fixed `framingBytes` missed the separators). Jobs arrive in discovery order
  (normal before low, oldest first).
  - The first job is always selected. It is sent in full if that fits the
    budget left; else with all its refs listed; else given by path.
  - Each later job is selected only if its full description fits the budget
    left (first fit). A job that does not fit is skipped, logged `deferred
    (prompt budget): <path>`, and stays pending.
  - After assembly, `processBatchJobs` measures the actual prompt. If it is
    over `BATCH_PROMPT_BUDGET_BYTES`, that is a broken invariant (the instructions
    of one job type exceeding 160 KB): it throws a typed error, logged by the
    cycle, and starts no agent session. So no prompt over the budget ever
    reaches the model.
  - A 300 KB hand-written job card is therefore sent by path, with its
    instructions, in a prompt well under the budget.
- **What the agent is told** (review finding 4). The system prompt today says
  *"The job content, referenced files, processing instructions, rules, and the
  agent guide are already loaded into this conversation. You do not need to
  re-read them"* (`beebox/src/core/reactor/prompts.ts:18-20`). That is false
  for a listed ref or a job given by path. Replace it with:
  *"Each job below has its type's instructions. Referenced files are pasted in
  under the job, except those listed under "Not pasted in (open these with
  your tools)": open each listed path before you act on it. A job given by
  path must be opened first. The rules and the agent guide are loaded; you do
  not need to re-read pasted material."* Step 1 of "Process"
  (`prompts.ts:25`, *"Read the job content from this prompt (already provided
  below)"*) gains "or from its path when it is given by path".
- **Order and starvation.** Among normal-priority jobs, the oldest is always
  first, so every normal job reaches the front in turn, and a small new job (a
  question follow-up) fits behind a large old one. Low-priority jobs come
  after every normal job (`job-discovery.ts:103-109`), and the reactor's 24 h
  overdue path runs only when no normal job is pending (`cycle.ts:145-160`). So
  while normal work keeps every batch full, low-priority jobs wait: stated as
  a limit, not fixed (review finding 7; no fairness rule).
- **Counting.** `processStage` (`cycle.ts:189-209`) counts processed jobs
  among the **selected** ones. `processBatchJobs` returns the selected paths
  with its success flag.
- **Rotation within a run.** `runReactor` keeps an attempted set. Discovery
  for cycle 2 and 3 drops jobs already attempted in this run. The loop stops
  when no unattempted job remains, when a cycle's agent session failed
  (`success` false), or when the engine is unavailable (existing,
  `core.ts:141-150`). It no longer stops merely because a successful cycle
  left its jobs unfinished: the next cycle takes the next jobs. A failed
  session still stops the run, so an API error costs one session, as today.
- **Dry run** prints the selected batch, the deferred jobs, and the prompt's
  byte size (`batch-jobs.ts:47-51`).

**Interaction with the job check (settled; corrected per review finding 8).**
The check charges the due paths it saw **before** it launches the wakeup
(`beebox/src/core/schedule/job-check/core.ts:142-158`). A split in that
wakeup deletes a charged original and creates chunk paths the check has never
seen. So, for the production box:

1. Pass N sees the oversized original (and the follow-ups) due, charges them,
   and starts run 1.
2. Run 1 splits: 12 normal scan chunks, 10 low-priority chunks. Each scan
   chunk's description is about 45 KB (card, 40 KB of refs, instructions), so
   a batch holds about 3 chunks plus the follow-ups; three cycles reach about
   9 chunks.
3. The first pass after run 1 ends sees the remaining chunks as new paths:
   first seen now, due at once (`job-check/rules.ts:66-71` for a new entry, `:84-97` for the due loop), and
   starts run 2 within about a minute. Run 2 reaches the rest.

Two runs close together, about 6 agent sessions, inside the 24-a-day cap.
A chunk left after run 2 has been charged once and is due again at +1 h, then
+6 h, then daily, for 7 days from its first sight. The 10 low-priority chunks
and the contains backfill never start a run; they fill leftover budget in runs
that normal work starts, and wait while normal work fills every batch (Order
and starvation, above). If an agent cannot finish a 25-item chunk in 30 turns,
it is retried on that backoff and given up after 7 days (`stalled-jobs` shows
it).

**Vocabulary lock-ins.** `BATCH_PROMPT_BUDGET_BYTES`, `JOB_INLINE_BUDGET_BYTES`,
`selectBatch`, the "Not pasted in (open these with your tools)" heading, the
"too large to paste" line, log line `deferred (prompt budget)`.

**First chunk.** The per-job inline budget, the by-path form, `selectBatch`
with the framing size, and the post-assembly check, with tests. Then the
system-prompt wording. Then the counting change and rotation. No open
question.

### Track D — Drain on the production box

**What.** No operator step. After deploy, the next run on that box splits the
two oversized jobs (Track B) and then drains them (Track C) on the job
check's schedule.

**Watch step** (part of rollout, read-only): the box's `scheduler.jsonl`
`job-check started` / `job-check run ended` lines, the wakeup's `intake-split`
commits, and `stalled-jobs` a day later. Expected cost: about 2 runs close
together, at most 6 agent sessions, for the normal-priority backlog. Expected
limit: the low-priority chunks (the 240-item `inbox-low` job's 10 chunks on
one box) drain only in leftover budget, so they may take days while normal
work keeps arriving.

## Could this be simpler?

**Simplest: list every ref by path, never inline.** Fixes the prompt size.
Fails on: the 300-item job is still one job a 30-turn session cannot finish,
so it never drains; appenders keep growing it; every small job gets slower.

**Cap without a budget.** Twelve 25-item scan chunks in one batch are still
about 3 MB inlined. Fails the first run after the split.

**Budget without a cap.** The 300-item job is always selected first and gets
40 KB of refs plus 300 paths; the agent cannot finish it in 30 turns. Never
drains.

**One budget instead of two.** With only the batch budget, the oldest large
job takes all 160 KB of pasted refs and every small job waits a cycle; with
only the per-job budget, ten 45 KB jobs make a 450 KB prompt. The second
constant is what keeps a follow-up from waiting behind a backlog.

**Split by an operator command instead of in the wakeup.** Needs someone to
run it as the box user on each affected box (two production boxes have
oversized jobs). The wakeup already holds the key lock and runs on every box;
doing it there is the same code and no procedure.

**A soft budget (always send the first job in full).** Simpler by one branch,
but a hand-written card over 160 KB reproduces the original failure.

**Without rotation.** A job whose agent does not finish it is resent in cycle
2 and 3 of the same run, and the loop stops at the first cycle that finished
nothing; the other jobs wait an hour. About 25 lines buy all three cycles.

## Subplans

none

## Failure modes

> **Critical gap (accepted):** a 25-item chunk an agent cannot finish within
> 30 turns stays pending, is retried on the job check's backoff, and is given
> up after 7 days. The cap value is the boxholder's ("about 25"); step 4b's
> old value was 10 for this exact reason (`steps.ts:330-333`). The cap stays
> at 25 by boxholder decision; the watch step reads whether chunks finish.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Two writers append to one key at once | existing lock (`intake-utils.ts:82-100`) | key lock covers find, append, and new-job creation | clear |
| Two new jobs for one key in the same second | new (same-second names) | random suffix | clear |
| A ref is past the per-job budget | new | listed by path with its size | clear (in the prompt and dry run) |
| The oldest job's refs exceed what is left | new | refs listed by path | clear (in the prompt and dry run) |
| The oldest job's own card exceeds what is left (a 300 KB hand-written job) | new | given by path, with an instruction to open it | clear (logged size) |
| The assembled prompt is over the budget anyway (a broken invariant) | new | typed error before any session; logged by the cycle | clear |
| A normal job never fits beside others | new (starvation test) | it becomes the oldest normal job and is then always first | clear |
| Low-priority jobs while normal work fills every batch | none | none: they wait (no fairness rule) | visible as pending jobs; stated in rollout |
| The agent ignores listed refs and finishes the job | none | the system prompt says to open them; if not, the items stay in the inbox unjobbed and step 4b re-jobs them on the next wakeup | late, not lost |
| The split stops after writing some chunks | new (interrupted split) | stable names: the next split writes only the missing chunks, then deletes the original | clear (commit history) |
| A scan import's new jobs are not committed | new (scan caller test) | `queueCommittedSessionIntake` commits every returned path | clear |
| That commit fails | new (refused commit) | the written job paths are put back as `HEAD` has them; step 4b re-jobs the items | clear (warning) |
| A chunk write is interrupted | none (`writeFileAtomic`'s own guarantee) | atomic publish: no partial file under a chunk's name | clear |
| The split's commit is refused | new (refusing hook) | original restored from `HEAD`, chunks removed; that wakeup skips its reactor step (the restored job would be sent whole) and exits 1, so a job-check run ends `ok: false` and its charged jobs come due on their backoff; the next wakeup splits again | clear (warning, `Skipped:` line, `run ended` line) |
| The process is killed between deleting the original and the commit | none | **accepted**: uncommitted chunks hold the items until a commit takes them; one unlink and one commit wide | silent until the next commit |
| The intake writer fails after an append | new (partial write) | its own writes undone before it rethrows | clear (the caller's warning) |
| A hand-edited intake job over the cap | new | split on the next wakeup | clear (commit) |
| A cycle's session fails (API error) | new | the run stops, as today | clear (`job-check run ended`) |
| The box's model has a short context window | none | unsupported: the reactor needs a long-context model (Prior art) | the session fails, as it would without this plan |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field.** A hand-written intake job with no `items` or a
  wrong key: unchanged behavior; the cap counts `items`. ADDRESSED.
- **Stale ref.** A listed ref deleted before the agent opens it: the agent
  finds nothing, as with an inlined ref that was missing
  (`batch-jobs.ts:136-138`). ADDRESSED.
- **Two agents touching the same card.** The split and the reactor do not run
  together: the split runs in the wakeup before its reactor step, under the
  cycle lock. ADDRESSED.
- **Hand-edit drift.** A person merges two jobs into one over the cap: split
  on the next wakeup. ADDRESSED.
- **Fabricated free-form value.** No new agent-written field. Not applicable.
- **Validation error UX.** The agent sees the "Not pasted in" heading with
  paths and sizes, in its prompt. ADDRESSED.
- **Partial rollout.** The engine updates as a whole; old oversized jobs are
  split on the first new wakeup. A split interrupted by a deploy resumes on
  the next wakeup under the same names. ADDRESSED.

### Scenario walks

**1. The production box, first run after deploy.** A pass sees the oversized
scan job and the follow-ups due, charges those paths, and starts a run
(`job-check/core.ts:142-158`). The wakeup child: step 4a; Track B splits the
300-item job into 12 chunks (`…-scan-part-01` to `-12`), one commit; step 4b
finds no unjobbed items; the reactor's cycle 1 discovers the follow-ups and
the 12 scan chunks (normal) and the low-priority jobs; `selectBatch` takes the
oldest scan chunk (its place kept by the stamp), then the follow-ups and two
more chunks while the assembled prompt stays under 160 KB; one session works
them; cycles 2 and 3 take the next unattempted jobs. The run ends. The first
pass after it sees the remaining chunks as new paths, due at once, and starts
run 2 within about a minute. Run 2 finishes the normal work. (On another
production box, the 240-item `inbox-low` job is split into 10 low-priority
chunks the same way; they wait for leftover budget.)

**2. A burst of 60 scan pages later.** Scan import calls the writer three
times; the first fills the newest unscoped job's room, the rest create
`<stamp>-inbox-<hex>` jobs of 25. Each call's `queueCommittedSessionIntake`
commits the job paths it got back, so the next pass sees them committed and
starts a run; each cycle sends what fits.

**3. A question answered during a backlog.** The new follow-up job is the
newest normal job, but it is a few KB, so first fit puts it in cycle 1 behind
the oldest chunk. The follow-up runs in the next run, not after the backlog.

## NOT in scope

- **Caps for other job types.** `contains-backfill` already writes 25 per job
  (`steps.ts:354`, `CONTAINS_BACKFILL_BATCH`); question follow-ups hold one
  question. The batch budget bounds any job's prompt anyway.
- **A per-model context table or per-model budget.** The reactor requires a
  long-context model (Prior art).
- **Fairness for low-priority jobs under sustained normal work.** Stated as a
  limit (Track C).
- **Charging only the jobs a run actually selects.** The job check charges all
  due jobs; the backlog still drains in about two runs. Revisit if a box's
  backlog needs more than the lifetime.
- **Chat jobs and other reactor paths.** Only the batch path is changed.
- **The reactor's handling of partly finished intake jobs** (`bbx finish`
  deletes the whole card). Unchanged.

## Open design questions

None open. Settled:

- Item cap 25 (boxholder decision). Step 4b's old comment chose 10 so the
  agent "can finish each within its turn limit" (`steps.ts:330-339`); the
  first runs' `jobsRemaining` shows whether 25-item chunks finish (critical
  gap above).
- Budgets 160 KB for the assembled prompt and 40 KB of pasted refs per job.
- The reactor requires a long-context model (at least about 128,000 tokens);
  no per-model budget.
- The split is generic over oversized intake jobs and resumable.
- Low-priority starvation under sustained normal work is a stated limit.

## Knowledge audits

Skipped: the agent-facing change is the reactor system prompt's context
paragraph and a heading it reads in place. No card shape or verb changes.

## What will hold this after it ships

All `t.check` tests; one claim each, with one example.

- **Cap on append** (filesystem, `makeTmpBox()`): a job with 20 items and a
  call with 12 → the job has 25, a new job has 7. Example: returns two paths.
- **Newest with room**: two unscoped normal jobs with 10 and 25 items → the
  10-item one receives the append; a full older job is untouched.
- **Description from count**: after appending 5 to a 20-item job, its
  description is "Triage 25 inbox items".
- **Same-second names**: three new jobs in one frozen box second → three
  distinct filenames, each parsed for age by `findJobCards`.
- **Step 4b**: 60 unjobbed items with no existing job → three jobs (25, 25,
  10), one commit.
- **Split**: a 300-item job → 12 cards of 25, items in order, same key, named
  `<original base>-part-01` to `-part-12`; the original deleted; one commit
  with `Phase: intake-split`. A 25-item job is untouched; a 300-ref
  `contains-backfill` job is untouched.
- **Split order**: after a split, `findJobCards` returns the chunks before a
  newer follow-up job of the same priority.
- **Per-job inline budget**: a job with refs of 30, 20, and 5 KB → the 30 KB
  ref inlined; the 20 KB and 5 KB refs listed by path with sizes (listing
  stops at the first that crosses the budget).
- **Hard limit, huge card**: a 300 KB hand-written job card, alone → the job
  is given by path; the assembled prompt is under 160 KB and contains the
  "too large to paste" line with the path.
- **Hard limit, framing and separators counted**: descriptions that would
  fit 160 KB by themselves but not with the framing, or not with the `\n\n`
  between them → the last one is deferred.
- **Post-assembly check**: a type whose instructions alone exceed the budget
  → typed error, no agent invoked. Shown at scale with the test-only
  `promptBudget` option (a 1 KB budget against the intake-job instructions):
  box-local job types' instructions do not reach the batch prompt, and no
  built-in type's come near 160 KB.
- **First fit**: descriptions of 100, 60, 30 KB → 100 and 30 selected, 60
  deferred and logged.
- **Prompt wording**: the system prompt no longer says referenced files need
  not be read; it names the "Not pasted in" heading and the by-path form.
- **Scan import commits its jobs** (filesystem, the photo path): an import
  whose items fill one job and start another → both job paths are in `HEAD`
  after the import, the output lists both under `Intake jobs:`, and `data`
  holds `intakeJobPaths`.
- **Interrupted split**: a 300-item job with chunks `-part-01` to `-part-05`
  already written and the original still present → the next split writes
  `-part-06` to `-part-12`, leaves 1 to 5 as they were, deletes the original;
  12 chunks in total.
- **Refused split commit** (a refusing hook): the original is back from
  `HEAD`, no chunk is left, the tree is clean; the next split succeeds with 12
  chunks.
- **Partial intake write**: a 20-item job and 12 new items, the jobs directory
  refusing new files → the append is undone and no new file is left.
- **Package-box restore**: a box nested one level inside its repository, its
  scan intake commit refused → the appended job is back to its `HEAD`
  content.
- **Scan commit refused**: a scan's intake commit refused by the box's hook →
  the appended job is back to its `HEAD` content, the new job is gone, the
  working tree is clean.
- **First pass after a split** (job check with a box clock): the original was
  charged; after the split, the next `checkWaitingJobs` sees the chunk paths
  with no entry and starts a run at once.
- **Processed among selected**: a cycle that selects 2 of 4 jobs and finishes
  both reports 2 processed and 2 remaining.
- **Rotation**: a run whose first cycle finishes nothing (session success)
  selects different jobs in cycle 2; a failed session stops the run.
- **Dry run**: prints the deferred list and the prompt size.

## Implementation order

1. Track A: the cap, naming suffix, description rule, `string[]` return, step
   4b simplification; scan import committing its jobs. Commit.
2. Track B: `splitOversizedIntakeJobs` and the wakeup call. Depends on 1.
   Commit.
3. Track C: per-job inline budget, by-path form, `selectBatch` and the
   post-assembly check; then the system-prompt wording; then counting and
   rotation; then dry-run output. Commit per step.
4. Docs: `beebox/src/core/reactor/DESIGN.md` (budget, rotation), the
   intake-job instructions (listed refs), `beebox/docs/design/processing.md`
   (wakeup step list gains the split). Commit.
5. After the boxholder says to land and deploy: Track D's watch step.

## Rollout shape

Tests first, per chunk. Done when the tests above pass, change-selected tests
pass, and `pnpm typecheck` and `pnpm layout-check` pass from `beebox/`.

Not done before landing: the end-to-end check below never ran on a test box or
production. Run it if the split or rotation misbehaves. The planned check was,
on a test box (not production): queue 300 inbox items into
one legacy-named intake job, run `bbx engine wakeup --max-cycles 3`, and
confirm the split commit, a dry run's prompt size under 160 KB, and the
deferred list. Interrupt one split (kill the wakeup after the first chunk) and
confirm the next wakeup finishes it with 12 chunks in total.

No schema change and no migration: the split runs as part of the wakeup.
