# Plan Engineering Review — Markdoc Tags Design

Review of `markdoc-tags-design.md` following the `cb-plan-review` skill's
review-mode template. Findings cite `file:line` in the plan and in
source. Trace each to a stated preference in CLAUDE.md / CODE-STYLE.md
or to the `{% quote %}` precedent the plan invokes.

## What already exists

- **Markdoc tag library** at `src/frontend/src/lib/markdoc-config.ts:79`:
  `tags: { quote, task }`. Every new tag the plan proposes is a new
  entry in that same object; plan reuses, doesn't rebuild.
- **The `{% quote %}` precedent** — inline/block split via
  `node.inline ? "QuoteInline" : "QuoteBlock"` at
  `src/frontend/src/lib/markdoc-config.ts:34`, plus the agent guide at
  `src/core/agent-guide/quotes.ts`. The plan's "Minimum first step"
  shape mirrors this. Reuse path is obvious; plan does not name the
  guide file explicitly.
- **`compileBriefing()`** at `src/schemas/briefing.tsx:129` — a
  hand-written renderer over the YAML fields. Track 2 rewrites it as a
  server-side Markdoc-tree walker. Plan calls it "rewritten," not
  reused — appropriate given the source-of-truth move.
- **`extractRefs()`** (cardworks) at
  `node_modules/.vite/deps/cardworks.js:25532` (synced from
  `cardworks`) walks **structured fields only** (`walkForRefs(value,
  ...)` over arrays/objects, keys `ref`/`refs`). Body strings are
  never scanned. Called from `src/core/card-lint.ts:104`. Track 4
  extends this — but the extension lives in cardworks, not in
  callback-box. Plan does not say which side of the symlink owns the
  change.
