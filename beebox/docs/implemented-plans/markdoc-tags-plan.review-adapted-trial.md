---
title: "Plan Engineering Review — Markdoc Tags Design"
status: implemented
workstream: unknown
issues: []
---
# Plan Engineering Review — Markdoc Tags Design

Trial run of an adapted plan-eng-review (no numeric scoring, no scope-gate, no cognitive-patterns checklist; citation-discipline gate ON; failure-modes per new codepath; agent-flow edge cases).

## What already exists

- **Markdoc parser + tag library** at `src/frontend/src/lib/markdoc-config.ts`. `quote` and `task` already live in `tags: { quote, task }`. Each new tag the plan proposes (`{% correction %}`, `{% source %}`, `{% ingredient %}`, `{% step %}`) will be a new entry in that same record. Plan reuses; no rebuild.
- **The `{% quote %}` precedent** — inline-vs-block discrimination via `node.inline ? "QuoteInline" : "QuoteBlock"`, plus the agent-guide entry at `src/core/agent-guide/quotes.ts`. The plan's "Minimum first step" sections explicitly mirror this shape. Reuses.
- **Card validation pipeline** — `bbx validate` PostToolUse hook + pre-commit hook (per CLAUDE.md). Markdoc's `Markdoc.validate(ast, config)` is what catches misuse at parse time (per the comment in `markdoc-config.ts` lines 22-23). Any new tag attribute schema gets validation automatically. Plan implicitly reuses; doesn't call this out.
- **`compileBriefing()`** at `src/schemas/briefing.tsx:129` — already a hand-written renderer per the plan's own description (`briefing.tsx:107`). Track 2 extends it to be bilingual rather than replacing it. Reuses.
- **Per-schema `instructions`** field on `cardSchema()` (used in `briefing.tsx:52`, `recipe.tsx:124`) — already the channel for agent guidance. Plan's "2-3 sentences in the relevant schema's `instructions`" lands directly here. Reuses.
- **Legacy recipe XML schema** (`recipe.tsx`) — Track 1 replaces wholesale rather than evolving. Plan acknowledges this is the largest scope and orders it last; fine.

## Stated preferences this plan trades against

Drawn from `CLAUDE.md` and `code-style.md`; referenced by name in findings below.

