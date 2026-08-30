---
title: "SessionListButton hand-rolls its dropdown — same latent mobile overflow the header menus had"
workstream: mobile-chat-layout
area: beebox
filed-by: agent
discovered-in: worktree-mobile-chat-layout — while fixing the landmark/recent-files menu overflow
resolution: implemented
---

Resolved by commit landing `SessionListButton` on the shared `Dropdown`
primitive (worktree-mobile-chat-layout). Browser-confirmed at 390px: the menu
now measures `left=8 right=382` (fully on-screen) instead of clipping off the
left. No manual-testing gate — it's a positioning dedup verified headless.

---

While fixing [the landmark menu overflow](../bugs/2026-07-19-landmark-menu-overflows-mobile.md)
and [recent-files](../bugs/2026-07-19-mobile-composer-grows-on-scroll.md)
I moved both onto the shared `Dropdown` primitive
(`components/ui/Dropdown.tsx`), which now clamps its portaled `fixed` menu into
the viewport (`left`/`right` into `[8px, vw-8px]`, `maxWidth`, `maxHeight` +
scroll).

`SessionListButton.tsx:72` still hand-rolled its menu:

```
absolute right-0 top-full mt-1 w-[28rem] max-w-[calc(100vw-1rem)] … max-h-96 overflow-y-auto
```

`max-w-[calc(100vw-1rem)]` capped the *width* but the menu was still anchored
`right-0` to the button. The session button isn't the rightmost header control
(new-session + debug sit to its right), so on a narrow phone its right edge is
well inside the viewport and a 28rem/`100vw-1rem` menu's left edge landed
off-screen — the exact position bug the landmark menu had (a width cap can't fix
it; the anchor is wrong).

The fix was the same as `LandmarkLinksButton`/`RecentFilesButton`: migrate it
onto `<Dropdown>` (align `right`, `width` `w-[28rem]`) and delete the hand-rolled
outside-click handler + absolute menu. Session fetch moved into the menu body
(mounts on open), keeping the lazy-load behavior.
