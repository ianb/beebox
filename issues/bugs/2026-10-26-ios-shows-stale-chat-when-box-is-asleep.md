---
title: "With the box asleep, the iOS app opens on an old chat and a stale chat list, with no sign that either is out of date"
workstream: unattached
area: ios
labels: [ios, chat]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder report, 2026-10-26
---

Steps the boxholder took:

1. Start a new chat on the desktop web app.
2. Let the box go to sleep, so it cannot answer requests.
3. Open the iOS app.

The app shows the list of conversations, but it is the list from before step
1: the new chat is missing, and the app shows an old chat as the current one.
It cannot refresh, because the box is asleep. Nothing on the screen says the
list is old or that the box is unreachable, so the person reads an old chat as
the current state. The boxholder finds this distracting.

Expected, to be decided in design:

- The app says that the box is asleep or unreachable and how old the shown
  list is.
- It does not present an old chat as the current one when it could not check.
- It refreshes on its own when the box answers again.

To confirm while fixing: what "asleep" means on this path (the host machine
asleep, or the hub's idle box stopped), whether the hub wakes the box for the
app's request or answers 503, and where the app's list comes from when the
request fails (a native cache or the web view's last page).

Related: [an unreachable box gives a blank screen](2026-09-12-ios-unreachable-box-shows-a-blank-screen.md),
the other failure shape on the same path, and the closed
[box-closed 503 rendering](../closed/bugs/2026-09-17-ios-app-503-box-closed-rendering-unverified.md).
