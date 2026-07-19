---
title: "Mobile: the chat input area grows while scrolling after opening recent files / landmark cards"
area: callback-box
filed-by: agent
discovered-in: main session — boxholder hit it on mobile
needs: [manual-testing]
---

On mobile, open the **recent files** panel or the **landmark cards** menu in
chat, then scroll — the composer/input area grows as you scroll, in the worst
case expanding until it occupies the whole page. The chat content is pushed out
and the screen becomes unusable without a reload.

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
