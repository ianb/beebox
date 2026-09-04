---
title: "Research Open Knowledge Format — could it document this codebase, or boxes?"
workstream: unattached
area: monorepo
needs: [design]
labels: [research, discoverability]
filed-by: agent
discovered-by: Ian
discovered-in: main session — bbx feedback triage
priority: backlog
---

**Goggles Open Knowledge Format** came up as something to consider. Ian knows
very little about it beyond the name; this is a research item, not a proposal.

The hunch is that it might be a format for **documenting this codebase itself**,
and possibly **boxes** too.

## What the research should answer

- What is it actually for — a serialization format, an interchange standard, a
  query surface, a set of conventions? What problem did it exist to solve?
- Who uses it, and is it alive?
- **Does it fit either candidate use**: describing a codebase's modules and
  their relationships, or describing a box's contents? Those are different
  enough that it may suit one and not the other.
- What would adopting it cost versus a purpose-built shape, and what would it
  buy that a bespoke format wouldn't — interoperability with other tools is the
  usual argument, so name who we'd actually interoperate *with*.

Land the findings as a doc under `research/` (see `research/CLAUDE.md`), the way
the other external evaluations are recorded, and link it back here with the
recommendation.

## Why it's timely

It lands directly on top of
[structured module docs and code search](../features/2026-08-12-structured-module-docs-and-code-search.md),
which proposes inventing a shape for exactly this — structured per-module
descriptions covering what something is and when you'd reach for it. If an
existing format fits, that issue should adopt it rather than invent; if it
doesn't, saying why is worth writing down, since "we should probably use a
standard" will come up again.

Ian's own doubt there applies here too: jsdoc was the obvious candidate and may
not fit, because the question being asked is *"when would I reach for this, and
is it mine to use?"* rather than API reference. Evaluate any format against that
question specifically, not against how standard it is.
