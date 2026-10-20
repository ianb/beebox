---
title: "The loading page's \"couldn't load\" hint appears after 5 seconds, during an ordinary box warm-up"
workstream: unattached
area: beebox
labels: [ui-error]
filed-by: agent
discovered-by: Ian
discovered-in: main-checkout conversation, 2026-10-20
priority: normal
---

The boxholder often sees the loading page's warning, "If this message stays,
the app couldn't load. Try reloading, or sign in again." They have had no
loading failures. The box sometimes takes longer than usual to warm up, and the
warning appears while it does. A warning that shows during normal loads teaches
the reader to ignore it.

## Where it comes from

`beebox/src/frontend/index.html` shows a boot fallback inside `#root` until
React mounts. The hint is CSS only (`script-src` forbids inline script) and
fades in on a fixed delay: `animation: app-boot-hint-in 0s linear 5s forwards`.
The page waits for the entry script and for `/api/boxes`; the shell renders
nothing until the box list arrives. A box that is starting (the hub starts one
`bbx serve` child per box on demand) can take more than 5 seconds before that
list answers, with nothing wrong.

## Directions

- Raise the delay so it exceeds a normal cold start. Measure cold-start time to
  `/api/boxes` first, on the dev router and in production, and set the delay
  above the slow end of it.
- Make the first message say the box is starting ("Starting your box…"), and
  show the failure wording only much later.
- Let the server say when a box is starting. The hub knows when a box child is
  not yet up; a starting state could replace the fixed timer. This needs a
  script or a server-rendered response, since the hint is CSS only.

Related: [box first load is slow](2026-10-07-box-first-load-is-slow.md).
