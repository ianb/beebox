---
title: "On-demand job triggers and server-routed finalize notifications"
status: draft
workstream: box-isolation-followups
issues: []
---
# On-demand job triggers and server-routed finalize notifications

Jobs that carry no `connector:` field never run on a deployed box, because
every scheduled wakeup is connector-scoped. This plan adds a cheap check to
the scheduler pass that already runs about once a minute: when an untagged
normal-priority job is waiting and no wakeup is running, the pass starts one
full wakeup. A failing job is retried with a growing delay and then given up.
The plan also makes the notifications that `bbx finalize` sends go through the
box server, which holds the push keys.

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
directive"*), and question nudges already promise a phone notification. No new
text or surface reaches a person.

## Smallest fix and budget

**Boxholder decision (after round-2 review), as presented and chosen.**
*"Each minute the existing pass does a cheap file scan. If an untagged
normal-priority job is waiting and no wakeup is running, it starts one full
wakeup. It catches every way a job appears (web, CLI, agent, edits, crashes)
with no per-action wiring, no new lock in commits, and no socket wake. A job
that keeps failing is retried with a growing delay (say 1 h, then 6 h, then
daily) so it can't loop. Latency: about a minute. No agent runs unless work
exists."* It replaces the commit-hook trigger of the previous revision, which
round 2 rejected for running a rejected commit's job, reversing the lock
order inside a commit, and missing edits to existing job cards.

**Smallest fix.** Run `bbx engine wakeup` inline from the pass whenever an
untagged job exists, plus `notifyRoute()` in finalize. About 40 source lines.
It blocks every other box's pass for the length of an agent run (passes are
serial, see What already exists), dies with the pass unit at 30 minutes, loops
on a failing job every minute, and keeps the alert latch written before the
send.

**Chosen release.**

| Track | Source lines (add + delete) | Test lines |
|---|---|---|
| A. Finalize notifications through the box server | ~120 | ~130 |
| B. The pass's job check, with per-job backoff | ~165 | ~150 |
| C. Starting the wakeup: server `wakeup.start`, idle protection, `--max-cycles` | ~65 | ~70 |
| D. Backlog after deploy (no runbook; a note and a watch step) | 0 | 0 |

Total about 350 source and 350 test lines. Authored docs about 70 lines
(`beebox/docs/design/processing.md`, `beebox/docs/scheduler.md`,
`beebox/src/core/reactor/DESIGN.md`). No generated output. Not a BIG CHANGE.
The previous revision was about 460 source and 450 test lines; the shared
durable marker, the commit hook, the socket wake, and the in-wakeup guard are
gone.

The chosen release buys over the smallest fix: a pass that stays short (the
long run happens in the box server, or detached on a non-unit host); a
durable per-job record, so a failing job costs a few runs, not one a minute;
a hard daily bound on runs; and notifications that reach the phone.

## Stated preferences this plan trades against

- **Boxholder decision: a check in the scheduler pass** (quoted above). No
  per-action wiring, no commit hook, no socket wake. Latency of about a minute
  is accepted.
- **Boxholder decision: triggers, not a recurring unscoped wakeup.** *"I want
  backfill to be an exception, and ideally everything is handled with
  triggers."* The pass check is periodic, but it starts a run only when a job
  is waiting, so it is a trigger on the state of the jobs directory, not a
  clock-driven wakeup: an idle box runs no wakeup and no agent.
- **Boxholder decision: finalize notifications go through the box server**,
  like `bbx notify`. The tooling env allowlist keeps the APNs and VAPID keys
  out (`beebox/src/core/script-env/core.ts:203-218`; the notify header
  `beebox/src/cli/lib/notify-route.ts:1-11`).
- **Principle 4, resilient and never silent**
  (`beebox/docs/engineering-principles.md:49`). Today the question alert in a
  tooling child returns `null` without a log line when no channel is
  configured (`beebox/src/core/question-alert.ts:72-73`), and it writes its
  latch before it sends (`:89` before `:105`). Each pass-check decision that
  starts, skips for backoff, or gives up is written to the box's
  `scheduler.jsonl`.
