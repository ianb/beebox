---
title: "What can we remove? A sweep for code that guards the impossible, hedges the unlikely, or serves a goal we don't have"
workstream: unattached
needs: [design]
area: beebox
labels: [craft, principles]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "what code is longer than it needs to be, protecting against something that isn't that important or likely, or handling a situation that is impossible"
priority: normal
---

The boxholder's framing: *"What can we remove? What code is longer than it needs
to be, protecting against something that isn't that important or likely, or
handling a situation that is impossible, or providing something that is not in
line with our core goals."*

Four distinct removals in that sentence, and they are worth keeping apart
because each needs different evidence:

1. **Guards the impossible** — a fallback for a state the types prove cannot
   happen. Already a stated violation: principle 6 (*right-sized
   defensiveness*) and principle 4 (*never resilient to the impossible*).
2. **Hedges the unlikely** — handling that is *possible* but not worth its cost.
   This is a judgment call about likelihood and blast radius, not a rule
   violation, and it is the one most likely to be got wrong in both directions.
3. **Longer than it needs to be** — the same behaviour expressible in less.
4. **Serves a goal we don't have** — a capability nobody asked for or that cuts
   against what the system is for. Not a code-quality question at all; a product
   one.

## Why the existing machinery does not cover this

- **knip** finds *unreferenced* code. Everything above is referenced and
  reachable — knip cannot see any of it.
- **`bbx-codehealth`** hunts shallow modules, cruft and hard-to-test seams
  against a depth aim. Closest neighbour, and category 3 overlaps it, but it is
  not looking for over-defence or off-goal features.
- **`code-style.md`'s defensiveness rules** and principle 6 already say what
  over-defence *is*, and there is even a stated calibration — *"this calibrates
  against the known AI failure mode of over-guarding already-typed values"*.
  What is missing is anything that goes looking. A rule that only fires when
  someone happens to be reading the line is a rule about new code, not existing
  code.

The AI-authorship angle is the reason this is worth a deliberate pass rather
than leaving it to taste: nearly all of this code was written by agents, and
over-guarding is a *known* failure mode of that authorship, already named in the
principles. So the expected density of category 1 is high and is not evenly
distributed — it will cluster wherever an agent was uncertain.

## The design work this needs first

- **What is the evidence for a removal?** Deleting a guard because it "looks
  unnecessary" is how a real failure mode gets reintroduced. Category 1 has a
  crisp test (can the type system produce this state?) and should be provable.
  Category 2 has no such test, and needs a stated bar — the boxholder has
  already set one precedent worth reusing: *after two or three fix/verify
  rounds, accept and document a near-nil-reachability failure rather than
  gold-plating it, while still fixing anything reachable by ordinary
  contention.* Turning that into a removal criterion is real design.
- **What protects against removing the load-bearing hedge?** Several defences
  in this codebase look paranoid and are not — the process-supervision code
  carries the biggest defensive budget on purpose, and `code-style.md` says so,
  requiring each catch to name the race it absorbs. A sweep that cannot tell
  that from noise will delete the wrong thing. Perhaps: a removal must cite the
  comment or test that justified the code, and the absence of one is itself the
  finding.
- **Category 4 is not the agent's call.** "Not in line with our core goals"
  needs the goals written down somewhere a sweep can cite, and the decision is
  the boxholder's. It may not belong in the same pass at all.
- **Output shape.** A removal diff is cheap to produce and expensive to review.
  Batching by category, with each item naming which of the four it is and what
  evidence it rests on, is probably the readable unit.

## Related

- `2026-09-14-principles-to-rules-loop.md` — the sibling, filed together. That
  one moves the code *toward* an ideal; this one removes what should not be
  there. Design them together; they may be one practice with two lenses.
- [`bbx-codehealth`](../../.claude/skills/bbx-codehealth/SKILL.md) — its
  code-as-liability stance is the same instinct, already written down.
