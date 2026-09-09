---
title: "Pin a tab in the sidecar — keep a document open while other opens come and go"
workstream: sidecar-shell
area: beebox
labels: [ui, chat]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder ask
priority: normal
resolution: implemented
---

Resolved by `9f8f81d09` (feat(sidecar): pin a tab, keep the strip across a
reload, cap the rest) plus `3ca79e897` (feat(sidecar): pinned tabs are
compact) and review follow-ups in `88033b967`, part of the `sidecar-shell`
plan. `components/chat/sidecar-tabs.ts` (pure reducer) +
`sidecar-tabs-storage.ts` (sessionStorage, per box + per chat session) back a
rewritten `useChatTabs`, with pin UI and a 12-tab cap on unpinned tabs (the
boxholder chose 12). No divergence from what the issue proposed.

The sidecar's tabs (the card/document panel beside chat) are all equal:
every open document competes for the strip, old tabs get pushed out or
closed, and there's no way to say "keep this one." The ask: **pin a tab** —
a pinned document stays put (survives other opens, doesn't scroll away,
maybe compact like pinned browser tabs) while unpinned tabs behave as today.

Design smalls, none hard:

- Affordance: pin from the tab's context/close area; pinned tabs sort first
  and show an indicator (compact width like browser pins is the familiar
  pattern).
- Persistence: per-session in the chat's client state at minimum; whether a
  pin survives reload rides the same per-viewer-preference story as sticky
  HQ (localStorage vs chat feature state — see
  [sticky-hq-transcription-preference](../../features/2026-08-26-sticky-hq-transcription-preference.md)
  for the precedent question).
- Interaction with the overflow-scroll fix
  ([new-tab-not-scrolled-into-view](../bugs/2026-08-29-new-tab-not-scrolled-into-view.md)):
  a pinned tab is excluded from the scroll-into-view churn; design the two
  together if the same session takes both.
- Whatever tab-limit/eviction logic exists must never evict a pinned tab.
