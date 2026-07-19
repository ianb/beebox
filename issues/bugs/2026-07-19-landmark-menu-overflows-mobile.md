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

## Fix landed (2026-07-19, commit 5b07cf0a) — awaiting on-device confirmation

Diagnosis below confirmed at a 390px viewport (the menu header rendered as "S
LINKS", contents clipped left of x=0). Fixed by adding viewport clamping to the
shared `Dropdown` primitive (`components/ui/Dropdown.tsx` — clamps its portaled
`fixed` menu `left`/`right` into `[8px, vw-8px]`, plus `maxHeight`+scroll) and
migrating `LandmarkLinksButton` onto it (also `RecentFilesButton`, the paired
issue). After: the menu measures `left=8 right=382` on a 390px screen, fully
on-screen with all links reachable. Kept `needs: [manual-testing]` — verify on a
real phone in both orientations, ideally with a landmark whose `expand` fan-out
makes the list long enough to scroll.

## Diagnosis (2026-07-19, from reading the markup — not yet confirmed in a browser)

The menu is one element, `LandmarkLinksButton.tsx:82`:

```
absolute top-full right-0 mt-1 w-[min(24rem,calc(100vw-2rem))] max-h-[70vh] overflow-auto
```

**Internal scrolling is already handled** and has been since 2026-07-06 —
`max-h-[70vh] overflow-auto`. So a long list is not the problem, and adding a
`max-height` is not the fix. Two other things are wrong:

1. **Horizontal — position, not width.** Width is capped (`min(24rem,
   100vw-2rem)`), but the menu is anchored `right-0` to *the button*. On a 390px
   phone the width resolves to ~358px; if the bookmark button isn't hard against
   the viewport's right edge, the menu's left edge lands at a negative x and is
   clipped off-screen. Capping width can't fix this — the anchor is the bug.
2. **Vertical — wrong unit.** `70vh` resolves against the *large* viewport (as
   if browser chrome were hidden), so on mobile the menu can be taller than
   what's actually visible. `70dvh` tracks the real viewport.

A first attempt at (1) — swapping to `fixed left-2 right-2` with `sm:` restoring
the dropdown — was written and then reverted, because `fixed` + `top-auto`
depends on static-position behavior that's fragile across browsers, and the
button's actual position in the header was never confirmed. **Look at it in a
browser at a phone viewport before changing the CSS**; `bin/browse` drives the
running app. The honest fix may need JS measurement (or a popover primitive)
rather than pure CSS, since no CSS expression knows the button's x-position.

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
