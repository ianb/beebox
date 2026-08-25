---
title: "personal-vibe-check has no working self-lint"
workstream: unknown
area: personal-vibe-check
filed-by: agent
discovered-in: finish-skill-audit worktree — adding a root `lint` script exposed it

---

The preset package that defines everyone else's lint has never linted itself.
Its `lint` script was `eslint src/` — there is no `src/`; the package's code
is `bin/*.mjs`, `rules/*.mjs`, `plugin.mjs`, `hooks/`. And pointing ESLint at
those files fails anyway: the package's `eslint.config.mjs` default-exports
the `vibeCheck` **factory function** (the preset consumers call), which ESLint
rejects as a flat config ("TypeError: Unexpected function").

Removed the broken script (2026-07-29) so the new root `pnpm lint`
(`pnpm -r lint`) doesn't die on it. The real fix is a dedicated self-lint
config — e.g. an `eslint.config.self.mjs` that either calls the factory with
JS-appropriate options or assembles a small flat config suited to plain-`.mjs`
Node code — plus renaming the preset entry so the package's own config file
doesn't shadow the self-lint one. `lint:circular` (`madge ... src/`) has the
same stale-`src/` problem.

Until then the preset's own rule implementations are the one corner of the
monorepo with zero lint coverage — exactly the irony the eslint-suppression
audit warned about.

## Update 2026-08-25 — the structural blocker is gone; only content remains

The `.mjs` → TypeScript sweep
([2026-08-25-mjs-files-should-be-typescript](../closed/code-quality/2026-08-25-mjs-files-should-be-typescript.md))
fixed the shadowing half of this by moving the preset out of `eslint.config.mjs`
into **`preset.ts`**. `eslint.config.*` is now free for the package's own config,
and `personal-vibe-check/eslint.config.ts` exists and works — `pnpm exec eslint .`
runs, and the per-edit vibe-check hook now lints this package like any other.
No `eslint.config.self.*` was needed; the factory just needed a different filename.

What is left is not a wiring problem, it is six real violations in code that has
never been linted:

- `preset.ts` is 461 code lines against `max-lines: 300`
- `vibeCheck` is 218 lines against `max-lines-per-function: 150`
- four plugin imports trip `import-x/no-rename-default`

So there is still **no `lint` script** in this package's `package.json` — adding
one would break the monorepo's recursive `pnpm lint`. Splitting `preset.ts` is
the remaining work, and it closes this issue. (`lint:circular`'s stale `src/`
path is still stale.)

Two things did improve meanwhile: the package now has a `tsconfig.json` and a
`typecheck` script, so its source is type-checked for the first time; and
self-linting immediately caught a latent bug — a prose comment beginning with
`eslint-disable-next-line` that ESLint was parsing as a real directive naming a
nonexistent rule.
