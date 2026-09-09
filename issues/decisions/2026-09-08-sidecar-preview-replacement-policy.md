---
title: "Decide whether card previews replace a transient tab or accumulate"
workstream: unattached
needs: [decision]
area: beebox
labels: [ui, navigation]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-paper-cards — planning multi-pane card navigation
---

Opening card links currently accumulates tabs until the unpinned-tab cap evicts
older entries. A file-browser-style alternative would keep one transient preview
slot: another ordinary open replaces it, while focusing, editing, or pinning the
preview promotes it to a durable tab.

Choose the default interaction before multi-pane navigation makes the behavior
harder to change. Replacement reduces tab churn but can make a card disappear
when the user expected it to remain; accumulation is predictable but creates
cleanup work and weakens spatial continuity. The decision must cover link opens,
agent-requested opens, keyboard-modified opens, and mobile, and explain how users
promote a preview deliberately. Individual pinning and the current tab cap were
implemented by
[pin-a-sidecar-tab](../closed/features/2026-08-30-pin-a-sidecar-tab.md).
