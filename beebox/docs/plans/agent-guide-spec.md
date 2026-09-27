---
title: "The agent guide is built from a spec: a YAML ledger, stable placemarkers, annotated source, and a size budget"
status: draft
workstream: doc-structure
issues:
  - ../../../issues/exploration/2026-06-12-knowledge-budget-always-loaded-context.md
  - ../../../issues/docs-and-chores/2026-07-04-instruction-surface-size-budget.md
---
# The agent guide is built from a spec

The always-loaded agent guide (`.beebox/agent-guide.md`, rendered from
`src/core/agent-guide/*.ts`) is the only thing a box agent knows before its
task arrives. It grew from 3,355 source words in May 2026 to 11,399 in
September, one justified paragraph per feature, because nothing asked each
paragraph to earn its place on the always-loaded tier. Phase two of the
doc-structure workstream moved 1,900 words out and left 9,234.

This plan gives the guide a source of truth it can be semantically rebuilt
from: a YAML ledger with one row per rule, its reason, its tier, and the
audits that guard it; a registry of stable placemarkers; annotations in the
guide's source tying each paragraph to a row; a doctest that holds the two in
step; and a size budget. It then rewrites the guide against that ledger:
every paragraph binned as core, indirect, derivable, or rationale; the core
rewritten for an agent reader (rule, the case where it bites, pointer); the
laws revisited; QUESTIONS re-read against the code. The boxholder's framing,
2026-09-26: "two documents, with the actual agent guide being the built
version of the other document ... it should at least semantically be able to
be rebuilt."

