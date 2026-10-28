---
title: "`ui-scan.annotations.test.ts` is red: `bbx-composition-done` is declared twice"
workstream: composition-editor
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-knip-sweep — full suite before landing the 2026-10-28 knip sweep
labels: [test-failure]
---

`beebox/src/frontend/test/lib/ui-scan.annotations.test.ts` fails on main in
"Note what \"exactly once\" is buying:" with the unexpected duplicate
`bbx-composition-done: 2`. Both Done buttons in
`beebox/src/frontend/src/components/MarkdownCardView/compose/ComposeEditor.tsx`
(lines 166 and 193) use `controlAddress("bbx-composition-done", instance)`.
They came in with `e42a23e3c` ("Composition editor: CodeMirror compose mode
with autosave and merge", 2026-10-27).

One of the two needs its own id, or the two need to become one control.

Reproduce: `pnpm -C beebox exec tap src/frontend/test/lib/ui-scan.annotations.test.ts`.
