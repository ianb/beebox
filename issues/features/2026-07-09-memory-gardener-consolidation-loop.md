---
title: "memory gardener consolidation loop"
workstream: unknown
area: callback-box
needs: [design]
priority: backlog
next-action: discuss
---

From the Rowboat review (`research/rowboat-review.md`). Rowboat's memory isn't the
Qdrant vector store — that's a document-RAG tool. Its actual memory is an
agent-built, git-versioned, Obsidian-style **markdown knowledge graph** (per-entity
notes with wikilinks, built from synced email/meetings), and its standout feature is
a **daily "gardener" agent** (`note_curation.ts`) that fights note bloat/rot:

- collapses activity older than 60 days into monthly summaries,
- promotes recurring patterns into dated **Key Facts / Assistant Notes** (a reflection step),
- retires stale open items to a **Dormant** list,
- reconciles frontmatter/body drift and perspective errors,
- runs on qualification + throttles: notes qualify at ≥8 activity entries, modified
  since last curation, 7-day cooldown, **max 8 notes/run**, stamped `curated_at`,
  committed to history as "Knowledge curation."

That's markdown + git + an agent that *maintains* it — the same substrate as our
cards, plus a maintenance loop we don't have.

## What we already have (and why this is still a gap)

- **Retro** (`src/core/retro/`, `docs/implemented-plans/box-retrospectives.md`) —
  observes *chat sessions* after they quiesce and extracts observations/feedback. It's
  a **learning loop (sessions → observations)**, not a consolidation of accumulated
  records.
- **Landmark curation** (`docs/landmark-curation.md`) — curates the *navigation
  surface*, not note content.
- **Distill-into-`rules`** (`box/skills-content.ts`, `schemas/exposition-plan.ts`) —
  compiles material into rules, scoped to authoring, not a standing pass.
- **CLAUDE.md lint / reducing** (`core/claude-md-lint.ts`) — doc hygiene.

None of these is a **scheduled pass over the box's own accumulated cards/notes** that
summarizes the old, promotes the recurring, and retires the stale to fight rot over
time. Retro feeds *in* new learnings; nothing *gardens* what's piled up.

## Direction

A scheduled "gardening" wakeup (natural fit for `cb tick`/reactor + a schedule card)
that walks high-activity / long-lived cards and consolidates them, using Rowboat's
concrete rules as a starting spec (age-based collapse, recurring→facts, stale→dormant,
qualification thresholds + cooldown + per-run cap, commit as a distinct "curation"
message so it's auditable in git). It **complements** retro (retro learns from
sessions; the gardener maintains the record) and leans on git history so a bad
consolidation is revertable.

## To settle (why `needs: design`)

- **Which cards get gardened?** Rowboat gardens per-entity notes; ours are typed cards
  of many kinds. Todo lists, project cards, memory/answer cards want different
  consolidation than, say, a recipe. Scope it, don't garden everything.
- **Consolidation is lossy** — how does the boxholder review/trust it? Git history +
  a distinct commit message is the safety net (revertable); is that enough, or does it
  need a "proposed consolidation" review step? (Ties to
  `feedback_arrange_context_not_automate_judgment` — keep judgment-heavy consolidation
  a procedure feeding an agent, not a silent auto-rewriter.)
- **Overlap with retro** — should this be a retro phase, or its own subsystem? They
  share "quiescence + scheduled walk + agent pass" machinery.
