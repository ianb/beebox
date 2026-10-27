---
title: "On-demand job triggers and server-routed finalize notifications"
status: draft
workstream: box-isolation-followups
issues: []
---
# On-demand job triggers and server-routed finalize notifications

Jobs that carry no `connector:` field never run on a deployed box, because
every scheduled wakeup is connector-scoped. This plan makes each action that
creates such a job ask the box server for one full wakeup, and it makes the
notifications that `bbx finalize` and other box tooling children send go
through the box server, which holds the push keys.

All paths are relative to the monorepo root.

**Issues addressed:** none filed. Searches of `issues/` (open and closed) and
`private-issues/`:

- "question-followup", "follow-up job": found
  `issues/docs-and-chores/2026-07-19-questions-end-to-end-followups.md`
  (open). It notes *"The nudge notification path has never fired for real"*.
  Related; this plan does not close it (it also asks for a live nudge and a
  scenario test of the learning loop).
- "unscoped wakeup", "connectorFilter", "untagged job": found only closed
  items: `issues/closed/bugs/2026-08-10-low-priority-jobs-wedge-wakeup-forever.md`
  (added the 24h low-priority deadline; did not see the connector filter) and
  `issues/closed/bugs/2026-09-29-scoped-wakeup-skips-items-held-by-unscoped-jobs.md`.
- "stalled-jobs", "never drain": nothing open.
- "VAPID", "APNs", "BBX_BOX_NAME", "BBX_SERVER_URL", "idle exit": nothing
  about tooling children or the unit host. `issues/features/2026-09-25-notifications-and-proactive-design.md`
  is about product design, not routing.
- `private-issues/`: "question-nudge", "apns skipped", "untagged",
  "unscoped wakeup", "followup job": nothing.

## Design

No design section: this restores behavior that is already decided. An answered
question already promises a follow-up job that runs
(`beebox/docs/design/processing.md`, "The question loop": *"When the user
answers (web or `bbx answer`), the system creates a **follow-up job** from the
directive"*), and question nudges already promise a phone notification. The
only new text a person sees is one line from `bbx answer` when no box server
is running (Track D).

## Smallest fix and budget

**Smallest fix.** Two edits, about 40 source lines:

1. After a web answer writes a follow-up job, call `runBbxWakeup` without
   waiting, the same way the wordless-capture filing does
   (`beebox/src/webapp/routes/quick-capture/runtime.ts:42`).
2. In `bbx finalize`, send the question nudge and alert through
   `notifyRoute()` (`beebox/src/cli/lib/notify-route.ts:24-28`) instead of
   calling `notifyBoxholder` in process.

The smallest fix loses the run when the server restarts or a deploy lands
before the run ends, cannot hear a CLI `bbx answer`, starts one wakeup per
answer in a burst, and leaves a pass-scheduled finalize on an idle unit-host
box without `BBX_BOX_NAME`, so it still delivers in process with no keys.

**Chosen design: five tracks.**

| Track | Source lines (add + delete) | Test lines |
|---|---|---|
| A. Tooling-child notifications through the box server | ~140 | ~130 |
| B. One box-level pending-wakeup marker (moved from scan) | ~90 (mostly moved lines and imports) | ~60 |
| C. Wakeup trigger in the box server | ~150 | ~120 |
| D. Trigger call sites, and scan uses the trigger | ~80 | ~80 |
| E. One-time drain runbook | 0 | 0 |

Total about 460 source and 390 test lines. Authored docs about 80 lines
(`beebox/docs/design/processing.md`, `beebox/src/core/reactor/DESIGN.md`, the
runbook in `beebox/deploy/README.md`). No generated output. Not a BIG CHANGE.

The fuller design buys: a durable record, so a lost run is late and not
indefinite (the lesson in `beebox/src/core/scan/promote/wakeup.ts:5-15`);
one debounced run per burst; one wakeup runner per box in place of two
(principle 8); and a server that stays up while a wakeup it started is still
running.

## Stated preferences this plan trades against

- **Boxholder decision: triggers, not a recurring unscoped wakeup.** The
  action that creates a job starts processing for it. Backfill is an
  exception: *"I want backfill to be an exception, and ideally everything is
  handled with triggers."* This rules out an hourly or daily
  `bbx engine wakeup` schedule as the main path.
- **Boxholder decision: finalize notifications go through the box server**,
  like `bbx notify`. The tooling env allowlist keeps the APNs and VAPID keys
  out (`beebox/src/core/script-env/core.ts:203-218`; the notify header
  `beebox/src/cli/lib/notify-route.ts:1-11`).
- **Principle 4, resilient and never silent**
  (`beebox/docs/engineering-principles.md:49`). Today the question alert in a
  tooling child returns `null` without a log line when no channel is
  configured (`beebox/src/core/question-alert.ts:72-73`: *"if (!channels.webPush
  && !channels.apns) return null;"*). The fix must log a server failure.
- **Principle 8, one way to do each thing**
  (`beebox/docs/engineering-principles.md:95`). Scan already has a durable
  wakeup marker with a retry budget. A second marker for answers would be a
  second way. Track B moves the scan marker to box level, and Track D makes
  scan use the shared trigger.
- **Principle 10, testability** (`beebox/docs/engineering-principles.md:116`).
  The decisions (route choice, clear-or-keep the marker, idle decision) stay
  pure functions.
- **Prefer existing primitives; minimize invented concepts** (task brief).
  The design reuses `runBbxWakeup`, the scan marker and retry budget, the
  promote debouncer, the cross-process event bus, and `notifyRoute`. It adds
  one bus event name and one server lifecycle.
- **Shipped precedent.** Scan's durable wakeup (`beebox/docs/implemented-plans/scanner-ingest.md`
  Track 3), wordless-capture filing (`beebox/docs/implemented-plans/file-wordless-captures.md`),
  and `bbx notify` delegation (`beebox/docs/implemented-plans/agent-capability-delegation.md`).

## What already exists

**Why untagged jobs do not run.**

- Every stock wakeup schedule is connector-scoped:
  `beebox/src/core/box/structure/default-schedules.ts:30` *"runs: \"bbx engine
  wakeup --connector gmail\""*, `:41` (`google-calendar`), `:55`
  (`google-drive`). All three are seeded `enabled: false` (`:29`, `:40`,
  `:51`). No other default runs `bbx engine wakeup`.
- A scoped wakeup passes its connector to the reactor:
  `beebox/src/cli/commands/wakeup/command.ts:82` *"if (activeConnectorName)
  reactorOptions.connectorFilter = activeConnectorName;"*.
