---
title: "Doctests use a real card type or feature as a generic fixture, so removing it breaks unrelated tests"
workstream: unattached
area: beebox
labels: [testing, doctest]
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261010-224248
---

Some doctests pick a real built-in name for behaviour that does not depend on
it. Moving `recipe` into a plugin broke two unrelated doctests with
`.recipe.card` fixtures (plugins-planning/20261010T192138Z-implemented.md);
removing the `hq-dictation` feature broke persistence and registry doctests
that used it as any feature (hq-always/20261009T235132Z-implemented.md).

A neutral fixture type and feature (registered only in tests) would decouple
them.
