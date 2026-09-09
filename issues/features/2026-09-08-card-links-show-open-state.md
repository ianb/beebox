---
title: "Card links indicate when their target is already open"
workstream: unattached
needs: [design]
area: beebox
labels: [ui, navigation]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-paper-cards — planning multi-pane card navigation
---

When several cards are open, links to those cards look the same as links that
would open a new card. The user cannot tell whether following a link will focus
an existing pane or add another tab, and repeated references give no sense of
the current working set.

Define a subtle, accessible open/active treatment for card links across rendered
cards and chat. The state must distinguish "open somewhere" from "currently
focused," remain understandable without color alone, and update when panes or
tabs change. It should preserve ordinary link semantics and avoid turning every
reference into heavy chrome.
