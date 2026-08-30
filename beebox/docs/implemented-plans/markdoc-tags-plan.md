---
title: "Markdoc Tags — Design"
status: implemented
workstream: unknown
issues: []
---
# Markdoc Tags — Design

Plan for the next four Markdoc work tracks, following the `{% quote %}`
tag that shipped first. Each track is sized to be implemented small,
dogfooded, then tweaked — not designed comprehensively up front.

## Vocabulary constraint (applies everywhere)

A single repo-wide Markdoc vocabulary. **No tag name may exist with two
different shapes.** If `{% ing %}` is defined, it has one set of attributes
and one rendering semantic across every schema that allows it. Same goes
for every tag name we add.

Schemas may restrict *which* tags are allowed in their body. A briefing
isn't expected to contain `{% step %}`; a memo isn't expected to contain
`{% ingredient %}`. The vocabulary is universal, but each schema's
**accept-list** can be narrower. Accept-list machinery is not yet
implemented in the Markdoc config; the first schema that wants to
restrict triggers building it.

The one explicit exception: **typed children**. One schema may permit a
tag to accept extra child types that another schema doesn't. The tag's
attributes and rendering stay identical; only the child-type allow-list
may widen.

Why: shared vocabulary means an agent that learns a tag once recognises
it everywhere. Same-name-different-shape is a constant source of
confusion and validation failure, and it forecloses cross-schema reuse.

Attribute values default to natural-language prose; promotion to a fixed
enum is opt-in after dogfooding shows the values cluster. `{% source %}`'s
`as=` and `{% correction %}`'s `test=` are both natural-language by
design.

