---
title: "bbx browser screenshot --card finds no card when the page was opened with view parameters"
workstream: box-feedback-bugs
area: beebox
labels: [agent, views, screenshots]
filed-by: agent
discovered-by: agent
discovered-in: "courseware box feedback — Browser_View_Query_Path, 2026-11-09"
resolution: implemented
---

**Closed (implemented, 2026-11-09):** cardPathFromUrl reads the card path before the first ? of the chat card value (box-feedback-bugs).

A box agent ran `bbx browser open /views/_content/chem/Periodic_Table.chem.card?select=O`.
The open succeeded and the app redirected to
`/<slug>/chat?card=<encoded "Periodic_Table.chem.card?select=O">`. Then
`bbx browser screenshot --card` failed with "no open card was found". The
same card without `?select=O` captured correctly.

## Mechanism

The `card` search parameter holds a serialized view URL: the card path plus
its view parameters (`serializeViewUrl`,
`beebox/src/frontend/src/lib/system-card-navigation.ts:62`). The redirect is
correct.

`cardPathFromUrl` (`beebox/src/core/browser/card-shot/run.ts:45-62`) takes
the `card` value as the card path without parsing it. The capture then looks
for the panel `cardPanelId("…Periodic_Table.chem.card?select=O")`. The app
names the panel from `tab.target.path` only
(`beebox/src/frontend/src/components/chat/workspace/WorkspaceCanvas/view.tsx:60`),
so no element matches.

## Expected

`cardPathFromUrl` strips the view parameters (parse the value as a view URL
and use its path). An agent can then capture a view in a named state, which
is the normal way to test a view at more than its default parameters.

Related: [the self-view work that added `screenshot --card`](../features/2026-10-29-box-agent-cannot-see-its-own-visual-work.md).
