---
title: "Bound the promote retry, and stop routing documents into the photo flow"
status: partial
workstream: scanner-setup
issues:
  - ../../../issues/closed/bugs/2026-09-05-scan-import-textless-pdf-photo-taxonomy.md
---
# Bound the promote retry, and stop routing documents into the photo flow

Two defects found while setting up scanner ingest on a real laptop, one of
which ran in production. A box whose Google authorization had expired put the
scan promote worker into an unbounded retry loop that ran a full agent every
~2 minutes for hours. Separately, a document scanned without OCR is routed to
the photo flow, where it is offered a `photo | back-of-photo | trash` question
it cannot answer — and one such document was trashed unfiled.

**Issues addressed:**
[`2026-09-05-scan-import-textless-pdf-photo-taxonomy.md`](../../../issues/closed/bugs/2026-09-05-scan-import-textless-pdf-photo-taxonomy.md).
Queue searched for prior items on both halves. `bin/issues search --all
"wakeup retry loop unbounded connector error exit code"` returned only closed
items about connector exits and one unrelated open browse-daemon wedge; no open
item covers an unbounded worker retry.
[`2026-03-04-agent-give-up-mechanism.md`](../../../issues/features/2026-03-04-agent-give-up-mechanism.md)
is adjacent — it proposes a marker an agent writes when it cannot finish — but
it is about an agent giving up inside a run, not a caller bounding its own
retries. Not a duplicate; noted so the two don't grow into each other.

## Stated preferences this plan trades against

- **Principle 4, resilient AND never silent**
  (`docs/engineering-principles.md:49`): *"Degradation is allowed for failures
  that can genuinely happen; invisible degradation is not."* An exhausted retry
  must land somewhere a person sees, not just stop.
- **Principle 5, failure paths visible in signatures where callers branch**
  (`docs/engineering-principles.md:64`): *"When callers genuinely dispatch on
  *why* something failed, return a discriminated Result … instead of
  throwing."* The promote worker dispatches on why the wakeup failed, and today
  it cannot, because it receives a process exit code.
- **Principle 13, a control shows the state the system is in, never the one it
  intends** (`docs/engineering-principles.md:151`). A retry that will never
  succeed is a system in a failed state presenting as a working one.
- **Boxholder ruling, 2026 (recorded in session memory): nothing retries
  forever** — bound retries in time, then strand into a visible terminal state.
  This plan's first track is that rule applied to a place that violates it.
- **`beebox/CLAUDE.md` — no features beyond the task.** Track 3's smallest
  version is one boolean; the plan says explicitly what more would buy.

## What already exists

- **The loop itself.** `src/webapp/routes/scan-promote-lifecycle.ts:38`:
  `const incomplete = result.skipped === "locked" || result.failed > 0 ||
  result.wakeup === "failed";` and `:42`: `if (incomplete)
  debouncers.get(boxRoot)?.notify();`. No attempt counter, no backoff. The
  module comment at `:30` states the intent — *"A pass can end incomplete three
  ways … All three are retryable, and none of them re-trigger on their own"* —
  which is right; the missing piece is a bound. **Rebuild the re-arm, keep the
  debouncer.**
- **The retry's memory.** `src/core/scan/promote-wakeup.ts:63-79`
  `runPendingWakeup`; on failure `:72`: *"Left deliberately: the marker IS the
  retry, and the next promote pass (debounced or at startup) picks it up."*
  The marker is durable and correct; what's absent is any record of how many
  times it has been tried. **Reuse, extend with attempt state.**
- **The coarse signal.** `src/core/scan/promote-wakeup.ts:54-57`
  `spawnBbxWakeup` reduces the whole wakeup to `{ ok, detail }` from a process
  exit code. That exit code is set by
  `src/cli/commands/wakeup.ts:285-286` from
  `wakeupExitCodeForConnectorErrors(connectorErrorCount)`
  (`src/cli/commands/wakeup-connectors.ts:134-136`: `return errorCount > 0 ? 1
  : undefined;`). So **any** connector error on the box — an expired Gmail
  token, in the observed incident — makes every wakeup exit 1 forever.
  **Rebuild the signal; the exit code cannot distinguish "the intake I asked
  for failed" from "this box has unrelated broken connectors".**
