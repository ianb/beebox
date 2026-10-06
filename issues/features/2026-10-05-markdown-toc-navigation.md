---
title: "Markdown cards: table-of-contents navigation for long documents"
workstream: unattached
area: beebox
labels: [markdown]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder request
priority: normal
---

A long Markdown card has no way to see its structure or jump to a section.
The reader scrolls.

## Wanted

- A table of contents built from the document's headings, with each entry
  linking to its section.
- Placement idea from the boxholder: a floating panel at the top right, or
  similar. It must not overlap the card's Properties
  (`beebox/src/frontend/src/components/themes/ThemedFileCard/CardProperties.tsx`).

## What exists

- Headings already get stable, unique ids from the shared Markdoc heading node
  (`makeHeadingNode`, `beebox/src/shared/markdoc-config/tags/core.ts`), so the
  anchor targets exist. The TOC needs the heading list, which the renderer
  (`beebox/src/frontend/src/components/Markdown/body.tsx`) can collect from the
  same transform.

## Open questions

- When to show it: only above some number of headings or some length, so a
  short note does not get a TOC.
- Phone layout: a floating panel at the top right does not fit a narrow
  screen. A collapsed button that opens the list is one option.
- Whether it highlights the current section while scrolling.
- Whether the published-site renderer (`beebox/src/publish/prepare/markdown-page.ts`)
  should emit the same TOC.
