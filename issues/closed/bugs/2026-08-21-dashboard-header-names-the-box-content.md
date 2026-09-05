---
title: "The dashboard header calls the box \"content\" and prints its filesystem path"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-user-stories-refresh — checking the dashboard's "know which box you are in" user story
resolution: implemented
---

The dashboard's `h1` reads `content` on every box, with the box's absolute
filesystem path underneath it.

`HeaderStrip` derives the name from the last segment of the box root:

```ts
const boxName = boxRoot?.split("/").pop() ?? "Box";
```

(`beebox/src/frontend/src/components/dashboard/HeaderStrip.tsx:49-50`.)
Since the box layout moved the operational root to `<box>/content`, that last
segment is the literal word `content` for every box. Line 68 then renders the
full `boxRoot` path as a subtitle.

Consequence: the largest text on the dashboard names no box, and the machine's
directory layout is on screen instead. The nav's place chip is the only thing
that says `test1`. The box's real name is available — `AppNav` resolves it from
the boxes list (`beebox/src/frontend/src/components/AppNav.tsx:127`).
