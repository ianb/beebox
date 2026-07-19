---
title: "Mobile: the landmark cards menu (bookmark icon) doesn't fit the viewport"
area: callback-box
filed-by: agent
discovered-in: main session — boxholder hit it on mobile
needs: [manual-testing]
---

The landmark cards menu — opened from the **bookmark icon** in chat — doesn't
fit on a mobile viewport. It overflows rather than adapting, so some of it is
unreachable.

Not yet pinned down whether it overflows horizontally (too wide for the screen),
vertically (taller than the viewport with no internal scroll), or is positioned
such that part renders offscreen — the fix differs for each, so establish which
before changing CSS. Also worth checking behavior with a long landmark list vs.
a short one: a menu that fits with three entries and overflows with twenty is a
missing `max-height` + internal scroll, not a width problem.

**Repro:** on mobile, open a chat → tap the bookmark icon → the menu doesn't fit.

**Where to look:** `src/frontend/src/components/chat/LandmarkLinksButton.tsx`
(the button and its menu; rendered from `InteractiveChat-layout.tsx:49`).
Landmark data shape is `navigation.links` / `expand` on the landmark card — see
`src/schemas/landmark.ts` and `docs/landmarks.md`; an `expand` entry fans out to
one link per glob match, so the list length isn't bounded by what's hand-written
in the card. That's the case most likely to overflow and the one to test with.

Per the frontend conventions the fix belongs in the component itself rather than
a wrapper, and `restrict-component-classes` limits `className` to outer layout —
read `frontend.md` before reaching for utility classes.

Pairs with [the composer growing on scroll](2026-07-19-mobile-composer-grows-on-scroll.md)
— same menu, same viewport, and the boxholder hit both in one sitting, so a
shared layout assumption is plausible.

**Manual testing:** confirm on a real phone with a landmark that has enough
links to overflow (use one with an `expand` entry), in both orientations.
