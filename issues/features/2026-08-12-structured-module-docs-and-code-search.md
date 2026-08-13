---
title: "Structured module/export descriptions, lint-enforced, feeding a code search cb-plan can use"
workstream: unattached
area: monorepo
needs: [design]
labels: [discoverability, lint, cb-plan]
filed-by: agent
discovered-by: Ian
discovered-in: main session — cb feedback triage
---

A structured description of each module (and ideally each export), enforced by
lint, backfilled across the tree, and made **searchable** — with `cb-plan`
running that search as a planning step and putting the results in the plan. A
kind of self-research: before designing, find out what already exists.

## The pieces

- **A structured description per module/export.** Not just *what* it is but
  **when you would want to use it** — the usage intent is the part that makes a
  search result actionable, and plausibly the part that makes an embedding
  useful.
- **A lint rule requiring them**, plus a backfill pass over the existing tree.
- **Richer export information — scope.** Is an implementation *local to its
  subdirectory* or *globally applicable*? A barrel would express that, but
  barrels are rejected here (no `index.ts` re-exports, boxholder decision
  2026-07-12) — so a simple per-export permission/visibility annotation may be
  the better answer, giving the same signal without the indirection, import
  cycles, and dead-export fuzzing that made barrels unwelcome.
- **`pnpm code-search`** taking a query, the *purpose* for the task, and a base
  directory (if there's a local notion of scope to search within).

## Why this fits here specifically

**The convention already exists informally and is unusually good.** Files across
this repo open with substantial headers explaining *why* the module exists,
which race a guard closes, what a prior implementation got wrong. That is
already the hard part — the writing discipline is established, and this proposal
is mostly about making it *machine-addressable* rather than creating it.

Two existing pieces to build on rather than duplicate:

- **`callback-box/docs/module-map.md`** — a discoverability contract for where
  shared code lives, deciding placement "by dependencies and consumers, not by
  vibe." This proposal is the per-module counterpart to that per-directory rule.
- **`bin/docs/router-protocol.md`** — the precedent for promoting invariants out
  of inline comments into a durable place with pointers back at the code.

## Real evidence it's needed

Findings from this month, each of which a working search would have surfaced:

- **430 of 1,288 source files are imported by no test.** Nobody knew until a
  test-selection import map was built.
- A **duplicated `readSymbol`** existed in two places with divergent behavior;
  the divergence shipped broken icons for weeks.
- **`apiImageUrl` is documented as the one to prefer for images and is used
  nowhere** — four call sites use the wrong helper.
- A **fourth spelling of card provenance** was nearly added because the existing
  three weren't discoverable.

Each is the same failure: the thing existed, and finding it required someone to
already know it existed.

## Open: does jsdoc actually fit?

Ian's own doubt, and worth taking seriously. The preset carries **no jsdoc rules
today**, so nothing is being extended — this would be new machinery either way.
jsdoc gives tooling, editor integration, and a familiar grammar, but it is built
for API reference (params, returns, types that TypeScript already states) rather
than for *"when would I reach for this, and is it mine to use?"* — which is the
actual question. A small purpose-built frontmatter-ish block might fit better
than bending tag vocabulary that was designed for something else.

Decide that before the backfill, not after: the backfill is the expensive,
one-way part.

## Other open questions

- Module-level, export-level, or both? Export-level is where the scope
  annotation lives, but it is also where the backfill cost explodes.
- Is search lexical, embedding-based, or both? BM25 is on Ian's list to revisit
  and would be the cheap baseline worth beating before reaching for embeddings.
- What does `cb-plan` do with results — paste them, summarize them, or require
  the planner to say why each near-miss wasn't reused?
- Does the scope annotation get *enforced* (a lint error on importing a
  subdirectory-local export from outside), or is it advisory? Enforcement is
  what makes it real; it is also what makes it a much larger change.