**Convention discovered during Track 3 implementation:** any tag with a
`ref` attribute whose rendered output is a React component must rename
`ref` to a non-reserved prop name in the Markdoc transform before
emitting the renderable tree. React reserves `ref` as the special
ref-forwarding prop and intercepts it before it reaches the component.
`{% source %}`'s schema transform does `const { ref, ...rest } =
attributes; return new Tag(..., { ...rest, sourceRef: ref }, ...)` and
the React component accepts `sourceRef`. Future ref-bearing tags
(`{% subrecipe %}`, `{% key-person %}`) follow the same shape. The
Markdoc-side authoring syntax stays `ref="..."`, and Track 4's body
ref-tracking still finds it (the walker checks the AST node's
attributes, not the renderable tree).

## Track 1: Recipe → Markdoc-annotated document

### Today

`recipe.tsx` is an XML schema: `<title>`, `<description>`, `<yield>`,
`<section>`, `<ingredients>` containing `<ing>`, `<steps>` containing
`<step>`. Step text uses a custom inline syntax `@{ingredient}` /
`@{ingredient}{amount}` to reference ingredients. The structure assumes
one ingredient list per section.

### Why this needs to change

Real recipes don't fit that mould. The forced reshapes:

- A pasta recipe with its own sauce → two `<section>` blocks pretending
  to be parallel when they're nested.
- A baking recipe with substitutions ("buttermilk, or milk + lemon
  juice") → has nowhere to live except a `<notes>` blob.
- A recipe that references a sibling recipe ("see the crème fraîche
  recipe") → no native expression.
- A step that calls out alternative quantities ("scant cup if the flour
  is fresh") → `@{flour}{amount}` flattens this.

A recipe is fundamentally a natural-language document. Extend it as one.

### Direction

Convert the body of a recipe card from XML structure to Markdoc-annotated
markdown. Frontmatter shrinks to identity: `title`, `description`,
`source`, `tags`, `hero-image`. Everything else moves to body tags:

- `{% ingredient amount="..." unit="..." %}name{% /ingredient %}` —
  semantic ingredient. Works inline within a step
  (`Sauté the {% ingredient %}garlic{% /ingredient %}`) or as a list
  item. The `amount` attribute feeds the existing frontend scaling math
  (`amount × ratio`). No change to the scaling code.
- `{% step %}` — a step (block). Body is prose; ingredient refs are
  inline tags within it. Auto-numbers on render. Source has no numbers;
  reorder by moving the block.
- `{% yield amount="..." %}4 servings{% /yield %}` — scaling base + human
  text.
- `{% substitution for="..." %}use Y when X is unavailable; the dish will
  read slightly Z{% /substitution %}` — block, the `for` attribute names
  the ingredient or step being substituted.
- `{% subrecipe ref="..." %}description{% /subrecipe %}` — block, refs a
  sibling recipe card.
- `{% recipe-section name="..." %}` — block, groups steps + ingredients
  for multi-part recipes (sauce + pasta).

### Vocabulary lock-ins

These tags now live in the repo-wide vocabulary; any future schema that
uses one must accept the same shape.

- `{% ingredient %}` — recipe-only today, but if a meal-plan or
  shopping-list card ever uses it, same `amount`/`unit`/body shape.
- `{% step %}` — could plausibly appear in a procedure card. If it does,
  same shape.
- `{% subrecipe %}`, `{% substitution %}`, `{% yield %}`,
  `{% recipe-section %}` — recipe-only by name, locked by shape.

### Minimum first step

Migrate just `{% ingredient %}` and `{% step %}`. Substitutions,
subrecipes, sections, yield — second pass after dogfooding.

### Migration / transition state

Per-recipe-atomic, same as briefing. The loader inspects the body:
XML-rooted recipes use the legacy schema, body-Markdoc-rooted recipes use
the new schema. Both shapes coexist in the box during migration; each
recipe is migrated atomically when next touched. No flag-day.

## Track 2: Briefing → body Markdoc

### Today

`briefing.tsx` keeps semantic content in frontmatter:

- `purpose` (string)
- `key-people` (array of objects: name, called, role, ref, description)
- `project-phase` (object)
- `corrections` (array of objects: instruction, test)
- `legal` (string), `finances` (string)
- `properties` (array of objects)
- plus a freeform markdown body

`compileBriefing()` re-renders all of this back into a markdown body for
agent consumption — essentially a hand-written Markdoc renderer.

### Why this needs to change

The frontmatter is a YAML reflection of body content. Reading a raw
briefing card means scanning awkward imperative-prose-in-YAML
(`corrections: [{instruction: "don't archive before reading"}]`). The
compile step exists only because the source-of-truth is in the wrong
format.

### Direction

Move ALL semantic content to the body as Markdoc tags. Frontmatter
shrinks to identity + lifecycle. The semantic fields (`purpose`,
`key-people`, `corrections`, `properties`, `project-phase`, `legal`,
`finances`) are removed from the frontmatter shape entirely.

- `{% purpose %}what this box is for{% /purpose %}` — block.
- `{% key-person ref="people/dana" called="Dana" role="..." %}description
  of role and aliases{% /key-person %}` — block.
- `{% correction test="..." %}don't archive items before reading them
  through{% /correction %}` — block. `test` describes how to verify the
  correction is being followed.
- `{% property name="..." address="..." %}description{% /property %}` —
  block.
- `{% project-phase date="2026-05-01" %}description{% /project-phase %}` —
  block.

`legal` and `finances` were already prose — they become plain markdown
sections (`## Legal`, `## Finances`) in the body, no tag required.

Sharing the Markdoc tag/node config between the frontend renderer and the
new backend emitter is a structural question — frontend and backend
currently have separate tsconfigs. See
[shared-frontend-backend-code subplan](shared-frontend-backend-code.subplan.md).
Track 2 depends on that subplan completing before the backend emitter can
land.

Unknown-tag fallback in the backend emitter: any tag the emitter map
doesn't know about emits its inner text only and logs a warning to
stderr. A stray `{% quote %}` inside a briefing body keeps its inner
text in the compiled CLAUDE.md include (not lost); the warning surfaces
the surprise during compilation.

Migration is **per-briefing-atomic**: each briefing is either fully old
or fully new, never both. There is no bilingual reading mode. The
migration is hand-done by the agent (or by the boxholder), one briefing
at a time — no `bbx migrate` script in the first pass.

### Vocabulary lock-ins

- `{% key-person %}` — briefing's pointer to a person. If a record or
  doc ever needs to inline-attribute a person, same shape.
- `{% correction %}` — for now briefing-only. If feedback cards or notes
  ever express corrections inline, same shape.
- `{% property %}`, `{% project-phase %}`, `{% purpose %}` — briefing-only
  by current use; shape locked.

### Compile-briefing becomes a server-side Markdoc renderer

