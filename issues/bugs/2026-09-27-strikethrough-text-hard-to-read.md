---
title: "The default strikethrough style makes struck text hard to read"
workstream: unattached
area: beebox
labels: [frontend, readability]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder discussion, 2026-09-27
priority: normal
---

The developer finds struck-through text hard to read. Struck text is still
meant to be read: a done or dropped todo, or `~~text~~` in markdown.

Where the style comes from:

- **Todos.** Done and dropped todos use `text-warm-400 line-through`
  (`beebox/src/frontend/src/components/todo/todo-item-logic.ts:21-23`).
  The line goes through light text, so both the contrast and the glyph
  shapes suffer.
- **Markdown `~~text~~`.** No project style. It renders with the browser's
  default `line-through` inside the typography plugin's `prose` styles.
- **Broken links.** `line-through decoration-dotted`
  (`components/ui/BrokenLink.tsx:17`). This is a different signal and may
  keep its own style.

Choose one default for struck text that stays readable: for example a
thinner line in a lighter color than the text (`text-decoration-color`,
`text-decoration-thickness`), with the text itself kept at readable
contrast. Apply it to todos and markdown alike. Check both light and dark
themes, and the card themes (`src/frontend/src/themes/`). The
[contrast audit](../code-quality/2026-05-28-color-contrast-wcag-aa-audit.md)
covers the text-color side.
