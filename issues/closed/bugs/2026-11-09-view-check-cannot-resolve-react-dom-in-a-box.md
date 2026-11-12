---
title: "bbx view check fails with ERR_MODULE_NOT_FOUND for react-dom when a box view bundles code that imports it"
workstream: box-feedback-bugs
area: beebox
labels: [views]
filed-by: agent
discovered-by: agent
discovered-in: "courseware box feedback — Concept_Map_Render_Check_Dependency, 2026-11-09"
resolution: implemented
---

**Closed (implemented, 2026-11-09):** The box-package node view runtime links the engine's react-dom beside react (box-feedback-bugs). Cause confirmed: the courseware box's node_modules holds only the beebox link; its declared react/react-dom were never installed.

In a box with the courseware plugin, `bbx view check` rendered four views and
failed one: `src/views/concept-map.tsx`. The error was
`Cannot find package 'react-dom' imported from <tmp>/view/view.mjs`
(`ERR_MODULE_NOT_FOUND`). `bbx view typecheck` passed all five views. The
failure repeated on every run, so the whole-box check stays red.

## Mechanism (from code reading, not reproduced)

- That view file is one line: `export { default } from "beebox/plugins/courseware/view";`.
  The built plugin view (`beebox/dist/plugins/courseware/view.js`) imports
  `react-dom`.
- The node compile target externalizes `react` and `react-dom` to bare
  specifiers (`beebox/src/webapp/views/compiler/compile.ts:23-30`), so the
  bundle keeps `import … from "react-dom"`.
- For a box, `writeNodeViewModule`
  (`beebox/src/webapp/views/node-view-runtime.ts:70-100`) links the box's
  `node_modules` and overrides only `react` with the engine's copy. A box's
  `node_modules` holds only the `beebox` link (as in the test box). Nothing
  supplies `react-dom`.

Thus any box view that imports `react-dom`, directly or through a plugin's
view, probably fails the check. That includes every box that installs a
plugin with a view stub. The browser path is unaffected: there the shims read
the host's `react-dom`.

## Expected

Link the engine's `react-dom` beside `react` in the box-package case, or give
an error that names the missing link. Add a test with a box view that
imports `react-dom`.
