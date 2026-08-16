---
title: "Mobile: go modal, not split-pane — lean on voice + callouts when a document is open"
workstream: unknown
area: callback-box
filed-by: agent
discovered-in: main session — boxholder using chat + a document on a phone
labels: [soft-launch]
priority: important
---

The desktop chat/companion layout is side-by-side: transcript on one side, the
open document on the other. On mobile that doesn't fit —

> There's really not enough room to have any chat history with the document, so
> we should lean on voice and callouts and make it more modal than on desktop.

The fix isn't to shrink the desktop split; it's a **different interaction model
on mobile**: viewing a document and chatting are *modes*, not simultaneous panes,
and the feedback channel shifts from a transcript to **voice in / callouts out**.

**Scope: this is general mobile, not iOS.** The constraint is a narrow viewport,
so it applies equally to mobile web in a browser, the installed PWA, and the iOS
*and* Android native wrappers. The layout work lives in the web frontend
(`InteractiveChat` / the companion split) and benefits every mobile surface; the
iOS references below are just where some pieces (a native composer, native
transcription) happen to be implemented, not the scope of the problem. Build the
modal model in the responsive web layout first; the native shells inherit it.

## The model

- **Modal, not split.** On a phone, opening a card gives it the screen. The chat
  isn't a competing half-pane — it collapses to the minimum needed to keep
  talking to the agent. Switching back to the full transcript is a deliberate
  mode change, not an always-present column.
- **Voice-first input.** While reading/working a document you're not typing a
  transcript; you speak. Mobile should assume voice is the primary input in
  document mode — this is the web composer's mic / mobile Web Speech path, not an
  iOS-only capability (the iOS native transcription is one implementation of it).
- **Callouts as the feedback surface.** With the transcript hidden, the agent's
  responses surface as `{% callout %}` / ack-style signals near the composer — a
  glanceable "here's what I did / here's the answer," not a scrolling history you
  have no room for. The full transcript is one mode-switch away when you want it.

Net: document + composer + callouts, with voice as the default input — the
"expand the tab" idea from
[iOS new-tab / focus-a-card](../closed/bugs/2026-07-21-ios-no-new-tab-needs-back-or-overlay.md)
generalized into the mobile layout philosophy. That issue's expand-tab section is
the seed; this is its proper home.

## Why this is the right shape (not a compromise)

Two panes on a ~390px screen means both are too small to use. A modal model gives
the document real space *and* keeps the conversation alive through a narrow but
sufficient channel (voice + callouts). It also fits how phones are actually
used — one thing in focus at a time — where desktop rewards side-by-side.

## Design questions

- **What's the minimal chat surface in document mode?** Composer + a small
  callout/ack stack is the proposal. Confirm the minimal feedback set — does an
  in-flight agent turn show a spinner/streaming hint? Do pending questions surface
  as callouts here?
- **Mode switching.** How do you get from document-focus to full-transcript and
  back — a swipe, a handle, a tab? Must be obvious and cheap (this is the thing
  you do constantly).
- **Where callouts render** relative to the composer, and how many persist before
  they scroll/dismiss. They're the feedback loop, so their legibility is
  load-bearing.
- **Relationship to the companion pane / overlay.** On desktop the companion pane
  is the side column; on mobile "open a card" should enter this modal document
  mode instead. Reconcile with `ViewOverlay` (the dismissible sheet) — is
  document-mode the overlay expanded to full-screen-with-composer, or a distinct
  layout?
- **Voice reliability.** Leaning on voice raises the stakes on the whole mobile
  voice-input path — the web composer's mic and mobile Web Speech, and the native
  transcription where a wrapper provides it — all need to be solid for this model
  to work.
- **Detecting mobile vs desktop** cleanly so the two models diverge without a
  squeezed-desktop middle state.

## Constraints from recent work

- The composer must not eat the screen in this mode (the fixed grow-on-scroll
  bug, the native iOS composer).
- Interacts with the [chat history dropdown scoping](../closed/bugs/2026-07-22-chat-history-dropdown-not-landmark-scoped.md)
  and the whole mobile-nav surface.

Central to a credible mobile/soft-launch experience — the phone is where most
people will first try this.
