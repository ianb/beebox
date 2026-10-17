---
title: Markdown task checkboxes have no accessible name
workstream: bug-burndown
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-theme-polish — Bloom browser tour
resolution: implemented
---

**Closed 2026-10-17:** fixed on the bug-burndown branch ("Markdown task checkboxes are labelled by their task text"). The `item` transform in `beebox/src/shared/markdoc-config/tags/core.ts` wraps the `Task` checkbox and the item's inline text in a `label`; a nested list stays outside it. The app and published pages both get the name. Verified in the browser on the worktree test box: the accessibility tree names each checkbox by its task text, nested items included. Test: `beebox/test/shared/markdoc-config.task.doctest.md`.

Markdown task lists render disabled checkbox inputs followed by ordinary list
text. The `Task` component in `beebox/src/frontend/src/components/Markdown/body.tsx`
does not associate that text with the input. Screen readers encounter unnamed
checkboxes, and axe reports `label` at both desktop and mobile widths.

Reproduce with the `bloom-theme` tour's `bloom-workspace` checkpoint. The three
checklist items in `bloom-inherited.memo.card` expose the existing renderer
behavior; the theme adds no checkbox markup. Associate each checkbox with its
task text while preserving the read-only task presentation.
