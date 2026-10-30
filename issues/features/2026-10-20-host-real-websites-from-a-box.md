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
  [site authored in a box](../closed/exploration/2026-08-19-site-authored-in-a-box.md),
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

## Direction, 2026-10-20

The developer expects to start with static and built sites. That brings
deployment with it, probably a separate git repository per site. The agent can
work with a repository and a deploy step without help. The open part is how
the box represents the site, so it is not a hidden folder only the agent
knows about.

Questions this raises:

- **Where the repository lives.** A nested repository inside the box (the box
  is itself a git repository with annex), a submodule, or a checkout outside
  the box that a card points to. Each choice changes what box history, backup
  and search see.
- **What the box shows.** Probably one card per site: its repository, its
  domain, where it deploys, the last deploy and whether it succeeded, and
  whether there are changes that are not deployed. The `publication` card
  already holds settings for box-built sites; decide whether this extends it or
  is a sibling type.
- **Who deploys.** The current publisher builds inside the box and uploads to
  the box's Cloudflare connection. A site with its own repository may already
  deploy somewhere else (another host, or GitHub Actions). The box may only
  start and report the deploy, not own it.

## Direction, 2026-10-20 (2)

The developer added three requirements for the site's representation:

- **Deploy status is shown in the box**, not only started from it: what is
  live, the last deploy and its result.
- **Worktrees, not branches.** Work in progress on a site appears as
  worktrees (one per change, each previewable), the same way this repository
  uses managed worktrees instead of bare branches. The box shows which
  worktrees exist and which one is live.
- **View and comment on the live site inside the box.** The site card opens the
  deployed site (and a worktree's preview) in the box, and the box's commenting
  works on those pages. This is the first concrete case of commentary on an
  external URL from the Commentary tension above.
