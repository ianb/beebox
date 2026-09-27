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
task arrives. Its source grew from 3,355 words at `f2da8f5f2` (2026-04-27,
the first commit of `src/core/agent-guide/`) to 11,435 at `35964e981`
(2026-09-26, before phase two's demotions), one justified paragraph per
feature, because nothing asked each paragraph to earn its place on the
always-loaded tier. Phase two left 9,870 at `02ea3470f`. Count: every
`src/core/agent-guide/*.ts` at the commit, `git show` piped to `wc -w`, so
code and comments are included; the rendered guide on the test1 clone is
9,234 words by `wc -w` on `.beebox/agent-guide.md`.

This plan gives the guide a source of truth it can be semantically rebuilt
from: a YAML ledger with one row per rule, its reason, its tier, and the
audits that guard it; a registry of stable placemarkers; annotations in the
guide's source tying each paragraph to a row; a doctest that holds the two in
step; and a size budget. It then rewrites the guide against that ledger:
every block binned by an ordered test as law, core, indirect, or delete; the core
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

**Chosen design, four tracks.**

| Track | What | Source + test lines | Prose |
|---|---|---|---|
| 1 Ledger and registry | `src/core/agent-guide/ledger.yaml`, its schema, the placemarker registry, `docs/agent-guide.md` (spec: decision rules, build shape) | ~300 | ~250 |
| 2 Annotations and the build test | annotation syntax in the section templates, stripping in the renderer, `pnpm agent-guide --annotated`, doctest: coverage both ways, no leaks, budget | ~350 | 0 |
| 3 Binning | every block of the current guide gets a row and a bin; indirect rows move to their surface; delete rows go with a stated substitute | ~200 | ~2,500 moved or deleted |
| 4 The rewrite | core rows rewritten to the section skeleton; THE_LAWS gains CHECKING and a sharpened CARDS; QUESTIONS rebuilt from the code; every section gets a handle | ~800 (template text) | ~800 |

Source and test about 1,650 lines, prose about 3,550 moved, deleted, or
rewritten. Counted together this is a **BIG CHANGE**; the boxholder asked for
the strong approach on 2026-09-26 ("we need a strong approach to that guide,
since it's important"). Track 4 is the one that can be deferred without
leaving the guide half-specified (see Could this be simpler).

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

- **Section functions and handles**: `src/core/agent-guide/index.ts:74-109`
  assembles 21 sections into the array and `:111-114` appends the optional
  personality section; `sections.ts:19` defines the `SECTION` constants
  (THE_LAWS, the three law names, ABOUT_CARDS, CARD_TYPES, QUESTIONS, TODOS,
  PROVENANCE). The chat prompt imports `SECTION`
  (`src/core/chat/session/prompts.ts:15-17`) and names TODOS at `:121`; the
  laws name PROVENANCE and ABOUT_CARDS (`laws.ts`). Reuse: the registry is these
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
  surface it moved to), `bin` (`law` | `core` | `indirect` | `delete`), `reason` (why that bin, one or two sentences), `audits`
  (ids in `knowledge-audits.yaml`), `mechanics` (where the how-to lives:
  a package doc, a rule, a skill). A row is the unit of decision: what must
  be said and why. How it is said is the document's business.
- **Bin**: the row's tier, decided by an ordered test so one row fits
  exactly one bin. Ask in order and stop at the first yes: (1) would the
  system be unable to tolerate an agent breaking this? `law`. (2) Would an
  agent on a task it cannot predict err without it? `core`. (3) Does it
  apply only when touching one thing (a field, a command, a card type)?
  `indirect`: it lives on that thing's surface and the guide keeps at most
  a pointer. (4) Otherwise `delete`: the agent can see it by looking (a
  schema, `--help`, a listing) or it was written for a human; the reason
  says which and what the agent looks at instead. A `delete` row never
  keeps a pointer; if a pointer is needed, the answer to (3) was yes.
- **Handle** (placemarker): the ALL_CAPS name of a section, in the registry
  section of the ledger with what it governs and who refers to it. Stable
  once registered; a rename is a ledger change with a reason and a sweep of
  referrers. Exists: `SECTION` in `sections.ts`, which the registry
  generates or is checked against.
- **Document**: `src/core/agent-guide/guide.md`, the hand-written guide,
  authored as one piece. Generated parts (the card-type list, this box's
  procedures and guides, the directory layout, the personality section) are
  placeholders like `{{card_types}}`. It opens with a comment block that
  tells an editing agent the rules: cite rows, keep the budget, add a row
  before adding a rule, and the ordered bin test in short. The prose moves
  here out of the seventeen TypeScript template files.
- **Annotation**: `<!-- rules: <id>, <id> -->` before a paragraph, list, or
  example, naming every row that passage carries. Many to many: one passage
  may carry several rows, and a row may be cited by several passages where
  restating it is what good writing wants. Stripped by the renderer, which
  fills placeholders and strips comments in one pass; kept by
  `--annotated`.
- **Skeleton**: the shape a section tends toward, not a template: one line
  saying what the handle governs, the rules, one line saying where the
  mechanics live. Prose that does double duty is preferred over one
  paragraph per row.
- **Budget**: two numbers in the ledger's header, guide words and
  always-loaded words, that the build test asserts.
- **Spec**: `docs/agent-guide.md`, the developer doc: decision rules for
  binning, the skeleton, how to add a row, and a pointer at the ledger and
  the registry. The ledger holds the data; the spec and the document's
  header comment hold the judgment, and the linter holds what a machine can
  check.

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
```

Every current section gets a handle; the eleven that lack one take the
obvious ALL_CAPS form (KEY_COMMANDS, SEARCHING, DIRECTORY_LAYOUT, ...).
`SECTION` in `sections.ts` becomes derived from the document's headings
and checked against the registry, so a handle exists in exactly one place.

**Budget numbers.** 6,000 guide words and 11,000 always-loaded are the
plan's proposal, from a first read that puts core at 4,000 to 5,000 words
plus the generated CARD_TYPES list. The boxholder sets them; the ledger
header is where they live.

**Vocabulary lock-ins.** Row field names; bin names; the handle form.

**First chunk.** Schema, an empty registry filled with today's handles, the
budget header at today's numbers (so the test passes before any rewrite),
the spec doc, and a doctest that parses the ledger and checks every
`audits:` id exists in `knowledge-audits.yaml`.

### Track 2: the document, the renderer, and the linter

**What.** The guide's prose moves from the section functions into
`guide.md`, annotated. The renderer reads it, fills placeholders, and strips
comments in one pass; `pnpm agent-context guide --annotated --box <box>`
prints the annotated form. A linter, run as a doctest and from
`pnpm lint:guide`, asserts: every cited id is a ledger row; every `core` and
`law` row is cited at least once; uncited words per section stay under an
allowance (a number in the ledger header, proposed 60) so framing and
transitions are free but a new uncited paragraph is not; no comment leaks
into the stripped render; the DOCID line survives; the render is under
`budget.guide_words` and `agent-context`'s always-loaded total under
`budget.always_loaded_words`.

**Why.** The ledger is only a source of truth if something fails when the
document diverges from it. No mechanical rule can prove that every sentence
is connected to a row without deconstructing the document into one
paragraph per row, which is the failure mode of generated prose (boxholder,
2026-09-26). So the linter checks what a machine can (ids exist, rows are
covered, uncited text is bounded, the budget holds) and the document's
header comment tells the editing agent the rest: cite what you write, add
the row before the rule, and keep prose that serves several rows at once.

**Direction.** An annotation is `<!-- rules: a, b -->` on the line before
the passage it describes and covers that passage up to the next blank line
(so a list or a fenced example is one passage). Generated content today
lives in section functions (`cards.ts:29-35,137-169` builds card examples;
`cards.ts:216-246` groups card types from the schemas;
`extensibility.ts:14-42` lists this box's procedures and guides); each
becomes a placeholder whose filler stays in TypeScript, and the placeholder
line carries its own annotation (`<!-- rules: card-types.list -->`), so
per-box variation inside it is covered without per-box rows and counts as
cited text. The renderer strips only `<!-- rules: ... -->` and the header
comment, and runs before `withDocId` (`src/core/docs-gen/index.ts:400-403`
wraps the render), so the DOCID marker is untouched. Uncited words are
counted per section on the rendered text with the placeholders filled from
the bare fixture.

**First chunk.** Move the prose into `guide.md` verbatim (section-hash
check: zero bodies changed), placeholders for the generated parts, the
one-pass renderer, the leak and DOCID checks, and the header comment. The
coverage and allowance checks enable per section as Track 3 bins them, so
the linter grows with the rewrite rather than failing wholesale on day one.

### Track 3: bin every passage

**What.** A row for each of the guide's roughly 180 blocks, binned by the
ordered test, with the reason. Then the moves: `indirect` rows go to their
surface (a package doc, a card rule, a skill) with the section-hash check
confirming a verbatim move, and `test/core/box-docs-pointers.doctest.md`
extended to the ledger's `mechanics:` field; `delete` rows go, each naming
in its reason what the agent looks at instead. Package-doc, rule, and skill
edits are in scope here: a moved block changes what an agent reads on
demand, so each receiving doc's read-when line is checked against the new
content and the section's audits run at `knows_about`.

**Why.** ABOUT_CARDS is 2,137 words; its core is about 300. The rest is the
`prominence:` field (40 lines, indirect: the card rule for landmarks and the
prominence doc hold it), `theme:` (indirect), a list of validation error
messages (delete: `bbx validate` prints them), and refs rules already in
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
from memory what it could have checked. QUESTIONS is current on its
mechanics (`cards.ts:249-279` matches `src/schemas/question.ts:174-202` and
`question-followup-job.ts:26-68`) but carries the `learning:` sink
mechanics inline, which the ordered test files as indirect, and omits two
things the code does: the new-question alert
(`src/core/question-alert.ts:69-90`) and the nudge and expiry defaults
(`src/core/question-aging.ts:38-52,150-153`).

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

**Direction, QUESTIONS.** Rows from the code: the in-chat-ask-directly rule,
the job-time default, and the check-existing-questions rule are core; the
`learning:` sink and `directive:` mechanics are indirect (the question
card's own doc, `card-question.md`); the alert and the aging defaults get
one core sentence each so an agent knows a question is seen and does not
wait forever. The section is rewritten to the skeleton, not from scratch.

**Direction, the skeleton.** Each section: `## HANDLE` (one line on what it
governs), the rules as short paragraphs or a list, one closing line
"Mechanics: `<doc>`." Bulletproofing (name the excuse, rebut it) only on a
law or on a rule whose audits have shown slippage; the reason field says
which.

