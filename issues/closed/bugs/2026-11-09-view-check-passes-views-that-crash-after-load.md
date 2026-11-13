---
title: "bbx view check passes views that crash after their data loads or with a real card path"
workstream: box-feedback-bugs
area: beebox
labels: [views, agent]
filed-by: agent
discovered-by: agent
discovered-in: "courseware box feedback — View_Check_Misses_Async_Data, 2026-11-09"
resolution: implemented
---

**Closed (implemented, 2026-11-09):** bbx view check renders card-type views with a sample card and renders every state again with effects run and readFile answered from the box (beebox/docs/plans/view-check-settled-render.md, box-feedback-bugs). Declared test states are proposed in issues/features/2026-11-09-views-declare-named-check-states.md.

A box agent wrote a view that loads its data with `readFile` in a
`useEffect` and shows a loading state until then. `bbx view check` printed
`✓ <view>` after each edit. The agent told the boxholder the view worked.
When the boxholder opened it, it crashed with a `ReferenceError` (a `const`
used before its declaration) in code that runs only after the data loads.

## Two blind spots

1. The check renders one frame. It does not run effects or wait for async
   data (`beebox/src/cli/commands/view/command.ts:20`). A view that loads data
   renders only its loading state. `views.md` documents this, but the bare
   `✓` reads as "this view renders".
2. The check renders with no `params.path` (`command.ts:266-269`, "a tracked
   follow-up" in the agent-applied migrations plan, Open q4; no issue
   exists). A card-type view renders its "card not found" branch and passes.
   The agent confirmed this: a planted throw in each of three widget
   components still passed the check.

Async loading is the normal shape for a view that reads anything beyond its
`cards`. So for many views the check gives false confidence.

## Directions

- Flush effects and pending promises, with `readFile` resolved from the real
  box, then render again before a pass.
- Or mark the output: "rendered a loading state only; effects not run".
- Sample a real card for each card type the view renders.
- Let a view declare named test states (card path, params, perhaps mocked
  data). The check renders each one and reports per state. The boxholder
  compared this to a small Storybook. The same list could drive
  `bbx browser screenshot --card` captures, a gallery, and chat links that set
  a view's state ([chat links that set view state](../../features/2026-11-09-chat-links-that-set-an-open-views-state.md)).

The agent's workaround in the box: a JSON import instead of `readFile`, and
render every card when no path is given.
