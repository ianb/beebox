---
title: "Landmarks can restore a pinned baseline of cards"
workstream: unattached
needs: [design]
area: beebox
labels: [ui, chat]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-paper-cards — planning multi-pane card navigation
---

The sidecar now supports individually pinned tabs, but a landmark cannot define
the set of cards that should form its durable working baseline. Returning to a
landmark after opening and closing other material therefore cannot restore a
known starting arrangement.

The design needs to separate three operations that may otherwise blur together:

- saving the current pinned cards as this landmark's baseline;
- restoring that baseline without losing unrelated work unexpectedly; and
- resetting or replacing a stale baseline deliberately.

It also needs a clear persistence boundary: whether this is box content shared
across clients, a per-user preference, or per-device state. The existing
[pin-a-sidecar-tab](../closed/features/2026-08-30-pin-a-sidecar-tab.md) work owns
individual tab persistence and eviction rules; this issue starts where a named
landmark owns a restorable set.
