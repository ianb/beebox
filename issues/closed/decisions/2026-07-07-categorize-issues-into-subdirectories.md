---
title: "categorize issues into subdirectories"
workstream: unknown
area: issues
resolution: implemented
---

**Closed 2026-07-20** — implemented some time ago: the queue now uses the six
category subdirectories with a status-first `closed/<category>/` layout, and
`issues/CLAUDE.md` documents the conventions (categories are dirs, dominant
category wins, reclassify by `git mv`). The orthogonal "HOT" filename marker
was not adopted; revive as its own item if the need returns.

The flat `issues/` dir has ~119 open items — too many to scan, and questions like
"which of these are real bugs?" (asked this session) have to be answered by hand.
Proposal (Ian's): split into category **subdirectories**:

- **bugs/** — actual defects producing wrong behavior/data loss/crashes.
- **features/** — new capability, ready-ish to build.
- **code-quality/** — refactors, tech-debt, lint/type raises, consistency passes.
  Expected to be the largest bucket (mostly architectural-review fallout).
- **exploration/** — not ready to implement; a tension worth discussing that could
  become a feature later. The "half-thought-out idea" end of the current queue.

`closed/` already exists as a status dir.

## Things to settle before moving 119 files

1. **Two axes: status vs. category.** Today *directory placement IS status*
   (`issues/CLAUDE.md`: "directory placement is the status; there is no `status:`
   field" — `closed/`). Adding category dirs means deciding the primary axis:
   `bugs/closed/` (category-first, status nested) vs. a top-level `closed/`
   cutting across categories (status-first). Pick one so a closed bug has exactly
   one home, and reconcile it with the existing `closed/` convention.

2. **Cross-link churn.** Issues reference each other with *relative* markdown links
   to sibling files; moving files into subdirs breaks every one (a bare sibling
   reference now needs a `../bugs/` etc. prefix). The mass move has to rewrite
   links, and whatever reads/validates them must keep working — check `doc-check`,
   the dev docs browser (`/<worktree>/dev/docs/`), and anything that
   serves/indexes the issue queue.

3. **Fuzzy / multi-category items.** A bug whose fix is a refactor; a
   code-quality item that's really a feature. A directory forces one category
   (like `closed/` forces one status). Is "pick the dominant category, reclassify
   by moving" fine, or is a frontmatter `type:` **tag** better — it allows
   multiple, makes reclassification a one-line edit with no link churn, and
   composes with the existing `area:`/`needs:` fields? The repo's own philosophy
   ("placement is status, no field") argues for dirs; but categories are fuzzier
   than open/closed, which is the case *against* dirs. This is the core decision.

4. **exploration vs. `needs: [design]`.** Many current issues already carry
   `needs: [design]` or read as explorations. Does an `exploration/` dir earn its
   place, or does the existing frontmatter already mark "not ready"? Decide before
   adding a fourth bucket that overlaps an existing signal.

## A "sticks out" marker for high-priority items (filename keyword)

Orthogonal to the categories: a lightweight way to flag the handful of items that
need attention *now* — typically high-priority bugs. Deliberately **not** a full
priority scale (no low/medium) — just a single marker so the urgent few jump out of
a listing. A keyword in the filename is enough; no frontmatter, no tooling.

Placement options:
- An uppercase keyword in the slug — `2026-07-07-HOT-connector-state-rmw.md` —
  greppable (`ls | grep HOT`), visually loud, keeps the date-first sort.
- A prefix that sorts to the very top — `!2026-…` / `HOT-2026-…` — stands out at
  the top of a listing but breaks the date-first filename convention.

Lean: an uppercase in-slug keyword (pick one word — `HOT` / `URGENT` / `P0`),
because it survives both the date-sort and the subdirectory move and needs nothing
built. Drop the keyword (a rename) when the item is handled or de-escalated. It
composes with everything above: a high-priority bug lives in `bugs/` (or carries
`type: bug`) AND carries the keyword — the marker answers "what's on fire," the
category answers "what kind of thing is it."

## Suggested first step

Whichever way #3 lands, start with a **triage pass** that assigns each open issue a
category (cheapest as a frontmatter `type:` first — reversible, no link churn, and
it reveals the real distribution). If the split is as lopsided as expected
(code-quality dominant), the subdirectory structure can follow with confidence and
a single link-rewriting move. Doing the dir move *before* triage risks churning
links twice.

Note: `issues/CLAUDE.md` and the root `CLAUDE.md`'s "issue queue" pointer both
describe the flat layout — they update as part of this.
