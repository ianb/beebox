---
title: "Frontmatter is split, parsed, and written by many local implementations that disagree on edge cases"
workstream: unattached
area: beebox
labels: [code-quality, cards]
filed-by: agent
discovered-by: agent
discovered-in: worktree-dup-sweep-backend — backend pass of the functional-duplication sweep
---

`beebox/src/cards/frontmatter.ts` has the shared helpers:
`splitCardContent`, `parseFrontmatterObject`, and `renderFrontmatterBlock`.
Many modules do the same jobs locally, and the local copies differ in ways a
person can see.

## Fence split

About 18 local fence finders exist. Examples:
`beebox/src/dev/doc-check/frontmatter.ts:30`, `beebox/src/core/docs-gen/shared.ts:35`,
`bin/lib/coding-feedback.ts:101`, `bin/skill-lint.ts:61`, `bin/confirm-tested.ts:52`,
`bin/assign-issue-workstream.ts:32`,
`beebox/src/dev/doc-graph-data/document-lifecycle.ts:52`,
`workstreams-app/src/server/main/issue-domain.ts:65,205`,
`workstreams-app/src/server/main/issue-search-model.ts:94`.

They disagree on CRLF, a BOM, trailing space on the fence line, and whether
`\n---x` closes the block. An issue or plan file can therefore parse
differently in `bin/issues`, doc-check, and the workstreams app.

## Parse to a record

About 12 sites do split, YAML parse, and `isRecord` by hand, for example
`beebox/src/core/template-merge.ts:12`, `beebox/src/core/extfile-sync.ts:46`,
`beebox/src/connectors/google-drive/mounts/schedule-hint.ts:51`. They differ on
two points: whether bad YAML throws or gives null, and whether an empty block
gives `{}` or null. The comment in `beebox/src/core/frontmatter-field.ts` calls
its helper "the single frontmatter-or-null implementation"; that is not true.

## Write

`renderFrontmatterBlock` writes YAML with `lineWidth: 0`, so long values stay
on one line. About 25 schema generators in `beebox/src/schemas/` and
`beebox/src/plugins/recipe/template.ts` build `---\n${stringify(fields)}---\n`
without that option, so a long value folds onto several lines. Six sites edit
one key through a YAML `Document` and re-fence by hand
(`beebox/src/core/place-mark.ts:68`, `core/triage/todo.ts:94`,
`core/todo/set-status.ts:104`, `webapp/trpc/routers/card.ts:224`,
`webapp/trpc/routers/presentation.ts:99`, `webapp/trpc/routers/browser-task.ts:58`);
three fold long lines and three do not.

## Title from markdown

Five title extractors exist with different rules: H1 only or any level,
fenced code ignored or not, and different fallbacks
(`beebox/src/dev/doc-graph-data/data.ts:146`,
`beebox/src/core/search/extract/core.ts:173`,
`beebox/src/publish/prepare/core/markdown-page.ts:34`,
`workstreams-app/src/server/main/issue-index-documents.ts:108`,
`workstreams-app/src/server/main/issue-domain.ts:154`).

## Why this was not merged in the sweep

Each merge changes output for some caller: the CRLF and fence rules change
which files parse, `lineWidth: 0` changes the bytes of newly created cards,
and the throw-or-null choice changes error handling. The workstreams app's
issue reader is a deliberate strings-only subset. Decide the fence rule and
the write rule once, then move callers per decision.
