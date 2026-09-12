---
title: "<Short plan title>"
status: draft
workstream: <bare workstream name, or unattached>
issues: []   # ../../../issues/<category>/<file>.md, one per line; see below
---
# <Title>

<!-- 1–2 sentences: what this plan is and why, for a reader with no context.
     Don't recap the conversation. For user-facing work, lead with the job:
     "When [situation], I want to [motivation], so I can [outcome]" — several
     concrete, mundane situations if the job has them. Skip JTBD for bugs,
     refactors, and "work robustly" jobs. -->

**Issues addressed:** <!-- every issues/ item this resolves, PLUS related or
duplicate ones you found by grepping the queue (slug, keyword, symptom). /finish
reads the frontmatter `issues:` list to close them; one left off is forgotten.
"none" if not tied to a filed issue. -->

## Smallest fix and budget

<!-- The circuit breaker's baseline (bbx-plan skill, "Circuit breaker").
     1. The smallest change that fixes the problem as reported — often cruder
        and incident-sized — with its rough size in lines.
     2. This plan's budget: tracks, subprojects touched, estimated lines of
        source and of tests.
     Some budgets exceed ~3× the smallest fix; others add a subproject,
     protocol, or vocabulary the request did not ask for. Either kind: stop,
     and let the boxholder choose between the two before you write further.
     Implementation stops and re-plans when the diff passes 1.5× this budget.
     *Could this be simpler?* below justifies whatever the budget adds over
     the smallest fix. -->

## Stated preferences this plan trades against

<!-- Which of these apply, and the specific principles findings will trace to:
     - beebox/docs/engineering-principles.md — the twelve principles, by number
     - beebox/CLAUDE.md — conventions, validation contract, "no features
       beyond the task"
     - beebox/code-style.md — the mechanical rules
     - the most recent shipped precedent for this kind of work (denser than docs)
     Explain actual tradeoffs against these preferences; ordinary implementation
     choices need no principle mapping. Do not invent a missing principle. -->

## What already exists

<!-- Code, conventions, or infrastructure that already solves part of this.
     For each: file:line, and reuse or rebuild (rebuild needs a reason). This
     is the grep that stops "I'll write a new utility" when one lives at
     src/lib/foo.ts. -->

## Prior art (external)

<!-- Research external premises that a design decision depends on. Examples:
     library/framework limitations
     ("<tool> <thing you want>" — issues, discussions), bugs/surprising
     behaviour you may hit, and named patterns that cover a mechanism you're
     inventing. One line + URL per finding. "No prior art found for X" is a
     finding when it bears on the decision; write it. If no decision depends
     on an external premise, state that briefly and skip the search. -->

## Tracks / scope

<!-- Order by implementation dependency, then surface size (unblockers first,
     then smallest). Per track:
     - What — one paragraph
     - Why this needs to change — the concrete problem, not "cleaner"
     - Direction — the proposed change, with actual shapes (signatures,
       schema fields, tag attributes) where known
     - Vocabulary lock-ins — names/shapes committed across the codebase
     - First implementation chunk — commit-sized, with NO open questions
       inside it (an open question there means design isn't done) -->

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
     a vocabulary/schema decision table, prerequisite infrastructure).
     `<topic>.subplan.md`, structured like this file; the parent links to it
     and both ship together. "none" otherwise. -->

## Failure modes

<!-- The load-bearing section. One realistic, specific failure per new
     codepath — "the ref= points at a card archived between write and read",
     not "the network might fail". -->

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|

<!-- Critical gap = no test AND no handling AND silent. Call each out above the
     table:  > **Critical gap:** <codepath> — <what happens silently>
     A plan with an unresolved critical gap is not ready; fix it in the plan
     or accept it as a documented risk with one sentence of why. -->

## Agent-flow / user-flow edge cases

<!-- Mark each ADDRESSED (cite where), DEFERRED (cite the open question), or
     GAP:
     - Wrong tag / wrong field — the agent picks the wrong one of two similar things
     - Stale ref — the target moved or was archived between write and read
     - Two agents touching the same card — chat agent and reactor concurrently
     - Hand-edit drift — the boxholder writes a slightly wrong form by hand
     - Fabricated free-form value — does the design make honesty easy or hard?
     - Validation error UX — does the message read well in the agent's context?
     - Partial migration / transition state — what does code see mid-rollout?
     GAPs are the second place, after Failure modes, where unsurfaced risk lives. -->

## NOT in scope

<!-- Explicit deferrals, one line of rationale each: "considered X, not now
     because Y". If the plan touches >1 module, has a transition state, or adds
     vocabulary and this section is empty — stop and write it. This is the gate
     that replaces a size limit. -->

## Open design questions

<!-- Genuinely unsettled, with your lean. A question inside the first
     implementation chunk is a missing decision, not a question — move it into
     Direction. -->

## Knowledge audits

<!-- New agent-facing concept (tag, convention, card shape, "how you do X")?
     Each gets at least one `knows_directly` entry in
     beebox/src/dev/knowledge-audits.yaml, and audits land RUN
     (`pnpm knowledge-audit run --box <test-box> --filter <id>`; record the
     status comment) — a never-run audit is unverified in both directions.
     Skip-with-rationale ("purely infrastructural") is fine; say so. -->

## What will hold this after it ships

<!-- Not "will there be tests" — which tier reaches this behaviour and what it
     costs to write. When a DECISION is the risky part, extract it as a pure
     function so the doctest tiers reach it, instead of a heavier tier to test
     it in place. Two traps: a new test tier is a norm for every future agent
     and a mock written by the bug's author encodes the bug — say explicitly
     if one is needed; a tour is the walk written down and kept true weekly
     (docs/tours.md), not a regression anchor for behaviour — put behaviour
     that must stay true in a doctest. -->

## Implementation order

<!-- Chunks in order, dependencies explicit. Each chunk is a commit or a few.
     Commit boundaries, not ship boundaries: the plan ships in one piece when
     every chunk is done, and only when the boxholder says so. -->

## Rollout shape

<!-- Tests first, as a design tool (docs/testing.md): name the doctest for each
     substantial codepath while designing it, and state done-when as the tests
     that must pass. Cover the substantial paths and the Failure-modes "Test
     exists?" column, not every line. Then: which knowledge audits land with
     the plan; migration approach if data shape changes (agent-by-hand,
     scripted, atomic vs gradual — a migration that expects to stop midway is a
     subplan, not a phase). -->
