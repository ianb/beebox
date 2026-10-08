---
title: "A landmark card shows its configuration, not the places it lists"
workstream: unattached
area: beebox
labels: [navigation]
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — A-lending and B-inventory journey walks, 2026-10-08
---

Opening a landmark card ("Lending", "Inventory") shows its frontmatter
(`query: *.loan.card`, `navigation: label: Inventory`) and the line "No body
content". The items the landmark expands to are not on the page. Three walks
reached this page from a menu row or a chat link and each time found it empty:
[A-lending](../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-08.md) (rows 29, 33, 58),
[B-inventory](../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-08.md) (row 26) and
[B-inventory, second walk](../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-08-2.md) (row 39).
The B-inventory walker called it "the biggest gap so far".

## Mechanism

- No landmark renderer exists. A `.landmark.card` falls to the generic
  `MarkdownCardView` (`beebox/src/frontend/src/renderers/markdown-card.tsx:11-14`).
- The landmark type has no body field, so its fields go on the card front
  (`beebox/src/frontend/src/lib/card-field-faces.ts:50-56`), and
  `beebox/src/frontend/src/components/MarkdownCardView/CardBody.tsx:120-121`
  prints "No body content".
- The resolved `expand` links appear only in the Browse header and the
  folder pill menu.

In the A-lending walk the agent then said the landmark was "a Lending page
… each item has its own entry". The card did not show that.

## Not obvious

The card could render its resolved links as a list. That makes the landmark
card a collection view, which
[Collection views are badly defined](../features/2026-08-19-collection-views-are-badly-defined.md)
leaves open. In the A-lending walk the agent built a card type and a view to
get that page.

## Related

[Nested landmark row opens the landmark file](../closed/bugs/2026-10-08-nested-landmark-row-opens-the-landmark-file.md)
(the menu row that leads to this page).

2026-10-08: the place menu's nested landmark row now opens the nested place's
`entry-point` card when it has one. A nested landmark without an entry point
still opens this page.
