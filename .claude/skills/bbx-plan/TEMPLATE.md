---
title: "<Short plan title>"
status: draft
workstream: <bare workstream name, or unattached>
issues: []   # ../../../issues/<category>/<file>.md, one per line; see below
---
# <Title>

<!-- 1–2 sentences: what this plan is and why, for a reader with no context.
     Don't recap the conversation. -->

**Issues addressed:** <!-- every issues/ item this resolves, plus related or
duplicate ones found by grepping the queue (slug, keyword, symptom); the same
list as the frontmatter. If none, "none" and the terms you searched. -->

## Design

<!-- Work that changes what a person experiences of the box: the bbx-design
     skill's TEMPLATE.md, pasted here or linked as `<topic>.design.md`.
     Other work: "No design section: <reason>." -->

## Smallest fix and budget

<!-- Name the smallest fix, the chosen design's tracks/subprojects, and
     estimated changed lines (additions plus deletions) as three figures:
     source and tests, authored docs, generated output. Count the uses
     (callers, constructors, readers) of each type or signature a track
     changes, per subproject, and weigh that spread when choosing the seam.
     Over 2,000 lines, generated output aside, is a BIG CHANGE; see the skill. -->

## Stated preferences this plan trades against

<!-- Which of these apply, and the specific principles findings will trace to:
     - the boxholder's decisions about this work, quoted
     - beebox/docs/engineering-principles.md — the principles, by number
     - beebox/AGENTS.md — conventions, validation contract, "no features
       beyond the task"
     - beebox/code-style.md — the mechanical rules
     - the most recent shipped precedent for this kind of work (denser than docs)
     Explain actual tradeoffs against these preferences; ordinary implementation
     choices need no principle mapping. Do not invent a missing principle. -->

## What already exists

<!-- Code, conventions, or infrastructure that already solves part of this,
     and the contract new code must satisfy (for an adapter, engine, or
     renderer: the interface type and every existing implementer). For each:
     file:line, and reuse or rebuild (rebuild needs a reason). -->

## Prior art (external)

<!-- Research external premises that a design decision depends on: library
     or framework limitations, bugs or surprising behaviour you may hit, named
     patterns that cover a mechanism you're inventing. One line + URL per
     finding. "No prior art found for X" is a finding when it bears on the
     decision; write it. If no decision depends on an external premise, state
     that briefly and skip the search.
     Mark each item evaluated-only or adopted (modelled on, adapted, copied);
     an adopted item gets an ACKNOWLEDGEMENTS.md entry in the commit that
     lands it. -->

## Ontology

<!-- Every noun the design needs, one line each: what it is, what identifies
     it, what it is NOT, and which other nouns it points at. Mark the ones the
     codebase already has, with file:line, and use THOSE names. Write the
     tracks below in these terms only.
     Two names for one thing, one field doing two jobs, and a state that
     cannot be represented are ontology mistakes; at implementation they
     surface as a migration. A plan that adds no nouns says so in a line. -->

## Tracks / scope

