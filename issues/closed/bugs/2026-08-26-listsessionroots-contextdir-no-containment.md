---
title: "listSessionRoots joins a history-file contextDir without containment"
workstream: chat-session-identity
area: beebox
priority: backlog
filed-by: agent
discovered-by: agent
discovered-in: worktree-chat-session-identity — Track O review of chat-session-identity.md landing
resolution: implemented
---

**Closed 2026-09-04.**

Fixed in `cross-box-leak-scan`: `listSessionRoots` resolves the row through
`containedSessionCwd`, the same helper `resolveSessionLogPath` already used;
an escaping row collapses to the box root and is skipped. Covered in
`test/cli/lib/session-multi-root.doctest.md`.

`listSessionRoots` (`beebox/src/core/chat/session/history.ts:185`) reads
`contextDir` out of the per-checkout session-history JSON and joins it straight
onto `boxRoot`:

```ts
const contextDir = entry.contextDir;
if (contextDir === undefined || contextDir === "") continue;
const dir = getSessionDir(path.join(boxRoot, contextDir));
```

with no containment check — a `contextDir` of `../../etc` (hand-edited history
file, or a future bug that writes one) would resolve outside the box. Same
family as the husk `context-dir` bug fixed for
[encode-project-dir-underscore-mismatch](2026-08-25-encode-project-dir-underscore-mismatch.md),
but the source here is the history file rather than the husk card, so that
fix's `resolveContainedRef` machinery (built for card refs) doesn't apply
directly — this needs its own bounds check (e.g. resolve then verify the
result is still under `boxRoot`) before it's a `bug` rather than a `watch`.

Not resourced during the chat-session-identity landing (2026-08-26); the
history file is currently only ever written by our own code, so this is a
containment-in-depth gap, not an observed exploit.
