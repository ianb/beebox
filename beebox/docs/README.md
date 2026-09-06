# docs/ — map and naming conventions

This directory mixes several kinds of document. Knowing which kind you're
reading (or writing) tells you where it belongs and how much to trust it as
current truth.

## Layout

- **`docs/*.md`** (flat) — current reference and operational docs: how the
  system works *now*. Kept up to date; not a place to park a proposal or a
  finished plan. The deliberate exception is [name history](name-history.md),
  the single in-tree record of product naming changes.
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
- **`docs/box/`** — prose docs written for box agents, shipped into every
  installed package's `box-docs/` beside the generated reference docs
  (`src/core/docs-gen/package-docs.ts`). Each has a `read-when:` frontmatter
  line that becomes its row in the `box-docs/README.md` index. Currently
  [what you could do with your box](box/what-you-could-do.md).
- **`docs/architecture/`** — the onboarding narrative series: longform,
  human-facing "what is this thing" writing. Not required reading, not a
  design-rationale reference (that's `docs/design/`).
- **`docs/doc-graph.md`** / **`docs/doc-graph.html`** — generated
  cross-reference index and narrative showcase. Regenerate with
  `pnpm doc-graph` after moving or renaming docs; never hand-edit.

## Enforcement (`pnpm doc-check`)

The pre-commit hook runs `pnpm doc-check` on any `.md` commit. It fails on a
broken reference, a live-area orphan (a flat `docs/`, `architecture/`, or
`scheduled/` doc nothing links to — the plans taxonomy and `reports/` are
archives and exempt), or a **duplicate basename under `issues/`** — the
unique-basename invariant that makes issue-link repair possible. Prints nothing
on success; on failure, fix the links and regenerate the index (`pnpm
doc-graph`).

`pnpm doc-check --fix` repairs decayed links. When a file moves (an issue
resolving `bugs/foo.md` → `closed/bugs/foo.md` is the common case) every
relative link to it breaks. For a link whose literal target no longer resolves,
if the target's **basename is unique repo-wide** (across tracked `.md`,
excluding the intentionally-per-directory `NON_UNIQUE_BASENAMES` —
`CLAUDE.md` / `README.md` / `SKILL.md`) `--fix` rewrites the path to the file's
current location. It never guesses: a basename with no match (a true
rename/delete) or 2+ matches is reported for manual handling, not rewritten.
Links inside code spans / fenced blocks (syntax illustrations) and generated
emitter outputs are left untouched. It also prints a non-fatal report of
repo-wide duplicate basenames — the gap toward making basenames globally
unique. Mechanism: `src/dev/doc-link-repair.ts`.

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
