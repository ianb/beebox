---
title: "iOS: the device sleeps while the app is running — including with the mic open — breaking recording"
workstream: voice-barge-in
area: callback-box
needs: [manual-testing]
labels: [ios, voice, capture, mobile-contract]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder report from the iOS app
priority: important
---

> **⏳ Awaiting manual testing** — a native idle-timer hold has landed. On a real
> phone: open the mic and stay silent for longer than the auto-lock interval and
> check the screen stays on; then leave the composer idle and check the phone
> *does* sleep normally. Only the developer clears this.

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

## What landed

`ios-app/CallbackBox/Services/ScreenAwake.swift` — a single writer of
`UIApplication.isIdleTimerDisabled` over a set of named reasons. The decisions
above were settled as:

- **A voice turn** (`ScreenAwakeReason.voiceTurn`) — the microphone open or
  opening, *and* the gaps inside the turn: the pause while the box speaks and
  the reply streaming in before that speech starts. The streaming question
  resolved to "yes, but only inside a voice turn": that gap ends by *reopening
  the microphone*, so sleeping through it breaks the same thing the open mic
  does. A turn streaming to a reader who typed it holds nothing.
- **Speech playing** — a screen lock suspends the app (no background-audio
  mode) and cuts the utterance mid-sentence.
- **Native capture recording** — the same open-microphone break on a second
  surface, so it is held too.
- **Idle foregrounded chat** — nothing, as argued above.

Release is by *re-derivation*: each holder computes its reasons from current
state with `scenePhase == .active` folded in, so backgrounding, dismissal, error
and the mic closing all release by one path, and a reason re-derived twice is
still one hold. Reasons are per-surface, so the capture screen dismissing cannot
unlock a phone whose composer mic is still open. `ScreenAwakeTests` covers the
edges, the leak paths, and the cross-surface case.

`useWakeLock.ts` is reconciled: under `?nativeComposer=1` the web wake lock is
not requested at all. The page can see only the *speech* half of a native voice
turn, so a web lock there would hold through the box talking and drop through
the listening it cannot observe — the shape of this bug. The hook stays correct
for the ordinary browser client, where the web does own the microphone.

The split is written down as mobile-contract §4.10 (+ row R1, and a §3.2 bullet
for what `nativeComposer` changes web-side), so a future platform inherits it.

## One reading of the report to check on device

The issue's diagnosis says the web wake lock is probably "not taking effect at
all here". There is a second reading that fits the same evidence: it *does* work
in the webview, but under the native composer it can only ever see speech
playback — the mic is native — so the box talking held the screen and the
silence after it did not. That is exactly the reported symptom, and it is why
the fix suppresses the web lock rather than leaving it as a partial backstop.
Which reading is true does not change the fix; it is worth knowing because it
tells us whether `useWakeLock` is dead weight inside `WKWebView` or merely
misscoped.

## Manual testing

Needs a real device — the simulator has no idle timer, so none of this is
observable there. Set Auto-Lock short (Settings → Display & Brightness →
Auto-Lock → 30 seconds) so each check takes half a minute rather than five.

1. Open the mic in the composer and **say nothing** past the auto-lock interval.
   The screen must stay on. This is the reported bug; before the fix it locked
   and the recording died.
2. Send a voice message and let the box reply out loud, hands off the phone
   through the whole exchange — the streaming gap before the speech starts, the
   speech itself, and the mic reopening after. The screen must stay on for all
   of it, since the turn ends by reopening the microphone.
3. Leave the chat idle — no mic, no speech — past the interval. The phone must
   sleep normally. A hold that leaks here is worse than the bug.
4. Close the mic, then background the app and come back. It must still sleep on
   its own afterwards.
5. Open native capture, record audio, and stay silent past the interval — the
   screen stays on; dismiss capture with the composer mic open and confirm the
   screen still stays on (the two surfaces hold independently).
