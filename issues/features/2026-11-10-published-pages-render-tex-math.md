---
title: "Published pages show TeX math as source"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-chat-math-rendering, 2026-11-10
priority: backlog
---

Chat and card bodies in the app render `$…$` and `$$…$$` TeX with KaTeX
(`beebox/docs/implemented-plans/chat-math-rendering.md`). A published page renders its
Markdown through the plain shared parser
(`beebox/src/publish/prepare/core/markdown-page.ts` →
`@shared/markdoc-config/parse/core` `parseMarkdown`, `math: false`), so a
formula in a published card shows its dollar-delimited source.
`beebox/docs/box/markdown.md` ("Math") tells agents this.

Rendering math there would mean server-side `katex.renderToString` in the
publish renderer and shipping KaTeX's CSS and fonts in the published bundle,
only for pages that contain math. No one has asked for it yet; pick it up
when a published page needs a formula.
