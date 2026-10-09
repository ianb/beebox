---
title: "A YouTube link or an audio file should become a transcribed source card"
workstream: unattached
area: beebox
labels: [ingestion, competitive-research]
filed-by: agent
discovered-by: agent
discovered-in: worktree-notebooklm-research — comparing Gemini Notebook's source types with the box's intake paths
---

A YouTube link in a box is embedded for display only (`beebox/src/lib/video-url.ts`);
there is no transcript, so the agent cannot search it or cite it. An audio
file reaches the box only as a capture clip or a chat attachment that is
swept after seven days; there is no "add this recording as a source" path,
though `bbx chat retranscribe` and the pre-action in
`beebox/src/core/preactions/transcribe.ts` can transcribe a file placed next
to a memo.

For a household these are ordinary sources: a recipe video, a recorded
lecture, a voice message from a relative. Gemini Notebook accepts both
(YouTube needs captions or speech; audio needs speech) and the September
2026 mobile recorder files recordings beside the sources
([research](../../research/notebooklm/product.md#sources)).

Shape: a `webpage`-like card for a video (title, channel, `sources:
[{href, retrieved}]`, transcript as the body, so search and `{% source %}`
work) and the existing `audio` card for a dropped file, filled by the same
transcription pass captures use. The clerk extension and the iOS share sheet
are the natural entry points. Caption fetching for YouTube is the part that
needs a decision: a captions scrape is fragile; the box's own transcription
over downloaded audio is heavier but under the box's control.

Related: [server-side webpage capture](2026-09-11-server-side-webpage-capture.md),
[fetch blocked pages](2026-10-04-fetch-blocked-pages.md).
