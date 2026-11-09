---
title: "A view could declare named states for bbx view check, screenshots, and chat links"
workstream: unattached
area: beebox
labels: [views, agent]
filed-by: agent
discovered-by: agent
discovered-in: "courseware box feedback — View_Check_Misses_Async_Data, 2026-11-09"
---

`bbx view check` now renders each view with no card and with one card of each
type it renders, and runs effects with real box data
([plan](../../beebox/docs/plans/view-check-settled-render.md)). It cannot reach
a state that needs particular parameters (a selection such as
`?select=O`) or data the box does not have.

The boxholder compared the idea to a small Storybook: a view declares named
states, and the check renders each one and reports per name.

## Proposal (needs a decision)

An optional named export in the view module, read by the metadata import as
`rendersCardTypes` is:

```tsx
export const checkStates = [
  { name: "oxygen", path: "_content/chem/Periodic_Table.chem.card", params: { select: "O" } },
];
```

- `bbx view check` renders each declared state as well as its own samples,
  and names the state in a failure.
- `bbx browser screenshot --card --state <name>` opens the view in that
  state.
- [Chat links that set a view's state](2026-11-09-chat-links-that-set-an-open-views-state.md)
  could name one.

Mocked data (a fake `readFile` answer, a fake adapter response) stays out
until a view needs it; it is the expensive part.

Questions: the export name; whether a state can set `viewState` as well as
`params`; whether a declared state replaces the automatic card sample.
