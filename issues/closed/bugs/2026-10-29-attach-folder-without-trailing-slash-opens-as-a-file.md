---
title: "Opening an attach folder without a trailing slash shows \"No text content available\""
workstream: calendar-cards
area: beebox
labels: [frontend, attach-scope]
filed-by: agent
discovered-by: agent
discovered-in: worktree-calendar-cards — screenshotting a calendar card's event folder
resolution: implemented
---

**Closed 2026-10-29:** fixed by commit a8351d1d9. The directory renderer's selector now also matches `.attach` folder names (`src/frontend/src/renderers/directory.tsx`); covered by a selector unit test, not checked in a browser.

The directory renderer decides a path is a directory when its last segment has
no dot (`src/frontend/src/renderers/directory.tsx`, the `match` selector:
*"Directories: no file extension on the last segment, or trailing slash."*).
An attach folder is named `<Name>.attach`, so
`?card=_content/calendar/Family.attach` falls through to the plain-text
renderer and the pane reads "No text content available". The same path with a
trailing slash lists the folder correctly.

Attach folders now hold user-facing content (a calendar's events live in
`<Name>.attach/`), so a link or typed path without the slash lands on a blank
pane. A fix could treat a last segment ending in `.attach` as a directory, or
ask the browse endpoint whether the path is a directory.
