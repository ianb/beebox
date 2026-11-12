---
title: "A card tab flashes \"Loading...\" on fast loads and handles a box restart poorly"
workstream: unattached
area: beebox
labels: [frontend, loading]
filed-by: agent
discovered-by: Ian
discovered-in: "main checkout — boxholder report, 2026-11-09"
---

The loading state for a card or file tab is weak in two ways.

**Flash on fast loads.** Most tabs load quickly, but `FileView` shows
`Loading...` as soon as `useFileData` reports `loading`
(`beebox/src/frontend/src/components/FileView/view.tsx`,
`pendingFileViewLabel`). A fast load shows a brief flash of text before the
card. The state should appear only when a load is slow, for example after a
short delay. A slow load should still show it.

**Box restarting.** When the box is down for a restart, a tab that opens has
no earlier body to show. It falls to `FileErrorState`, which shows the
failure in danger colours and a "Try again" button. The person must retry by
hand, and the error reads as a fault, not as a wait. The tab should recognize
that the box is restarting, say so, and load the card when the box is back.

Related: [box first load is slow](2026-10-07-box-first-load-is-slow.md),
[status and error text ignore card material](../closed/bugs/2026-10-24-status-and-error-text-ignore-card-material.md),
[motion in the app](../exploration/2026-10-08-motion-in-the-app.md).
