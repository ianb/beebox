# Plan Engineering Review — scan-guide-card (codex cross-model, 2026-08-01)

Reviewer: OpenAI codex CLI 0.144.4, `-m gpt-5.5`, read-only, fenced read-list
(plan + the 14 source files it cites). Output:
`scratch/codex-out-scan-guide.md`. Eight findings, dispositions below.
Plan edits from accepted findings are already folded into
`scan-guide-card.md`.

## Findings and dispositions

### 1. "This is no longer Track 6's stated problem — cut back to content-only"
Codex: Track 6 was "per-box content, no engine code"
(`scanner-ingest.md:510`); the minimal version keeps `readScanContextFile`
and just writes the priors files.
**Disposition: rejected — scope judgment already made by the boxholder.**
The decided direction is precisely to retire the bespoke file in favor of the
guide system (learning-loop fit is the point). The valid kernel — Track 6's
framing is now stale — is handled by chunk 4 (scanner-ingest.md update).

### 2. "triage-rules is a leaky carrier: compileGuide strips the evidence model"
Codex: `compileGuide` renders low/default/user-stated rules identically as
`- **Note**: ...` (`guide-compile.tsx:26-35`), so the evidence model never
reaches the vision prompt.
**Disposition: accepted as a clarification, not a design change.** The plan
never intended evidence tags to reach the vision prompt: the compiled doc is
action-only *by design* ("strips evidence metadata", `guide-compile.tsx:2-4`);
confidence/source serve the revision loop, whose reader is the raw card. The
plan's Direction §1 now states this explicitly so no implementer "fixes" it.

### 3. "Hard-erroring scan intake on an invalid optional guide is brittle"
Codex: absent context is valid today; a typo in optional priors should not
block capture-session creation.
**Disposition: rejected, rationale recorded.** House bias is strict/fail-
closed. The alternative — scan-without-priors on a broken card — commits
misread names into cards *silently*, the exact failure priors exist to
prevent; the loud abort is recoverable (fix the card, re-run). Reachability
is also near nil: guide cards are schema-validated at commit by the per-box
pre-commit hook (verified: `GuideSchema` is in the registry,
`src/schemas/registry.ts:36`, so `cb validate --staged` covers it), so an
invalid card at scan time means validation was bypassed — a broken invariant,
which per code-style gets a hard failure.

### 4. "parseGuideCard's null cannot support the promised error UX"
Codex: `parseGuideCard` returns `null` for no-frontmatter, YAML syntax
errors, and schema failures alike (`guide-parse.tsx:71-83`) — the plan's
`ScanGuideParseError` would be generic.
**Disposition: accepted.** Direction §3 now specifies the resolver performs
its own `splitCardContent` → `parseYaml` → `GuideObject.safeParse` chain so
`ScanGuideParseError` carries the stage and the Zod issue summary, instead of
calling `parseGuideCard`.

### 5. "'Validation catches it' unverified; compileConfigGuides warns-and-skips"
**Disposition: accepted as verify-and-cite.** Codex's fenced read-list did
not include the registry; the claim is real — `GuideSchema` is registered
(`src/schemas/registry.ts:36`) and every registered schema validates through
`cb validate` / the per-box pre-commit hook. The plan now cites the registry
line. Codex is right that `compileConfigGuides` itself only warns-and-skips
unparseable guides (`compile.ts:169`) — which is exactly why the scan
resolver does not rely on the docs-gen path.

### 6. "The learning loop is prose (agent compliance), not machinery"
**Disposition: accepted as a wording fix.** The plan now says the hook is
the same prompt-level contract the triage guess path uses
(`routing.ts:117-127`) — the followup-job instructions direct, not guarantee,
the guide edit. That is the established mechanism; no stronger machinery
exists to reuse, and building one is out of scope (arrange context, don't
automate judgment).

### 7. "Blanket learning on all three scan questions will over-learn"
**Disposition: accepted — design change.** `learning:` now attaches only to
`emitPhotoBundle`'s review question (the identification-ambiguity case, where
durable priors actually surface), with proposal text scoping recording to
durable identifications/patterns. `emitOrphanBackQuestion` and
`emitUnsureQuestion` stay learning-free: their answers are one-off page
dispositions. Recorded in NOT-in-scope.

### 8. "YAML comments are not durable; put citations in ref/text fields"
**Disposition: accepted.** Per-belief source citations in the reshaped
drafts move into the schema-sanctioned `ref` field on each triage rule
(`guide-elements.tsx:62` — survives reserialization); `[VERIFY]` markers
stay in field text (also survives). Only the top-of-file provenance block
remains a YAML comment, and the README already instructs stripping it at
install time.

## Prior art (external) — verified
The plan skips external search with rationale (all-internal mechanisms);
codex did not contest it. Confirmed adequate.

## Things checked and found clean (by codex, confirmed)
Citations in the plan's "What already exists" section (guide fields, compile
behavior, seed shapes, question emitters, discovery readdir) all resolved
against source; no incorrect citations were flagged.

## Recommendation
Recommendation: implement with findings 4 and 7 applied first — the resolver
must do its own parse chain (finding 4) or the promised error UX is
unimplementable, which outranks the scope debate in finding 1 (a boxholder
decision codex re-litigated) and the strictness debate in finding 3 (house
bias, rationale recorded).

My read: findings 4, 7, 8 were real and are applied; 2, 5, 6 were valid
prompts to sharpen claims (applied as clarifications); 1 and 3 are
cross-model scope/policy disagreements resolved against codex per the
boxholder's decided direction and the strict-bias convention.
