# Scan Guide Card — scanner priors via the guide system

**Status:** active — reviewed (codex cross-model, see `scan-guide-card.review.md`); implementation in flight on `worktree-scanner-ingest`.

Replace the bespoke `CLAUDE_SCANS.md` scanner-priors file with a
`config/scan.guide.card` guide card. The scan-import photo flow consumes the
COMPILED guide text in its per-page vision prompt; `CLAUDE_SCANS.md` becomes a
deprecated, warning-logged fallback. Scanner priors join the established
"theory of user" mechanism: beliefs carry confidence/source tags, and answered
scan questions accrete into the guide through the existing question
`learning:` contract.

This is a subplan of `docs/plans/scanner-ingest.md` (Track 6 reshaped).

## Stated preferences this plan trades against

- `docs/engineering-principles.md` — traced by number below:
  - #1 reuse-over-rebuild (the guide system replaces a bespoke file format),
  - validate-at-boundaries (guide cards are schema-validated; a raw markdown
    file is not),
  - resilient-not-silent (the fallback logs a deprecation warning; an invalid
    guide card is a hard error, not a silent skip).
- `callback-box/CLAUDE.md`: "Read before writing", "don't add features beyond
  what the task requires", "Keep source and docs generic — never hardcode
  personal names" (personal names stay in per-box config and
  `scratch/box-readiness/` drafts).
- `callback-box/code-style.md`: no default parameters, max 2 positional
  params, custom error classes, "Never silently ignore errors".
- Precedent: the guide system itself — `config/intake.guide.card` /
  `config/calendar.guide.card`, `DOMAIN_SEEDS`
  (`src/schemas/guide-templates.tsx:23`), and the triage guess-path
  `learning:` hook (`src/core/triage/routing.ts:117-127`).

## What already exists

All of this is reused; nothing is rebuilt.

- **Guide schema + parse + compile.** `src/schemas/guide-elements.tsx:103-113`
  (`guideFields`: `version`, `job-types`, `applies-to`, `triage-rules`,
  `default-action`, `actions`, `experiments`, `reactions`, `context-notes`).
  Per-rule evidence model at `guide-elements.tsx:58-64`: *"confidence:
  ConfidenceLevel.default('low'), source: BeliefSource.default('inferred')"*.
  `parseGuideCard(content)` (`src/schemas/guide-parse.tsx:71-83`) and
  `compileGuide(parsed, guideName)` (`src/schemas/guide-compile.tsx:15-95`)
  turn a card into action-only markdown (strips evidence metadata,
  hypothesis-confidence rules, concluded experiments, past context). Reused
  as-is — no compile changes.
- **Guide discovery + derived docs.** `compileConfigGuides`
  (`src/core/docs-gen/compile.ts:145-156`) flat-readdirs `config/` for
  `*.guide.card` and writes `docs/generated/<name>-guide.md`; a new
  `config/scan.guide.card` is picked up with zero code change, appears in the
  always-loaded guides index (`src/core/agent-guide/extensibility.ts:29-42`),
  and recompiles on edit via `refreshDerivedRules`
  (`src/core/refresh-derived-rules.ts:15-25`). Reused untouched.
- **Guide seeds.** `DOMAIN_SEEDS` (`src/schemas/guide-templates.tsx:23-179`)
  has `intake`, `calendar`, `drive`, `chat`; `createInitialGuideTemplate`
  falls back to a generic template for unknown names
  (`guide-templates.tsx:188-207`). Extended: this plan adds a `scan` seed.
- **The current mechanism being replaced.** `readScanContextFile`
  (`src/core/commands/scan-import-session.ts:131-143`) reads box-root
  `CLAUDE_SCANS.md` / `claude_scans.md`; `resolveBoxholderContext`
  (`scan-import-session.ts:149-164`) joins it with `--context` using
  `"\n\n---\n\n"`; `buildScanPrompt`
  (`src/core/commands/scan-import-gemini.ts:145-166`) prepends it as a
  `# Context from the boxholder` section with a "DO NOT invent
  identifications" guardrail. The photo flow is the only consumer
  (`scan-import.ts:220`); document mode never uses it. The guardrail,
  `--context` joining, and injection point are all kept; only the *source* of
  the file context changes.
