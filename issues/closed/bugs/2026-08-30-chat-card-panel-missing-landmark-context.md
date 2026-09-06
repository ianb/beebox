---
title: "A card opened beside chat loses the current landmark context"
workstream: landmark-in-browse
area: beebox
labels: [chat, navigation, ui, landmarks]
filed-by: agent
discovered-by: Ian
discovered-in: "worktree-landmark-in-browse — while confirming landmark context in Browse"
priority: normal
resolution: wontfix
---

> Closed wontfix 2026-09-05. The first implementation was reverted
> (27a29f790). A second attempt was mocked up in the sidecar-shell
> workstream as three compact shapes, each limited to the card's own
> directory landmark with no root fallback. The boxholder decided the
> sidecar does not need landmark context at all. Do not rebuild this
> without a new ask. The companion-context direction it was tied to
> stays live in
> [todos-inline-things-to-think-about](../../features/2026-08-30-todos-inline-things-to-think-about.md).

> Reopened 2026-08-30: the first implementation (d088cd77d, reverted in
> 27a29f79) rendered the resolved landmark's FULL header + links above the
> card — and for a card in an un-landmarked dir that resolved to the ROOT
> landmark, so the panel led with the box's whole link set and buried the
> card (boxholder: "went nuts and put stuff in the card sidecar"). Lessons
> for the next attempt: only the card's OWN dir's landmark (no root
> fallback), compact (a one-line context strip, not the header), and design
> it WITH the companion-view direction in
> 2026-08-30-todos-inline-things-to-think-about — one panel, not bolt-ons.

Resolved by `d088cd77d`. A landmark-bound chat now shows a compact landmark
header above its companion card. Desktop includes the landmark's curated links.
Stacked layouts keep only the landmark identity so the card remains visible.

When a card is open in the companion panel beside a chat, the panel shows the
card but not the current landmark context. The boxholder expected the same
landmark orientation that is now available for a landmarked directory in
Browse.

This is separate from the
[Browse directory fix](2026-08-30-root-landmark-view-missing-in-browse.md).
Determine whether the chat card panel should show a compact landmark header,
expose the landmark's links, or provide a smaller orientation affordance that
fits the panel hierarchy.
