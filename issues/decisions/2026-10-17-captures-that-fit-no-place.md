---
title: "What should happen to a phone capture that fits no place in the box?"
workstream: unattached
area: beebox
needs: [decision]
labels: [capture]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-fabric-research — planning how word-less captures get filed
---

The [filing plan](../../beebox/docs/implemented-plans/file-wordless-captures.md) has the
background agent read a phone capture that arrived with no words, give it a
title and a description, and move it to the landmark whose `destinations`
fit. When none fits, the plan's interim behavior leaves the titled capture in
`_content/captures/` and asks nothing.

The boxholder (2026-10-17): *"Definitely isn't right to just leave it, but I
guess it requires more thought than I have for it at this moment."*

## The tension

- Asking about each one nags. Random screenshots arrive often, and a question per item is the kind of tracking `beebox/docs/architecture/spirit.md` warns against ("A deficiency-oriented system nags").
- Leaving each one where it is hides it. `_content/captures/` becomes a pile that nothing surfaces, which is the original bug in a slower form.
- Inventing a place for each one guesses at structure the person did not ask for.

## Agent suggestion

Treat no-fit captures as a group, not as items.

1. Each one stays findable (title, description, search) where it is.
2. When several no-fit captures look alike (three recipes, two receipts), the agent proposes one change: a new landmark with a `destinations` rule, or a rule added to an existing landmark. One question covers the cluster and teaches the box for next time, which is the question rung moving toward automatic in `beebox/docs/design/trust.md`.
3. A capture that never joins a cluster is shown once in a periodic look-back (for example the weekly retro or a today view) and is not asked about again.

## Questions for the decision

- Is a cluster proposal the right unit, or should the person see every no-fit capture once?
- Where does the look-back live: the box screen, a landmark of its own, a scheduled procedure?
- Should `_content/captures/` itself become a landmark with a place page, so the pile is a visible place and not a hidden folder?
