---
title: "Mobile app bar crowds the place label when count badges are visible"
workstream: mobile-app-bar
needs: [manual-testing]
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-chip-icon-design — verifying the revised chat properties chip
---

> **⏳ Awaiting manual testing** — fix landed in `c97f04dd9` + `23333c33e`; open a chat on your phone with both counts showing and check that the place pill names where you are and the voice glyph reads as one mark. Only the developer clears this.

> **Re-encountered 2026-09-20 on a phone, worse than filed.** The boxholder,
> sending a screenshot: "The top bar as you can see the icons are all wrong,
> maybe because of so many items." At that width the place pill has lost its
> label entirely and renders as a bare circled card mark with a chevron —
> nothing on it says where you are. The bar was carrying seven controls: place
> pill, chat chip, voice chip, questions badge (2), plate badge (11), error
> badge, profile.
>
> Two distinct problems, and only the first is what this issue was filed about:
>
> 1. **The place pill absorbs all compression.** The right-hand group is
>    `shrink-0` (`AppNav.tsx:152`), so every control added there comes out of
>    the one flexible element. Past some width the label reaches zero and the
>    pill stops being a place *selector* at all.
> 2. **The composite voice icon is unreadable at phone size.** It is a single
>    SVG assembling a person mark, a direction arrow, a bot mark and speaker
>    waves (`chat/VoiceChip-icons.tsx`), which resolves at desktop size and
>    reads as three unrelated glyphs on a phone. That is a legibility problem
>    at a given size, not a layout one, and it does not go away by making room.

At a 375px viewport with both count badges visible, the app bar leaves very
little width for the place control. Browser measurements during the chat chip
change showed about 37px for the place pill, compared with about 48px before
the change. The place label is truncated. The dropdown remains usable.

The approved mobile chat chip omits the sliders and retains the Chat label,
model gauge, and harness modifier. This reduces its width, but the surrounding
bar still needs a layout decision when all controls are present. Do not remove
the label without preserving a clear way to identify chat properties.

Start at `beebox/src/frontend/src/components/AppNav.tsx:152`: the right-hand
controls do not shrink. The flexible place pill uses `min-w-0` and a truncated
label in `beebox/src/frontend/src/components/PlacePill.tsx:165` and `:194`.
Check narrow widths with both count badges, chat properties, and voice controls
visible. Preserve a recognizable, tappable place selector.

## Fixed 2026-09-20

Measured in a real Chromium at a 375px viewport on a chat page, in the state
from the phone screenshot (chat chip, voice chip, questions, plate, error
badge, profile, long landmark name). The right-hand group went from 349px of a
351px row to 273px. The place pill went from 2px with a 0px label to 70px with
a 38px label; at 430px it gets 125px and a 93px label.

Nothing left the bar. Four changes paid for it:

1. The voice face keeps its two facts — floor and answer channel — and drops
   its person and bot marks, at 26×20 instead of 50×16. The speaker body is
   drawn in both answer states so written lines do not read as a hamburger
   menu. Speaker labels and HQ-in-flight moved to the accessible name and the
   menu; in-flight keeps a pulse on the chip below `sm:` and its word above.
2. The chat chip shows its sliders glyph below `sm:` and the word "Chat" from
   `sm:` up, rather than always showing the word and hiding the glyph. The
   `aria-label` names the chip in full at every width.
3. The questions, plate, and error badges became segments of one pill
   (`beebox/src/frontend/src/components/app-nav-badges.tsx`). Three capsules
   spent 52px on padding and gaps to carry 40px of content. Each segment is
   still its own control with its own destination and accessible name.
4. The chat and voice chips share one pill, the shape `PlacePill` already wears
   for two menus in one capsule.

Evidence: exhibit `mobile-app-bar/mobile-app-bar-the-place-label-is-back`.

### Residual: 320px

At a 320px viewport with all seven controls the label still collapses. The
right-hand group is 273px and the row is 296px there, so about 15px is left.
Closing that needs a control to leave the bar at that width — a priority order
among the seven — which is a decision for the developer, not a defect in this
fix. Nothing overflows horizontally at any width tested (320, 375, 390, 430).

## Manual testing

On a phone, open a chat in a landmark with a long name, with pending questions
and on-plate todos so both counts show.

1. The place pill names where you are — a symbol and a readable, truncated
   label with a chevron, not a bare mark. Tapping it still opens the switch
   menu.
2. The voice chip reads as one mark: an arrow and a speaker. Check both answer
   states through the menu's Mute row — waves for aloud, lines for in text —
   and both floor states through Narration mode.
3. The chat chip shows sliders rather than the word "Chat", and still opens the
   session menu.
4. The three counts read as one pill with dividers, and each segment still goes
   to its own destination.
