---
title: "Chat scroll is still bad after the write-on-user-action rewrite — the device half was never verified"
workstream: chat-scroll-fixes
area: beebox
priority: important
labels: [ui, chat, scroll]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "The scroll is still quite bad"
---

## 2026-09-15 — boxholder re-assessment

"It's okay, but still has issues." A downgrade from the "still quite bad" this
was filed on, but not resolved. The boxholder could not recall the specific
symptoms from memory, which is the useful finding: **this needs capture at the
moment it happens, not recollection afterwards.** `discuss` removed — the
discussion cannot produce what is missing.

What would move it: one `/scrolldebug` trace taken while the misbehaviour is on
screen (`field-probe` skill), plus which surface it was — phone web, iOS app
webview, or desktop. Until then, do not launch a session on this; six patches
and one rewrite were each declared done against desktop evidence, and a seventh
guess is worth less than one trace.

One correction to the device claim below. "Physical-iPhone momentum,
rubber-band, keyboard transitions, and delayed-image completion remain open"
conflates two categories. Touch momentum and rubber-band physics genuinely need
hardware. **Keyboard open/close and `visualViewport` resizes do not** — Xcode
and the simulators are installed here and taps can be driven programmatically,
so that half is untested rather than untestable. Separate them before the next
attempt.

## 2026-09-04 follow-up — still open

`ee3a07157` fixes the reproduced send, composer-resize, and intra-message
image-reflow failures; the earlier investigation commits add instrumentation
and remove timed image retries. Verification covers 20/20 harness scenarios
in both motion modes, real web send/resize/lazy-image probes, and authenticated
iOS WKWebView simulator send/keyboard behavior. Physical-iPhone momentum,
rubber-band, keyboard transitions, and delayed-image completion remain open.
The current procedure and evidence are in
[chat scroll testing](../../beebox/docs/chat/scroll.md).

## Original report

The chat scroll controller was rewritten in the `chat-scroll` workstream
(landed 2026-08-26, `docs/plans/chat-scroll-model.md`, status `partial`). The
model: `useChatScroll` in `src/frontend/src/components/chat/chat-scroll.ts`
writes `scrollTop` only on a discrete user action (open a thread, send, press
the button) plus geometric compensations; content growth below the reader
never scrolls. Every earlier scroll issue was closed on that rewrite:

- `closed/bugs/2026-08-13-chat-cannot-stay-at-bottom-while-growing.md` —
  closed 2026-08-29 as superseded. The plan said it should **stay open** for
  the iOS device checklist; that checklist was never run.
- `closed/bugs/2026-07-19-scroll-up-history-false-new-messages.md`
- `closed/bugs/2026-08-01-chat-messages-grow-unbounded-on-load-older.md`
- `closed/bugs/2026-07-19-mobile-composer-grows-on-scroll.md` — not testable
  headless; no device confirmation.
- `closed/bugs/2026-08-27-go-to-bottom-lands-in-the-send-spacer.md`
- `closed/bugs/2026-08-27-chat-images-load-without-reserved-size.md`

The boxholder reports the scroll is still quite bad. This issue does not
describe the full extent of what is wrong; the boxholder will describe it in
conversation with the session that takes this. What is known:

- Every fix so far was verified on desktop Chromium (the `/dev/chat-scroll`
  harness, 13/13 scenarios, and the `bin/browse` procedure in
  `docs/chat/scroll.md`). The plan's own finding was that the inputs
  desktop Chromium does not produce — touch momentum, keyboard open/close
  clamps, `visualViewport` resizes, iOS rubber-band, frame drops during
  reflow — are where the previous model failed. None of that has been
  observed on a device under the new model.
- The `/scrolldebug` trace pipeline exists for getting the boxholder's actual
  traces from a phone (`field-probe` skill).
- Post-rewrite patches already followed the same desktop-only pattern:
  send-anchor easing (`67f4223f3`), spacer removal on completion
  (`61d067d86`), open-thread hold fixes (five commits on 2026-08-26).

Adjacent, not chat-scroll: the sidecar tab bar does not scroll the active tab
into view (`2026-08-29-new-tab-not-scrolled-into-view.md`); take it in the
same session only if it is genuinely the same work.