`compileBriefing()` is rewritten. Today it reads frontmatter fields and
hand-emits markdown; in the new form it parses the body as Markdoc,
walks the renderable tree, and emits plain markdown for inclusion in
CLAUDE.md. The compiled output flows into `@`-includes that Claude Code
reads as plain markdown — it has to be plain text, not Markdoc syntax,
so each tag has a small server-side emitter that turns it into
markdown headings / lists / paragraphs.

Concrete consequence: the codebase needs a **server-side Markdoc →
markdown renderer**, parallel to the React renderer on the frontend.
Markdoc doesn't ship one. It's a small piece to write — roughly twenty
lines walking the renderable tree, plus one mini-emitter per tag in the
briefing vocabulary.

### Minimum first step

Migrate one briefing end-to-end as proof — pick the smallest one in
`test1`, convert its semantic frontmatter to body tags, write the
server-side Markdoc → markdown renderer with emitters for the tags that
briefing uses, and verify the compiled CLAUDE.md include matches what
the old `compileBriefing()` produced. Then iterate on the other
briefings one at a time.

## Track 3: Universal provenance — `{% source %}`

### Today

Provenance is **card-level only**. A memo's `source: voice`, a record's
`sources: [{ref: ...}]`, a feedback's `target: {ref: ...}`. When a doc
aggregates multiple sources into one body, there's no inline mechanism to
say "this paragraph came from there." The `{% quote %}` tag is close but
single-purpose: it marks verbatim words, not the broader where-from-and-how
question.

### Direction

Add `{% source %}` as a universal provenance tag. Universal = available
in every schema's body (subject to per-schema accept-lists if any want
to restrict it, which I don't currently expect).

Shape:

- `ref` — **required.** Where the content came from. File path or card
  ref, optionally with a fragment (`box/inbox/Voice_2026-03-15.memo.card`,
  `box/chats/Mar15.chat-thread.card#m12`).
- `as` — **optional, free-form natural language** describing *how* the
  wrapped content derives from the source. Not an enum. The agent
  writes whatever truthfully describes the derivation.

Example values for `as`:

- `as="verbatim"`
- `as="paraphrase"`
- `as="summary of the third section"`
- `as="calculated from the figures in the table"`
- `as="inferred from Maria's preference for X"`
- `as="extracted name"`
- `as="agent's own framing based on the conversation"`

Free-form because real derivations don't fit a fixed taxonomy, and forcing
one means the agent picks the closest-fit enum value when honesty would
require a sentence. Once dogfooded, if a few values dominate, we can
revisit promoting them to a chip or shortcut — but the freeform attribute
stays available.

### Composition with `{% quote %}`

The two tags are complementary:

- `{% quote %}` — "these are the user's exact expressive words"
  (speaker-attribution is the relevant axis).
- `{% source %}` — "this content came from there" (location-attribution is
  the relevant axis).

They compose:

```
{% source ref="box/inbox/Voice_2026-03-15.memo.card" as="verbatim" %}
{% quote %}I keep going back and forth on the kitchen.{% /quote %}
{% /source %}
```

Reads: "verbatim words from the user, sourced from that memo." The outer
tag pins where; the inner marks what kind. Bare `{% source %}` without an
inner `{% quote %}` is paraphrased / derived content with a citation.

### Naming-collision note

`{% quote from="..." %}` and a `{% from %}` tag would put the same word in
two grammatical roles. Picking the new tag name as `{% source %}` avoids
this. Reads naturally: "source ref=..., used as a summary." Also leaves
the `from` lexeme available as a future attribute on `{% source %}` if a
second attribution dimension turns out to matter.

### Vocabulary lock-ins

- `{% source %}` — universal. Required attributes: `ref`. Optional
  attributes: `as`. Locked at this shape.

### Renderer

Inline use: a small bracketed citation marker after the wrapped span, e.g.
`[→ Voice 2026-03-15]`. Clicking navigates via `onNavigate`. The `as`
value shows on hover or as a small italic suffix (`[→ Voice 2026-03-15:
summary]`).

Block use: a subtle styled wrapper similar to `{% quote %}`'s block form,
with the source citation as a `<figcaption>` below.

If the `ref` resolves to a missing target, the chip still renders but
click is a noop with a console warning. Future tweak after dogfooding if
it feels invisible.

### Minimum first step

