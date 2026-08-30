---
title: "Mobile: the chat input area grows while scrolling after opening recent files / landmark cards"
workstream: unknown
area: beebox
filed-by: agent
discovered-in: main session — boxholder hit it on mobile
resolution: implemented
---

**Closed (implemented + boxholder-confirmed) 2026-07-31.** Fix landed in
`5b07cf0a`: `useVisualViewportHeight` now pins `--app-height` only while the
keyboard is actually up (`innerHeight - vv.height > 150px`) and otherwise defers
to CSS `100dvh`, and the two header menus lost their full-screen `fixed inset-0`
backdrops. Boxholder confirms on a real phone the composer holds its size while
scrolling the recent-files / landmark panels. (Other composer quirks may remain,
but this growth-on-scroll one is gone.) Reopen only if the composer resumes
growing on scroll.

On mobile, open the **recent files** panel or the **landmark cards** menu in
chat, then scroll — the composer/input area grows as you scroll, in the worst
case expanding until it occupies the whole page. The chat content is pushed out
and the screen becomes unusable without a reload.

## Fix attempted (2026-07-19, commit 5b07cf0a) — NOT yet reproduced or confirmed

This could not be reproduced in headless Chromium (no mobile URL-bar/keyboard
`visualViewport` dynamics — `vv.height === innerHeight` throughout, and the
textarea's `maxRows={8}` cap holds). Best-guess root cause: `useVisualViewport
Height` mirrored `window.visualViewport.height` into `--app-height` on *every*
resize, but with the keyboard closed that event still fires as the mobile URL
bar collapses during a scroll/fling, so each transient height grew/jittered the
shell. Changed it to pin `--app-height` only while the keyboard is actually up
(`innerHeight - vv.height > 150px`) and defer to CSS `100dvh` otherwise (which
tracks URL-bar chrome smoothly, no JS thrash). Also removed the two header menus'
full-screen `fixed inset-0` backdrops (they intercepted scroll into the document,
a likely trigger for the churn).

The `InteractiveChat-controls.tsx:243` lead in the original note was a red
herring — that `scrollHeight - clientHeight` is the *companion panel's* scroll
reporter, unrelated to the composer.

**Manual testing (still required — the fix is unverified):** on a real phone,
open the recent-files / landmark menu, scroll/fling, and confirm the composer
holds its size and doesn't grow. Then open the keyboard and confirm the composer
still sits *above* it (the case the `--app-height` override exists for), and that
a multi-line message still grows the textarea normally up to its cap. If the
composer still grows, the model is wrong — do not clamp the textarea height to
paper over it (see original note below).

Unconfirmed on desktop, and unconfirmed whether both entry points (recent files
*and* landmark cards) trigger it or only one; the boxholder saw it via both.
Whether it's the scroll itself or just time-after-opening the panel hasn't been
separated either — worth checking whether merely opening a panel and waiting
does it, which would point at layout rather than scroll handling.

**Repro:** on mobile, open a chat → open the recent-files panel or the landmark
(bookmark icon) menu → scroll the chat → watch the input area expand.

**Where to look:** the composer region stacks several panels above the input —
`src/frontend/src/components/chat/InteractiveChat-layout.tsx` renders
`RecoveredDictation`, the image attachment panel, and `SelectionPanel` above the
composer, plus `LandmarkLinksButton` (`InteractiveChat-layout.tsx:49`). The
composer itself is `InteractiveChat-composer.tsx`; `InteractiveChat-mobile-row.tsx`
is the mobile-specific row. `InteractiveChat-controls.tsx:243` does
`el.scrollHeight - el.clientHeight` — scroll math worth checking against a
textarea whose height is itself being recomputed.

A plausible shape (unverified): an autosizing input measuring `scrollHeight`
while a panel above it changes the available height, so each scroll/layout pass
feeds a slightly larger measurement back in — a feedback loop rather than a
single bad value. If so, the fix is to break the measure→resize→measure cycle,
not to clamp the max height (a clamp would hide it at full-screen-minus-one).

Pairs with the [landmark menu not fitting on mobile](2026-07-19-landmark-menu-overflows-mobile.md)
— same menu, same viewport, possibly the same layout assumption.

**Manual testing:** a fix has to be confirmed on a real phone — open both
panels, scroll, and check the composer holds its size; then check the composer
still grows normally as you type a multi-line message.
