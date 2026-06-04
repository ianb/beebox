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
  a complete unit of work, designed end-to-end (see the `cb-plan` skill).
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

## Wiring (pending)

- **`cb-plan`** should write new plans to `docs/plans/<topic>.md` (it currently
  writes to `docs/<topic>.md`). Update the skill's "write the plan to…" line.
- **`finish`** should `git mv docs/plans/<topic>.md docs/implemented-plans/` as
  part of the merge close-out, so shipping a plan files it automatically.

## Migration backlog (existing plan-shaped docs in docs/)

Not yet moved — these are proposals/design docs currently sitting in `docs/`
alongside reference material. Move to `plans/` (still open) or
`implemented-plans/` (shipped) when convenient:

- `selection-commentary.md` — shipped 2026-05 → `implemented-plans/`
- `markdoc-tags-design.md`, `markdoc-tags-design.review.md`,
  `markdoc-format-investigation.md` — design/decision records
- `shared-frontend-backend-code.subplan.md` — subplan
- `source-editor.md`, `triage-design.md`, `narration-mode-design.md`,
  `pdf-intake-design.md` — design proposals

(Sweep deferred — establish the convention going forward first, migrate the
backlog in a batch.)
