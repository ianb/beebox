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
