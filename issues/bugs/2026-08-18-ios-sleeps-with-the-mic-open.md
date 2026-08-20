---
title: "iOS: the device sleeps while the app is running — including with the mic open — breaking recording"
workstream: unattached
area: callback-box
labels: [ios, voice, capture]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder report from the iOS app
priority: important
---

The phone sleeps while the app is in the foreground and doing something. Most
sharply: **it sleeps with the microphone open**, which breaks the mic and
whatever depended on it. The boxholder's observation is precise and useful —
*actually speaking* seems to keep it awake, but **an open mic with silence lets
it sleep**.

## The likely cause: nothing disables the idle timer

`isIdleTimerDisabled` does not appear anywhere in `ios-app/`. On iOS the display
sleeps on a system idle timer that only user interaction resets; a native app
that needs the screen to stay on sets `UIApplication.shared.isIdleTimerDisabled`
and clears it afterwards. Nothing does.

The only wake-lock in the codebase is web-side —
`src/frontend/src/hooks/useWakeLock.ts`, built on the Screen Wake Lock API. That
is the wrong layer for this: a lock requested from inside a `WKWebView` is not a
reliable substitute for the native idle timer, and the observed behavior is
consistent with it not taking effect at all here.

**The speaking-keeps-it-awake detail fits this reading**, and is worth verifying
rather than assuming: audio *playback* extends the idle timer on iOS, and other
activity may too, so speech may be resetting the timer as a side effect while
silence leaves it to expire. If that is right, the current behavior is
accidental rather than designed, which means it will also vary by circumstance.

## What has to be decided, not just coded

The fix is one property, but *when* to hold it is the real question:

- **Mic open** — clearly yes. This is the reported break.
- **A turn streaming in** — probably: the reply is arriving and the user is
  reading it.
- **Speech playing back** — iOS may already cover this; verify before adding.
- **Idle chat, app merely foregrounded** — no. Holding the screen on whenever
  the app is open drains the battery and is the kind of thing that gets an app
  deleted.

And the release path matters more than the acquire path: every state that sets
the flag must clear it on backgrounding, on error, on the mic closing for any
reason. A leaked `isIdleTimerDisabled` is a phone that never sleeps, which is a
worse bug than the one being fixed.

## Related

- `useWakeLock.ts` should be reconciled with whatever lands — two mechanisms
  claiming to keep the screen awake, one of which does not work in the shell,
  is how this stays confusing.
- The mobile contract (`docs/mobile-contract.md`) is where a native/web
  responsibility split like this belongs once decided, so the web side knows it
  must *not* try to own it.
