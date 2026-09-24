---
title: "Mobile app bar crowds the place label when count badges are visible"
workstream: mobile-app-bar
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-chip-icon-design — verifying the revised chat properties chip
---

> **Re-encountered 2026-09-23 after the fix (weekly tour check).** At 375px
> with both count badges showing (39 questions, 15 todos), the place pill
> label still collapses to one letter: "B" for "Box". The fix in
> `c97f04dd9` + `23333c33e` gave the label a few pixels, not enough to name
> the place. The manual-testing gate is removed because this re-encounter
> shows the fix is incomplete. Artifacts: `nav-pages` tour, checkpoints
> `chat` and `browse`, mobile viewport —
> `beebox/test/tours/.artifacts/nav-pages/2026-09-24T00-46-26-931Z/chat.mobile.png`.
> The other routed pages show a "Chat" button in that position, so the
> clipping shows on the chat and Browse views.

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

Measured in a real browser at a 375px viewport on a chat page, in the state
from the phone screenshot (chat chip, voice chip, questions, plate, error
badge, profile, long landmark name). The right-hand group went from 349px of a
351px row to 289px. The place pill went from 2px with a 0px label to 54px with
a 40px label; at 430px it gets 109px and a 95px label.

Nothing left the bar:

1. **The voice icon keeps all four marks and gets bigger.** Most of its 50px
   was the space between person, arrow, bot and output rather than the marks
   themselves. Closing that and rendering the 41-unit box at 51px makes every
   mark a quarter larger and returns 7px.
2. **The carets go below `sm:`.** Twelve pixels per chip said "this opens a
   menu", which the controls already say by being tappable and by
   `aria-haspopup`. Boxholder's suggestion.
3. **The chat chip shows its sliders glyph below `sm:`** and the word "Chat"
   from `sm:` up, rather than the reverse. The `aria-label` names the chip in
   full at every width.
4. **The questions, plate, and error badges became segments of one pill**
   (`beebox/src/frontend/src/components/app-nav-badges.tsx`). Three capsules
   spent 52px on padding and gaps to carry 40px of content. Each segment is
   still its own control with its own destination and accessible name.
5. **HQ-in-flight is a pulse below `sm:`** instead of the word "transcribing…",
   which is worth about 70px at the width that has none. The accessible name
   says it at every width.

### Two things tried and rejected

A **reduced two-mark voice face** — person and bot dropped, arrow and speaker
redrawn — was built first and rejected by the boxholder: the redrawn arrows
were cruder than the originals, the mute mark did not read, and it had been
applied at desktop width where nothing was wrong. The lesson is in
`VoiceChip-icons.tsx`: shrink the spacing before the vocabulary.

**Putting the chat and voice chips in one pill** saved 17px but read as though
two menus had been combined. They keep their own capsules.

Evidence: exhibit `mobile-app-bar/mobile-app-bar-the-place-label-is-back`.

### Residual: 320px

At a 320px viewport with all seven controls the label still collapses. The
right-hand group is 289px and the row is 296px there. Closing that needs a
control to leave the bar at that width — a priority order among the seven —
which is a decision for the developer, not a defect in this fix. Nothing
overflows horizontally at any width tested (320, 375, 390, 430).

## Manual testing

On a phone, open a chat in a landmark with a long name, with pending questions
and on-plate todos so both counts show.

1. The place pill names where you are — a symbol and a readable, truncated
   label with a chevron, not a bare mark. Tapping it still opens the switch
   menu.
2. The voice icon is the drawing you know, larger. Check both answer states
   through the menu's Mute row — waves for aloud, written lines for in text —
   and both floor states through Narration mode.
3. The chat chip shows sliders rather than the word "Chat", neither chip shows
   a caret, and both still open their own menus.
4. The three counts read as one pill with dividers, and each segment still goes
   to its own destination.