The work: find out what "still bad" actually is, on the surfaces where the
boxholder sees it, before changing the controller again. Six patches and one
rewrite have each been declared done against desktop evidence.

## 2026-10-05 — short-reply completion jump

The new concrete report reproduced in the Chromium harness: removing the send
spacer at completion moved the sent message down by 212 px. The worktree fix
retains that space and consumes only surplus scroll range below the viewport.
The regression now keeps the message at 0 px. Review also exposed over-trimming
during viewport resizing and a 49 px jump when a no-response reply disappeared;
both are corrected. Added scenarios cover those transitions, scrolling space
away, later appended content, and a second send; all 31 harness scenarios
pass at desktop and phone widths. This does not close the physical-device
verification concerns above. Real chat synthetic sends were checked at both
widths; authoritative backend finalization was not exercised in this pass.

## Re-encounter 2026-10-08 (journey walks)

Related observation, desktop. [B-inventory](../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-08.md) (row 17): after the walker sent photos, the view stayed at the sent message and the walker pressed "scroll to latest". [F-newcomer](../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-08.md) (row 15) saw the same and read it as by design: the sent message anchors at the top and the reply grows below. Neither walk checked whether this is the intended anchor-on-send behavior.

## 2026-10-08 — three suggestions from Imbue Studio's transcript scroll engine

The boxholder reports position still lost on resize and on cards opening and
closing. Imbue Studio's chat (read in
[research/imbue-studio/chat-app.md](../../research/imbue-studio/chat-app.md),
section 5; spec `docs/system/specs/transcript-smooth-scroll.md` in
`imbue-ai/default-workspace-template`) went through the same bug class and
settled on three mechanisms that apply to these cases without follow mode or
intent detection, so they fit the never-follow rule in
`beebox/src/frontend/src/components/chat/AGENTS.md`. Designs only; the code
is Fair Core licensed or unlicensed and is not to be copied.

1. **Anchor by row key, not by DOM node.** Studio's anchor is a stable row id
   plus a pixel offset, re-found after every redraw. Bee Box's anchor is a
   text node inside the top visible message (`chat-scroll/anchor.ts`). When a
   card opening or closing rerenders the chat column and React replaces that
   message's nodes, the anchor is disconnected, `anchorMoved` is false, and
   `decideReconcile` compensates nothing; the browser's clamp decides the
   position. Keying the anchor on the message id (every wrapper already
   carries `data-role`; add the entry key) and re-resolving the node at
   compensation time removes that failure.
2. **Derive the position; do not accumulate deltas.** Studio recomputes
   `scrollTop = rowTop(anchor) - offset` from measured geometry on every
   redraw while the reader is away from the bottom. Bee Box's rule 4 is
   "measure delta, write delta" per ResizeObserver cycle. A delta model must
   observe every change in order; a width reflow and a pane open in one frame,
   or a clamp that lands before the observer fires, lose the delta for good. A
   derived position is idempotent, so a missed cycle is corrected by the next
   one. This is a change to the compensation branches only; the "writes only
   on a user action" rule stands, since the derived write is the compensation.
3. **Treat a width change as a full invalidation.** Studio's observer clears
   every measured height when the list width changes and holds the anchor
   through the re-measure. Bee Box has no height cache, so the equivalent is:
   on a scroller width change, re-resolve the anchor by key and apply (2),
   rather than relying on the anchor rect delta of a node that may have
   reflowed internally.

One check before any of that: whether the scroller element itself is replaced
when the companion pane opens or closes. The diagnostics already record a
`scroller-node` event for that case (`docs/chat/scroll.md`, "Reading the
expanded trace"). If it fires, no anchoring model recovers, and the fix is in
the layout, not the controller. Studio avoids the whole class structurally:
each chat is its own document in an iframe, and a card or terminal is another
window, so its chat never reflows when something else opens. Bee Box's chat
shares a flex row with the pane, which is the harder case by construction.

What does not transfer: Studio's FOLLOW/USER_CONTROLLED reducers, tagged
programmatic writes, and custom scrollbar exist to decide when to stop
following, which Bee Box never does; and its spec is Chromium-first and silent
on the iOS keyboard, visual viewport, and rubber-band, so it says nothing
about the unverified device half above.
