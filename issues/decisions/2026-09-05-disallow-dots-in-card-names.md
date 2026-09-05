---
title: "Decide whether a card's name segment may contain dots — `Foo.bar.doc.card` vs `Foo_bar.doc.card`"
workstream: unattached
area: beebox
needs: [decision]
labels: [cards]
filed-by: agent
discovered-by: Ian
discovered-in: "worktree-sidecar-shell — after the figure attach-scope bug"
priority: normal
---

A card filename is a grammar, not a label: `Name.<type>.card` carries the
card's identity AND its type, and other names are derived from it — the attach
directory is `<basename>.attach/`, and `cardBasename()`/`parseCardFileName()`
(`beebox/src/shared/attach-path.ts`, `beebox/src/shared/card-name.ts`) split it
back apart on dots. A dot inside the *name* segment is therefore legal but
ambiguous to read: `Foo.bar.doc.card` parses as name `Foo.bar`, type `doc`,
because the type match is the last segment before `.card`. The proposal is to
forbid it — a name uses `_` (the existing `First_Last` authoring convention),
and a dot appears only as a grammar separator.

## Why it is worth deciding now

The grammar already misled the code that implements it. `/api/figure/module.js`
computed a figure's owning card by replacing `.attach` with `.card`, which is
correct only if the name has no type in it; every figure in every box was
refused, and the route's own doctests seeded `Demo.figure.attach/` — a dotted
form that satisfied the broken rule and that no box uses
([2026-09-05-figure-module-attach-scope-has-no-owning-card](../closed/bugs/2026-09-05-figure-module-attach-scope-has-no-owning-card.md)).
A grammar that a careful reader can misparse is one that agents and future
routes will misparse too.

The rule also decides what `Foo.bar.doc.card` MEANS. Today it silently means a
card named "Foo.bar". Two real cards in local boxes are exactly this shape:

```
test1/_bookkeeping/questions/scan-20260429T0249-e0911662_photo-003.review.question.card
```

That is name `scan-…_photo-003.review`, type `question` — the `review` reads
like a qualifier and is in fact part of the name. Either it was meant as one
and the grammar cannot express it, or it was an accident nothing caught.

## What the decision has to cover

- **The job-card exception is real.** `Name.<kind>.job.card` is a deliberate
  dotted form (`parseCardFileName` maps `Foo.intake.job.card` → type
  `intake-job`, and the reactor discovers jobs by that suffix). A ban has to
  carve it out, or job cards need a different shape — which is a bigger change
  than this issue proposes.
- **Positional cards** (bare `<type>.card`, "the ‹type› of this directory")
  are unaffected: they have no name segment.
- **Enforcement layer.** The natural home is `bbx validate` alongside the
  existing same-basename-in-one-directory lint, so a bad name is a commit
  blocker rather than a silent reinterpretation. Agents author most card
  filenames, so the schema `instructions` and the agent guide would carry the
  rule too.
- **Cost of the ban.** Two cards locally (one of them in a backup), unknown on
  the deployed server. Renaming a card is not a file rename: refs to it live in
  other cards, and its attach directory changes name with it — that is
  `bbx-migration` work, small but not free. A grandfather clause (warn, do not
  block, on existing names) is the cheaper alternative and leaves the ambiguity
  in place.

## The alternative worth weighing

Do nothing to the grammar and instead make the parsing helpers the only way to
read a card filename — the figure bug was hand-rolled string surgery, not a
failure of `cardBasename()`. That is less disruptive and does not need a
migration, but it leaves `Foo.bar.doc.card` meaning something no reader would
guess, and leaves the next hand-rolled split free to be wrong.
