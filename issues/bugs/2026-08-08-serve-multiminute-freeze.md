---
title: "cb serve went unresponsive for ~4 minutes, then self-healed silently"
workstream: integration-tests
area: callback-box
filed-by: agent
discovered-in: worktree-integration-tests — field-test operator prototype (Priya, activity 2)
labels: [field-test-findings, code-error]
next-action: reconfirm
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

## Investigation (2026-08-10) — candidates exonerated, suspicion moved

Served a copy of run 2's actual box and drove every candidate below hard
(5,700+ requests over ~6 min with a 500ms stall detector): **no stall
reproduced**, and code reading confirms all the listed request-path
candidates are async / bounded-concurrency (`fs.promises`, `mapInBatches`,
`simple-git` async spawns; the `execSync("which cb")` is unreachable from
read routes). Consider `landmarks.list`, `navStatus`, `status.browse`,
`status.activity`/`getLog`, and the wakeup `execSync` **exonerated**.

Not exercised, still suspect: the bulk-upload create→register→upload→
finalize→git-commit path (`src/webapp/routes/bulk-upload.ts`,
`src/core/bulk-upload/worker.ts`) — needs a cookie-authenticated local user
the browse key doesn't grant, and minting one needs `--agent-confirmed`
(correctly not done unilaterally). Nothing sync-CPU-heavy found by reading.

Reframed hypotheses, from the original transcript: every freeze coincided
with a long-running chat turn, and a page reload always restored
responsiveness with state intact. So either (a) git-index contention
between the chat turn's commits and the upload worker's
`stageAndCommitPaths` (`withIndexLockRetry` in `src/lib/git.ts` retries
once after 2s — check whether real contention cascades), or (b) the
"freeze" is partly a FRONTEND/tab hang, not the server at all — total
non-response to snapshot/screenshot with reload-fixes-it fits a blocked
page as well as a blocked server. Next repro attempt should watch both:
`node --cpu-prof` on the server AND a parallel curl heartbeat that
distinguishes "server dead" from "this tab dead", while a real chat turn
runs concurrently with upload-panel use (needs a boxholder-authorized test
identity for the upload half).

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