- **Question `learning:` contract.** `QuestionLearning`
  (`src/schemas/question.ts:88-96`: `{ sink: "guide"|"briefing"|"personality",
  ref?, proposal }`); `cb answer` spawns a `question-followup-job` whose
  instructions record the outcome as a `source: user-stated` belief in the
  named sink (`src/schemas/question-followup-job.ts:26-68`). Precedent user:
  the triage guess path (`src/core/triage/routing.ts:117-127`). Reused: the
  three scan question emitters in `src/core/commands/scan-import-cards.ts`
  (`emitPhotoBundle`:77-143, `emitOrphanBackQuestion`:156-185,
  `emitUnsureQuestion`:187-214) gain a `learning:` field.
- **Retro loop.** `cb retro scan`/integrate already targets any
  `config/*.guide.card` generically (sink `guide` with `sinkRef`,
  `templates/procedures/process-retrospective.procedure.card:118-240`); a
  scan guide joins it for free. Untouched.
- **Migration machinery.** `src/core/migrations.ts` (append-only registry;
  script + procedure kinds; `docs/migrations.md`). NOT used — see
  Migration approach in Rollout shape for why this is a runbook instead.
- **Boxholder drafts.** `scratch/box-readiness/{estate,box-family}-CLAUDE_SCANS.md`
  (7 + 5 `[VERIFY]` markers, HTML-comment source-citation headers) and its
  `README.md` install table. Reshaped in place to guide-card form.

## Prior art (external)

Skip-with-rationale: every mechanism in play (guide cards, Zod card schemas,
question learning, Gemini prompt assembly) is internal to this repo; no
third-party library is asked to do anything new. The one external surface —
the Gemini vision call — is untouched: `buildScanPrompt` receives the same
`string | null` it does today. No search performed; there is no external
dependency to research.

## Tracks / scope

Single track (one mechanism swap), four commit-sized chunks.

**What:** scanner priors move from a raw box-root markdown file into
`config/scan.guide.card`; the photo flow compiles the guide in-memory at scan
time and injects the compiled text where raw `CLAUDE_SCANS.md` content goes
today.

**Why this needs to change:** `CLAUDE_SCANS.md` is a bespoke well-known
filename with no validation, no evidence model, and no learning loop.
Instructions everywhere else in the box live in cards; guide cards already
carry confidence/source-tagged beliefs and a revision loop. Answered scan
questions ("that's Kris, not Chris") currently evaporate — with a guide they
accrete as beliefs.

**Direction — the concrete shape:**

1. **Content conventions for a scan guide** (no schema change):
   - Disambiguation priors (people, vendors, places, handwriting facts) are
     `triage-rules` entries — they are the beliefs the learning loop must be
     able to upgrade/downgrade, so they need per-entry `confidence`/`source`
     (`guide-elements.tsx:58-64`). `action` is omitted (compile renders them
     as `- **Note**: <text>`, `guide-compile.tsx:34`). The evidence tags
     never reach the vision prompt — `compileGuide` strips them *by design*
     ("strips evidence metadata", `guide-compile.tsx:2-4`); the compiled doc
     is action-only, and confidence/source serve the revision loop, whose
     reader is the raw card. Do not "fix" this during implementation
     (codex review finding 2).
   - Narrative era/background context ("Duluth roughly 1979–1982") is
     `context-notes` (rendered under `## Context`,
     `guide-compile.tsx:80-92`).
   - `job-types` is omitted: the guide is consumed by a pipeline (by
     well-known path `config/scan.guide.card`), not glob-matched to job
     cards. `applies-to` is descriptive prose, same as the `calendar`/`drive`
     guides which also have no `job-types` (`guide-templates.tsx:70,117`).
     This answers "what do applies-to/job-types mean for a pipeline-consumed
     guide": job-types = auto-load routing for job agents (unused here);
     applies-to = the human/agent-legible description in the guides index.
2. **`scan` seed in `DOMAIN_SEEDS`** (`src/schemas/guide-templates.tsx`):
   `jobTypes: ""`; `appliesTo` describing scan-import photo extraction; one
   `source: "default"` triage rule restating the disambiguation-only rule;
   one `Ask User` action (create a question card in `box/questions/`);
   `defaultAction: Ask User`; initial experiment (priors reduce misread
   names/dates; record answered scan questions as rules). Created on demand
   via `cb create guide --name scan` — NOT added to `GUIDE_DOMAINS`
   auto-install (`src/core/box/defaults.ts:79`); an empty scan guide on every
   box is noise, and boxes without a scanner never need one.
