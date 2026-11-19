---
title: "Colour Markdown code fences, and put JSON files on the card"
workstream: unattached
area: beebox
design: ../../beebox/docs/implemented-plans/code-file-card.md
filed-by: agent
discovered-by: agent
discovered-in: worktree-code-file-card — text and code files moved onto the card surface with colouring
---

Text and code files now open on the themed card and are coloured by language (`CodeText`, `beebox/src/frontend/src/components/CodeText/`). Two nearby surfaces did not change.

**Markdown code fences.** A fence with a language (```` ```ts ````) renders uncoloured (`Fence` in `beebox/src/frontend/src/components/Markdown/body.tsx`). `CodeText` could colour it, but two things need a decision first. Fences sit on the dark code plate (`--bbx-code-paper`/`--bbx-code-ink`), so the token colours must derive from `--bbx-code-ink` there, not `--bbx-ink`. Many fences in chat carry a drafted message for the person to copy, usually with no language; those must stay uncoloured, and the Copy button must still copy the plain text.

**JSON files.** A `.json` file still opens without the card: `usesThemeSurface` in `beebox/src/frontend/src/components/FileView/view.tsx` covers cards, Markdown, and plaintext only. JSON has its own size-gated renderer (`renderers/json.tsx`), and `.comments.json` has another; putting `.json` on the card needs a check that both read well there. JSON could also be coloured through `CodeText` (one more grammar, about 0.5 KB).
