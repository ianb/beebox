---
title: "The plate badge opens Browse beside the plate and pushes the chat off screen"
workstream: unattached
area: beebox
labels: [navigation]
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — A-lending, C-reconnecting and F-newcomer journey walks, 2026-10-08
---

One click on the count badge in the top bar opened The Plate in the right pane
and a Browse tab in the left pane. The chat then had no pane and the top bar
changed. The A-lending walker lost the chat with its two panels. All three
walks saw it: [A-lending](../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-08.md) (rows 24, 31,
53), [C-reconnecting](../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-08.md) (row 26,
reproduced) and [F-newcomer](../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-08.md) (row 27,
tabs "Household jobs", "Browse", "The Plate", no chat).

## Mechanism

- The badge links to the legacy route `/browse/_content/plate.todo-view.card`
  (`beebox/src/frontend/src/components/AppNav/app-nav-badges.tsx:92`).
- That route builds a Browse card for `_content` with the plate as its detail
  (`beebox/src/frontend/src/lib/browse-card-state.ts:77-89`).
- The handoff opens the plate with `destinationPane: "right"`
  (`beebox/src/frontend/src/components/chat/workspace/WorkspaceProvider/provider.tsx:53-61`).
- When both panes show cards, the chat has no pane
  (`beebox/src/frontend/src/components/chat/workspace/state-model.ts:226-248`).

A link from chat opens opposite the chat (`state-model.ts:196-208`), but
Browse handoffs force the right pane. The person cannot predict "replace" or
"beside" from the click.

## Not obvious

The person wanted the plate. The Browse tab is a by-product of the route. The
badge could open the plate card directly, without Browse. How a card opens
beside or replaces the chat is a policy question in
[Decide whether card previews replace a transient tab or accumulate](../decisions/2026-09-08-sidecar-preview-replacement-policy.md).
The badge tooltip itself is fine
([bare-number badge](../closed/bugs/2026-08-25-plate-badge-is-a-bare-number.md),
closed).
