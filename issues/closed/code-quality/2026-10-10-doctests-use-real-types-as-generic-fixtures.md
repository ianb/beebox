---
title: "Tests use a real card type or feature as a generic fixture, so removing it breaks unrelated tests"
workstream: tooling-burndown
area: beebox
labels: [testing, doctest]
needs: [decision]
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261010-224248
resolution: wontfix
---

**Closed (wontfix, 2026-10-30):** The boxholder accepted the coupling (2026-10-30). The card-type half was already stale (recipe is a plugin; leftover .recipe.card paths are inert). For features, a test-only feature would need a registration hook in production code (src/core/chat/features.ts) and would still leave the serialized <chat-app> fixtures; removing a feature costs mechanical edits in about eight test files instead.

> **Naming note (2026-10-18):** doctests (`*.doctest.md`) are now `.test.ts` files with `t.check`, in the same directory under the same base name, and `agent-doctest` is now `tap-check/` (`@ianbicking/tap-check`). See `beebox/docs/implemented-plans/retire-doctest.md`.

Some tests (doctests when filed; `.test.ts` files since 2026-10-18) pick a real built-in name for behaviour that does not depend on
it. Moving `recipe` into a plugin broke two unrelated doctests with
`.recipe.card` fixtures (plugins-planning/20261010T192138Z-implemented.md);
removing the `hq-dictation` feature broke persistence and registry doctests
that used it as any feature (hq-always/20261009T235132Z-implemented.md).

A neutral fixture type and feature (registered only in tests) would decouple
them.

## 2026-10-29 (tooling-burndown): current state

**Card types: stale.** `recipe` is now a plugin (`test/plugins/recipe/`), and no
schema in `src/schemas/` is a recipe. The about 140 `.recipe.card` lines left in
`beebox/test/` and `beebox/src/frontend/test/` outside `test/plugins/recipe/`
are path strings: body-ref parsing, display paths, landmark expansion queries,
a non-doc card refused by the composition router. They pass with no recipe
schema registered, so removing the type cannot break them. No other built-in
type was found used as a stand-in where a registered schema mattered.

**Features: still true.** The chat feature registry
(`beebox/src/core/chat/features.ts`) is a closed list of two, `narration` and
`prose`. `FeatureStore.set` rejects an unknown name and `resolveFeatures` drops
one, so a test that needs "any feature" must name a real one. Three files use
`narration` that way: `test/core/chat/session/history.features-persistence.test.ts`,
`test/core/chat/session/registry.test.ts` (around line 378), and
`test/core/chat/session/reserve.test.ts` (around line 163). Removing
`narration` would break them as removing `hq-dictation` did. Separately, about
five files embed the full serialized `<chat-app narration="off" prose="on" ...>`
tag in fixtures for behaviour that is not about features (for example
`test/core/chat/session/run.maintenance.test.ts`,
`test/core/chat/session/run.with-spawner.test.ts`); any change to the feature
list breaks those, and a fixture feature would not help them.

**Decision needed.** A test-only feature needs a registration seam in
`features.ts` (production code), and the persistence tests' resolved-map
assertions would still list every real feature. The alternatives: add the seam
and narrow those assertions to the fixture key; or accept the coupling. A
feature removal then costs a rename in the three files above plus an edit to
each serialized `<chat-app>` fixture (about five files), all mechanical; the
seam would remove only the first part. The lean is to accept the coupling and
close this, because the seam adds a concept to production code for a rare,
mechanical breakage it only partly prevents.
