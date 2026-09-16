---
title: "Mobile app bar crowds the place label when count badges are visible"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-chip-icon-design — verifying the revised chat properties chip
---

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
