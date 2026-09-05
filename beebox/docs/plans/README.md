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

- **`finish`** files shipped plans automatically: step 6 of
  `.claude/agents/finish.md` ("Reconcile planning docs with reality")
  moves implemented plans to `docs/implemented-plans/`, parks abandoned
  ones in `docs/unimplemented-plans/` with a README disposition row, and
  applies the naming conventions (`docs/README.md`). The 2026-07-04
  docs-reorg cleared the backlog that accumulated before this was
  wired.

## Migration (done)

The first backlog batch was migrated and all `docs/…` references rewritten:

- → `implemented-plans/`: `selection-commentary.md`, `markdoc-tags-plan.md`
  (+ `.review.md`, `.review-adapted-trial.md`), `markdoc-format-investigation.md`,
  `shared-frontend-backend-code.subplan.md`, `narration-mode-design.md`
  (feature shipped, despite the doc's stale "proposal" header — later
  found to be inaccurate; see 2026-07-04 below).
- → `plans/` (still open): `pdf-intake-design.md` (not yet implemented),
  `source-editor.md`. (`triage.md` later turned out to be fully built
  and was promoted to `docs/triage.md` as a reference doc — see the
  2026-07 doc reorg.)

**2026-07-04:** `implemented-plans/narration-mode-design.md` was moved back
to `plans/narration-mode.md` — the doc opens "Status: proposal, for
discussion" and was never actually implemented; its earlier placement in
`implemented-plans/` above was a misfiling, not a correction.

**Follow-ups:**
- Regenerate the doc graph (`pnpm doc-graph`) — it's generated and still shows
  the old paths; it self-heals on the next run.
- A few more plan-shaped docs remain in `docs/` and need a judgment call on
  reference-vs-proposal before moving: `activities-design.md`,
  `event-bus.md`, `photo-storage-investigation.md`. Left in place
  (some read more like vision/reference than active proposals — `design.md`,
  `design-vision.md`, `stack-decisions.md` were judged reference and stayed
  at the time; on 2026-07-04 the design-reconciliation execution split
  `design.md` into `docs/design/` and retired `design-vision.md` to
  `unimplemented-plans/design-vision-superseded.md`).
  `design-card-views.md` has since moved to `unimplemented-plans/`
  (superseded by the shipped renderer registry, now
  `design-card-views-superseded.md`), `attach-implementation.md`
  to `implemented-plans/` (superseded by `docs/asset-manifests.md`, now
  `attach-directories-superseded.md`), and
  `capture-pipeline-redesign.md` to `unimplemented-plans/` (parked 2026-03).
