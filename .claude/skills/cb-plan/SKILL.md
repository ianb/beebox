---
name: cb-plan
description: Use when the human wants to write a plan for non-trivial work — a new feature, a refactor, a vocabulary or schema change, a multi-track effort — or to review an existing plan. Triggers include "write a plan", "make a plan for X", "let's plan", "review this plan", "/cb-plan".
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, Agent, WebFetch, WebSearch
---

# /cb-plan

A plan-writing skill. Reviewing is what happens when you fill out the
form honestly. There is no separate "review pass" — the same template
serves both modes:

- **Writing a new plan**: fill in every section. The blank sections are
  the failure modes you haven't thought about yet. Iterating on the
  blanks IS the review.
- **Reviewing an existing plan**: read the plan, check that every
  section is filled and every claim has a citation, write findings into
  a sibling `<plan>.review.md` using the failure-modes + citation
  pattern.

**Write in Simplified Technical English** (ASD-STE100, in spirit): short
sentences, active voice, one idea per sentence, consistent terminology, no
ambiguity. A plan is read cold, months later, by whoever picks up the work —
write for fast, unambiguous parsing over style.

**For user-facing functionality, frame the goal as a Job To Be Done** before the
means. Use a job story: *"When [situation], I want to [motivation], so I can
[outcome]."* The point is not the syntax — it is to **situate the job in the real,
concrete situations the user is in**: their intention in that moment, where their
attention is, what capacity they have, and how the job fits into the interaction.
This often needs several situations, not one. Prefer concrete but mundane examples;
avoid stale clichés like booking a flight or a restaurant reservation. Skip it for
bugs, refactors, and "work robustly" jobs where JTBD is the wrong lens; don't force
it.

## What a plan is

A plan is a complete unit of work — designed end-to-end before
implementation starts, shipped end-to-end when implementation finishes.
There is no "ship slice 1, see how it goes, then design slice 2." The
plan completes; then it ships.

Plans can be big. Long, multi-track, multi-week plans are fine and
often the right shape — they let a coherent change land coherently
instead of dribbling out as half-decisions over months. Execute big
plans serially in sensible order; don't compress them.

