---
title: "`bbx view test` breaks React hooks in a box package — two React instances"
workstream: small-bugs-batch
area: beebox
labels: [views, boxes-as-packages]
filed-by: agent
discovered-by: agent
discovered-in: main session — bbx feedback triage from a real box
priority: normal
resolution: implemented
---

Closed 2026-08-29 by this commit (`fix(views): share engine React in box-package renders`): node view modules now override a box package's React with the renderer's instance, verified with a real hook-using view.

Any view using React hooks fails to render under `bbx view test` when the host is
a **box package**: `import { useState } from "react"` produces *"Invalid hook
call… more than one copy of React"*, then a `TypeError` reading `useState` of
null. It reproduces on a box's own shipped `src/views/markdown-viewer.tsx`, so
it is not author error, and none of the three plausible patterns work — a plain
`react` import, `React.useState` (`React is not defined`), or relying on a
claimed global (`useState is not defined`).

Practical cost: a hook-using view can be authored but never render-tested.
`docs/generated/views.md` tells authors hooks just work.

**Reported independently three weeks earlier**, from a different box
(2026-07-21): same "Invalid hook call / dual React copies", reproducing on two
*pre-existing* views there as well as a new one, which likewise had to fall back
to manual code review. So this is not box-specific, not view-specific, and has
been costing render-testing since at least mid-July.

## The code states the invariant it breaks

`src/cli/commands/view.ts:154-159` spells out the requirement:

> the compiled module imports `react`/`react/jsx-runtime` as bare specifiers and
> must resolve them to the **SAME instance** the host `react-dom/server` uses
> (single instance — hooks work, no dispatcher mismatch)

But the two sides resolve differently for a box package:

- The harness imports `renderToString` from `react-dom/server`
  (`view.ts:33`) — resolved through the **engine**, pulling the engine's React.
- `writeNodeViewModule` (`src/webapp/views/node-view-runtime.ts:72-98`) symlinks
  the **box package's own `node_modules`** for a `box-package` host, so the
  compiled view resolves the **box's** React.

Two copies, dispatcher mismatch, hooks dead.

The `engine-hosted` branch resolves React from `PACKAGE_ROOT` — the same
instance `react-dom/server` uses — so hooks work there. Its comment notes that
is "same as `bbx view test` has always done", which points at box-package hosting
(boxes-as-packages v2) as where this regressed.

## Fix direction

Make the box-package path satisfy the invariant the comment already states:
resolve the view's `react`/`react/jsx-runtime` to the engine's instance even
when other specifiers (`beebox/*`, the box's own deps) resolve through the
box package. The box still needs its own React for typecheck and for the browser
target; this is specifically about the node render host sharing one instance.

Verify by rendering a hook-using view in a real box package — a passing
typecheck proves nothing here.
