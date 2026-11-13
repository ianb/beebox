---
title: "personal-vibe-check format:check fails on 22 files because its Prettier config defaults to 80 columns"
workstream: unattached
area: personal-vibe-check
filed-by: agent
discovered-by: agent
discovered-in: "worktree-web-guidance-scan — ui-primitives-dedup plan, Track 11"
---

`pnpm format:check` in `personal-vibe-check/` reports 22 files that fail. The
package's own `prettier.config.ts` sets `printWidth: 100`, but Prettier does not
load a `.ts` config file here (no `prettier` key in `package.json`, and Prettier
3.5 reads TypeScript configs only when Node can run them), so the run uses the
80-column default. The code is written to 100 to 120 columns.

Check which config Prettier actually reads (`prettier --find-config-path
rules/restricted-classes.ts`). Two fixes exist: make Prettier load the config
(for example a `prettier` key or a `.prettierrc` that points at it), or reformat
the 22 files to 80 columns. The first matches the existing code. The same file
is exported to consumers as `@ianbicking/personal-vibe-check/prettier`, so
confirm that consumers load it.