**Where the work happens.** Big plans run on a git worktree, not on
main. (You're probably already in one if you're planning — the
worktree's working directory is where the design doc lives.) Commit
freely within the worktree as you go — that's the normal commit
discipline. **Do not merge the worktree branch into main unless the
boxholder explicitly asks for it.** "Plan completes, then ships" means
the ship step is a separate signal from the user, not something the
agent triggers on its own.

This shapes how the template works:

- **Implementation chunks ≠ shipping milestones.** Inside a plan it's
  good to identify cohesive pieces of work that can be committed
  independently. Those are *commit boundaries*, not ship boundaries.
- **Sensible order matters.** Within a plan, sequence chunks so
  dependencies land before dependents. A chunk that can't be exercised
  until the next chunk lands is fine — the plan completes before any
  of it ships.
- **Subplans** are the right tool when a question inside a plan is big
  enough to need its own design step. Spin a separate plan for the
  sub-question (`<topic>.subplan.md` or a sibling file); the parent
  plan links to it as a dependency. The parent waits on the subplan;
  both ship together when the parent completes.

## When to invoke

Use this for any work where the cost of an unsurfaced failure mode is
higher than the cost of writing the plan. In practice:

- A new schema, a new tag in a shared vocabulary, a migration.
- A refactor that touches >1 module or has bilingual/transition state.
- Anything where "what happens when the agent picks the wrong X"
  is a real question.

Skip it for:

- One-file changes obvious from the diff.
- Bug fixes where the fix is the artifact.
- Exploratory spikes — write the spike, then plan if it survives.

## The plan template

Write the plan to `callback-box/docs/plans/<topic>.md` — active proposals
live there, separate from reference docs (see `docs/plans/README.md`).
Subplans: `<topic>.subplan.md`; reviews: `<topic>.review.md`. When the plan
ships, `/finish` moves it to `docs/implemented-plans/`. Use the section headers below
verbatim. Every section is mandatory; if a section is genuinely empty
("there is no prior art for this"), say so explicitly — don't omit it.

### Header

Title and a 1-2 sentence statement of what this plan is and why. Don't
recap the conversation; state the plan's purpose as if the reader has
no context.

### Stated preferences this plan trades against

Pointers to the engineering principles the plan should be evaluated
against. These live across:

- `callback-box/docs/engineering-principles.md` — the twelve durable
  design principles (types-are-structure, exhaustiveness, validate-at-
  boundaries, resilient-not-silent, …); the *why* the mechanical rules
  implement. Trace findings to these by number.
- `callback-box/CLAUDE.md` — project conventions, validation contract,
  Phase-2 cards format, the "don't add features beyond what the task
  requires" rule.
- `callback-box/code-style.md` — the checkable mechanical rules (no
  default parameters, max 2 positional params, no `any`, the `as`/cast
  and logging conventions).
- The most recent shipped precedent (e.g. `{% quote %}` if you're
  doing Markdoc tag work). Precedents are denser preferences than docs.

List which of these apply to the plan and which specific principles
you'll trace findings to.

Every finding in the Review section (and every design choice in the
plan) must be traceable to one of these. If you can't trace, either
articulate the missing principle or drop the finding.

### What already exists

Existing code, conventions, or infrastructure that partially solves the
sub-problems. For each: cite the file:line and say whether the plan
reuses it or rebuilds it. Reuse > rebuild; if you're rebuilding,
justify why.

This section is the antidote to "I'll write a new utility for that"
when one already lives at `src/lib/foo.ts`. Doing it forces a grep
before committing to net-new code.

### Prior art (external)

What's already known about this outside the project. Web-search
during planning is the default, not the exception. Three flavors:

- **Library / framework limitations.** When the plan leans on a
  third-party tool (Markdoc, Vite, tRPC, Anthropic SDK, etc.) for
  something non-obvious, search for "<tool> <thing you want>" — issues,
  discussions, blog posts. You're checking whether the feature exists
  ("I can't find it in the docs but it might be there"), whether it's
  a documented limitation with known workarounds, or whether others
  have hit the same wall.
- **Bugs / surprising behavior.** Symptoms you might hit during
  implementation — search the project repo's issues and the broader
  web for them. Save anyone in the future the rediscovery cost.
- **Patterns / techniques.** When the plan invents a mechanism (a
  particular kind of cache, a migration strategy, a renderer shape),
  check whether a named pattern already covers it.

For each finding worth recording: a one-line summary plus the URL, in
this section. If a search came back empty, say so explicitly — "no
prior art found for X" is information.

Skip-with-rationale ("this is purely internal; no external dependency
is in play") is fine if true. The default is to search.

### Tracks / scope

If the plan has multiple tracks, name and order them. Order by
**implementation dependency, then surface size** — start with what
unblocks the rest; among independent tracks, smallest first.

For each track:
- **What** — one paragraph.
- **Why this needs to change** — concrete problem, not "would be
  cleaner."
- **Direction** — the proposed change. Include the actual shape (tag
  attributes, function signatures, schema fields) when you have them.
- **Vocabulary lock-ins** — for vocabulary work specifically: any
  name/shape you're committing to across the whole codebase.
- **First implementation chunk** — the first commit-sized chunk of
  work toward this track. This is *not* a ship boundary — the plan as
  a whole ships when all chunks complete. The chunk should have **no
  open questions inside it** — open questions at the first-chunk level
  mean you're not done designing yet.

### Could this be simpler?

The mandatory complexity challenge. With the tracks sketched, state the
**simplest version that could plausibly work** — a cruder, smaller, or more
partial approach, even one you don't intend to ship — then say, concretely, what
the plan's fuller approach buys over it, traced to a stated preference. "The
simple version fails on `<specific case>`, per `<principle>`" — never "the simple
version isn't as clean."

If you can't name what the extra complexity buys, that IS the finding: shrink the
plan toward the simple version. A plan that never considered a smaller shape
hasn't earned its size — this section is a gate (like NOT-in-scope) that replaces
trusting the author to have asked. Watch for the usual over-builds: a new
abstraction where a caller arg would do, a channel/daemon where a one-shot would
do, defense against a failure that can't happen (`stop-over-engineering`), a
generalization with one caller. When reviewing: a missing or hand-wavy version of
this section is itself a finding.

### Subplans (when a sub-question needs its own design step)

A subplan is the right tool when a question inside the plan needs its
own design — not because the parent is too big, but because the
sub-question has its own decisions to settle (research, vocabulary,
shape) that don't belong inline. The subplan is its own complete plan,
structured the same way; the parent plan links to it as a dependency
and both ship together when the parent completes.

Common cases: a research-and-decide phase before the parent's direction
can be set; a vocabulary or schema question that needs its own
decision-table; a piece of infrastructure that's prerequisite for the
parent but conceptually separate.

### Failure modes (the load-bearing section)

For each new codepath or new feature, fill this in:

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|

One realistic failure per codepath. Be specific — "the network might
fail" is not specific; "the `ref=` points at a card that was archived
between write and read" is specific.

**Critical gap = no test AND no handling AND silent.** Flag those
separately above the table:

> **Critical gap:** <codepath> — <what happens when it fails silently>

A plan with an unresolved critical gap is not ready to ship. Either fix
the gap in the plan, or accept it as a documented risk with a sentence
explaining why.

### Agent-flow / user-flow edge cases

The seven (or so) scenarios that come up when humans and agents share
the box:

- **Wrong tag / wrong field** — agent picks `{% quote %}` when
  `{% source %}` was right (or vice versa).
- **Stale ref** — the target card was moved or archived between when
  the ref was written and when it's read.
- **Two agents touching the same card** — chat agent and reactor agent
  edit a briefing concurrently; do they reconcile?
- **Hand-edit drift** — boxholder edits a card by hand with a slightly
  wrong tag form (`{%quote%}` no space, lowercase attribute names).
- **Fabricated free-form value** — agent invents a description rather
  than describing reality. Does the design make honesty easy or hard?
- **Validation error UX** — when validation fires on bad input, does
  the message read well in the agent's context?
- **Partial migration / transition state** — during the rollout window,
  what does the code see?

For each: **ADDRESSED** (plan handles it; cite where), **DEFERRED**
(plan explicitly defers it; cite open-questions entry), or **GAP**
(plan doesn't address it).

GAPs are the second place after Failure Modes where you find the
unsurfaced risks.

### NOT in scope

Explicit deferrals. For each deferred item: a one-line rationale. "We
considered X and chose not to do it now because Y."

**Special rule:** if a plan touches multiple modules, has a transition
state, or introduces a new vocabulary — and the NOT-in-scope section
is empty — stop and write it. The absence of NOT-in-scope is the
gate that replaces a numeric scope-size limit. Plans that don't say
what they're not doing are plans that haven't bounded themselves.

### Open design questions

Genuinely unsettled questions, with the planner's lean (if any). If a
question is inside the first implementation chunk, it's not actually a
question — it's a missing decision. Move it out of "open" and into
the Direction.

### Knowledge audits

Does this plan introduce agent-facing concepts — a new tag, a new
convention, a new card shape, a new "this is how you do X" rule? If
so, consider whether one or more knowledge-audit entries in
`callback-box/src/dev/knowledge-audits.yaml` should land with it.

The `{% quote %}` work is the precedent: four entries verified the
agent could recall the convention from CLAUDE.md without re-reading.
A new convention without an audit is a convention the agent might
silently forget on the next compaction.

Default: each new agent-facing concept gets at least one
`knows_directly` audit. Skip-with-rationale (e.g. "this is purely
infrastructural; no agent needs to recall it") is fine — just say so
explicitly.

Audits land **run**, not just written: execute
`pnpm knowledge-audit run --box <test-box> --filter <tag-or-id>` and
record the status comment in `knowledge-audits.yaml` before the plan
completes. A never-run audit is unverified in both directions — the
agent may fail it, or the audit itself may be broken. The agent-session
cost is part of authoring, not a separate decision to defer.

### Implementation order

How the chunks land, in order. Each chunk is a commit (or a few
related commits) toward the plan. Note dependencies between chunks
explicitly. This is not a shipping plan — the plan ships in one piece
when all chunks complete.

### Rollout shape

How the completed plan actually goes out as one unit:

- Test posture. **Tests come first, as a design tool** (per
  `docs/testing.md`): a test's first job is to force decomposition —
  writing it sharpens a function's purpose and boundaries — then
  documentation, then regression-anchoring. So name the doctest for each
  substantial new codepath *as part of designing it*, not deferred until
  the shape "settles," and encode the plan's done-when as the tests that
  must pass (a vague "make it faster" becomes a checkable assertion).
  Not every line, though: tests aren't for coverage percentages or
  verification-for-its-own-sake (`docs/testing.md`) — cover the
  substantial codepaths and the Failure-modes table's "Test exists?"
  column, not everything.
- Knowledge-audit entries (see the Knowledge audits section above) —
  what lands with the plan vs deferred.
- Migration approach if the plan changes existing data shape (hand-done
  by agent, scripted, atomic vs gradual). A migration that expects to
  stop midway is a subplan, not a phase (see "Where the work happens").

## The discipline rules

These apply when writing AND when reviewing.

### Citation discipline

Any claim about existing code or behavior must quote `file:line` plus
verbatim text. Not "we already do X" — `path/to/file.ts:42`: *"X is
handled here."*

The same rule applies to claims of safety. If you say "this case
can't happen because Y handles it," cite the line where Y handles it.
"Probably handled" / "likely tested" / "I think this is fine" are not
claims, they're guesses. Either verify or flag as unverified.

### No numeric scoring

No confidence levels, no completeness scores, no 1-10 ratings. The
reasoning is in the prose. A finding that needs a number to convey its
weight is a finding that needs better prose.

### Trace to a stated preference

Every recommendation (in a fresh plan or a review) ends with one
sentence connecting it to a specific principle from the Stated
Preferences section.

"This pattern is wrong because…" → which principle does it violate?
"This is fine because…" → which principle defends it?

If the connection feels strained, either the finding is weak or the
principle list is incomplete. Both are useful signals.

### One finding per item

When reviewing, surface findings discretely — each finding has its
own short title, location, citation, issue, why-it-matters, suggested
action, traces-to-preference. Never batch multiple issues into one
paragraph.

### Things checked and found clean

When reviewing, include an explicit list of categories you checked but
found nothing in. Distinguishes "I covered this and it's fine" from "I
didn't look."

## Reviewing an existing plan

Same discipline; the output is a sibling file `<plan>.review.md`.

Structure:

```
# Plan Engineering Review — <topic>

## What already exists
## Prior art (external) — verified
## Stated preferences this plan trades against
## Could this be simpler? (verified)
## Failure modes
## Agent-flow / user-flow edge cases
## Findings
## NOT in scope (verified)
## Things I checked and found clean
```

The "Prior art (external) — verified" section in a review means: was
the planner's external search adequate? If the plan claims "no prior
art exists for X," the reviewer either confirms (with their own search)
or flags it as a finding ("a search for Y turns up Z, which the plan
should account for").

Findings each follow the format:

```
### <short title>
**Location in plan:** `path/to/plan.md:<line>` (or section name)
**Citation:** verbatim quote from the plan (or source file)
**Issue:** what's wrong / risky / missing
**Why it matters:** the failure mode or burden
**Suggested action:** concrete next step
**Traces to preference:** one sentence linking to a principle
```

If the plan is missing a template section entirely, that's a finding
of its own — the absence is a gap. Don't fill the section yourself in
the review; flag that the planner needs to.

## What this skill explicitly does NOT do

These come from a trial run of gstack's `plan-eng-review` skill. They
sounded good in the abstract; in practice they didn't pull weight or
fought the way work actually happens here.

- **No numeric scope-size gate.** Big AI-assisted changes are a
  deliberate part of the workflow here. The absence of NOT-in-scope is
  the real gate; size by itself is not.
- **No cargo-culted "Cognitive Patterns" checklist.** Generic eng-
  management aphorisms read as ritual, not guidance. Principles live in
  CLAUDE.md / code-style.md / engineering-principles.md and are
  project-specific.
- **No ASCII coverage diagrams.** Prose covers the same ground without
  the diagram-maintenance burden.
- **No dual effort scale (`human: ~2d / CC: ~15min`).** Doesn't change
  decisions here.
- **No automatic Codex / cross-model "Outside Voice" pass.** When
  cross-model review matters, invoke it explicitly.

## Failure modes for this skill itself

(Yes, the skill writes plans, and this skill's failure modes apply to
the skill's own use.)

These are the shortcuts you'll be tempted to take — each is a
rationalization the plan exists to resist. If you catch yourself
thinking one of them, you're hollowing out the plan, not saving time:

- **Filling sections perfunctorily.** Sections filled with "N/A" or
  one-line dismissals undo the value. If a section genuinely doesn't
  apply, write the *why* — "no prior art exists because this is a new
  vocabulary surface" beats "N/A."
- **Citing CLAUDE.md by paraphrase.** "CLAUDE.md says to read before
  writing" is not a citation. `callback-box/CLAUDE.md:101`: *"Read
  before writing. Don't guess file formats..."* is.
- **Writing the plan as a chat transcript.** The plan stands alone; a
  reader six months from now should understand it without the
  surrounding conversation.
- **Skipping Failure Modes because "the design is obvious."** The
  obvious design has obvious failure modes; surface them anyway.
- **Shipping a chunk and stopping.** Committing chunks during
  implementation is fine; merging a partial plan to main because "the
  first part feels done" is the violation (see "Where the work
  happens").
- **Skipping the Knowledge audits section because no tests are
  written yet.** The section asks "*should* audits land," not "*do*
  they exist." A new agent-facing concept without a single audit is a
  decision, not an oversight; mark it as such with rationale.
- **Skipping Prior art because "the docs are enough."** Library docs
  rarely document the edge case you'll hit. An empty external search
  during planning is a research debt the implementation phase pays
  back with interest. The Prior art section is "what did I search for,
  what did I find" — empty searches are findings, not excuses.
