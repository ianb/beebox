---
title: "Landmark menu: show a search field when the box has more than 20 landmarks"
workstream: landmark-menu-search
resolution: implemented
area: beebox
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder request
---

Implemented in `ceaefa66e` by adding case-insensitive substring search to the
landmark switch menu when it has more than 20 landmarks, with keyboard handling
and an empty-result message.

The landmark menu (the place pill's "Switch to" list,
`beebox/src/frontend/src/components/AppNav/PlacePill-panels.tsx`,
`LandmarkRows`) lists every landmark. On a box with many landmarks the list
is long and the one you want is hard to find.

## Wanted

- When the menu has more than 20 landmarks, show a search field above the
  list. At 20 or fewer, no field.
- The search is simple: a case-insensitive substring ("contains") match. It
  matches the row's visible text (`SwitchLandmark.label`) and the landmark's
  directory (`dir`), so a typed path segment also finds it. No fuzzy matching
  and no ranking: keep the list's current order and hide rows that do not
  match.
- Keyboard: the field takes focus when the menu opens with the search
  showing, and arrow keys and Enter still select a row. Escape clears the
  text, then closes the menu.
- An empty result shows a short "No landmarks match" line.

Related: [landmark list sort modes](../../features/2026-08-06-landmark-list-sort-modes-used-name-tree.md)
changes the order of the same list.
