---
title: "Pin a tab in the sidecar — keep a document open while other opens come and go"
workstream: unattached
area: beebox
labels: [ui, chat]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder ask
---

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
  [sticky-hq-transcription-preference](2026-08-26-sticky-hq-transcription-preference.md)
  for the precedent question).
- Interaction with the overflow-scroll fix
  ([new-tab-not-scrolled-into-view](../bugs/2026-08-29-new-tab-not-scrolled-into-view.md)):
  a pinned tab is excluded from the scroll-into-view churn; design the two
  together if the same session takes both.
- Whatever tab-limit/eviction logic exists must never evict a pinned tab.
