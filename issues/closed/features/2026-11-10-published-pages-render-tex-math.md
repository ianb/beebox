---
title: "Published pages show TeX math as source"
workstream: chat-math-rendering
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-chat-math-rendering, 2026-11-10
priority: backlog
resolution: implemented
---

**Closed (implemented, 2026-11-10):** Commits 40fe91101 and ff01684e4: published Markdown pages render TeX as MathML via KaTeX at publish time; no divergence.

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