**First chunk.** THE_LAWS: the sharpened CARDS and the new CHECKING, with
two pressure audits each, run on the clone box.

## Could this be simpler?

**Simplest version:** the budget warning in `generateDocs` plus a one-off
trim of ABOUT_CARDS and KEY_COMMANDS. About 60 source lines and a day of
prose work. It gets the guide to perhaps 7,500 words and is undone
paragraph by paragraph by the next features, which is how 3,355 words
became 11,435.

**The middle version:** Tracks 1 and 2 with the ledger holding rows only
for moved and deleted blocks, the registry, the linter, and the budget;
no rewrite of the core, no law changes, no QUESTIONS work. That bounds
regrowth (uncited text is capped per section) and records every removal,
at about a third of the cost.

**What the fuller plan buys over the middle.** With rows only for what
moved, the roughly 4,500 words that stay have no stated reason to stay, so
the next review cannot tell "core, argued" from "never examined", and the
budget number is a guess. The rewrite is where the adherence gain is: the
dense sections that work state the rule and name the temptation, and the
loose ones do not; a ledger over unchanged prose changes nothing an agent
reads. The law changes answer an observed failure. If the cost is the
objection, the middle version is Tracks 1 to 3 without Track 4, and Track 4
becomes its own plan; the ledger carries either way.

