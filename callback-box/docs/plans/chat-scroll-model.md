---
title: "Chat scroll: write on user actions only"
status: draft
workstream: chat-scroll
issues:
  - ../../../issues/bugs/2026-08-13-chat-cannot-stay-at-bottom-while-growing.md
---
# Chat scroll: write on user actions only

The chat scroll controller has been patched four times since June and the
boxholder still sees jank, drift, and the view fighting them. This plan replaces
the controller's model rather than adding a fifth rule to it. It is the
"model and library call" requested before any rewrite; the rewrite itself is
Track 2 and does not start until the model is accepted.

## What was re-verified first (2026-08-25)

The handoff said closed scroll issues are "mostly not fixed". Re-run against
the live app via `bin/browse` with `/scrolldebug` traces
(`scratch/scroll-reverify.md` has the full record):

| Issue | Result |
|---|---|
| `2026-08-13-chat-cannot-stay-at-bottom-while-growing` (open) | **Does not reproduce on desktop Chromium.** 7 hands-off runs (fakestream at 40 chars/15ms, 3 real turns, 300-entry session, 1280×800 and 390×844 viewports): `fromBottom` ends at 0 every time, zero intent-less disengages, button never appears. One measurable defect: a transient follow lag of up to ~350px for 1–3 samples when a render burst outgrows the next reconcile write; it self-corrects. |
| `2026-07-19-scroll-up-history-false-new-messages` (closed) | Fix holds: 7199px prepend compensated to 0px shift, badge unaccented. |
| `2026-08-01-chat-messages-grow-unbounded-on-load-older` (closed) | Fix holds: window caps at 600 retained, 10 prepends with 0px shift. |
| `2026-07-19-mobile-composer-grows-on-scroll` (closed) | Not testable headless (`visualViewport` isn't emulated); no contrary evidence. |

The new isolated harness (`/dev/chat-scroll`, below) agrees: 5 of 6 scenarios
pass against the current controller, including `fast-growth-hands-off`.

So the boxholder's experience is not a desktop-Chromium bug. Everything that
was fixed is fixed *for the inputs desktop Chromium produces*. The inputs it
does not produce — touch momentum with no `touchmove`, keyboard open/close
clamping `scrollTop`, `visualViewport` resizes, iOS rubber-band, frame drops
during reflow — are precisely the inputs the current controller has to *guess
about*. That is the finding: the patches are correct, and the model they patch
cannot be verified where it fails.

One new defect the harness found: an image decoding inside a prepended older
block lights the "new messages" badge (`decideReconcile` falls through to
`flag-unseen` because the test is "did the anchor move", not "did growth happen
above the anchor"). Filed below as a scenario; it disappears under the new model.

## Why the current model cannot be made robust

`useStickToBottom` writes `scrollTop` on **every** ResizeObserver cycle while
"pinned", and therefore must classify **every** scroll event as ours or the
user's. It does that from position: an epsilon around the last write, a 250ms
input-intent window, a `fromBottom` threshold, the smaller of two scrollHeights
to absorb raced growth, a tracked smooth-scroll target. Each of the four August
fixes added one of those discriminators. The browser also writes `scrollTop`
without any input event (clamps on shrink, keyboard dismiss, smooth-animation
frames, fractional rounding), and mobile Safari adds momentum scrolls with no
`touchmove` and a `visualViewport` that moves independently of layout. Every one
of those is a new case for the classifier, and each is testable only on the
device that produces it. The controller is 372 lines because the classifier is
open-ended.

## The model

**The controller writes `scrollTop` only in response to a discrete user
action. Content growth never scrolls.** There is no "pinned" state and no
classification of scroll events, because after a discrete action every
subsequent scroll event is the user's by construction.

Writes, exhaustively:

1. **Open a thread** → scroll to the bottom.
2. **Send a message** → scroll so the new user message sits at the top of the
   viewport. The reply streams in below it and fills the screen without any
   scrolling. If the reply outgrows the screen, it continues below the fold;
   the scroll-to-bottom button shows. (This is the boxholder's proposal and the
   ChatGPT/claude.ai behaviour.) To make "at the top" reachable when the reply
   is short, the last turn carries `min-height: <scroller clientHeight>`; the
   spacer persists until the next send, so finalize never clamps.
3. **Click the scroll-to-bottom button** → smooth scroll to the bottom.
4. **Hold position** across changes the user did not cause and cannot see:
   older history prepended above (restore the bottom gap), content above the
   viewport reflowing (anchor the top visible child), the scroller shrinking
   from below while the view is at the bottom (keyboard, composer growth —
   preserve `fromBottom`). These are geometric compensations with no state:
   each is "measure delta, write delta", triggered by a resize, never by a
   scroll event. Safari has no native scroll anchoring, so they stay manual and
   `overflow-anchor: none` stays on everywhere so Chrome does not double-apply.

Derived, never stored:

- `atBottom = fromBottom <= 24px`, recomputed on scroll and resize. Drives the
  button's visibility.
- `unseen = content grew below the viewport while !atBottom`, cleared when
  `atBottom` becomes true. Drives the button accent. Growth *above* the
  viewport (rule 4) is excluded by construction — the gap/anchor rules know
  which side the delta landed on.

Gone: `pinnedRef`, `lastProgrammaticTopRef`, `lastUserIntentAtRef`,
`smoothTargetRef`, `PROGRAMMATIC_EPSILON`, `USER_INTENT_WINDOW_MS`,
wheel/touch/key listeners, `decideScroll`. The scroll handler only recomputes
`atBottom`. Estimated size: ~150 lines plus the pure `decideReconcile` for the
rule-4 branches.

Follow-while-streaming is deliberately not a rule. The boxholder said it does
not need to follow past a screen; under rule 2 a reply shorter than a screen is
fully visible without following, so the stateless version of "follow" (snap to
bottom on growth when `atBottom` was true before the growth) buys nothing on
short replies and reintroduces the one ambiguity that matters — a small
scroll-up near the bottom during fast growth — on long ones. If the boxholder
wants following back after living with rule 2, it is a five-line addition to
the content-resize branch with no classifier, and the harness scenario for it
already exists (`follow-while-streaming`).

Why this is different from the four previous fixes: they each narrowed the
classifier's error on one input the desktop could not reproduce. This removes
the classifier. The remaining device-only surface is rule 4's scroller-shrink
branch (keyboard), which is a delta write with no intent inference, and which
the current controller already relies on today.

## Library call: none

- There is no scroll library now; `react-virtuoso` was removed in June because
  its `followOutput`/`atBottom` fought the in-repo pin — the same two-authority
  problem. Reintroducing a virtualizer (virtuoso, `@tanstack/virtual`) brings
  that back and solves a problem we don't have: `chat-history-scale` landed
  backend-only, the DOM window is already bounded at 600 retained messages.
- `use-stick-to-bottom` (the library the current design mirrors) *is* the
  current model — position-classified following — so adopting it would be the
  same code with less control.
- The model above needs ~150 lines and every line is device-behaviour we need to
  own. A dependency adds review surface and removes the harness's ability to
  swap controllers.

## Reproductions and the harness

`/dev/chat-scroll` (built this session, `pages/dev/ChatScrollHarness.tsx` +
`pages/dev/components/chat-scroll-*.ts`) is a controller-agnostic scenario
runner: seeded fake messages, scripted steps (`stream`, `finalize`, `prepend`,
`chromeResize`, `imageDecode`, `userWheel`, `userDrag`, `keyboardClamp`), a
live readout, the controller's own trace via `scrollTraceSubscribe`, and
`window.__scrollHarness.runAll()` for `bin/browse eval`. Controllers register
in `chat-scroll-controller.ts`; the rewrite drops in beside `useStickToBottom`
and runs the same table.

Scenarios encode the model as expectations. Current results against
`useStickToBottom`: 5 PASS, `prepend-older` FAIL (false badge, above). Track 2
adds: `send-anchors-user-message-top`, `reply-longer-than-screen-does-not-follow`,
`button-returns-to-bottom`, `keyboard-clamp-holds-bottom`, `prepend-image-decode-no-badge`,
and a `momentum-fling-no-touchmove` step that dispatches scroll events with no
input events — the iOS shape the classifier guessed about, which the new model
does not need to distinguish.

Harness gaps to close in Track 1: the harness scroller must set
`overflow-anchor: none` like the app (the prepend finding was compensated by
Chrome's native anchoring, which the app disables); `docs/chat-scroll-testing.md`
must say `/fakestream` content vanishes at finalize in server-backed sessions
and that `bin/browse eval --no-wait` is required mid-stream.

Device verification stays manual: rule 4's keyboard branch and rule 2's
`min-height` spacer on iOS. A `/scrolldebug` field probe (`field-probe` skill)
is the way to get the boxholder's actual traces; the trace pipeline exists.

## Tracks

1. **Harness alignment** — `overflow-anchor: none`, the new scenarios above,
   testing-doc corrections. Scenarios for rules 2 and 4 fail against the current
   controller (it follows); that is the before-state.
2. **Controller rewrite** — `useChatScroll` per the model, registered in the
   harness, all scenarios green, `decideScroll` deleted, nested CLAUDE.md and
   `docs/chat-scroll-testing.md` rewritten to the new model.
3. **Wire into `MessageList`** — send anchors the user message; last-turn
   min-height; button semantics unchanged. `bin/browse` procedure run; iOS
   checklist run by the boxholder; `/scrolldebug` trace requested if anything
   still feels wrong.
4. **Close out** — re-aim the open issue at the model change; the harness
   finding (`prepend-older` badge) is a scenario, not a separate issue.
