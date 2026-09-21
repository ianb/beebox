---
title: "Mobile app bar crowds the place label when count badges are visible"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-chip-icon-design — verifying the revised chat properties chip
---

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
