---
title: "Mobile: landmark menu items are too tight — hard to tap the one you want"
area: callback-box
filed-by: agent
discovered-in: main session — boxholder on mobile
needs: [manual-testing]
---

> **⏳ Awaiting manual testing** — fix landed: landmark menu rows bumped `py-2`
> → `py-2.5` (+25% vertical spacing, ~36px → ~40px tap target) in
> `LandmarkLinksPanel.tsx`. Tap around the bookmark menu on a phone and confirm
> individual items are easy to hit. Only Ian clears this.

On mobile, the landmark menu (the bookmark-icon menu in chat,
`components/chat/LandmarkLinksPanel.tsx`) packs its items too tightly — the rows are
close enough together that tapping an individual item is hard and easy to mis-hit.

The row spacing / tap-target height is below a comfortable mobile touch target
(~44px). Fix: give each landmark row enough vertical padding / min-height and inter-
row spacing to be a reliable touch target on a phone, without the menu overflowing
(the clamping/scroll was just fixed —
[landmark-menu-overflows-mobile](../closed/bugs/2026-07-19-landmark-menu-overflows-mobile.md)
— so this is the *density* of the items inside that now-fitting menu, a separate
problem).

Per the frontend conventions the spacing belongs in the component itself
(`restrict-component-classes`), not a wrapper — read `docs/frontend.md`. Verify on a
real phone; touch-target comfort can't be judged headlessly.
