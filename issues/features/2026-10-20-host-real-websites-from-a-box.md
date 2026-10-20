---
title: "Host a person's real websites and blogs from inside a box, each on its own domain"
workstream: unattached
needs: [design]
area: beebox
labels: [publishing]
filed-by: agent
discovered-by: Ian
discovered-in: main-checkout conversation, 2026-10-20
priority: normal
---

The boxholder wants to run existing personal websites and blogs from inside a
box: the box is where the site's content lives, where the agent works on it,
and where it is published from. Some of these sites belong to other people
the boxholder helps, and each has its own domain.

The developer's framing: mostly this may be giving the agent a space to work.
But the site should not be a completely separate place: the box's own
commenting and review should apply to it.

## What exists

[Publishing](../../beebox/docs/box/publishing.md) serves a `publication`
card's attach folder as a static site, from Markdown (`static/`) or a built
project (`project/`). New publications go on one shared hostname per box, at
`https://<box-host>/<slug>/`. Per-publication custom hostnames survive only as
legacy routes.

## Tensions

- **Own domain at the root.** A real site is `example.com/`, not
  `<box-host>/<slug>/`. The shared-hostname design (one Worker, one bucket
  per box) chose paths on one host. Several domains in one box needs a
  domain per publication again, or a host-to-publication map in the shared
  Worker.
- **Blog shape.** A blog needs dated posts, an index, feeds (RSS/Atom),
  permalinks that never change, and drafts. These could be a box-local page
  or post schema plus a site project, or a stock blog template. Compare
  [site authored in a box](../exploration/2026-08-19-site-authored-in-a-box.md),
  which proposes the same thing for beebox.run.
- **Importing an existing site.** Old URLs must keep working (redirects), and
  existing posts come in from another system's export.
- **Several owners.** A site for someone else lives in the boxholder's box,
  but that person may want to edit or comment. Compare box members and
  the `accounts` publication tier.
- **Commentary.** The boxholder wants the box's comments and review on the
  site's pages. More general: normalize *external* commentary, so a person can
  comment on any URL or page and the comment lives in the box. Related:
  [PDF at a URL into the commentary path](2026-08-09-pdf-url-into-the-commentary-path.md),
  [mobile long-press to comment](2026-10-09-mobile-long-press-paragraph-to-comment.md).
  Reader comments on the published site are a separate question.

## First step when picked up

Move one real site into a test box (the real ones are tracked privately) and
list what blocks it: domain, blog structure, redirects, the build. Decide the
domain model before building blog features.