Just the tag and the renderer. One audit entry teaching the syntax and
when to use it. Agent-guide entry: a small section in
`src/core/agent-guide/quotes.ts` (or a sibling) introducing `{% source %}`
as the complement to `{% quote %}`. Includes 4-5 example `as=` values
that span the range (`verbatim`, `paraphrase`, `summary of the third
section`, `inferred from the address`, `extracted name`). The agent
needs enough examples that "honest description" beats "pick the closest
enum-shaped word" — without this, the freeform axis risks collapsing
into a de-facto enum.

## Track 4: Ref-attribute tracking — vocabulary-wide invariant

The codebase already validates and maintains `ref:` attributes in YAML
frontmatter:

- `src/core/card-lint.ts:104` calls `extractRefs(parsed.fields)` and
  warns on broken refs.
- `src/core/commands/move.ts:172` rewrites refs across the box when a
  card moves.

Markdoc tags introduce a new place for `ref=` attributes to live: tag
attributes inside card bodies. `{% key-person ref="..." %}`,
`{% source ref="..." %}`, `{% subrecipe ref="..." %}` — all should be
subject to the same checks.

Two concrete additions, both extensions of existing machinery (not
rebuilds):

1. Extend `extractRefs` to parse the body's Markdoc and yield any tag
   attribute named `ref` alongside the frontmatter refs it already
   yields.
2. Extend `move.ts`'s rewrite pass to update body-tag `ref=` attributes
   via substring replace across other cards' contents. Same shape as
   the existing attach-scope rewrite (user-approved; rewrites in code
   fences are acceptable). AST-aware rewrite via `Markdoc.format` is
   deferred — see open question 4 below — but unnecessary for this
   track since substring works for the move case.

   *Implementation note: shipped in `src/core/commands/move.ts:209-261`.
   The pass extends the existing attach-rewrite loop with a second
   rewrite entry keyed on the moved card's path itself; both rewrites
   apply in one read-modify-write per card.*
   too.

Same warning-not-error policy as today's frontmatter refs (per
`card-lint.ts:97-98`: refs go stale via legitimate operations like move
/ archive).

Vocabulary-level rule: **any Markdoc tag with a `ref` attribute
participates in this tracking automatically.** No per-tag opt-in needed;
the walker just picks them up. This makes "tag has a `ref`" a
load-bearing piece of the universal vocabulary.

### Minimum first step

Implement once, exercised by `{% source %}`'s `ref` since that's the
first universal-vocabulary tag with one.

Track 4 lands before or alongside Track 3 within the plan — `{% source %}`
is the first ref-bearing body tag, and implementing it without body
ref-tracking would leave broken refs invisible to `bbx validate`. This
is implementation sequencing inside one plan, not a ship boundary; the
plan ships as a whole.

## Open design questions

1. **`{% source %}` for vague refs.** What if the agent has a source but
   not a file path — e.g., "the user mentioned this last week, not sure
   in which thread"? Options: (a) require `ref` regardless, accept
   imprecise values, (b) allow `ref` to be a description string, (c)
   require an `unverified` flag. Lean (b) for now — natural language is
   honest when precision isn't available.

2. **Briefing migration pacing.** With bilingual reading off the table,
   every briefing migrates atomically. Open question: do we batch the
   migration (one sitting, all briefings) or do it lazily (each briefing
   on its next edit)? Revisit after the first one or two land.

3. **Renderer cost for `{% source %}` in dense documents.** A doc with
   30 sourced spans could be visually noisy. Worth dogfooding before
   optimising the renderer; the answer might be "fewer source tags per
   doc" rather than "smaller chips."

