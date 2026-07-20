# issues/

The idea and issue queue for the monorepo. Most items here are **tensions, not
resolutions** — half-thought-out design ideas, noticed problems whose right fix
isn't obvious, questions that need research before they're actionable. An item
being filed is *not* license to implement it: researching or designing an item
is real work on it; implementing it happens when Ian chooses it.

Something you can just fix, fix — don't file it. File when the thing you noticed
is outside your current work, or when the resolution is genuinely unsettled.

## Layout: category subdirectories

Open items live in one of six **category subdirectories** (the category *is* the
directory — like `closed/` is the status, there is no `type:` field):

- **`bugs/`** — actual defects: wrong behavior, data loss, crashes, flakes.
- **`features/`** — new user/agent-facing capability.
- **`code-quality/`** — refactors, tech-debt, lint/type raises, tests, internal
  consistency. (Usually the largest bucket — mostly architectural-review fallout.)
- **`docs-and-chores/`** — documentation, process, and maintenance chores.
- **`decisions/`** — items whose deliverable is a *call to make*, not a build
  (unify-or-not, keep-or-drop, evaluate-and-decide).
- **`exploration/`** — not ready to implement: half-thought-out ideas,
  external-tool evaluations ("check out X"), research, agent-cognition tensions.

Each item is one file, `<category>/YYYY-MM-DD-<slug>.md` (date = when filed; slug
is the ID — pick a descriptive name). Before filing, grep the whole tree for
related slugs/words and extend a matching item rather than duplicating. Pick the
*dominant* category — a bug whose fix is a refactor is still a `bug`. Reclassify
by `git mv`-ing between category dirs (and fix any inbound links).

## Closed items

Closed items move to **`closed/<category>/`** with `git mv` — directory placement
is the status (open = a category dir, done = under `closed/`), and the category
is preserved. Closed items aren't interesting; git history is the archive, and
long-closed files can be deleted in periodic sweeps.

## Titles + cross-links

The **title lives in frontmatter** (`title:`), not an `# H1` — the body starts
straight into the tension. Cross-link related issues with relative markdown
links: same category → bare `<file>.md`; cross-category →
`../<category>/<file>.md` (e.g.
`[knip-exports](../code-quality/2026-07-04-knip-exports-enforcement.md)`). A doc
elsewhere links in as `…/issues/<category>/<file>.md`. Links to items that don't
exist yet are fine as plain text naming the idea. `doc-check` validates every
link, so moving/reclassifying an item means rewriting its inbound links — from
other issues AND from `docs/`.

**External URLs get a title too** — `[Orwell's six rules](https://…)`, not a bare
URL. A bare URL makes the reader parse a link to find out what it is. (The dev
docs renderer autolinks bare ones as a fallback, but that only makes them
clickable, not informative.)

## Frontmatter

`title:` is required; everything else is optional — omit what doesn't apply.

```yaml
---
title: "Short human title"    # required — the H1 replacement
needs: [design, decision]     # what must happen before this can be called done
design: ../../callback-box/docs/plans/foo.md   # link once a design/plan exists
area: callback-box            # callback-box | router | vibe-check | clerk | docs | ...
filed-by: agent               # only for non-Ian items
discovered-in: worktree-foo — while doing X    # pair with filed-by: agent
resolution: implemented       # closed/ only: implemented | wontfix | superseded
---
```

- `needs:` values: `design` (needs a design/plan written), `decision` (a fork
  only Ian can resolve), `manual-testing` (see below). Research-needed is
  signalled in the body instead — see below. `needs: [decision]` is
  **orthogonal** to the `decisions/` category: a *feature* can carry
  `needs: [decision]` and still live in `features/`; `decisions/` is only for
  items whose *whole deliverable* is the call.
- `needs: [manual-testing]` means **an agent cannot finish verifying this — Ian
  has to exercise it himself.** Unlike the other two it's usually added *after*
  the code lands, not before: the work is written and tests pass, but the thing
  it actually fixes can only be confirmed by a human (on a phone, in a real
  browser, against live external credentials, over a real network, or by looking
  at whether it *feels* right). Add it rather than closing an item on green
  tests, and say in the body **what specifically to try and what should happen**
  — a year from now "needs testing" alone is useless. An agent should never
  remove this itself; only Ian clears it, by testing. `grep -rl "manual-testing"
  issues/` is the list of things waiting on him.
- `resolution:` is set when moving to `closed/`. Add a short closing note at the
  top of the body naming the resolving commit, plan doc, or reason.

## Body

State the tension: what was noticed, why the resolution isn't obvious, enough
context (including `file:line` pointers) to pick it up cold months later.

**Research** always goes in the body. If research is the next step, file the item
with a stub section:

```markdown
## Research (incomplete)
```

Whoever researches the item fills the section in and retitles it
`## Research (YYYY-MM-DD)`. So `grep -rl "## Research (incomplete)" issues/` lists
everything awaiting research, and researching an item is a first-class way to
advance it without implementing anything.

## Filing (agents)

Filing is at your discretion — no thresholds or quotas. When you notice something
worth keeping that's outside your current task: check for an existing item, pick a
category, then file with `title:`, `filed-by: agent`, and `discovered-in:` (your
worktree and what you were doing), and move on. Don't fix out-of-scope things in
place, and don't file trivia you'd be embarrassed to see triaged.
