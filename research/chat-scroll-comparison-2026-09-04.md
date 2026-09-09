# Chat scroll comparison — 2026-09-04

Investigation for `chat-scroll-fixes`, alongside the
[local reproduction protocol](../beebox/docs/chat-scroll-testing.md).
This is a source review, not hands-on verification of either product.

## OpenClaw

Its Control UI uses Lit and Vite, not React. Its
[scroll policy](https://github.com/openclaw/openclaw/blob/main/ui/src/pages/chat/scroll.ts)
keeps per-pane/session scroll state, distinguishes manual movement from
incidental render/resize follow, and locks follow after the reader takes over.
The source uses an 8px end threshold and a separate 450px near-bottom threshold.
Those values describe its product policy; they are not evidence that Bee Box
should copy the thresholds.

The [composer DOM owner](https://github.com/openclaw/openclaw/blob/main/ui/src/pages/chat/components/chat-composer-dom.ts)
measures textarea height, caps it at CSS max-height (150px fallback), and lets
the textarea scroll after the cap. It captures whether the transcript was
end-anchored before resizing and restores its end only in that case.
[Pane rendering](https://github.com/openclaw/openclaw/blob/main/ui/src/pages/chat/chat-pane-render.ts)
routes assistant attachment load through the same scroll scheduling policy.
[State coordination](https://github.com/openclaw/openclaw/blob/main/ui/src/pages/chat/chat-state-controller.ts)
waits for Lit's commit and then an animation frame before scroll work.

## Conductor

Public changelogs establish behavior and past defects, not an inspectable
scroll implementation. They describe
[persistent chat scroll position](https://www.conductor.build/changelog/0.49.0-conductor-allegro-gpt-5-5),
[scroll-to-bottom and autoscroll fixes](https://www.conductor.build/changelog/0.24.0-improved-codex-quick-start),
and [unwanted jumps while reading earlier messages](https://www.conductor.build/changelog/0.34.2-chat-summaries-re-run-actions-latex).
Its [attachment announcement](https://www.conductor.build/changelog/0.0.20-attachments)
documents paste, drag/drop, and a paperclip control. Public material reviewed
does not establish how lazy image completion is reconciled with reading
position. No overall desktop stack or scroll ownership claim is inferred from
mentions of a React profiler or virtualization library.

## Disposition for Bee Box

- **Adapt:** explicit precedence for a manual send over incidental layout work.
  Bee Box's native and desktop traces show `hold-anchor` cancelling the send
  ease and undoing its first movement. The current controller's viewport-relative
  ruler cannot distinguish that movement from content reflow before the scroll
  event updates its snapshot.
- **Investigate:** resize policy should distinguish staying at the end from
  holding text being read. Bee Box currently preserves distance from the bottom
  for every viewport resize; in a simulator observation, opening the keyboard
  while 160px from the bottom moved scrollTop by 301px. That is expected under
  the implementation, but needs evaluation against the reading experience.
- **Adapt:** make image completion an explicit measured input. The protocol
  now includes real load/error events and delayed/lazy image cases; arbitrary
  message-height changes alone cannot validate the browser's image lifecycle.
- **Reject for this investigation:** copying OpenClaw's follow thresholds,
  switching frameworks, or reintroducing virtualization. Its follow-at-end
  behavior differs from Bee Box's accepted stream-below-reader policy, and
  neither source review establishes a need to replace React.
- **Later:** hands-on Conductor comparison if product behavior remains unclear.
  Marketing and changelogs cannot verify whether its implementation handles
  Bee Box's native composer and WKWebView resize boundaries.

These findings are pursued in the existing
[scroll regression issue](../issues/bugs/2026-09-04-chat-scroll-still-bad-after-rewrite.md);
they do not close it or authorize a new scrolling model by themselves.
