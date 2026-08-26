---
title: "Every chat page load logs a [capture] 'List resumable capture sessions failed' error"
workstream: tour-health
area: callback-box
labels: [capture, tours]
filed-by: agent
discovered-by: agent
discovered-in: tour-health — the capture and new-chat tours show "Open debug log (1 error)" on a fresh chat load
resolution: implemented
---

**Closed 2026-08-26:** fixed by commit f38eda292 ("auth: a box opts in to
agent browsing as its owner", `docs/plans/agent-browsing-owner.md` →
`docs/implemented-plans/`). The 401 came from the browse key carrying no
identity on the box; `test1` now declares `agentBrowsing: "owner"`
(`config/box.json`), and `resolveCaptureRequestOwner` resolves it to the box
owner through the new `resolveBoxIdentity`. The capture-page error badge is
gone in the tours. The status-code omission this issue also named is fixed at
`src/frontend/src/pages/capture/capture-api.ts:157` (`ResumableCaptureListError`
now carries the response status).

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
