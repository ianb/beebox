# Scan vision: Claude Sonnet default, Gemini opt-in

Switch `cb scan-import`'s photo-analysis backend from Gemini Flash (required
`GEMINI_KEY`) to Claude Sonnet 5 via the Claude Agent SDK, behind a
`ScanVision` service interface. The decision driver is operational
simplicity: Claude auth already exists everywhere callback-box runs (the
reactor and chat agents use `@anthropic-ai/claude-agent-sdk` on prod today),
while `GEMINI_KEY` is an extra credential per deployment. Gemini remains an
opt-in backend for deployments that hold the key. This decision is settled by
the boxholder; per-call cost/latency and the loss of usable `subject_bbox`
are accepted trades.

Evidence base: `scratch/model-comparison/REPORT.md` including its 2026-08-01
addendum (measured, one box, 12 images — sample-size caveats recorded there).
The numbers cited below are from that report.

## Stated preferences this plan trades against

- `callback-box/docs/engineering-principles.md` — especially
  validate-at-boundaries (model output is an untrusted boundary),
  resilient-not-silent (a misaligned batch must fail loudly, not
  misattach cards), and types-are-structure (one Zod schema as the
  source of truth for the wire shape).
- `callback-box/CLAUDE.md` — "Services — every external dependency is
  wrapped in a typed interface with real + fake implementations"; "Read
  before writing"; the box-generic rule (no personal names in shared
  text).
- `callback-box/src/services/CLAUDE.md` — the interface/real/fake pattern,
  named-params rule, `describe()` on fakes.
- `callback-box/code-style.md` — custom error classes; fail-closed
  ("bias toward strict"); no third hand-written schema (DRY on the wire
  shape, per the Track D.5 note in `scan-import-gemini.ts:14-22`).
- Precedents: `src/services/docling.ts` (service + fake + gated
  integration doctest), `src/core/agent/run.ts` (SDK invocation
  conventions), `src/core/agent/auth-preflight.ts` (auth preflight).

## What already exists

- `src/core/commands/scan-import-gemini.ts:23` — `rawScanAnalysisSchema`,
  the single source of truth for the per-page shape. **Reused** as the base
  for both backends' wire schemas.
