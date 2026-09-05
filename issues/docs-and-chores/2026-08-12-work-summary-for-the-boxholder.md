---
title: "A completed unit of work should hand Ian a summary written for him, not its last step"
workstream: unattached
area: process
needs: [design]
labels: [agents, plans, reporting]
filed-by: agent
discovered-by: Ian
discovered-in: main session — bbx feedback triage
priority: important
---

When a large unit of work completes, what surfaces is **the last step of a
multi-step process** — typically "received and applied a cross-model review" —
rather than a summary of the work itself. The review arriving last makes it read
as the verdict, which is exactly the wrong shape: it **covers up the actual
choices**, because a clean review implies there was nothing to decide.

## What's wanted instead

A deliberate "stuff you should know" section — in the plan, or a parallel
document — carrying the things only Ian can act on:

- **Questions** the work raised and didn't settle.
- **Questionable choices** — specifically ones where he might want to override
  the agent's first opinion. An agent picking a default silently is how a
  reversible decision becomes a permanent one.
- **What he needs to know about the implementation as a user of it.** For a
  feature: *how do I navigate to this?* A feature that shipped and can't be
  found has not shipped.

## Why the current shape produces the wrong artifact

Every durable artifact here is written **for the next agent**: plans, `/finish`
reports, review findings. That's why they're exhaustive, and it's why the
contestable calls sink beneath the thoroughness. Nothing in the pipeline is
addressed to the person who has to live with the result.

Two live examples from a single day, both from work that "completed cleanly":

- A dashboard link existed the whole time but was labeled "Overview" and buried
  two levels into a place-switcher. The work was done; the navigation answer
  never reached the boxholder.
- A landmark-icon fix landed and deployed, and the boxholder still saw broken
  images — because the local dev server holds an older bundle. Reported as
  fixed; the thing he needed to know was "restart the box's serve child."

Neither is a reporting *failure* under the current contract. Both are exactly
what a "stuff you should know" section exists to catch.

## Where it would live — undecided

Candidates, and the choice matters more than the wording:

- **`bbx-plan`** — a required section of every plan, so it exists before the work
  does and gets filled in as choices are made. Strongest for "questionable
  choices", since that's a record kept *during* the work, not reconstructed after.
- **`.claude/agents/finish.md` step 9** — already the report contract, already
  demands honesty about scope and verification. Closest existing home, but it
  runs headless at the very end, which is precisely when a summary degrades into
  "what did I just do".
- **Root `CLAUDE.md`** — a general expectation on every agent, at the cost of
  being everywhere and enforced nowhere.
- A **parallel document** per workstream, which the `/workstreams/` app could
  surface directly.

## Open questions

- Is this per-workstream, per-plan, or per-report? They have different lifetimes.
- How does it stay honest? "No questionable choices" is the easy answer and
  usually false; the format should make an empty section conspicuous.
- Does the cross-model review get demoted deliberately — reported as one input
  among several rather than as the closing verdict?
