---
title: personal-vibe-check `typecheck` fails — tsconfig includes src/** but package has no src/
---

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
