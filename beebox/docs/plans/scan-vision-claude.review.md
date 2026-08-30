# Plan Engineering Review — scan-vision-claude

Cross-model review of `scan-vision-claude.md`, run 2026-08-01 with `codex exec`
(read-only, monorepo root, high reasoning effort; prompt and raw output in
`scratch/codex-prompt.txt` / `scratch/codex-out.md`). Codex's findings are
quoted in condensed form; each is followed by the adjudication and what the
plan now does about it. The plan file was revised in place after this review;
section references below are to the revised plan.

## Findings (Codex, condensed) and adjudications

### 1. `batchSize: 3` unmeasured; split-retry destroys pairing — ACCEPTED (both halves)
Codex: splitting `[0,1,2]` produces `[0,1]` + `[2]` (`scan-import-helpers.ts:281`),
permanently separating pair (1,2); no other batch contains both; and 3-page
completeness is untested (`REPORT.md:554`).
**Adjudication: correct.** Two fixes adopted: (a) `splitAndRerun` becomes
overlap-preserving — a batch splits into halves sharing their boundary page,
exactly the property `planScanBatches` already guarantees between planned
batches; duplicate analyses for the shared page are what the reconciliation
layer exists to merge. (b) The untested-middle objection was answered by
measurement, not argument: `scratch/model-comparison/run-batch3.ts` ran
outline-mode at batchSize 3 over all 12 sample pages; results in the plan's
spike section and `results/sonnet-5-batch3.json`.

### 2. Three-value `classifyError` can't express the retry contract — ACCEPTED
Codex: today transient-exhausted does NOT split; only RECITATION/MAX_TOKENS
does; a bare classifier can't carry usage/cost of failed attempts either.
**Adjudication: correct.** The interface drops `classifyError`. Both backends
throw a typed `ScanVisionBatchError` carrying `retry: "transient" | "split" |
"fatal"`, plus `usage`/`costUsd` for the failed attempt, so the runner keeps
the policy (unchanged shape: 3 backoff attempts on transient; split only on
`"split"`; abort on `"fatal"`) and the accounting survives failures.

### 3. TIFF / oversized originals reach the model unconverted — ACCEPTED
Codex: `.tif` is an accepted scan input (`upload-helpers.ts:17`), photo mode
sends archive copies of originals (`scan-import.ts:188`), Claude's image
boundary documents JPEG/PNG/GIF/WebP only (`claude-chat-content.ts:25`), and
the report itself says Claude needs resize-before-send (`REPORT.md:246`).
**Adjudication: correct, and a latent Gemini-path risk too.** The Claude
backend now normalizes every page before send: `sharp` → JPEG, long edge
2000px, quality 88 (the exact recipe the measured `prepared/` images used).
The Gemini path is left as-is (out of scope) with an `issues/` entry for the
oversized-original risk there.

### 4. Module move creates a services↔core cycle — ACCEPTED
Codex: `services/scan-vision → core/commands/scan-import-gemini →
services/scan-vision` is a value cycle; the Gemini module names itself the
leaf (`scan-import-gemini.ts:1`).
**Adjudication: correct.** The move is cancelled. `scan-import-gemini.ts`
stays the leaf owning the schema/prompt/Gemini engine; `services/scan-vision*`
imports from it (one direction — precedent `claude-chat.ts:28` importing
`core/sdk-binary-path.js`).

### 5. `allowedTools: []` is not zero-tool isolation — ACCEPTED
Codex: `allowedTools` controls auto-approval; `tools: []` disables built-ins
(`sdk.d.ts:1369,1423`).
**Adjudication: correct.** The plan now specifies `tools: []`. (The
comparison scripts used `allowedTools: []` and got no tool use in practice,
but the contract-correct spelling is `tools`.)

### 6. Wire validation weaker than claimed — ACCEPTED (Claude side)
Codex: `rawScanAnalysisSchema` has unconstrained numbers; image cards accept
only rotation 0/90/180/270 (`image.tsx:36`) while emission writes any nonzero
value; slot invariant doesn't check numbering/uniqueness.
**Adjudication: correct; fixed on the Claude wire schema** (integers, rotation
literal-enum, `subject_bbox: z.null()`, slot numbering/uniqueness checked in
code as part of the invariant). The base Zod schema is left untightened for
the Gemini path — changing what Gemini responses must parse to is a behavior
change to the opt-in backend this plan is trying not to disturb; noted as a
possible follow-up.

