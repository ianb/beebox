---
title: "docs-gen never prunes docs/generated/card-<type>.md for a removed schema"
workstream: todo-annotation
area: beebox
filed-by: agent
discovered-in: worktree-todo-annotation — retiring the todo-list card type
resolution: implemented
---

Fixed in commit `ebbe0190` (worktree `docs-gen-prune`): `writeCardDocs`
(`src/core/docs-gen/index.ts`) now `readdir`s `docs/generated/` after writing
the current set of `card-<type>.md` files and `unlink`s any `card-*.md` whose
type isn't in `allCardSchemas`, mirroring `init-rules.ts`'s existing cleanup.

`src/core/docs-gen/index.ts`'s `writeCardDocs` only *writes* a
`docs/generated/card-<type>.md` for each currently-registered schema with
`instructions` — it never deletes one for a type that used to exist but no
longer does. Compare `src/core/init-rules.ts`, which regenerates
`.claude/rules/card-<type>.md` and explicitly prunes any file in that
directory that no longer corresponds to a registered type (`readdir` +
`unlink` for orphans) — `docs/generated/` has no equivalent sweep.

Found retiring the `todo-list` schema (2026-07-29,
`issues/closed/features/2026-07-29-retire-todo-list-schema.md`): after
removing the schema and running `bbx migrate` + doc regeneration on test1,
`.claude/rules/card-todo-list.md` was correctly pruned but
`docs/generated/card-todo-list.md` was left behind as a stale file describing
a card type that no longer exists (harmless since `docs/generated/` is
gitignored and the file is never referenced by name from a live
should_read/agent-guide pointer, but confusing if an agent stumbles on it via
directory listing or search). Deleted by hand on test1 as part of that
migration's cleanup.

Fix would be a small addition to `writeCardDocs` (or a sibling prune step) in
`src/core/docs-gen/index.ts`: after writing the current set of
`card-<type>.md` files, `readdir(DOCS_DIR)` and remove any `card-*.md` whose
type isn't in `allCardSchemas`, mirroring `init-rules.ts`'s existing pattern.
