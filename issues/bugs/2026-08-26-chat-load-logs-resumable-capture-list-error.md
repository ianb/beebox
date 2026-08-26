---
title: "Every chat page load logs a [capture] 'List resumable capture sessions failed' error"
workstream: unattached
area: callback-box
labels: [capture, tours]
filed-by: agent
discovered-by: agent
discovered-in: tour-health — the capture and new-chat tours show "Open debug log (1 error)" on a fresh chat load
---

On the tour worktree's `test1` clone, opening `/chat` (and `/capture`, which
redirects into it) puts one error in the app bar's debug-log button on every
load. The client debug log (`.callback-box/client-debug.log`) shows it each
time:

```
[error] [capture] Failed to load resumable sessions: ResumableCaptureListError: List resumable capture sessions failed
```

Thrown by `listResumableCaptureSessions` in
`src/frontend/src/pages/capture/capture-api.ts` when
`GET /capture/sessions/resumable` answers non-2xx. Probed from the page: it
answers **401** — the tour/`bin/browse` session carries no cookie, and the
capture routes resolve a real owner (`resolveCaptureRequestOwner`) where the
rest of the app is happy unauthenticated in local dev. So this may be a
dev-auth shape rather than a prod bug; two things are defects either way:
`capture-api.ts:157` throws `ResumableCaptureListError` without the status
code, so the debug log cannot say why, and a failed resumable-list puts a red
error badge in the app bar on a normal chat open. Also worth confirming: a
page that throws on every load with nothing wrong is what the debug-log
count is supposed to catch. The tours now assert `expect.noPageErrors()`,
so this stays a ❌ finding in the weekly tour check until it is fixed or
shown to be environmental.
