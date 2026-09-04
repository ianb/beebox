---
title: "Chat scroll is still bad after the write-on-user-action rewrite — the device half was never verified"
workstream: unattached
area: beebox
priority: important
labels: [ui, chat, scroll]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "The scroll is still quite bad"
---

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
  `docs/chat-scroll-testing.md`). The plan's own finding was that the inputs
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
