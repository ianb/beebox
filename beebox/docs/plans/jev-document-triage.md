---
title: "Replayable document triage with Jev"
status: draft
workstream: jev-triage
issues:
  - ../../../issues/features/2026-09-21-jev-triage-and-quick-capture-routing.md
---
# Replayable document triage with Jev

When incoming documents need filing, the box should prepare their evidence,
apply understandable instructions, and research uncertain cases. An agent should
be able to repair those instructions and replay prior decisions before keeping
an edit. Small CLI operations are the public interface; triage composes them.

**Issues addressed:** document-triage half of the linked issue only. Quick
capture stays open. This implementation unit covers documents already admitted
to the box. Gmail admission remains required follow-up work, not a delivered
property of this unit. Searching the issue queue also found
[handler NUL transport](../../../issues/bugs/2026-09-13-triage-items-nul-env-truncates-handler-batch.md);
it affects later handlers and is not resolved or closed here.

## Smallest fix and budget

A direct classifier swap is roughly 150–250 source lines but leaves binary
reads, missing attachment evidence, and no reproducible correction mechanism.
The chosen complete unit adds the CLI preparation/judgment/replay/apply loop,
Git-backed decision receipts, and bounded agent research for admitted items.

**BIG CHANGE — implementation approval required before production coding.**
Estimate additions plus deletions: 2,000–2,600 production lines (CLI/core,
preparation adapters, receipts/apply and fallback), 800–1,100 test lines, and
250–400 agent-guide/reference/audit lines. The completed experiment and planning
artifacts are separately about 1,950 authored lines plus generated observations
and PDFs/images. Total authored workstream scope is about 5,000–6,050 lines.
No new database, service, frontend or evaluation framework is proposed. The
size comes from replay provenance and safe application, not the Jev call.
The current request authorizes corpus reruns and this plan pass; it does not
by itself approve implementation at that estimated scale.

## Stated preferences this plan trades against

Direct boxholder decisions, September 28:

- "do-your-best IS okay" when instructions allow it. No universal numerical
  gate or mandatory calibration phase precedes useful triage.
- "each failed triage is an opportunity to improve the instructions"; test
  the correction and previously correct cases, not merely a probability gain.
- Instructions have decentralized destination explanations and one overarching
  decision policy. They must contain necessary identifying context.
- "triage itself is a little harness around easy to understand cli things".
- Commits identify triage, instruction paths and confidence signals.
- "Yes: no unadmitted box content" accepts ID-only pending mail and temporary
  extraction. Existing connectors do not yet meet this new boundary.

[Engineering principles](../engineering-principles.md), especially principles 1 (typed
structure), 3 (boundary validation) and 4 (visible failure), favor explicit preparation
and decision outcomes. Replay provenance adds files because paths and logs alone
cannot reproduce a past judgment. Synthetic household fixtures and authorized
keys may be used for tests; real box content is not authorized for model probes.

## What already exists

Paths below are monorepo-relative and describe current code, not this proposal.

- `beebox/src/core/triage/run/core.ts:156`: **`model: await loadEffectiveSmallModel(boxRoot),`**.
  Current-agent and smallModel are one experimental baseline. At 45,
  **`const ITEM_CONTENT_LIMIT = 4000;`**; at 67 the file is read as UTF-8 with
  **`.catch(() => "")`**. Replace silent loss with preparation outcomes.
- `beebox/src/core/triage/instructions.ts:76`: **`export async function compileTriageInstructions(`**.
  Reuse landmark discovery. Names at 96 are basename-derived, with collision
  handling at 110–119; snapshot source refs as destination identity too.
- `beebox/src/schemas/landmark.ts:120`: **`rules: z.string().optional()`**.
  Destination explanations already have a home; no new purpose field needed.
- `beebox/src/schemas/guide/schema.tsx:97-102` has **`"triage-rules"`**,
  **`"default-action"`**, **`actions`**, and **`"context-notes"`**.
  At 117: **`user-stated > feedback > inferred > default`**. Reuse the guide.
- `beebox/src/schemas/guide/compile.tsx:26`: **`// Triage rules (skip hypothesis-level)`**.
  Trials need an explicit candidate overlay; normal compilation must not
  promote hypotheses merely to make a test possible.
- `beebox/src/services/jev.ts:114`: **`async judge(input)`**. Use this generic
  service, not the chat-specific `decide`, whose instruction at 99 says
  **`Always choose a chat, even when the fit is uncertain.`**
