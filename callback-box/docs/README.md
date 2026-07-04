# docs/ — map and naming conventions

This directory mixes several kinds of document. Knowing which kind you're
reading (or writing) tells you where it belongs and how much to trust it as
current truth.

## Layout

- **`docs/*.md`** (flat) — current reference and operational docs: how the
  system works *now*. Kept up to date; not a place to park a proposal or a
  finished plan.
- **`docs/plans/`** — active proposals, not yet (fully) shipped. Every plan
  opens with a `**Status:**` line; see `docs/plans/README.md` for the full
  status-header convention and how plans move between directories.
- **`docs/implemented-plans/`** — plans whose work has shipped, moved here
  (not deleted) so the reasoning behind past work stays findable without
  masquerading as current reference.
- **`docs/unimplemented-plans/`** — plans retired or parked without shipping.
  Each entry in the directory's `README.md` disposition table says what
  superseded or shelved it.
- **`docs/reports/`** — point-in-time snapshots: audits, investigations,
  one-off analyses. Filenames are date-stamped (`<topic>-YYYY-MM-DD.md`)
  because a report describes a moment, not an evolving truth — don't update
  one in place to reflect later reality; write a new one.
- **`docs/design/`** — the engineering-rationale reference: why the system is
  shaped this way, one small file per topic (split from the former
  `design.md`, reconciled to boxholder rulings 2026-07-04). Peer of
  `stack-decisions.md`; answers *why*, never *how to*.
- **`docs/architecture/`** — the onboarding narrative series: longform,
  human-facing "what is this thing" writing. Not required reading, not a
  design-rationale reference (that's `docs/design/`).
- **`docs/doc-graph.md`** / **`docs/doc-graph.html`** — generated
  cross-reference index and narrative showcase. Regenerate with
  `pnpm doc-graph` after moving or renaming docs; never hand-edit.

## Naming rules

- **kebab-case filenames.** `README.md` and `CLAUDE.md` are exempt (fixed
  names other tooling/conventions expect); everything else is
  `lowercase-with-hyphens.md`.
- **Filenames say what the doc IS NOW.** Rename freely when a doc's role
  changes — e.g. strip a `-design` stem once the doc becomes the live
  reference for something that shipped.
- **Superseded docs get a `-superseded` suffix.** A doc that's been replaced
  but is kept for its reasoning is never left under its old, now-misleading
  name.
- **Dotted suffixes attach companion docs to a plan**: `<topic>.subplan.md`,
  `<topic>.review.md`, `<topic>.gap-analysis.md`. These ride along with
  whatever directory the parent plan lives in.

Keep this file terse — it's read by agents, not just humans.
