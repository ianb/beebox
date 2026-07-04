# issues/

The idea and issue queue for the monorepo. Most items here are **tensions, not
resolutions** — half-thought-out design ideas, noticed problems whose right fix
isn't obvious, questions that need research before they're actionable. An item
being filed is *not* license to implement it: researching or designing an item
is real work on it; implementing it happens when Ian chooses it.

Plain bugs mostly don't belong here — if you can just fix it, fix it. File an
issue when the thing you noticed is outside your current work, or when the
resolution is genuinely unsettled.

## Files

One file per item: `YYYY-MM-DD-<slug>.md`, date = when filed. The slug is the
ID — pick a descriptive name. Before filing, grep the directory for related
slugs and words; if a matching item exists, extend it rather than filing a
duplicate (two people reaching for the same name usually means the same
tension).

Closed items live in `closed/`, moved there with `git mv` — directory
placement is the status; there is no `status:` field. Closed items aren't
interesting; git history is the archive, and long-closed files can be deleted
in periodic sweeps.

Cross-link related issues with ordinary relative markdown links
(`[slug](2026-07-04-foo.md)`). Links to items that don't exist yet are fine as
plain text naming the idea.

## Frontmatter

All fields optional; omit what doesn't apply.

```yaml
---
needs: [design, decision]   # what must happen before this could be implemented
design: ../callback-box/docs/plans/foo.md   # link once a design/plan exists
area: callback-box          # callback-box | router | vibe-check | clerk | docs | ...
filed-by: agent             # only for non-Ian items
discovered-in: worktree-foo — while doing X   # pair with filed-by: agent
resolution: implemented     # closed/ only: implemented | wontfix | superseded
---
```

- `needs:` values: `design` (needs a design/plan written), `decision` (a fork
  only Ian can resolve). Research-needed is signalled in the body instead —
  see below.
- `resolution:` is set when moving to `closed/`. Add a short closing note at
  the top of the body naming the resolving commit, plan doc, or reason.

## Body

State the tension: what was noticed, why the resolution isn't obvious, enough
context (including `file:line` pointers) to pick it up cold months later.

**Research** always goes in the body. If research is the next step, file the
item with a stub section:

```markdown
## Research (incomplete)
```

Whoever researches the item fills the section in and retitles it
`## Research (YYYY-MM-DD)`. So `grep -rl "## Research (incomplete)" issues/`
lists everything awaiting research, and researching an item is a first-class
way to advance it without implementing anything.

## Filing (agents)

Filing is at your discretion — no thresholds or quotas. When you notice
something worth keeping that's outside your current task: check for an
existing item, then file with `filed-by: agent` and `discovered-in:` (your
worktree and what you were doing), and move on. Don't fix out-of-scope things
in place, and don't file trivia you'd be embarrassed to see triaged.