- `beebox/src/core/judgment/service.ts:50`: **`resolveJudgeService`**;
  `beebox/src/cli/commands/judge/command.ts:194`: **`reserveJevCalls`**.
  Reuse service resolution and budget accounting for every live replay too.
- `beebox/src/core/pdf/probe.ts:55`: **`textLayerQuality: "good" | "junk" | "none";`**.
  At 195, **`extractPdfText`** returns nullable text; the adapter must distinguish
  absence from preparation failure rather than treating null as no-match.
- `beebox/src/services/docling/core.ts:81`: **`Caller owns creation and cleanup.`**
  Reuse this low-level extraction service in owned scratch space. The wrapper
  `beebox/src/core/pdf/extract.ts:137` writes attachment assets, so is unsuitable
  for a side-effect-free preparation operation.
- `beebox/src/services/scan-vision.ts:89`: **`analyzeBatch(args: ScanVisionAnalyzeArgs): Promise<ScanVisionResult>;`**.
  Reuse image analysis; OCR alone cannot describe objects.
- `beebox/src/core/triage/run/routing.ts:41` describes reason text as
  **`surfaced on probable review and in question prompts`**; line 125 also uses
  it in a guide-learning **`proposal:`**. Preserve honest semantic explanations.
- `beebox/src/core/commands/move/phase2.ts:40`: **`movePhase2CardFiles`** moves
  card and attachment scope with two renames at 46 and 54. Reuse mechanics,
  but do not assume the pair is atomic despite its comment.
- `beebox/src/lib/git/core.ts:327`: **`Commit only the given paths, ignoring unrelated staged changes.`**
  Use scoped commit helpers. At 379 `stageAndCommitPaths` can return null when
  a sweep already committed paths; that does not prove required trailers exist.
- `beebox/src/core/triage/run/core.ts:199`: **`if (options.dryRun)`** skips apply
  after agent execution. Agent dryRun instead returns a canned result at
  `beebox/src/core/agent/invoke/run.ts:249-255`. Neither is read-only research.
- `beebox/src/core/agent/invoke/prompt-logger.ts:4-6` logs requests/responses
  in **`.beebox/logs/`**. Ordinary fallback is allowed only for admitted material.

Searches found no durable triage decision recorder or replay history. Existing
Jev debug logging truncates state (`service.ts:22`: **`LOGGED_STATE_CHARS = 500`**)
and cannot supply exact evidence. Existing guide-learning and Git history are
reused; receipts below add the missing immutable inputs, not a calibration DB.

Intake also needs a bounded prerequisite fix: `beebox/src/core/commands/intake/run.ts:94`,
155 and 182 use **`fs.rename`** for normalization and stage transitions without
moving attachment scopes. `beebox/src/core/commands/scan-import/command.ts:4-5` places
**`Child cards and files`** in a session attachment scope. Existing scan PDF
artifacts should be reused when source digests show they describe current bytes.
Handle enumerates files (`beebox/src/core/handle.ts:251`), but does not itself
perform a move; handler transport remains the separately filed NUL issue.

## Prior art (external)

Provider pages were checked September 28:

- [State](https://docs.typesafe.ai/concepts/state): text/JSON input only; raw
  PDFs and images require preparation. Use named fields and relevant context.
- [Questions](https://docs.typesafe.ai/primitives): focused independent questions;
  IDs are not model context. One item per request; several questions may share
  its state but cannot consume one another's answers.
- [Choice](https://docs.typesafe.ai/primitives/choice): descriptions distinguish
  alternatives; include no-match. Our additional unclear outcome is tested
  separately from no-match, not assumed equivalent to probability thresholding.
- [Limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13): literal wording,
  indirection, conflicting guidance, irrelevant context and injection can harm
  judgments. Keep computations in code, necessary facts explicit, and research
  procedures outside the classifier prompt.
- [Confidence](https://docs.typesafe.ai/confidence): confidence derives from the
  probability distribution, not an independent correctness check.
- [Structured criteria](https://docs.typesafe.ai/primitives/advanced) are supported
  by TypeSafe, but our adapter uses string criteria and string/string-array
  instructions (`beebox/src/services/jev-judge.ts:18-23`). Use labeled prose;
  do not broaden the OpenRouter contract without testing that bridge.

The [format experiment](../reports/jev-document-triage-experiment-2026-09-28.md)
was rerun on household administration: 36 Jev calls, three current-agent batches,
and regenerated PDF/image preparation. Jev matched 11/12 destination labels;
cloud-storage research notes became no-match rather than notes, while the
current agent matched all 12. The
[instruction experiment](../reports/jev-instruction-experiment-2026-09-28.md)
reran 192 calls on 16 fixed cases. Rules changed placement as specified; missing
content remained unclear when permitted. Forced choice made missing content
no-match with probability 1.00. These are diagnostic synthetic observations,
not real-box calibration or proof of generalization. Old results were replaced
by new calls, never edited to pretend they used the household inputs.

## Ontology

- **Item:** an admitted staged file and, for cards, its attachment scope.
- **Evidence:** versioned text parts, method, source digests, omissions and status;
  not the original file or a predicted label.
- **Instruction snapshot:** effective guide policy plus destination criteria,
  with source refs/digests and compiler version. Not a competing editable guide.
- **Destination:** existing TriageCategory plus landmark ref and snapshot option ID;
  display/category names alone are not stable identity.
- **Judgment:** selected destination, no-match or unclear, with full probabilities
  and distribution-derived confidence. A service error is not a judgment.
- **Decision receipt:** one versioned JSON record of evaluated evidence, instructions,
  prediction, research reason and application state, identified by UUID. Evaluated
  inputs stay immutable; application/outcome metadata can be appended.
- **Outcome assertion:** confirmation/correction with source and actor provenance;
  a high-probability prediction is never automatically a confirmed outcome.
- **Replay:** a fresh judgment linked to a receipt; immutable original stays intact.
  Repreparation is an explicitly different experiment from fixed-evidence replay.

## Tracks / scope

### 1. Evidence and instruction compilation

**What/why:** replace flat clipped text with inspectable evidence and compile
one authoritative policy/catalog. Jev cannot discover unstated box context.

**Direction:** pure core APIs behind CLI commands accept resolved box refs.
`prepareItem` returns `{version:1, source:{ref,digest}, parts:[{ref,digest,
mediaType,method,toolVersion,status,text,omissions}], recipe}`. Status is
`ready|partial|unavailable`; recipe records ordered transformations and optional
agent-supplied interpretations with evidence refs. No status is a relevance label.

First repair intake arrival, filename normalization and staged advancement to
carry each card's `.attach` scope with it, using collision-checked move mechanics.
Do not bulk-move arbitrary directories. A stranded same-basename scope in an
upstream inbox/intake directory is an explicit preparation error requiring repair.
Enumerate the complete card attachment scope before choosing relevant parts;
prefer existing validated scan text/vision artifacts to duplicate extraction.
Text/HTML keep meaningful structure; PDF good native text is reused, absent/junk
layers use Docling modes, images use scan vision as necessary. External links
are unresolved evidence until research fetches them, not automatically followed.
Unsupported binary types, missing files, failed extraction and budgets produce
explicit omissions. Whole-document unreadability invokes research without asking
Jev to infer relevance; partial evidence can support a best-effort rule.
Do not substitute intended fixture text or silently clip to a budget. Retain
which portions were excluded; failure to fit the request is a preparation status.
Treat PDF quality marked `assumed` as unmeasured, not verified good text.
Own temporary extraction directories with finally cleanup; do not mutate source
cards or use the asset-writing PDF wrapper from prepare/replay.

Use `_config/intake.guide.card` as the single overarching policy and landmark
`destinations` rules as destination explanations. The existing guide parser and
compiler remain the authoring format; output a snapshot, not another editable
file. Missing guide uses a visible built-in conservative policy: uncertain
placement is unclear, readable no-fit is no-match. Invalid guide fails visibly.
Compile source hierarchy and explicit precedence into direct prose; never resolve
contradictions merely through file order. Exclude unrelated guide actions/history
from Jev; include relevant identifiers/context. Default source precedence favors
user-stated over inferred rules; semantically unresolved conflicts go to research.

Vocabulary: `Evidence`, `InstructionSnapshot`, landmark ref/digest and version 1
JSON shapes. First chunk: define/validate these boundaries and expose prepare and
instructions, with filesystem doctests; no routing/model invocation yet.

### 2. Small CLI operations and judgment

**What/why:** the agent can inspect inputs, run a decision, and reproduce failure
without invoking the entire pipeline. Commands call shared functions; internal
orchestration need not spawn subprocesses.

```sh
bbx triage prepare <source-ref> --out <evidence.json>
bbx triage instructions --out <instructions.json>
bbx triage instructions --overlay <candidate-guide.card> --out <candidate.json>
bbx triage judge --evidence <evidence.json> --instructions <instructions.json> --out <decision.json>
bbx triage decisions --destination <landmark-ref> --outcome user-confirmed --json
bbx triage replay <decision-id...> --instructions current --compare original --max-calls 12 --json
bbx triage replay <decision-id...> --instructions <candidate.json> --prepare-again --max-calls 12 --json
bbx triage apply <decision.json>
bbx triage correct <decision-id> --question <answered-ref>
bbx triage confirm <decision-id> --source <correction-ref> --outcome <destination-ref>
bbx triage --engine jev
```

Add CLI surface/help classification for each subcommand and test commander
parent/subcommand dispatch. Every command also supports readable summaries and `--json`. Explicit output
files must be absent unless overwrite is requested; no source-body text in default
summaries. Candidate overlay replaces the guide only in the trial snapshot and
includes hypothesis rules explicitly. Landmark candidates use an overlay map
`--landmarks <ref-to-candidate-file.json>`; canonical files are never edited by
compilation. Validation names the offending ref/field and leaves sources intact.

`judge` sends one Choice per item, categories plus reserved no-match and unclear.
Its direct instructions define ambiguity, boundaries and permissible best effort.
No universal probability threshold is fitted; report all values. A top destination
can be applied under the compiled policy; explicit unclear or no-match invokes research for admitted items.
Ties between winning options deterministically become unclear. A missing key,
service/budget failure or malformed answer is an operational error, not no-match.
`judge` itself does not launch research or route. Every call uses existing service
resolution, fake behavior and budget reservation. Preview/replay spends budget
but is clearly labeled as a trial. Replay requires `--max-calls N`, prints its
planned call count (including optional `--repeat N`), and reserves the complete comparison before starting; it
never silently drops cases to fit a limit. Research receives at most 12 Jev calls,
and a normal triage invocation at most 32 including initial/rejudge/replay calls.
Use an inherited run ID and a short-lived locked allowance file under `.beebox/`
so CLI calls made by that agent debit the same allowance; expired IDs fail closed.
Remove the allowance file after the run; this is accounting, not an agent sandbox.
The existing box-day cap remains shared with notifications. Exhaustion leaves
unstarted items in staged and reports budget deferral, not semantic held outcomes. Provider model/version is recorded.

Normal `bbx triage --engine jev` composes prepare/compile/judge/research/apply
per item, sequentially with bounded calls. `--dry-run` in Jev mode stops at judgment
and never invokes research, moves or guide edits. Keep the legacy agent engine
as default until explicit per-run opt-in; no new persisted engine selector here.
No-match/unclear remaining after bounded research map to held items, not deletion. Fast-route reasons are
honest summaries identifying rule paths and probabilities, labeled as summaries,
not fabricated semantic explanations. Agent fallback supplies semantic prose.

First chunk: judge, output validation, budgets and CLI dry-run doctests. Vocabulary:
reserved outcomes cannot collide with landmark option IDs; compiler assigns deterministic opaque IDs from canonical landmark refs, sorted
by ref, with display names included in criteria and a separate landmark map.
The generic experiment already uses opaque `option_N` IDs; the instruction probe
uses readable IDs. Tests must cover stable keys and duplicate display names.

### 3. Receipts, application and correction provenance

**What/why:** exact replay needs full inputs, not short logs or a mutable path.
Use ordinary Git-backed JSON receipts under `_bookkeeping/triage/decisions/<uuid>.json`;
no DB, new card type, UI, or separate calibration store. Only admitted material
may be recorded here. Preview files remain caller-owned and aren't indexed.
Snapshots persist until their receipts are explicitly deleted; deleting an
original alone does not erase replay evidence. Document this retention tradeoff
in command help/authoring guidance and the approval scope; normal Git history
retention still applies. No automatic purge or separate retention service here.

Receipt v1 contains source/attachment refs, source Git revision at preparation,
byte digests, prepared evidence,
preparation recipe, complete effective instruction snapshot and source digests,
serialized request hash, requestedModel and returnedModel, raw validated answer, reason `{kind:summary|agent,text,
evidenceRefs}`, destination ref, original decision ID for corrections, and
application `{state:pending|applied|incomplete,from,to,questionRef?}`. Outcome
assertions append `{label,actor:user|agent|unknown,sourceRef,at}`; history preserves edits.
`confirm` needs an actual answered-question or user-authored chat-turn reference
to claim user confirmation; an agent-authored statement about the user is insufficient;
agent research remains an agent assertion. Never infer correctness from silence.
Held-question directives call `bbx triage correct <id> --question <answered-ref>`:
validate answer/answered-at and authored channel, map the selected option to the
snapshot landmark, create correction receipt plus user assertion, move card/scope,
and resolve the question. CLI answers need a cited user turn to count as user
confirmation; an agent's own CLI decision remains agent-asserted. Missing legacy `answered-via`
is unknown provenance and cannot enter the user-confirmed set without another
verified user source; do not invent an agent or user attribution. Free-text
answers go through grounded research, not arbitrary destination-string execution.
The learning proposal points to candidate-overlay/replay guidance, not a direct
untested rule rewrite. `confirm` supports already-correct items and outside
corrections; untouched handled items remain predictions until explicitly asserted.

Apply validates schema and current source/catalog digests immediately before
mutation, under a cross-process `withFileLock` keyed by source/attachment digest in
`.beebox/locks/triage-<digest>`. An in-process `withCardLock` is insufficient;
item-lock timeout fails without mutation. Test simultaneous CLI processes. Stale inputs return
`stale-decision` with a replay instruction. Reject target/card/attachment collisions;
never overwrite. Receipt is written pending before moving anything. Move the card
and attachment scope together through existing move mechanics, tracking partial
progress explicitly. Use a deterministic question ref tied to receipt ID and
reuse held-question rendering with distinct no-match/unclear wording. Remove or
replace old probable markers when correcting, and resolve the linked question.
Raw standalone files move as a single item; their receipts still use bookkeeping paths.

Per item, scoped Git commit includes old/new item paths, attachment scope, receipt
and its question/marker only. Required trailers: `Triage-Decision`,
`Triage-Instructions` (source paths), `Triage-Classifier`, `Triage-Outcome`,
`Triage-Probabilities`, `Triage-Confidence`; corrections add `Triage-Corrects`.
Use one commit per applied item so trailer ownership is unambiguous. Full policy
content stays in receipt/Git, not the commit message. No unrelated staged changes.

Do not claim multi-file renames are atomic. A failed move/question/commit leaves
an explicit incomplete receipt and CLI error; rerunning apply with that receipt ID
checks digests at old/new locations and completes only the missing operations.
Ambiguous mixed states stop with recovery paths; no generic automatic rollback.
Never invoke the model again merely to finish a recorded move. Take the item lock first, then the reentrant Git lock across receipt writes,
renames, stage and commit, with no model work inside. This coordinates ordinary
sweeps unless the Git lock times out and falls open; trailer verification also
covers that fallback. A raw external commit can still race: verify trailers; if absent, append
`provenanceRepair:{observedCommit,at}` to the receipt and make a nonempty scoped
completion commit with the required trailers. This specifies actual content to
commit when the sweep already captured all original changes. Original source bytes are not duplicated in receipts; unavailable annex
objects block prepare-again, but fixed-evidence replay still works.

First chunk: receipt validation plus fake-service apply/retry tests, including
attachment-rename failure and commit failure. This is the durable-state addition;
it must not grow into a generic workflow journal.

### 4. Replay, research and instruction improvement

**What/why:** make one wrong decision an evidence-backed rule repair while
protecting previously correct decisions.

Fixed-evidence replay loads the receipt's exact evidence, requests its recorded returned model
by default, and evaluates old/current/candidate instructions without changing
sources, outcomes or receipts. `--compare original` runs both instruction sets
against the same evidence/model; historical output is shown separately from the
fresh baseline. Explicit model override labels model drift. An unavailable pinned
model is reported, never silently substituted. Also retain the original request
alias and verify the returned model matches the replay pin. A two-call household
probe confirmed both alias and dated ID work today; future availability is not
assumed. Explicit model override reports drift rather than claiming exact replay. `--prepare-again` resolves the receipt's applied location or historical Git revision,
verifies original byte digests, or reports changed/missing sources, produces fresh evidence,
and reports preparation differences independently from instruction effects.
Recipe steps that depend on irreproducible agent interpretation are labeled as
such; recorded interpretation can be reused but isn't newly verified evidence.

`decisions` scans validated receipt files (no index), filters by destination,
instruction ref, user-confirmed/agent-asserted/corrected outcome, and reports
unavailable sources. Replay accepts explicit IDs or `--cases <id-list.json>`.
CLI output includes changed destinations, no-match/unclear transitions, assertions,
probability differences, errors and missing coverage. It never counts unavailable
or failed cases as passing. Trials go to stdout or explicit output files, not the
production receipt directory. No fallback agent, question, routing or rule edits
are triggered by replay, including on unclear or extraction failure.

Ordinary research fallback is for admitted items only. Use full box context with
explicit evidence/snapshot refs, `maxTurns:12` and `maxBudgetUsd:1` initially;
exhaustion leaves unclear. At most one research invocation and one post-research
rejudge per automatic item; no recursive fallback. Service failures remain
operational errors rather than speculative research. Research can inspect sources,
use extraction services, and return grounded reason/supporting refs. It may create
a candidate overlay, replay the failure and nearby prior correct cases, and edit
a narrowly supported canonical instruction. Commands revalidate after any edit;
changing rules requires a new snapshot and judgment before apply.

Authoring guidance teaches: identify cause (missing evidence/rule ambiguity/model
error); state hypothesis; change the correct guide or landmark rule; test original
and candidate with fixed evidence; select positive/negative neighboring cases and
prior corrections; retain or revert based on outcomes, not probability increases.
A failed regression prevents automatic promotion of that candidate; broader agent
judgment may explain the conflict and leave an unresolved question. No confirmation
history means the loop reports its weak coverage and uses synthetic/agent-asserted
cases honestly. Do not weaken user-stated policy to make one synthetic case pass.
Agent-driven research is not a sandbox and its prompts/transcripts persist; never
reuse it for unadmitted connector content under the accepted privacy contract.

First chunk: fixed-evidence replay and decision listing, then prepare-again;
finally bounded fallback plus correction guidance/audits. New box documentation
is on-demand `docs/box/triage-instructions.md`, with short discoverability pointers
in triage prompts/guide/landmark instructions and the agent-guide ledger.

## Could this be simpler?

A Jev call over existing clipped bodies plus `unclear` is smaller. The actual
attachment-only and MIME fixtures show why it cannot answer reliably; no prompt
can recover absent source evidence. Git trailers alone do not retain exact prepared
text or compiled policy, so they cannot meet the user's replay request. Receipts
add only those inputs and apply provenance; no outcome database or scheduler.
Reusing the full agent for replay would be simpler but can execute tools and edit
canonical rules, violating the promised experiment boundary.

## Subplans

None for the admitted-document unit: evidence, CLI, receipts and research form one
end-to-end deliverable. Gmail admission is a separately planned follow-up, not a
partial phase claimed shipped here. It must settle pending-ID migration, manual
tracking versus new tracked-thread messages, ephemeral agent/log isolation and
source refetch/retry before any claim that irrelevant email stays off disk.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Intake strands attachment scope; binary read as text | Format fixtures | Proposed typed preparation | Current silent loss; explicit error/omission after change |
| PDF junk or unavailable extractor treated as no-match | Raw fixtures/probe | Proposed status mapping | No judgment for wholly unreadable item |
| Partial evidence silently clipped | Late-relevance fixture | Proposed omissions/budget status | Visible; policy controls partial best effort |
| Guide/candidate invalid or hypothesis omitted | None yet | Proposed overlay validation | Compiler error, no canonical edit |
| Duplicate category names or removed destination | Existing collision code | Proposed snapshot/ref mapping | Stale decision blocked before apply |
| Jev response/key/budget failure | Existing Jev tests | Reuse strict service; CLI operational error | Never a held semantic classification |
| Move succeeds but attachment/question/commit fails | None yet | Pending/incomplete receipt and explicit retry | No success until application/provenance complete |
| Sweep commits without triage trailers | None yet | Receipt completion commit | Provenance verified, null not treated as sufficient |
| Replay launches writing agent | None yet | Pure judgment replay, no fallback | Forbidden branch covered by fake-agent call count |
| Old evidence/original/model unavailable | None yet | Version and digest checks | Per-case unavailable; not passed or substituted |
| Correction overfits or labels itself confirmed | Paired synthetic probe only | Assertions and positive/negative replay guidance | Coverage/provenance visible; agent audit required |

No known silent critical gap remains in the proposed document contract. Tests
marked absent are implementation gates, not claims of existing handling.

## Agent-flow / user-flow edge cases

- ADDRESSED: wrong source layer — authoring guide and overlay command distinguish
  destination meanings from overarching best-effort/relevance policy.
- ADDRESSED: stale refs/hand edits/concurrent triage — snapshots, digests, per-item
  lock, explicit collision and stale errors; do not lock across research.
- ADDRESSED: invented reason — summary versus grounded agent reason is explicit;
  learning proposals cite evidence and never pretend probabilities explain content.
- ADDRESSED: no known-correct history — distinguish user-confirmed, agent-asserted
  and merely predicted outcomes; report weak regression coverage.
- ADDRESSED: partial move/commit — incomplete receipt and idempotent explicit retry.
- DEFERRED: Gmail admission/refresh/manual-track semantics, to the follow-up above.
- DEFERRED: numeric per-box threshold fitting, until independently labeled examples
  exist. Explicit unclear and policy-driven best effort work without it.

## NOT in scope

- Quick capture/chat routing: separate half of the anchor issue.
- Gmail or other connector materialization changes: ordinary agent transcript
  persistence prevents reusing this admitted-content fallback safely at admission.
- Automatic fitted thresholds, a general evaluation platform, database or scheduler.
- New OCR/vision provider, UI, destructive mail actions or model-family migration.
- Historical migration inventing receipts for old decisions: absence stays visible.
- Deployment/merge without the boxholder's finish request.

## Open design questions

No unresolved interface decision blocks the first document implementation chunk.
Approval is still required for the BIG CHANGE scope above. Exact evidence byte
budgets and extraction defaults will use existing service limits, exposed as
preparation omissions; they do not change semantics silently. Gmail questions
remain outside this unit. Existing broad rule conflicts cannot all be validated
syntactically; the research path and regression loop handle semantic ambiguity.

## Knowledge audits

Use bbx-context and update the agent-guide ledger when shipping prompt/doc changes.
Add and RUN audits on the isolated test box: `triage-cli-replay` (knows_directly:
replay has no application side effects), `triage-rule-repair` (knows_about: reads
triage-instructions.md, tests boundary neighbors), `triage-source-policy`
(knows_directly: guide versus landmark, best effort allowed), and
`triage-evidence-honesty` (knows_directly: missing versus no-match; no invented
confirmation or reason). Record pass/fail status. These are future audit gates;
this plan/corpus alone changes no loaded box-agent guidance.

## What will hold this after it ships

Use existing doctest tiers/fakes, not a new harness. Proposed filesystem/pure tests:
`test/core/triage-evidence.doctest.md` (intake/normalization/attachment moves,
scan artifact reuse, formats/omissions/cleanup),
`triage-instructions.doctest.md` (source hierarchy/overlay/IDs),
`triage-replay.doctest.md` (fixed evidence, repreparation, unavailable cases,
no fallback or mutations), `triage-provenance.doctest.md` (move/attachment/commit
failure recovery, answered-question correction (including missing channel), cross-process apply
and scoped trailers). Extend existing `triage.doctest.md` for
Jev routing/held questions/reasons and CLI-contract tests for JSON/errors/budgets.
A fake-agent multi-step test exercises correction, replay controls and application;
real knowledge audits test instruction discovery. Live synthetic probes remain
observations, never CI golden probabilities. No full suite in this worktree.

## Implementation order

1. Completed: household corpus regeneration, preparation, live baselines and
   instruction probe; this full plan pass and cross-model adjudication.
2. After size/scope approval: intake attachment continuity, evidence/instruction
   schemas and adapters with tests.
3. Judge/preview CLI and budgets; preserve legacy default and explicit Jev opt-in.
4. Receipts/apply/provenance and interruption tests; then discovery/replay commands.
5. Research/correction loop, docs/ledger and RUN knowledge audits.
6. Change-selected tests, typecheck, lint, doc checks, finished-change Claude review;
   commit in the worktree. Ship the complete unit only on a finish request.

## Rollout shape

The experiments are complete; production code is unchanged. Tests are authored
before the corresponding implementation chunks and all named paths must pass
before enabling Jev for an approved box. Existing agent triage remains default;
`--engine jev --dry-run` is the first real-box trial only when separately authorized.
Then explicit Jev application exercises receipts and recovery. The legacy path
remains available for rollback without erasing receipts. No existing card shape is
reinterpreted; new receipt JSON is versioned and validated, so no historical data
migration is proposed. The issue stays open for quick capture and Gmail admission.