- **The settle window that paces the loop.**
  `src/core/scan/promote-debounce.ts:17`: `export const SCAN_SETTLE_MS = 2 * 60
  * 1000;`. Two minutes per iteration is why the observed loop was expensive
  rather than merely noisy — each iteration is a full `bbx wakeup`. **Reuse.**
- **The dispatch that sends documents to the photo flow.**
  `src/core/commands/scan-import.ts:99-111`. The comment states the assumption
  outright: *"a PDF without one is a photo batch that happens to be wrapped in
  a PDF, and belongs in the photo flow where front/back pairing lives."*
  **Rebuild.**
- **The unanswerable question.** `src/core/commands/scan-import-cards.ts:213`:
  `prompt: \`What is ${filename}? (photo, back-of-photo, or trash)\`` and
  `:214` `directive:` ending *"Otherwise delete …"*. **Rebuild for non-photo
  material.**
- **Docling OCR is already wired and reachable.**
  `src/services/docling.ts:131-133`: `// \`--force-ocr\` is deprecated in
  2.117; \`--ocr-mode full_page\` is the … args.push("--ocr", "--ocr-mode",
  "full_page");`, with `args.push("--no-ocr")` at `:138` otherwise. It is
  driven by `DoclingExtractOptions.forceOcr`, already plumbed through
  `pdf-extract.ts:65,117` and exposed as `bbx pdf reanalyze --force-ocr`
  (`pdf-reanalyze.ts:128`). **Reuse — this is the largest single finding in
  this plan: the document-with-OCR route is not new machinery, it is a boolean
  that scan-import never sets.** `src/core/commands/scan-import-pdf.ts:82`
  hardcodes `forceOcr: false`.
- **The probe that decides.** `src/core/commands/pdf-probe.ts:132`:
  `return { hasTextLayer: characters >= TEXT_LAYER_MIN_CHARS, textLayerSource:
  "probed" };` with `TEXT_LAYER_MIN_CHARS = 64` (`:39`). Note `:129`: when
  poppler is missing it returns `hasTextLayer: true, textLayerSource:
  "assumed"` — the probe already fails *open* toward pdf mode, which is the
  direction this plan wants. **Reuse.**
