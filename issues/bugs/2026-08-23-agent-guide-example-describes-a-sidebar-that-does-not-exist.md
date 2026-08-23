---
title: "The agent guide's own example tells users about a sidebar the app does not have"
workstream: unattached
area: callback-box
filed-by: agent
discovered-in: worktree-user-stories-refresh — a first-time user was told to look in a sidebar
---

A first-time user was told by the assistant:

> "I've set up an Inventory area (it's in your sidebar now)"

and wrote in their notes: *"I do not have a sidebar. There is no sidebar on this
page. I have a dropdown in the top-left corner. So either it's describing a
different app or the word is wrong."*

The phrasing comes from the agent guide, which every box agent is given
(`src/core/agent-guide/behavior.ts:26-28`, and so
`.callback-box/agent-guide.md:103` in every box):

> **Introduce a system term only when they need it to act**, and explain it in
> the same breath the first time: "I put it on your Landmarks page — the
> quick-jump list in the sidebar."

The *rule* is good. The illustration is stale: navigation is a dropdown in the
top-left, not a sidebar. Agents follow the example, so the wrong word reaches
users in the exact moment the guidance exists to make things clear.

Worth checking the neighbouring examples for the same rot while fixing this —
an example that names a UI element is a factual claim about the interface, and
nothing ties it to the interface.