- Discovery drops every job whose `connector:` does not match:
  `beebox/src/core/reactor/job-discovery.ts:99` *"if (connectorFilter !==
  undefined && connector !== connectorFilter) continue;"*.
- The reactor design says so: `beebox/src/core/reactor/DESIGN.md:58` *"Jobs
  with no `connector` (question follow-ups, contains backfill, full-wakeup and
  scan intake) match no filter, so they only run when the reactor is invoked
  with no filter (a full `bbx wakeup`, or `bbx reactor` directly)."*
- The tick only runs scheduled scripts (`beebox/src/core/schedule/scheduler/pass.ts:91`
  *"const result = await runTick(boxPath, { quiet: true });"*). It runs no
  wakeup of its own.

**How it used to work (git history).** The filter arrived on 2026-04-27 in
`b9ff55a40` *"Route reactor by connector source so partial wakeups don't drain
unrelated jobs"*. Its DESIGN text already said cross-cutting jobs *"only run
when the reactor is invoked with no filter"* (a full wakeup, or the reactor
run directly; the quote names both by the CLI's retired name). Before that commit, the scheduled gmail wakeup drained
every job. No default schedule ever ran an unscoped wakeup: the defaults at
`01a5791b0` (2026-06-01) and `dab834811` (2026-08-30) list only
`--connector gmail` and `--connector google-calendar` wakeups. Since then, an
unscoped wakeup has run only from:

- the scan promote worker (present at `dab834811`, 2026-08-30);
- `wakeup.force` / `bbx force-wakeup` (`ced1f2465`, 2026-09-14);
- wordless-capture filing (`fa73c9c10`, 2026-10-17);
- a person running `bbx engine wakeup` or `bbx reactor`.

The UI "Sync" button is gone: `beebox/src/webapp/trpc/routers/actions.ts:36-38`
*"a `wakeup`/connector-sync trigger procedure was removed"* (2026-06-26,
`4c7f3b9aa`). The comment at `beebox/src/core/commands/wakeup.ts:41` still
names *"the UI Sync button"*; it is stale. So the stall predates the per-box
migration by six months. The answer code knows it:
`beebox/src/core/commands/answer.ts:263-264` *"A chat answer writes no job:
the agent did the directive in the conversation before answering (a fresh box
has no wakeup to run one)."*

**Pieces to reuse.**

| What | Where | Reuse or rebuild |
|---|---|---|
| Supervised full-wakeup child | `beebox/src/core/commands/wakeup.ts:46` `runBbxWakeup`; doc `:43-44` *"Forcing and letting it happen are therefore the same code"* | Reuse as the trigger's runner. Add a live-child count (Track C). |
| Durable "wakeup owed" marker | `beebox/src/core/scan/promote/wakeup.ts:55` `markWakeupPending`, `:153` `runPendingWakeup` | Reuse; move to box level (Track B). |
| Retry budget with abandonment | `beebox/src/core/scan/promote/wakeup-retry.ts:27-53` (2, 4, 8, 15, 15 min; 6 attempts) | Reuse; move with the marker. |
| "Did the wakeup drain jobs?" rule | `beebox/src/core/scan/promote/wakeup.ts:114-131` `wakeupSatisfiedScanPromote` | Reuse; rename to say what it judges. |
| Settle debouncer on awake time | `beebox/src/core/scan/promote-debounce.ts:34` `createPromoteDebouncer` | Reuse; move beside the marker. |
| Admission for timer-started work | `beebox/src/webapp/routes/scan-upload/promote-lifecycle.ts:109-119` (*"Timers inherit async context, so without `withoutBoxWork` the pass would carry the request's work permit"*) | Reuse the same `withoutBoxWork(() => withBoxWork(...))` wrap. |
| Cross-process event bus, polled by the server | `beebox/src/core/event-bus/core.ts:13-15` *"When pollInterval is set, the bus periodically checks for events inserted by other processes"*; server sets it at `beebox/src/webapp/server/app.ts:257` *"createEventBus(box.boxRoot, { pollInterval: 1000 })"* | Reuse for out-of-server triggers. |
| Server-side notification send | `beebox/src/webapp/trpc/routers/notifications.ts:74-87` (`send`, `channels`) | Reuse unchanged. |
| Route choice for `bbx notify` | `beebox/src/cli/lib/notify-route.ts:24-28` `notifyRoute()`; delivery at `beebox/src/cli/commands/notify/command.ts:181-191` | Reuse; lift `deliver` into a sender both use. |
| Box-env for children | `beebox/src/core/script-env/core.ts:143-162` | Extend: unit-host fallback for the box name (Track A). |
| Idle decision | `beebox/src/webapp/server/idle-exit.ts:41-48` `decideIdle` | Extend with live wakeup children. |
| Abandoned-capture sweep in the server | `beebox/src/webapp/routes/capture/register.ts:44-91`, every 10 min of awake time | Reuse unchanged; it already owns this chore. |
| Stalled-jobs health check | `beebox/src/webapp/trpc/routers/health/checks/stale.ts:57` (7 days) | Reuse as the visible backstop. |

**Job writers in the code today** (searched every `.job.card` writer and every
`createOrAppendIntakeJob` caller):

| Job | Writer | Connector tag | Priority | Trigger today |
|---|---|---|---|---|
| `question-followup` | `beebox/src/core/commands/answer.ts:265` (web and CLI; not `--via chat`) | none | normal | none |
| intake (scan session + review questions) | `beebox/src/core/commands/scan-import/session-discard.ts:92` | none | normal | scan promote wakeup (`beebox/src/core/scan/promote/core.ts:266`) |
| intake (wordless captures) | `beebox/src/core/quick-capture/filing-sweep.ts:86` | none | normal | filing wakeup (`beebox/src/webapp/routes/quick-capture/runtime.ts:42`) |
| intake (unjobbed inbox items) | `beebox/src/cli/commands/wakeup/steps.ts:342` | the scoped connector, else none | normal; low for `.capture-session`, `.image`, `.audio` (`:216-217`) | created inside a wakeup |
| `contains-backfill` | `beebox/src/cli/commands/wakeup/steps.ts:404-433`, on every wakeup, scoped ones included (`command.ts:200-219` is not gated on `--connector`) | none | low | none |
| any job an agent writes by hand | chat prompt `beebox/src/core/chat/session/prompts.ts:32` | none | as written | none |

