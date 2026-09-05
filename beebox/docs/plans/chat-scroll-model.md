---
title: "Chat scroll: write on user actions only"
status: partial
workstream: chat-scroll
issues:
  - ../../../issues/closed/bugs/2026-08-13-chat-cannot-stay-at-bottom-while-growing.md
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
action, plus geometric compensations for changes the user cannot see. Content
growth below the reader never scrolls.** The controller keeps *geometry* state
(previous `scrollHeight`, previous `fromBottom`, a top-visible anchor) and no
*intent* state: it never asks whether a scroll event was the user's, because
nothing it does depends on the answer.

Writes, exhaustively:

1. **Open a thread** → scroll to the bottom, and keep doing so on each content
   growth until the first history render has landed (`messages.length > 0`
   after load; the empty state renders no scroller at all,
   `InteractiveChat-messages.tsx:229`). This is a bounded initial state, not
   following: it ends at the first paint with content — where "paint" has to
   include the transcript's images: an `<img>` reserves no height until its
   bytes arrive (the chat has no dimension metadata to reserve with), so the
   hold waits for the transcript's images to load or fail (lazy ones only
   when near the viewport),
   then ends after a short quiet period with no content growth (a cached
   image is `complete` before it is decoded and laid out), all under an 8s
   cap (2026-08-26; the fixed
   400ms it shipped with stranded a reader an image's height above the bottom
   on every open of an image-bearing thread). The reader's own action ends it
   early.
2. **Send a message** → scroll so the new user message sits at the top of the
   viewport. The reply streams in below it and fills the screen without any
   scrolling. If the reply outgrows the screen, it continues below the fold;
   the scroll-to-bottom button shows. (The boxholder's proposal and the
   ChatGPT/claude.ai behaviour.) The last turn carries
   `min-height: 100cqh` (the scroller is a size container) so "at the top" is reachable when the
   reply is short; the spacer lasts until the reply is complete (2026-08-26:
   it used to persist until the next send, leaving a screen of blank room
   under every finished reply — dropping it at finalize lets the browser
   clamp the view to the real bottom, one move to a place showing the whole
   reply). Ordering on send:
   the previous turn loses its spacer, the new user turn gains it, and the
   scroll write runs in a layout effect after that commit — one write, after
   the shrink above and the growth below have both landed, so nothing clamps.
3. **Click the scroll-to-bottom button** → smooth scroll to the bottom.
4. **Hold position** across changes the user did not cause:
   - older history prepended above → restore the captured bottom gap;
   - content above the reading point reflowing (a late image/embed) → retain a
     visible character within the message, using a DOM Range. Measure its
     content coordinate (`rect.top - scroller.top + scrollTop`), so scroll
     events cannot be mistaken for reflow. An element is a fallback for
     non-text content. This replaces the message-level anchor after the
     2026-09-04 lazy user-image reproduction exposed intra-message movement;
   - the scroller shrinking or growing from below (keyboard, composer,
     banners) → keep the bottom only if already there; otherwise preserve
     the reading point within the legal scroll range. This replaces the
     unconditional bottom-gap policy that moved reading text while typing.
   A running send ease owns writes until it finishes or is interrupted;
   resize callbacks measure and update viewport size without superseding it.
   Each is "measure delta, write delta", triggered by a resize. None consults
   whether the user scrolled recently.

Derived from geometry:

- `atBottom = fromBottom <= 24px`, recomputed on scroll and resize. Drives the
  button's visibility.
- `unseen`: set when a content resize's growth lands below the anchor (the
  delta not explained by rule 4's above-viewport compensation) while
  `!atBottom`; cleared when `atBottom` becomes true. Drives the button accent.

Gone: `pinnedRef`, `lastProgrammaticTopRef`, `lastUserIntentAtRef`,
`smoothTargetRef`, `PROGRAMMATIC_EPSILON`, `USER_INTENT_WINDOW_MS`,
wheel/touch/key listeners, `decideScroll`, and every branch that asks "was
that scroll ours". The scroll handler records geometry and recomputes
`atBottom`. Estimated size: ~180 lines; `decideReconcile` stays as the pure
rule-4 dispatcher.

### Decision: does anything still follow?

**Decided 2026-08-25 by the boxholder: no auto-scroll except on the user's own
send.** The rest of this section records the alternative that was weighed.

Under this model nothing follows the bottom — not the streaming reply, and not
a message that arrives without a local send (another participant, an agent
emission, a scheduled turn). A user sitting at the bottom sees the button light
up and presses it. Codex's review calls the loss of follow a regression against
the current contract, and it is one; the boxholder's words were that following
past a screen is not needed, which is not the same as none.

The alternative, if wanted, is one stateless rule in the content-resize branch:
*if `fromBottom <= 24px` before the growth, write to the bottom after it.* It
is the same shape as rule 4's scroller-resize branch and needs no intent
state. Its one cost is the ambiguity that produced the intent machinery: a
scroll-up of less than 24px during fast growth is snapped back. With rule 2 in
place that only matters on replies longer than a screen. Either way the harness
scenario exists (`follow-while-streaming`); the choice flips one expectation.
Recommendation: ship without follow first, per the boxholder's proposal, and
add the rule only if they miss it.

## Library call: none

- There is no scroll library now; `react-virtuoso` was removed in June because
  its `followOutput`/`atBottom` fought the in-repo pin — the same two-authority
  problem. Reintroducing a virtualizer (virtuoso, `@tanstack/virtual`) brings
  that back and solves a problem we don't have: `chat-history-scale` landed
  backend-only, the DOM window is already bounded at 600 retained messages.
- `use-stick-to-bottom` (the library the current design mirrors) *is* the
  current model — position-classified following — so adopting it would be the
  same code with less control.
- The model above needs ~180 lines and every line is device-behaviour we need to
  own. A dependency adds review surface and removes the harness's ability to
  swap controllers.
- Platform primitives: CSS scroll anchoring (`overflow-anchor`) would do rule
  4's prepend and above-viewport branches natively, and Chrome did exactly that
  in the harness — but WebKit does not implement it, and the boxholder's
  device is iOS, so the manual branches must exist anyway; running both
  double-applies, hence `overflow-anchor: none` stays. `flex-direction:
  column-reverse` gives native bottom-following in every browser but is the
  *opposite* of rule 2 (it follows unconditionally) and breaks DOM order for
  a11y. `scrollend` is unsupported in Safari. None removes code this model
  needs.

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

Tracks 1-3 are implemented in the controller and harness. The 2026-09-04
follow-up corrects intra-message image anchoring, composer resizing, and send
spacer ownership. The harness passes 20/20 scenarios in normal and reduced
motion; real Chromium probes cover sends, composer resizing, and delayed images.
Authenticated iOS WKWebView simulator evidence covers sending and keyboard
opening during a live reply. See [the current verification record](../chat-scroll-testing.md).

**Outstanding:** physical-iPhone momentum, rubber-band, keyboard transitions,
and delayed-image checks remain unverified. The earlier issue was closed as
superseded; [the current scroll issue](../../../issues/bugs/2026-09-04-chat-scroll-still-bad-after-rewrite.md)
now carries this punch-list. The historical findings and track descriptions
above record the original rewrite, not the current verification boundary.