- `scan-import-gemini.ts:50-68` — `ScanBatchMisalignedError` +
  `assertBatchAlignment` ("Require exactly one analysis per input page,
  indexed 0..N-1"). **Moved** to the service module and applied at the
  service boundary for both backends.
- `scan-import-gemini.ts:84-117` — `SCAN_PROMPT` and
  `buildScanPrompt(boxholderContext)`. **Reused verbatim** for both
  backends; the Claude backend appends a backend-specific note (index
  convention + outline procedure), exactly as the comparison scripts did
  (`scratch/model-comparison/run-outline.ts:15-43`).
- `scan-import-helpers.ts:54-72` — `planScanBatches` sliding-overlap
  planner. **Reused unchanged**; only the batch size becomes a
  per-backend value.
- `scan-import-helpers.ts:99-323` — `runScanBatches` retry/split runner +
  `translateIndices`. **Generalized**: the runner keeps its shape
  (transient backoff, split-retry, last-resort singleton) but drives it
  from a typed error classification the service provides instead of
  Gemini-specific string sniffing.
- `scan-import-reconcile.ts` — pair reconciliation, bundling, and the
  `makeMissingAnalysis` placeholder for failed pages. **Reused unchanged**
  (one string tweak: `"Gemini batch failed"` → backend-neutral).
- `scan-import-cards.ts:251-258` — `subject_bbox` is applied to the card
  only when present and length 4; `null` is skipped silently, and
  `rotation` is only written when non-zero. **Verified**: the bbox-null
  path needs no change — the Claude backend emitting `null` produces a
  card with no `subject-bbox` field, which downstream already tolerates
  (the Gemini path already emits `null` for full-page photos, per the
  prompt at `scan-import-gemini.ts:100`).
- `src/core/agent/run.ts:64-99` + `src/core/agent/auth-preflight.ts` —
  SDK invocation conventions (env via `buildScriptEnv` stripping
  `ANTHROPIC_API_KEY` to force subscription auth, `CLAUDECODE` unset,
  `pathToClaudeCodeExecutable` from `resolveClaudeCodeBinary()`), and
  `checkClaudeAuth()`/`ClaudeAuthError` with a 10-minute positive cache.
  **Reused**: the Claude backend follows the same env/binary conventions
  (via the same helpers), and scan-import calls `checkClaudeAuth()`
  before any files are staged. `src/services/claude-chat.ts:28` already
  imports `core/sdk-binary-path.js` from services, so the import
  direction is established precedent.
- `src/shared/model-ids.ts` — `MODEL_ID.sonnet = "claude-sonnet-5"`.
  **Reused** for the model id.
- `src/services/docling.ts:305-383` + `scan-import-document.ts:37,70`
  (`docling?: DoclingService`, `args.docling ?? createDoclingService()`) —
  the injection precedent for a service consumed by a scan command.
  **Copied as the shape** for `vision` injection into the photo flow.
- `test/core/commands/document-extract-integration.doctest.md` — the
  gated real-backend doctest pattern (probe → `skipReason` → ternary
  assertions with identical output on both paths). **Copied as the
  shape** for the gated real-Sonnet doctest.
- `src/core/commands/scan-guide-context.ts` +
  `scan-import-session.ts:138` `resolveBoxholderContext` — priors
  injection. **Unchanged**; the context string is a plain input to
  `buildScanPrompt` for both backends.

## Prior art (external)

- **Agent SDK structured output requires an object root and turns.**
  Measured in this repo, not just external: `outputFormat: {type:
  "json_schema"}` wants an object root (hence the `{"pages": [...]}`
  wrapper) and Sonnet 5 failed at `maxTurns: 1` with
  `error_max_turns`, succeeding at 4 (`REPORT.md` "Operational friction"
  §). The SDK docs do not document a minimum-turns requirement for
  structured output; the measured behavior is the authority here.
- **Zod v4 native JSON Schema export.** `zod@4.4.3` (already the
  project's version, `package.json:141`) ships `z.toJSONSchema()`
  (https://zod.dev/json-schema), which removes the need for a
  hand-written Claude-side schema. Gemini's schema dialect
  (`type: "ARRAY"`, `nullable:`) is not JSON Schema and stays
  hand-written, as the existing comment at `scan-import-gemini.ts:119-122`
  already records.
- **Vision-token pricing.** Sonnet 5 is in the high-resolution vision
  tier; a 1500×2000 image costs ~4–5k input tokens vs Gemini's ~325
  (`REPORT.md` cost §). No external workaround exists; this is the
  accepted cost trade.
- No named external pattern was found (or needed) for "per-page
  enumeration invariant" prompting; the outline-then-capture prompt and
  its `slot_count === slots.length` invariant are project-measured
  (`REPORT.md` Experiment A).

## The spike: file-path + Read tool vs inline image bytes

The boxholder's untested idea: instead of inlining image bytes, give the
per-page agent the image file path and let it `Read` the file itself,
with the affordance to re-Read or crop-and-re-Read when handwriting is
hard. Run as part of this design (`scratch/model-comparison/run-readfile.ts`,
results in `results/sonnet-5-readfile.json`), two pages, outline prompt,
`allowedTools: ["Read", "Bash"]`, vs the inline outline arm on the same
pages.

**Result (2026-08-01, n=2 pages, decisive against file-path): inline
attachment wins; the Claude backend inlines image bytes.**

- `s02-scan-back.jpg`: succeeded — 11/11 slots (inline outline arm: 10),
  but **10 tool calls** (repeated Read + Bash crops), **105.1 s** and
  **$0.467** vs the inline outline arm's ~21.7 s and ~$0.24 for the same
  page. Roughly 2× cost and 5× latency for a one-slot enumeration
  difference on a 10-token page.
- `s09-guestbook.jpg`: **failed outright** — the agent spent all 12
  allowed turns on Read/crop/re-Read tool calls and never emitted
  structured output; the SDK threw `error result: Reached maximum
  number of turns (12)`. The re-Read/crop affordance makes turn usage
  unbounded, and the failure mode is a lost page, not a degraded one.
- Boxholder's framing confirmed on the other two axes: caching
  residency is indeed a non-issue in stateless calls, and plumbing is
  *worse* on the file-path route (the box's archive dir must be exposed
  to the agent's filesystem sandbox, `allowedTools` must include Read —
  and to make the affordance real, Bash — which abandons the hermetic
  zero-tool call).

Decision: images are attached inline as base64 blocks, `allowedTools:
[]`. The crop-and-re-Read idea is not dead — it is the natural shape
for a *future escalation path* on pages a human flags as misread (one
page, generous turn budget, human-invoked) — but it is rejected as the
bulk mechanism. Recorded in `REPORT.md`'s postscript.

## Tracks / scope

Single track; the chunks below are commit boundaries, not ship
boundaries.

### Direction — the `ScanVision` service

New file `src/services/scan-vision.ts`:

```ts
export interface ScanVisionAnalyzeArgs {
  imagePaths: string[];
  boxholderContext: string | null;
  /** Last-resort retry of a single page (backend interprets: Gemini
   *  disables thinking; Claude is a no-op). */
  lastResort?: boolean | undefined;
}

export interface ScanVisionResult {
  analyses: RawScanAnalysis[]; // batch-relative, post-conditioned
  usage: BatchUsage | null;
  /** Dollars, when the backend reports it (Claude does; Gemini doesn't). */
  costUsd: number | null;
}

export type ScanVisionRetryClass = "transient" | "split" | "fatal";

export interface ScanVisionService {
  readonly backend: "claude" | "gemini" | "fake";
  /** Pages per model call the runner should plan with (>= 2). */
  readonly batchSize: number;
  analyzeBatch(args: ScanVisionAnalyzeArgs): Promise<ScanVisionResult>;
  /** How the runner should react to an analyzeBatch error. */
  classifyError(err: unknown): ScanVisionRetryClass;
}
```

- `RawScanAnalysis`, `rawScanAnalysisSchema`, `BatchUsage`,
  `ScanBatchMisalignedError`, and `assertBatchAlignment` move into
  `scan-vision.ts` (the service module becomes the leaf that
  `scan-import-gemini.ts` imports from — same direction the Track D.5
  consolidation pointed). Both implementations call
  `assertBatchAlignment` before returning: the post-condition lives at
  the service boundary, not per-backend.
- **`GeminiScanVision`** (`createGeminiScanVision({ apiKey })`) wraps the
  existing `analyzeScanBatchWithGemini` unchanged; `batchSize` 8 (the
  current default, `scan-import-helpers.ts:101`); `classifyError` ports
  `isTransientGeminiError` (→ `"transient"`) and the
  RECITATION/MAX_TOKENS check (→ `"split"`), else `"fatal"`.
- **`ClaudeScanVision`** (`createClaudeScanVision()`, no credentials —
  that is the point): per batch, one stateless `query()` call following
  the `run-outline.ts` / `core/agent/run.ts` conventions:
  - `model: MODEL_ID.sonnet`, `maxTurns: 8`, `allowedTools: []`,
    `settingSources: []`, `systemPrompt: {type: "preset", preset:
    "claude_code"}`, `permissionMode` unset,
    `pathToClaudeCodeExecutable: resolveClaudeCodeBinary()`, env from
    `buildScriptEnv(boxRoot?)`-equivalent with `CLAUDECODE` unset and
    `ANTHROPIC_API_KEY` stripped (subscription auth, exactly as
    `run.ts:189-190`). Images are attached inline as base64 blocks
    (see spike section for why inline wins).
  - Prompt = `buildScanPrompt(context)` + a Claude note: image position
    *i* is page index *i*; the outline-then-capture two-phase procedure
    (verbatim from `run-outline.ts:19-41`, generalized to N pages:
    slots are per page); `subject_bbox`: always return `null` (we do
    not use Claude's boxes — measured systematic y-offset, n=3).
  - `outputFormat: {type: "json_schema", schema}` where the schema is
    `z.toJSONSchema(z.object({ pages: z.array(claudeScanAnalysisSchema) }))`
    and `claudeScanAnalysisSchema = rawScanAnalysisSchema.extend({
    slot_count: z.number(), slots: z.array(slotSchema) })` — no third
    hand-written schema.
  - Response handling: `subtype !== "success"` (including
    `error_max_turns`) → throw `ClaudeScanVisionError` carrying the
    subtype. Parse `structured_output` with the Zod schema; check the
    outline invariant `slot_count === slots.length` per page (throw
    `ScanSlotInvariantError` — new, sibling of
    `ScanBatchMisalignedError`); force `subject_bbox = null` on every
    page regardless of what the model returned; strip `slot_count`/
    `slots` down to `RawScanAnalysis` (slots feed nothing downstream —
    the per-slot text is already concatenated into `text_blocks` by the
    prompt contract; keeping them out of the card path means no schema
    change downstream); then `assertBatchAlignment`.
  - Usage mapping: SDK usage → `BatchUsage` (`prompt` = input +
    cache-read + cache-write, `output`, `thinking: 0` — the SDK does
    not report a separate thinking count) and `costUsd =
    total_cost_usd`.
  - `classifyError`: SDK/API rate-limit or overload errors →
    `"transient"`; `ScanSlotInvariantError` and schema-parse failures →
    `"split"` (a smaller batch re-attempt is exactly the measured fix
    for outline degradation); everything else (auth, `error_max_turns`
    persisting) → `"fatal"`.
  - `batchSize: 3`. Rationale: per-page calls are the measured
    completeness fix, but pairing (`paired_with_index`) requires the
    photo and its back in the same call, so `batchSize` must be ≥ 2;
    sliding overlap of 1 (`planScanBatches`) already guarantees every
    adjacent pair (i, i+1) is co-visible in some batch for any size ≥ 2.
    3 halves the per-page share of the ~15k-token harness preamble vs
    2. The measured completeness failure was at 12 pages/call and the
    fix confirmed at 1; 3 is untested middle ground — the report calls
    3–4 "the obvious next measurement". The split-on-invariant retry
    (above) is the guard: if a 3-page call degrades, the runner splits
    it, and a singleton is the measured-good configuration. Batch size
    stays an internal constant (not config) until evidence says
    otherwise.
- **`createFakeScanVision(opts)`** — deterministic analyses derived from
  `imagePaths` (default: alternating photo/back with mutual pairing;
  overridable per-call script), `calls` array, `failWith`/`failTimes`
  knobs for retry-path tests, `describe()`. Follows
  `src/services/CLAUDE.md` named-params + describe rules.

### Backend selection

In `executeScanImport` (both photo entry points), replacing the two
`GEMINI_KEY` gates at `scan-import.ts:111-113,133-135`:

- `CB_SCAN_VISION` env var (direct read with a `// TODO(env-migration)`
  marker, matching `src/lib/env.ts:27-33`'s long-tail convention):
  - unset or `"claude"` → `createClaudeScanVision()`; run
    `checkClaudeAuth()` first (before any file staging) so an unauthed
    host fails with the existing actionable
    `CLAUDE_NOT_LOGGED_IN_MESSAGE` instead of mid-run.
  - `"gemini"` → requires `GEMINI_KEY` (or `SKE_GEMINI_API_KEY`); if
    absent, hard error naming both the var and the selection ("
    CB_SCAN_VISION=gemini but GEMINI_KEY is not set"). Fail closed —
    no silent fallback to Claude (bias-toward-strict; a silent
    fallback would hide a broken credential).
  - any other value → hard error listing the valid values.
- Why env var and not box config: the credential this selects between
  is itself env-resident and deployment-scoped (`GEMINI_KEY` rides
  `hub/child-env.ts:72` passthrough), so the selector belongs at the
  same altitude. A per-box override can be added later if a real
  deployment needs mixed backends.
- The hub passthrough allowlist gains `CB_SCAN_VISION`
  (`src/hub/child-env.ts`), or per-box `cb serve` children never see
  the selection.

### Runner generalization

`runScanBatches` (`scan-import-helpers.ts`) becomes backend-agnostic:

- Signature: `runScanBatches({ vision, imagePaths, boxholderContext,
  batchSize?, log })` — `batchSize` defaults to `vision.batchSize`;
  `apiKey`/`thinkingBudget` leave the signature (Gemini-only knobs move
  inside `GeminiScanVision`).
- The retry envelope keeps its exact shape (3 transient attempts with
  exponential backoff → split-or-fail → last-resort singleton) but
  branches on `vision.classifyError(err)` instead of
  `isTransientGeminiError` + `instanceof GeminiEmptyResponseError`.
  The last-resort singleton call passes `lastResort: true` (Gemini
  interprets as `thinkingBudget: 0`, preserving today's behavior at
  `scan-import-helpers.ts:256-279`).
- `translateIndices`, overlap reconciliation, and placeholder pages are
  untouched. `makeMissingAnalysis`'s flag reason becomes "Page analysis
  missing — vision batch failed".
- Per-batch cost/usage logging: the existing token line
  (`scan-import.ts:230-234`) extends with a cost line when
  `costUsd !== null` — this is the boxholder's cost visibility for the
  Claude path (per-run total dollars and tokens in the command output,
  which also lands in the capture-session commit context).

### scan-import consumption

- `runPhotoMode(ctx, args)` gains `vision: ScanVisionService` (injected;
  `executeScanImport` constructs the real one) and drops `apiKey`.
  Exported for the doctest, mirroring `runDocumentMode`'s
  `docling?` precedent (`scan-import-document.ts:37,70`).
- Log lines say the backend: `Analyzing N pages with
  ${vision.backend}...`.
- Rotation: unchanged mechanically (`rotation` applied only when
  non-zero, `scan-import-cards.ts:246`). Documented as best-effort on
  the Claude path: Sonnet's rotation was wrong on 2 pages one-shot,
  1/2 in outline mode, 2/2 sessioned — inconsistent where Gemini was
  consistent. Per-page/small-batch rotation quality is unmeasured. The
  consequence of a wrong rotation is a mis-rotated rendering with the
  original pixels intact (the field is advisory), so this is an
  accepted quality regression, noted in the plan postscript and the
  scan section of `docs/plans/scanner-ingest.md`.

### Config / deploy surface

- `GEMINI_KEY` stops being required anywhere: the two error strings in
  `scan-import.ts` disappear with the gates. Remaining surfaces are
  already optional-framed and stay: `.env.example:22-24` (comment
  reworded to "optional — only for CB_SCAN_VISION=gemini"),
  `health.ts:348-355` gemini-api-key warning (reworded: only warn when
  `CB_SCAN_VISION=gemini` and the key is missing; the capture
  image-description path still uses Gemini — check its key use before
  rewording, see Open questions), `hub/child-env.ts` passthrough
  (stays, + `CB_SCAN_VISION`), `env.ts` secret names (stay).
- `docs/plans/scanner-ingest.md` gets a model note (photo flow default
  = Claude Sonnet 5 via agent SDK; Gemini opt-in), and
  `scratch/model-comparison/REPORT.md` gets a one-line decision
  postscript. No Docling-adjacent decision shifts (document mode is
  untouched), so no new entry in
  `scanner-ingest-docling-decisions.md`.

## Failure modes

> **Critical gap (accepted, mitigated):** a 3-page Claude batch could
> under-transcribe *without* tripping the slot invariant (the invariant
> catches enumeration/transcription mismatch, not a too-small
> enumeration). No automated test can measure transcription
> completeness. Mitigation: the outline prompt's phase-1 enumeration is
> the measured fix for exactly this, and `flag_for_review` +
> per-review-question flow is the human backstop. Accepted with this
> sentence as the record.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Agent SDK unavailable (binary missing) or unauthed host | fake-backed doctest for the selection error; auth path exercised by existing `auth-preflight` tests | `checkClaudeAuth()` before staging → command fails with `CLAUDE_NOT_LOGGED_IN_MESSAGE`; `resolveClaudeCodeBinary()` null → same early failure path | Clear (actionable error, nothing staged) |
| Per-batch Claude call fails mid-run (rate limit / overload) | doctest: fake with `failTimes` exercises transient retry | 3 backoff attempts (existing runner), then split, then failed-page placeholders | Clear (log lines + `flag_for_review` unsure placeholders; import completes with partial analyses, matching today's Gemini semantics) |
| `error_max_turns` from the SDK | doctest via fake throwing a fatal-classified error | `subtype !== "success"` → typed error; classified fatal → placeholders | Clear (subtype in the log line) |
| Model returns misaligned batch (wrong count / indices) | doctest: fake returning a misaligned batch → `ScanBatchMisalignedError` | `assertBatchAlignment` at the service boundary (both backends) → classified split → smaller batches → worst case placeholders | Clear (loud error, never misattached cards) |
| Outline invariant broken (`slot_count !== slots.length`) | doctest: fake page with mismatched slots | `ScanSlotInvariantError` → split retry → singleton (measured-good config) → placeholders | Clear |
| Rotation regressions on Claude path | none possible (quality, not correctness) | field is advisory; original pixels intact; review questions carry the human backstop | Visible in rendering; documented as accepted |
| `subject_bbox` trusted by accident | doctest asserts Claude-path analyses always carry `subject_bbox: null` | forced `null` in `ClaudeScanVision` post-processing | Silent by design (no crop is the intended behavior; card simply lacks the field, `scan-import-cards.ts:251`) |
| Rate-limit draw on big sessions (200 pages ≈ several M tokens on subscription) | not testable | per-run token+cost log lines; batchSize 3 amortizes the preamble ~3× vs per-page | Clear (cost printed per run; boxholder sees the draw) |
| Gemini selected but key missing | doctest of the selection function | hard error at command start | Clear |
| `CB_SCAN_VISION` typo | doctest of the selection function | hard error listing valid values | Clear |
| Claude structured output missing/unparseable despite `success` | doctest: fake-shape test of the parse boundary | Zod `safeParse` → typed error → split/fail path | Clear |
| Box CLAUDE.md / settings leaking into the vision call | covered by construction | `settingSources: []`, `allowedTools: []` — hermetic call, unlike the reactor | Silent by design (documented in the service header) |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — not applicable: no new card fields or
  tags; the card shape is unchanged. ADDRESSED by construction.
- **Stale ref** — unchanged from today (question cards ref the attach
  scope; emission order unchanged). ADDRESSED (no change).
- **Two agents touching the same card** — unchanged; scan-import writes
  fresh cards in a fresh session scope. ADDRESSED (no change).
- **Hand-edit drift** — unchanged; cards validate on load. ADDRESSED
  (no change).
- **Fabricated free-form value** — improved: the measured reason to
  adopt outline mode is that Sonnet marks illegible slots instead of
  inventing names (Gemini fabricated `Donna Wilson`/`Don Sellert`;
  Sonnet 0 invented names across all arms). Per-slot legibility keeps
  honesty easy. ADDRESSED (design choice, REPORT.md Experiment A).
- **Validation error UX** — service errors surface in the command
  output with backend, batch range, and subtype; nothing is staged on
  preflight failure. ADDRESSED (Failure modes table).
- **Partial migration / transition state** — none: the switch is a
  runtime selection, not a data migration; existing cards are
  untouched and both backends emit the same `RawScanAnalysis`.
  ADDRESSED by construction.

## NOT in scope

- **Hybrid bulk-Gemini + escalate-to-Sonnet** (the addendum's "shape
  this actually argues for"): superseded by the boxholder's
  operational-simplicity decision; revisit only if Claude-path cost
  becomes a real problem.
- **`sharp.trim()` or any bbox fallback for the Claude path**: measured
  do-nothing on this box's images; no flatbed sample exists to justify
  it. Cropping simply doesn't happen on the Claude path.
- **Calibrating Sonnet's bbox y-offset**: n=3; not worth building on.
- **Batch-size tuning runs (3–4 per call measurement)**: the split
  retry bounds the risk; measure later if quality reports warrant.
- **Per-box backend selection**: env-level only, see Direction.
- **Capture/describe-images Gemini usage**: `describe-images-helpers`'
  other consumers (capture image description) keep Gemini; only
  scan-import's photo flow moves. The health-check rewording must not
  claim Gemini is unused.
- **Document mode / Docling**: untouched (this plan is the photo flow
  only).
- **Session/multi-turn Claude calls**: measured 8.6× token blowup;
  explicitly rejected.
- **Removing `scan-import-gemini.ts`**: the Gemini prompt/schema/call
  stay as the opt-in backend's engine.

## Open design questions

- **Health-check rewording** (small): `health.ts` gemini-api-key check
  says "capture image description will not work" — capture still uses
  `GEMINI_KEY` independently of scan-import, so the check likely stays
  as-is except no longer implying scan-import breakage. Settle during
  implementation by reading the capture path's key use; not a design
  blocker.
- **`maxTurns` value** (lean: 8): 4 sufficed in every experiment;
  8 gives headroom for the occasional schema-retry turn without letting
  a wedged call run long. Settled at 8 unless implementation shows
  otherwise.

## Knowledge audits

No new agent-facing concept lands: the scan guide, review questions,
and card shapes are unchanged, and backend selection is
operator-facing (env), not agent-facing. Skip-with-rationale: an agent
never needs to recall which vision backend analyzed a page; the cards
are the interface. (If a future change surfaces backend provenance on
cards, that change carries the audit.)

## Implementation order

1. **Service module** — `src/services/scan-vision.ts`: types moved from
   `scan-import-gemini.ts` (`rawScanAnalysisSchema`, `RawScanAnalysis`,
   `BatchUsage`, `ScanBatchMisalignedError`, `assertBatchAlignment`),
   `ScanVisionService` interface, `GeminiScanVision` wrapper,
   `createFakeScanVision`, + `test/services/scan-vision.doctest.md`.
   (Gemini impl continues to import from `scan-import-gemini.ts`.)
2. **Claude backend** — `ClaudeScanVision` (Zod-generated schema,
   outline note, post-conditions, bbox-null forcing, usage/cost
   mapping) + parse-boundary doctest with canned SDK-shaped fixtures.
3. **Runner + command** — generalize `runScanBatches`, thread `vision`
   through `runPhotoMode`, backend selection + `checkClaudeAuth`
   preflight, hub passthrough, log lines. End-to-end photo-flow doctest
   with the fake (the first one that exercises `runPhotoMode` at all —
   today's tests stop below the model call).
4. **Gated integration doctest** — real-Sonnet single small batch,
   gated on `resolveClaudeCodeBinary()` + `checkClaudeAuth()` probe,
   modeled on `document-extract-integration.doctest.md`'s
   skipReason/ternary pattern.
5. **Docs** — `scanner-ingest.md` model note, REPORT.md postscript,
   `.env.example`, health-check rewording, deploy notes.

Chunks 1→3 are strictly ordered; 4 and 5 depend on 3.

## Rollout shape

- Tests: doctests named per chunk above; the plan's done-when is
  `pnpm typecheck && pnpm lint && pnpm test` green with the new
  doctests, plus one manual real run of `cb scan-import` on a small
  image batch against the worktree test box (photo flow, Claude
  backend) verified by inspecting the emitted cards.
- No data migration: existing cards and sessions are untouched; the
  change is runtime behavior only.
- Ships as one unit when all chunks complete; merge to main is a
  separate boxholder signal (worktree discipline).
