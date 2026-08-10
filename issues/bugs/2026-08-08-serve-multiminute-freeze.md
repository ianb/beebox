---
title: "cb serve went unresponsive for ~4 minutes, then self-healed silently"
workstream: integration-tests
area: callback-box
filed-by: agent
discovered-in: worktree-integration-tests — field-test operator prototype (Priya, activity 2)
labels: [field-test-findings, code-error]
---

During the field-test prototype, the served app stopped responding entirely:
no clicks landed, and two successive page navigations each hung for ~2 minutes
before timing out with no response. On the third attempt the app loaded
normally with all state intact — no error shown, no reconnect notice, no trace
in the UI that anything happened.

Context: standalone `cb serve <box> --port 3555` (fresh `cb init` box, dev
build), immediately after rapid navigation between the three card views
(chat side panel → browse page → full card view) and keyboard scroll attempts.
A real chat-agent turn had completed a minute or two earlier.

Low information — filed so the symptom is on record. Worth checking when it
recurs: whether the Node process was blocked (event-loop stall — a sync FS
walk? search-index rebuild? git operation on the box?), whether it correlates
with the chat session pool, and whether anything landed in the box's
`.callback-box/` logs. The field-test harness (agent-field-tests plan) will
surface this class of stall as a harness event if it recurs in runs.

Note: a stall long enough would starve the WS ping/pong watchdog
(`server-box-scope.ts` `keepAlive: pingMs 30s / pongWaitMs 5s`) and close live
sockets — which made this a suspect for the (now-fixed-by-watchdog)
[chat-status-lies-after-completion](../closed/bugs/2026-08-08-chat-status-lies-after-completion.md)
finding, same environment.

## Recurrence (2026-08-09, field-test run 2)

Reproduced during `upload-photos` (run
`onboarding-first-days-2026-08-09T18-10-43`): browse commands that normally
take a second timed out at 2–5 minutes, three times; each page reload
restored responsiveness briefly. The operator noted the seizures happened
"generally right after I opened the upload panel" — correlation observed
more than once, not proven causal. First concrete lead: profile the
bulk-upload overlay's open path (and whatever `browse`-route work it
triggers) against the candidate stall sites below.

## Research (2026-08-09)

Candidate request-path stall sites collected while investigating the stuck
chat status (flagged by code reading, none traced end-to-end or measured —
that's the next step when this recurs):

- `src/webapp/trpc/routers/landmarks.ts` — `landmarks.list` runs a full-box
  `glob("**/*.landmark.card")` on every call, no caching; rapid navigation to
  the landmarks page re-walks the tree each time.
- `src/core/nav-counts.ts` — `fs.readdir(dir, { recursive: true })` (async
  but a full recursive box walk) backs `navStatus`, "the one query every page
  mounts" — fires on every page load.
- `src/webapp/trpc/routers/status.ts` (`browse`) — per-directory recursive
  `readdir` for attachment counts; potentially O(dirs) recursive walks per
  single call.
- `src/webapp/trpc/routers/status.ts` (`activity`) + `src/lib/git.ts`
  `getLog` — git-log on the request path; check whether it shells out
  synchronously.
- `src/core/commands/wakeup.ts` — `execSync("which cb", ...)`, a synchronous
  subprocess spawn; check reachability from any route handler.
