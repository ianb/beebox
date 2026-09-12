---
title: Three shipped procedure templates still name pre-one-root paths, so they cannot be installed
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: main — reconciling parked `_config/_template-updates/` copies across four local boxes
---

`beebox/templates/procedures/` ships four procedure cards. Three of them
address the box through paths this shape does not have:

| Template | pre-one-root path references |
|---|---|
| `process-pages.procedure.card` | 23 |
| `process-retrospective.procedure.card` | 10 |
| `refresh-maps.procedure.card` | 2 |

They name `box/inbox/pages-saved/`, `box/questions/`, `box/pool/reading/`,
`store/recipes/`, `store/catalogs/`, `store/archive/captures/` and
`store/reviews/retro/`. Under `shapeVersion: 3` those live at `_content/…`
and `_bookkeeping/…` (`docs/box-layout.md`).

Two consequences, and the second is the quiet one:

- **The procedures no-op.** `process-pages`'s `precheck` shell counts
  `box/inbox/pages-saved/*.record.card`; on a current box that glob matches
  nothing, so the step exits `CHECK_SKIP` every run. The procedure looks
  installed and healthy and never does anything.
- **The templates cannot be accepted.** Every box's live copy is older stock,
  so `installTemplateFile` parks the new version under
  `_config/_template-updates/`. Accepting the parked copy would replace one
  broken file with another, so it stays parked — which is why four local boxes
  each carried the same three parked procedures for months.

`process-pages` has a second, independent defect: its agent prompt is a folded
block scalar (`prompt: >-`) whose long lines were re-wrapped at some point.
YAML folding turns a single newline into a space and a blank line into a
newline, so the stored text reads

```
Review pages in box/inbox/pages-saved/ and box/inbox/pages-todo/ and
route them

to appropriate destinations.
```

and the prompt the agent receives has a paragraph break in the middle of the
sentence. `refresh-maps` uses `>-` too and wants the same check. A prompt body
should be a literal scalar (`|-`), which is what the other templates use and
what the live box copies still have.

Fixing this is a path-by-path rewrite of three files plus a re-read of what
each step actually does, so it is not a sweep — and it changes what agents on
real boxes are told to do, which is the part worth a careful eye.

Adjacent, filed here because it surfaced in the same reconciliation: a guide
card is a *learning* surface (`triage-rules` accumulate `source: inferred`
entries), so once a box learns anything its guide differs from the template
forever and the update parks on every install. test1 is in that state now. That
suggests guide cards want box-owned fields, or want template updates only at
first install — a decision, not a bug.
