---
title: "The agent guide's example puts the Landmarks list in a sidebar that page does not have"
workstream: unattached
area: callback-box
filed-by: agent
discovered-in: worktree-user-stories-refresh — a first-time user was told to look in a sidebar
---

A first-time user was told by the assistant:

> "I've set up an Inventory area (it's in your sidebar now)"

and wrote: *"I do not have a sidebar. There is no sidebar on this page. I have a
dropdown in the top-left corner. So either it's describing a different app or the
word is wrong."*

The phrasing comes from the agent guide every box agent is given
(`src/core/agent-guide/behavior.ts:26-28`, reproduced at
`.callback-box/agent-guide.md:103`):

> **Introduce a system term only when they need it to act**, and explain it in
> the same breath the first time: "I put it on your Landmarks page — the
> quick-jump list in the sidebar."

**A sidebar does exist** — `pages/browse/BrowsePage.tsx` and
`components/history/HistoryBrowser.tsx` both render one. So the word is not
fictional, which is what makes this easy to miss. It is attached to the wrong
thing:

- the **Landmarks page** has no sidebar; landmarks are reached from the
  top-left Place dropdown
- and the user reads the sentence in **chat**, which has no sidebar either

So the guidance lands as a direction to look somewhere that is not there, in the
one moment the rule exists to prevent exactly that.

Navigation moved to a single top bar in
[top-nav-ia](../../callback-box/docs/implemented-plans/top-nav-ia.md) — which
merged the picker into the Landmarks page and demoted the Dashboard — and the
guide's example was not revisited.

## Why it can mislead at all

Fixing the example is worth doing and is not the whole story. The agent's only
account of the interface is a static document it cannot check against the screen,
so any drift between the two becomes a confident wrong direction — see
[let the agent see the interface and point at things in it](../features/2026-08-14-agent-can-see-and-point-at-the-interface.md),
which this is a symptom of.

## The general shape

An example that names a UI element is a factual claim about the interface, and
nothing connects the two. The guide is generated into every box, so a stale
example is not a docs nit — it is instructions to every agent about a screen it
cannot see. Worth a pass over the neighbouring examples for the same drift, and
worth considering whether guide examples should avoid naming UI furniture at
all, since the agent has no way to check.
