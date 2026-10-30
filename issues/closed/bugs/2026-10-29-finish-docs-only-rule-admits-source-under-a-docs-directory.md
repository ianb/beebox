---
title: "finish-preflight treats source code in any `docs/` directory as a docs-only change"
workstream: tooling-burndown
area: bin
labels: [finish, verification]
filed-by: agent
discovered-by: agent
discovered-in: "tooling-burndown worker — finish-preflight skip-rule change, 2026-10-29"
resolution: implemented
---

**Closed (implemented, 2026-10-30):** isDocsOnly now counts a non-.md path as a doc asset only in a top-level docs directory (docs/ or <package>/docs/) and never when it is TS/JS or shell source; tests in bin/finish-preflight.test.ts cover the Google Drive docs handler paths.

`isDocsOnly` in `bin/finish-preflight-lib.ts` counts a path as a doc when it is
a `.md` file or when any path segment is `docs`. The second clause matches
source files such as
`beebox/src/connectors/google-drive/handlers/docs/handler.ts` and
`beebox/test/connectors/google-drive/handlers/docs/whitespace.test.ts`. A
branch that changes only files there gets `docsOnly: true`, and
`verificationCommands` then skips its tests, typecheck, lint, and smoke walk
as "docs-only diff".

Direction: treat a path under `docs/` as a doc only when it is not code (for
example, not `.ts`, `.tsx`, `.js`, `.mjs`, `.json`), or only for `docs/`
directories at known roots (`beebox/docs/`, `bin/docs/`, root `docs/`).