- **`{% quote %}` precedent: minimum first step, dogfood, then tweak.** The plan invokes this explicitly in its preamble ("following the `{% quote %}` tag that shipped first ... sized to be implemented small, dogfooded, then tweaked").
- **"Read before writing. Don't guess file formats"** (CLAUDE.md line 101) — agents writing tags need enough schema-level guidance that they don't invent attribute names.
- **Validation-on-load** (CLAUDE.md lines 47-52) — cards validate on every Edit/Write. Tag misuse must produce a useful agent-facing error from the existing hook.
- **No optional chaining; no default parameters; max 2 positional params; no `any`** (code-style.md lines 36-45). Renderers and compile-function changes inherit these.
- **"Three similar lines is better than a premature abstraction"** (referenced in the brief). Bilingual `compileBriefing()` is exactly the kind of place where premature abstraction is tempting.
- **Universal vocabulary, single shape per tag name** (the plan's own constraint, lines 9-12) — itself a stated preference being asserted by this doc.

## Failure modes

One realistic prod failure per new codepath, with: test exists? handling exists? clear-or-silent?

### `{% correction %}` (Track 2)
- **Failure:** Agent writes `{% correction %}don't archive{% /correction %}` with no `test=`. Old frontmatter form required `test` to be optional; new form should match.
- **Test exists?** No — plan doesn't mention tests beyond "audit with one knowledge entry."
- **Handling exists?** Implicit via Markdoc attribute schema if `test` is marked optional.
- **Clear-or-silent?** Clear at parse time *if* attribute schema is declared. **Not a gap if declared, gap if forgotten.**

### Bilingual `compileBriefing()` (Track 2)
- **Failure:** A briefing has both a frontmatter `corrections:` array AND a body `{% correction %}` tag (e.g., partway through migration; or an agent appends to body without removing frontmatter). Output duplicates the same instruction twice, or worse, presents two contradictory corrections.
- **Test exists?** No.
- **Handling exists?** Not specified — the plan's open question #4 acknowledges bilingualism but doesn't address conflict/dedup.
- **Clear-or-silent?** **Silent.** Agents reading the compiled briefing see duplicates with no signal. **Critical gap.**

### `{% source %}` (Track 3)
- **Failure:** `ref` points to a card that has since been moved or deleted. The rendered citation chip still appears; clicking goes nowhere (or 404s).
- **Test exists?** No.
- **Handling exists?** Plan describes the renderer (`[→ Voice 2026-03-15]` chip, `onNavigate`) but not stale-ref behavior.
- **Clear-or-silent?** Silent in the source; the chip just fails on click. Likely acceptable for dogfooding but worth naming.

### `{% ingredient %}` / `{% step %}` (Track 1)
- **Failure:** A migrated recipe has a `{% step %}` body that references `{% ingredient %}garlic{% /ingredient %}` where the ingredient isn't defined elsewhere in the document (no list-form `{% ingredient %}` for "garlic"). Frontend scaling math has nothing to multiply.
- **Test exists?** No.
- **Handling exists?** Open question #2 flags scaling math as "confirm before implementing." No specified behavior for un-listed inline ingredients.
- **Clear-or-silent?** Silent — scaling either silently ignores the inline mention or treats it as a separate ingredient with no amount.

### Universal `{% source %}` accept-list (Track 3)
- **Failure:** A schema that doesn't want `{% source %}` (none currently expected) gets one anyway because "universal" means default-allowed. No per-schema opt-out exists yet.
- **Test exists?** N/A — no schema currently wants to opt out.
- **Handling exists?** The vocabulary constraint section (lines 14-18) mentions accept-lists as a concept, but no mechanism is described. Deferred implicitly.
- **Clear-or-silent?** Silent. Plan-level deferral is reasonable; flagged so it's not forgotten.

## Agent-flow edge cases

- **Agent picks wrong tag (`{% quote %}` vs `{% source %}`):** ADDRESSED. Section "Composition with `{% quote %}`" (lines 202-220) explicitly distinguishes them and shows nesting. The agent-guide pointer ("2-3-sentence pointer added to the agent guide's 'Direct Quotes' section") covers reinforcement.
- **Stale `ref`:** GAP. Not addressed. See failure modes above.
- **Agent fabricates `as` value:** ADDRESSED in spirit by the "free-form natural language" framing (lines 182-199) which explicitly encourages honest description over enum-fitting. Whether agents will actually be honest is empirical, but the design names the risk.
- **Two agents edit the same briefing/recipe and pick different forms:** GAP for briefing. The bilingual `compileBriefing` makes this likely (one agent adds to frontmatter `corrections:`, another adds `{% correction %}` to body), and the doc doesn't say how the compiled output reconciles them.
- **Bilingual `compileBriefing` reading both old and new — does it dedupe?** GAP. Open question #4 punts on sunset but doesn't ask about conflict semantics during the bilingual window. See failure modes.
- **User hand-edits with slightly wrong tag form (lowercase attrs, missing space):** DEFERRED. The Markdoc validator handles this; the plan implicitly relies on it. Worth confirming the validation hook surfaces a useful message — currently `bbx validate --hook` exits 2 with stderr, which is fine in principle. Not a plan-level gap but worth a sentence about the user-facing message for a malformed new-vocabulary tag.
- **Markdoc validation error surface:** DEFERRED. No mention. The existing hook fires, but new tags add new error vocabulary that may or may not read well.

## Findings

### Bilingual `compileBriefing` has no conflict/dedup semantics
**Location in plan:** `docs/implemented-plans/markdoc-tags-plan.md:146-150` ("Compile-briefing transition")
**Citation:** *"Keep `compileBriefing()` bilingual: parse old frontmatter forms AND scan body for new tags. Old briefings keep working without migration. New briefings (and edits) gradually move to the body form. No forced migration script in the first pass."*
**Issue:** The plan doesn't say what happens when a single briefing has both forms simultaneously. During the migration window — which open question #4 leaves indefinite — partial migrations and parallel edits will produce this state.
**Why it matters:** Compiled briefing is what agents see. Duplicate corrections waste context; conflicting corrections silently mislead. Per the failure-modes table, this is the one **silent + no test + no handling** combination in the plan.
**Suggested action:** Add a one-sentence rule to Track 2: e.g., "if both forms present, body tags win and frontmatter entries are ignored" (or the inverse). Whichever wins, name it. One doctest that exercises both-forms-present and asserts the chosen behavior.
**Traces to preference:** Validation-on-load + the "Read before writing" principle — the compiled briefing IS the agent's read of the box, and silently double-emitting corrupts that read.

### `{% step %}` numbering and ingredient-scaling are flagged but not decided
**Location in plan:** `docs/implemented-plans/markdoc-tags-plan.md:252-260` (open questions 1 and 2)
**Citation:** *"Auto-number or expect the writer to manage prose like 'First, …'? Lean: auto-number on render, no numbering in source"* and *"The scaling math (`amount × ratio`) currently lives in the frontend. Same code can read `amount=` attributes from Markdoc tags. Confirm before implementing."*
**Issue:** Both are listed as "open" but Track 1's "Minimum first step" says "Migrate just `{% ingredient %}` and `{% step %}`" — the smallest viable migration touches exactly these two undecided questions.
**Why it matters:** "Confirm before implementing" is a reasonable hedge, but the design hands off the actual confirmation work to implementation time, which couples plan-uncertainty with code-uncertainty. The `{% quote %}` precedent (one tag, one renderer, one agent-guide entry, ship) worked because every shape decision was settled at design time.
**Suggested action:** Either land lean #1 (auto-number on render) and lean from #2 (read `amount` attribute, reuse existing scaling) as actual decisions in the plan, or scope Track 1's first step down to just `{% ingredient %}` (which has the scaling dependency but skips the numbering question entirely).
**Traces to preference:** The `{% quote %}` precedent — small, fully-decided, ship-ready. Open questions inside the "minimum first step" violate this.

### `{% source %}` renderer omits stale-ref behavior
**Location in plan:** `docs/implemented-plans/markdoc-tags-plan.md:236-244` ("Renderer")
**Citation:** *"Inline use: a small bracketed citation marker after the wrapped span, e.g. `[→ Voice 2026-03-15]`. Clicking navigates via `onNavigate`."*
**Issue:** The renderer assumes `ref` resolves. Open question #3 covers the *vague-ref* case (no path known) but not the *invalid-ref* case (path was valid, now isn't).
**Why it matters:** Source refs into `box/inbox/...` will go stale routinely as cards are processed and moved to `store/archive/`. Without a stated behavior, the chip will silently 404 on click during normal box operation.
**Suggested action:** One sentence — either "stale refs render as the chip but click is a noop with a console warning" or "broken refs surface visually with a strikethrough." Doesn't need to be elaborate; just named.
**Traces to preference:** Transparency / "Never silently ignore errors" (code-style.md line 30). A click that does nothing is a silent failure.

### "Universal" `{% source %}` has no accept-list mechanism
**Location in plan:** `docs/implemented-plans/markdoc-tags-plan.md:172-175`
**Citation:** *"Add `{% source %}` as a universal provenance tag. Universal = available in every schema's body (subject to per-schema accept-lists if any want to restrict it, which I don't currently expect)."*
**Issue:** "Subject to per-schema accept-lists" gestures at a mechanism that doesn't exist in the codebase yet (the current Markdoc config in `src/frontend/src/lib/markdoc-config.ts` is a single global `tags:` record; no per-schema filter). The vocabulary-constraint section (lines 14-18) makes the same gesture.
**Why it matters:** Not a near-term problem — the plan correctly notes no schema currently wants to opt out. But the design doc asserts accept-lists as part of the model on lines 14-18 without acknowledging they're not implemented. A future reader (or agent) will look for the mechanism and not find it.
**Suggested action:** Add a half-sentence: "accept-lists are not yet implemented in the Markdoc config; first restriction triggers building them."
**Traces to preference:** "Don't add features... beyond what the task requires." The plan is right not to build accept-lists now; it just needs to say so out loud.

### `{% correction %}` `test` attribute parallel to `{% source %}` `as` is observed but not used
**Location in plan:** `docs/implemented-plans/markdoc-tags-plan.md:272-273` (open question 5)
**Citation:** *"`{% correction %}`'s `test` attribute as natural language. Mirrors the `as` attribute on `{% source %}`. Worth flagging the parallel."*
**Issue:** The parallel is noted then dropped. If both are intentionally free-form natural language, that's a small but real piece of vocabulary policy ("attribute values are prose, not enums, by default") worth lifting out of "open questions" into a stated convention.
**Why it matters:** Minor, but cheap to fix and it tightens the universal-vocabulary section. Without it, the next tag proposer rederives the question.
**Suggested action:** One line in the "Vocabulary constraint" section: "Attribute values default to natural-language prose; promotion to enum is opt-in after dogfooding."
**Traces to preference:** Universal vocabulary, single shape per tag — extending that to "single attribute-value convention" is the same family.

## NOT in scope (verified)

- **Migration script for old briefings** — `markdoc-tags-plan.md:148-150`. Sensible. Dogfooding bilingual is the cheapest way to learn.
- **Sunsetting bilingual `compileBriefing`** — open question #4. Sensible to defer; the bilingual-conflict semantics finding above is the one piece that *can't* wait.
- **`{% substitution %}`, `{% subrecipe %}`, `{% recipe-section %}`, `{% yield %}`** — Track 1 minimum-first-step (line 89-90). Sensible — they're locked at shape level but not implemented until the smaller pair dogfoods.
- **Renderer density tuning for `{% source %}`** — open question #6. Sensible to dogfood first.
- **`{% source %}` accept-lists** — line 174. Sensible (no current need); see finding above about naming the deferral.
- **Possible missing deferral: a doctest plan.** Tracks 1-3 each say "audit with one knowledge entry" but make no mention of test files under `test/`. Given the validation-on-load contract and the doctest-primary culture (CLAUDE.md lines 19-22), at least one doctest per track would be the norm. Either the plan should defer tests explicitly ("dogfooding precedes tests") or commit to one doctest per track. Currently silent — the silence reads as oversight, not deferral.

## Things I checked and found clean

- Universal-vocabulary constraint is well-stated and the "typed children" exception is precise.
- Tag-naming collision analysis for `{% source %}` vs `{% quote from=... %}` (lines 222-228) is real and well-handled.
- Track ordering (correction → source → ingredient/step) matches the "smallest surface first" instinct.
- The `{% source %}` + `{% quote %}` composition example (lines 212-216) reads naturally and validates the two-axes design.
- Track 1's framing of "recipe is fundamentally a natural-language document" is the right justification for the schema replacement scope.
- Frontmatter-shrinks-to-identity pattern is consistent between Track 1 and Track 2.
- Free-form `as` over enum is the right call and the doc defends it well.
