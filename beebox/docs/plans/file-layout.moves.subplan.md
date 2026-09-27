---
title: "Layout moves: bring the tree to zero layout-check findings"
status: active
workstream: file-layout
issues:
  - ../../../issues/code-quality/2026-09-26-source-file-layout-review-and-enforcement.md
---
# Layout moves: bring the tree to zero layout-check findings

Step 4 of [the file-layout plan](file-layout.md): move and rename files,
convert registries to `defineRegistry`, and fix the code that breaks a rule
in place, until `pnpm layout-check` reports nothing in every package root.
Then pre-commit runs the check.

**Issues addressed:** the anchor issue (step 4 of 4).

## Smallest fix and budget

There is no smaller fix: the rules say the tree has no exceptions. The
starting report (2026-09-27, after step 3) is the work list:

| Root | Findings |
|---|---|
| `beebox` | 1,201 |
| `beebox/src/frontend` | 131 |
| other package roots | about 50 |

Set findings are absent from that report because no directory declares a
registry yet; converting the registries adds them. **BIG CHANGE:** the moves
change thousands of import lines. Most lines are mechanical rewrites the move
tool produces; authored changes are the registry conversions, `index.ts`
splits, and side-effect registration removals, estimated at 2,000 to 4,000
lines. The boxholder opened the move window on 2026-09-27.

## Stated preferences this plan trades against

- The parent plan's rules; no exceptions. A finding the planners cannot
  resolve is a rule defect and goes back to the parent plan, never to an
  allowlist.
- Memory: parallel subagents in one worktree collide on whole-tree
  typecheck. Planning is parallel and read-only; applying is serial.
- Memory: merge main, never rebase; other branches with unmerged work will
  conflict with the moves. The merge to main is a separate boxholder
  decision.

## What already exists

- `pnpm layout-check` (step 3): the finding list and the definition of done.
- `pnpm --dir beebox doc-check --fix` repairs moved-doc links when the
  basename is unique repo-wide.
- The scanner's resolved import edges (`src/dev/layout/scan/package.ts`)
  give every specifier that points at a moved file, which is what the move
  tool rewrites.

## Prior art (external)

ts-morph and TypeScript's own "move to file" refactor update imports on a
move; neither is installed, and neither rewrites doctest fences. The move
tool reuses the check's scanner instead. No other decision depends on an
external premise.

## Ontology

- **Move list**: `scratch/moves/<area>.json`, written by a planner:
  `moves` (file from/to), `registries` (sets to convert), `code_changes`
  (in-place fixes), `residual` (findings the planner could not resolve and
  why). Scratch, not tracked: it is consumed by the apply step.
- **Area**: a slice of source and its test mirror planned by one agent.
- **Move tool**: `src/dev/layout/move/`; applies a move list.

## Tracks / scope

1. Move tool: `git mv` each pair, then rewrite every import specifier in
   the repo that resolved to a moved file, and every relative specifier
   inside a moved file, keeping the `.js` extension style; doctest fences
   included. Prints non-import mentions of moved paths (docs, skills,
   configs) for hand repair.
2. Planning, parallel and read-only, one agent per area: core; webapp; cli;
   connectors, services, hub, publish, field-test, cards, exports, types;
   schemas, lib, shared, dev, root-level tests, `scripts/` and
   `user-stories/` folds; the frontend package; the other package roots.
3. Apply, serial, one area per agent: registry conversions and code changes
   first, then the move list through the tool, then typecheck, lint,
   change-selected tests, and `layout-check --root` for the area.
4. Pre-commit runs `pnpm layout-check` once every root is clean; tap, eslint,
   and knip globs follow the frontend test root.

## Could this be simpler?

Hand moves without a tool: each agent would rewrite imports by grep, which
misses aliased and doctest imports and is the failure the scanner already
solves. Keep the tool.

## Subplans

None beyond this one; the move lists are its working data.

## Failure modes

- **A move list conflicts with another area's.** Planners own disjoint
  paths; a cross-area move (a helper leaving `webapp/` for `core/`) is
  listed by the source area only, and the apply step for the target area
  runs after.
- **A path mentioned outside imports** (skills, docs, eslint `ignores`,
  knip globs, `package.json` scripts, build entries) breaks silently. The
  tool prints every non-import mention of a moved path; the apply agent
  fixes each and doc-check covers doc links.
- **Unmerged branches** conflict on merge. Named to the boxholder before the
  merge to main.

## Agent-flow / user-flow edge cases

After the move, an agent adding a file gets a layout-check finding at commit
with the fix in the message; the check's messages were written for that
reader.

## NOT in scope

- Changing behaviour. Every change is a move, a rename, a registry
  conversion that keeps membership and order, or an `index.ts` split.
- `bin/` (no `src/`): its restructure is a follow-up once `bin/` has a
  package shape.

## Open design questions

- **Module-map shims.** Seven `lib/` and `shared/` modules are re-export
  shims the module map prescribes so the frontend can import
  dependency-free helpers. Rule 6 allows re-export modules only in
  `src/exports/`. The clean resolution flips the layers so `shared/` sits
  below `lib/` and holds the implementations. That changes the module map
  and waits for the boxholder.

## Knowledge audits

Box-loaded guidance names no engine paths; not applicable.

## What will hold this after it ships

`pnpm layout-check` in pre-commit, with no report mode and no ignore list.

## Implementation order

Tracks 1 and 2 in parallel; track 3 area by area; track 4 last.

## Rollout shape

All on the `worktree-file-layout` branch. Merge to main when every root is
clean and the boxholder picks the moment.
