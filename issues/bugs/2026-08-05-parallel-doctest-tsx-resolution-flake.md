---
title: "Parallel doctest run intermittently fails to resolve TSX schemas"
area: callback-box
filed-by: agent
discovered-in: worktree-agent-sdk-monitor — finish verification for the Agent SDK monitor
---

The full `callback-box` test suite intermittently fails under parallel load. Many doctests report errors such as:

```text
Error: Cannot find module '.../src/schemas/feedback.ts' imported from .../src/schemas/registry.ts
```

The tracked source is `feedback.tsx`, and the import is `./feedback.js`. Similar failures affect `guide.tsx`, `capture-session.tsx`, and `scheduled-script.tsx`. The 2026-08-05 run reported 2,719 assertions, 2,447 passes, and 272 failures.

An isolated rerun of `test/box-containment.doctest.md` passed all 29 assertions. The failing branch did not change the schema loader, the affected doctest, or the TypeScript runtime. Investigate concurrent `tap`/`tsx` module resolution and determine why `.js` imports sometimes resolve to nonexistent `.ts` files instead of the available `.tsx` files.
