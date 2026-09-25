---
title: "Ref rewriting writes an unescaped space into a markdown link when the new path has one"
workstream: card-self-refs
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: card-self-refs — test-box run of the filename-attach-scope migration
resolution: implemented
---

Resolved by bc11677e2 and 3d7907b48: rewrites now write CommonMark's
`<path with spaces>` angle-bracket destination when a target has a space or
parenthesis (`beebox/src/core/body-refs.ts` `linkTarget`/
`formatLinkDestination`), and every reader/rewriter of inline links
(`inlineLinkPattern`, BBX002's `markdown-lint-rules.ts`, `canonicalize-refs.ts`,
`link-repair.ts`) reads that form. The frontend Markdoc parser decodes an
in-box link's path (not its query/fragment) so a spaced path also renders
(92399fcd8).

`rewriteReferrerRefs` (`beebox/src/core/rewrite-card-refs.ts`) writes the new
path into an inline markdown link as-is. When the new path contains a space,
the link breaks: `![b](/_content/cap/photo-004.jpg)` became
`![b](/_content/cap/photo-004-Beach walk.attach/photo-004.jpg)`. CommonMark
ends a link destination at the first space, and the body scanner
(`inlineLinkPattern`, `beebox/src/core/body-refs.ts:73`, `[^\s()]+`) no
longer sees the link, so `bbx validate` stays silent too.

Any `bbx mv` to a destination whose path has a space does the same. The
`filename-attach-scope` migration hits it when a card name has a space and
another card links to its flat media file inline. Frontmatter refs are
unaffected; YAML holds the space.

Direction to decide: write `<path with space>` (CommonMark angle-bracket
destination) and teach the scanner that form, or refuse such a rewrite and
report it.
