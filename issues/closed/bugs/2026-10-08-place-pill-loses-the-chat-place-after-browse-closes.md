---
title: "The place pill falls back to \"Chat\" after a Browse panel closes, and the folder button disappears"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — B-inventory and D-chemistry journey walks, 2026-10-08
resolution: implemented
---

Fixed 2026-10-08: the app bar now keeps its published places as an owner stack (`lib/place-stack.ts`), so a cleared Browse place gives the bar back the chat's place; covered by `place-stack.doctest.md` and checked in the browser (closing Browse leaves "Box" and the folder button).

After a Browse panel is opened and closed, the top-left pill reads "Where you
are: Chat" (the URL differs only by the removed `card` parameter), and the folder half (the "here" menu) is gone
until a reload. Both walks reproduced it in a live session:
[D-chemistry](../../../beebox/test/user-stories/journeys/D-chemistry/reports/2026-10-08.md) (row 32, shots 08 to 09;
a reload restored the pill in shot 20) and
[B-inventory second walk](../../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-08-2.md) (row 63:
open Browse from the here menu, open the briefing, close the panels). The
C-reconnecting walk saw the pill flip between "/" and "Chat"
([report](../../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-08.md), row 33).

## Mechanism

The app bar holds one published place
(`beebox/src/frontend/src/components/app-bar-chrome.tsx:103-111`).

1. The chat publishes its place with `useAppBarPlace`
   (`beebox/src/frontend/src/components/chat/everywhere/InteractiveChat/ChatBarChrome.tsx:106`).
2. A focused Browse card publishes its directory over it
   (`beebox/src/frontend/src/renderers/browse.tsx:54`).
3. When Browse unmounts, its cleanup clears the slot
   (`app-bar-chrome.tsx:148-161`, owner-scoped `clearPlace`).
4. The chat's effect does not run again, because its dependencies
   (`writers`, `dir`, `label`) did not change.
5. The bar falls back to the route place `{ label: "Chat", dir: null }`
   (`beebox/src/frontend/src/lib/place-label.ts:44`, `:98`). The folder half
   renders only with a landmark
   (`beebox/src/frontend/src/components/AppNav/PlacePill.tsx:211`).

## Fix direction

The slot needs a stack or a re-publish on release, so a cleared higher-priority
owner restores the previous owner's place. A change to the dependencies of
the chat's effect would patch this one pair of publishers only.

## Related

[Place pill repeats the box name at the root](2026-10-08-place-pill-repeats-box-name-at-root.md)