- **Move-time ref rewrite** at `src/core/commands/move.ts:132` —
  cardworks' built-in `loader.move()` rewrites frontmatter refs, and
  `move.ts:209-238` adds a second pass that does a crude **substring
  replace** of the old attach path in every other card's content. The
  body is already touched by substring; Track 4's "extend the rewrite
  pass to update body-tag `ref=` attributes" needs to clarify whether
  it parses Markdoc (correct) or piggybacks on the existing substring
  approach (matches today's style but fragile).
- **Per-schema `instructions`** field on `cardSchema()` (used in
  `briefing.tsx:52`, `recipe.tsx:124`) — already the channel for agent
  guidance. Plan's "2-3 sentences in the relevant schema's
  `instructions`" lands here. Reuses.
- **Legacy XML recipe schema** at `src/schemas/recipe.tsx:111` —
  Track 1 replaces wholesale. Plan acknowledges this is the largest
  scope and orders it last; consistent with smallest-first.
- **Sibling source-bearing schemas** —
  `src/schemas/memo.ts:40` (`source` string), `src/schemas/record.tsx:53`
  (`sources: array of {ref, time?, note?}`),
  `src/schemas/feedback.tsx:44` (`source: text|voice`). Plan's
  description at `markdoc-tags-design.md:190-193` is accurate.

## Stated preferences this plan trades against

- **`{% quote %}` precedent: minimum first step, dogfood, then tweak.**
  Plan invokes this explicitly at `markdoc-tags-design.md:3-6`.
- **"Read before writing. Don't guess file formats"** — `callback-box/CLAUDE.md`:
  *"Read before writing. Don't guess file formats, XML structures, or
  API shapes."* Tag-authoring agents need enough schema-level guidance
  that they don't invent attribute names.
- **Validation-on-load** — `callback-box/CLAUDE.md`:
  *"Cards validate on load. `cb validate` checks all cards..."* Tag
  misuse must produce a useful agent-facing error via the existing
  PostToolUse hook and `Markdoc.validate(ast, config)` (per the
  comment at `src/frontend/src/lib/markdoc-config.ts:21-22`).
- **No optional chaining, no default parameters, max 2 positional
  params, no `any`** — `callback-box/CODE-STYLE.md:36-45`. Renderers
  and the new server-side Markdoc→markdown emitter inherit these.
- **"Don't add features beyond what the task requires"** — Plan's own
  framing ("each track sized to be implemented small, dogfooded, then
  tweaked").
- **Single repo-wide Markdoc vocabulary, one shape per tag name** —
  `markdoc-tags-design.md:7-13`. Self-asserted, load-bearing across
  every track.

## Failure modes

One realistic failure per new codepath, with: test exists? handling
exists? clear-or-silent?

### `{% source %}` with `ref` pointing at a missing target
- **Failure:** `ref="box/inbox/Voice_2026-03-15.memo.card"` resolves to
  nothing (archived, renamed, never existed).
- **Test exists?** No.
- **Handling exists?** Plan addresses it
  (`markdoc-tags-design.md:273-274`): "chip still renders but click is
  a noop with a console warning."
- **Clear-or-silent?** **Silent in the agent's compiled view.** The
  PostToolUse hook validates *attributes*, not ref existence; `cb
  validate` warns on broken frontmatter refs but Track 4 only commits
  to extending `extractRefs` for body tags — and even there the same
  policy is warning-not-error (`card-lint.ts:97-103`). Acceptable as
  long as Track 4 ships **before or with** `{% source %}` so the
  warning fires; if `{% source %}` ships first, broken refs go
  completely silent for a window. The plan's rollout order
  (`markdoc-tags-design.md:354-358`) actually puts `{% source %}`
  first as the "first exerciser of Track 4's ref tracking" — that
  reads like the two ship together, but the plan does not say "block
  `{% source %}` ship until Track 4 lands." See findings.

### Server-side Markdoc → markdown renderer (Track 2)
- **Failure:** A briefing body contains a tag the emitter doesn't
  recognise (e.g., the boxholder hand-writes `{% quote %}` inside a
  briefing). The emitter has no case for it — does it drop the
  content, dump raw Markdoc syntax, or fall back to rendering inner
  text?
- **Test exists?** No.
- **Handling exists?** Not specified.
- **Clear-or-silent?** **Silent.** Compiled CLAUDE.md include loses
  content with no signal. The plan says
  (`markdoc-tags-design.md:172-175`): "twenty lines walking the
  renderable tree, plus one mini-emitter per tag in the briefing
  vocabulary." Unknown tags need a default; the plan doesn't pick one.

### `compileBriefing()` rewrite — output equivalence (Track 2)
- **Failure:** The rewritten compile produces structurally-similar but
  not byte-identical output to the old one; downstream `@`-includes in
  CLAUDE.md drift, and an agent's mental model of the briefing format
  silently changes.
- **Test exists?** No.
- **Handling exists?** Plan's minimum first step
  (`markdoc-tags-design.md:179-184`): "verify the compiled CLAUDE.md
  include matches what the old `compileBriefing()` produced" — verified
  by hand on one briefing. Per-briefing-atomic migration means there's
  no bilingual-state-conflict gap (an improvement over the prior trial
  review's "critical gap"). Spot-check passes hand-eyeball muster but
  is not a regression test.
- **Clear-or-silent?** Clear at first migration, silent afterward.

### Recipe `{% ingredient %}` scaling math (Track 1)
- **Failure:** Plan promises "no change to the scaling code"
  (`markdoc-tags-design.md:66-67`). The current scaling code lives in
  the frontend recipe renderer and reads `<ing amount="...">` from the
  XML tree; the new shape is `{% ingredient amount="..." %}` in
  Markdoc. "No change" is only literal if the scaling logic already
  takes a generic `{amount, unit, name}` triple — otherwise *some*
  change is required at the call site.
- **Test exists?** Existing recipe doctests may cover scaling; plan
  doesn't say.
- **Handling exists?** Not yet specified.
- **Clear-or-silent?** TBD. Could be silent if scaled amounts come out
  as `NaN` or if the unit text bleeds into the amount.

### `extractRefs` extended to walk Markdoc body (Track 4)
- **Failure:** The extension lives in cardworks (per the source layout
  evidence above), but is exercised through callback-box's
  `card-lint.ts`. If cardworks evolves the `walkForRefs` signature or
  if a future Markdoc tag uses an attribute named `ref` to mean
  something *other* than a card-ref (unlikely but possible — e.g., a
  CSS-style ref), the extractor over-reports.
- **Test exists?** Plan defers tests
  (`markdoc-tags-design.md:351-352`): "dogfooding precedes tests."
- **Handling exists?** Warning-not-error policy
  (`card-lint.ts:97-103`) absorbs false positives; only noise, not
  blockage.
- **Clear-or-silent?** Clear (noisy warnings during dogfooding).

### `move.ts` body-tag `ref=` rewrite (Track 4)
- **Failure:** Plan says "Extend `move.ts`'s rewrite pass to update
  body-tag `ref=` attributes too" (`markdoc-tags-design.md:303-304`).
  The current pass at `src/core/commands/move.ts:209-238` is a
  substring `replaceAll`. A naive substring of the old card path
  inside a body works for full paths but mis-handles tags whose `ref`
  is a fragment (`#m12`) or a shorter relative form.
- **Test exists?** No.
- **Handling exists?** Inherited from substring-replace; correct for
  full paths, partial for fragments.
- **Clear-or-silent?** Silent — moved card leaves dangling fragments
  in body refs, surfaced later as broken-ref warnings (only after
  Track 4's extractor lands).

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — `{% quote %}` vs `{% source %}` vs
  `{% source ref=... as=verbatim %}{% quote %}...{% /quote %}{% /source %}`.
  Plan addresses (`markdoc-tags-design.md:237-247`) with the
  composition example. **ADDRESSED**, though the agent guide entry
  noted in `markdoc-tags-design.md:280` is the load-bearing piece and
  is one bullet, not drafted.
- **Stale ref** — covered above. **ADDRESSED but deferred** to Track 4.
  The order-of-shipping interlock is the open gap; see findings.
- **Two agents touching the same card** — `compileBriefing()` is read
  by all agents; concurrent edits to a briefing body produce git
  conflicts the same way frontmatter edits do today. Plan does not
  call this out, but it's no worse than today. **DEFERRED implicitly**.
- **Hand-edit drift** — boxholder writes `{%source%}` (no spaces),
  `{% Source %}` (capitalised), or `{% source ref=... %}` missing
  closing tag. Markdoc validates at parse time
  (`markdoc-config.ts:21-22`); attribute schema would catch missing
  `ref`. Tag-name case-sensitivity in Markdoc is strict — `{% Source %}`
  is a different tag. Plan does not call this out. **GAP** in
  agent-facing error messaging; the schema-instructions blurb is the
  mitigation.
- **Fabricated free-form value** — `as="..."` is freeform natural
  language (`markdoc-tags-design.md:209-230`). The plan trades enum
  precision for honest description. **ADDRESSED** explicitly; the
  rationale at `markdoc-tags-design.md:222-227` is the right one.
- **Validation error UX** — Markdoc validation messages are terse
  ("Attribute 'ref' is required"). Plan inherits whatever Markdoc
  emits; the existing PostToolUse hook surfaces it to the agent. No
  custom message work planned. **DEFERRED implicitly**; acceptable for
  first ship.
- **Partial migration / transition state** — recipe (Track 1) and
  briefing (Track 2). Briefing: per-card-atomic migration explicit
  (`markdoc-tags-design.md:148-151`), no bilingual reading. Recipe:
  plan does NOT say how recipes-in-flight behave during the recipe
  schema swap. **GAP** for Track 1 transition state; see findings.

## Findings

### Critical gap: Track 4 / Track 3 ship-order interlock
**Location in plan:** `markdoc-tags-design.md:316-319` (Track 4 minimum
first step) and `markdoc-tags-design.md:354-358` (rollout order).
**Citation (plan):** *"Implement once, exercised by `{% source %}`'s
`ref` since that's the first universal-vocabulary tag with one."* and
*"`{% source %}` first (universal but additive, and the first
exerciser of Track 4's ref tracking)..."*
**Issue:** Two orderings are stated. Track 4 says "implemented once,
exercised by `{% source %}`" (implying Track 4 lands first or
simultaneously). The Rollout shape says `{% source %}` is implemented
first. If `{% source %}` ships and Track 4 follows later, every
broken-ref in a body tag is invisible to `cb validate` for the window
in between.
**Why it matters:** Validation-on-load is one of the stated
preferences. A new ref-bearing surface without ref validation
silently undermines it.
**Suggested action:** Pick one. Either (a) ship Track 4's
`extractRefs` extension *as part of* `{% source %}`'s first step, or
(b) document explicitly that body-ref validation lags first ship of
`{% source %}` and is accepted as a known gap for the dogfooding
window. The plan's current language reads like (a) is intended but
doesn't make the dependency explicit.
**Traces to preference:** Validation-on-load (CLAUDE.md).

### Gap: server-side Markdoc → markdown renderer — unknown-tag fallback
**Location in plan:** `markdoc-tags-design.md:167-175`.
**Citation (plan):** *"roughly twenty lines walking the renderable
tree, plus one mini-emitter per tag in the briefing vocabulary."*
**Issue:** No default behaviour stated for tags the briefing
vocabulary's emitter map doesn't know. If a boxholder hand-edits
`{% quote %}` into a briefing body (a plausible move given quote is
the universal precedent), the emitter has no entry for it.
**Why it matters:** Silent content loss in compiled CLAUDE.md
includes — the agent reads a briefing missing prose it visibly contains
in source.
**Suggested action:** Specify the default: emit inner text? emit raw
Markdoc tag syntax? error? Pick one and write it into the plan's
"Direction" subsection for Track 2.
**Traces to preference:** Validation-on-load (silent failures are the
opposite); `{% quote %}` precedent ("don't add features beyond what
the task requires" — but unknown-tag fallback isn't a feature, it's a
correctness floor).

### Gap: Track 1 transition state for in-flight recipes
**Location in plan:** Track 1 entire section
(`markdoc-tags-design.md:35-99`).
**Citation (plan):** No mention of what happens to existing XML
recipe cards once the Markdoc shape lands.
**Issue:** Briefing migration is explicitly per-card-atomic
(`markdoc-tags-design.md:148-151`). Recipe migration says nothing.
Two options: bilingual loader (XML recipes still parse; new ones use
Markdoc body) or atomic migration (all recipes migrate at flag-day).
The recipe schema is a `cardSchema` vs `element` choice — they're
different surfaces in the registry (per CLAUDE.md: *"`cardSchemas[]`
for frontmatter, `schemas[]` for XML"*).
**Why it matters:** Recipe is the largest-scope track. An unspecified
transition either blocks the migration on a flag-day (which
contradicts smallest-first) or silently leaves old recipes
unrenderable.
**Suggested action:** Add a "Migration" paragraph to Track 1: bilingual
loader during the window? Per-recipe-atomic with the agent migrating
on next touch? Doctest fixtures using the new shape from day one?
**Traces to preference:** *"Don't add features beyond what the task
requires"* + the `{% quote %}` precedent of "implement small, dogfood,
then tweak" — both demand a defined transition.

### Findings: NOT-in-scope section is missing entirely
**Location in plan:** Whole document.
**Citation (plan):** No section titled "NOT in scope" exists. Open
Design Questions covers a few deferrals but is structurally different
(unsettled vs explicitly-excluded).
**Issue:** The skill's special rule
(`.claude/skills/cb-plan-review/SKILL.md:154-158`): *"if a plan
touches multiple modules, has a transition state, or introduces a new
vocabulary — and the NOT-in-scope section is empty — stop and write
it."* This plan does all three.
**Why it matters:** The absence of NOT-in-scope is the gate
substituting for a numeric scope limit. Without it the plan hasn't
bounded itself. Candidates that probably belong there: per-tag
accept-list machinery (mentioned at
`markdoc-tags-design.md:18-21` as deferred but not formalised),
migration scripts (`markdoc-tags-design.md:148-151`), bilingual
reading for briefings (`markdoc-tags-design.md:151`), enum promotion
for `as=` (`markdoc-tags-design.md:223-227`), recipe transition
behaviour, agent-guide draft text.
**Suggested action:** Add a "NOT in scope" section with one-line
rationale per deferral.
**Traces to preference:** Skill's own scope-gate rule + *"don't add
features beyond what the task requires"* (CLAUDE.md).

### Finding: "Failure modes" section is missing entirely
**Location in plan:** Whole document.
**Citation (plan):** No section titled "Failure modes" or the
table-of-codepaths the template asks for.
**Issue:** The skill names this "the load-bearing section"
(`.claude/skills/cb-plan-review/SKILL.md:103`). The plan's Open
Design Questions and Rollout cover some of the ground (the renderer
density question at `markdoc-tags-design.md:335-338`, broken-ref
behaviour at `markdoc-tags-design.md:273-274`), but the systematic
codepath-by-codepath table is not there.
**Why it matters:** The Failure-Modes section is where critical-gap
flagging happens. Without it the reader has to do the
codepath/test/handling/silent enumeration themselves (which this
review did above) — fine for review, less fine for the planner's own
sanity check.
**Suggested action:** Add the table. Even one row per new tag
covers most of the surface. The codepaths this review enumerated are
a starting list.
**Traces to preference:** Skill's "load-bearing section" rule. The
`{% quote %}` precedent shipped with concrete failure thinking; this
plan should match.

### Finding: "Stated preferences this plan trades against" section is missing
**Location in plan:** Whole document.
**Issue:** The skill requires this section
(`.claude/skills/cb-plan-review/SKILL.md:50-71`). Plan does not have
it. Track-level "Vocabulary lock-ins" are close in spirit but not the
same — those lock the *plan's* commitments, not the *external*
principles the plan is constrained by.
**Why it matters:** Without it, design choices in the plan have
nothing to trace back to. The "Why" paragraphs in each track are
problem-statements, not principle-citations.
**Suggested action:** Add a section near the top citing CLAUDE.md
conventions, CODE-STYLE.md rules, and the `{% quote %}` precedent
explicitly. The header of `markdoc-tags-design.md:1-6` invokes the
precedent in passing; promote it to a structured section.
**Traces to preference:** Skill's "Trace to a stated preference" rule
(*"every recommendation ends with one sentence connecting it to a
specific principle"*).

### Finding: "What already exists" section is missing
**Location in plan:** Whole document.
**Issue:** The skill requires this section
(`.claude/skills/cb-plan-review/SKILL.md:73-82`). The plan does
discuss existing state inside each track's "Today" subsection — that
covers the *problem* side. What's missing is the *infrastructure*
side: the existing `extractRefs`, the `markdoc-config.ts` tag
registry, the `move.ts` rewrite pass, the per-schema `instructions`
channel, the `compileBriefing` callsite at
`src/core/generate-docs.ts:450`. The plan references some of these
(notably `card-lint.ts:104` and `move.ts:172` in Track 4) but
inconsistently.
**Why it matters:** This is the antidote to "I'll write a new utility"
when one exists. Track 2's "twenty lines walking the renderable tree"
could mention whether any existing Markdoc→string utility already
lives in the codebase (it doesn't — verified —
`grep -r renderers /src/frontend/src/lib` shows only `renderers.react`
is used). That verification belongs in the plan.
**Suggested action:** Add the section. Cite `file:line` for each
existing piece the plan extends. The track-internal references are
a head start; consolidate.
**Traces to preference:** Skill's "reuse > rebuild" rule; CLAUDE.md's
*"Read before writing. Don't guess file formats."*

### Finding: agent guide entry for `{% source %}` is one sentence
**Location in plan:** `markdoc-tags-design.md:279-281`.
**Citation (plan):** *"A 2-3-sentence pointer added to the agent
guide's 'Direct Quotes' section explaining the complement."*
**Issue:** The `{% quote %}` precedent landed with a dedicated file at
`src/core/agent-guide/quotes.ts` (per the prior trial review's
finding, verified to exist). `{% source %}` is more conceptually
slippery than `{% quote %}` (the `as=` axis is the new burden, and
the composition with `{% quote %}` is non-obvious). Two to three
sentences appended to an existing section may not be enough surface
to teach honest derivation language vs enum-shaped guesses.
**Why it matters:** The freeform `as=` design only works if agents
understand what "honest" looks like. Under-teaching tips toward
"agent picks 'verbatim' for everything" — collapsing the freeform
back into a one-value enum in practice.
**Suggested action:** Draft the actual text (3-5 example `as=` values
the agent can pattern-match against). Reference `agent-guide/quotes.ts`
explicitly as the precedent for *where*, and write enough sentences
to convey the *what*.
**Traces to preference:** *"Read before writing. Don't guess file
formats."* — the agent-facing analogue is "give agents enough to write
without guessing."

### Finding: server-side Markdoc emitter location is unspecified
**Location in plan:** `markdoc-tags-design.md:170-175`.
**Citation (plan):** *"the codebase needs a server-side Markdoc →
markdown renderer, parallel to the React renderer on the frontend."*
**Issue:** The React renderer lives at
`src/frontend/src/components/Markdown.tsx` and
`src/frontend/src/lib/markdoc-config.ts` — both inside
`src/frontend/`. The server-side renderer needs to live where Node
can import it. `markdoc-config.ts` itself is currently
frontend-scoped. Plan does not say whether the config gets hoisted
(shared between frontend and backend), duplicated, or left
frontend-only with a parallel backend config. Hoisting risks the
two-tsconfigs split (CLAUDE.md mentions *"Two TypeScript configs.
Backend uses the root tsconfig, frontend uses
`src/frontend/tsconfig.json`"*).
**Why it matters:** "Single repo-wide Markdoc vocabulary" is the
plan's load-bearing constraint. If frontend and backend each have
their own tag config, the constraint becomes a maintenance promise
rather than a structural fact.
**Suggested action:** Pick a location for the shared Markdoc config
(probably `src/lib/` or `cardworks/`) and call it out as part of
Track 2's direction. Note the tsconfig implication.
**Traces to preference:** Vocabulary lock-in (plan's own constraint at
`markdoc-tags-design.md:7-13`); CLAUDE.md two-tsconfig rule.

### Finding: `move.ts` body-tag rewrite mechanism is ambiguous
**Location in plan:** `markdoc-tags-design.md:302-304`.
**Citation (plan):** *"Extend `move.ts`'s rewrite pass to update
body-tag `ref=` attributes too."*
**Issue:** The current `move.ts` rewrite at
`src/core/commands/move.ts:225-228` is a substring `replaceAll`. That
works for full path matches but doesn't parse Markdoc — so a
`ref="old/path#m12"` becomes `ref="new/path#m12"` correctly by
luck (because the prefix matches), while a `ref="old/path"` that
appears as bare text in a code fence also gets rewritten. The plan
doesn't specify which mechanism Track 4 uses.
**Why it matters:** Move is a high-blast-radius operation. Silent
mis-rewrites in code fences would be discovered slowly.
**Suggested action:** Specify: parse Markdoc to walk only tag
attributes, or document the substring approach with a known
limitation. The same call has to handle the cardworks-symlink
question (does this extension live in cardworks where the existing
`walkForRefs` is, or in callback-box where `move.ts` is?).
**Traces to preference:** CODE-STYLE.md *"No optional chaining: use
explicit null checks for clarity"* — the principle generalises to "be
explicit about what your code does," which substring-as-AST-rewrite
is not.

### Finding: vocabulary constraint is universal but accept-list machinery is absent
**Location in plan:** `markdoc-tags-design.md:15-21`.
**Citation (plan):** *"Schemas may restrict which tags are allowed in
their body... Accept-list machinery is not yet implemented in the
Markdoc config; the first schema that wants to restrict triggers
building it."*
**Issue:** This is fine as deferral. But the plan doesn't say what
happens *meanwhile*. Does a recipe body that contains `{% correction %}`
parse cleanly today (yes — every tag is universally available because
there's no accept-list)? If so, that's worth saying — agents will
otherwise be cautious about using a tag in the "wrong" schema.
**Why it matters:** Universal vocabulary with no restriction is the
plan's literal current state. If unstated, agents may invent
restrictions out of caution.
**Suggested action:** One sentence: "Until accept-list machinery
lands, every tag in the registry parses in every body. Agents should
use tags by their semantic fit, not by perceived schema affinity."
**Traces to preference:** *"Read before writing. Don't guess file
formats"* — agents need to know what's actually permitted.

## NOT in scope (verified)

The plan does not have a NOT-in-scope section, so I cannot verify
deferrals. The Open Design Questions cover a few (vague refs, batch
vs lazy migration pacing, dense `{% source %}` renderer noise) but
these are unsettled-questions, not explicit deferrals. See the missing-
NOT-in-scope finding above.

## Things I checked and found clean

- **`{% quote %}` precedent traceability.** Plan's "Minimum first
  step" sections mirror the actual shipped shape at
  `markdoc-config.ts:27-36`. Direct precedent reuse, not invented
  structure.
- **`compileBriefing()` description.** Plan's claim that it's "a
  hand-written Markdoc renderer" matches `briefing.tsx:129-208`
  verbatim — manually emitted markdown lines from structured fields.
- **`extractRefs` location.** Plan cites `card-lint.ts:104`; verified
  call site exists and matches.
- **`move.ts` ref-update behaviour.** Plan cites `move.ts:172`;
  verified that's the `moveOne` doc comment describing the rewrite
  policy.
- **Smallest-first ordering.** Plan ships `{% source %}` first (one
  tag, additive), then per-briefing migration, then recipe schema
  swap. Matches the skill's *"surface size, smallest first"* rule.
- **Vocabulary single-shape claim.** Plan's lock-ins enumerate every
  proposed tag (`{% ingredient %}`, `{% step %}`, `{% subrecipe %}`,
  `{% substitution %}`, `{% yield %}`, `{% recipe-section %}`,
  `{% key-person %}`, `{% correction %}`, `{% property %}`,
  `{% project-phase %}`, `{% purpose %}`, `{% source %}`). Cross-checked
  against the body — each is defined exactly once. No shape conflicts
  within the plan itself.
- **Free-form `as=` rationale.** Argument at
  `markdoc-tags-design.md:222-227` is well-formed (enum closeness
  vs honesty) and traces to "Fabricated free-form value" edge case
  cleanly.
- **`source` vs `from` naming-collision analysis.**
  `markdoc-tags-design.md:249-256` correctly identifies that
  `{% quote from="..." %}` and `{% from %}` would conflict, and the
  rename to `{% source %}` resolves it. Verified `{% quote %}`'s
  attribute is `from` at `markdoc-config.ts:29`.
- **No `any`, no optional-chaining, no default-params violations in
  the proposed shapes.** Plan describes shapes in Markdoc syntax, not
  TS — so the style rules apply to the eventual implementation, not
  the plan itself. Nothing in the plan suggests violating them.
- **Per-card-atomic briefing migration eliminates the prior trial
  review's "critical gap"** (bilingual `compileBriefing` deduping
  frontmatter and body `{% correction %}` entries). Plan explicitly
  rules out bilingual reading at `markdoc-tags-design.md:148-151`.
  Confirmed: no path produces double-counted corrections.