- **Code style: "Nothing retries forever"** (`beebox/code-style.md`,
  Defensiveness item 9: *"Bound a retry in time (a week is acceptable), then
  move the item to a visible terminal state that keeps the user's data."*).
  A job is retried for at most 7 days from its first attempt; the job card
  stays, and the existing `stalled-jobs` health check shows it.
- **Principle 10, testability** (`beebox/docs/engineering-principles.md:116`).
  Eligibility, backoff, the daily bound, the sent rule, and route choice are
  pure functions.
- **Prefer existing primitives; minimize invented concepts** (task brief).
  Reuses the pass, `findJobCards`, `inspectLock` on the existing cycle and
  reactor locks, `runBbxWakeup`, the reactor's bounded cycle loop, the
  `box-client` delegation pattern, and `notifyRoute`. Adds one state file,
  one tRPC mutation, and one wakeup flag.
- **Shipped precedent.** `bbx force-wakeup` delegation to the server
  (`beebox/src/cli/commands/force-wakeup.ts:5-12`), the scan promote retry
  budget (`beebox/src/core/scan/promote/wakeup-retry.ts:27-53`), and
  per-script state under `_config/schedules/.state/`
  (`beebox/src/core/schedule/state.ts:153-195`).

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
- A full wakeup runs one reactor cycle: `beebox/src/cli/commands/wakeup/command.ts:78`
  *"maxCycles: 1,"*. The reactor's own loop already bounds more cycles and
  stops when a cycle makes no progress: `beebox/src/core/reactor/engine/core.ts:152-155`
  *"Stop if no jobs remain or if we didn't process any (stuck)"*; its default
  is 3 (`:213`).

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

**The pass, and how long it may run.**

- One daemon loops over every configured box, one pass at a time, every 60 s:
  `beebox/src/core/schedule/scheduler/core.ts:131-150`; each pass is awaited
  (*"await currentPass;"*) before the next box's starts.
- On a unit host the daemon runs a box's pass through `sudo bbx-box-run
  <slug> scheduler-pass`, which starts `beebox-pass@<slug>.service` and waits
  for it (`beebox/src/core/schedule/scheduler/box-run.ts:1-7`, `:51-59`). The
  pass unit is `Type=oneshot` with `TimeoutStartSec=1800`
  (`beebox/deploy/systemd/beebox-pass@.service`), so anything the pass spawns
  ends with the pass unit's cgroup.
- Elsewhere the daemon calls `runSchedulerPass(boxPath)` in its own process
  (`core.ts:144`), the same function the pass unit runs
  (`pass.ts:31-39`). So one rule in `passBody` covers both hosts.
- Scheduled `runs:` commands already run inline in the pass:
  `beebox/src/cli/tick-helpers.ts:286` awaits `runAndRecord`, bounded by
  `SCRIPT_TIMEOUT` = 10 min (`beebox/src/lib/exec-with-timeout.ts:19`). A
  scoped wakeup that runs an agent already delays every later box's pass by
  its duration. The plan does not add to that.

**Pieces to reuse.**

| What | Where | Reuse or rebuild |
|---|---|---|
| Job discovery with priority and connector | `beebox/src/core/reactor/job-discovery.ts:58-112` `findJobCards` (reads each card's frontmatter) | Reuse; return `connector` as well (one field). |
| "Is a wakeup running?" | `beebox/src/cli/commands/wakeup/cycle-lock.ts:32-34` `wakeupCycleLockPath`; reactor lock `.bbx-reactor.lock` (`beebox/src/core/reactor/engine/core.ts:107`); `inspectLock` (`beebox/src/lib/file-lock.ts:485-496`, *"no side effects, never blocks a concurrent acquirer"*) | Reuse; no new lock. |
| "Is this path in HEAD?" | `beebox/src/core/commands/scan-import/session-discard.ts:75-79` (`git ls-tree -r --name-only HEAD -- <paths>`) | Reuse the same query for candidate jobs. |
| Supervised full-wakeup child | `beebox/src/core/commands/wakeup.ts:46` `runBbxWakeup` | Reuse; add a `maxCycles` pass-through and a live-child count. |
| Server-side wakeup on behalf of a shell | `beebox/src/webapp/trpc/routers/wakeup.ts:56-85` `wakeup.force` (awaits the whole run) | Add a sibling `wakeup.start` that does not wait. |
| Client for the box's own server | `beebox/src/cli/lib/box-client.ts:45-67` `boxClient()` (reads three env vars) | Reuse; take the env as an argument so the pass can pass computed values. |
| Box-env cascade for those values | `beebox/src/core/script-env/core.ts:143-162` | Extend with the unit-host fallback (Track A); the pass reads the same three values. |
| Idle decision | `beebox/src/webapp/server/idle-exit.ts:41-48` `decideIdle` | Extend with live wakeup children. |
| Per-box machine state, JSON, beside the cycle lock | `.beebox/` (`cycle-lock.ts:31-34` *"Gitignored, like the reactor's lock and the scheduler heartbeat"*) | New file `.beebox/job-check.json`. |
| Pass log | `beebox/src/core/schedule/scheduler/box-log.ts` `writeBoxLog`, used throughout `pass.ts` | Reuse for start, skip, and give-up lines. |
| Server-side notification send | `beebox/src/webapp/trpc/routers/notifications.ts:74-87` | Reuse unchanged. |
| Route choice for `bbx notify` | `beebox/src/cli/lib/notify-route.ts:24-28` `notifyRoute()` | Reuse. |
| "Did the notification reach anyone?" | `beebox/src/core/notify-boxholder.ts:69-71` `notificationReached`; `beebox/src/core/schedule/run-action.ts:83-86` (*"const final = !result.deliveries.some((d) => d.status === \"failed\");"*) | Reuse both for the latch rule (Track A). |
| Stalled-jobs health check | `beebox/src/webapp/trpc/routers/health/checks/stale.ts:57-93` (7 days) | Reuse as the visible terminal state. |
| Scan's own wakeup runner | `beebox/src/core/scan/promote/wakeup.ts` | Untouched. |

**Job writers in the code today** (searched every `.job.card` writer and every
`createOrAppendIntakeJob` caller). The pass check does not depend on this
list; it reads the jobs directory.

| Job | Writer | Connector tag | Priority | Trigger today |
|---|---|---|---|---|
| `question-followup` | `beebox/src/core/commands/answer.ts:265` (web and CLI; not `--via chat`) | none | normal | none |
| intake (scan session + review questions) | `beebox/src/core/commands/scan-import/session-discard.ts:92` | none | normal | scan promote wakeup (`beebox/src/core/scan/promote/core.ts:266`) |
| intake (wordless captures) | `beebox/src/core/quick-capture/filing-sweep.ts:86` | none | normal | filing wakeup (`beebox/src/webapp/routes/quick-capture/runtime.ts:42`) |
| intake (unjobbed inbox items) | `beebox/src/cli/commands/wakeup/steps.ts:342` | the scoped connector, else none | normal; low for `.capture-session`, `.image`, `.audio` (`:216-217`) | created inside a wakeup |
| `contains-backfill` | `beebox/src/cli/commands/wakeup/steps.ts:404-433`, on every wakeup, scoped ones included (`command.ts:200-219` is not gated on `--connector`) | none | low | none |
| any job an agent writes (chat, procedure, reactor) | chat prompt `beebox/src/core/chat/session/prompts.ts:32` | none | as written | none |

**Inbox items without a job.** Share-to-inbox
(`beebox/src/webapp/trpc/routers/share/router.ts:90`) and extension
commentary (`beebox/src/webapp/trpc/routers/clerk.ts:60`) write inbox cards
and no job. Only a full wakeup's step 4b jobs them. The pass check sees jobs,
not inbox cards, so these wait for the next full wakeup that something else
starts; see open decision 5.

**What a capture with words can create.** The quick-capture worker delivers
it to a chat (`beebox/src/webapp/routes/quick-capture/runtime.ts:24-29`).
Only the chat agent acts after that: it files the capture (no job), answers
an open question with `--via chat` (no job, `answer.ts:263-265`), writes a job
card for long work (`prompts.ts:32`), or writes an inbox card. A job card it
writes lands in the jobs directory, where the pass check finds it once it is
committed.

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

**Box-client inputs.** `boxClient()` needs `BBX_SERVER_URL`, `BBX_BOX_NAME`,
`BBX_AGENT_TOKEN` (`beebox/src/cli/lib/box-client.ts:26`). `buildEnv` sets
them (`beebox/src/core/script-env/core.ts:148-159`): *"const publicUrl =
ambient ?? endpoint?.publicUrl ?? config.publicUrl ?? process.env.BBX_PUBLIC_URL
?? process.env.PUBLIC_URL;"*, then `parsePublicUrl` takes the box name from
the URL path (`:111-115`).

- (a) Reactor started by the box server. The server publishes
  `${BBX_PUBLIC_URL}/${slug}` for a socket listener
  (`beebox/src/webapp/server/serve-publish.ts:21-24`, `:44-50`) and writes the
  endpoint file. The `bbx engine wakeup` child reads that file, so its
  finalize child gets all three. **Present.**
- (b) Anything started from the pass unit while the box server is idle. The
  endpoint file exists only while the box server runs; shutdown removes it
  (`beebox/src/webapp/server/app.ts:364`). After an idle exit
  (`--idle-exit 1800000`, `beebox/deploy/systemd/beebox-box@.service:35`) the
  fallback is `BBX_PUBLIC_URL`, the host's base URL with no path, so
  `BBX_BOX_NAME` is not set unless `_config/box.json` pins `publicUrl`.
  **Missing while the server is idle.** This matches the production log line
  `question-nudge apns skipped unconfigured`, and it is the same gap the pass
  check must close to reach the server (Track B).

## Prior art (external)

One external premise: on a unit host, a request to the box's public URL
reaches an idle box because the hub connects to the box's socket, which
starts the unit. The repo relies on this already:
`beebox/src/hub/socket-provider.ts:204` *"Connect to the socket (which starts
the unit)"*, and `serve-publish.ts:16-18` (*"the hub proxies an agent-bearer
request back to it"*). systemd socket activation, `Accept=no`:
<https://www.freedesktop.org/software/systemd/man/latest/systemd.socket.html>.
Evaluated-only. No other decision depends on an external premise.

## Ontology

- **Unscoped job** (existing name: `beebox/src/job-cards/intake-utils.ts:11`
  *"its items join the unscoped normal-priority job"*). A job card with no
  `connector:`. Only a full wakeup or `bbx reactor` runs it.
- **Full wakeup** (existing: `beebox/src/cli/commands/wakeup/steps.ts:189`
  *"Under a full wakeup"*). `bbx engine wakeup` with no `--connector`.
- **Waiting job** (new term, pure predicate `isWaitingJob`). An unscoped job
  with normal priority whose card is in `HEAD`. Not a low-priority job (it
  rides along), not a connector's job (its scoped wakeup owns it), not an
  uncommitted card (a write in progress or a rejected commit).
- **Job check** (new pass step, `checkWaitingJobs`). Runs once per pass,
  after the tick. Decides whether to start a full wakeup and records what it
  did.
- **Job-check state** (new file, `.beebox/job-check.json`). Per job file: the
  content hash it was attempted with, the attempt count, the first attempt
  time, and the next eligible time. Per box: runs started today. Machine
  state; not committed.
- **Job backoff** (pure, `nextAttemptAt(attempts, firstAttemptAt)`). After
  attempt 1: +1 h; after attempt 2: +6 h; after 3 or more: +24 h; none after
  7 days from the first attempt (given up).
- **Given-up job.** A waiting job past its 7-day window. The check never starts
  a run for it again; it stays in the jobs directory and in `stalled-jobs`.
- **`wakeup.start`** (new tRPC mutation). Ask the box server to start one full
  wakeup now and return at once. Distinct from `wakeup.force`, which waits and
  reports.
- **Live wakeup children** (new count). How many `runBbxWakeup` children this
  process is waiting on. Read by the idle decision.
- **Notify sender** (new type, `NotifySender`) and **sent** (rule) — Track A,
  unchanged from the previous revision.

## Tracks / scope

### Track A — Finalize notifications through the box server

**What.** The question nudge and the question alert, sent from `bbx finalize`,
go through the box server when the finalize process has the box-client
inputs. A send that did not go out is not latched.

**Why.** The finalize child has no keys, by design. Nudges are logged
`skipped unconfigured`; question alerts return `null` with no log
(`beebox/src/core/question-alert.ts:72-73`), and the alert latch is saved at
`:89`, before the send at `:105`, so a failed alert is never retried.

**Direction.**

- `beebox/src/core/notify-boxholder.ts`: add
  ```ts
  export interface NotifySender {
    send(request: NotifyRequest): Promise<NotifyResult>;
    reach(): Promise<ChannelFlags>;
  }
  export function inProcessSender(boxRoot: string, services?: NotifyServices): NotifySender;
  export function notificationSent(result: NotifyResult): boolean;
  ```
  **Sent** means `notificationReached(result)` is true, or no delivery has
  status `failed` (nothing can carry it, so a retry cannot help; the same rule
  as `run-action.ts:83-86`). A thrown call, or a `failed` delivery that
  reached no one, is not sent.
- `beebox/src/cli/lib/notify-route.ts`: add
  `routedSender(boxRoot: string, services?: NotifyServices): NotifySender`.
  `server` route: `send` calls `notifications.send.mutate` with the input
  shape `bbx notify` sends (`beebox/src/cli/commands/notify/command.ts:184-190`);
  `reach` calls `notifications.channels.query()`. Both wrap in `onServer`.
  `local` route: `inProcessSender`. `bbx notify` is not changed.
- `ageQuestions(boxRoot, { push?, sender? })` and
  `checkPendingQuestionsAndNotify(boxRoot, { now, push?, sender? })` use
  `sender ?? inProcessSender(boxRoot, { push })`.
- **Nudge.** Per question: if the send throws or is not sent, log
  `Question nudge for <path> not sent: <detail>` and leave
  `latch.nudged[path]` unset.
- **Alert.** `reach()` first; a throw propagates to `finalizeQuestions`'
  existing catch (`beebox/src/cli/commands/finalize.ts:39-44`) and nothing is
  saved. Save the latch after the send: `paths` is the pending set minus the
  fresh paths when not sent, the full pending set when sent.
- **Bound.** A question that cannot be nudged or announced is retried at each
  finalize until it leaves `pending` (answered, dismissed, or expired by the
  same aging pass).
- No fallback to in-process delivery (`notify-route.ts:9-11`).
- `finalize.ts:56` passes `{ sender: routedSender(boxRoot) }`.
- `buildEnv` (`beebox/src/core/script-env/core.ts`): when there is no ambient
  URL and no endpoint file, and `onUnitHost()` is true, use
  `${getPublicUrl("")}/${slugOfBoxRoot(boxRoot)}` before `config.publicUrl`.
  On a unit host the hub starts the box on demand, so the URL is valid
  whether the server runs or not. Export the three-value derivation as
  `boxServerEnv(boxRoot)` so the pass can use it (Track B).
- `boxClient(env = process.env)`: the reader takes its env as an argument.
  Existing callers are unchanged.

**Vocabulary lock-ins.** `NotifySender`, `inProcessSender`, `routedSender`,
`notificationSent`, `boxServerEnv`.

**First chunk.** `NotifySender`, `routedSender`, `notificationSent`, the nudge
and alert changes, finalize passing the sender, with tests. Then the
`buildEnv` fallback and `boxServerEnv`. No open question.

### Track B — The pass's job check, with per-job backoff

**What.** One step in `passBody` that finds waiting jobs, applies backoff and
the daily bound, and starts one full wakeup when one is due.

**Why.** Nothing starts a full wakeup on a deployed box when a job appears.
The pass already runs about once a minute for every box, as the box's user, on
every host.

**Direction.**

- **Where.** In `passBody` (`beebox/src/core/schedule/scheduler/pass.ts`),
  after the tick is logged (`:91-103`) and before `runBoxAlerts` (`:109`).
  After the tick, so a scoped wakeup that the tick ran inline has released
  the cycle lock. In its own `try`, logged with `writeBoxLog` as event
  `job-check`, so a check failure never affects the tick or the alerts.
- **Cheap path.** `findJobCards(jobsDir)` (one `readdir` and one frontmatter
  read per card; the jobs directory holds a handful of cards). Keep the cards
  with no `connector` and `priority: normal`. If none, prune the state file
  of entries whose files are gone and return. No git, no network, no log
  line. This is every minute on an idle box.
- **Committed only.** For the candidates, one `git ls-tree -r --name-only
  HEAD -- <paths>` (the `session-discard.ts:75-79` query). A card not in
  `HEAD` is not waiting this minute. Reason: an answer writes the job and
  commits within the same request, so a committed job is the box's work; an
  uncommitted one is a write in progress, or a commit that was rejected
  (round-2 finding 2). A card an agent writes and never commits does not start
  a run; it rides along with the next run that something else starts.
- **Waiting job eligibility** (pure `isWaitingJob` + `dueJobs(state, jobs,
  now)`). A waiting job is due when it has no state entry, or its content hash
  differs from the entry's (an appended item or other edit is new work, round-2
  finding 5: the entry is reset to attempt 0), or `now >= nextAt` and it is
  not given up.
- **No wakeup running.** `inspectLock(wakeupCycleLockPath(boxRoot))` and
  `inspectLock(<boxRoot>/.bbx-reactor.lock)`. A live holder of either means
  a wakeup (full or scoped), `bbx reactor`, or scan's or filing's own wakeup is
  running; skip this minute without changing state. A stale holder reads as
  free (`inspectLock` returns null for stale).
- **Daily bound.** At most `JOB_CHECK_RUNS_PER_DAY` (24, open decision 2)
  runs started per box per box-time day, counted in the state file. At the
  bound, log one `job-check` line per day and start nothing.
- **Start** (Track C does the starting). If the start succeeds, stamp every
  due job: `attempts += 1`, `firstAttemptAt` if unset, `hash`,
  `nextAt = nextAttemptAt(...)`; increment today's count; log `job-check
  started` with the job files. If the start fails, change no state and log
  it; the next pass tries again. The next pass then finds the cycle lock held
  and skips until the run ends.
- **After a run.** Nothing waits for the run. The next passes see what is
  left: a finished job's file is gone and its entry is pruned; a job left
  behind (it failed, or the run's cycles ran out, round-2 finding 3) is due
  again at its `nextAt` (1 h after the first attempt); a job written during
  the run has no entry and is due at once.
- **Give up.** When `nextAttemptAt` returns none (7 days after the first
  attempt), mark the entry given up and log `job-check gave up on <file>` once.
  The job card stays; `stalled-jobs` names it.
- **State file.** `.beebox/job-check.json`, zod schema, written with
  `writeFileAtomic` (`beebox/src/lib/atomic-write.ts`, as the endpoint file
  is). One writer per box: passes for a box are serial (`core.ts:131-150`), and
  the pass unit is a oneshot. An unreadable file is logged and treated as
  empty, which can cost one extra run, not a loop: the next stamp rewrites it.
- **Which jobs count, decided.** Only unscoped jobs. A job tagged with a
  connector whose schedule is disabled is not counted: it is created only by a
  scoped wakeup of that connector, which the boxholder ran on purpose
  (`bbx force-wakeup --connector`, or the schedule before it was disabled), and
  matching a connector name to a schedule would need parsing `runs:` strings,
  which nothing does today. Such a job still runs in any full wakeup (no
  filter), so it rides along.
- **Low priority, decided.** A low-priority job never starts a run. It rides
  along: a full wakeup with normal work selects every pending job
  (`beebox/src/core/reactor/engine/cycle.ts:145-147`), and the reactor's 24 h
  deadline (`cycle.ts:117`) runs overdue ones in any full wakeup.

**Vocabulary lock-ins.** `checkWaitingJobs`, `isWaitingJob`, `dueJobs`,
`nextAttemptAt`, `.beebox/job-check.json`, `JOB_CHECK_RUNS_PER_DAY`, box-log
event `job-check`.

**First chunk.** The pure functions (`isWaitingJob`, `dueJobs`,
`nextAttemptAt`, the daily bound) and the state file, with tests. Then the
pass step with an injected starter. No open question.

### Track C — Starting the wakeup

**What.** A way for the pass to start a full wakeup that outlives the pass,
and protection for that run.

**Why.** On a unit host the pass unit is a oneshot: a child it spawns is
killed with the unit's cgroup when the pass ends, and a run inside the pass
holds every other box's pass behind it (`core.ts:131-150`) and dies at
`TimeoutStartSec=1800`. The box server is a long-lived process in its own unit
and already runs supervised wakeups (`wakeup.force`, scan, filing).

**Direction.**

- **Unit host** (`onUnitHost()`): the pass builds a client with
  `boxClient(await boxServerEnv(boxRoot))` (Track A) and calls
  `wakeup.start.mutate({ reason: "job-check" })` with a 30 s timeout, the
  hub's readiness bound (`beebox/src/hub/socket-provider.ts`, `READY_TIMEOUT_MS`).
  The request goes through the hub, which starts an idle box. The pass waits
  for the mutation's answer, not for the run.
- **Other hosts** (the daemon runs the pass in its own long-lived process,
  `core.ts:144`): `void runBbxWakeup({ boxRoot, triggeredBy: "job-check",
  maxCycles: TRIGGER_MAX_CYCLES }).catch(log)`; the pass returns at once. The
  daemon's shutdown does not wait for it; a child left running finishes on its
  own, and the cycle lock keeps a later one from overlapping. A one-shot `bbx
  engine scheduler pass` on such a host keeps its process alive until the child
  exits, because `runCollectedChild` holds the child's pipes.
- **`wakeup.start`** in `beebox/src/webapp/trpc/routers/wakeup.ts`. Same
  caller check as `notifications.send` (the box's agent or its signed-in
  owner, `notifications.ts:33-38`). If this process already has a run in
  flight for the box, or `inspectLock` finds the cycle lock held, return
  `{ started: false, reason: "running" }`. Otherwise start
  `withoutBoxWork(() => withBoxWork({ boxRoot, reason: "job-check wakeup" },
  () => runBbxWakeup({ boxRoot, triggeredBy: "job-check", maxCycles:
  TRIGGER_MAX_CYCLES })))` without awaiting it (the admission wrap is
  `promote-lifecycle.ts:109-119`'s), log its outcome when it ends, and return
  `{ started: true }`. The pass stamps state only on `started: true`.
- **Idle exit counts live wakeups.** `runBbxWakeup` increments a module
  counter before the spawn and decrements it in `finally`.
  `ActivityLedger.signals()` (`idle-exit.ts:88-97`) adds `liveWakeups()` to
  `liveRuns`. A server does not start its drain while a wakeup it spawned
  (job-check, scan, filing, force) runs.
- **`bbx engine wakeup --max-cycles <n>`** (default 1, today's value at
  `command.ts:78`); `runBbxWakeup` passes it. `TRIGGER_MAX_CYCLES` is 3, the
  reactor's own default (`core.ts:213`). The reactor's loop repeats while jobs
  remain and the last cycle processed one (`core.ts:132-156`). Open decision 3.

**Vocabulary lock-ins.** `wakeup.start`, `TRIGGER_MAX_CYCLES`,
`--max-cycles`, `liveWakeups`, `triggeredBy: "job-check"`.

**First chunk.** `--max-cycles` and the live-wakeup idle signal, then
`wakeup.start`, then the two starters, with tests. No open question.

### Track D — The backlog after deploy

**What.** The jobs stalled today (14 to 51 days old on the two production
boxes) are waiting jobs as soon as Tracks B and C are deployed. The first pass
after deploy starts a run for each box. No separate runbook.

**Direction.**

- Nothing to run by hand. Ages do not matter: backoff counts from the first
  attempt, so each old job gets its full 7-day window.
- **Expected cost of the first runs.** One full wakeup per box with up to 3
  reactor cycles: at most 3 agent sessions per box, each capped at 30 turns and
  `maxBudgetUsd: 10` (`beebox/src/core/reactor/engine/batch-jobs.ts:59-71`),
  so at most 6 sessions for the two boxes. Because normal work exists, every
  pending job rides into the first batch, low-priority `contains-backfill`
  and `inbox-low` intake included (`cycle.ts:145-147`). The legacy scan intake
  job holds 26 sessions in one card, so its batch prompt is large and may not
  finish in 30 turns.
- **Worst case for the backlog**, if a job never finishes: retries at +1 h,
  +7 h, then daily to day 7, about 9 runs per box over the week, each up to 3
  sessions (about 27 sessions per box), well under the daily bound.
- **Watch step**, part of rollout: after deploy, read each box's
  `scheduler.jsonl` for the `job-check started` line and the box server's
  journal for the run's outcome, and check `stalled-jobs` a day later. An
  optional `bbx reactor --dry-run` before deploy shows the first batch; it
  reads box content on production, so it needs the boxholder's yes (open
  decision 6).

## Could this be simpler?

**Simplest version.** A scheduled `bbx engine wakeup` every hour. One card,
no code. The boxholder chose triggers over it: it runs agents on a clock
whether or not anything happened, and it waits up to an hour.

**Next simplest: run the wakeup inside the pass.** No server mutation, no
idle change. It fails on: every other box's pass waits behind an agent run
(`core.ts:131-150`); the pass unit kills it at 30 minutes; a 3-cycle run can
exceed that. The server mutation buys a short pass, at about 65 lines.

**Without per-job state.** Start a run whenever a waiting job exists and no
wakeup is running. A job that fails in every run then starts a run every
minute after the last one ends: tens of agent sessions an hour. The state file
buys the boxholder's "can't loop", at about 80 lines.

**Without the committed-only rule.** Saves one git call per minute with
candidates. Costs: a job from a rejected commit, or an answer caught between
its two writes, starts a run. Kept.

**Dropped from the previous revision** (and why the pass check makes them
unnecessary): the shared durable marker with request ids and locks (the jobs
directory and the job-check state are the record); the commit hook and
`BBX_FULL_WAKEUP` (the pass sees every job, however written); the socket wake
(the hub starts an idle box for the pass's request); the bus event and the
debounced trigger lifecycle (the pass's one-minute cadence is the debounce).

**Considered and rejected.**

- Let scoped wakeups also drain unscoped jobs. It undoes `b9ff55a40` and does
  nothing on boxes whose connector schedules are disabled.
- A detached child from the pass unit. systemd kills it with the oneshot's
  cgroup.
- A new root path (`bbx-box-run <slug> wakeup`) and a wakeup unit. A second
  privileged operation for what the box server already does.
- Running the check inside the box server. The server idle-exits, so the check
  would stop exactly when nobody is using the box; the boxholder chose the
  pass.

## Subplans

none

## Failure modes

> **Critical gap (accepted):** a job that fails in every run costs up to
> about 9 runs over 7 days, then is given up. Each of those runs may include
> other work, and the given-up job stays in the jobs directory. Handling:
> `job-check gave up` in `scheduler.jsonl` and `stalled-jobs` in health.
> Accepted per the boxholder's decision ("retried with a growing delay").

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A job fails in every run | new (backoff and give-up tests) | 1 h, 6 h, daily, given up at 7 days | clear (`job-check` lines; `stalled-jobs`) |
| An agent rewrites a failing job each run, so its hash changes | new (hash-reset test) | each change resets to attempt 0; the daily bound caps runs | clear (`job-check started` lines); bounded by the daily cap |
| The box server cannot be reached from the pass (hub down, DNS, 30 s timeout) | new (starter error) | no state change; logged; retried next minute | clear (one `job-check` line per pass) |
| The server is killed mid-run (deploy, OOM) | none needed | job stays; due again at its `nextAt` | late, not lost |
| A run is in flight when the pass checks | new (lock-held test) | `inspectLock` on cycle and reactor locks: skip | clear (no state change) |
| Two passes race for one box (manual `bbx engine scheduler pass` beside the daemon) | none | the second `wakeup.start` returns `running`; the in-process run's cycle lock skips | clear |
| Scan or filing starts its own wakeup just after the pass started one | none | the later one skips on the cycle lock; scan's retry budget handles its skip (`wakeup.ts:126-127`) | clear (existing scan logs) |
| A job card in the working tree but not in `HEAD` | new (uncommitted test) | not waiting; rides along | silent by design; the pass already logs a dirty repo (`pass.ts:51-66`) |
| State file corrupt or unreadable | new | logged, treated as empty; next stamp rewrites it | clear |
| Daily bound reached | new | no more runs today; one line | clear |
| Server idle-exits while the run is in flight | new (`decideIdle` with `liveRuns`) | live wakeups keep it up | clear |
| Finalize child cannot reach the server | new (thrown send) | not latched; next finalize retries until the question leaves pending | clear (finalize log line) |
| Server answers the send but a delivery `failed` | new (returned `failed`) | not latched; retried as above | clear |
| No channel can carry the notification (all `skipped`) | new | latched as today | clear (skipped lines in the notification log) |
| Pass-started process on an idle unit host has no `BBX_BOX_NAME` | new (`buildEnv` test) | unit-host URL fallback | was silent; becomes routed |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field.** An agent writes a job card with
  `connector: gmail` for unscoped work: not waiting; it rides along. An agent
  writes `priority: low`: not waiting; it rides along or meets the reactor's
  24 h deadline. ADDRESSED by the predicate.
- **Stale ref.** A follow-up job whose question was deleted: `cleanupStaleJobs`
  (`steps.ts:92-185`) deletes it in the run. ADDRESSED.
- **Two agents touching the same card.** No new card writer; the check writes
  only `.beebox/job-check.json`. ADDRESSED.
- **Hand-edit drift.** A person deletes `.beebox/job-check.json`: every
  waiting job is due once more, one run, then backoff resumes. A person edits a
  given-up job: its hash changes and it gets a fresh window. ADDRESSED.
- **Fabricated free-form value.** No new agent-written field. Not applicable.
- **Validation error UX.** No new agent-facing message. ADDRESSED.
- **Partial rollout.** During a deploy the old pass has no check; the first new
  pass adopts every waiting job. ADDRESSED.
- **Job chains.** A follow-up job whose agent writes another job: a later
  cycle of the same run picks it up; otherwise the next pass sees a new card
  with no entry and starts a run. Each link is one agent action; the daily
  bound caps a runaway chain. ADDRESSED by the bound.
- **Inbox items without a job** (share, extension commentary). Not seen by
  the check. DEFERRED, open decision 5.
- **Agent writes but never commits a job.** Not waiting. GAP, accepted: it
  rides along with the next run that something else starts.

### Scenario walks

Each walk is the planned code on a unit host unless it says otherwise.

**1. Answer a question in the web UI; the follow-up runs.**

1. `actions.answer` (`beebox/src/webapp/trpc/routers/actions.ts:57-60`) →
   `executeAnswer` writes the follow-up job, then the answered card, and
   commits (`beebox/src/core/commands/answer.ts:265-284`). The person sees
   the question answered.
2. Within about a minute (plus the time other boxes' passes take), the daemon
   runs this box's pass. After the tick, `checkWaitingJobs` finds the
   `.question-followup.job.card` (no connector, normal), confirms it is in
   `HEAD`, finds no state entry, finds both locks free, and is under the daily
   bound.
3. It calls `wakeup.start` through the hub. The box server (started by the
   hub if idle) starts `bbx engine wakeup --max-cycles 3` in the background and
   answers `started: true`. The pass stamps the job (attempt 1, `nextAt` +1 h),
   logs `job-check started`, runs `runBoxAlerts`, and ends.
4. The wakeup child takes the cycle lock, runs steps 1-4d and the reactor with
   no filter. The follow-up job and every other pending job go into one batch
   (`cycle.ts:145-147`). The agent finishes the job (`bbx finish` deletes the
   card). `runFinalize` sends nudges and alerts through `notifications.send`
   (Track A). The child pushes and exits; `liveWakeups` drops to 0.
5. The next pass finds no waiting job and prunes the entry. What the person
   sees: the follow-up's effects a few minutes after answering. Left behind:
   commits.

Today the walk stops after step 1.

**2. Scan upload burst (26 sessions in a few minutes).**

1. PUTs re-arm the promote settle window (`promote-lifecycle.ts:141-147`);
   two minutes after the last one, one promote pass imports and commits the
   sessions and the unscoped intake job, then runs scan's own wakeup
   (`scan/promote/core.ts:266`). Unchanged.
2. If a pass runs while scan's wakeup holds the cycle lock, it skips. If a
   pass runs in the gap between the commit and scan's wakeup taking the lock,
   it starts a server wakeup; scan's wakeup then skips on the lock and retries
   under its own budget, and its retry finds the job drained. Either way one
   agent run handles the burst.
3. If the batch is too large to finish, the intake job stays; the pass retries
   it at +1 h, +7 h, then daily.

**3. Phone capture.**

- With words: delivered to a chat (`quick-capture/runtime.ts:24-29`). If the
  agent writes and commits a job card, walk 1 from step 2.
- Without words: filing appends to the unscoped intake job, commits
  (`filing-sweep.ts:86-88`), and starts its own wakeup (`runtime.ts:42`). As in
  walk 2, the pass either skips on the lock or starts the one run.
- An abandoned capture: the server's 10-minute sweep
  (`capture/register.ts:63-77`). Unchanged.

**4. CLI `bbx answer` on the server, box server idle.**

1. `bbx answer` as the box user writes and commits the job
   (`cli/commands/answer.ts:25-27`). No server is running. The CLI prints what
   it prints today.
2. The next pass finds the job. `boxServerEnv` gives the unit-host URL
   `${BBX_PUBLIC_URL}/<slug>`; `wakeup.start` goes through the hub, which
   connects to the box's socket and starts the unit, and answers once the
   server is up (well inside the 30 s timeout). Walk 1 from step 3.

**5. The box server idle-exits while the run is in flight.**

- `liveRuns` includes the live wakeup, so `decideIdle` returns `live-runs`
  (`idle-exit.ts:44`). The server stays up until the child exits, then idles
  out 30 minutes after the last request (the pass's `wakeup.start` counts as
  one).
- Today: a server can begin its drain while a scan or filing wakeup runs, and
  new requests wait in systemd's socket queue (`idle-exit.ts:126-129`,
  `promote-lifecycle.ts:216`). Found by reading; not observed.

**6. A job that keeps failing.**

Attempt 1 at t0. The job stays. Passes skip it until t0+1 h (attempt 2), then
t0+7 h (3), then daily (4 to 9, the last before t0+7 d). At t0+7 d the next
pass marks it given up and logs once. `stalled-jobs` already lists it. Any run
started for other jobs in that week still includes it (it rides along); that
costs a share of those runs, not extra runs.

**7. A laptop or dev host (not a unit host).**

The scheduler daemon runs `runSchedulerPass` in its own process. The check is
the same; the starter is `void runBbxWakeup(...)` in that process, and the pass
returns at once. A box that no scheduler daemon lists gets no check, as it gets
no schedules today.

## NOT in scope

- **Moving scan or wordless filing off their own wakeups.** They keep them;
  the cycle lock makes the overlap one run (walks 2 and 3).
- **Inbox items without a job** (share, extension commentary). The check reads
  jobs only. Open decision 5.
- **Making the reactor skip uncommitted job cards.** The check does not start
  a run for one, but a run started for other reasons still processes it, as
  today (round-2 finding 2 in full).
- **Connector-tagged jobs whose schedule is disabled.** Decided above: not
  counted; they ride along.
- **Routing scheduled `notify:` actions and promotion notices on the
  on-wakeup path** (`run-action.ts:82`, `promotion.ts:92` reached from
  `tick-utils.ts`). File an issue when this plan lands.
- **The `bbx notify` refactor onto `routedSender`.** Not needed.
- **Question aging on boxes with no wakeups at all.** The daily
  `question-review` procedure is the backstop.
- **Widening the tooling allowlist with push keys.** Rejected by the
  boxholder.
- **Unfiled captures in `tmp-capture/`** (`beebox/src/core/capture/sweep.ts:22-24`
  *"filing them is the chat agent's duty"*). No wakeup files them.
- **The stale "UI Sync button" comment**, beyond one line in Track C's commit.

## Open design questions

1. **Backoff numbers and window.** The boxholder said "say 1 h, then 6 h,
   then daily". Lean: exactly that, with a 7-day window from the first attempt
   (code style's "a week is acceptable"), then given up.
2. **Daily bound on runs started by the check.** Without one, an agent that
   rewrites a failing job each run, or a long job chain, starts runs without
   limit. Lean: 24 runs per box per day (at most 72 agent sessions with 3
   cycles each). Worst case per box per day is therefore 24 runs; a normal day
   is one run per burst of activity.
3. **Cycles per run.** Lean: 3, the reactor's default. Each cycle is one agent
   session; leftovers after 3 wait an hour (or ride along with the next new
   job's run).
4. **Should a started run sync connectors?** A full wakeup runs every
   configured connector and on-wakeup scripts, even when the boxholder disabled
   the check-email schedule (`connectors.ts:58-61`, `command.ts:142-153`). Scan
   and filing already do this. Lean: keep the full wakeup.
5. **Inbox items without a job** (share to inbox, extension commentary). Only
   step 4b of a full wakeup jobs them. Options: (a) leave them to ride along
   with the next run; (b) widen the check to committed normal-priority inbox
   cards that no job references, which repeats step 4b's scan every minute.
   Lean: (b) only if a boxholder reports a stalled share; (a) for now. Low
   priority work (contains backfill, `inbox-low`) rides along in either case.
6. **A dry run before deploy.** `bbx reactor --dry-run` on each production
   box shows the first batch, but it reads box content on production. Lean:
   skip it; the first run is bounded at 3 sessions per box, and the watch step
   reads the result.

Settled since the last revision: the check runs in the pass; only unscoped
jobs count; low priority never starts a run; only committed jobs count; a
changed job card resets its backoff.

## Knowledge audits

Skipped: infrastructural. No agent-facing verb, card shape, or guidance
changes. An agent that commits a job card now gets it run, without doing
anything different.

## What will hold this after it ships

All tiers are `t.check` tests. Each names one claim that could be wrong, with
one example.

- **Waiting predicate** (`isWaitingJob`, pure): an unscoped normal job in
  `HEAD` → true. Example: `{ connector: undefined, priority: "normal",
  committed: true }` → true; `connector: "gmail"` → false; `priority: "low"` →
  false; `committed: false` → false.
- **Due rule** (`dueJobs`, pure): a job with no entry is due; one with
  `nextAt` in the future is not; one whose hash changed is due with attempts
  reset. Example: entry `{ attempts: 2, nextAt: now + 1h, hash: "a" }`, card
  hash `"b"` → due, attempts 0.
- **Backoff** (`nextAttemptAt`, pure): attempts 1, 2, 3, 4 from `t0` give
  `t0+1h`, `+6h` after the second, then `+24h`; a value past `t0+7d` gives
  none. Example: attempts 3 at `t0+7h` → `t0+31h`.
- **Daily bound** (pure): 24 runs today → no start; a new box-time day resets
  it.
- **Lock held** (filesystem, `makeTmpBox()`): with the cycle lock held by a
  live holder, the check starts nothing and the state file is unchanged.
- **Committed only** (filesystem): a waiting-shaped job card written but not
  committed starts nothing; after `git commit` it starts one run.
- **Stamps only on start** (injected starter): a starter that returns
  `started: false` or throws leaves the state file unchanged; `started: true`
  stamps every due job and bumps today's count.
- **Prune** (filesystem): an entry whose job file is gone is removed on the
  next pass.
- **Give up** (filesystem with box time): at `t0+7d` the entry is marked
  given up, one `job-check gave up` line is written, and later passes start
  nothing for it.
- **Pass isolation** (injected check that throws): the tick result and the
  box alerts still run and log.
- **`wakeup.start`** (route test, `makeTestServer()` with an injected
  `wakeupRunner`): returns `started: true` and calls the runner once; a second
  call while it runs returns `running`; an unauthenticated non-agent caller is
  refused.
- **Non-unit starter**: calls `runBbxWakeup` (injected) without awaiting it;
  the check returns before the runner resolves.
- **`--max-cycles`**: the wakeup command passes the value to `runReactor`.
- **Idle decision** (`decideIdle`): `liveRuns` from a live wakeup keeps the
  server up.
- **Route choice** (`routedSender`): with the three env vars set, `send`
  calls the server and never `notifyBoxholder`; with one missing, in process.
- **Sent rule** (`notificationSent`, pure): `sent` → true; all `skipped` →
  true; one `failed` and nothing reached → false.
- **Nudge and alert not latched on failure**: a sender that throws, and one
  that returns a `failed` delivery; neither leaves a latch entry, and the next
  call sends again.
- **Unit-host box name** (`buildEnv`/`boxServerEnv`): with `BBX_UNIT_HOST=1`,
  no endpoint file, `BBX_PUBLIC_URL=https://h`, box at
  `/var/lib/beebox/fam/box` → `BBX_SERVER_URL=https://h`, `BBX_BOX_NAME=fam`.

No new tier and no new mock beyond injected seams (`wakeupRunner` exists at
`beebox/src/services/container.ts:46`).

## Implementation order

1. Track A: `NotifySender`, `routedSender`, `notificationSent`, nudge and
   alert latching, finalize passing the sender. Commit. Then `buildEnv`'s
   unit-host fallback, `boxServerEnv`, and `boxClient(env)`. Commit.
2. Track C: `--max-cycles`, the live-wakeup count and idle signal. Commit.
   Then `wakeup.start`. Commit.
3. Track B: the pure functions and the state file. Commit. Then the pass
   step with both starters. Depends on 1 and 2. Commit.
4. Docs: `beebox/docs/design/processing.md` and `beebox/docs/scheduler.md`
   (the pass now starts full wakeups for waiting jobs),
   `beebox/src/core/reactor/DESIGN.md:58`, the stale Sync-button comment.
   Commit.
5. After the boxholder says to land and deploy: Track D's watch step on the
   two production boxes.

## Rollout shape

Tests first, per chunk, as listed above. Done when every test there passes,
change-selected tests pass, and `pnpm typecheck` and `pnpm layout-check` pass
from `beebox/`.

Before landing, on the probe VM (not production): with the box server
idle-exited, commit a follow-up job as the box user and confirm the next pass
starts the server and the run; then make a job fail and confirm the
`job-check` lines and the 1 h `nextAt`.

No data migration. `.beebox/job-check.json` is new and starts empty.

No knowledge audits land with this plan.

After deploy: Track D's watch step. Then read one production box's
notification log for a `question-nudge` delivery that went through the server.
