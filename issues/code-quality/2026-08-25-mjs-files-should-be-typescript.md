---
title: "The repo's `.mjs` files should be TypeScript — ESLint 9 + jiti already loads a TS config, so most of them have no reason to exist"
workstream: unattached
area: monorepo
labels: [typescript, lint, tooling]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder objecting to the .mjs files
---

> I really don't like these `.mjs` files, feels like we shouldn't need them at
> all, right?

The standing rule (root `CLAUDE.md`, and the boxholder's repeated preference) is
**all logic in `.ts`; `.js`/`.mjs` only as a thin loader for TS**. Thirty `.mjs`
files exist outside `node_modules`. Most of them predate a capability that has
since arrived.

## Verified: a TypeScript ESLint config works today

ESLint **9.39.4** with **jiti 2.7.0**, both already installed. Tested against
this repo's own binary: an `eslint.config.ts` was loaded, its rule applied, and
the violation reported. **No new dependency and no build step.** That removes
the historical reason these were `.mjs`.

## The thirty, sorted

**14 × `eslint.config.mjs` — no remaining reason.** Root, `agent-doctest`,
`browse`, `callback-box` (+ `pub-worker`, `src/frontend`), `callback-clerk`,
`canvas-loop`, `feedback-review`, `personal-vibe-check`, `scan-uploader`,
`site`, `workstreams-app` (+ `eslint.frontend.config.mjs`). This is the bulk and
the easy win.

**3 generated and gitignored — leave them.** `callback-box/dist/cli.mjs`,
`scan-uploader/dist/scan-uploader.mjs`,
`callback-clerk/.wxt/eslint-auto-imports.mjs`. Build output, not source; esbuild
and wxt emit `.mjs` and that is fine.

**1 genuinely cannot be TypeScript — leave it.** `callback-box/tsx-preload.mjs`
sets `TSX_TSCONFIG_PATH` *before tsx initializes*, so by definition it runs where
TS loading does not yet exist. This is exactly the loader carve-out the rule
allows, and it should keep a comment saying so.

**1 arguable.** `bin/lib/detach.mjs`, self-described as "a primitive, not
logic" — spawn in a new process group and exit. Converting means paying a TS
loader's startup for something whose purpose is to exit immediately. Decide
deliberately; either answer is defensible if the reason is written down.

**11 are the real violation — logic written in JS:**

- `personal-vibe-check/`: `plugin.mjs`, `rules/restrict-component-classes.mjs`,
  `rules/test/restrict-component-classes.test.mjs`, `bin/vibe-check.mjs`,
  `bin/vibe-init.mjs`, `prettier.config.mjs`
- `agent-doctest/src/`: `doctest-hooks.mjs`, `resolve-rules.mjs`
- `canvas-loop/`: `src/eslint/index.mjs`, `test/tea-lint.test.mjs`
- `callback-box/scripts/build-cli.mjs`

## The one that needs testing, not assertion

`personal-vibe-check` is **consumed as a package**: its `exports` map points at
`./plugin.mjs` and `./eslint.config.mjs`, and its `bin` entries
(`vibe-check`, `vibe-init`) are `.mjs` executables every other package runs.

A config loaded through jiti that imports a TS plugin plausibly resolves the
same way — but plausible is not tested, and the `bin/` scripts are a different
case, invoked by node directly rather than through ESLint. Prove each path
rather than converting and hoping. Note this package also carries
[no self-lint](2026-07-29-personal-vibe-check-no-self-lint.md), so it is already
the softest spot in the tree — and part of why its config could not be linted is
that it default-exports a factory, which a `.ts` version does not change.

## Order that de-risks it

Configs first (provable, isolated, immediately valuable), then the leaf logic
files, then `personal-vibe-check` last since everything else depends on it. Each
package's own `pnpm lint` / `pnpm typecheck` is the gate, and the whole point is
that these files start being type-checked — a conversion that ends with them
excluded from `tsconfig` has achieved nothing.