**Inbox writers that create no job** (a full wakeup's step 4b jobs them):
share-to-inbox (`beebox/src/webapp/trpc/routers/share/router.ts:90`
*"if (destination.kind === \"inbox\") return INBOX_DIR;"*) and Chrome
extension commentary (`beebox/src/webapp/trpc/routers/clerk.ts:60`
*"let destDir: string = DEFAULT_COMMENTARY_DIR;"*).

**Notification senders and the process they run in.** Every
`notifyBoxholder(` call site:

| Sender | File | Runs in | Keys there? |
|---|---|---|---|
| question nudge | `beebox/src/core/question-aging.ts:209` | `bbx finalize`, a tooling child of the reactor (`beebox/src/core/reactor/engine/subprocess.ts:52-54`) | no |
| question alert | `beebox/src/core/question-alert.ts:105` (and the channel check at `:72`) | `bbx finalize`; also the migration sweep (`beebox/src/core/migration-sweep.ts:141`) | finalize: no; migration: the server or a deploy shell with `box.env`, yes |
| scheduled `notify:` action | `beebox/src/core/schedule/run-action.ts:82` | the pass process (yes), the server's "run now" (yes), and on-wakeup scripts inside a `bbx engine wakeup` child (`beebox/src/cli/tick-utils.ts:133`) (no) | mixed |
| schedule promotion notice | `beebox/src/core/schedule/promotion.ts:92` | the pass process (yes); on-wakeup path in a wakeup child (`beebox/src/cli/tick-utils.ts:124`, `:152`) (no) | mixed |
| connector activity alert | `beebox/src/core/schedule/scheduler/connector-activity-alert.ts:76` | the pass process, via `runBoxAlerts` (`pass.ts:109`) | yes |
| capture failure | `beebox/src/core/capture/failure-notice.ts:59` | box server (capture prepare, bulk-upload worker) | yes |
| chat callouts | `beebox/src/core/chat/callout-tags.ts:83` | box server chat route (`beebox/src/webapp/routes/chat/register.ts:163`) | yes |
| `notifications.send` | `beebox/src/webapp/trpc/routers/notifications.ts:76` | box server | yes |
| `bbx notify` | `beebox/src/cli/commands/notify/command.ts:183` | already routed | n/a |

The pass process has the keys: the pass unit loads `/etc/beebox/box.env`
(`beebox/deploy/systemd/beebox-pass@.service`, `EnvironmentFile=/etc/beebox/box.env`),
which the hub writes through the child allowlist
(`beebox/src/hub/box-env-file.ts:5-6` *"The hub writes it at each start from
its own environment through the same allowlist a spawned child gets"*), and
that allowlist names `BBX_APNS_KEY_PATH` … `BBX_VAPID_SUBJECT`
(`beebox/src/hub/supervisor/child-env.ts:79-88`). The key file is readable
inside the box sandbox, which sets `ProtectHome=yes`
(`beebox/deploy/systemd/box-sandbox.conf`): verified on production 2026-10-27,
`BBX_APNS_KEY_PATH` is `/etc/beebox/apns/…p8`, directory `root:beebox-boxes`
2750, as `beebox/docs/server/configuration.md` ("APNs (iPhone push) key")
prescribes. The journal's last `Failed loading token key: EACCES` predates the
key's move there on 2026-10-26.

**Box-client inputs in a finalize child.** `boxClient()` needs
`BBX_SERVER_URL`, `BBX_BOX_NAME`, `BBX_AGENT_TOKEN`
(`beebox/src/cli/lib/box-client.ts:26`). `buildEnv` sets them
(`beebox/src/core/script-env/core.ts:148-159`): *"const publicUrl = ambient ??
endpoint?.publicUrl ?? config.publicUrl ?? process.env.BBX_PUBLIC_URL ??
process.env.PUBLIC_URL;"*, then `parsePublicUrl` takes the box name from the
URL path (`:111-115`).

- (a) Reactor started by the box server. The server publishes
  `${BBX_PUBLIC_URL}/${slug}` for a socket listener
  (`beebox/src/webapp/server/serve-publish.ts:21-24`, `:44-50`) and writes the
  endpoint file. The `bbx engine wakeup` child reads that file, so its
  finalize child gets all three. **Present.**
- (b) Scheduled run from the pass unit. The endpoint file exists only while the
  box server runs; shutdown removes it (`beebox/src/webapp/server/app.ts:364`
  *"for (const box of boxes) await removeServeEndpoint(box.boxRoot);"*). After
  an idle exit (`--idle-exit 1800000`, `beebox/deploy/systemd/beebox-box@.service:35`)
  the fallback is `BBX_PUBLIC_URL`, the host's base URL with no path, so
  `BBX_BOX_NAME` is not set unless `_config/box.json` pins `publicUrl`.
  `notifyRoute()` then picks `local` and the send finds no keys. **Missing
  while the server is idle.** This matches the production log line
  `question-nudge apns skipped unconfigured`.

## Prior art (external)

One external premise bears on Track C: when a socket-activated service closes
its listening descriptor but keeps running, systemd does not start a second
instance, so new connections wait until the first exits. The repo states the
same: `beebox/src/webapp/server/idle-exit.ts:126-128` *"Under socket
activation this closes our copy of the listening descriptor; systemd's keeps
the queue, and the next instance serves what arrives from here on."*
Evaluated-only; source <https://www.freedesktop.org/software/systemd/man/latest/systemd.socket.html>
(`Accept=no`). Not re-fetched for this plan. No other decision depends on an
external premise.

## Ontology

- **Unscoped job** (existing name: `beebox/src/job-cards/intake-utils.ts:11`
  *"its items join the unscoped normal-priority job"*, lock name
  `unscoped-${priority}` at `:87`). A job card with no `connector:`. Not a
  connector's job. Only a full wakeup or `bbx reactor` runs it.
- **Full wakeup** (existing: `beebox/src/cli/commands/wakeup/steps.ts:189`
  *"Under a full wakeup"*). `bbx engine wakeup` with no `--connector`. Points
  at the reactor with no filter.
- **Pending-wakeup marker** (existing: `beebox/src/core/scan/promote/wakeup.ts:35`
  `MARKER_FILENAME = "wakeup-pending"`). One file per box that says a full
  wakeup is owed and why. Moves from `_tmp/scan-quarantine/wakeup-pending` to
  `.beebox/wakeup-pending`. Not a queue: one marker covers any number of
  requests.
- **Wakeup retry budget** (existing: `wakeup-retry.ts`). Attempts and the
  abandoned record beside the marker. Moves with it.
- **Wakeup request** (new verb, no new noun on disk). A call to
  `requestWakeup(boxRoot, { reason, settleMs? })`: write the marker, then emit
  the bus event. Every trigger is a wakeup request.
- **`wakeup-requested` bus event** (new event name). `{ reason: string }`.
  Tells a running box server that the marker changed. Not durable work; the
  marker is.
- **Wakeup trigger** (new server lifecycle, `startWakeupTrigger`). One per
  served box. Listens for `wakeup-requested`, debounces, runs one full wakeup
  through `runBbxWakeup`, and clears the marker on success. Distinct from the
  existing `WakeupRunner` type (`beebox/src/core/wakeup-runner.ts:28`), which
  is the function that spawns one child; the trigger calls it.
- **Live wakeup children** (new count). How many `runBbxWakeup` children this
  process is waiting on. Read by the idle decision.
- **Notify sender** (new type, `NotifySender`). `{ send(request), reach() }`.
  In process, or through the box server's `notifications.send` and
  `notifications.channels`. Chosen by the existing `notifyRoute()`.

## Tracks / scope

### Track A — Tooling-child notifications through the box server

**What.** Every notification sent from a process that `buildEnv` spawned goes
through the box server. The pass process and the server keep sending in
process.

**Why.** The finalize child has no keys, by design. Nudges are logged
`skipped unconfigured`; question alerts return `null` with no log
(`beebox/src/core/question-alert.ts:72-73`). On-wakeup scripts with a
`notify:` action, and promotion notices on the on-wakeup path, fail the same
way inside a wakeup child. With Track C, full wakeups become common, so the
on-wakeup path matters more.

**Direction.**

- `beebox/src/core/notify-boxholder.ts`: add
  ```ts
  export interface NotifySender {
    send(request: NotifyRequest): Promise<NotifyResult>;
    reach(): Promise<ChannelFlags>;
  }
  export function inProcessSender(boxRoot: string, services?: NotifyServices): NotifySender;
  ```
- `beebox/src/cli/lib/notify-route.ts`: add
  `routedSender(boxRoot: string, services?: NotifyServices): NotifySender`.
  `server` route: `send` calls `notifications.send.mutate` (the body of
  today's `deliver`, `beebox/src/cli/commands/notify/command.ts:181-191`);
  `reach` calls `notifications.channels.query()` and returns `.reach`. Both
  wrap in `onServer`, so a failure is a `NotifyServerError`. `local` route:
  `inProcessSender`. `bbx notify`'s `deliver` and `channelReach` call it, so
  there is one routing implementation.
- `ageQuestions(boxRoot, { push?, sender? })` and
  `checkPendingQuestionsAndNotify(boxRoot, { now, push?, sender? })` use
  `sender ?? inProcessSender(boxRoot, { push })`.
- Failure handling. A thrown send in aging is caught per question, logged as
  `Question nudge for <path> not sent: <message>`, and the latch is **not**
  stamped, so the next finalize tries again. In the alert, `reach()` runs
  first; a throw propagates to `finalizeQuestions`' existing catch
  (`beebox/src/cli/commands/finalize.ts:39-44`, *"Question alert failed"*)
  before the latch is rewritten, so the next finalize retries. No fallback to
  in-process delivery: the notify-route rule (`notify-route.ts:9-11` *"A
  server that is named but does not answer is an error, not a reason to
  deliver in process"*) applies.
- `finalize.ts:56` passes `{ sender: routedSender(boxRoot) }`.
- `RunActionArgs` and `PromotionContext` take an optional `sender`.
  `beebox/src/cli/tick-utils.ts` (on-wakeup path) and
  `beebox/src/cli/commands/tick.ts` pass `routedSender(boxRoot)`. In the pass
  process `notifyRoute()` returns `local` (no `BBX_SERVER_URL` in `box.env`),
  so the pass behaves as today. In the scheduler's server-side "run now"
  (`beebox/src/webapp/trpc/routers/scheduler/run.ts:93`) nothing changes.
- `beebox/src/core/script-env/core.ts` `buildEnv`: when the cascade has no
  ambient URL and no endpoint file, and `onUnitHost()` is true, use
  `${getPublicUrl("")}/${slugOfBoxRoot(boxRoot)}` before `config.publicUrl`.
  On a unit host the socket starts the server on demand, so the URL is valid
  whether the server runs or not. The hub proxies an agent-bearer request to
  the socket (`serve-publish.ts:16-18`).

**Vocabulary lock-ins.** `NotifySender`, `inProcessSender`, `routedSender`.

**First chunk.** `NotifySender` + `routedSender` + the two finalize senders +
the `bbx notify` refactor onto `routedSender`, with tests. No open question.

### Track B — One box-level pending-wakeup marker

**What.** Move `markWakeupPending`, `runPendingWakeup`, the retry budget, the
drained-jobs rule, and the debouncer out of `beebox/src/core/scan/` into
`beebox/src/core/wakeup-pending/`. Store the files in `.beebox/`
(gitignored machine state, like `wakeup-cycle.lock`,
`beebox/src/cli/commands/wakeup/cycle-lock.ts:31-34`).

**Why.** Answers need the same durability scan has. Two markers for one fact
would break principle 8.

**Direction.**

- Files: `.beebox/wakeup-pending`, `.beebox/wakeup-attempts`,
  `.beebox/wakeup-abandoned`. On first read, a legacy
  `_tmp/scan-quarantine/wakeup-*` file is moved to the new path.
- **Compare-and-clear.** `runPendingWakeup` reads the marker text before the
  run and deletes it after a successful run only if the text is unchanged. A
  request that lands mid-run rewrites the marker (new timestamp and reason),
  so it survives and the trigger runs again. Today the marker is cleared
  unconditionally (`beebox/src/core/scan/promote/wakeup.ts:166`), which is
  safe for scan only because the promotion lock serializes its writers.
- **Count the attempt before the run.** Record the attempt before spawning
  and clear it on success. A run killed by a deploy or by `MemoryMax=2G`
  (`box-sandbox.conf`) then counts against the budget, so a crash loop ends
  at 6 attempts.
- Rename `wakeupSatisfiedScanPromote` to `wakeupDrainedJobs`. Same rule:
  ok when the reactor ran and reported ok; a skip on either lock is not ok;
  `jobsRemaining` is not consulted (`wakeup.ts:128-131`).

**Vocabulary lock-ins.** `.beebox/wakeup-pending` and its two siblings;
`wakeupDrainedJobs`.

**First chunk.** The move, the legacy-path read, compare-and-clear, and
attempt-before-run, with scan still calling it inline. Scan tests keep
passing.

### Track C — Wakeup trigger in the box server

**What.** One lifecycle per served box that turns wakeup requests into
debounced full wakeups.

**Why.** Requests come from inside the server (web answer, share) and from
other processes (CLI `bbx answer`, an agent's shell, a wakeup child). A
running server must hear both. A stopped server must find the marker when it
starts.

**Direction.**

- `beebox/src/core/wakeup-pending/request.ts`:
  ```ts
  export async function requestWakeup(
    boxRoot: string,
    opts: { reason: string; settleMs?: number },
  ): Promise<void>;
  ```
  Writes the marker with `newWork: true` (resets the budget, as a new scan
  file does at `wakeup.ts:51-54`), then emits `wakeup-requested` through a
  short-lived `createEventBus(boxRoot)`, the way `notifyBoxholder` emits
  (`notify-boxholder.ts:131-145`). One path for every process.
- `beebox/src/core/event-bus/schemas.ts`: add
  `"wakeup-requested": z.object({ reason: z.string(), settleMs: z.number().int().min(0).optional() })`.
  Bump `EVENT_SCHEMA_GENERATION` (`core.ts:54`) per its rule (`:47-53`).
- `beebox/src/webapp/server/wakeup-trigger.ts`:
  `startWakeupTrigger({ server, boxRoot, eventBus, run? })`.
  - Subscribes to the box's server bus (live events only; no replay).
  - On `wakeup-requested`: `debouncer.notifyAfter(settleMs ?? WAKEUP_SETTLE_MS)`.
    `WAKEUP_SETTLE_MS` is 2 minutes, the scan settle value
    (`promote-debounce.ts:17`).
  - At startup: if the marker exists and is not abandoned, `notify()`.
  - The debounced run is single-flight per box. If a run is in flight, it
    sets `again` and returns; when the run ends and `again` is set, it re-arms
    the settle window once.
  - The run is `withoutBoxWork(() => withBoxWork({ boxRoot, reason: "wakeup
    trigger" }, () => runPendingWakeup({ boxRoot, runWakeup })))`, with
    `runWakeup` = `runBbxWakeup({ boxRoot, triggeredBy: <marker reason> })`
    judged by `wakeupDrainedJobs`.
  - On `failed`, re-arm at the budget's delay. On `abandoned`, log once and
    stop until the next request.
  - `onClose`: cancel the debouncer and await the in-flight run, as
    `promote-lifecycle.ts:210-217` does.
  - Registered for every box in `beebox/src/webapp/server-box-scope.ts`,
    next to `registerCaptureRoutes` (`:338`). Scan's lifecycle is registered
    only for annex boxes (`scan-upload/register.ts:270`), so the trigger
    cannot live there.
- **Idle exit counts live wakeups.** `runBbxWakeup` increments a module
  counter before the spawn and decrements it in `finally`.
  `ActivityLedger.signals()` (`idle-exit.ts:88-97`) adds
  `liveWakeups()` to `liveRuns`. Effect: a server does not start its drain
  while any wakeup child it spawned (trigger, scan, filing, force) runs, so
  requests no longer wait behind a draining server.
- A server that idle-exits with a retry pending loses the timer, not the
  work: the marker stays, and the next start re-arms it.

**Vocabulary lock-ins.** `requestWakeup`, `wakeup-requested`,
`startWakeupTrigger`, `WAKEUP_SETTLE_MS`, `liveWakeups`.

**First chunk.** `requestWakeup`, the bus event, the lifecycle with an
injected `run`, and the idle signal, with tests. No call site yet.

### Track D — Trigger call sites; scan uses the trigger

**What.** Each action that creates normal-priority unscoped work calls
`requestWakeup`. Scan stops running its own wakeup.

**Direction.**

| Action | Where | Call |
|---|---|---|
| Answer (web and CLI) | `beebox/src/core/commands/answer.ts`, `executeAnswer`, after the transition commits and only when a job was written (`jobRelative` set, `:266`) | `requestWakeup(boxRoot, { reason: "question answered" })` |
| Share to inbox | `beebox/src/webapp/trpc/routers/share/router.ts`, after the commit at `:76`, only when the destination kind is `inbox` | `reason: "shared to inbox"` |
| Extension commentary to inbox | `beebox/src/webapp/trpc/routers/clerk.ts`, after the commit at `:87`, only when `destDir` is the inbox | `reason: "commentary to inbox"` |
| Scan promote | `beebox/src/core/scan/promote/core.ts:264-266`: replace the inline `runPendingWakeup` with `requestWakeup(boxRoot, { reason, settleMs: 0 })` when the batch imported anything or a marker exists | the promote debouncer has already settled the burst |

- Scan result type loses `wakeup`. `promote-lifecycle.ts` keeps its re-arm
  for failed uploads and a held lock and drops the wakeup branches
  (`:70-75`, `:88-90`).
- `bbx answer` CLI output. After a job is written it already prints
  `Created follow-up job: <path>` (`answer.ts:299-301`). If no
  box server for this box is running (no endpoint file, and not a unit host),
  it adds: `No box server is running for this box; the follow-up runs when it
  next starts.` On a unit host the line is not printed when the server is
  idle, because nothing wakes it: the marker waits for the next request. See
  open question 5.
- Not triggered: wordless-capture filing keeps its own wakeup and kick budget
  (see NOT in scope). Low-priority work is not triggered (see Direction of
  Track C and open question 1).

**First chunk.** The answer trigger alone, with its test. No open question.

### Track E — One-time drain runbook

**What.** Drain the jobs that stalled before triggers existed, on the two
production boxes that hold them. An operator procedure; no code.

**Direction.** After Tracks A-D are deployed, with the boxholder's yes, for
each box, as the box's user with the unit environment (the pattern
`beebox/deploy/deploy.sh:1283-1290` uses for migration repair):

```sh
sudo -u "bbx-$slug" -H bash -lc 'set -a; source /etc/beebox/box.env; set +a; cd "/var/lib/beebox/$1/box" && bbx reactor --dry-run' drain "$slug"
```

1. Read the dry run: it lists the batch and prints the prompt
   (`beebox/src/core/reactor/engine/batch-jobs.ts:47-51`). If the prompt is
   very large (the legacy scan intake job holds 26 sessions), run
   `bbx reactor --type question-followup --max-cycles 1` first so the small
   jobs are not stuck behind it. A `--type` run gets 10 turns, not 30
   (`batch-jobs.ts:59`).
2. Run `bbx engine wakeup` once. This is the same full cycle a trigger runs:
   it jobs unjobbed inbox items, queues contains backfill, runs one reactor
   cycle, finalizes, and pushes.
3. If `stalled-jobs` still lists jobs, run `bbx reactor --max-cycles 3` once.

**Cost.** Each reactor cycle is one agent session, capped at 30 turns and
`maxBudgetUsd: 10` (`batch-jobs.ts:59-71`). At most 1 + 3 sessions per box,
plus one 10-turn session if step 1 splits. On a box running on its
long-lived Claude token this is subscription usage, not per-call spend.

**What it touches.** Whatever each job's refs and directives touch:
question follow-ups act on the answered question's directive; the scan intake
files 26 scan sessions; contains backfill writes `contains:` on up to 25 cards
per job; inbox-low intake triages captures. All commits land in the box's git
and step 2 pushes them. It runs outside the box sandbox, as deploy's repair
does.

## Could this be simpler?

**Simplest version.** A scheduled `bbx engine wakeup` every hour. One card,
no code. The boxholder chose triggers over this. It also runs agents on a
clock whether or not anything happened.

**Next simplest.** Fire-and-forget `runBbxWakeup` at each call site, as
wordless-capture filing does, plus `notifyRoute()` in finalize. It fails on:

- a deploy or crash between the action and the run's end: the job sits until
  some other action, which the scan code calls *"a lost run is indefinite,
  not late"* (`beebox/src/core/scan/promote/wakeup.ts:8-9`), against
  principle 4;
- a CLI `bbx answer`, which has no server process to call;
- a burst of five answers, which starts five wakeups; four skip on the cycle
  lock and the follow-ups written during the first run wait;
- a pass-scheduled finalize on an idle unit-host box, which still has no
  `BBX_BOX_NAME`.

**What the fuller plan buys, per piece.** The marker: durability (principle
4). The bus event: hearing other processes without a new tRPC procedure or a
token. The debouncer and single-flight: one run per burst. Moving scan onto
it: one runner (principle 8), and it deletes scan's inline wakeup handling.
The idle signal: a server that does not hang requests while its own wakeup
runs. The unit-host URL: routed notifications from the pass unit.

**Considered and rejected.**

- Let scoped wakeups also drain unscoped jobs. It undoes `b9ff55a40` and
  still does nothing on boxes whose connector schedules are disabled (all
  three are seeded `enabled: false`).
- A no-connector wakeup scope for triggers (skip connector sync). Adds a
  third wakeup mode. Existing triggers already run full wakeups. Left as open
  question 2.
- A new tRPC `wakeup.request` for out-of-server callers. Needs the three env
  vars and a reachable server; the bus needs neither.

## Subplans

none

## Failure modes

> **Critical gap (accepted):** a job that fails in every run. The trigger
> clears the marker when the reactor ran (`wakeupDrainedJobs` ignores
> `jobsRemaining`), so nothing retries that job on its own, but it rides into
> every later triggered batch and costs a share of each run. Handling: the
> `stalled-jobs` health check names it after 7 days. Accepted because a
> per-job attempt count is a new concept with no second use yet; see open
> question 3.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A request lands while a run is in flight; the run clears the marker and the request is lost | new (Track B) | compare-and-clear | clear (marker survives; trigger re-arms) |
| Deploy kills the wakeup child mid-run (`KillMode=control-group`) | new (Track B) | attempt counted before the run; marker kept; startup re-arms | clear (attempt count; log on abandon) |
| Wakeup child OOMs the box cgroup on every run | new (Track B) | budget abandons after 6 attempts; `wakeup-abandoned` written | clear (error log names the file) |
| Scheduled scoped wakeup holds the cycle lock when the trigger fires | existing rule test (`wakeupSatisfiedScanPromote`) | not ok → retry at 2 min | clear (log line per retry) |
| Server idle-exits while a triggered wakeup runs | new (`decideIdle` with `liveRuns`) | live wakeups keep it up | clear |
| Server idle-exits with a retry timer pending | none needed | marker durable; next start re-arms | clear on next start; late, not lost |
| CLI `bbx answer` with no server running | new (Track D output test) | marker waits for startup | clear (CLI line), except unit host idle (open question 5) |
| `wakeup-requested` row written by a newer engine than the server | none | generation bump; older engine refuses to open (`core.ts:58-69`) | clear |
| Finalize child cannot reach the server (hub down, DNS) | new (Track A) | `NotifyServerError`; nudge latch not stamped; next finalize retries | clear (finalize log line) |
| Pass child on idle unit host has no `BBX_BOX_NAME` | new (Track A, `buildEnv` test) | unit-host URL fallback | was silent; becomes routed |
| Server answers `notifications.send` but its own APNs key file is unreadable in the sandbox | none | delivery logged `failed` by the server | clear in the notification log (key placement verified on production, see What already exists) |
| Legacy scan marker under `_tmp/scan-quarantine/` after deploy | new (Track B) | moved on first read | clear |
| Two servers for one box during a drain (old draining, new started) both run the marker | new (Track C) | cycle lock: one skips; skip is not ok → retry; compare-and-clear keeps the marker coherent | clear |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field.** An agent writes a job card by hand with
  `connector: gmail` for unscoped work: the gmail tick runs it, which is fine.
  An agent writes an unscoped job by hand: no trigger fires; it rides on the
  next triggered run. GAP, accepted; see NOT in scope.
- **Stale ref.** A follow-up job whose question was deleted before the run:
  existing `cleanupStaleJobs` (`steps.ts:92-185`) deletes jobs whose refs are
  all gone, inside the same triggered wakeup. ADDRESSED.
- **Two agents touching the same card.** A chat answers a question
  (`--via chat`, no job) while the reactor runs a follow-up for another: no
  shared card. A follow-up and a chat both editing the answered card: the
  existing question transition lock (`withQuestionTransition`) covers the
  answer write; the follow-up edits other cards. ADDRESSED by existing locks;
  no new writer.
- **Hand-edit drift.** A person deletes `.beebox/wakeup-pending`: the trigger
  finds nothing owed; the job waits for the next action. A person deletes
  `wakeup-abandoned`: the next request runs. ADDRESSED (both are documented
  in the abandon log line, `wakeup.ts:175-179`).
- **Fabricated free-form value.** No new agent-written field. Not applicable
  because the design adds no agent-facing value.
- **Validation error UX.** The CLI line in Track D is for a person at a
  shell. The finalize log line names the question and the server error.
  ADDRESSED.
- **Partial rollout.** During a deploy an old server runs scan's inline
  wakeup while the new code writes `.beebox/wakeup-pending`. The new server
  moves the legacy marker on its first read. Mixed engines on one box last
  only for the restart. ADDRESSED.
- **A burst that straddles a run.** Answers keep arriving during a run: they
  rewrite the marker and set `again`; one more run follows. ADDRESSED.
- **Tab arrangement from the extension.** It lands in the inbox and opens a
  chat about it (`clerk.ts:111`, `:138`). Not triggered; a later full wakeup
  may still job it, as today. DEFERRED (existing behavior).

### Scenario walks

Each walk is the planned code on a unit host. "Today" says where the current
code stops.

**1. Answer a question in the web UI; the follow-up runs.**

1. Browser → hub → socket → box server. `actions.answer`
   (`beebox/src/webapp/trpc/routers/actions.ts:57-60`) calls
   `answerWithAdmission` with `via: "web"`.
2. `executeAnswer` writes the follow-up job, then the answered card, and
   commits (`beebox/src/core/commands/answer.ts:265-284`).
3. New: `requestWakeup(boxRoot, { reason: "question answered" })` writes
   `.beebox/wakeup-pending` and emits `wakeup-requested`.
4. Within 1 s the server bus poll (`core.ts:460-475`) delivers the event to
   `startWakeupTrigger`; the debouncer arms 2 minutes of awake time.
5. The window ends. The trigger takes a fresh admission and calls
   `runPendingWakeup`: attempt recorded, marker text read, `runBbxWakeup`
   spawns `bbx engine wakeup` with the tooling env (`wakeup.ts:54-70`); the
   live-wakeup count is 1.
6. The child takes the cycle lock (`cycle-lock.ts:44-46`), runs steps 1-4d,
   then the reactor with no filter, `maxCycles: 1`, `skipLowPriority: true`
   (`command.ts:76-82`). Discovery finds the follow-up job (normal), so every
   pending job is selected (`cycle.ts:145-147`). One agent session works the
   batch and calls `bbx finish` per job.
7. `runFinalize` spawns `bbx finalize` (`subprocess.ts:52-54`). Its env reads
   the endpoint file, so the three box vars are set; nudges and alerts go
   through `notifications.send` (Track A).
8. The child pushes, prints its outcome line, exits. `wakeupDrainedJobs`
   says ok; the marker text is unchanged, so it is deleted; attempts cleared.
9. What the person sees: the question shows answered at once; the
   follow-up's effects (edited cards, a new question, a notification) appear
   a few minutes later. Left behind: commits; no marker.

Today the walk stops after step 2: the job waits for an unscoped wakeup that
no schedule runs.

**2. Scan upload burst (26 sessions in a few minutes); one intake run.**

1. Each PUT lands in quarantine and calls `notifyScanUpload`
   (`promote-lifecycle.ts:141-147`), which re-arms the 2-minute promote
   settle window. Activity keeps the server up.
2. Two minutes after the last PUT, one promote pass runs under the promotion
   lock (`scan/promote/core.ts:223-250`). It marks the wakeup owed before
   import (`:185-188`), runs `bbx upload --as scan` per credential group, and
   `scan-import` appends the sessions to the unscoped normal intake job
   (`session-discard.ts:92`).
3. New: instead of running the wakeup inline (`:266`), the pass calls
   `requestWakeup(..., { settleMs: 0 })`. The trigger runs at once.
4. Steps 5-8 of walk 1 follow. One agent session gets one intake job holding
   every session from the burst.

Today: the same, except the wakeup runs inside the promote pass. The
26-session job in production predates `2e477780c` (2026-09-29), when scan
intakes stopped getting their own `-scan.intake` file; a triggered run that
leaves a job pending is not retried (see the critical gap). Whether that is
why it stalled is unverified: box content was not read.

**3. Phone capture → filed.**

- With words: the capture is delivered to a chat (`quick-capture/runtime.ts:24-29`,
  `processCapture`). The chat agent files it. No job, no wakeup. Unchanged.
- Without words: the 60-second lifecycle sweep (`runtime.ts:53-74`) runs the
  filing sweep, which appends the capture's doc to the unscoped intake job
  and commits (`filing-sweep.ts:86-88`), then starts its own full wakeup
  (`runtime.ts:42`). New: that child is counted by the idle decision. The
  agent retitles or moves the doc; the next sweep sees it filed
  (`filing.ts:1-5`). Unchanged otherwise.
- A capture whose browser vanished: the server's 10-minute sweep seals it as
  partial and fires preparation (`capture/register.ts:63-77`). Unchanged.

**4. CLI `bbx answer` on the server.**

1. Operator: `sudo -u bbx-<slug> -H bash -lc '... bbx answer <path> "yes"'`.
   `executeAnswer` writes the job and the card (`cli/commands/answer.ts:25-27`).
2. `requestWakeup` writes the marker and inserts a `wakeup-requested` row in
   `.beebox/events.db`.
3. Box server running: its bus poll reads the row; walk 1 from step 4.
4. Box server not running (idle exit): nothing reads the row. The marker
   waits. The next request to the box starts the server; `startWakeupTrigger`
   finds the marker at registration and arms the window; walk 1 from step 5.
   The CLI prints the follow-up line; open question 5 covers starting the
   server from the CLI.

**5. The box server idle-exits mid-burst.**

- During a burst, each request sets `lastActivityAt` (`idle-exit.ts:71-77`),
  so `decideIdle` returns `recent-activity` for 30 minutes after the last one.
  An exit cannot start inside a burst.
- After the burst, while the triggered wakeup runs, `liveRuns` includes the
  live wakeup, so `decideIdle` returns `live-runs` (`idle-exit.ts:44`). The
  server stays up and serves requests.
- The run ends; 30 minutes after the last activity the server drains and
  exits 0. The marker is gone, or kept with a retry delay; a kept marker
  re-arms at the next start.
- Today: the server can start its drain while a scan or filing wakeup runs.
  It closes its listener (`idle-exit.ts:129`) and its `onClose` waits for the
  pass (`promote-lifecycle.ts:216`), so new requests wait in systemd's socket
  queue until the run ends. Found by reading; not observed.

## NOT in scope

- **Wordless-capture filing's own wakeup.** It has a per-capture kick budget
  and a "Filing is waiting" state the person sees
  (`beebox/src/core/quick-capture/filing.ts:12`). Moving it onto the trigger
  changes that state machine. It already gets the idle-exit protection
  through `runBbxWakeup`'s counter.
- **A per-job attempt count.** No second use yet; see the critical gap.
- **Triggering for hand-written job cards.** The Write tool bypasses any hook
  `bbx create` could add. They ride on the next triggered run.
- **Question aging on boxes with no wakeups at all.** Finalize runs only after
  a reactor run (`beebox/src/core/reactor/engine/core.ts:158-163`). Triggers
  add runs; a box with no actions and no connector schedules still never ages
  questions. The daily `question-review` procedure is the existing backstop.
- **Widening the tooling allowlist with push keys.** Rejected by the
  boxholder.
- **Unfiled captures in `tmp-capture/`.** The health check counts delivered
  capture cards the chat agent did not file
  (`beebox/src/core/capture/sweep.ts:22-24` *"filing them is the chat agent's
  duty, per the schema instructions"*). No wakeup files them.
- **Fixing the stale "UI Sync button" comment** beyond one line in Track D's
  commit.

## Open design questions

1. **Contains backfill and other low-priority unscoped work.** No action owns
   "a card lacks `contains:`", so no trigger can own it. Under this plan it
   rides along: when a triggered run has normal work, discovery selects every
   pending job, low-priority included (`beebox/src/core/reactor/engine/cycle.ts:145-147`
   *"if (skipLowPriority && !hasNormalPriority)"*), and a triggered wakeup
   queues the next 25-card batch before its reactor step
   (`command.ts:209-219`). On a box with no actions it waits. Options:
   (A) ride-along only; (B) the least periodic guaranteed option: a daily
   schedule `bbx engine wakeup` whose precheck skips unless an unscoped job is
   older than 24h. Lean: A, with the `stalled-jobs` check as the signal; B
   only if a box shows a backlog. The same answer covers the low-priority
   `inbox-low` intake job.
2. **Should a triggered run sync connectors?** A full wakeup runs every
   configured connector (`beebox/src/cli/commands/wakeup/connectors.ts:58-61`)
   and on-wakeup scripts (`command.ts:142-153`), even when the boxholder
   disabled the check-email schedule. Scan and filing triggers do this today.
   Lean: keep the full wakeup (one cycle, existing precedent); revisit if a
   boxholder disables a connector schedule to save cost.
3. **A job that fails every run.** See the critical gap. Lean: accept and
   watch `stalled-jobs`.
4. **How the one-time drain runs.** Operator shell (Track E) or the boxholder
   asking the box's chat to run `bbx force-wakeup`, which runs the same cycle
   in the box server inside the sandbox (`beebox/src/cli/commands/force-wakeup.ts:8-12`).
   Lean: operator shell, because it allows the dry run first.
5. **CLI `bbx answer` while a unit-host box server is idle.** The marker
   waits for the next request to the box. Option: the CLI connects to the
   box's socket once to start the server. Lean: wait; the CLI answer is an
   operator path, and the next app visit starts the server.

## Knowledge audits

Skipped: infrastructural. No agent-facing concept changes. Agents still answer
with `--via chat`, which writes no job and no trigger. `bbx notify` output
does not change.

## What will hold this after it ships

All tiers are `t.check` tests. Each names one claim that could be wrong.

- **Route choice** (`routedSender`): with the three env vars set, `send`
  calls the server and never `notifyBoxholder`; with one missing, it sends in
  process. Example: a filesystem test with a fake tRPC client asserting no
  in-process delivery line is logged.
- **Nudge retry on server failure** (`ageQuestions` with a throwing sender):
  the latch has no `nudged` entry for that question afterwards. Example: one
  pending question past its nudge threshold, sender throws; assert the latch.
- **Alert does not swallow** (`checkPendingQuestionsAndNotify` with a sender
  whose `reach()` throws): the call rejects and the latch file is unchanged.
- **Unit-host box name** (`buildEnv`): with `BBX_UNIT_HOST=1`, no endpoint
  file, `BBX_PUBLIC_URL=https://h`, box at `/var/lib/beebox/fam/box`, the env
  has `BBX_SERVER_URL=https://h` and `BBX_BOX_NAME=fam`.
- **Compare-and-clear** (pure helper `shouldClearMarker(before, after)` plus
  one filesystem test): a marker rewritten during the run survives.
- **Attempt before run**: a runner that throws (simulated kill) leaves
  attempts at 1 and the marker in place.
- **Legacy marker move**: a file at `_tmp/scan-quarantine/wakeup-pending`
  is at `.beebox/wakeup-pending` after the first read.
- **Trigger debounce and single-flight** (`startWakeupTrigger` with an
  injected `run` and a fake clock, as `promote-debounce` tests do): five
  `wakeup-requested` events inside the window cause one run; an event during
  a run causes exactly one more.
- **Cross-process hearing**: an event emitted on a second `createEventBus`
  instance reaches the server bus listener (route test via
  `makeTestServer()`).
- **Startup**: a marker present at registration causes one run after the
  settle window; an abandoned one causes none.
- **Idle decision** (`decideIdle`): `liveRuns` from a live wakeup keeps the
  server up.
- **Answer trigger**: a web answer route test asserts the marker exists and
  one `wakeup-requested` row was written; a `--via chat` answer writes
  neither.
- **Scan delegation**: a promote pass that imports files writes the marker
  and the event, and no longer spawns a wakeup itself (injected runner never
  called).

No new tier and no new mock beyond the existing injected `run` seams. The
tests for the moved scan marker move with it.

## Implementation order

1. Track A first chunk: `NotifySender`, `routedSender`, finalize senders,
   `bbx notify` on `routedSender`. Commit.
2. Track A rest: `buildEnv` unit-host fallback; on-wakeup `notify:` actions and
   promotion through `sender`. Commit.
3. Track B: move the marker module, legacy read, compare-and-clear,
   attempt-before-run. Scan still calls it inline. Commit.
4. Track C: `requestWakeup`, `wakeup-requested`, `startWakeupTrigger`,
   live-wakeup idle signal. Depends on 3. Commit.
5. Track D: answer trigger; then share and commentary; then scan delegation
   (removes scan's inline wakeup). Depends on 4. Commits per call site.
6. Docs: `beebox/docs/design/processing.md` ("recurring runs come from the
   `bbx tick` daemon" becomes triggers), `beebox/src/core/reactor/DESIGN.md:58`,
   the scan doc comments, the stale Sync-button comment, and the Track E
   runbook in `beebox/deploy/README.md`. Commit.
7. After the boxholder says to land and deploy: Track E on the two
   production boxes with stalled jobs, with a separate yes for touching production.

## Rollout shape

Tests first, per chunk, as listed in *What will hold this*. Done when every
test there passes, change-selected tests pass, and `pnpm typecheck` and
`pnpm layout-check` pass from `beebox/`.

No data migration beyond the marker move in Track B, which is read-time and
needs no script. The event-schema bump truncates persisted bus rows on first
open, the existing resync path (`beebox/src/core/event-bus/core.ts:31-36`).

No knowledge audits land with this plan (see Knowledge audits).

After deploy: read one production box's notification log for a
`question-nudge` delivery that went through the server, and the box server's
journal for the trigger's run after an answer. Then run Track E.
