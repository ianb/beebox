---
area: callback-box
filed-by: agent
discovered-in: worktree-orama-semantic-search — live-testing semantic search on the estate box
---

# Every local box's `callback-box` symlink is dead after the repo rename

12 of 13 boxes under `~/src/boxes/` have `node_modules/callback-box`
pointing at `~/src/callback-mono/callback-box`, which no longer exists
(the monorepo now lives at `~/src/callback-box`); `test1`'s points into a
deleted worktree (`callback-worktrees/cb-as-library`). Only `estate` is
currently correct — hand-fixed 2026-07-10 during semantic-search testing.

Consequence: any box with local schemas (`src/schemas/*.ts` importing the
public `callback-box` specifier) silently fails to load them in local CLI
use — the estate box's `bill` cards were invisible to `cb search`
(`Warning: failed to load box schema bill.ts: Cannot find package
'callback-box'`), and the same would hit validation/templates for any
local type. Prod is unaffected (deployed bundle).

Not obvious:
- What owns these links? If some tooling (box setup, worktree hooks, `cb
  init`?) creates them, the rename should have a migration/repair step
  there rather than a one-off `ln -sfn` sweep; if nothing owns them, a
  repair sweep plus making `cb` fail (or warn loudly at a higher level)
  on a dead package link would prevent the silent-schema-loss mode.
- The load failure is only a stderr `Warning:` — a box whose card types
  silently vanish from search/validation arguably deserves louder
  handling.

Repair, if a sweep is the answer:
`for b in ~/src/boxes/*/; do ln -sfn ~/src/callback-box/callback-box "$b/node_modules/callback-box"; done`
(after confirming nothing intentionally points boxes at worktrees).
