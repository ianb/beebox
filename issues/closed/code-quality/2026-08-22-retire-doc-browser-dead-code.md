---
title: "The /dev/docs browser now redirects, leaving ~540 lines of unreachable rendering code"
workstream: finish-migrations
area: monorepo
filed-by: agent
discovered-in: worktree-dev-comments — retiring the doc browser into the general browser
labels: [cleanup, router]
priority: important
resolution: implemented
---

Closed by this commit (worktree-finish-migrations): deleted
`router-doc-browser.ts` and `router-doc-browser-ui.ts` (415 lines) plus
`findClosedIssueLinkHrefs`/`appendClosedIssuePills` and their test case in
`router-markdown.ts`/`router-docs.test.ts` — all confirmed unreachable, the
301 in `serveDev` being the successor. Reworded stale comments elsewhere that
pointed at the removed files (`QuickOpen.tsx`, `CodeBlock.tsx`, `recency.ts`,
`file-index.ts`, `router-docs.ts`'s own header).

The closed-issue "closed" chip (`appendClosedIssuePills`) was **not** ported to
the general browser — the boxholder decided to let that feature go rather than
rebuild it there. `workstreams-app/typecheck`, the router/backend/frontend
eslint configs, and the router test suite (`router-docs.test.ts`,
`router-auth-classify.test.ts`) all pass after the deletion.

---

`/<worktree>/dev/docs/…` now 301s to `/workstreams/browse?file=…&workstream=…`
([general-browser](../../../beebox/docs/plans/general-browser.md), Track 5),
so everything that rendered that surface is unreachable:

- `serveDocBrowser`, `renderDocSidebar`, `renderDocQuickOpen`, `DOC_BROWSER_CSS`
- `listRepoMarkdown`, `mdLastModified`
- `appendClosedIssuePills` and its helper, plus their case in
  `bin/router-docs.test.ts`

Roughly 540 lines. All of it verified to have no callers outside
`bin/router-docs.ts` itself.

## Why it was not deleted in the same change

A first attempt cut too much: the doc-browser section sits between shared
helpers (`renderDevShell`, `devBreadcrumbs`, `formatSize`, `autolinkUrls`,
`highlightCodeBlocks`), which the artifact server and the manifest still use, so
a range delete took those with it. The deletion wants to be done function by
function with the tests run after — worth doing deliberately rather than at the
end of a long session.

## One feature is NOT yet ported, and should be

`appendClosedIssuePills` marked links to closed issues in rendered docs, so a
reference to a resolved issue reads as resolved. The general browser does not do
this yet. It has the data — the app already lists issues with their closed
status — so this is a small addition to the markdown renderer, and it should
land before the dead code goes, otherwise the retirement quietly loses a
feature.

## Also worth checking

`bin/router.ts:70-73` rewrites `/<worktree>/dev/issues[/…]` to
`/workstreams/issues…`, and is already slated for removal in
[remove-legacy-issue-deep-link-routes](2026-08-22-remove-legacy-issue-deep-link-routes.md).
Both touch the same file and could go together.
