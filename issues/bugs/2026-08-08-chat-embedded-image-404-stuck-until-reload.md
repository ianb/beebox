---
title: "Chat-embedded image that doesn't exist yet stays 404 until a full page reload"
area: callback-box
filed-by: agent
discovered-in: main session — boxholder report
---

When the agent embeds an image in chat, the `<img>` sometimes renders **before the
file exists** (the agent hasn't written it yet), so it 404s. It then stays broken
**until the page is reloaded** — it never re-checks on its own, even after the file
lands seconds later.

## Root cause

`callback-box/src/frontend/src/components/ui/Image.tsx` keeps a **module-level
`failedImageUrls` set**. On an image error, `handleError` (line 256-259) adds the
URL to that set and re-renders to the `ErrorPlaceholder` (line 283-284). Because
the set is module-global and never cleared, the URL is **permanently blocklisted**
for the life of the page — so once an image 404s, nothing short of a full reload
(which resets the module) will retry it. That's exactly the "stuck until I reload"
symptom, and it's worst for chat-embedded images the agent is still in the middle
of producing.

## Fix direction

When an image is missing, **re-check it later** instead of giving up permanently.
Two approaches the boxholder suggested, either or both:

- **Bounded retry timer** — on error, retry loading after a short delay with a
  limited number of attempts (e.g. a few retries over ~15-30s, cache-busting the
  src so the browser re-requests), then fall back to the placeholder. A genuinely
  missing image simply exhausts its retries and shows the placeholder as today —
  so this degrades safely.
- **Retry when the agent turn finishes** — the most targeted trigger for the
  chat case: when the chat turn completes (the file is now written), clear the
  failed mark for in-view images and re-attempt. The turn-finished signal is in
  the chat machine (`chatMachine.ts`, streaming → idle / turn-complete).

Key change either way: **stop permanently blocklisting a failed URL** in
`failedImageUrls` — make the failure retryable (bounded), not terminal. Consider
scoping the retry to the chat-embedded case (or keep it general but strictly
bounded so a page full of truly-broken images can't thrash the network).

Chat images render through
`callback-box/src/frontend/src/components/chat/markdown-rendering.tsx` into the
shared `ui/Image.tsx`, so the fix likely lives in `ui/Image.tsx` (with an opt-in
prop if the retry should be chat-only).
