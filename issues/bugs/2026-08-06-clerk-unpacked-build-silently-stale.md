---
title: "Loaded Callback Clerk build can silently lag behind source"
workstream: tab-organizer-clerk
area: clerk
filed-by: agent
discovered-in: worktree-tab-organizer-clerk — testing tab organizer handoff
priority: normal
---

Callback Clerk is loaded from the generated `callback-clerk/dist/chrome-mv3/`
directory. A Clerk source change can land without rebuilding that directory.
Chrome's Reload action then reloads the old generated files and gives no clear
warning that the source and extension differ.

This caused a real behavior fix to appear ineffective. The source selected a
newly enabled box, but the loaded bundle still preserved the prior selection.
Repeated tab shares went to the wrong enabled box until someone compared the
compiled function and build time with the source commit.

The correct solution is not yet clear. Possibilities include rebuilding Clerk
when relevant changes land on `main`, using WXT development mode for the loaded
copy, and showing a source revision or stronger build identity in the popup.
Chrome may still require an explicit extension reload after generated files
change, so build freshness and runtime freshness need separate signals.
