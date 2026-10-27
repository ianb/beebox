---
title: "With the box asleep, the iOS app opens on an old chat and a stale chat list, with no sign that either is out of date"
workstream: ios-stale-chat
area: ios
labels: [ios, chat]
needs: [manual-testing]
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

## Fixed 2026-10-26 (worktree ios-stale-chat)

Plan: `beebox/docs/plans/ios-box-screen-stale-list.md`. The box screen
refreshed only on a cold launch or a box switch, so a return to the app showed
the list from before with no request made, even when the box was awake. The
app now checks the box when it comes forward, says when it cannot reach it and
how old the list is, styles no chat as current until the box answers, and
retries while shown. A hosted box leaves an encrypted copy of its list at a
clean idle stop; the hub answers the phone from it without waking the box, and
the app shows "<box> is asleep" with the time it went to sleep.

Simulator and local-hub evidence is in the exhibit
`box-screen-when-the-box-is-asleep-before-and-after`.

## Manual testing

On the iPhone, against the hosted box, after a deploy:

1. Open the app and note the top chat under "Pick up where you left off".
2. Start a new chat on the desktop web app. Leave the box idle for over 30
   minutes so it goes to sleep, and close the app's tab on the desktop.
3. Open the iOS app (both a return from the background and a fresh launch).
   Expected: the new desktop chat is at the top at once, and a row says
   "<box> is asleep" with the time it went to sleep.
4. With the phone in airplane mode, open the app. Expected: "Can't reach
   <box>", "Last updated …", no chat highlighted; turning airplane mode off
   updates the list within about a minute without touching the screen.

5. With the box asleep (step 2), open the app and leave it on the box screen
   for two minutes. Expected: the box stays asleep (the hub's status page or
   `systemctl status` shows it stopped). Opening a chat wakes it.

Known: with no snapshot the hub can open (a crash, a host reboot, the first
sleep after the deploy), opening the app wakes the box once. The boxholder
accepted this on 2026-10-26.