### 7. Cost visibility undercounts failures; "commit context" claim false — ACCEPTED
**Adjudication: correct on both.** Failed attempts' usage/cost ride
`ScanVisionBatchError` and are accumulated; the commit-context sentence is
deleted — cost visibility is the command output (which the CLI/intake job
already surfaces), nothing card-persisted.

### 8. Fatal failures degrade into successful imports of placeholders — ACCEPTED
**Adjudication: correct.** `"fatal"` (auth, spawn failure, misconfiguration)
now aborts the run — clean, because analysis completes before any card is
staged. Transient-exhausted and split-exhausted batches keep today's
placeholder semantics (a one-batch blip must not discard 190 paid-for pages).

### 9. `pickAnalysis` doesn't implement its own mutuality comment — ACCEPTED
Codex: the code prefers any non-null pair claim then arbitrarily the second
batch (`scan-import-reconcile.ts:70`), not the mutual-claim preference its
comment describes (`:25`); smaller batches hit this more.
**Adjudication: correct and pre-existing; in scope now** because batchSize 3
multiplies overlap disagreements. The plan adds the mutual-claim preference to
`pickAnalysis` with a doctest.

### 10. Slots paid for, then discarded — PARTIALLY ACCEPTED
Codex: either derive downstream text/review questions from slots or cut them.
**Adjudication: half-adopted.** Slots stay out of the card schema (no
downstream shape change), but the Claude backend now folds per-slot legibility
into the existing review channel: any `partial`/`illegible` slot forces
`flag_for_review` with a flag_reason naming the slots needing review — the
report's "rows 3, 5, 8 need review" product win, through the existing
question card. Cutting the outline entirely was rejected: completeness came
from small batches, but the enumeration invariant is the only machine-checkable
guard that the model surveyed the whole page, and it held on every measured run.

### 11. Env/auth construction unsettled; binary-missing claim false — ACCEPTED
**Adjudication: correct.** `createClaudeScanVision({ boxRoot })` (named
params); env via `buildScriptEnv(boxRoot)`; `checkClaudeAuth()` covers auth
only — a missing/broken binary surfaces as a spawn error classified
`"fatal"` → aborted run, and the failure-modes table now says so.

### 12. "Capture image description uses Gemini" is stale — ACCEPTED
Codex: capture images are analyzed by Claude agents; the remaining direct
Gemini consumer is `audio-question.ts`; the health-check text is itself stale
(`health.ts:347`).
**Adjudication: correct.** Plan text fixed; the health check is reworded to
warn only when `BBX_SCAN_VISION=gemini` without a key, with audio-question
named as the other key consumer (verified at implementation time).

### Codex's "minimal credible version" — PARTIALLY REJECTED
Codex proposed dropping the `claude_code` preset system prompt (~15k tokens),
per-page calls with deterministic pairing in core, and shipping without
batching. Rejected parts: the preset is the measured configuration (every
experiment ran it; swapping it is an unmeasured behavior change to save cost
the boxholder already accepted — filed as a follow-up measurement in
`issues/`), and model-side pairing at batchSize 3 was retained because the
batch-3 measurement (finding 1) directly tested it rather than leaving it
argued-from-overlap.

## Things checked and found clean (by Codex)
No findings against: the bbox-null card path (`scan-import-cards.ts:251`),
the gated-doctest pattern reuse, the priors-injection reuse, the env-var
selection shape, or the NOT-in-scope list's Docling/session exclusions.

## Recommendation line
Recommendation: revise the plan before implementation because finding 1
(split-retry silently destroying front/back pairing at the proposed batch
size) is a silent-data-quality failure the plan presented as a safety
mechanism — unlike finding 12 (stale prose) or finding 5 (option spelling),
it would have shipped wrong cards with no error. All revisions above are
applied in `scan-vision-claude.md`; the batch-3 measurement replaced the
plan's argued-but-unmeasured core claim.
