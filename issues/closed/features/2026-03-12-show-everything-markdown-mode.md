---
title: "\"Show everything\" Markdown mode"
workstream: unknown
area: callback-box
resolution: wontfix
---

**Closed (2026-07-15): wontfix.** The need — revealing normally-hidden structure
(HTML comments, markers) in a rendered doc — is already met by the plain-text /
Source view, which shows the raw markdown verbatim, comments and all. A separate
"show everything" render mode on `<Markdown>` would duplicate that for marginal
gain. The agent-annotations-in-comments angle is speculative and unbuilt; if
structured agent annotations become a real need, they'd want an explicit
representation (a tag or field), not hidden HTML comments surfaced by a toggle.

A debug toggle on the shared `<Markdown>` component could reveal normally-hidden structure in rendered documents — HTML comments (`<!-- ... -->`) shown as styled inline text, metadata markers, processing annotations. Implementation-wise this would be a custom Markdoc node override (or a `debug`/`showComments` prop threaded into the Markdoc config) that renders comment nodes as visible spans instead of dropping them. Earlier the codebase had a `showComments` prop on `<Markdown>` backed by a custom `remark-comments` plugin; that came out with the Markdoc migration but the idea still applies — it just needs a Markdoc-shaped reimplementation.

For card-based documents this matters less (cards have explicit schemas), but for generated Markdown (briefs, summaries, agent output), comments are a natural place for agents to leave structured annotations — source attribution, confidence notes, revision markers — that are invisible by default but available on demand. The toggle could live in a debug/detail panel or as a per-view option.
