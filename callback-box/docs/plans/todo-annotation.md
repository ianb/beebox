# `{% todo %}` — universal todo annotation

A universal Markdoc annotation that marks any content in any card body (or a
card's frontmatter) as an open todo, plus the machinery that makes such
annotations trustworthy: a collector/query command, human-facing surfaces, and
an agent tending loop. The tag is the capture mechanism; the surfacing and
tending are what make it a system rather than decoration.

Supersedes the mechanism sketch in
`issues/features/2026-07-28-todo-markdoc-annotation.md`.

## Goals (what this is for)

Decided goals-first with the boxholder (2026-07-28); the mechanism below is
justified by these, not the other way around.

1. **Frictionless capture in context.** An intention is noted where it arises —
   mid-card, mid-memo, in frontmatter — without switching to a dedicated task
   surface. The card the todo lives in *is* its context. (The dedicated-list
   model already failed here: the `todo-list` card type exists and is unused —
   "I never use it, so it's not good clearly.")
2. **A trusted open-loop system.** Once captured, a todo must resurface without
   the human re-finding it. Every comparable inline system (org-mode, Obsidian
   Tasks, Logseq) fails by default here: an annotation with no surfacing
   metadata becomes permanently invisible — the todo graveyard. Design rule
   derived from that: **an undated open todo is on the plate *now*; quiet
   states are explicit (`parked`), never an accident of missing metadata.**
3. **Machine-legible for aggregation.** One collector reads every todo across
   the box; everything else (views, agent queries, ambient context, the
   Echo Show dashboard feed —
   `issues/features/2026-07-27-echo-show-display-dashboard-view.md`) is a
   consumer of that collector.
4. **The agent runs the review loop; the human keeps judgment.** The step
   humans reliably skip (GTD's weekly review) is the step the agent can do:
   notice staleness, suggest completion, deduplicate — surfacing and asking,
   never silently auto-resolving. Per the standing posture: arrange context,
   don't automate judgment.
5. **Agent work rides the same vocabulary.** `assigned="agent"` makes a todo
   the agent's to chase (the "commitments" concept from the OpenClaw research,
   `research/openclaw-hermes/deep-openclaw-commitments.md`) — one vocabulary,
   with `assigned` selecting the consumption channel.

## Stated preferences this plan trades against

- `callback-box/docs/engineering-principles.md` — especially
  validate-at-boundaries (attribute enums validated at parse time),
  resilient-not-silent (parse failures must not silently hide todos), and
  types-are-structure (status is a closed union, exhaustively dispatched).
- `callback-box/CLAUDE.md` — the cards format ("YAML frontmatter + markdown
  body"), "Read before writing," "keep source and docs generic — never
  hardcode personal names" (examples below use the `docs/example-names.md`
  roster).
- `callback-box/code-style.md` — exhaustiveness (`assertNever` over status),
  no silent catches, one shape not two (single frontmatter entry shape).
- **Shipped precedents (densest source):** `{% quote %}` / `{% source %}` in
  `src/shared/markdoc-config.ts:126-186` (inline/block split via
  `node.inline`; typed attributes; `validate()` for ref-xor-href; the
  `ref` → `sourceRef` React rename), and the questions subsystem
  (`docs/questions.md`) as the in-house proof that a pending-intent mechanism
  earns trust through lifecycle + aging + a badge + a single glob-able
  location.
- Boxholder decisions from the design discussion (2026-07-28): metadata in
  attributes; `status` over a done-date (git history carries the timestamp);
  no grouping keys — one annotation is one todo, context via nested
  `{% see-also %}`; `start` as the primary surfacing trigger with `due` as
  the "oh shit" line; `cb todos` is designed for agent consumption; a
  frontmatter key for todos that don't fit inline.

## What already exists

- **The shared Markdoc vocabulary** — `src/shared/markdoc-config.ts` (one
  config for the frontend renderer, `cb validate`, and dev docs; header
  comment: "Add new tags here"). **Reused**: `todo` and `see-also` are added
  here, making them universal by construction.
- **⚠️ Markdoc body validation is NOT universal today** (Codex cross-review
  finding, verified): `card-lint.ts` extracts body refs but never calls
  `Markdoc.validate`; only commentary cards run it, via their schema
  `validate` hook — `src/schemas/commentary.tsx:30-32`: *"nothing else runs
  `Markdoc.validate`, so this is where it lands."* A todo attribute error in
  an ordinary memo would be silent. **Built here**: Track 1 adds a generic
  raw-body Markdoc parse+validate pass to `card-lint` for every card with a
  markdown body — a prerequisite for every "validation catches it" row in the
  Failure modes table, and it retroactively enforces existing tag rules
  (e.g. `source-ref-xor-href`) everywhere. Survey test1 and prod for newly
  surfaced violations before flipping it from warning to error.
- **Inline/block wrapper pattern** — `markdoc-config.ts:126-135` (`quote`:
  `new Tag(node.inline ? "QuoteInline" : "QuoteBlock", …)`). **Reused** for
  `TodoInline`/`TodoBlock`.
- **Ref integrity, for free** — `src/core/body-refs.ts:60-66` walks *every*
  body tag for an attribute literally named `ref` ("walks every tag node for
  an attribute literally named `ref`"), feeding card lint
  (`src/core/card-lint.ts:147`); `src/core/rewrite-card-refs.ts:21,286`
  rewrites body `ref="…"` attributes on `cb mv`. **Reused**: a nested
  `{% see-also ref="…" %}` gets lint + move-rewrite with zero walker changes.
- **Ref-xor-href validation** — `markdoc-config.ts:159-174`
  (`source-ref-xor-href`). **Reused** verbatim for `see-also`.
- **The `task` tag / GFM checkboxes** — `markdoc-config.ts:291-299` (task) and
  `:333-355` (the `[ ]` → `Task` item rewrite); rendered as a *disabled*
  checkbox in `src/frontend/src/components/Markdown.tsx:263-271`. Per its own
  doc comment ("internal: GFM task-list checkbox. Not authored directly"),
  `task` is already internal-only. **Kept as-is**: checkboxes stay display-only
  decoration; `todo` is the deliberate capture form. No deprecation needed.
- **Universal frontmatter fields** — `src/cards/schema.ts:72-77` (`title`,
  `contains` are optional on every schema). **Reused**: the `todos:`
  frontmatter key joins them.
- **`todo-list` card schema** — `src/schemas/todo-list.ts` + renderer
  `TodoListView.tsx` + `todosRouter.updateItem` (live and registered today;
  slated for retirement by this design). Unused in practice. **Not rebuilt,
  not yet removed** — retirement is a follow-up migration (see NOT in scope).
- **Cross-card aggregation precedent** — test1's hand-authored
  `src/views/todos.tsx` (in the box at `~/src/boxes/test1/`, outside this
  repo; globs `store/todos/**/*.todo-list.card` into one page) proves the
  aggregation shape; and the questions pipeline (`src/core/state.ts:70-90`
  recursively collects `.card` files under `box/questions/`; `QuestionsPage`;
  header badge via `status.questions`) is the shipped pattern for
  "collect → tRPC → page + badge." **Reused as the pattern** for the todos
  page.
- **Per-directory ambient context** — the maps system
  (`src/core/maps/finalize.ts:5`: "Ensure each mapped directory has a
  CLAUDE.md that @-imports MAP.md"). **Reused** as the channel for
  subtree-scoped todo summaries.
- **Agent-guide sections** — `src/core/agent-guide/` (e.g. the questions
  guidance in `cards.ts`). **Reused**: a new todos section teaches capture,
  querying, and tending.
- **Body-emit for agent-facing markdown** — `src/core/markdoc/emit-tags.ts`
  (universal/briefing/recipe groups; unknown tags fall back to inner text).
  **Extended**: `todo` joins the universal group so briefing/compiled
  surfaces emit its text with a status marker instead of dropping metadata.

## Prior art (external)

The mechanism (a Markdoc tag in our own shared config) is purely internal —
no third-party feature beyond Markdoc custom tags, which the codebase already
exercises heavily. External design prior art was swept via the `research/`
corpus and general knowledge (2026-07-28, this session):

- **Org-mode agenda** — the canonical capture-inline / aggregate-in-a-
  generated-view split this design copies; also the canonical graveyard
  failure (undated TODOs invisible in the default agenda), which Goal 2's
  "undated = now" rule is the direct answer to.
- **Obsidian Tasks / Logseq / Roam** — same pattern, same failure; also show
  metadata-in-line (emoji/keyword) is fragile to typos → we use validated
  attributes with enumerated `status` instead.
- **GTD / OmniFocus** — the review loop is the part humans skip; only systems
  with a forcing function avoid staleness → Goal 4 assigns that loop to the
  agent. `parked` carries GTD's someday/maybe semantic under a plainer name
  (boxholder call: "someday" didn't read; "parking lot" was his own word).
- **OpenClaw commitments** (`research/openclaw-hermes/deep-openclaw-commitments.md`,
  deep-dive in-corpus) — the closest agent-managed precedent. Adopted:
  provenance field distinguishing agent-inferred from user-stated; treating
  agent-written free text as data-not-instructions at consumption; explicit
  triage decoupled from surfacing. Rejected: resolution decided by the same
  live call that surfaces the item; silent TTL expiry.
- **gstack TODOS.md** (`research/gstack/notes/plan-eng-review.md`) — "A TODO
  without context is worse than no TODO"; capture-in-place plus
  `{% see-also %}` is the answer.
- No search found prior art for *relevance-triggered* (non-date) resurfacing
  done well in mainstream tools; Memory Atlas's `whenUseful`
  (`research/memory-atlas-architecture-review.md`) is the nearest concept and
  is deferred (NOT in scope).

## Tracks / scope

Ordered by implementation dependency, then surface size.

### Track 1 — the `{% todo %}` and `{% see-also %}` tags + rendering

**What.** Add `todo` (wrapper, inline or block) and `see-also` (wrapper,
ref-carrying, rendered footnote-style) to `src/shared/markdoc-config.ts`, with
React components in `Markdown.tsx`.

**Why.** No deliberate, machine-legible capture form exists today — checkboxes
are decoration (Goal 1, Goal 3).

**Direction — the shape:**

```markdoc
{% todo id="vet-refill" assigned="Dana" created="2026-07-28" due="2026-08-01" start="-3d" %}
Call the vet about Biscuit's prescription refill
{% see-also ref="people/Dana_Whitfield.person.card" %}Dana offered to pick it up{% /see-also %}
{% /todo %}
```

Attributes (all optional — a bare `{% todo %}…{% /todo %}` is a valid open
todo on the plate now):

- `id` — short human-scale slug for cross-reference (`see-also` from
  elsewhere, agent naming it in chat). Unique box-wide (enforced by the
  collector, not per-card lint — uniqueness is cross-file). Never a UUID.
- `status` — `String`, `matches: ["open", "done", "dropped", "parked"]`.
  Absence = `open` (the common case costs zero typing). `done` = completed
  (git history timestamps the transition); `dropped` = deliberately not doing;
  `parked` = deliberately off the plate, excluded from default surfaces, present in
  the full list.
- `assigned` — plain string; absence = the boxholder. `"agent"` marks agent
  work (Goal 5). No person-card ref in v1 (see NOT in scope).
- `by` — provenance; absence = boxholder-authored, `"agent"` = agent-authored
  (OpenClaw lesson: triage weighs inferred items differently).
- `created` — ISO date. **Required when `by="agent"`** (agents always know
  the date and staleness tending depends on it — the questions system
  likewise computes age from a durable required field); optional for humans
  (git blame can recover it, but the collector does not do blame — a
  human-authored todo without `created` simply doesn't participate in
  age-based staleness, only in `start`/`due` surfacing).
- `due` — ISO date; past due = escalated ("oh shit" line).
- `start` — ISO date, or relative `-3d`/`-2w` meaning due-minus-interval
  (validation error if relative and no `due`). From `start`, the todo is on
  the plate; before it, it's quiet (visible in the full list only). This is
  the primary surfacing trigger — "should start working on it" is when it
  needs to appear, not the due date.

`see-also` (nested inside `todo`, zero or more): **exactly one** of `ref` /
`href` — stricter than `source`'s at-most-one (`markdoc-config.ts:159-174`),
because a target-less see-also is meaningless where a target-less source
legitimately means "the containing document." Body = the reason.
`ref` participates in lint and `cb mv` rewriting automatically via
`body-refs.ts` / `rewrite-card-refs.ts`. Renders as a footnote-style marker,
not a block interruption.

Rendering by status: open = live treatment (badge + metadata chips for
due/start/assigned); done = struck; parked = dimmed; dropped = struck and
gray. Inline vs block via the `node.inline` split (`quote` precedent). The
`ref` → `sourceRef` React rename applies to `see-also`
(`markdoc-config.ts:176-181` precedent). Read-only rendering in v1 (no
click-to-toggle; see Open questions).

**Vocabulary lock-ins:** tag names `todo`, `see-also`; attribute names `id`,
`status`, `assigned`, `by`, `created`, `due`, `start`; status values `open`,
`done`, `dropped`, `parked`; the frontmatter key `todos`; the card type
`todo-view` (Track 4). `see-also` is todo-scoped in v1 but named generically
on purpose — it may later be allowed in other contexts.

**Shared model module:** `src/shared/todo-model.ts` — the status list
(`TODO_STATUSES`), the `TodoStatus` union, date/relative-`start` parsing, and
plate-state derivation, consumed by the Markdoc schema, the Zod frontmatter
shape, the collector, the CLI, and the React components. Without it the enum
and defaults get restated five times (types-are-structure).

**Plate-state time semantics** (one truth table, box-local): `start`/`due`
are calendar dates interpreted in the box's configured IANA timezone
(`src/core/box/config.ts` — NOT bare `getBoxTimeISO()`, which is UTC and
would flip todos on the wrong local day near midnight). States, in
precedence order for an `open` todo: **escalated** (today > `due`),
**on plate** (today ≥ `start`, or no `start` and no `due` — undated = now, or
today ≥ `due` with no `start`), **quiet** (today < `start`; a todo with `due`
but no `start` is on the plate immediately — due-without-start means "no
lead-time opinion," not "hide until due"). `start` after `due`, a relative
`start` with no `due`, and invalid calendar dates are validation errors.
Timezone-boundary doctests are part of the chunk.

**First implementation chunk:** `todo-model.ts` + both tag schemas +
validation + the two React components + doctests for
parse/validate/transform (relative-`start`-without-`due`, `start`-after-`due`,
status-enum rejection, timezone boundaries). **Second chunk (prerequisite for
every validation claim):** the universal raw-body Markdoc parse+validate pass
in `card-lint.ts` (warning first, error after the existing-box survey). No
open questions inside.

### Track 2 — frontmatter `todos:` key

**What.** An optional universal card field (joining `title`/`contains` in
`src/cards/schema.ts:72-77`) holding a list of todo entries for intentions
that don't belong to any particular sentence of the body.

**Why.** Boxholder call: "cards should have a todo frontmatter key … for
things that might not work well inline."

**Direction.** One entry shape, not two (code-style: one shape):

```yaml
todos:
  - text: "Renew the parking permit"
    due: 2026-08-15
  - text: "Ask Marcus about the quote"
    assigned: agent
    status: parked
```

`text` required; the other keys mirror Track 1's attributes exactly (same
names, same enums, same relative-`start` rule — all from `todo-model.ts`),
validated by Zod at card load (the existing boundary). An entry may also
carry `see-also: [{ref|href, note}]` so frontmatter todos have the same
evidence representation as inline ones (the agent-completion rule in Track 5
needs it). The collector reads both forms into one record type.

Note this is **not** a one-line change: both `GLOBAL_CARD_FIELDS`
(`src/cards/schema.ts:65-77`, the runtime injection) and `InferCardFields`'s
hardcoded global-field type (`src/cards/schema.ts:248-264`) must gain
`todos`, or runtime and types diverge.

**First implementation chunk:** the Zod shape + both schema.ts sites + load-
path doctests.

### Track 3 — the collector and `cb todos`

**What.** `src/core/todo/collect.ts`: glob cards; for each body, parse once
with the shared config, run `Markdoc.validate`, and walk the **raw AST** for
`node.tag === "todo"` (the authored lowercase name — `TodoInline`/`TodoBlock`
exist only post-transform, where source lines are gone; `body-refs.ts:60-66`
is the precedent). Line numbers are body-relative; add the frontmatter offset
from `splitCardContent` (`src/cards/frontmatter.ts`) to report true file
lines. Merge frontmatter `todos:` entries. The locator is a union:
`{kind: "body", line}` | `{kind: "frontmatter", index}`, plus `id` when
present. Derived plate-state comes from `todo-model.ts` (Track 1's box-local
truth table). Cards that fail Markdoc parse, fail Markdoc validation, or fail
card load (invalid frontmatter throws at load today) are each reported as
distinct visible-invalid results, never skipped. `cb todos` CLI on top:
read/query only.

**Why.** The collector is the substrate every consumer shares (Goal 3); the
CLI is the agent's query primitive.

**Direction.** `cb todos` is **designed for agent consumption** (boxholder
call — agents consume it and present to the human): deterministic ordering
(path, then line), filters (`--status`, `--assigned`, `--glob`, `--on-plate`,
`--json`), every row carrying its locator and id. Default output: open todos
on the plate. Mutation is *not* a command: the agent edits the annotation in
the card (normal card-edit path — validation, git history, locks — for free).
Parse failures are counted and reported ("2 cards failed to parse and may
hide todos: …"), never swallowed silently (resilient-not-silent; this is
where the design deliberately diverges from `body-refs.ts`'s
swallow-and-return-empty posture, which is fine for lint warnings but not for
a trust system). Duplicate `id`s are reported as errors.

**First implementation chunk:** collector + doctests (both capture forms,
derived plate-state around a frozen `CB_TIME`, parse-failure reporting,
duplicate-id detection), then the CLI wrapper.

### Track 4 — human surfaces: the `todo-view` card

**What.** The collected-todos surface **is a card** (boxholder decision,
2026-07-28): a small core card type, `todo-view`, whose frontmatter fields
are the query — `glob` (default: the card's own directory subtree), optional
`status`/`assigned` filters — plus a core renderer registered for the type
(the `registerFileType` mechanism `src/frontend/src/renderers/todo-list.tsx`
already uses) that calls a tRPC `todos.list` procedure (thin wrapper over
the collector) and renders the plate-state groups.

Two mechanism details pinned by the narrow cross-review pass:

- **Omitted `glob` resolves from the card's path at read time, not in the
  schema.** `cardSchema` never sees the card's path, so "default to the
  card's own subtree" cannot be a schema default (a static `"**"` would make
  project-local instances silently box-wide). The renderer has `data.path`
  (`file-type-registry.ts`); it passes the card path to `todos.list`, which
  resolves an omitted `glob` server-side to `<card's directory>/**`. The
  schema keeps `glob` optional with no default.
- **The stock instance is provisioned, not just templated.** The template
  registry only generates card content — it has no destination path or
  provisioning hook. The box-wide instance (`store/plate.todo-view.card`,
  explicit `glob: "**"`) is seeded by `cb init`'s stock-template pass with
  that destination, and rolls out to existing boxes via the template tracker
  (`config/template-versions.json`) like other stock cards.

**Why this shape.** It fits the "views attach to cards" model —
`src/core/views/doc.ts:12`: *"A view is always attached to a card type …
There is no card-less 'standalone' view"* — and it recovers what standalone
wildcard views were for without un-deprecating them: **the wildcard lives in
the card, not in a view or a link.** Because the surface has a card path,
linking to it is a plain card ref from anywhere (nav, landmarks, other
cards, chat) — no new link syntax. It multi-instantiates: a
`todos.todo-view.card` dropped in a project directory is that project's
plate, subtree-scoped by default; the agent creates and tends these like any
card. The Echo Show dashboard is the same model (card + view) and its todo
tile consumes the same `todos.list`. (test1's legacy `src/views/todos.tsx`
predates the standalone-view removal; the card type replaces it.)

Grouped by plate-state (escalated / on plate / quiet / parked), each item
linking to its card (**card-level navigation in v1** — `ViewTarget` has no
line/fragment field; line-anchored deep links are a fast-follow, not a v1
promise). Read-only rendering (no click-to-done in v1). The questions-style
header badge (open on-plate count via the status procedure) is the one
app-level affordance.

**First implementation chunk:** `todos.list` procedure + the `todo-view`
schema + renderer with plate-state grouping; then the stock template and the
badge.

### Track 5 — ambient agent context + agent guidance + tending

**What.** Three pieces:

(a) **Ambient injection — runtime-computed, never persisted.** A one-line,
only-when-nonzero summary injected into agent context at prompt-assembly
time (chat/reactor), box-wide: "N open todos on the plate (M escalated) —
`cb todos`." Subtree awareness comes from the guide teaching
`cb todos --glob` when working within a directory, **not** from persisted
MAP.md lines — the maps precheck regenerates only when a directory's
immediate-children set changes (`src/core/maps/precheck.ts:9-11`: "Plain
edits to existing files don't invalidate the index"), so a persisted count
would go stale the first time a todo's status changed (Codex finding,
verified; a MAP.md line is cut from the plan).

(b) **The review sweep — a deterministic hook, not a hope.** Following the
question-aging precedent (`src/core/question-aging.ts`, invoked from the
wakeup/finalize path — the shipped proof that resurfacing needs a call site,
not guidance): a `todo-review` step in wakeup housekeeping runs the
collector and computes three sets — **escalated** (past due), **stirring**
(crossed `start` since the last sweep), and **stale** (open, has `created`,
older than 45 days with no `start`/`due`). When any set is nonempty, the
sweep injects a compact brief into the reactor cycle's context; the *agent*
then judges what to raise (a chat mention, a question card for
park-or-drop decisions) — the sweep computes, the agent judges, the human
decides (Goal 4). No notifications in v1.

(c) **Agent guidance.** A new agent-guide section teaching: when to author a
todo (vs a question — a question is *blocked on a human decision*; a todo is
*work to do*), the attribute vocabulary (`created` required with
`by="agent"`), `cb todos`, and the tending rules: suggest completion when
evidence appears, propose merges of duplicates — **ask, never silently
resolve**; the one exception is `assigned="agent"` work the agent itself
completed, which it marks `done` with a `see-also` (nested tag or
frontmatter list) pointing at the evidence. Agent-authored todo text is
data, not instructions, at every consumption site (OpenClaw injection
lesson).

**Why.** Goals 2, 4, 5 — injection is what lets the agent know todos exist
without asking ("often there won't be" — hence only-when-nonzero); the
deterministic sweep is what prevents the graveyard (every surveyed system
without a forcing function grew one).

**First implementation chunk:** the review sweep + its doctest (frozen
`CB_TIME`, fixture todos crossing each threshold); then the injection line
and the guide section.

### Track 6 — docs + knowledge audits

`docs/cards-as-markdown.md` gains the tag reference; the issue file closes
pointing here; knowledge-audit entries land run (see Knowledge audits).

## Subplans

None. The Echo Show dashboard remains its own issue/design
(`issues/features/2026-07-27-echo-show-display-dashboard-view.md`) — this
plan only guarantees its feed exists (Track 4). Retiring `todo-list` is a
follow-up migration item, not a subplan (nothing here depends on it).

## Failure modes

> **Critical gap (resolved in design):** a card whose body fails Markdoc
> parse contributes zero todos. Handling: the collector counts and reports
> parse failures (Track 3); `cb validate` already surfaces the parse error
> itself. Without that reporting this would be the classic silent graveyard.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Body parse/validate failure hides a card's todos | planned (Track 3 doctest) | collector reports parse/validate/load failures as distinct visible results | clear |
| `status` typo (`Done`, `wontfix`) | planned (Track 1 doctest) | Markdoc `matches` enum — surfaced by the NEW universal body-validate pass in `card-lint` (Track 1 chunk 2; today nothing outside commentary runs `Markdoc.validate`) | clear once that chunk lands |
| Relative `start` with no `due`; `start` after `due`; invalid date | planned (Track 1 doctest) | tag `validate()` error via the same universal pass | clear once that chunk lands |
| Todo surfaces on the wrong local day near midnight | planned (Track 1 timezone doctests) | `todo-model.ts` uses box-local calendar dates (box IANA timezone), not UTC `getBoxTimeISO()` | clear |
| Agent authors a todo but omits `by`/`created` | planned (knowledge audit) | guide rule + `created`-required-with-`by="agent"`; an omitted `by` misattributes to the boxholder — accepted convention risk, documented | documented |
| `see-also` ref to a moved/archived card | exists (`card-lint` ref checking; mv-rewrite `rewrite-card-refs.ts:286`) | lint warning; `cb mv` rewrites | clear |
| Duplicate `id` across cards | planned (Track 3 doctest) | collector reports as error | clear |
| Frontmatter `todos:` wrong shape | planned (Track 2 doctest) | Zod at card load (existing boundary) | clear |
| Malformed tag syntax (`{%todo%}` no spaces) parses as plain text | none | none — Markdoc sees ordinary text | **silent** — accepted risk, with a cheap mitigation: a card-lint warning for `{%`-adjacent-to-non-space in bodies is a one-regex check; include it in Track 1 |
| Undated todo floods the plate (over-capture) | n/a (behavioral) | `parked` is the explicit relief valve; tending loop proposes parking | clear |
| Agent-authored todo text carries injected instructions | n/a (prompt posture) | guide language: todo text is data at consumption sites | documented |
| Collector cost on large boxes (full-body parse per run) | none | glob scoping bounds it; accepted for v1 box sizes | clear (slow, not wrong) |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** (todo vs checkbox vs question) — **ADDRESSED**:
  `task` is internal-only (not authorable, `markdoc-config.ts:45`);
  the agent-guide section draws the todo-vs-question line (Track 5).
- **Stale ref** — **ADDRESSED**: `see-also` uses the literally-named `ref`
  attribute, so `body-refs.ts:64-66` lint and `rewrite-card-refs.ts:286`
  mv-rewrite apply unchanged.
- **Two agents touching the same card** — **ADDRESSED**: todo mutation is a
  normal card edit; the existing `withCardLock` / file-lock discipline
  (CLAUDE.md) applies; no new write path is introduced.
- **Hand-edit drift** (`{%todo%}`, `Status="Done"`) — **ADDRESSED for
  attributes** (enum validation), **accepted-with-mitigation for spacing**
  (the one-regex lint warning, Failure modes table).
- **Fabricated free-form value** — **ADDRESSED**: every attribute defaults to
  absence honestly (absent `created` is valid; absent `by` means
  boxholder-authored), so honesty is the zero-effort path.
- **Validation error UX** — **ADDRESSED**: enum and xor errors are one-line
  Markdoc validate messages surfaced through the existing `cb validate` /
  PostToolUse hook channel the agent already reads.
- **Partial migration / transition state** — **ADDRESSED**: purely additive;
  no existing card changes shape. `todo-list` cards keep working until their
  separate retirement migration.

## NOT in scope

- **Grouping several annotations under one shared todo key** — rejected in
  design: it makes a todo a distributed entity with no canonical home;
  `see-also` covers the "add context" need. One annotation = one todo.
- **`assigned` as a person-card ref** (`assigned-ref=`) — verbose for a
  value set of ~two in a single-boxholder box; a ref-bearing variant can be
  added compatibly if multi-person assignment becomes real.
- **Promoting `[ ]` checkboxes to real todos** — casual GFM stays decoration;
  deliberate capture stays deliberate (avoids noise-flooding the plate).
- **Persisted todo counts in MAP.md** — cut after cross-review: the maps
  precheck only regenerates on child-set changes (`precheck.ts:9-11`), so a
  persisted count goes stale on any status edit. Ambient awareness is
  runtime-injected instead (Track 5a).
- **Line-anchored deep links from the todos page** — `ViewTarget` has no
  line/fragment field; card-level navigation in v1, anchors as a fast-follow.
- **Ad hoc (card-less) views** — the agent showing a one-off surface without
  minting a card; deferred to
  [ad-hoc-agent-views](../../../issues/exploration/2026-07-28-ad-hoc-agent-views.md).
- **In-place todo lenses and directory viewability** — `?view=todos` on any
  card or directory (directories aren't view-attachable today); deferred to
  [directories-as-viewable-things](../../../issues/features/2026-07-28-directories-as-viewable-things.md).
  The interim stand-in is a `todo-view` card dropped in the directory.
- **Retiring the `todo-list` schema** — superseded by this design but its
  removal is a data migration on real boxes (cb-migration territory); file as
  a follow-up issue when this plan lands.
- **OpenClaw-style automatic commitment extraction from conversation** — the
  agent *may* author todos in the normal course of work (with `by="agent"`),
  but a background inference pipeline with confidence gating is its own
  design, future exploration.
- **Relevance-triggered (semantic) resurfacing** — the `whenUseful` concept;
  the date + subtree-scoped injection axes come first, this layers on later
  without changing the vocabulary.
- **Push notifications for due todos** — the questions notification channel
  is the natural future home; not needed to earn v1 trust.
- **Interactive click-to-done in the rendered card/page** — needs a write
  path from the renderer into the annotation; deferred (Open questions).
- **The Echo Show dashboard itself** — separate issue; this plan provides its
  todo feed.

## Open design questions

All settled with the boxholder (2026-07-28):

- **Click-to-done UI** — decided: no direct-change UI in v1 (rendering is
  read-only; the agent marks things done conversationally). A fast-follow
  candidate once the read path has earned trust; moved to NOT in scope.
- **Frontmatter key name** — decided: `todos:` (it's a list; matches the
  collector vocabulary).
- **Parking-lot status name** — decided: `parked` (GTD's "someday/maybe"
  semantic; the GTD term itself didn't read). Parked items don't appear in
  ambient summaries — quiet means quiet; they show in
  `cb todos --status parked` and the page's parked group only.

## Knowledge audits

New agent-facing concepts → audits land run, per the `{% quote %}` precedent:

1. `knows_directly`: the `{% todo %}` shape — wrapper tag, metadata in
   attributes, absence-of-status = open.
2. `knows_directly`: the status vocabulary (`done`/`dropped`/`parked`) and
   that `start`, not `due`, is the surfacing trigger.
3. `knows_directly`: `cb todos` exists and is the query path; mutation is
   editing the card.
4. `knows_directly`: todo-vs-question boundary (work to do vs blocked on a
   human decision).
5. `knows_directly`: the `todo-view` card is the display surface — creating
   one in a directory makes a subtree-scoped plate; link to it like any card.

Execute `pnpm knowledge-audit run --box <test-box> --filter todo` and record
status comments before the plan completes.

## Implementation order

1. **`todo-model.ts` + tags + rendering** (Track 1 chunk 1) — self-contained;
   everything else consumes the vocabulary.
2. **Universal body Markdoc validate in `card-lint`** (Track 1 chunk 2) —
   warning-first, plus the existing-box violation survey; prerequisite for
   every validation claim.
3. **Frontmatter `todos:`** (Track 2) — both `schema.ts` sites; the collector
   needs it defined.
4. **Collector + `cb todos`** (Track 3) — depends on 1–3; substrate for 5+6.
5. **Review sweep + ambient injection + agent guide** (Track 5) — depends
   on 4; the sweep is the trust-critical piece and lands before the page.
6. **tRPC `todos.list` + `todo-view` card type + renderer + stock template**
   (Track 4) — depends on 4.
7. **Docs + knowledge audits + emit-tags handling; close the issue**
   (Track 6).

Each is a commit-sized chunk on this worktree; the plan ships as one unit on
the boxholder's signal.

## Rollout shape

- **Tests first, as a design tool** (`docs/testing.md`): pure-function
  doctests for tag parse/validate/transform and the collector (frozen
  `CB_TIME` for plate-state derivation); a route doctest for `todos.list`;
  the Failure-modes table's "Test exists?" column is the checklist. Done-when:
  those doctests pass, `cb todos` on test1 returns the seeded fixtures
  deterministically, and the knowledge audits pass.
- **Knowledge audits**: the four entries above land run with Track 6.
- **Migration**: none — purely additive. No existing card changes shape; the
  `todo-list` retirement is explicitly out of scope and filed as a follow-up
  when this lands.
