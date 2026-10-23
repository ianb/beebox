---
title: "About 30 sites check \"is this path inside that directory\" inline, with three different rules"
workstream: unattached
area: beebox
labels: [code-quality]
filed-by: agent
discovered-by: agent
discovered-in: worktree-dup-sweep-backend — backend pass of the functional-duplication sweep
---

`beebox/src/lib/box-containment.ts` has `containWithinBox` (box-relative path
or null) and, after the duplication sweep, `isWithin` (a boolean). About 30
other sites write the check inline:

- `resolved !== root && !resolved.startsWith(root + sep)`: for example
  `beebox/src/core/capture/staging-store/core.ts:64`,
  `beebox/src/core/bulk-upload/prepare.ts:60`,
  `beebox/src/lib/box-namespace-resolve.ts:118,169,284`,
  `beebox/src/webapp/routes/views.ts:32`, `beebox/src/webapp/routes/figure.ts:125`,
  `beebox/src/webapp/routes/chat/uploads.ts:121`,
  `beebox/src/core/box/file-watcher.ts:174`.
- `path.relative` and then `rel.startsWith("..")`: this also rejects a child
  whose name starts with two dots, such as `..notes`. For example
  `beebox/src/core/collection/card-scope.ts:73`, `beebox/src/core/external/ref.ts:65`,
  `beebox/src/core/validation-ignore.ts:65`, `beebox/src/cli/lib/cli-target-path.ts:90`,
  `bin/lib/comments-address.ts:55`.
- `beebox/src/lib/paths/core.ts:148` `toRelativePath` is `containWithinBox`
  with OS separators.

The sites differ in whether the root itself counts as inside, whether they
return a path or a boolean, and whether they throw. Moving each site to the
shared helpers is mechanical, but the root-counts-as-inside choice must be
kept per site, and the `startsWith("..")` sites change behavior for a
`..name` child (a fix, but a visible one for `validation-ignore` and
`comments-address`).
