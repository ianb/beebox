---
title: "Choosing a landmark in the place menu opens an empty chat, not the place"
workstream: journey-walks-oct
resolution: implemented
area: beebox
labels: [navigation]
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — A-lending and D-chemistry journey walks, 2026-10-08
---

**Closed (implemented):** resolved by the landmark-arrival work on branch worktree-journey-walks-oct (plan: beebox/docs/implemented-plans/landmark-arrival.md), landed with the merge of that branch to main. Delivered as planned.

In the A-lending walk the person had built a "Lending" landmark with a list
page. They chose "Lending" in the top-left place menu and got a blank "Start a
conversation." screen. The list was not shown. The panels they had open
earlier were gone. The D-chemistry walk saw the same: "the left panels were
gone in the new chat". Reports:
[A-lending](../../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-08.md) (row 63),
[D-chemistry](../../../beebox/test/user-stories/journeys/D-chemistry/reports/2026-10-08.md) (row 71).

## Mechanism

- `beebox/src/frontend/src/components/AppNav/PlacePill.tsx:207` passes the
  chosen directory to `openLandmarkChat`.
- `beebox/src/frontend/src/hooks/useOpenLandmarkChat.ts:31-53` selects the
  landmark's conversation and navigates to `/chat`. It never opens the
  landmark's entry-point card.
- `beebox/src/frontend/src/components/chat/everywhere/resolve-conversation.ts:94-97`
  starts a fresh chat when the landmark has no session.
- Card panels are stored per conversation
  (`beebox/src/frontend/src/components/chat/workspace/WorkspaceProvider/workspace-browser-store.ts:114`),
  so a fresh chat has no panels.

The menu says "Switch to", so the person expects to arrive at the place. They
arrive at a chat scoped to it.

## Not obvious

Two readings exist. The menu could open the landmark's page (its
`entry-point` card). Or the menu could keep opening the chat and the chat
could show the landmark's page as its first panel. The first reading changes
what "place" means in the pill. Decide before fixing.

## Related

- [Landmarks can restore a pinned baseline of cards](../../features/2026-09-08-landmark-scoped-pinned-card-baseline.md)
- [Chats bind to a landmark once and never move](../../bugs/2026-08-25-chats-bind-to-a-landmark-once-and-never-move.md)
- [Stuck in one landmark](2026-08-20-cannot-switch-landmarks-from-chat.md) (closed; the switch itself works)
- [Landmark card shows its config, not its places](2026-10-08-landmark-card-shows-its-config-not-its-places.md)
