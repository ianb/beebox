# Plan Engineering Review — Replayable document triage

Full bbx-plan pass on September 28, following regenerated household fixtures and
new live observations. This reviews a proposed implementation; only experiments
and planning artifacts exist. Production behavior remains unchanged.

## What already exists

Landmark rule discovery, guide compilation, generic Jev judgments/budgets,
PDF probing, low-level Docling extraction, scan vision, scoped Git commits,
card-plus-attachment moves and the current held-question path are reuse points.
The plan cites their concrete source contracts. Current-agent and smallModel
are one baseline, not independent model arms.

## Ontology (verified against the code's own names)

TriageCategory is retained and supplemented with landmark identity. Proposed
Evidence, InstructionSnapshot and DecisionReceipt are distinct from model
judgments, application status and outcome assertions. No-match is not unclear;
service failure is neither. A confirmed label requires cited user evidence.

## Prior art (external) — verified

The plan links current TypeSafe state/question/Choice/confidence guidance and
1.13 limitations researched during this workstream. Confidence derives from
probabilities. Independent questions cannot consume each other's answers.
Structured provider criteria do not establish OpenRouter bridge support;
strings remain the proposed integration contract.

## Stated preferences this plan trades against

The boxholder wants understandable CLI composition, instruction-controlled
best effort, research and canonical instruction repair, replay of previous
correct decisions, and meaningful commit provenance. Unadmitted mail must
not persist in box content. The plan bounds this implementation to admitted
documents and explicitly leaves connector admission as required follow-up.

## Could this be simpler? (verified)

A classifier swap omits attachments and cannot reproduce the evaluated input.
Trailers alone lack prepared evidence. The proposed receipt uses Git-backed
JSON, not a database, and replay runs no agent or automatic application.
Future implementation is a BIG CHANGE; corpus/plan approval is not approval
to start production work at the estimated scale.

## Failure modes

Concrete failures drive planned tests: unreadable/junk PDFs, omitted attachments,
clipping, stale source/catalog snapshots, move/attachment/commit interruption,
concurrent Git sweeps, missing historical objects, and replay launching an agent.
The plan distinguishes existing experimental coverage from proposed handling.

## Agent-flow / user-flow edge cases

The authored policy can allow best effort without inventing missing content.
The fallback can discover authoring guidance and test a candidate overlay,
including hypothesis rules, without prematurely promoting guide confidence.
Replay labels user-confirmed and agent-asserted outcomes separately and reports
missing coverage. Ordinary research is not claimed to be a read-only sandbox.

## Findings

### Existing dry-run is not a read-only research agent

**Location in plan:** What already exists; CLI; replay.
**Citation:** `beebox/src/core/triage/run/core.ts:199`: `if (options.dryRun)`.
**Issue:** This gate follows agent execution; using it for replay would permit
tool side effects despite not applying routing decisions.
**Why it matters:** A test could edit the canonical instructions it is testing.
**Suggested action:** Adopted: replay calls preparation/judgment directly and
never launches fallback; test the fake-agent invocation count.
**Relevant preference:** scientific replay through understandable CLI operations.

### A committed file move does not prove triage provenance

**Location in plan:** Receipts, application and correction provenance.
**Citation:** `beebox/src/lib/git/core.ts:377`: `Returns the new commit hash, or null`.
**Issue:** A concurrent sweep may commit moved files before the scoped helper,
without the required decision trailers.
**Why it matters:** Git would show a move but not how triage decided it.
**Suggested action:** Adopted: verify required provenance and complete the receipt
in a scoped commit with trailers; do not treat null alone as success.
**Relevant preference:** commits identify instructions and confidence signals.

### Household rerun has a real destination disagreement

**Location in plan:** Prior art; judgment and fallback.
**Citation:** `results/2026-09-28/destinations-jev.json`, case-12: no-match 0.56,
notes 0.39; the current-agent result and authored label are notes.
**Issue:** Scenario conversion did not preserve every earlier outcome.
**Why it matters:** Relabeling old observations would hide both drift and failure.
**Suggested action:** Adopted: every retained observation was rerun, report 11/12,
and route admitted no-match as well as unclear into bounded research.

## NOT in scope (verified)

No quick-capture, connector persistence, real-box model probe, new OCR provider,
UI, automatic calibration, deployment or merge. Gmail remains explicitly pending.

## Things I checked and found clean

- Template sections present; first chunks have defined contracts and tests.
- Household raw PDFs/PNG regenerated and visually inspected; native/OCR/junk
  preparation checks passed, and corrupt input remains explicitly unclassified.
- New live observations: 228 Jev calls, zero transport errors, plus three current
  agent batches. Jev destination agreement is 11/12, current agent 12/12; both
  match all four successfully prepared documents. Instruction variant scoring
  excludes unavailable/underspecified targets and retains policy-specific labels.
- Frozen instruction protocol hash matches source and archived observations.
- Blocklist/path checks pass on the rewritten corpus, without guard changes.
- Typecheck, changed-file lint, doc checks and fake experiment runs pass.

## Cross-model full-plan adjudication

Claude Fable checked the template and source claims; accepted fixes:

- Intake attachment continuity now includes arrival, normalization and staged
  advancement, plus stranded-scope errors and reuse of current scan artifacts.
- Answered held questions invoke the correction CLI, record outcome provenance,
  and route learning through candidate/replay rather than direct rule promotion.
- The Git lock spans short mutation/commit work. A raw external commit race has
  a concrete provenanceRepair receipt update to make the repair commit nonempty.
- Receipts record requested/returned model IDs; an additional two-call synthetic
  probe verified dated-ID requests. Stable ref-derived option IDs avoid position
  drift; the original generic experiment already used opaque options.
- Replay has an explicit call allowance; automatic research shares a bounded
  run allowance across CLI calls instead of relying only on the notification cap.
- Receipts moved to `_bookkeeping`; retained evidence and deletion behavior are
  explicit in the proposed scope. Unmeasured PDF quality is not verified text.

Rejected two premises: handle.ts:251 enumerates files, it does not move them;
and untouched handled predictions do not become confirmed merely through silence.
The existing handler transport issue remains separate. Production routing is unchanged.
The experiment uses a new re-export of the existing Gmail validator through the
service entry point; this satisfies the layout guard without changing behavior.

Round 2 verified those fixes and found three remaining contract details, now
addressed: use cross-process withFileLock rather than an in-process card lock;
list the correct subcommand in help/dispatch tests; treat a legacy answer with
no channel as unknown provenance, never user-confirmed. Corrected the scan-import
path and a leftover config-path reference. Git-lock timeout/fail-open behavior
is now explicit. No further fresh-review round is requested; these changes
were checked against the cited helpers and question schema.
