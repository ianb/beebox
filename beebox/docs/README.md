# docs/ — map and naming conventions

This directory mixes several kinds of document. Knowing which kind you're
reading (or writing) tells you where it belongs and how much to trust it as
current truth.

## Layout

- **`docs/*.md`** (flat) — current reference and operational docs: how the
  system works *now*, one file per subject. A subject with several children
  (see [testing](testing.md) and `testing/`) keeps its parent file flat and
  puts the children in a same-named directory. Kept up to date; not a place
  to park a proposal or a finished plan. The deliberate exception is [name history](name-history.md),
  the single in-tree record of product naming changes. The security report is
  also deliberately maintained here: its revision/date provenance records the
  latest reviewed accounting; it is not an immutable experiment report.
- **`docs/plans/`** — active proposals, not yet (fully) shipped. Plans use YAML
  frontmatter `status: draft`, `active`, or `partial`, not a duplicate prose
  status line. See [plan conventions](plans/README.md) for required fields.
- **`docs/implemented-plans/`** — plans whose work has shipped, moved here
  (not deleted) so the reasoning behind past work stays findable without
  masquerading as current reference. `status: implemented` means the work
  shipped, not that every sentence is current. Link current operating guides
  from history when available, and label incoming historical links as such.
- **`docs/unimplemented-plans/`** — plans retired or parked without shipping.
  Each entry in the directory's `README.md` disposition table says what
  superseded or shelved it. Their status is `parked` or `superseded`.
- **`docs/reports/`** — point-in-time snapshots: audits, investigations,
  one-off analyses. Filenames are date-stamped (`<topic>-YYYY-MM-DD.md`)
  because a report describes a moment, not an evolving truth — don't update
  one in place to reflect later reality; write a new one.
- **`docs/design/`** — the engineering-rationale reference: why the system is
  shaped this way, maintained as decisions change, one small file per topic (split from the former
  `design.md`, reconciled to boxholder rulings 2026-07-04). Answers *why*, never *how to*. (The old `stack-decisions.md` log is
  frozen under `reports/`.)
- **`docs/box/`** — prose docs written for box agents, shipped into every
  installed package's `box-docs/` beside the generated reference docs
  (`src/core/docs-gen/package-docs.ts`). Each has a `read-when:` frontmatter
  line that becomes its row in the `box-docs/README.md` index. Currently
  [what you could do with your box](box/what-you-could-do.md) and
  [interface cards](box/interface-cards.md).
- **`docs/architecture/`** — the onboarding narrative series: longform,
  human-facing "what is this thing" writing. Not required reading, not a
  design-rationale reference (that's `docs/design/`).
- **`docs/doc-graph.md`** / **`docs/doc-graph.html`** — generated
  cross-reference index and narrative showcase. Regenerate with
  `pnpm doc-graph` and `pnpm doc-graph-html` in `beebox/` after moving or
  renaming docs; never hand-edit.

## Enforcement (`pnpm doc-check`)

The pre-commit hook runs `pnpm doc-check` on any `.md` commit. It fails on a
broken reference, a live-area orphan (a flat `docs/`, `architecture/`, or
`scheduled/` doc nothing links to — the plans taxonomy and `reports/` are
archives and exempt), or a **duplicate basename under `issues/`** — the
unique-basename invariant that makes issue-link repair possible. Prints nothing
on success; on failure, fix the links and regenerate the index (`pnpm
doc-graph`).

Plan status/location consistency is also checked against the complete staged
Git index on every commit, and against the candidate branch before `bin/land`
merges. The shared validator rejects unreadable metadata and never assigns a
shipped status automatically. Run `node --import tsx bin/doc-lifecycle-check.ts
--index` from the monorepo root to check the staged state.

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

## Organizing principles

Documentation is structured like code: one home per fact, and names that lead
to it. The same rules apply at every level (directory, file, heading,
subsection).

1. **One home per fact.** Every fact is stated in full in exactly one section.
   Everywhere else it is a pointer. On finding a second full statement, delete
   the one that is not at the home and leave a pointer.
2. **A pointer says where, not what.** One sentence plus a link, at most. A
   pointer that carries a value, command, or number is a restatement.
3. **Restatement is the exception and is marked.** Allowed when the reader
   cannot be expected to follow the link before acting: a rule an always-loaded
   file (`CLAUDE.md`, the agent guide) must carry, or a contract clause a client
   implementer copies. Each restatement ends with "(restated from [home])" so a
   search finds every copy when the home changes. A parent's one-line
   description of each child is the index, not a restatement.
4. **Siblings do not overlap and together cover the parent.** For any fact in
   the parent's scope, exactly one sibling name is the obvious pick. If two
   names could hold it, rename or merge. If none could, the parent is missing a
   child or the fact belongs one level up.
5. **One axis per parent.** A parent partitions its children along one
   dimension and says which in its first paragraph. The axes here, outermost
   first: `docs/` by kind (the layout above); reference by subject (one file or
   one directory per subsystem or activity); a subject directory by member (the
   parts a reader operates separately); a reference file by aspect, in this
   order and with no other top-level headings: *What it is* (scope and the
   question it answers), *How it works*, *Running it*, *Writing one* or
   *Changing it*, *Reading results* or *Failure modes*. Use only the aspects
   the doc needs.
6. **Names are the search path.** A name says what the node contains, in the
   reader's words, and distinguishes it from its siblings without reading
   either. Headings are noun phrases naming a scope, not sentences making a
   claim; the claim goes in the first line under the heading. No facts above
   the first heading except the scope statement. Numbered headings only in
   contracts whose clauses are cited by number.
7. **A fact lives at the lowest node whose scope contains all its uses.** Used
   by one member: that member's file. About choosing among members: the
   parent. Used across subjects: its own subject, pointed to by the others.
   Tie-breaker between a subject owner and a cross-cutting catalog
   ([maintenance](maintenance.md), `schedules/`): the subject owns *what* and
   *how*; the catalog owns *when* and is an index of pointers; when the catalog
   is derived from code (`bin/schedules list`), the code is the home.
8. **The parent is an index plus what is true of the whole.** Scope, the axis,
   one line per child, and the facts that belong to no single child. Nothing
   more about any child.
9. **History is not reference.** Design reasoning, rollout records, and "why
   not" go to `design/`, `implemented-plans/`, or `reports/`; the reference doc
   points there.

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
