---
title: "Give agents an explicit action to show a card"
workstream: unattached
needs: [design]
area: beebox
labels: [agent-ui, chat]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-paper-cards — planning multi-pane card navigation
---

An agent can mention or link a card, but it has no explicit action whose meaning
is "show this existing card in the user's current client." Relying on prose link
clicks makes an agent-requested presentation indirect and leaves no clean place
to state focus, pane, or replacement intent.

Design one client action with a tool and CLI surface, typed success and failure
results, and explicit behavior when no compatible live client is attached. It
must define whether showing changes chat destination, whether the card takes
focus, and how desktop panes map to a mobile foreground card. This is distinct
from [ad-hoc-agent-views](../exploration/2026-07-28-ad-hoc-agent-views.md), which
is about displaying ephemeral content without an existing card.