Over-builds rejected: generating the guide text from the ledger (the text
needs an author; the ledger holds decisions, not prose); one row per card
type in CARD_TYPES (the list is one decision); a linter that scores
paragraphs for "core-ness" (judgment, not automation); annotating the
package docs too (they are on-demand; the budget problem is the always-loaded
tier).

## Subplans

none. The chat prompt's ledger and rewrite is a follow-on plan, not a
subplan: it can start only after this plan has fixed the row form.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A moved rule stops being followed (the agent does not read the doc it now points at) | the row's `audits:`, re-leveled to `knows_about` | revert that section's commit | clear |
| The annotation strip misses a comment and it reaches a box | Track 2 leak check | none needed | clear |
| A new paragraph lands without a row | Track 2 uncited-words allowance per section; the header comment tells the editor to cite | an agent review at landing is the real check (boxholder, 2026-09-26: no mechanical rule proves every sentence is connected) | clear past the allowance; silent under it |
| A handle is renamed and a referrer keeps the old name | registry `referrers:` plus a grep in the doctest for each handle in the chat prompt and the section templates | none | clear |
| The budget is met by moving too much, and the agent errs on ordinary turns | the whole audit suite on the clone box after each track; the name-only walks | revert | clear only if an audit covers the errant behavior |
| Pressure audits for THE_LAW_OF_CHECKING pass because the model happens to know the answer | audit prompts use facts dated after the model's cutoff and assert a WebSearch or WebFetch tool call | none | clear |
| QUESTIONS rewritten from a misread of the code | the existing question audits plus a read-against-code Codex review of that commit | none | clear |
| The ledger and `SECTION` diverge | Track 1 doctest | none | clear |
| A box's own schemas, guides, procedures, or personality render content the fixture never showed, pushing a section over its allowance or the guide over budget | Track 2 linter runs on two fixtures: a bare box and one with a box-local schema, a guide card, a procedure, and a personality card; generated content is cited through its placeholder's annotation by construction | budget asserted on the bare fixture, reported for the rich one and for the clone box | clear on the fixtures; a real box's overage shows only in the `agent-context` number |

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
  rewrites the section): GAP during the plan's life; the uncited-words
  allowance on `main` after Track 2 lands turns a sizeable collision into a
  test failure at their landing, which is the right place; a small one is
  caught by the review the header comment asks for.
