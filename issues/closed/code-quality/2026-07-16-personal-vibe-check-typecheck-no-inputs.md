---
title: personal-vibe-check `typecheck` fails — tsconfig includes src/** but package has no src/
workstream: unknown
resolution: implemented
---

Resolved 2026-07-19 by taking the issue's **second** option (drop the script),
after establishing the first was infeasible. The package has **zero** TypeScript
files — it's entirely `.mjs` — so there are no "real TypeScript sources" to point
`include` at. Making it genuinely typecheck would mean `allowJs` + `checkJs`,
which under the base config's `strict`/`noImplicitAny` demands JSDoc annotations
across every rule implementation: a real typing project, not a config fix.

So the local `tsconfig.json` and the `typecheck` script are gone (the published
`tsconfig.base.json` stays — it's the artifact consumers extend, and `files:`
never shipped the local one). `pnpm -r typecheck` now passes across the monorepo.

Two adjacent findings, both left open:

- `lint` and `lint:circular` point at the same nonexistent `src/`. Pointing them
  at real paths doesn't help: `eslint.config.mjs` does `export default vibeCheck`
  — a **function**, not a flat config — so any working `eslint` invocation here
  dies with `TypeError: Unexpected function`. Self-linting needs a separate
  config that *calls* `vibeCheck()`. Left as-is rather than swapping a silent
  failure for a loud one. Note `CLAUDE.md` claims "the repo lints itself", which
  is currently false.
- `format`/`format:check` were fixed and now pass, scoped to `**/*.{mjs,json}` —
  an unscoped `prettier --write .` reformats the prose docs (it rewrote emphasis
  markers in `CLAUDE.md`), which isn't wanted.

Also surfaced: `callback-box/pub-worker` had no `node_modules`, failing the
recursive typecheck on `@cloudflare/workers-types`. Fixed by `pnpm install`
(lockfile unchanged) — latent since publish-pages landed.

`pnpm -r typecheck` fails in `personal-vibe-check/`:

```
error TS18003: No inputs were found in config file '.../personal-vibe-check/tsconfig.json'.
Specified 'include' paths were '["src/**/*"]' and 'exclude' paths were '[]'.
```

The package's files live in `bin/`, `rules/`, `hooks/`, plus root `.mjs` configs —
there is no `src/`. Either the tsconfig `include` should point at the real
TypeScript sources (if any), or the package's `typecheck` script should be
removed/no-op'd so recursive typecheck runs don't fail on it.

Found 2026-07-16 while verifying the Node 22 → 24 upgrade; unrelated to Node
version (fails identically regardless).