3. **Extraction-side swap** (`scan-import-session.ts`): a new
   `resolveScanGuideContext(boxRoot)` returning
   `{ text: string; source: "guide" | "claude-scans" } | null`:
   - Read `config/scan.guide.card` (same `config/`-relative root as
     `compileConfigGuides`, `compile.ts:145`). If present, compile
     **in-memory at scan time** — never the possibly-stale
     `docs/generated/scan-guide.md` file. The resolver performs its own
     `splitCardContent` → `parseYaml` → `GuideObject.safeParse` chain (NOT
     `parseGuideCard`, whose `null` conflates no-frontmatter, YAML syntax
     error, and schema failure — codex finding 4), then
     `parseGuide` → `compileGuide(parsed, "scan")`.
   - If the card exists but any parse stage fails: throw
     `ScanGuideParseError` (custom class per code-style) naming the failed
     stage and the Zod issue summary, plus a pointer to
     `cb validate config/scan.guide.card`. Hard error, not fallback — the
     alternative (scan without priors) commits misread names *silently*, the
     exact failure priors exist to prevent; and reachability is near nil
     because `GuideSchema` is registered (`src/schemas/registry.ts:36`) so
     the per-box pre-commit `cb validate --staged` blocks invalid guide
     commits (resilient-not-silent; codex finding 3 dispositioned in the
     review file). Note `compileConfigGuides` itself warns-and-skips
     unparseable guides (`compile.ts:169`) — one more reason the resolver
     does not lean on the docs-gen path.
   - If no guide card: fall back to `readScanContextFile` (unchanged). When
     it hits, `resolveBoxholderContext` logs
     `Warning: CLAUDE_SCANS.md is deprecated — migrate to
     config/scan.guide.card (cb create guide --name scan; see
     docs/plans/scan-guide-card.md)` via `ctx.writeLine`.
   - If both exist: guide wins; log a warning that `CLAUDE_SCANS.md` is
     ignored and should be deleted.
   - `resolveBoxholderContext` keeps its signature; the `--context` join and
     the "Using boxholder context (...)" log line update their labels
     (`from scan guide` / `from CLAUDE_SCANS.md (deprecated)`).
   - `buildScanPrompt` and the wire contract (`docs/scan-upload-contract.md`)
     are untouched; scanner priors were never part of the upload protocol
     (confirmed: the contract doc never mentions them).
4. **Learning-loop hook** (`scan-import-cards.ts`): `emitPhotoBundle`'s
   review question — the identification-ambiguity case, where durable priors
   actually surface — attaches
   `learning: { sink: "guide", ref: "config/scan.guide.card", proposal: ... }`
   with a proposal scoped to *durable* identifications/patterns (recurring
   people, handwriting conventions), telling the followup agent to record
   them as triage-rule beliefs, creating the guide via
   `cb create guide --name scan` if it does not exist yet.
   `emitOrphanBackQuestion` and `emitUnsureQuestion` stay learning-free:
   their answers are one-off page dispositions (codex finding 7). This hook
   is the same prompt-level contract the triage guess path uses
   (`routing.ts:117-127`) — the followup-job instructions direct, not
   guarantee, the guide edit; no stronger machinery exists or is built (see
   NOT in scope).
5. **Drafts reshaped** (`scratch/box-readiness/`):
   `estate-CLAUDE_SCANS.md` → `estate-scan.guide.card`,
   `box-family-CLAUDE_SCANS.md` → `box-family-scan.guide.card`. Guide cards
   are pure frontmatter ("It is pure YAML frontmatter (no body)",
   `guide-elements.tsx:122`). Per-belief source citations move into each
   triage rule's schema-sanctioned `ref` field (`guide-elements.tsx:62` —
   survives reserialization; codex finding 8); every `[VERIFY]` marker is
   preserved verbatim inside rule/note text (field content also survives
   reserialization). Only the top-of-file provenance block becomes a YAML
   `#` comment — review-time only, and the README already instructs
   stripping it at install time. Boxholder-authored priors get
   `source: user-stated`; `[VERIFY]`-marked entries get
   `confidence: low` (still compiled — only `hypothesis` is stripped,
   `guide-compile.tsx:27-29`). README install table updated (target
   `config/scan.guide.card` in each box). Drafts are NOT installed into
   real boxes.