- **Hand-edit drift**: the guide is generated per box; not applicable.
- **Validation error UX**: the linter's failure message names the section,
  the uncited word count against the allowance, or the paragraph
  and the missing row id; ADDRESSED in Track 2's design.
- **Partial state**: between tracks the ledger covers some sections and the
  coverage check is enabled per section, so a half-done state is a passing
  test with fewer sections covered, never a failing main.

## NOT in scope

- **The chat system prompt** (`src/core/chat/session/prompts.ts`, 3,943
  words, loaded for chat sessions only; its header at `:8-12` scopes it to
  the chat control surface): a different surface from the guide every box
  agent gets. It overlaps the guide in at least three places (links and
  embeds, views, todos) and deserves the same ledger treatment as a
  follow-on plan once this one has set the form.
- **The reactor prompt** (`src/core/reactor/prompts.ts`): it is not
  always-loaded in chat; same treatment later if wanted.
- **Auto-injecting a "slim down" prompt** when the budget is exceeded (the
  size-budget issue's proposal): the check warns; trimming is judgment.
- **Generating guide prose from the ledger**: the ledger holds decisions.
- **Rewriting package docs, rules, or skills beyond receiving moved
  blocks**: Track 3 edits them to receive content and checks their
  read-when lines; their own structure is phase two's and stays.
- **Personality section**: box-compiled from the personality card; a row
  records it as `core` by owner, no rewrite.
- **A law for honesty, authority, keys, or keeping**: considered and
  dropped for lack of an observed failure; recorded in the spec.

## Open design questions

Settled 2026-09-26 with the boxholder ("I'm not too concerned about the
budget if we follow the rules. So go to work"):

1. **Budget numbers.** The ledger header starts at today's measured numbers
   (guide 9,234 rendered words, always-loaded 14,194 on the test1 clone) so
   the linter asserts no growth from day one; the numbers are lowered to the
   measured result when Track 3 and 4 finish. The rules, not the number,
   are the discipline.
2. **Handles for the unnamed sections.** Short nouns, with the plain
   heading kept as a subtitle after the handle, as PROVENANCE does today.
3. **CARD_TYPES.** Keeps a five-word description per type.
4. **Track 4** runs in this plan.

## Knowledge audits

- Every row moved out of `core` carries at least one audit at `knows_about`
  with `should_read_any` naming its new home; existing audits are re-leveled
  before new ones are written.
- THE_LAW_OF_CHECKING: two pressure audits (a fact outside the box dated
  after the model cutoff; a fact inside the box the prompt tempts the agent
  to assume), each asserting the tool call, `bash_contains: ["bbx search"]`
  or a web search observation. Today the Claude runner records Read, Grep,
  Glob, and Bash only (`src/dev/lib/test-runner.ts:280-298`;
  `src/shared/known-tools.ts:13-23` lists no web tool), while the Codex
  runner already records provider searches
  (`src/dev/lib/codex-audit-behavior.ts:14-31`); and the audit schema has no
  search assertion (`src/dev/lib/test-suite-schema.ts:20-43`). Track 4
  first adds WebSearch and WebFetch to the Claude capture and a
  `should_search` field checked in `audit-checks.ts`.
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
- The spec doc's procedure and the document's header comment, which the
  linter backs up with the allowance and the coverage checks.
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
6. Budget numbers set; Track 2's budget assertion enabled; after-measurement
   (word counts, audit baselines, ten name-only walks) recorded here.

Each track's commits get a Codex diff review; the plan ships as one piece
when the boxholder says so.

## Codex plan review (2026-09-26)

Eleven findings, all adopted: the annotation model was reworked (first to
spans; then, after the boxholder's read, to a hand-written document with
many-to-many `rules:` annotations, a one-pass renderer, and a linter with
an uncited-words allowance in place of a per-paragraph gate); the bins became an ordered four-way test; the web-tool
capture claim now distinguishes the Claude runner, the Codex runner, and
the missing `should_search` assertion; the QUESTIONS premise was corrected
from "stale" to "current mechanics, two omissions, one indirect block"; the
growth numbers carry commits and the counting command; two citations were
made exact; per-box variability became a failure-mode row with two
fixtures; the middle design is named in Could this be simpler; package-doc
edits moved into Track 3's scope; and the chat-prompt track was cut to a
follow-on plan since that prompt is a chat-only surface.

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
