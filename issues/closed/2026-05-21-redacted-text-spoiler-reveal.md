---
area: callback-box
resolution: implemented
---

# Redacted text (Threads-style spoiler/reveal)

**Closed:** Implemented as the `{% redacted %}…{% /redacted %}` Markdoc tag (`src/shared/markdoc-config.ts`, rendered by `src/frontend/src/components/Redacted.tsx`). Parser test: `test/shared/markdoc-redacted.doctest.md`.

Implemented as the `{% redacted %}…{% /redacted %}` Markdoc tag (see
`src/shared/markdoc-config.ts`, rendered by `src/frontend/src/components/Redacted.tsx`).
Inline/block split mirrors `quote` / `source`. Rendering: blurred text behind an
animated SVG-turbulence noise overlay (Threads-style fuzz), click/tap or Enter/Space
to reveal. Stays blurred under SSR / no-JS — safe for print. Agent-authored only.
Parser test: `test/shared/markdoc-redacted.doctest.md`.
