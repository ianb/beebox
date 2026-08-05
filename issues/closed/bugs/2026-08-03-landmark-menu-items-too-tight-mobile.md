---
title: "Mobile: landmark menu items are too tight — hard to tap the one you want"
area: callback-box
filed-by: agent
discovered-in: main session — boxholder on mobile
resolution: implemented
---

> **Fixed + confirmed on device 2026-08-05.** Landmark menu rows widened in two
> steps — `py-2` → `py-2.5` (`64ded06f`), then `py-2.5` → `py-3.5` (~48px tap
> target, `93f947a9`) — in `LandmarkLinksPanel.tsx`. Boxholder confirmed items are
> easy to select.

On mobile, the landmark menu (the bookmark-icon menu in chat,
`components/chat/LandmarkLinksPanel.tsx`) packs its items too tightly — the rows are
close enough together that tapping an individual item is hard and easy to mis-hit.

The row spacing / tap-target height is below a comfortable mobile touch target
(~44px). Fix: give each landmark row enough vertical padding / min-height and inter-
row spacing to be a reliable touch target on a phone, without the menu overflowing
(the clamping/scroll was just fixed —
[landmark-menu-overflows-mobile](2026-07-19-landmark-menu-overflows-mobile.md)
— so this is the *density* of the items inside that now-fitting menu, a separate
problem).

Per the frontend conventions the spacing belongs in the component itself
(`restrict-component-classes`), not a wrapper — read `docs/frontend.md`. Verify on a
real phone; touch-target comfort can't be judged headlessly.
