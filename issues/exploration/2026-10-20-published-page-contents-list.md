---
title: "Published Markdown pages have no contents list for long documents"
workstream: unattached
area: beebox
labels: [markdown]
filed-by: agent
discovered-by: agent
discovered-in: worktree-card-reading — Markdown contents menu
---

In the app, a long Markdown card now has a Contents menu. A page published
from the same card has none. The published renderer
(`beebox/src/publish/prepare/core/markdown-page.ts`) emits no JavaScript, so
the app's drop-down does not carry over.

A static list (a `<nav>` or `<details>` of heading links) needs no script.
Headings already get the same ids there (`makeHeadingNode`). The open question
is whether a published-page reader wants it, and where it sits on the page.
The app's rule (four or more headings at levels 1–3) is in
`frontend/src/components/CardContents/outline.ts`.

## Boxholder's lean (2026-10-20)

Probably wanted, possibly as an option rather than always on; not settled.
Left for later.
