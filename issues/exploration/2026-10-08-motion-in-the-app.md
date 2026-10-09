---
title: "Motion in the app: which moments deserve animation, and the one rule for the rest"
workstream: unattached
area: beebox
needs: [design]
labels: [frontend, ui-sensibility]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-imbue-studio-research — Studio's launch film and window motion
---

The boxholder (2026-10-08): "I do want some neat animations."

What prompted it: Imbue Studio's desktop app plays a short film on every
launch (the wordmark pops in letter by letter on a spring, a loader fades in
under it only when the wait is worth reporting, and the mark travels up to
its parked place in the titlebar when the app is ready), with a
`prefers-reduced-motion` variant that draws the mark at rest. The doc's
reason: "the app has to start either way, and the film is what the wait looks
like" (`mngr/apps/minds/docs/desktop-app.md`). Windows pop out and settle;
the progress timeline's current step shimmers while the agent writes.

Bee Box's motion today is sparse and mostly corrective: the send-anchor ease
in chat ([closed](../closed/bugs/2026-08-27-send-scroll-jump-has-no-easing.md)),
the lightbox swipe, and whatever the UI primitives do by default.

## The question

Not "add animation" but which moments carry meaning that motion conveys
better than a cut, and one rule for everything else. Candidates:

- **Opening the box and the first screen.** The wait while the server and
  the agent come up; today it is a blank or a spinner. A film that is the
  wait, as Studio does, with the reduced-motion variant.
- **The agent working.** A turn in flight, a schedule running, a procedure
  step: the shimmering caption is Studio's answer; Bee Box shows a chip.
- **Cards opening in the companion pane and closing.** A transition that
  keeps the reader's eye on the chat column, which also interacts with the
  [scroll position](../bugs/2026-09-04-chat-scroll-still-bad-after-rewrite.md)
  work: motion must not move the anchor.
- **Capture.** Photo taken, recording started and stopped, the batch landing
  as cards.
- **Todos checked off, the plate changing** at the start of a day.
- **Arrival of something new** while the person reads: the unseen-content
  button's accent today.

The rule for the rest: a cut, no motion, unless the motion explains where
something went or where it came from. Every animation gets a
`prefers-reduced-motion` form.

## Constraints

- Phone first: the iOS shell and Safari's rendering budget decide what is
  smooth.
- The scroll controller writes `scrollTop` only on user action; any motion
  in the message list goes through it (`beebox/src/frontend/src/components/chat/CLAUDE.md`).
- Tours and axe run on every page; animated states need a settled state the
  tour can capture.