4. **Markdoc round-trip reliability — RESOLVED, do not use `format()`
   on arbitrary input.** The full investigation lives at
   `docs/implemented-plans/markdoc-format-investigation.md`; the catalogue covers ~70
   normalizations across ~18 categories. The verdict:

   - **`format` is safe for tool-emitted canonical Markdoc with our
     vocabulary** — our `{% quote %}`, `{% source %}`, `{% task /%}`
     all round-trip byte-identical, ref values aren't normalized,
     attribute order/types preserved.
   - **`format` is dangerous on hand-edited or non-canonical input.**
     Three silent-data-loss bugs:
     `{% tag x='y' %}body{% /tag %}` (single quotes) →
     `"body\n\n{% tag /%}\n"`; `{% tag x = "y" %}body{% /tag %}`
     (spaces around `=`) → same; `{% tag x = "y" /%}` → empty string.
     No parse error, no diagnostic.
   - **`format` is non-converging on some inputs.** Code-fence inside
     blockquote (`> ` ` ``` `) adds an extra fence pair on every pass.
     Double-backtick code spans with internal backticks also fail to
     stabilize. The earlier "idempotent on second pass" claim is
     false.
   - **`format` drops code-fence info-string args after the language
     token.** ` ```ts setup ` → ` ```ts `, losing the `setup`
     annotation. This is unacceptable: any doctest example embedded
     in a card body would be silently corrupted.

   **Implications:**

   - `move.ts` stays substring-based (already shipped). The AST-aware
     alternative would force-canonicalize moved cards' bodies and
     silently destroy non-canonical tag syntax. Substring's failure
     mode (rewrites inside code fences) is visible and bounded.
   - `compileBriefing` (Track 2) must implement its own AST →
     markdown emitter rather than calling `format()`. The info-string
     drop alone disqualifies `format`.
   - **Do not add `format()` calls anywhere in the codebase without
     explicit justification.** The functions look interchangeable for
     tool-emitted content but the failure modes for general-purpose
     editing are severe.
   - **Detection belongs in extended linting** (out of scope for this
     plan; future subplan). A markdown lint phase that does Markdoc
     type checking could catch the dangerous attribute syntaxes
     (single-quoted, spaces around `=`) before they get written to
     disk, since these are arguably malformed Markdoc that should
     never have been accepted. Track 2's `bbx validate` reform could
     incorporate this, or it lives in its own subplan.

## Rollout shape

The plan ships as one unit — there is no partial ship. The four tracks
are sequenced inside the plan by dependency, not by ship boundary.

Each track is minimally scoped:

- One new tag (or one migrated field).
- Renderer + Markdoc schema entry.
- 2-3 sentences in the relevant schema's `instructions` or in the agent
  guide.
- At least one knowledge-audit entry per new tag, including a
  `knows_directly` audit — following the `{% quote %}` precedent (four
  audits landed with that work).
- Existing renderers and compile functions stay backwards-compatible
  during the dogfooding window (except `compileBriefing`, which is
  rewritten per-briefing as each one migrates).
- Doctests: dogfooding precedes tests. One doctest per track lands once
  the tag shape feels settled, not at first landing.
- Migration is per-card-atomic where applicable (briefing, recipe): each
  card is fully old or fully new, migrated when next touched.

Implementation order inside the plan: Track 4 (`extractRefs` +
`move.ts` extended to body tags) first or alongside Track 3, because
`{% source %}` is the first ref-bearing body tag and shipping it
without body ref-tracking would leave broken refs invisible to
`bbx validate`. Then Track 2's first briefing migration end-to-end
(depends on the shared-frontend-backend-code subplan, plus the
server-side emitter). Track 1 (recipe `{% ingredient %}` +
`{% step %}`) last — largest scope, edits an existing live schema.

### Progress within the plan

- **Track 4** — committed (`39680dc1`). `extractBodyRefs` in
  `src/core/body-refs.ts`; `card-lint.ts` merges body refs into the
  existing resolution loop; `move.ts` rewrites the moved card's path
  across other cards' contents alongside the existing attach-scope
  rewrite. Doctest coverage in `test/card-lint.doctest.md`.
- **Track 3** — committed (`63141dce`). `{% source %}` schema in
  `src/frontend/src/lib/markdoc-config.ts` (to be moved to
  `src/shared/` per the subplan); `SourceInline` + `SourceBlock`
  components in `src/frontend/src/components/Source.tsx`; agent-guide
  section at `src/core/agent-guide/source.ts`; four knowledge audits
  (all pass `knows_directly` on first run).
- **Shared-code subplan** — written, see
  `docs/implemented-plans/shared-frontend-backend-code.subplan.md`. One-chunk
  implementation: move config, set up tsconfig path alias, update
  imports. No knowledge audits needed (infrastructure).
- **Track 2** — pending. Implements once the subplan lands.
- **Track 1** — pending. Independent; can go last.

Nothing has merged to main; the plan ships when all four tracks plus
the subplan complete.
