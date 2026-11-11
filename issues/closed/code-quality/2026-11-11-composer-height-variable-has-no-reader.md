---
title: "The chat composer measures its height into --bbx-composer-height, which nothing reads"
workstream: web-guidance-scan
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-web-guidance-scan — CSS audit against modern-web-guidance
resolution: implemented
---

**Closed (implemented, 2026-11-11):** Removed the ResizeObserver effect in ChatComposerSection; nothing read the variable.

`ChatComposerSection.tsx` runs a `ResizeObserver` on the composer and writes
its height to `--bbx-composer-height` on the document root
(`beebox/src/frontend/src/components/chat/InteractiveChat-layout/view/ChatComposerSection.tsx:248`):

```tsx
const measure = () => document.documentElement.style.setProperty("--bbx-composer-height", `${node.getBoundingClientRect().height}px`);
```

`git grep` finds no reader in the repository, including `ios-app/`. The last
reader was the fixed overlay's `bottom: "var(--bbx-composer-height, 0px)"`,
removed in `43f948450` (2026-09-11, "Consolidate card presentation into the
workspace"). The writer stayed.

The effect is a layout read on each composer resize and a root style write
that nothing uses. If no planned surface needs the composer height, the
effect and its cleanup can go.
