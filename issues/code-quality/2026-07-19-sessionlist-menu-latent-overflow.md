---
title: "SessionListButton hand-rolls its dropdown — same latent mobile overflow the header menus had"
area: callback-box
filed-by: agent
discovered-in: worktree-mobile-chat-layout — while fixing the landmark/recent-files menu overflow
---

While fixing [the landmark menu overflow](../bugs/2026-07-19-landmark-menu-overflows-mobile.md)
and [recent-files](../bugs/2026-07-19-mobile-composer-grows-on-scroll.md)
I moved both onto the shared `Dropdown` primitive
(`components/ui/Dropdown.tsx`), which now clamps its portaled `fixed` menu into
the viewport (`left`/`right` into `[8px, vw-8px]`, `maxWidth`, `maxHeight` +
scroll).

`SessionListButton.tsx:72` still hand-rolls its menu:

```
absolute right-0 top-full mt-1 w-[28rem] max-w-[calc(100vw-1rem)] … max-h-96 overflow-y-auto
```

`max-w-[calc(100vw-1rem)]` caps the *width* but the menu is still anchored
`right-0` to the button. The session button isn't the rightmost header control
(new-session + debug sit to its right), so on a narrow phone its right edge is
well inside the viewport and a 28rem/`100vw-1rem` menu's left edge lands
off-screen — the exact position bug the landmark menu had (a width cap can't fix
it; the anchor is wrong).

Not confirmed in a browser (the session list needs multiple sessions to be worth
opening), so it's filed as latent rather than a live bug. The fix is the same
one-liner of intent: migrate it onto `<Dropdown>` (align `right`, `width`
`w-[28rem]`) and delete the hand-rolled backdrop + absolute menu, same as
`LandmarkLinksButton`/`RecentFilesButton` now do.
</content>
