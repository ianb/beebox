# docs/plans/ — proposals and in-flight plans

Three different kinds of document used to be mixed in a flat `docs/`, all
wearing the same `.md` extension:

1. **Proposals / plans** — "here's what we intend to build," written before the
   work, full of open questions and trade-offs.
2. **Records of shipped work** — detailed plans of *past* work, kept for history.
3. **Reference documentation** — "here's how the system works," describing what
   *is*, kept current.

Mixing them confuses readers (and agents): a proposal reads as if it describes
reality, and a finished plan reads as if it's still open. This directory splits
them.

## The convention

- **`docs/plans/<topic>.md`** — active proposals and in-flight plans. A plan is
  a complete unit of work, designed end-to-end (see the `bbx-plan` skill).
  Subplans: `<topic>.subplan.md`. Reviews: `<topic>.review.md`.
- **`docs/implemented-plans/<topic>.md`** — plans whose work has shipped. Moved
  here (not deleted) on merge, so the detailed reasoning behind past work stays
  findable without masquerading as current docs.
- **`docs/<anything-else>.md`** — reference documentation: how the system works
  *now*. Kept current. Not a graveyard for finished proposals.

Rule of thumb: if it says *"we should…/this plan adds…/open question:"* it's a
plan. If it says *"the system does X"* and that's true today, it's reference
docs. When a plan ships, either fold its durable "how it works" parts into
reference docs **and** move the plan to `implemented-plans/`, or just move it if
the reference material already lives elsewhere.

## Required frontmatter

Every plan (including `*.subplan.md`, excluding `README.md` and review
artifacts) has one machine-readable status and provenance record:

```yaml
---
title: "Short plan title"
status: active
workstream: seam
issues:
  - ../../../issues/features/2026-08-08-example.md
superseded-by: replacement.md
---
```

`status` is one of `draft`, `active`, `partial`, `implemented`, `superseded`,
or `parked`. Implemented plans live under `implemented-plans/`; superseded and
parked plans live under `unimplemented-plans/`. `superseded-by` is allowed only
for a superseded plan. `issues` is required and may be `[]`.

`workstream` is the bare workstream name, `unattached` for deliberately
non-workstream work, or `unknown` only when historical provenance is lost.
New plans never use `unknown`. The body retains its H1 and must not duplicate
status in a prose `**Status:**` line. `pnpm doc-check` enforces the schema and
`pnpm doc-check --fix` repairs these paths after moves.

## Research and competitive corpora live elsewhere

Competitive/comparative research (OpenClaw, Hermes, Letta, PAI, gstack, and
similar) is **not** a plan and does not live here — it lives in the
monorepo-top-level `research/` directory (see `research/CLAUDE.md`). Findings
worth pursuing get filed into the monorepo-root `issues/` tree or promoted to
an actual plan in this directory.

## Wiring

The [finish agent](../../../.claude/agents/finish.md) reconciles plans against
implementation evidence before landing. The commit and landing gates validate
status/location consistency; see [documentation checks](../README.md#enforcement-pnpm-doc-check).

## Earlier organization work

The [plan-directory migration history](../reports/plan-directory-migration-history-2026-09-13.md)
records earlier moves and judgments. It is historical context, not a current
backlog or an instruction to repeat those moves.