**Issues addressed:**
[knowledge budget for always-loaded context](../../../issues/exploration/2026-06-12-knowledge-budget-always-loaded-context.md)
(the ledger and the budget check are the discipline it asks for) and
[instruction surface size budget](../../../issues/docs-and-chores/2026-07-04-instruction-surface-size-budget.md)
(the target and the measurement; the "inject a slim-down prompt" mechanism it
proposes is not built, see NOT in scope). Related, not closed:
[context size measurement legibility](../../../issues/features/2026-06-20-context-size-measurement-legibility.md)
(the compositional breakdown it wants is what `agent-context` already prints;
its ceiling assertion becomes this plan's budget check).

## Smallest fix and budget

**Smallest fix.** A word-count check in `generateDocs` that warns when the
rendered guide exceeds a constant. About 20 lines. It slows growth and
explains nothing: the next feature still lands its paragraph in the guide and
raises the constant.

**Chosen design, five tracks.**

| Track | What | Source + test lines | Prose |
|---|---|---|---|
| 1 Ledger and registry | `src/core/agent-guide/ledger.yaml`, its schema, the placemarker registry, `docs/agent-guide.md` (spec: decision rules, build shape) | ~300 | ~250 |
| 2 Annotations and the build test | annotation syntax in the section templates, stripping in the renderer, `pnpm agent-guide --annotated`, doctest: coverage both ways, no leaks, budget | ~350 | 0 |
| 3 Binning | every paragraph of the current guide gets a row and a bin; indirect rows move to their surface; derivable and rationale rows are deleted | ~200 | ~2,500 moved or deleted |
| 4 The rewrite | core rows rewritten to the section skeleton; THE_LAWS gains CHECKING and a sharpened CARDS; QUESTIONS rebuilt from the code; every section gets a handle | ~800 (template text) | ~800 |
| 5 The chat prompt in the ledger | rows for `src/core/chat/session/prompts.ts`, overlap with the guide resolved to one home; its rewrite is a follow-on | ~150 | ~300 |

Source and test about 1,800 lines, prose about 3,850 moved, deleted, or
rewritten. Counted together this is a **BIG CHANGE**; the boxholder asked for
the strong approach on 2026-09-26 ("we need a strong approach to that guide,
since it's important"). Track 5 is the one that can be cut without leaving the
guide half-specified.

## Stated preferences this plan trades against

- **Organizing principles** (`docs/README.md`): one home per fact, pointer
  says where not what, names are the search path. The ledger is that rule
  applied to the guide's own contents; the placemarkers are its names.
- **`bbx-context` skill**: the always-on tier is an attention budget; route
  by loading eagerness; bulletproof only rules that slip. Adopted as the
  binning criterion and the rewrite style.
- **Arrange context, do not automate judgment** (boxholder, standing): the
  ledger records human decisions; nothing auto-trims. The budget check warns,
  it does not cut.
- **Minimize invented concepts** (boxholder, standing): the placemarkers are
  the SECTION constants that exist (`src/core/agent-guide/sections.ts`); the
  annotation is an HTML comment; the ledger is YAML like
  `knowledge-audits.yaml`. No new file format, no generator that writes the
  guide.
- **Examples do double duty** (boxholder, standing): one complete card
  example in ABOUT_CARDS shows filename, `contains:`, a ref, and a body tag
  together.
- **Laws grounded in observed failure** (boxholder, 2026-09-26: "I haven't
  noticed honesty or authority as a problem. It doesn't research often
  enough though"): a law is added for a failure someone has seen, not for one
  that could happen.
- **Prompt surface cleanup evaluation** (`docs/plans/prompt-surface-cleanup-evaluation.md`,
  active): its Track 5 owns per-section wording trims. This plan supersedes
  that track for the guide; the plan's other tracks are untouched, and the
  supersession is recorded there when this ships.

## What already exists

- **Section functions and handles**: `src/core/agent-guide/index.ts:74-100`
  assembles 22 sections; `sections.ts:19` defines the `SECTION` constants
  (THE_LAWS, the three law names, ABOUT_CARDS, CARD_TYPES, QUESTIONS, TODOS,
  PROVENANCE). The chat prompt (`src/core/chat/session/prompts.ts:121`) and
  the laws refer to sections by handle. Reuse: the registry is these
  constants plus one per remaining section.
- **Axis comments**: `index.ts` and `sections.ts` carry the group comments
  from phase two (laws, how to speak, cards, where things are, how to act,
  how to cite, where to record, who you are). Reuse as the build shape.
- **DOCID marker and `withDocId`** (`src/core/docs-gen/shared.ts:52-70`): a
  comment the renderer already writes and strips. Reuse the same comment
  form for annotations.
- **Knowledge audits** (`src/dev/knowledge-audits.yaml`, 340 entries;
  runner `src/dev/knowledge-audit.ts`): the guards. Reuse as the per-row
  `audits:` field and the gate for every move and rewrite.
- **Measurement**: `pnpm agent-context chat --box <box>` (word count per
  layer; 14,194 always-loaded on the test1 clone today, guide 9,234), the
  audit ledger `src/dev/context-history.yaml` (context tokens per audit).
- **Phase-one and phase-two tooling**: `scratch/doc-structure/section-hash.py`
  (verbatim-move check), the name-only navigator protocol, the per-section
  disposition table. Reuse for Track 3.
- **YAML-with-schema precedent**: `src/dev/lib/test-suite-schema.ts` parses
  `knowledge-audits.yaml` with zod. Reuse the pattern for the ledger schema.
- **Package docs** as the destination for indirect rows
  (`docs/box/*.md`, `src/core/docs-gen/package-docs.ts`), card rules
  (`src/core/init-rules.ts`), skills (`src/core/box/skills-content.ts`).

Searched and found nothing: no doc states why any guide paragraph is in the
guide. `docs/prompts/review.md` describes how to review the assembled stack,
not what belongs where.

## Prior art (external)

- Claude Code's own guidance (verified 2026-09-26,
  https://code.claude.com/docs/en/memory): "target under 200 lines per
  CLAUDE.md file. Longer files consume more context and reduce adherence";
  imports "are expanded and loaded into context at launch"; a startup warning
  fires past the recommended length. The guide is imported by the root
  `CLAUDE.md`, so a box session starts with 806 lines in one file.
- Prompt caching (the boxholder's "loaded at the beginning and cached")
  lowers the token cost of the guide, not its attention cost; the vendor
  adherence guidance above is about the latter.
- No external pattern found for "a prompt built from an annotated ledger";
  the nearest is a literate-programming source with a strip step, which is
  the shape Track 2 takes.

## Ontology

- **Row**: one entry in `ledger.yaml`. Fields: `id` (dotted,
  `<section>.<slug>`), `rule` (one sentence, the thing an agent must know or
  do), `handle` (the placemarker of the section that carries it, or the
  surface it moved to), `bin` (`core` | `law` | `indirect` | `derivable` |
  `rationale`), `reason` (why that bin, one or two sentences), `audits`
  (ids in `knowledge-audits.yaml`), `mechanics` (where the how-to lives:
  a package doc, a rule, a skill), `source` (the template file and
  function). A row is the unit of decision; the guide text is its
  rendering.
- **Bin**: the row's tier. `law`: the system cannot tolerate the failure;
  stated first, named, bulletproofed. `core`: an agent on an unknown task
  would err without it; stays in the guide. `indirect`: needed when
  touching one thing; lives on that thing's surface, the guide keeps at most
  a pointer. `derivable`: visible by looking (a schema, `--help`, a
  listing); deleted, no pointer. `rationale`: written for a human; deleted or
  moved to developer docs.
- **Handle** (placemarker): the ALL_CAPS name of a section, in the registry
  section of the ledger with what it governs and who refers to it. Stable
  once registered; a rename is a ledger change with a reason and a sweep of
  referrers. Exists: `SECTION` in `sections.ts`, which the registry
  generates or is checked against.
- **Annotation**: `<!-- rule: <id> -->` on the line before the paragraph
  that renders a row, in the template string. Stripped by the renderer;
  kept by `--annotated`.
- **Skeleton**: the fixed order inside a section: one line saying what the
  handle governs, the rules (each a row), one line saying where the
  mechanics live.
- **Budget**: two numbers in the ledger's header, guide words and
  always-loaded words, that the build test asserts.
- **Spec**: `docs/agent-guide.md`, the developer doc: decision rules for
  binning, the skeleton, how to add a row, and a pointer at the ledger and
  the registry. The ledger holds the data; the spec holds the judgment.

No new card types or shared-vocabulary tags.

## Tracks / scope

### Track 1: the ledger, the registry, and the spec

**What.** `src/core/agent-guide/ledger.yaml` with a zod schema
(`ledger-schema.ts`), a `registry:` section listing every handle, and a
`budget:` header. `docs/agent-guide.md` explains the bins, the skeleton, and
the procedure for adding guidance (row first, with a reason; then text with
an annotation; then the audit).

**Why.** Today the reason a paragraph exists is in a commit message or
nowhere. A future agent adding a feature has no place to argue for the
always-loaded tier and nothing that says no.

**Direction.**

```yaml
budget: { guide_words: 6000, always_loaded_words: 11000 }
registry:
  - handle: THE_LAWS
    governs: the inviolable rules; other sections cite them by name
    referrers: [chat-prompt, PROVENANCE, ABOUT_CARDS]
rows:
  - id: cards.contains-one-sentence
    rule: "`contains:` is one sentence stating what is inside the card, under 200 characters."
    handle: ABOUT_CARDS
    bin: core
    reason: every card an agent writes has it; search and listings depend on it.
    audits: [contains-one-sentence, contains-not-a-list]
    mechanics: box-docs/card-doc.md
    source: cards.ts#aboutCardsSection
```

Every current section gets a handle; the eleven that lack one take the
obvious ALL_CAPS form (KEY_COMMANDS, SEARCHING, DIRECTORY_LAYOUT, ...).
`SECTION` in `sections.ts` becomes derived from the registry, or a doctest
asserts the two lists are equal.

**Budget numbers.** 6,000 guide words and 11,000 always-loaded are the
plan's proposal, from a first read that puts core at 4,000 to 5,000 words
plus the generated CARD_TYPES list. The boxholder sets them; the ledger
header is where they live.

**Vocabulary lock-ins.** Row field names; bin names; the handle form.

**First chunk.** Schema, an empty registry filled with today's handles, the
budget header at today's numbers (so the test passes before any rewrite),
the spec doc, and a doctest that parses the ledger and checks every
`audits:` id exists in `knowledge-audits.yaml`.

### Track 2: annotations, stripping, and the build test

**What.** Templates carry `<!-- rule: <id> -->` before each paragraph. The
renderer strips them; `pnpm agent-context guide --annotated --box <box>`
prints them. A doctest renders the guide from a fixture box and asserts:
every `core` and `law` row is annotated in the render, every annotation
names a row, every paragraph is annotated (an unaccounted paragraph fails),
no annotation leaks into the stripped render, the render's word count is
under `budget.guide_words`, and `agent-context`'s always-loaded total is
under `budget.always_loaded_words`.

**Why.** The ledger is only a source of truth if something fails when the
guide diverges from it. The unannotated-paragraph check is the regrowth
stop: a new paragraph needs a row, and a row needs a reason.

**Direction.** Annotation form is an HTML comment, the same family as the
DOCID marker; a leaked one is harmless, and the doctest asserts none leak
(boxholder lean, 2026-09-26). Paragraph detection: blank-line separated
blocks outside code fences; a list is one paragraph; a heading line is not a
paragraph. The generated CARD_TYPES list is one annotated block
(`card-types.list`), not one row per type.

**First chunk.** Stripping plus the leak check, with the laws annotated as
the first section; the coverage checks land per section as Track 3 bins
them, so the test grows with the rewrite rather than failing wholesale on
day one.

### Track 3: bin every paragraph

**What.** A row for each of the guide's roughly 180 paragraphs, binned, with
the reason. Then the moves: `indirect` rows go to their surface (a package
doc, a card rule, a skill) with the section-hash check confirming a verbatim
move; `derivable` and `rationale` rows are deleted; each deletion names in
the reason what the agent looks at instead.

**Why.** ABOUT_CARDS is 2,137 words; its core is about 300. The rest is the
`prominence:` field (40 lines, indirect: the card rule for landmarks and the
prominence doc hold it), `theme:` (indirect), a list of validation error
messages (derivable: `bbx validate` prints them), and refs rules already in
the laws' reach. Key Commands (681) is mostly usage detail `bbx --help`
gives. How Items Enter the Box (432) is system description an agent rarely
acts on. The pattern repeats in most sections.

**Direction.** One commit per section, in this order: ABOUT_CARDS,
KEY_COMMANDS, HOW_ITEMS_ENTER, DIRECTORY_LAYOUT, CARD_TYPES (keep the type
name plus a five-word description; drop per-type prose beyond that), then
the small sections. Each commit: rows added, moves made, pointer sentences
left, audits named per row run on the clone box. A section's audits failing
reverts that section's commit; the failure goes in the reason.

**First chunk.** ABOUT_CARDS: the biggest section and the one whose core is
clearest. Its twelve existing `card-*` and `contains-*` audits are the gate,
and rows they do not cover get audits before the move.

### Track 4: the rewrite, the laws, and QUESTIONS

**What.** Core rows rewritten to the skeleton: rule, the case where it
bites, pointer. THE_LAWS revisited. QUESTIONS rebuilt from the current
code. Every section gets its handle in the heading.

**Why.** The dense sections that work (the laws, the todo-versus-question
paragraph) state the rule and name the temptation; the loose ones describe
the system and let the agent infer. The laws are three, all about the
record; the one observed failure they do not cover is an agent answering
from memory what it could have checked. QUESTIONS predates the learning
sinks, the question-followup job, and the todo-review procedure as they now
exist.

**Direction, the laws.** Four:

- THE_LAW_OF_QUOTING, THE_LAW_OF_SAVING: as they are.
- THE_LAW_OF_CARDS, sharpened: a card, never an ad hoc file; a `.md` in the
  tree is not a record; `.doc.card` is the default for prose. The temptation
  is named ("a quick `.md` note is faster").
- THE_LAW_OF_CHECKING, new: when the answer depends on a fact you can check,
  check it before answering: the box with `bbx search`, the engine docs, the
  web for anything outside the box. Temptation: "I probably know this."
  Guarded by new pressure audits that hand the agent a question whose
  answer changed after its training cutoff and expect a search or fetch
  before the answer.

Dropped after discussion: HONESTY and AUTHORITY (no observed failure), KEYS
and KEEPING (stated strongly in their sections; not seen slipping). The
spec records this so the next person does not re-derive it.

**Direction, QUESTIONS.** Read `src/core/question-aging.ts`,
`question-alert.ts`, the `question` and `question-followup-job` schemas, and
the todo-review procedure; write the rows from the code; then the text. The
in-chat-ask-directly rule and the check-existing-questions rule are core;
the `learning:` sink mechanics are indirect (the question card's own doc).

**Direction, the skeleton.** Each section: `## HANDLE` (one line on what it
governs), the rules as short paragraphs or a list, one closing line
"Mechanics: `<doc>`." Bulletproofing (name the excuse, rebut it) only on a
law or on a rule whose audits have shown slippage; the reason field says
which.

**First chunk.** THE_LAWS: the sharpened CARDS and the new CHECKING, with
two pressure audits each, run on the clone box.

### Track 5: the chat system prompt joins the ledger

**What.** Rows for the 3,943-word chat system prompt
(`src/core/chat/session/prompts.ts`), with `handle: chat-prompt`, binned
the same way; overlaps with the guide (links and embeds, views, todos)
resolved to one home with the other side pointing.

**Why.** The ledger's purpose is one accounting of the always-loaded tier.
The chat prompt is a third of it and overlaps the guide in at least three
places.

**Direction.** Ledger rows and the overlap resolution in this plan; the
prompt's own rewrite to the skeleton is a follow-on plan, because the prompt
carries transport-specific instructions (attachments, speech, selections)
that need their own read against the code.

## Could this be simpler?

**Simplest version:** the budget warning in `generateDocs` plus a one-off
trim of ABOUT_CARDS and KEY_COMMANDS. About 60 source lines and a day of
prose work. It gets the guide to perhaps 7,500 words.

**What the fuller plan buys.** The simple version fails the next time a
feature lands: nothing records why its paragraph should not be in the guide,
so the trim is undone paragraph by paragraph, which is how 3,355 words
became 11,399 (organizing principle: one home per fact, applied to the
decisions themselves). The annotation test is what makes the ledger binding
rather than advisory; without it the ledger is a third document that
drifts. The law and QUESTIONS work is judgment the trim would not do.

Over-builds rejected: generating the guide text from the ledger (the text
needs an author; the ledger holds decisions, not prose); one row per card
type in CARD_TYPES (the list is one decision); a linter that scores
paragraphs for "core-ness" (judgment, not automation); annotating the
package docs too (they are on-demand; the budget problem is the always-loaded
tier).

## Subplans

none. The chat prompt's rewrite (Track 5's follow-on) will be its own plan
when Track 5 has produced the rows it needs.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A moved rule stops being followed (the agent does not read the doc it now points at) | the row's `audits:`, re-leveled to `knows_about` | revert that section's commit | clear |
| The annotation strip misses a comment and it reaches a box | Track 2 leak check | none needed | clear |
| A new paragraph lands without a row | Track 2 unannotated-paragraph check | none needed | clear |
| A handle is renamed and a referrer keeps the old name | registry `referrers:` plus a grep in the doctest for each handle in the chat prompt and the section templates | none | clear |
| The budget is met by moving too much, and the agent errs on ordinary turns | the whole audit suite on the clone box after each track; the name-only walks | revert | clear only if an audit covers the errant behavior |
| Pressure audits for THE_LAW_OF_CHECKING pass because the model happens to know the answer | audit prompts use facts dated after the model's cutoff and assert a WebSearch or WebFetch tool call | none | clear |
| QUESTIONS rewritten from a misread of the code | the existing question audits plus a read-against-code Codex review of that commit | none | clear |
| The ledger and `SECTION` diverge | Track 1 doctest | none | clear |

> **Critical gap:** none unresolved. The fifth row is the residual risk: a
> behavior no audit covers can regress unseen. The mitigation is the rule
> that a row moved out of `core` needs at least one audit, so the audit set
> grows where the guide shrinks.

## Agent-flow / user-flow edge cases

- **Wrong bin** (a rule filed `indirect` that ordinary turns need):
  ADDRESSED by the per-row audits and the revert rule; the reason field
  records the judgment for the next reader.
- **Stale pointer** (a pointer names a doc that moves): ADDRESSED by
  `test/core/box-docs-pointers.doctest.md` from phase two, extended to the
  ledger's `mechanics:` field.
- **Two writers** (a feature branch adds a guide paragraph while this plan
  rewrites the section): GAP during the plan's life; the unannotated
  paragraph check on `main` after Track 2 lands turns the collision into a
  test failure at their landing, which is the right place.
- **Hand-edit drift**: the guide is generated per box; not applicable.
- **Validation error UX**: the doctest failure message names the paragraph
  and the missing row id; ADDRESSED in Track 2's design.
- **Partial state**: between tracks the ledger covers some sections and the
  coverage check is enabled per section, so a half-done state is a passing
  test with fewer sections covered, never a failing main.

## NOT in scope

- **Rewriting the chat system prompt's text**: Track 5 adds its rows and
  resolves overlaps; the rewrite is a follow-on plan.
- **The reactor prompt** (`src/core/reactor/prompts.ts`): it is not
  always-loaded in chat; same treatment later if wanted.
- **Auto-injecting a "slim down" prompt** when the budget is exceeded (the
  size-budget issue's proposal): the check warns; trimming is judgment.
- **Generating guide prose from the ledger**: the ledger holds decisions.
- **Package docs, rules, skills content**: destinations for moved rows,
  edited only to receive them.
- **Personality section**: box-compiled from the personality card; a row
  records it as `core` by owner, no rewrite.
- **A law for honesty, authority, keys, or keeping**: considered and
  dropped for lack of an observed failure; recorded in the spec.

## Open design questions

1. **Budget numbers.** 6,000 guide words and 11,000 always-loaded are the
   proposal. Lean: set them after Track 3's binning shows the core size,
   with the ledger header carrying today's numbers until then so the test
   never fails on a number nobody chose.
2. **Handle style for the currently unnamed sections.** `KEY_COMMANDS` and
   `SEARCHING` read naturally; "Speak the User's Language" and "Where to
   Record What You Find" do not shorten well (`SPEAKING`, `RECORDING`?).
   Lean: short nouns, and the heading keeps a plain-language subtitle after
   the handle, as PROVENANCE does today.
3. **Whether CARD_TYPES keeps a description per type.** Lean: five words per
   type; the list is how an agent picks a type without opening sixty docs.

## Knowledge audits

- Every row moved out of `core` carries at least one audit at `knows_about`
  with `should_read_any` naming its new home; existing audits are re-leveled
  before new ones are written.
- THE_LAW_OF_CHECKING: two pressure audits (a fact outside the box dated
  after the model cutoff; a fact inside the box the prompt tempts the agent
  to assume), each asserting the tool call, `bash_contains: ["bbx search"]`
  or a WebSearch/WebFetch observation. The runner
  (`src/dev/lib/test-runner.ts:287-296`) records Grep, Glob, and shell
  searches today and not the web tools, so Track 4 extends it first.
- THE_LAW_OF_CARDS sharpened: one pressure audit offering the agent a reason
  to write a loose `.md`.
- QUESTIONS: the existing `question-*` audits, re-read for currency, run
  after the rewrite.
- All run on the worktree clone box; status comments recorded.

## What will hold this after it ships

- The Track 2 doctest: coverage both ways, no leaks, budget. Cheap; runs in
  the fixture tier `agent-guide-*.doctest.md` already uses.
- The Track 1 doctest: ledger parses, audits exist, registry equals `SECTION`.
- The audits themselves, weekly by the existing schedule.
- The spec doc's procedure, which the unannotated-paragraph check enforces.
- The weekly review line added to `docs/box-guidance.md` in phase two, which
  now also asks whether any new ledger row's reason holds.

## Implementation order

1. Track 1 (schema, registry, spec, budget at today's numbers).
2. Track 2 stripping and leak check; annotate THE_LAWS.
3. Track 4 first chunk: the two laws, pressure audits run.
4. Track 3 per section, ABOUT_CARDS first; Track 2's coverage check enabled
   for each section as it is binned; Track 4's rewrite of that section's
   core in the same commit where the section is small, a following commit
   where it is not.
5. Track 4 QUESTIONS.
6. Track 5 rows and overlap resolution.
7. Budget numbers set; Track 2's budget assertion enabled; after-measurement
   (word counts, audit baselines, ten name-only walks) recorded here.

Each track's commits get a Codex diff review; the plan ships as one piece
when the boxholder says so.

## Rollout shape

Tests first: the Track 2 doctest is written against the current guide with
coverage disabled, so stripping and leak detection are proven before any
annotation exists; coverage turns on per section. Done-when per section:
its rows exist, its audits pass on the clone, the section-hash check reports
zero missing bodies for moved text. Done-when for the plan: coverage on for
every section, budget assertion on, the full audit suite green on the clone,
and the after-measurement recorded. No data migration: the guide is
regenerated per box on the next sync, and boxes pick up the new render the
way they picked up phase two's.