<!-- Order by implementation dependency, then surface size (unblockers first,
     then smallest). Per track:
     - What — one paragraph
     - Why this needs to change — the concrete problem, not "cleaner"
     - Direction — the proposed change, with actual shapes (signatures,
       schema fields, tag attributes) where known
     - Vocabulary lock-ins — names/shapes committed across the codebase
     - Depends on — each fact about existing code or an external service that
       this track would be wrong without, with evidence that proves all of it:
       - this text exists: file:line and the quote, read by you
       - all / none / only / same as / reusable as-is: the search, where you
         ran it, and each hit (callers, implementers, importers, write sites)
       - what it does when it runs (returns, delivers, retries, rejects,
         costs): the command or test you ran, and its output
       - a value reaches X: every hop from producer to consumer, file:line each
       A fact from a subagent, handoff, issue, older plan, doc, or code
       comment is UNVERIFIED until you hold that evidence; mark it so.
     - First implementation chunk — commit-sized, with NO open questions
       and no UNVERIFIED fact inside it (either means design isn't done) -->

## Could this be simpler?

<!-- A gate, not a section. State the simplest version that could plausibly
     work — cruder, smaller, partial, even one you won't ship — then what the
     fuller plan buys, traced to a principle: "the simple version fails on
     <specific case>, per <principle>". Never "isn't as clean". If you can't
     name what the complexity buys, shrink the plan. Usual over-builds: a new
     abstraction where a caller arg would do, a daemon where a one-shot would
     do, defence against a failure that can't happen, a generalization with one
     caller. -->

## Subplans

<!-- Only when a sub-question needs its own design step (research-and-decide,
     a vocabulary/schema decision table, prerequisite infrastructure):
     `<topic>.subplan.md`, structured like this file; the parent links to it
     and both ship together. -->

## Failure modes

<!-- Each realistic, specific failure a new codepath can reach ("the ref=
     points at a card archived between write and read", not "the network
     might fail"), and for a multi-step sequence each step's reachable
     non-success results and the state each leaves (propagating the error may
     be enough); no row for a state types or callers rule out (principle 6). -->

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|

<!-- Critical gap = no test, no handling, and silent. Call each out above the
     table as > **Critical gap:** <codepath> — <what happens silently>, then
     fix it in the plan or accept it as a risk with one sentence of why. -->

## Agent-flow / user-flow edge cases

<!-- First, each scenario walk as numbered hops, file:line per existing hop,
     the way in and the way out. Then mark each of these ADDRESSED (cite where),
     DEFERRED (cite the open question), or GAP:
     - Wrong tag / wrong field — the agent picks the wrong one of two similar things
     - Stale ref — the target moved or was archived between write and read
     - Two agents touching the same card — chat agent and reactor concurrently
     - Hand-edit drift — the boxholder writes a slightly wrong form by hand
     - Fabricated free-form value — does the design make honesty easy or hard?
     - Validation error UX — does the message read well in the agent's context?
     - Partial migration / transition state — what does code see mid-rollout?
     - Stored state that never clears — for each flag, marker, or diagnosis
       the plan stores: every event that clears it, and every one that must not -->

## NOT in scope

<!-- Explicit deferrals, one line of rationale each: "considered X, not now
     because Y". If the plan touches >1 module, has a transition state, or adds
     vocabulary and this section is empty — stop and write it. -->

## Open design questions

<!-- Genuinely unsettled, with your lean; none inside a first chunk. -->

## Knowledge audits

<!-- New agent-facing concept (tag, convention, card shape, "how you do X")?
     Each gets a `knows_directly` entry in beebox/src/dev/knowledge-audits.yaml,
     run before landing (`pnpm knowledge-audit run --box ~/src/boxes/test1
     --filter <id>`, status comment recorded). No new concept: say so. -->

## What will hold this after it ships

<!-- Not "will there be tests" — which tier reaches this behaviour and what it
     costs to write. When a DECISION is the risky part, extract it as a pure
     function so the test tiers reach it, instead of a heavier tier to test
     it in place. Two traps: a new test tier is a norm for every future agent
     and a mock written by the bug's author encodes the bug — say explicitly
     if one is needed; a tour is the walk written down and kept true weekly
     (docs/testing/tours.md), not a regression anchor for behaviour — put behaviour
     that must stay true in a test. -->

## Implementation order

<!-- Chunks in order, dependencies explicit; each a commit or a few. Name the
     commit that lands an adopted prior-art item. Before fixing a path or
     order, run from beebox/ the checks that would refuse it later:
     `pnpm layout-check` with stubs at new paths carrying their planned imports
     (`--explain <dir>` shows the unit graph), `pnpm doc-check` on each commit
     that touches docs, and `pnpm lint:guide` for always-loaded text. -->

## Rollout shape

<!-- Tests first, as a design tool (docs/testing.md): name the test for each
     substantial codepath while designing it; done-when is those tests
     passing. Failure modes' "Test exists?" column records coverage. Migration
     approach if data shape changes (by hand, scripted, atomic vs gradual);
     one that expects to stop midway is a subplan, not a phase. -->
