---
title: "\"Show everything\" Markdown mode"
area: callback-box
---

A debug toggle on the shared `<Markdown>` component could reveal normally-hidden structure in rendered documents — HTML comments (`<!-- ... -->`) shown as styled inline text, metadata markers, processing annotations. Implementation-wise this would be a custom Markdoc node override (or a `debug`/`showComments` prop threaded into the Markdoc config) that renders comment nodes as visible spans instead of dropping them. Earlier the codebase had a `showComments` prop on `<Markdown>` backed by a custom `remark-comments` plugin; that came out with the Markdoc migration but the idea still applies — it just needs a Markdoc-shaped reimplementation.

For card-based documents this matters less (cards have explicit schemas), but for generated Markdown (briefs, summaries, agent output), comments are a natural place for agents to leave structured annotations — source attribution, confidence notes, revision markers — that are invisible by default but available on demand. The toggle could live in a debug/detail panel or as a per-view option.
