---
title: "Attach a visual crop while sharing selections"
workstream: unattached
area: beebox
labels: [chat, selections, screenshots, ui]
filed-by: agent
discovered-by: Ian
discovered-in: "worktree-point-to-comment — boxholder discussion, 2026-11-06"
---

When a person selects part of a card or chat to discuss, the quoted text and
source locator do not always show the agent what the person saw. This matters
for images, charts, layout, and other visual content. The person should be able
to attach that visual context to the same chat selection.

Explore an explicit sharing mode linked to the existing Select control. The
person would grant current-tab capture once for the mode. While the stream is
active, a selection could attach a crop of the visible target alongside the
existing quote and source. Ending the mode would stop the stream. The sharing
indicator and an obvious stop control should make the active capture clear.

The current screenshot path in
`beebox/src/frontend/src/components/chat/screenshot-capture.ts` already uses
`getDisplayMedia` to take one still and then stops every track. This proposal
would keep a stream open across selections. It is a separate choice from
ordinary Select mode, which should remain quick and work without capture
permission.

## Questions

- Should visual sharing be an option within Select mode or a separate mode?
- When should a crop be taken so it shows the target as the person saw it,
  without the selection outline or controls obscuring it?
- How should the crop and source locator travel together in the chat draft and
  in the agent's message?
- What should happen when tab capture is unavailable or the stream ends while
  the person is selecting, especially on mobile?

Related: [point-to-comment](2026-11-01-point-to-comment.md) owns the current
selection-to-chat flow. [Agent self-view](2026-10-29-box-agent-cannot-see-its-own-visual-work.md)
concerns the agent viewing its own work without relying on the person's live
viewport; this issue concerns what the person explicitly chooses to share.
