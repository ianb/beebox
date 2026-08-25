---
title: "The repo's `.mjs` files should be TypeScript — ESLint 9 + jiti already loads a TS config, so most of them have no reason to exist"
workstream: mjs-to-typescript
area: monorepo
labels: [typescript, lint, tooling]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder objecting to the .mjs files
resolution: implemented
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
[no self-lint](../../code-quality/2026-07-29-personal-vibe-check-no-self-lint.md), so it is already
the softest spot in the tree — and part of why its config could not be linted is
that it default-exports a factory, which a `.ts` version does not change.

## Evidence the cost is real, not stylistic

`personal-vibe-check/eslint.config.mjs` (807 lines) hid two defects that the
knip-exports workstream tripped over on 2026-08-24: the `exts` gate silently
excluded every `.tsx` file from the entire reviewed ruleset (71 rules,
including `no-unused-vars` and the `as`-cast ban), and two rule keys sat in a
`disabledRules` object that never reached the files they named. Neither is a
type error, so TypeScript would not have caught them outright — but the flat
config's own types make the shape of what is being assembled visible, and that
visibility is precisely what was missing. It is the largest of these files and
the one with the most leverage over every other package.

## Order that de-risks it

Configs first (provable, isolated, immediately valuable), then the leaf logic
files, then `personal-vibe-check` last since everything else depends on it. Each
package's own `pnpm lint` / `pnpm typecheck` is the gate, and the whole point is
that these files start being type-checked — a conversion that ends with them
excluded from `tsconfig` has achieved nothing.

## Outcome — 2026-08-25

Done. 27 of the 30 `.mjs` files are gone; the three that remain are the three
this issue said should remain (`callback-box/dist/cli.mjs`,
`scan-uploader/dist/scan-uploader.mjs`, `callback-clerk/.wxt/eslint-auto-imports.mjs`
— all generated and gitignored). The two judgment calls:

- **`callback-box/tsx-preload.mjs` stays `.mjs`**, as predicted, and now carries a
  comment saying exactly why so the next sweep doesn't rediscover it.
- **`bin/lib/detach.mjs` was converted.** The argument for leaving it was paying a
  TS loader's startup on a teardown path. That argument assumed tsx; Node 24
  strips types natively with no loader. Measured 2026-08-25 over five runs each:
  288ms as `.mjs`, 209ms as `.ts` — both node's own boot, the difference is noise.
  The reason is written into the file.

### What the order actually had to be

**`personal-vibe-check` had to go FIRST, not last.** Converting a package's
`eslint.config.mjs` only counts if the file enters that package's tsconfig — and
the moment it does, it fails with `TS7016: Could not find a declaration file for
module '@ianbicking/personal-vibe-check/eslint'`. Every other config's conversion
was therefore blocked on the preset shipping types. Only `site/` would have
type-checked at all without it (its tsconfig globs `*.ts`); everywhere else a
rename alone would have been silent churn — exactly the outcome this issue ruled
out.

### The `personal-vibe-check` paths, all probed rather than assumed

Every one works: a `.ts` consumer config through jiti; a still-`.mjs` consumer
config through node (pnpm's symlink realpath lands outside `node_modules`);
`bin/vibe-check.ts` under the `.bin` shim; `prettier.config.ts` under Prettier
3.8.3; `node --test` over the `.ts` rule tests. The publish question turned out to
be moot — `@ianbicking/personal-vibe-check` has never existed on npm, and the
boxholder confirmed it is workspace-only. (Node DOES refuse to strip types under
`node_modules`, verified; that only bites if the package is ever really published,
which is now written down in its CLAUDE.md.)

The preset's types reach consumers through a hand-written `types.d.ts` named by
the `exports` map's `types` condition, not through `preset.ts` itself. TypeScript
will happily resolve a `.ts` source through an exports map, but it then type-checks
that source inside *each* consumer's program under *that* consumer's tsconfig —
ten packages that disagree about `exactOptionalPropertyTypes`, module resolution,
and `lib`, several of whose plugins ship no types. `skipLibCheck` covers a `.d.ts`
and nothing else. `preset.ts` binds its implementation to that declaration
(`typeof DeclaredVibeCheck`), so the two cannot drift.

### Side effects worth knowing

- **The preset moved out of `eslint.config.mjs` into `preset.ts`**, which removed
  the structural blocker in
  [personal-vibe-check has no working self-lint](../../code-quality/2026-07-29-personal-vibe-check-no-self-lint.md):
  ESLint was picking the preset up as that package's own config and crashing on a
  factory default export. That package now has a real `eslint.config.ts`, a
  `tsconfig.json`, and a `typecheck` script. It still has no `lint` script — six
  pre-existing violations remain (file/function length, import naming), and that
  is the rest of that issue's work.
- **`vibeCheck`'s options are now type-checked at every call site.** A typo'd
  option used to be silently ignored; it is now `TS2561`.
- Self-linting the preset immediately found a latent bug: a prose comment
  beginning with `eslint-disable-next-line` that ESLint had been parsing as a real
  directive naming a nonexistent rule.
- `callback-box` and `agent-doctest` each grew a `tsconfig.tooling.json`, because
  their main tsconfig sets `rootDir: "src"` and a package-root file trips TS6059.
  That exposed a wider hole, filed separately as
  [callback-box lints `scripts/` and `test/` but never type-checks them](../../code-quality/2026-08-25-callback-box-scripts-and-test-untypechecked.md).