**Vocabulary lock-ins:** the guide name is `scan` (file
`config/scan.guide.card`, compiled `docs/generated/scan-guide.md`); the
learning ref string is `config/scan.guide.card`.

**First implementation chunk:** chunk 1 below (seed + resolver + swap +
doctests). No open questions inside it.

## Subplans

None. This plan is itself the subplan of `scanner-ingest.md` Track 6.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `config/scan.guide.card` present but invalid YAML/schema | new doctest | `ScanGuideParseError`, scan aborts with pointer to `cb validate` | clear |
| Guide present AND `CLAUDE_SCANS.md` present (transition state) | new doctest | guide wins; warning names the stale file | clear |
| Only `CLAUDE_SCANS.md` (unmigrated box) | new doctest | works as today + deprecation warning per run | clear |
| Neither present | new doctest (null) | scan runs without boxholder context (today's behavior) | clear (log line simply absent) |
| Guide exists but compiles to empty-ish text (fresh seed, no priors) | new doctest | compiled seed still carries the disambiguation rule + applies-to; injected as-is | clear |
| `docs/generated/scan-guide.md` stale vs card | n/a | avoided by design: scan compiles in-memory from the card | n/a |
| Followup agent answers a scan question but guide doesn't exist yet | covered by existing followup-job contract | `learning.proposal` instructs `cb create guide --name scan` first | clear |
| Agent revises the guide into a state that fails schema validation | existing: per-box pre-commit `cb validate --staged` blocks the commit | blocked at commit | clear |

No critical gaps: every row has handling and is loud.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — agent records a prior as an `experiments`
  observation instead of a `triage-rules` entry. ADDRESSED: the guide
  schema's embedded `instructions` (`guide-elements.tsx:120-136`) plus the
  scan seed's experiment `approach` name triage-rules as the belief carrier;
  compile still surfaces context-notes and rules alike, so a misfiled belief
  degrades to slightly-worse placement, not silence.
- **Stale ref** — `learning.ref` points at `config/scan.guide.card` before it
  exists. ADDRESSED: proposal text instructs creation
  (`cb create guide --name scan`); Direction §4.
- **Two agents touching the same card** — retro integrate and a
  question-followup both edit the scan guide. ADDRESSED by existing
  machinery: both are ordinary card edits behind per-box git commits and
  `cb validate`; same posture as intake/calendar guides today (no new
  concurrency surface introduced).
- **Hand-edit drift** — boxholder hand-edits the guide with a typo'd enum
  (`confidence: hgih`). ADDRESSED: schema validation catches it at
  `cb validate`/pre-commit; if it reaches scan time anyway,
  `ScanGuideParseError` aborts loudly rather than scanning without priors.
- **Fabricated free-form value** — the vision model invents identifications
  from priors. ADDRESSED: `buildScanPrompt`'s disambiguation-only guardrail
  is unchanged (`scan-import-gemini.ts:145-166`) and the seed's default
  triage rule restates it for agents.
- **Validation error UX** — `ScanGuideParseError` message names the file and
  the fix command. ADDRESSED (Direction §3).
- **Partial migration / transition state** — some boxes migrated, some not,
  during the fallback window. ADDRESSED: the fallback chain (guide →
  deprecated file → nothing) makes every state work and every deprecated
  state loud (Failure modes rows 2–3).

## NOT in scope

- **A `cb migrate` registry entry.** Mapping freeform `CLAUDE_SCANS.md` prose
  into structured triage-rules requires judgment (a ProcedureMigration), and
  exactly one known box (test1) has the file. A permanent append-only
  registry entry for a one-box bespoke file is disproportionate; a documented
  runbook (Rollout shape) covers it. Revisit only if prod boxes turn out to
  have the file.
- **Auto-installing `scan` in `GUIDE_DOMAINS` on `cb init`.** Boxes without a
  scanner never need it; empty guides are noise. On-demand
  `cb create guide --name scan` plus the deprecation warning's hint suffice.
- **Removing `readScanContextFile` / the fallback.** Stays until boxes
  migrate; removal is a follow-up once test1 (and any prod box) is migrated.
- **A scan-specific compile format.** `compileGuide` output (Triage Rules /
  Actions / Context headings) is serviceable in a vision prompt; a bespoke
  compiler would be a second format to maintain for cosmetic gain.
- **Retro-loop changes.** The integrate step already targets any guide card
  generically; nothing scan-specific to build.
- **`learning:` on orphan-back and unsure questions.** Their answers are
  one-off page dispositions; blanket learning would pollute the guide with
  non-durable facts (codex finding 7). Only the identification-ambiguity
  review question carries `learning:`.
- **Document mode.** It has no generative step at intake and never consumed
  `CLAUDE_SCANS.md` (`scanner-ingest.md:584-589`); unchanged.
- **Wire contract.** `docs/scan-upload-contract.md` never mentions scanner
  priors; untouched by design.
- **Backfilling doctests for the whole guide module.** There is a known gap
  (no direct doctests for `parseGuideCard`/`compileGuide`); this plan adds
  only the coverage its own codepaths need (the scan resolver doctest
  exercises parse+compile end-to-end, and a template check covers the scan
  seed). A full guide-module test backfill is separate work.

## Open design questions

None blocking. One lean recorded: if a future domain needs richer prior
structure (e.g. per-person fields), that's a schema conversation, not more
freight on `triage-rules` — deferred until a concrete need exists.

## Knowledge audits

Skip, with rationale: agents discover the scan guide mechanically — it
appears in the always-loaded guides index the moment it exists
(`compileConfigGuides` + `guidesSection`), and the pipeline consumes it by
path, not by agent recall. The one recall-shaped fact ("scan priors live in
the scan guide, not CLAUDE_SCANS.md") is carried by the deprecation warning
and the guides index, not memory. No `knowledge-audits.yaml` entry lands.

## Implementation order

1. **Chunk 1 — engine swap.** `scan` seed in `DOMAIN_SEEDS`;
   `resolveScanGuideContext` + `ScanGuideParseError` in
   `scan-import-session.ts`; `resolveBoxholderContext` rewired with
   deprecation/ignored warnings; doctest
   `test/core/scan-guide-context.doctest.md` covering the Failure-modes
   rows (guide wins, fallback+warning, invalid card error, neither, seed
   round-trips through parse+compile).
2. **Chunk 2 — learning hook.** `learning:` on `emitPhotoBundle` in
   `scan-import-cards.ts`; extend the existing scan-cards doctest coverage
   for the emitted question shape.
3. **Chunk 3 — drafts.** Reshape the two `scratch/box-readiness/` drafts into
   `.guide.card` form (all `[VERIFY]` markers and citations preserved);
   update that README's install table and wiring notes.
4. **Chunk 4 — docs.** Update `scanner-ingest.md` Track 6 (+ status line) to
   point here; migration runbook lives in this plan (below). No
   Docling-adjacent decision shifts, so no decisions-log change.

Chunks 2–4 are independent of each other; all depend on chunk 1's vocabulary.

## Rollout shape

- **Test posture:** `test/core/scan-guide-context.doctest.md` is the
  done-when for chunk 1 (each Failure-modes row is an example); chunk 2's
  done-when is the emitter doctest asserting the `learning:` block. Full
  `pnpm typecheck` / `pnpm lint` / `pnpm test` before each commit.
- **Knowledge audits:** none (see above).
- **Migration approach — runbook, hand-done by the boxholder (or an agent at
  their direction), per box with a `CLAUDE_SCANS.md`:**
  1. `cb create guide --name scan` (creates `config/scan.guide.card` from the
     seed).
  2. Move each priors bullet into `triage-rules` (people/vendors/places →
     one rule each, `source: user-stated`, `confidence: high` for
     boxholder-confirmed facts) and era narrative into `context-notes`.
  3. Delete `CLAUDE_SCANS.md` and, in test1's case, remove the scans-file
     `@`-import line from `content/CLAUDE.md:3` (general agent
     context now comes via the guides index / compiled
     `docs/generated/scan-guide.md`).
  4. Run a scan (or `cb scan-import` dry pass) and confirm the log line says
     `from scan guide` and no deprecation warning appears.
  - test1 is the only known holder; estate/box-family never had the file —
    they install the reshaped drafts directly as `config/scan.guide.card`
    after boxholder review (all `[VERIFY]` items resolved first).
- The plan ships as one unit on this worktree branch; merge to main is the
  boxholder's call.
