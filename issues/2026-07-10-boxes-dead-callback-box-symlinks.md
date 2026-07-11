---
area: callback-box
filed-by: agent
discovered-in: worktree-orama-semantic-search — live-testing semantic search on the estate box
---

# Box engine symlinks are absolute-path bootstraps that nothing repairs

Found 2026-07-10: 13 of 13 local boxes under `~/src/boxes/` had a dead
`node_modules/callback-box` symlink, so any box-local schema (`estate`'s
`bill`, `ai-class`'s `outline`/`progress`, `box-family`'s
`itinerary`/`stop`) silently failed to load in local CLI use — those card
types vanished from search, validation, and templates with only a
stderr `Warning:`. Prod unaffected (real installs).

**Immediate repair done 2026-07-10**: all 13 links repointed at
`~/src/callback-box/callback-box` (the main checkout); schema loading
verified clean on the schema-bearing boxes. Nothing left broken.

## Research (2026-07-10)

Cause, fully traced:

1. `scaffoldPackageRoot` (`callback-box/src/core/box/package.ts:133-138`):
   when a box lacks `node_modules/`, it symlinks
   `node_modules/callback-box` at **the running engine's own
   `PACKAGE_ROOT`** — an absolute path to whatever checkout ran the
   command — explicitly as a bootstrap: *"Track F's real install replaces
   this symlink with an actual dependency."* For these local boxes that
   real install never happened, so the bootstrap became load-bearing.
2. On 2026-07-04, 08:19–11:56, the box-packageify migration
   (`scripts/migrate/box-packageify.ts:449`, which "reuses
   scaffoldPackageRoot wholesale") ran per-box, baking in each box's
   then-current engine path: twelve boxes → `~/src/callback-mono/…`,
   and `test1` → the `cb-as-library` worktree it was migrated from.
3. That same evening (~20:56, per `~/src/callback-mono.bak`'s mtime) the
   monorepo directory was renamed `callback-mono` → `callback-box`,
   orphaning the twelve; the `cb-as-library` worktree's later deletion
   orphaned `test1`'s. Six days of silent breakage followed.

The remaining tension (why this isn't just closed):

- **The bootstrap is a trap.** An absolute symlink into a movable,
  deletable checkout, documented as temporary, with no mechanism that
  ever replaces or checks it. Candidate fixes: have `cb` fail loudly (or
  self-repair to its own `PACKAGE_ROOT`) when the box's engine link is
  dead; or finish the Track F story locally so boxes hold a real
  dependency. Self-repair-to-running-engine is attractive but changes
  which engine a box pins — needs a deliberate decision.
- **The failure was too quiet.** A box whose declared card types stop
  loading emits one stderr warning per schema and otherwise behaves
  normally. `cb validate`/`cb search` arguably should treat an
  unloadable declared schema as an error, not a warning.
- `test1`'s case shows a second path to the same breakage: a box
  migrated/scaffolded from a worktree keeps pointing there after the
  worktree dies. Any repair mechanism should normalize originals at
  `~/src/boxes/` to the main checkout, never a worktree.