- **Reanalyze exists for exactly the recovery case.** `pdf-reanalyze.ts:5-8`:
  *"it exists for the cases the intake-time default cannot cover — a junk text
  layer that needs \`--force-ocr\` … Nothing automated calls it."* **Reuse for
  Track 4.**

## Prior art (external)

Searched to re-verify the conclusions in
[`scanner-ingest.md`](scanner-ingest.md), because Track 3 depends on them.
**They still hold**; this is a confirmation, not a change.

- Conditional "OCR only pages without a text layer" is still an unimplemented
  feature request — https://github.com/docling-project/docling/issues/3464
  (also open: /2036, /1229). Docling still has no hybrid mode.
- The `force_full_page_ocr` corruption class on longer documents is still open
  — https://github.com/docling-project/docling/issues/1499 — and a newer
  related garbled-text bug suggests the class persists —
  https://github.com/docling-project/docling/issues/3582. **This is a direct
  risk to Track 3**, since scanned documents here run 8+ pages.
- Docling's engine roster is now RapidOCR, EasyOCR, ocrmac, Tesseract, plus a
  Nemotron-OCR option, with no documented default recommended for scanned
  business/legal documents —
  https://docling-project.github.io/docling/concepts/OCR/
- No documented case of `do_ocr=True` giving consistently good full-pipeline
  (layout + TableFormer) results on image-only scans; independent write-ups
  still report Docling struggling on scanned/handwritten input —
  https://slavadubrov.github.io/blog/2026/03/04/ocr-guide/
- 2026 guidance splits by document type rather than crowning one tool; forms
  favour OCR pipelines, receipts favour LLM extraction —
  https://www.vellum.ai/blog/document-data-extraction-llms-vs-ocrs
- Retry vocabulary is unchanged and canonical: circuit breaker, exponential
  backoff with jitter, retry budget, dead-letter/poison-message —
  https://sre.google/sre-book/addressing-cascading-failures/
- Retryability requires classifying transient vs permanent failure; a coarse
  exit code conflates "my request failed" with "the callee is broken for
  unrelated reasons" — which is precisely the observed OAuth-expiry trap —
  https://aident.ai/blog/ai-agent-tool-failure-retry-matrix
- Terminal-state guidance from the same source: exhausted budget should become
  a *paused/waiting* state requiring intervention — visible, not silent.

## Tracks / scope

Ordered by dependency: Track 1 stops the bleeding and is independent; Track 2
removes the cause of the specific loop; Track 3 fixes the routing; Track 4 is
data recovery that depends on Track 3.

### Track 1 — Bound the promote re-arm

- **What.** Give the self-rearming pass in `scan-promote-lifecycle.ts` an
  attempt budget with backoff, and a terminal state when the budget is spent.
- **Why this needs to change.** Observed in production: twelve consecutive
  failed passes, one full `bbx wakeup` each, ~2:11 apart, with no end
  condition. The re-arm at `:42` is unconditional on failure count.
- **Direction.** Track consecutive incomplete passes per box in the existing
  module-level map beside `debouncers`. Re-arm with growing delay
  (`SCAN_SETTLE_MS`, then doubling, capped) for a bounded number of attempts.
  On exhaustion: stop re-arming, log at error level with the box and the last
  failure detail, and write a durable terminal record next to the marker so the
  state is visible on disk rather than only in a log that rotates. A genuinely
  new trigger — a new PUT, a box restart — resets the counter, because that is
  new information rather than the same failure repeating.
- **Vocabulary lock-ins.** The terminal record's filename and shape, living
  beside `wakeup-pending` in the quarantine dir. Proposed
  `wakeup-abandoned` holding the attempt count, the first and last failure
  times, and the last detail.
- **First implementation chunk.** The attempt-budget + backoff + terminal
  record in `scan-promote-lifecycle.ts` and `promote-wakeup.ts`, with doctests
  driving the pass function through repeated failures via injected seams (the
  lifecycle already injects `runWakeup`).

### Track 2 — Stop treating unrelated box failures as this wakeup's failure

- **What.** Make the promote worker's retry decision depend on whether *its*
  work succeeded, not on the wakeup process's exit code.
- **Why this needs to change.** `wakeup-connectors.ts:134-136` sets exit 1 for
  any connector error. An expired Google token on one box made every future
  scan wakeup on that box "fail" permanently. The intake work the promote
  worker actually cares about had already succeeded — documents were filed
  correctly during the looping period.
- **Direction.** Two candidate shapes, and the plan picks the second. (a)
  Special-case connector errors in the exit code — rejected: it changes a
  CLI contract other callers depend on, to fix one caller's misreading.
  (b) Have `bbx wakeup` report structured per-step outcomes the caller can
  dispatch on, and have `spawnBbxWakeup` decide retryability from the step the
  scan promote worker owns (intake-job drain), treating connector errors as
  *not my failure*. This traces to principle 5: the caller genuinely branches
  on *why*, so the reason belongs in the contract rather than in an exit code.
  The exit code stays as it is for humans and scripts.
- **Vocabulary lock-ins.** The name and shape of the structured wakeup outcome,
  and which step the scan promote worker is defined to own.
- **First implementation chunk.** Emit the structured outcome from `wakeup.ts`
  and consume it in `promote-wakeup.ts`, leaving the exit code untouched.

### Track 3 — Route image-only PDFs to the document path

- **What.** A PDF with no text layer becomes a `pdf.card` via Docling with OCR
  enabled, instead of being rendered to page images and sent through the photo
  taxonomy.
- **Why this needs to change.** `scan-import.ts:99-111` decides *what the
  material is* from *whether OCR was enabled at the scanner*. Observed
  consequence: nine pages across four documents produced two image cards and
  seven `unsure` questions whose only options were photo, back-of-photo, or
  trash — and one document was trashed unfiled.
- **Direction.** In the textless branch, call the existing pdf mode with
  `forceOcr: true` (`scan-import-pdf.ts:82` currently hardcodes `false`) rather
  than `runPhotoModeFromPdf`. The photo flow keeps its job — batches of actual
  image files (`scan-import.ts:113-121`, the non-PDF branch) — which is the
  material its front/back pairing was built for.
  **The open question is the text, not the shape** (see Open design questions):
  external evidence says Docling's own OCR is weak on scanned documents and has
  a live corruption bug on 10+ page files, while the vision pass demonstrably
  transcribed a dense form page accurately. The card shape should come from the
  document path regardless; where its *text* comes from is unsettled.
- **Vocabulary lock-ins.** None new — `pdf.card` and its `docling:` field
  already exist and are already produced by this pipeline.
- **First implementation chunk.** Flip the textless branch to pdf-mode-with-OCR
  behind the existing seams, with a doctest asserting a textless PDF yields a
  `pdf.card` and raises no `photo | back | trash` question.

### Track 4 — Recover the trashed document

- **What.** Re-import the one document that was trashed unfiled, and confirm
  nothing else from the affected batch was lost.
- **Why this needs to change.** It is the boxholder's document; the local
  original survives only because disposition was `keep` at the time.
- **Direction.** After Track 3 ships, re-upload the original from the laptop's
  `imported/` archive. Its bytes are unchanged, so the server's dedup will
  report the hash as known — Track 4 therefore needs a decision on whether to
  re-upload under a cleared ledger entry or to re-import server-side from the
  copy still in `_bookkeeping/trash/`. Prefer the trash copy: it needs no
  client change and no dedup override.
- **Vocabulary lock-ins.** None.
- **First implementation chunk.** Not a code chunk — an operator procedure run
  against the box, recorded here once it works.

## Could this be simpler?

**The simplest version is Track 3 alone as a one-line flip**, plus deleting the
stale marker by hand when a loop appears. That genuinely fixes the visible
damage: documents stop entering the photo taxonomy, so no more unanswerable
questions and no more trashed documents.

What the fuller plan buys, per principle 4: the loop is *invisible* until
someone reads a log or a bill. It ran twelve times unnoticed during this
session and was only found because the boxholder said an import "didn't
complete". A hand-deleted marker is not a fix — during this incident the
marker was cleared and the loop continued, and the exact mechanism that ended
it was never established. Leaving that in place means the next expired
credential on any box re-runs the same loop, and nothing in the system will
say so.

Track 2 could be dropped in favour of Track 1 alone: a bounded retry stops the
loop even if the signal stays coarse. That is a real option, and it is the
cut to make if this plan needs shrinking. It is kept because without it the
scan pipeline still *stops working* on a box with an unrelated broken
connector — the retries end, but they end in permanent abandonment of intake
that would have succeeded.

Rejected as over-build: a general retry/circuit-breaker framework for all
workers. There is one demonstrated instance. Principle 6, right-sized
defensiveness; a generalization with one caller is the named over-build. If a
second self-rearming worker appears, that is the moment to extract.

## Subplans

None. Track 3's unsettled question is a measurement, not a design step — it
needs one comparison run against real documents, recorded in Open design
questions, not its own plan.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Wakeup fails persistently; retries re-arm forever | No | No | **Silent** (log only, rotates) |
| Retry budget exhausts; intake never drains | No | No (new) | Silent unless Track 1 lands the record |
| Connector error on an unrelated card fails scan intake | No | No | Silent |
| Docling OCR corrupts text on a 10+ page scan (upstream #1499) | No | No | **Silent** — a plausible-looking wrong text layer |
| Docling OCR quality is poor but not obviously wrong | No | No | **Silent** |
| Textless PDF that really *is* a photo batch now becomes a pdf.card | No | No | Clear (wrong card type is visible) |
| Trash copy differs from the laptop original | No | n/a | Clear (hash compare) |

> **Critical gap:** Docling OCR producing wrong-but-plausible text on a long
> scan. No test, no handling, and silent — a bad text layer reads exactly like
> a good one. This is the strongest argument against making Docling OCR the
> unconditional answer in Track 3, and is why the text source is an open
> question rather than a decided one. Mitigation if Docling OCR is chosen:
> compare its output against the vision transcription on the same documents
> before committing, and record the comparison here.

> **Critical gap:** retry exhaustion with no durable record. Accepted only if
> Track 1 ships its terminal record; without it, exhaustion is silent and the
> plan has traded a loud loop for a quiet stall, which principle 4 forbids.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — ADDRESSED: Track 3 removes the choice rather
  than asking an agent to make it. The photo taxonomy is no longer offered for
  document material.
- **Stale ref** — ADDRESSED for the known case: `promote.ts:169-174` already
  writes the wakeup marker before import specifically so a crash cannot lose
  it. Track 1's attempt counter must live in the same durable place, or a
  restart resets the budget and the loop returns.
- **Two agents touching the same card** — ADDRESSED: the promote pass takes a
  per-box cross-process lock (`promote.ts:231-243`, `skipped: "locked"`).
  Track 1 must not count a lock-skip as a failed attempt; it is not a failure.
- **Hand-edit drift** — GAP: a boxholder who deletes `wakeup-abandoned` by hand
  gets a fresh budget with no record of the prior exhaustion. Acceptable — it
  is the manual reset, and it is the same gesture as clearing the marker today.
- **Fabricated free-form value** — ADDRESSED: nothing in this plan asks an
  agent to invent a value. Track 3 reduces invention by removing a question the
  model was answering with "unsure".
- **Validation error UX** — DEFERRED to Track 2's shape: the message the
  promote worker logs when it declines to retry must name the owning step, or
  the next debugger repeats this session's investigation.
- **Partial migration / transition state** — ADDRESSED: no data shape changes.
  Documents already imported through the photo path stay as they are; Track 4
  handles the one that was lost, and re-importing the rest is the boxholder's
  call, not a migration.

## NOT in scope

- **Changing `bbx wakeup`'s exit code.** Considered and rejected in Track 2:
  other callers and humans rely on non-zero meaning "something went wrong on
  this box". The fix belongs in the caller's signal, not the CLI contract.
- **A general retry framework for all background workers.** One demonstrated
  instance; see *Could this be simpler?*.
- **Re-scanning or re-importing the three documents that filed correctly.**
  They are in the box under correct names. Whether to re-import them as proper
  `pdf.card`s with structure is the boxholder's call, not this plan's.
- **Fixing the expired Google authorization.** A credential the boxholder holds;
  agents do not change credentials. This plan makes the pipeline tolerate it.
- **Widening the photo flow's own question vocabulary.** Track 3 stops
  documents reaching it, which is the reachable harm. If genuinely-photo
  material still lands in `unsure`, that is the pre-existing behaviour and out
  of scope here.
- **The scan guide card as a dispatch input.** The idea that a folder or box
  can *declare* it holds documents is attractive and was raised in the issue,
  but Track 3 makes it unnecessary for the observed failure. Deferred until
  something needs it.

## Open design questions

- **Where does a textless PDF's text come from — Docling's OCR, or the vision
  pass?** This plan's lean: ship Track 3 with Docling OCR because it is a
  boolean against machinery that already exists, then compare its output
  against the vision transcription on the same real documents before calling it
  settled. The comparison matters because external evidence is against Docling
  here (open corruption bug #1499/#3582 on long documents; independent reports
  of weak OCR on scans) while we have first-hand evidence that the vision pass
  transcribed a dense multi-column form page accurately. If Docling loses,
  the follow-up is a document-shaped output from the vision path — which is
  the larger change, and the reason this is a question and not a decision.
- **How many attempts, over what span, before abandoning?** Lean: a small
  count with doubling backoff bounded to roughly an hour, so a genuinely
  transient failure recovers and a permanent one is abandoned within one
  working session. Not settled; it belongs in Direction before Track 1's chunk
  is cut.
- **A persistently failing upload still retries on the 6-hour GC sweep and at
  every box start.** SETTLED 2026-09-06, boxholder: *"I guess every 6 hours is
  okay."* Accepted as documented behaviour rather than fixed. The in-process
  cap stops the fast re-arm; what remains is a slow poll, and bounding it would
  need durable per-entry dead-letter state for a failure mode that has not been
  observed.
- **Should abandonment raise a question card on the box** rather than only
  writing a record? It would be visible where the boxholder already looks.
  Against: a question card the boxholder cannot act on is the exact
  anti-pattern Track 3 is fixing. Lean: durable record plus error log first.

## Knowledge audits

No new agent-facing concept: this plan removes a question vocabulary rather
than adding one, and its other surfaces (the retry budget, the wakeup outcome)
are infrastructural and never seen by a box agent. If Track 1's abandonment
becomes a question card — an open question above — that *is* agent-facing and
gets a `knows_directly` entry before it ships.

## What will hold this after it ships

- **Track 1** is a decision — how many attempts, when to stop — and the risky
  part is the policy, not the I/O. Keep the policy a pure function over
  (attempt count, last outcome) so a doctest reaches it directly, the same
  shape used for the uploader's settle-retry policy in
  `scan-uploader/test/settle-retry.doctest.md`. No new tier, no mock.
- **Track 2** is covered by the existing route doctests plus a new case
  asserting that a wakeup reporting connector errors, with intake drained, is
  *not* retried.
- **Track 3** is covered by a scan-import doctest: a textless PDF fixture in,
  a `pdf.card` out, and no `photo | back | trash` question raised. The existing
  fake Docling service (`services/docling.ts:370` prints a fake summary) means
  this needs no network.
- **Track 4** leaves no code behind, so nothing holds it but this plan's
  record of what was done.

## Status, 2026-09-06

Tracks 1, 2 and 3 are implemented, reviewed cross-model, and landed. Track 4
(recovering the one trashed document) is an operator procedure against a
production box and has not run yet.

## Implementation order

1. **Track 1** — bound the re-arm, backoff, terminal record. Independent of
   everything else; ships the moment it is tested. Highest urgency: it is the
   guard that makes any future instance of this class survivable.
2. **Track 3** — flip the textless branch to pdf-mode-with-OCR. Independent of
   Track 1. Stops new documents being lost.
3. **Track 3 comparison** — run Docling OCR against the vision transcription on
   real documents, record the result, settle the open question.
4. **Track 2** — structured wakeup outcome, consumed by the promote worker.
   After Track 1, because Track 1 makes the system safe without it.
5. **Track 4** — recover the trashed document. After Track 3, so it imports
   through the corrected route.

## Rollout shape

Tests first, per `docs/testing.md`. Done-when, by track:

- Track 1: a doctest drives repeated wakeup failures through injected seams and
  asserts the attempt sequence, the backoff growth, that a lock-skip does not
  consume budget, and that exhaustion writes the terminal record and stops
  re-arming.
- Track 2: a doctest asserts a wakeup whose only failures are connector-level,
  with intake drained, is reported as not-my-failure and not retried.
- Track 3: a scan-import doctest asserts a textless PDF produces a `pdf.card`
  with `forceOcr` requested, and that no photo-taxonomy question is raised.
- Track 4: byte-hash equality between the recovered document and the laptop
  original.

No knowledge audits land with this plan (see above). No data migration: no card
shape changes, and previously imported material is left as it is.
