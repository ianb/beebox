---
title: "`codex-sdk-session.boundary.test.ts` is red: `native-store.ts` imports `codex-history-server.js`"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-sdk-update — full suite after the Agent SDK 0.3.312 bump
labels: [test-failure]
---

`beebox/test/services/codex-sdk-session.boundary.test.ts` fails on current main
every run. It lists the files allowed to import `codex-history-server.js`, and
only `src/core/chat/session/codex-transcript/core.ts` is on the list. The file
`src/core/chat/session/native-store.ts` now imports it too.

`c1aeab168` ("Route transcript reads through an engine-keyed native session
store", 2026-10-29) added the import. Either the store reaches the history
server through `codex-transcript/core.ts`, or the boundary list gains the new
file; the owner of that change decides which. While the test is red, a second
new importer of the history server would go unseen.

Reproduce, from `beebox/`:
`npx tap --disable-coverage test/services/codex-sdk-session.boundary.test.ts`.
