---
title: "Ref rewriting writes an unescaped space into a markdown link when the new path has one"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: card-self-refs — test-box run of the filename-attach-scope migration
---

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
