---
title: "Chat-embedded image that doesn't exist yet stays 404 until a full page reload"
workstream: unknown
area: beebox
filed-by: agent
discovered-in: main session — boxholder report
---

> **Reopened 2026-09-07 — regressed.** The bounded retry `e209e50a` added was
> removed by `7e68eadd5` ("Remove timed image retries", the chat-scroll
> workstream, 2026-09-06), which kept only the `file-change` refresh
> (`lib/file-version.ts`: a change event busts the URL). That refresh cannot
> fire where the box file watcher has hit its 1,024-directory ceiling — the
> reported box has 5,948 directories, 5,564 of them `.attach` scopes — so an
> image the agent posts before the file exists 404s once, lands in
> `failedImageUrls`, and stays the placeholder until a reload
> (`2026-09-07-box-watcher-ceiling-leaves-attach-scopes-unwatched.md`). The
> fix this time re-checks the file's existence on a bounded schedule and only
> swaps the image in once it is there — one reflow, when real — rather than
> re-loading the `<img>` on a timer.

Closed by `e209e50a` (`Retry chat images that appear after rendering`). Chat-embedded
in-box images now retry on a bounded leaf-local backoff, while external proxy
fallbacks retain their existing behavior.

When the agent embeds an image in chat, the `<img>` sometimes renders **before the
file exists** (the agent hasn't written it yet), so it 404s. It then stays broken
**until the page is reloaded** — it never re-checks on its own, even after the file
lands seconds later.

## Root cause

`beebox/src/frontend/src/components/ui/Image.tsx` keeps a **module-level
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
`beebox/src/frontend/src/components/chat/markdown-rendering.tsx` into the
shared `ui/Image.tsx`, so the fix likely lives in `ui/Image.tsx` (with an opt-in
prop if the retry should be chat-only).
