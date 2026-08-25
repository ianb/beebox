---
title: "Move logic out of `.mjs` files into TypeScript"
workstream: knip-exports
resolution: superseded
---

**Superseded 2026-08-25** by
[the fuller inventory](../../code-quality/2026-08-25-mjs-files-should-be-typescript.md),
filed from a main session with the boxholder's own framing. That one verified
`eslint.config.ts` actually loads (this one only reasoned that it should),
sorts all thirty files, and flags the package-consumption risk for
`personal-vibe-check`'s `exports` map and `bin/` entries.

The one datum worth keeping — that the untyped preset hid two real defects —
has been folded into it. This file's `user-stories/pipeline/*.workflow.mjs`
section is moot: those files no longer exist on `main`.

2026-08-24 · noticed while editing the vibe-check preset (knip-exports workstream).

House rule: all logic in `.ts`; `.js`/`.mjs` only as a thin loader shim for TS.
About 3,500 lines currently live in `.mjs`, some of it under `src/`.

## Genuinely constrained — leave as `.mjs`

These cannot be TypeScript, and the reason should be written at the top of each
(three of the five do not currently say):

| File | Lines | Why |
|---|---|---|
| `agent-doctest/src/doctest-hooks.mjs` | 506 | Node loader hook via `node:module` `register()` — it is what *enables* TS loading, so it cannot itself require loading |
| `agent-doctest/src/resolve-rules.mjs` | 126 | Imported by that loader; same bootstrap constraint (it already carries a hand-written `resolve-rules.d.mts`) |
| `callback-box/tsx-preload.mjs` | 17 | Preload, runs before tsx |
| `bin/lib/detach.mjs` | 22 | Same family |

The doctest pair is the awkward case: it is the sanctioned shim shape, but at
632 lines it is not thin. If that logic wants types, the split is a small
`.mjs` hook that delegates to a `.ts` module the hook itself can load — worth
a look, not obviously worth the complexity.

`callback-box/user-stories/pipeline/*.workflow.mjs` (1,464 lines across five
files) are Workflow-tool scripts, which that tool requires to be plain JS.
Being raised separately with the user-stories workstream — out of scope here.

## Not constrained — convertible today

ESLint 9.39.4 and jiti 2.7.0 are installed, so `eslint.config.ts` is supported.
`build-cli.mjs` runs as `node scripts/build-cli.mjs` and could be
`tsx scripts/build-cli.ts`. The rule implementation and its test are ordinary
modules.

| File | Lines |
|---|---|
| `personal-vibe-check/eslint.config.mjs` | 807 |
| `personal-vibe-check/rules/test/restrict-component-classes.test.mjs` | 370 |
| `personal-vibe-check/rules/restrict-component-classes.mjs` | 301 |
| `personal-vibe-check/bin/vibe-init.mjs` | 250 |
| `canvas-loop/src/eslint/index.mjs` | 215 |
| `callback-box/src/frontend/eslint.config.mjs` | 175 |
| `callback-box/scripts/build-cli.mjs` | 133 |
| `personal-vibe-check/bin/vibe-check.mjs` | 128 |
| `callback-box/eslint.config.mjs` | 102 |
| `canvas-loop/test/tea-lint.test.mjs` | 78 |

`canvas-loop/src/eslint/index.mjs` is a published subpath export, so check how
consumers resolve it before moving.

## Why the preset is the one worth doing first

Highest logic density, no constraint, and being untyped has already cost
something. Two defects found in it on 2026-08-24: the `exts` gate silently
excluded `.tsx` from the entire reviewed ruleset, and rule keys sat in a
`disabledRules` object that never reached the files they named. Neither is a
type error, so TypeScript would not have caught them directly — but the flat
config types make the shape of what is being assembled visible, which is
exactly what was missing.
