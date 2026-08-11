---
title: "A fully-modeled fictional-family demo box (alongside test1)"
workstream: unknown
area: callback-box
filed-by: agent
discovered-in: main session — boxholder wants a concrete demo box
labels: [soft-launch]
---

Build a second standing box alongside `test1` — **a real, fully-formed fictional
family** with concrete members, relationships, ongoing tasks, and a defined
starting box position. Then demos of all kinds run against an actual modeled
family rather than an abstract or empty box.

> we create a real, fully formed family with very concrete tasks and a starting
> box position. Another alongside test1. Then we can do demos of all kinds of
> things using that actual modeled family.

## Why it's distinct from test1

`test1` is the **dev playground** — schedules disabled, ~40 demo threads that
only triage on manual wakeup, and it deliberately drifts (it's where things get
poked). It's the wrong thing to demo from: messy, incoherent as a "life," and
its state changes under you.

The demo box is the opposite: **curated, internally coherent, and resettable to a
known good starting position.** A demo needs to start from the same believable,
lived-in state every time.

## What "fully formed" means

- **A coherent household.** Named members with real relationships and roles,
  their pronouns and personalities, a `briefing` with the family's situation and
  key-people. Drawn from the canonical fictional roster
  (`callback-box/docs/example-names.md`) — never real names — and kept
  internally consistent so it reads as an actual family, not placeholder data.
- **Concrete ongoing tasks**, the kind the system is actually for: school
  calendars and pickups, meal planning, a household project with steps, medical
  appointments, a shared reading list, bills, a trip being planned. Enough that
  any demo has real material to touch.
- **A lived-in starting position** — existing cards, some history, a few pending
  questions — so a demo opens on a life in progress, not an empty box the
  presenter has to populate live.

## The reproducibility requirement (the hard part)

Unlike test1, this box must be **resettable to its canonical starting state**, or
demos rot the moment someone runs one. Options to weigh:

- A **seed** (a script / scenario that builds the box from scratch to the
  starting position) — most reproducible, and doubles as living documentation of
  a well-set-up box.
- A **git snapshot / tag** of the canonical state you reset to (the box is its own
  repo).
- **Demo against a fresh clone** each time so the canonical box stays pristine —
  same pattern the worktree box clones use.

Prefer whatever keeps a single canonical definition and makes "reset to start"
one command. The `src/scenario/` machinery (multi-step end-to-end fixtures) may
be the right builder.

## What it unlocks

- The [regenerable app demo video](2026-07-17-regenerable-app-demo-video.md) — a
  real family gives the video real content.
- The [GitHub Pages site](2026-07-20-github-pages-site.md) — "the system
  demonstrating itself" needs a believable box to show.
- General [demo readiness](../docs-and-chores/2026-05-22-demo-readiness.md).
- Testing/knowledge-audits that want realistic, coherent box content rather than
  test1's grab-bag.

## Open questions

- **Where it lives:** `~/src/boxes/<name>/` alongside test1 (outside the monorepo
  so it doesn't inherit the dev CLAUDE.md), like every other box.
- **How much content** is enough to be believable without being a maintenance
  burden — and how it stays current with schema/template changes (a box that
  can't `cb init` cleanly is a bad demo).
- **Connectors:** does the demo family have fake Gmail/Calendar/Drive data, or
  stay filesystem-only? Live connectors make richer demos but need fixtures.
- **How the boxholder's own boxes stay out of it** — this is the *shareable*
  demo box, so it must contain nothing personal and survive being shown publicly.

Per "examples do double duty," every piece of this family should both make a good
demo AND model good box setup for someone learning from it.
