---
title: "Chat drifts off the bottom as it grows, and is hard to scroll back down"
workstream: unattached
area: callback-box
priority: important
labels: [chat, scroll]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder report
---

Starting **fully scrolled down**, the chat still ends up appearing scrolled up
as content grows, and getting back to the bottom is difficult. The follow-the-
bottom pin is losing the race with growth rather than the user having scrolled
away.

Distinct from the earlier report of erratic behaviour *while the user is
mid-scroll*: here the user does nothing and the view drifts on its own.

## Timing — this is after today's scroll work

Landed 2026-08-13 in the `streaming-scroll` workstream:

- `293c59ab` Fix chat scroll fighting the user while streaming
- `19bba657` Harden clamp detection against raced stream growth
- `367aaa78` / `3933174b` `/scrolldebug` flag-gated scroll-controller trace

So this is either a regression from that work or a case it did not cover.
Establish which before designing a fix — a second patch layered on a wrong
model of the first is how this area got complicated.

## Leading suspect

`InteractiveChat-scroll.ts` tells user scrolls from its own by **recording the
`scrollTop` it last wrote** and ignoring incoming scrolls within a pixel or two
of that value; a genuine upward scroll only disengages following when real
wheel/touch/key input fired recently.

Under fast growth those assumptions strain. If content height changes between
the write and the resulting scroll event, the controller's own write no longer
matches what it recorded, and can read as a user scroll — disengaging follow
with no user input at all. That the last fix was specifically about "raced
stream growth" suggests this race is real and only partly closed.

## Use the instrument that now exists

`/scrolldebug` was added for exactly this. Capture a trace across a growing
turn from a start-at-bottom state and establish, before changing code:

- whether following disengages, and on which event;
- whether the re-pin fires but lands short (growth outpacing the write);
- whether `scrollTop` writes are being clamped by a height that changes
  underneath them.

## Related

- Prepend and drop both shift position too — see the paging window in
  [chat messages grow unbounded](../closed/bugs/2026-08-01-chat-messages-grow-unbounded-on-load-older.md).
  Any fix here should not assume growth only happens at the bottom.
