---
title: "iPad support: the app already claims iPad — make the layouts true, with real-device testing"
workstream: unattached
area: callback-box
needs: [design, manual-testing]
labels: [ios, layout]
filed-by: agent
discovered-by: Ian
discovered-in: "main session — presumably mostly figuring out the layouts, and I have to actually test things"
---

The app ships with `TARGETED_DEVICE_FAMILY = "1,2"` (all six build configs) —
it *claims* iPad — but nothing was ever designed or verified for it. The
sibling issue
[support-all-interface-orientations](2026-08-18-ios-support-all-interface-orientations.md)
covers the rotation half (Xcode already warns); this one is the layout and
verification work that makes the claim honest.

Two layers, because the app is a thin native shell around the web chat:

- **Native shell**: the composer, capture overlay, pairing, and share
  extension at iPad sizes — split-screen/Slide Over multitasking, keyboard
  attachment behavior (hardware keyboards are normal on iPad), pointer
  hover. The modal-not-split-pane direction (`2026-07-23`) was argued for
  *phones*; iPad width is exactly where a split pane might earn its place —
  a deliberate decision, not an inheritance.
- **Web app inside the WKWebView**: breakpoints between phone and desktop.
  The webview reports a tablet viewport; whatever responsive middle band the
  frontend has is untested there (chat + a document side by side is the
  natural iPad win, same question as the split-pane one).

Verification is the gate (`needs: [manual-testing]`): the boxholder tests on
a real iPad. A session's role is to do the simulator pass first — all sizes,
both orientations, multitasking widths — and hand over a short on-device
checklist per surface (the install-remaining partnership shape). Decide
cheap-first: if real iPad support is deferred, dropping the device-family
claim to iPhone-only is the honest interim (and silences half the
orientation warning); note App Store implications of removing iPad support
if the app ever shipped claiming it.

Fold in or sequence with: the orientations issue above (same test matrix),
`2026-07-23-mobile-modal-not-split-pane` (the iPad exception belongs in that
decision), `cb-ios-overlap` for anything touching the web side.

## Manual testing

On a real iPad, once a session has done the simulator pass and handed over
its checklist: chat (compose, voice, attach) in both orientations; a document
open alongside chat at full, split-screen, and Slide Over widths; capture
overlay; pairing; share extension from Safari; hardware-keyboard behavior in
the composer. Only the boxholder clears this.
