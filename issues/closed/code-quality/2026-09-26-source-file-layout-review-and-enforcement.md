---
title: "Review the source file layout, propose a layout with rules, enforce it with a check, and move the tree"
workstream: file-layout
resolution: implemented
needs: [design]
area: beebox
labels: [file-layout]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder discussion, 2026-09-26
---

Closed by commit `ae4e9c48b` (worktree-file-layout), landed 2026-09-28. All
four requested steps shipped: `beebox/docs/implemented-plans/file-layout.md`
(rules and principles), `beebox/src/dev/layout/check/` (the enforcement
check, wired into `.husky/pre-commit`), and the move window that brought the
tree to zero `pnpm layout-check` findings. One divergence from the proposal:
data-file placement rules were explicitly left out of the move (the plan
records that the boxholder is reviewing that in another workstream); see
`issues/docs-and-chores/2026-09-27-codebase-ontology-files.md` for the
downstream dependent.

Many source directories are large and flat. Nothing stops them from growing.
Agents add files next to their neighbours and do not create subdirectories.
The developer wants a file layout that has written rules and a check that
keeps it in shape.

## Scope and sequence

The developer asked for all four steps, in this order:

1. Review the current file layout.
2. Propose a new layout and the rules behind it.
3. Design a lint rule or check that keeps the layout in shape.
4. Implement all of it, including the moves.

The move is disruptive. Every moved file changes imports, doctest paths,
doc links, and path references in skills and instructions. Do the
implementation step only when no other workstream is active. Get the
developer's go-ahead for that window before any moves start. Steps 1 to 3
can happen at any time.

## Measurements (2026-09-26)

Counts include `.ts`, `.tsx`, and `.md` files in each directory, without
subdirectories.

In `beebox/src` and `beebox/test`, 41 directories have more than 20 files,
and 14 directories have more than 60. The largest:

| Directory | Files |
|---|---|
| `beebox/test/core` | 144 |
| `beebox/src/frontend/src/components/chat` | 116 |
| `beebox/test/webapp` | 110 |
| `beebox/src/core` | 107 |
| `bin/` | 104 |
| `beebox/src/cli/commands` | 96 |
| `beebox/src/schemas` | 84 |
| `beebox/src/connectors` | 82 |
| `beebox/src/webapp/trpc/routers` | 76 |

## Observations from a first pass

Treat these as inputs to the review, not as conclusions.

### Shared filename prefixes

A quick script grouped the files in each directory by the first word of the
file name. It found 145 groups of 4 or more files in 68 directories. The
groups fall into four kinds:

- **A subsystem is flattened into one directory.** Examples:
  `connectors/` has `drive-*` (25), `google-*` (21), `gmail-*` (13), and
  `telegram-*` (7). `webapp/trpc/routers/` has `health-*` (20).
  `frontend/src/components/chat/` has `InteractiveChat*` (21).
  `src/lib/` has `box-*` (15). `bin/` has `test-*` (20) and `smoke-*` (11).
- **A subdirectory with the same name already exists.** `test/core/` has 27
  `chat*` files next to `test/core/chat/`. `test/webapp/` has 36 `trpc*`
  files next to `test/webapp/trpc/`.
- **File names repeat the directory name.** Examples: `router/router-*` (24),
  `test/scripts/migrate/migrate-*` (20), `workspace/workspace-*` (10),
  `hub/hub-*`, `history/history-*`, `todo/todo-*`, `procedure/procedure-*`.
  `beebox/code-style.md` already says a file drops the redundant prefix when
  it moves into a subdirectory. Nothing enforces this.
- **A naming convention, not a group.** `frontend/src/hooks/use*` (30) is
  the React hook convention.

The developer doubts that a filename-prefix heuristic is the right basis for
a rule. Let the layout review decide what the rule measures. Do not start
from the prefix script.

### `schemas/` is not one schema per file

The developer's condition for a flat `schemas/`: every file is exactly one
schema, and nothing else is in the directory. Today it fails that condition.
Of 84 files, 20 are not imported by `schemas/registry.ts` or
`schemas/index.ts`. They include compilers and parsers (`guide-compile`,
`guide-parse`, `personality-compile`), a templates subsystem
(`templates-builtins`, `templates-courseware`, `templates-describe`,
`templates-question`, `templates-registry`), and field helpers
(`personality-fields`, `scheduled-script-fields`, `named-entity-fields`).
Some registry-imported files are infrastructure, not schemas (`registry`,
`schema-load-status`, `templates`).

`schemas/index.ts` is a barrel. `beebox/code-style.md` bans barrels (a
developer decision on 2026-07-12).

### Large flat directories can be valid

`cli/commands/` has one file per verb. A flat directory can be correct when
each file is one member of a closed kind, like `schemas/` under the
developer's condition. The rules must state when a flat directory is valid.
A file count alone cannot state that.

## Status (2026-09-26)

Steps 1 and 2 are written up in
[the file-layout plan](../../../beebox/docs/implemented-plans/file-layout.md): five
principles, ten rules, and for each rule what a check can verify. Decisions
recorded there that supersede the observations above:

- The rules measure the import graph and registry membership, not filename
  prefixes. Prefix clusters remain evidence of where a subsystem was
  flattened.
- A flat "set" directory is valid only when a declared registry imports
  every child and members do not import each other's values. `schemas/`,
  `cli/commands/`, and `trpc/routers/` all fail today.
- Two side-effect registries exist (`connectors/index.ts`,
  `renderers/index.ts`) and become explicit lists.
- Every set is declared by its registry through one `defineRegistry`
  helper; the check finds sets from those calls and needs no config,
  allowlist, or ignore list.
- No module is named `index`; re-export modules exist only as public
  surfaces in `src/exports/`, whose registry is the `package.json` `exports`
  map.
- The minimum-two-children rule was dropped (boxholder, 2026-09-26).
- Each package has one source root; tests mirror it directory-for-directory
  and file-for-file, with containment, naming, and structure checks.

Open questions for the boxholder are listed in the plan. Steps 3 and 4 each
get their own plan.

## Status (2026-09-27): steps 3 and 4 done on `worktree-file-layout`

- `pnpm layout-check` (`beebox/src/dev/layout/`) reports zero findings in
  every package root, and `.husky/pre-commit` runs it with no report mode and
  no ignore list.
- The tree was moved with `pnpm layout-move`, which rewrites imports and path
  mentions. Registries are explicit `defineRegistry` lists in
  `beebox/src/shared/registry.ts`, and side-effect registration is gone.
  `shared/` is now the lowest layer (boxholder decision, 2026-09-27).
- Plans: `beebox/docs/plans/file-layout.md` and its check and moves
  subplans. Data-file placement rules are reviewed in another workstream.
- Before the branch merges, other branches with unmerged work will conflict
  with the moves. The merge moment is the boxholder's call.

## Constraints for the check

- ESLint checks one file at a time and cannot see a file's siblings. A layout
  check is probably a repo script under `beebox/src/dev/`, next to
  `doc-check`, and runs from the pre-commit hook.
- The check must not be weakened to pass. If a rule has false positives, fix
  the rule's definition.
- The layout rules become the current owner in `beebox/docs/module-map.md`,
  or in a page that it links to.

## Related

- [Structured module docs and code search](../../features/2026-08-12-structured-module-docs-and-code-search.md)
  may use the same module boundaries.
- `beebox/docs/module-map.md` states the current directory boundaries for
  shared code.
