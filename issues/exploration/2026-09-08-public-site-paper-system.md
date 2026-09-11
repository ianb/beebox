---
title: "Give beebox.run a paper-based visual system"
workstream: public-site
area: docs
needs: [design]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-paper-cards — while reviewing the card and system theme work
---

When someone visits beebox.run, they should encounter the same sense of paper,
layers, stocks, and authored surfaces that makes the application recognizable.
They should be able to understand the site through stable, addressable pages,
without the public site needing to become a live application surface.

The public site should use a related visual component system: paper-like cards,
tabs, folds, callouts, and themeable system chrome. It should support more than
one stock or theme so the site can use a plain web-page treatment where that is
clearer. The visual relationship should be deliberate even if the site has its
own static implementation and does not share application state or rendering
code with the app.

The site is likely static and precalculated, with URL-addressable pages for its
sections and generated artifacts. The design must preserve the existing public
site direction: spare, personal, and made by a person rather than a generic
polished landing page. See [Public site — un-polished on purpose, cool some
other way](../features/2026-07-20-public-site.md) for the wider content and
publishing decisions.

## Design questions

- Which paper components belong in a small public-site design system?
- Which card and system themes should be shared as visual references, and
  which should be redesigned for the site's content and navigation?
- How should URL-addressable pages, generated source material, and nonlinear
  presentation work with tabs, stacks, and folds?
- Can the site use the same design tokens or theme catalog without coupling its
  build to the application frontend?
- Which parts need responsive equivalents for a narrow, single-column view?

## Checkpoint (2026-09-10)

Commit `3777331df` implements the visual/navigation baseline in the real static
site: local app CSS snapshots, independently selected card/system themes,
authored Menu, recursive attached document addresses, desktop parent/aside
and mobile single-card layouts, plus optional history/scroll restoration.
The authoring guide at `site/card-authoring.md` records the current contract.
The four-card navigation prototype remains as design evidence.

This issue stays open. Public prefix naming, tabs, and contextual deep-link
policy remain design questions. The broader site's content is still marked
editorial drafts. Unlisted is indexing behavior, not a privacy boundary.

## Research (incomplete)
