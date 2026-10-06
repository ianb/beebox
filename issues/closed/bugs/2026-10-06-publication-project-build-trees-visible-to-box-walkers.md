---
title: "A publication project's node_modules/ and dist/ are visible to the file watcher and box-wide card and Markdown walkers"
workstream: publication-home
resolution: implemented
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-publication-home — moving publication source into the card's attach folder
---

**Closed 2026-10-06:** the file watcher no longer descends into any
`node_modules/`, and one predicate, `isPublicationBuildOutputPath`
(`beebox/src/shared/attach-path.ts`), keeps `<name>.attach/project/dist/` out
of the watcher, card and Markdown listings, box inventory, and search walk.

A publication card can keep a buildable project in `<Name>.attach/project/`.
`bbx pub prepare` creates `node_modules/` and `dist/` there. Git ignores both.
Box machinery that walks the working tree does not use the git ignore rules.

- The file watcher ignores only dot-segments and two high-churn trees
  (`beebox/src/core/box/file-watcher.ts`, `DOT_SEGMENT` and `HIGH_CHURN_DIRS`).
  It adds one watch per directory in `node_modules/` and `dist/`. The limit is
  `MAX_WATCHED_DIRS = 1024`. One project can use most of it.
- `listBoxCardFiles` and `listBoxMarkdownFiles`
  (`beebox/src/core/list-cards.ts`) skip `node_modules` but not `dist`. A build
  that writes `.md` or `.card` files into `dist/` gets them linted and
  link-checked.
- The box inventory skips `node_modules` but not `dist`.

This was also true for the retired `src/publications/<name>/project/` location.
The move did not cause it.

Resolution is not obvious. The watcher could skip `node_modules` by name. For
`dist/`, a name rule is too broad, and a rule tied to publication attach
folders adds a special case to generic walkers. One option is a shared
"git-ignored paths are not box content" filter, as the unlisted-binary walk now
uses (`beebox/src/lib/git/check-ignore.ts`).

Related: [the watcher ceiling leaves attach scopes unwatched](../../bugs/2026-09-07-box-watcher-ceiling-leaves-attach-scopes-unwatched.md).
