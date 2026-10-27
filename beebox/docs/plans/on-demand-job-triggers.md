---
title: "On-demand job triggers and server-routed finalize notifications"
status: draft
workstream: box-isolation-followups
issues: []
---
# On-demand job triggers and server-routed finalize notifications

Jobs that carry no `connector:` field never run on a deployed box, because
every scheduled wakeup is connector-scoped. This plan makes every commit that
adds such work record an owed wakeup and wake the box server, which runs one
full wakeup per burst. It also makes the notifications that `bbx finalize`
sends go through the box server, which holds the push keys.

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
only new text a person sees is one hook line on a commit when no box server
can be started (Track D).

## Smallest fix and budget

**Smallest fix.** Two edits, about 40 source lines:

1. After a web answer writes a follow-up job, call `runBbxWakeup` without
   waiting, the same way the wordless-capture filing does
   (`beebox/src/webapp/routes/quick-capture/runtime.ts:42`).
2. In `bbx finalize`, send the question nudge and alert through
   `notifyRoute()` (`beebox/src/cli/lib/notify-route.ts:24-28`) instead of
   calling `notifyBoxholder` in process.

It is not credible. It loses the run when a deploy or crash lands before the
run ends; a CLI `bbx answer` on an idle unit-host box has no process to call;
a burst of answers starts one wakeup each; the alert latch is still written
before the send; and a pass-scheduled finalize on an idle unit-host box still
has no `BBX_BOX_NAME`, so it delivers in process with no keys.

**Chosen release (after the cross-model review).** The shared durable trigger
plus server-routed finalize notifications. Scan's runner, wordless-capture
filing, scheduled `notify:` actions on the on-wakeup path, and the `bbx notify`
refactor stay out (see NOT in scope).

| Track | Source lines (add + delete) | Test lines |
|---|---|---|
| A. Finalize notifications through the box server | ~110 | ~130 |
| B. Pending-wakeup marker: shared module and its fixes | ~95 | ~110 |
| C. Wakeup trigger in the box server, and waking an idle server | ~195 | ~140 |
| D. The commit chokepoint requests the wakeup | ~60 | ~70 |
| E. One-time drain runbook | 0 | 0 |

Total about 460 source and 450 test lines. Authored docs about 80 lines
(`beebox/docs/design/processing.md`, `beebox/src/core/reactor/DESIGN.md`, the
runbook in `beebox/deploy/README.md`). No generated output. Not a BIG CHANGE.
The first draft was 460 source and 390 test lines; the review moved lines from
the cut refactors into the fixes, and added tests for each fix.

The fuller design buys: a durable record, written before the action is
acknowledged, so a lost run is late and not indefinite (the lesson in
`beebox/src/core/scan/promote/wakeup.ts:5-15`); one chokepoint that covers
every job-creating action, including agent-written jobs from a chat; a server
that is started when work is owed; one debounced run per burst; and a server
that stays up while a wakeup it started is still running.

## Stated preferences this plan trades against

- **Boxholder decision: triggers, not a recurring unscoped wakeup.** The
  action that creates a job starts processing for it. Backfill is an
  exception: *"I want backfill to be an exception, and ideally everything is
  handled with triggers."* The boxholder also named captures: *"in addition
  to triggering wakeup for more actions (including capture, I would
  assume?)"*. This rules out an hourly or daily `bbx engine wakeup` schedule
  as the main path, and it rules out leaving a CLI answer waiting for an
  unrelated request.
- **Boxholder decision: finalize notifications go through the box server**,
  like `bbx notify`. The tooling env allowlist keeps the APNs and VAPID keys
  out (`beebox/src/core/script-env/core.ts:203-218`; the notify header
  `beebox/src/cli/lib/notify-route.ts:1-11`).
- **Principle 4, resilient and never silent**
  (`beebox/docs/engineering-principles.md:49`). Today the question alert in a
  tooling child returns `null` without a log line when no channel is
  configured (`beebox/src/core/question-alert.ts:72-73`: *"if (!channels.webPush
  && !channels.apns) return null;"*), and it writes its latch before it sends
  (`:89` before `:105`). The fix must log a failure and latch only what was
  sent.
- **Code style: "Nothing retries forever"** (`beebox/code-style.md`,
  Defensiveness item 9). Every retry here has a stated bound.
- **Principle 8, one way to do each thing**
  (`beebox/docs/engineering-principles.md:95`). Scan already has a durable
  marker with a retry budget. The trigger uses the same module, with its own
  directory, rather than a second implementation. Scan keeps its own runner in
  this release; that is a deliberate, temporary second runner (NOT in scope
  says why).
- **Principle 10, testability** (`beebox/docs/engineering-principles.md:116`).
  The decisions (route choice, sent-or-not, clear-or-keep the marker,
  exhausted budget, idle decision, which staged paths request a wakeup) stay
  pure functions.
- **Prefer existing primitives; minimize invented concepts** (task brief).
  The design reuses `runBbxWakeup`, the reactor's own bounded cycle loop, the
  scan marker and retry budget, `file-lock.ts`, the promote debouncer, the
  cross-process event bus, the per-box pre-commit hook, the hub's socket
  probe (`fetchEndpoint`), and `notifyRoute`. It adds one bus event name, one
  server lifecycle, one wakeup flag, and one environment variable.
- **Shipped precedent.** Scan's durable wakeup (`beebox/docs/implemented-plans/scanner-ingest.md`
  Track 3), wordless-capture filing (`beebox/docs/implemented-plans/file-wordless-captures.md`),
  `bbx notify` delegation (`beebox/docs/implemented-plans/agent-capability-delegation.md`),
  and the one-process pre-commit hook (`beebox/src/cli/commands/validate/pre-commit.ts:1-9`).

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

**Pieces to reuse.**

| What | Where | Reuse or rebuild |
|---|---|---|
| Supervised full-wakeup child | `beebox/src/core/commands/wakeup.ts:46` `runBbxWakeup`; doc `:43-44` *"Forcing and letting it happen are therefore the same code"* | Reuse as the trigger's runner. Add a live-child count and a `maxCycles` pass-through (Track C). |
| Durable "wakeup owed" marker | `beebox/src/core/scan/promote/wakeup.ts:55` `markWakeupPending`, `:153` `runPendingWakeup` | Reuse; take the directory as a parameter (Track B). |
| Retry budget with abandonment | `beebox/src/core/scan/promote/wakeup-retry.ts:27-53` (2, 4, 8, 15, 15 min; 6 attempts) | Reuse; fix the count so kills are bounded (Track B). |
| "Did the wakeup drain jobs?" rule | `beebox/src/core/scan/promote/wakeup.ts:114-131` `wakeupSatisfiedScanPromote` | Reuse for scan; the trigger judges a lock skip differently (Track C). |
| Cross-process file lock, both layers | `beebox/src/job-cards/intake-utils.ts:94-97` (`withCardLock` around `withFileLock`) | Reuse the pattern around marker writes and the clear. |
| Settle debouncer on awake time | `beebox/src/core/scan/promote-debounce.ts:34` `createPromoteDebouncer` | Reuse. |
| Admission for timer-started work | `beebox/src/webapp/routes/scan-upload/promote-lifecycle.ts:109-119` (*"Timers inherit async context, so without `withoutBoxWork` the pass would carry the request's work permit"*) | Reuse the same `withoutBoxWork(() => withBoxWork(...))` wrap. |
| Cross-process event bus, polled by the server | `beebox/src/core/event-bus/core.ts:13-15` *"When pollInterval is set, the bus periodically checks for events inserted by other processes"*; server sets it at `beebox/src/webapp/server/app.ts:257` *"createEventBus(box.boxRoot, { pollInterval: 1000 })"* | Reuse to tell a running server. |
| Per-box pre-commit hook, one process, sees staged paths | `beebox/src/core/install-validation-hooks.ts:8-11`; `beebox/src/cli/commands/validate/pre-commit.ts:64-80` `runPreCommitChecks` with `listStagedRelPaths(boxRoot, { diffFilter: "DR" })` | Reuse as the trigger chokepoint (Track D). |
| Engine commits run that hook | `beebox/src/lib/git/core/operations.ts:63-69` *"an engine-driven commit SHOULD normally clear the same card-validation gate a human commit does … no caller sets it now"* (`noVerify`) | Relied on. |
| Commit env is the committer's env | `beebox/src/lib/git/core/commit-env.ts:12` *"{ ...process.env, ...boxWorkEnvironment() }"* | Relied on for the in-wakeup skip (Track D). |
| Starting a socket-activated box | `beebox/src/hub/socket-provider.ts:204` *"Connect to the socket (which starts the unit)"*; `defaultProbe` requests `/api/build-info` without auth (`:75-83`) through `fetchEndpoint` (`beebox/src/hub/endpoint-fetch.ts:16-38`) | Reuse `fetchEndpoint` with the same path to wake an idle box (Track C). |
| Server-side notification send | `beebox/src/webapp/trpc/routers/notifications.ts:74-87` (`send`, `channels`) | Reuse unchanged. |
| Route choice for `bbx notify` | `beebox/src/cli/lib/notify-route.ts:24-28` `notifyRoute()` | Reuse. |
| "Did the notification reach anyone?" | `beebox/src/core/notify-boxholder.ts:69-71` `notificationReached`; the scheduled-action rule `beebox/src/core/schedule/run-action.ts:83-86` (*"const final = !result.deliveries.some((d) => d.status === \"failed\");"*) | Reuse both for the latch rule (Track A). |
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
| any job an agent writes (chat, procedure, reactor) | chat prompt `beebox/src/core/chat/session/prompts.ts:32` | none | as written | none |

**Inbox writers that create no job** (a full wakeup's step 4b jobs them):
share-to-inbox (`beebox/src/webapp/trpc/routers/share/router.ts:90`
*"if (destination.kind === \"inbox\") return INBOX_DIR;"*), Chrome extension
commentary (`beebox/src/webapp/trpc/routers/clerk.ts:60`
*"let destDir: string = DEFAULT_COMMENTARY_DIR;"*), and any agent that writes
a card into the inbox.

**What a capture with words can create** (finding 8, traced). The quick-capture
worker delivers it to a chat (`beebox/src/webapp/routes/quick-capture/runtime.ts:24-29`,
`processCapture` with `quickChatChat`). From there only the chat agent acts.
It can file the capture (no job), answer an open question with `--via chat`
(no job, `answer.ts:263-265`), write a job card for long work
(`prompts.ts:32`), write a card into the inbox, or run `bbx force-wakeup`.
The engine adds nothing after the turn. So the jobs a capture with words can
cause are agent-written job cards and agent-written inbox cards. Neither
passes through any engine function that could call a trigger; both reach git
through a commit (the agent's own, or the end-of-run fallback commit,
`beebox/src/core/reactor/engine/batch-jobs.ts:75-82` for the reactor). The
commit is the only chokepoint all of them share.

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

Two premises about systemd socket activation (`Accept=no`) bear on Track C.
Source: <https://www.freedesktop.org/software/systemd/man/latest/systemd.socket.html>.
Evaluated-only; not re-fetched for this plan.

1. A connection to the listening socket starts the service. The repo relies on
   this already: `beebox/src/hub/socket-provider.ts:204` *"Connect to the
   socket (which starts the unit)"*.
2. While the service is still running after it closed its own listening
   descriptor, systemd starts no second instance; connections wait in the
   socket's queue and the next instance serves them.
   `beebox/src/webapp/server/idle-exit.ts:126-128` *"systemd's keeps the
   queue, and the next instance serves what arrives from here on."*
   Unverified: that a queued connection whose client already closed still
   starts the next instance after the draining one exits. Track C does not
   depend on it alone (the marker is found at the next start either way); the
   probe-VM check in Rollout shape settles it.

No other decision depends on an external premise.

## Ontology

- **Unscoped job** (existing name: `beebox/src/job-cards/intake-utils.ts:11`
  *"its items join the unscoped normal-priority job"*, lock name
  `unscoped-${priority}` at `:87`). A job card with no `connector:`. Not a
  connector's job. Only a full wakeup or `bbx reactor` runs it.
- **Full wakeup** (existing: `beebox/src/cli/commands/wakeup/steps.ts:189`
  *"Under a full wakeup"*). `bbx engine wakeup` with no `--connector`. Points
  at the reactor with no filter.
- **Pending-wakeup marker** (existing: `beebox/src/core/scan/promote/wakeup.ts:35`
  `MARKER_FILENAME = "wakeup-pending"`). One file that says a full wakeup is
  owed. One implementation, two directories: scan's
  (`_tmp/scan-quarantine/`, unchanged) and the trigger's (`.beebox/`). Its
  content becomes `<request id> <time> <reason>`; the request id is a new
  random id per write. Not a queue: one marker covers any number of requests.
- **Wakeup retry budget** (existing: `wakeup-retry.ts`). The attempt count and
  the abandoned record beside the marker.
- **Wakeup request** (new verb). A call to
  `requestWakeup(boxRoot, { reason, newWork })`: write the trigger's marker,
  emit the bus event, and wake an idle unit-host server. Every trigger is a
  wakeup request.
- **Wakeup-owed paths** (new predicate, `requestsWakeup(relPath, card)`). The
  staged additions that create normal-priority unscoped work: a `.job.card`
  with no `connector:` and no `priority: low`, or a card that a full wakeup's
  step 4b would job at normal priority outside every connector's
  `inboxPaths`. Extracted from step 4b's existing rules, not new rules.
- **`wakeup-requested` bus event** (new event name). `{ reason: string }`.
  Tells a running box server that the marker changed. Not durable work; the
  marker is.
- **Wakeup trigger** (new server lifecycle, `startWakeupTrigger`). One per
  served box. Listens for `wakeup-requested`, debounces, runs one full
  wakeup with up to `TRIGGER_MAX_CYCLES` reactor cycles through
  `runBbxWakeup`, and clears the marker when the request id is unchanged.
  Distinct from the existing `WakeupRunner` type
  (`beebox/src/core/wakeup-runner.ts:28`), which spawns one child.
- **`BBX_FULL_WAKEUP`** (new env variable, `1`). Set by a full wakeup on its
  own process. A commit made with it set requests no wakeup, because that
  process's reactor runs next.
- **Live wakeup children** (new count). How many `runBbxWakeup` children this
  process is waiting on. Read by the idle decision.
- **Notify sender** (new type, `NotifySender`). `{ send(request), reach() }`.
  In process, or through the box server's `notifications.send` and
  `notifications.channels`. Chosen by the existing `notifyRoute()`.
- **Sent** (rule, not a type). A notification counts as sent, and is
  latched, when `notificationReached(result)` is true or no delivery has
  status `failed` (nothing can carry it, so a retry cannot help). It is not
  latched when the call throws or a delivery `failed` and nothing reached.

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
  export function notificationSent(result: NotifyResult): boolean; // the "Sent" rule
  ```
- `beebox/src/cli/lib/notify-route.ts`: add
  `routedSender(boxRoot: string, services?: NotifyServices): NotifySender`.
  `server` route: `send` calls `notifications.send.mutate` with the same
  input shape `bbx notify` sends (`beebox/src/cli/commands/notify/command.ts:184-190`);
  `reach` calls `notifications.channels.query()` and returns `.reach`. Both
  wrap in `onServer`, so a failure is a `NotifyServerError`. `local` route:
  `inProcessSender`. `bbx notify` is not changed in this release.
- `ageQuestions(boxRoot, { push?, sender? })` and
  `checkPendingQuestionsAndNotify(boxRoot, { now, push?, sender? })` use
  `sender ?? inProcessSender(boxRoot, { push })`.
- **Nudge.** Per question: send; if it throws, or returns a result that is
  not sent, log `Question nudge for <path> not sent: <detail>` and leave
  `latch.nudged[path]` unset. Otherwise stamp it as today.
- **Alert.** `reach()` first; a throw propagates to `finalizeQuestions`'
  existing catch (`beebox/src/cli/commands/finalize.ts:39-44`, *"Question
  alert failed"*) and nothing is saved. Then send. Save the latch after the
  send: `paths` is the pending set minus the fresh paths when the alert was
  not sent, and the full pending set when it was. A thrown send is caught,
  logged, and treated as not sent.
- **Bound.** A question that cannot be nudged or announced is retried at each
  finalize until it leaves `pending`: answered, dismissed, or expired by the
  same aging pass (`question-aging.ts`, `expireAfterMs`). Expiry is the bound.
- No fallback to in-process delivery: `notify-route.ts:9-11` *"A server that
  is named but does not answer is an error, not a reason to deliver in
  process"*.
- `finalize.ts:56` passes `{ sender: routedSender(boxRoot) }`.
- `beebox/src/core/script-env/core.ts` `buildEnv`: when the cascade has no
  ambient URL and no endpoint file, and `onUnitHost()` is true, use
  `${getPublicUrl("")}/${slugOfBoxRoot(boxRoot)}` before `config.publicUrl`.
  On a unit host the socket starts the server on demand, so the URL is valid
  whether the server runs or not. The hub proxies an agent-bearer request to
  the socket (`serve-publish.ts:16-18`).

**Vocabulary lock-ins.** `NotifySender`, `inProcessSender`, `routedSender`,
`notificationSent`.

**First chunk.** `NotifySender`, `routedSender`, `notificationSent`, the nudge
and alert changes, and finalize passing the sender, with tests. No open
question.

### Track B — Pending-wakeup marker: shared module and its fixes

**What.** `markWakeupPending`, `runPendingWakeup`, and the retry budget take
the marker directory as a parameter and move to
`beebox/src/core/wakeup-pending/`. Scan passes its quarantine directory, as
today. The trigger passes `.beebox/` (gitignored machine state, like
`wakeup-cycle.lock`, `beebox/src/cli/commands/wakeup/cycle-lock.ts:31-34`).
Three fixes apply to both users.

**Why.** Answers need the durability scan has, and principle 8 asks for one
implementation. The review found three defects that matter once the marker
has writers in many processes.

**Direction.**

- **Request id and a lock (finding 2).** Each `markWakeupPending` writes
  `<id> <time> <reason>`, where `id` is `randomUUID()`. Every marker write and
  the clear run under `withCardLock(lockPath, () => withFileLock({ lockPath,
  metadata: { purpose: "wakeup-pending" }, waitMs: 10_000 }, fn))`, the
  pattern at `intake-utils.ts:94-97`, with `lockPath` beside the marker.
- **Compare-and-delete.** `runPendingWakeup` reads the id before the run.
  After a run that counts as done, it takes the lock, re-reads, and deletes
  the marker only if the id is the same. A request that lands during the run,
  or blocks on the lock during the clear, leaves a marker with a new id, so
  the trigger runs again. Pure helper: `shouldClearMarker(idBefore, idNow)`.
- **`newWork` is required (finding 3).** `markWakeupPending(dir, { reason,
  newWork })` keeps scan's rule (`wakeup.ts:41-54`): only new work resets the
  budget. Scan keeps computing it from `pending` entries (`core.ts:184`).
  The trigger's commit chokepoint passes `true` (a staged addition is new
  work); retries and startup never call it.
- **Count before the run, check before the spawn (finding 7).** Before
  spawning, `runPendingWakeup` reads the attempt count. If it is at
  `MAX_WAKEUP_ATTEMPTS` (6, `wakeup-retry.ts:40`), it writes
  `wakeup-abandoned`, logs once, and returns `abandoned` without spawning.
  Otherwise it increments the count, then spawns. A success clears the count.
  A failure adds nothing more (the attempt is already counted). A process
  killed mid-run has therefore spent one attempt, and the seventh start finds
  the budget spent. The trigger runs the same check at startup, before it arms
  anything.
- Scan's judgment stays `wakeupSatisfiedScanPromote`, unchanged. The runner
  accepts a result `{ ok: false, lockSkipped: true }` that refunds the attempt
  and asks for a re-arm at the settle window; only the trigger returns it
  (Track C).

**Vocabulary lock-ins.** `.beebox/wakeup-pending`, `.beebox/wakeup-attempts`,
`.beebox/wakeup-abandoned`; marker line `<id> <time> <reason>`;
`shouldClearMarker`.

**First chunk.** The directory parameter, request id and lock,
compare-and-delete, required `newWork`, and count-before-run with the
pre-spawn check, with scan still the only user. Scan tests keep passing.

### Track C — Wakeup trigger in the box server, and waking an idle server

**What.** One lifecycle per served box that turns wakeup requests into
debounced full wakeups, and a wake step that starts an idle unit-host server
when work is owed.

**Why.** Requests come from processes other than the server: the git hook of
every commit, including the server's own. A running server must hear them. A
stopped server must be started, because the boxholder chose triggers over
waiting (finding 1).

**Direction.**

- `beebox/src/core/wakeup-pending/request.ts`:
  ```ts
  export async function requestWakeup(
    boxRoot: string,
    opts: { reason: string; newWork: boolean },
  ): Promise<{ server: "running" | "started" | "none" }>;
  ```
  1. `markWakeupPending(.beebox, { reason, newWork })` (Track B).
  2. Emit `wakeup-requested` through a short-lived `createEventBus(boxRoot)`,
     as `notifyBoxholder` does (`notify-boxholder.ts:131-145`).
  3. If `readServeEndpoint(boxRoot)` finds an endpoint, return `running`: the
     server's bus poll will hear the event within a second.
  4. Else, on a unit host (`onUnitHost()`), wake it: `fetchEndpoint({ slug,
     origin: "http://localhost", socketPath: \`/run/beebox/${slug}.sock\` },
     { path: "/api/build-info", timeoutMs: 2000 })`, the hub's own probe
     request (`socket-provider.ts:75-83`). The socket is `bbx-<slug>`-owned,
     mode 0660 (`beebox/deploy/systemd/beebox-box@.socket`, `SocketUser=bbx-%i`),
     so any process of the box's user can connect, inside the sandbox or from
     an operator's `sudo -u bbx-<slug>` shell. The response is not needed:
     the connection starts the unit, and the new server finds the marker at
     startup. A timeout or refusal is logged as a warning and returns `none`;
     the marker stays for the next start. Return `started`.
  5. Else (dev router, standalone `bbx serve`, no server): return `none`. A
     standalone box has no supervisor to start a server; the dev router
     starts a worktree's server on its next HTTP request. The marker waits.
- `beebox/src/core/event-bus/schemas.ts`: add
  `"wakeup-requested": z.object({ reason: z.string() })`. Bump
  `EVENT_SCHEMA_GENERATION` (`core.ts:54`) per its rule (`:47-53`).
- `bbx engine wakeup --max-cycles <n>` (default 1, today's value at
  `command.ts:78`). `runBbxWakeup` takes an optional `maxCycles` and passes
  the flag. Finding 5 is handled by the reactor's existing loop: it repeats
  while jobs remain and the last cycle processed at least one, up to the
  bound (`core.ts:132-156`). Cycles after the first run no sync, so a later
  cycle also picks up jobs the agent wrote in the earlier one.
  `TRIGGER_MAX_CYCLES` is 3, the reactor's own default (`core.ts:213`); see
  open decision 1.
- `beebox/src/webapp/server/wakeup-trigger.ts`:
  `startWakeupTrigger({ server, boxRoot, eventBus, run? })`.
  - Subscribes to the box's server bus (live events only; no replay).
  - On `wakeup-requested`: `debouncer.notify()`, settle `WAKEUP_SETTLE_MS` =
    2 minutes, the scan settle value (`promote-debounce.ts:17`).
  - At startup: run the pre-spawn budget check; if a marker exists and is not
    abandoned, `notify()`.
  - Single-flight per box. If a run is in flight, set `again`; when the run
    ends and `again` is set, re-arm the settle window once.
  - The run is `withoutBoxWork(() => withBoxWork({ boxRoot, reason: "wakeup
    trigger" }, () => runPendingWakeup({ dir: .beebox, runWakeup })))`, with
    `runWakeup` = `runBbxWakeup({ boxRoot, triggeredBy: "wakeup trigger",
    maxCycles: TRIGGER_MAX_CYCLES })`.
  - Its judgment: `skipped: "wakeup-running"` or `reactorSkipped` returns
    `lockSkipped` (another cycle holds the box; the attempt is refunded and
    the run re-arms at the settle window). This refund is bounded by the
    holder's own bound: a scheduled script's timeout (10 min default, 30 min
    for the review procedures) or the pass unit's `TimeoutStartSec=1800`.
    Otherwise `wakeupSatisfiedScanPromote`'s rule (reactor ran and was ok).
  - On `failed`, re-arm at the budget's delay. On `abandoned`, log once and
    stop until the next request with `newWork`.
  - `onClose`: cancel the debouncer and await the in-flight run, as
    `promote-lifecycle.ts:210-217` does.
  - Registered for every box in `beebox/src/webapp/server-box-scope.ts`,
    next to `registerCaptureRoutes` (`:338`). Scan's lifecycle is registered
    only for annex boxes (`scan-upload/register.ts:270`), so the trigger
    cannot live there.
- **Idle exit counts live wakeups.** `runBbxWakeup` increments a module
  counter before the spawn and decrements it in `finally`.
  `ActivityLedger.signals()` (`idle-exit.ts:88-97`) adds `liveWakeups()` to
  `liveRuns`. A server does not start its drain while any wakeup child it
  spawned (trigger, scan, filing, force) runs, so requests do not wait behind
  a draining server.
- A server that idle-exits with a retry pending loses the timer, not the
  work: the marker stays. The next start re-arms it.

**Vocabulary lock-ins.** `requestWakeup`, `wakeup-requested`,
`startWakeupTrigger`, `WAKEUP_SETTLE_MS`, `TRIGGER_MAX_CYCLES`,
`--max-cycles`, `liveWakeups`.

**First chunk.** `requestWakeup` steps 1-3 and 5, the bus event, the
lifecycle with an injected `run`, `--max-cycles`, and the idle signal, with
tests. The unit-host wake (step 4) is the second chunk. No open question.

### Track D — The commit chokepoint requests the wakeup

**What.** `bbx validate --pre-commit` calls `requestWakeup` when the commit
adds wakeup-owed paths. No per-action call sites.

**Why.** Every job-creating action ends in a box commit, and every box commit
runs the pre-commit hook: the engine's commits do (`operations.ts:63-69`), and
so do an agent's. A hook covers the answer, share, extension commentary, scan
import, wordless filing, and anything an agent writes in a chat, a procedure,
or a reactor run, including the work a capture with words leads to (finding
8). It runs before the commit is recorded, so the owed wakeup is on disk
before the action is acknowledged (finding 6): the web answer returns after
`applyAndCommit` (`answer.ts:232-311`), the share after its commit
(`share/router.ts:76-81`). The cost is one place that every future agent must
know the trigger lives in; the hook header and the reactor DESIGN say so.

**Direction.**

- `beebox/src/cli/commands/wakeup/steps.ts`: extract the full-scan rules of
  `createIntakeJobsForUnjobbed` / `findUnjobbedInboxItems` (`:192-323`: under
  `_content/inbox/`, not under `feedback/`, not `.email-outbound.card`, the
  low-priority suffixes at `:216-217`) into a pure
  `inboxItemPriority(relPath): "normal" | "low" | null` that step 4b uses too.
- `beebox/src/core/wakeup-pending/owed-paths.ts`: pure
  `requestsWakeup({ relPath, frontmatter, connectorInboxPaths })`. True for an
  added `.job.card` under the jobs directory with no `connector` and no
  `priority: low`; true for an added card whose `inboxItemPriority` is
  `normal` and that lies outside every connector's `inboxPaths` (those are
  scoped-wakeup work, for example `_content/inbox/email`,
  `beebox/src/connectors/gmail/connector.ts:164`). False otherwise.
- `runPreCommitChecks` (`pre-commit.ts:64`) adds
  `listStagedRelPaths(boxRoot, { diffFilter: "A" })` to its parallel reads.
  When the checks pass (`errorCount === 0`), `BBX_FULL_WAKEUP` is not set, and
  any added path `requestsWakeup`, it calls
  `requestWakeup(boxRoot, { reason: "commit added <n> item(s)", newWork: true })`.
  A blocked commit requests nothing.
- When `requestWakeup` returns `none`, the hook prints one line to stderr:
  `Work is queued for this box, but no box server is running to process it;
  it runs when the server next starts.` Git shows hook output to the person
  who committed, so a CLI `bbx answer` on a standalone box prints it. On a
  unit host this line does not appear, because the wake step starts the
  server.
- A full wakeup sets `process.env.BBX_FULL_WAKEUP = "1"` at the start of
  `runWakeupCycle` when no `--connector` is given. Its own commits (step 4b's
  intake jobs, `steps.ts:257-266`) carry it to the hook through
  `commitEnvironment` (`commit-env.ts:12`) and request nothing; its reactor
  runs next in the same process. The agent's env is built from the allowlist
  (`script-env/core.ts:127`), which does not name the variable, so jobs an
  agent writes during the run still request a wakeup.
- The pre-commit hook is reinstalled by `bbx init`, docs refresh, migrations,
  and the convergence sweep (`install-validation-hooks.ts:57-59`); the hook
  command does not change, only the engine behind it.
- Scan and wordless filing keep their own wakeups. Their commits also request
  a trigger run. See NOT in scope and failure modes for the overlap.

**Vocabulary lock-ins.** `requestsWakeup`, `inboxItemPriority`,
`BBX_FULL_WAKEUP`.

**First chunk.** `inboxItemPriority` extraction with step 4b using it, and
`requestsWakeup`, both pure, with tests. Then the hook call, then the env
skip. No open question.

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
2. Run `bbx engine wakeup --max-cycles 3` once. This is the same cycle a
   trigger runs: it jobs unjobbed inbox items, queues contains backfill, runs
   up to three reactor cycles, finalizes, and pushes.
3. If `stalled-jobs` still lists jobs, stop and report; do not loop.

**Cost.** Each reactor cycle is one agent session, capped at 30 turns and
`maxBudgetUsd: 10` (`batch-jobs.ts:59-71`). At most 3 sessions per box, plus
one 10-turn session if step 1 splits. On a box running on its long-lived
Claude token this is subscription usage, not per-call spend.

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
- a CLI `bbx answer`, which has no server process to call, and an idle
  unit-host box, which has no server at all;
- a burst of five answers, which starts five wakeups; four skip on the cycle
  lock and the follow-ups written during the first run wait;
- agent-written jobs from a chat (captures with words), which have no call
  site;
- a pass-scheduled finalize on an idle unit-host box, which still has no
  `BBX_BOX_NAME`.

**Per-action call sites instead of the hook** (the first draft). Each site
needs its own "record before acknowledge" placement and its own retry repair
(the share's duplicate path returns early, `share/router.ts:63-69`), and
agent-written work has no site. The hook gives all of them one placement,
before the commit, and one test.

**Cut after the review.** The `bbx notify` refactor onto `routedSender`;
routing scheduled `notify:` actions and promotion notices on the on-wakeup
path; moving scan onto the trigger. None is needed for the boxholder's goals
in this release; each is in NOT in scope with its reason.

**What the fuller plan buys, per piece.** The marker with ids and a lock:
durability without lost requests (principle 4). The hook: one chokepoint,
record-before-acknowledge, agent work covered. The wake step: the
boxholder's "triggers, not waiting" on an idle box. The bus event: hearing
other processes without a token. The debouncer and single-flight: one run per
burst. `--max-cycles`: remaining jobs drain in the same run, with the
reactor's existing bound. The idle signal: no requests stuck behind a
draining server. The unit-host URL: routed notifications from the pass unit.

**Considered and rejected.**

- Let scoped wakeups also drain unscoped jobs. It undoes `b9ff55a40` and
  still does nothing on boxes whose connector schedules are disabled.
- A no-connector wakeup scope for triggers (skip connector sync). Adds a
  third wakeup mode. Left as open decision 3.
- A new tRPC `wakeup.request`. Needs the three env vars and a reachable
  server; the bus and the socket need neither.
- Re-arming the marker after a successful run when normal unscoped jobs
  remain. `--max-cycles` uses the reactor's existing progress rule instead of
  a second retry loop.

## Subplans

none

## Failure modes

> **Critical gap (accepted):** a job that fails in every run. With up to
> three cycles, a run stops when a cycle processes nothing, so a stuck job
> costs at most one extra cycle per triggered run, and it rides into every
> later batch. Handling: the `stalled-jobs` health check names it after 7
> days. Accepted because a per-job attempt count is a new concept with no
> second use yet; see open decision 2.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A request lands while a run is in flight | new (Track B) | new request id; compare-and-delete keeps it | clear (marker survives; trigger re-arms) |
| A request blocks on the lock while the clear runs | new (Track B, write-during-clear test) | lock serializes; the write lands after the delete with a new id | clear |
| Two requests in the same millisecond | new (Track B) | distinct random ids | clear |
| Deploy or OOM kills the wakeup child mid-run, repeatedly | new (Track B, six consecutive kills) | attempt counted before spawn; pre-spawn and startup checks abandon at 6 | clear (abandon log names the file) |
| Crash between the hook's marker write and the commit | none needed | marker exists, nothing new to do; one wakeup with no agent | clear (wakeup log) |
| Hook process dies between the marker write and the bus emit, server running | none | marker waits for the next request or server start | late, not lost; accepted (two local writes apart) |
| Agent commits with `--no-verify` | none | no request; the work rides on the next run | silent; accepted, see edge cases |
| Unit-host wake times out or is refused | new (Track C, fake socket) | warning logged; marker kept for the next start | clear (log line) |
| Wake reaches a server mid-drain | none | connection waits in the socket queue; new instance finds the marker (premise 2, probe-VM check) | clear on start |
| Standalone box, no server | new (Track D output test) | hook prints one line; marker waits for the next start | clear |
| Scheduled scoped wakeup holds the cycle lock when the trigger fires | new (Track C) | `lockSkipped`: attempt refunded, re-arm at 2 min; bounded by the holder's timeout | clear (log line per retry) |
| Scan or filing wakeup overlaps the trigger's run | new (Track C) | one skips on the cycle lock and re-arms; the later run finds the jobs drained and starts no agent | clear; costs one connector sync |
| A triggered run's own step 4b commit requests another run | new (Track D, env skip) | `BBX_FULL_WAKEUP` skips it | clear |
| Server idle-exits while a triggered wakeup runs | new (`decideIdle` with `liveRuns`) | live wakeups keep it up | clear |
| Server idle-exits with a retry timer pending | none needed | marker durable; next start re-arms | late, not lost |
| `wakeup-requested` row written by a newer engine than the server | none | generation bump; older engine refuses to open (`core.ts:58-69`) | clear |
| Finalize child cannot reach the server (hub down, DNS) | new (Track A, thrown send) | `NotifyServerError`; not latched; next finalize retries until the question leaves pending | clear (finalize log line) |
| Server answers the send but a delivery `failed` | new (Track A, returned `failed`) | not latched; retried as above | clear (notification log and finalize line) |
| No channel can carry the notification (all `skipped`) | new (Track A) | latched as today; no retry loop | clear (skipped lines in the notification log) |
| Pass child on idle unit host has no `BBX_BOX_NAME` | new (Track A, `buildEnv` test) | unit-host URL fallback | was silent; becomes routed |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field.** An agent writes a job card with
  `connector: gmail` for unscoped work: no request; the gmail tick runs it
  if that schedule is on. An agent writes `priority: low`: no request; it
  rides along. ADDRESSED by the predicate; both are the job's own claim.
- **Agent bypasses the hook** (`git commit --no-verify`, or writes without
  committing). No request. The work rides on the next triggered run. GAP,
  accepted: the hook is the only chokepoint; nothing in the engine sees a
  file an agent never commits.
- **Stale ref.** A follow-up job whose question was deleted before the run:
  existing `cleanupStaleJobs` (`steps.ts:92-185`) deletes jobs whose refs are
  all gone, inside the same triggered wakeup. ADDRESSED.
- **Two agents touching the same card.** A chat answers a question
  (`--via chat`, no job) while the reactor runs a follow-up for another: no
  shared card. ADDRESSED by existing locks; no new card writer.
- **Hand-edit drift.** A person deletes `.beebox/wakeup-pending`: the trigger
  finds nothing owed; the job waits for the next request. A person deletes
  `wakeup-abandoned` and `wakeup-attempts`: the next request runs. ADDRESSED
  (the abandon log line names the files, `wakeup.ts:175-179`).
- **Fabricated free-form value.** No new agent-written field. Not applicable.
- **Validation error UX.** A blocked commit requests nothing, so a failed
  commit does not start a run. The hook's one line is for a person at a
  shell. ADDRESSED.
- **Partial rollout.** During a deploy the old server has no trigger; a
  commit's hook (new engine) writes the marker and emits; the new server
  finds the marker at startup. ADDRESSED.
- **A burst that straddles a run.** Commits keep arriving during a run: they
  rewrite the marker with new ids and set `again`; one more run follows.
  ADDRESSED.
- **Job chains.** A follow-up job whose agent writes another unscoped job:
  the next cycle of the same run (up to 3) picks it up; past that, the agent's
  commit has requested another run. Each link is one agent action; the chain
  ends when an agent stops writing jobs. GAP, accepted: no engine rule can
  tell a useful chain from a loop; `stalled-jobs` does not see a moving chain.
- **Tab arrangement from the extension.** It lands in the inbox and opens a
  chat about it (`clerk.ts:111`, `:138`). Its commit requests a wakeup like
  any normal inbox item, as a full wakeup would job it today. DEFERRED
  (existing double handling).

### Scenario walks

Each walk is the planned code on a unit host. "Today" says where the current
code stops.

**1. Answer a question in the web UI; the follow-up runs.**

1. Browser → hub → socket → box server. `actions.answer`
   (`beebox/src/webapp/trpc/routers/actions.ts:57-60`) calls
   `answerWithAdmission` with `via: "web"`.
2. `executeAnswer` writes the follow-up job, then the answered card, and
   commits (`beebox/src/core/commands/answer.ts:265-284`).
3. The commit runs the pre-commit hook. Validation passes; the staged
   additions include an unscoped normal `.question-followup.job.card`, so
   `requestWakeup` writes `.beebox/wakeup-pending` (new id) and a
   `wakeup-requested` row; the endpoint file exists, so it returns `running`.
   The commit completes; the mutation returns.
4. Within 1 s the server bus poll (`core.ts:460-475`) delivers the event to
   `startWakeupTrigger`; the debouncer arms 2 minutes of awake time.
5. The window ends. The trigger takes a fresh admission and calls
   `runPendingWakeup`: budget checked, attempt counted, id read,
   `runBbxWakeup` spawns `bbx engine wakeup --max-cycles 3`
   (`wakeup.ts:54-70`); the live-wakeup count is 1.
6. The child sets `BBX_FULL_WAKEUP`, takes the cycle lock
   (`cycle-lock.ts:44-46`), runs steps 1-4d, then the reactor with no filter.
   Discovery finds the follow-up job (normal), so every pending job is
   selected (`cycle.ts:145-147`). One agent session works the batch and calls
   `bbx finish` per job. If normal jobs remain and the cycle processed one,
   the next cycle runs.
7. `runFinalize` spawns `bbx finalize` (`subprocess.ts:52-54`). Its env reads
   the endpoint file, so the three box vars are set; nudges and alerts go
   through `notifications.send` and are latched only when sent (Track A).
8. The child pushes, prints its outcome line, exits. The run counts as done;
   under the lock the id is unchanged, so the marker is deleted; attempts
   cleared.
9. What the person sees: the question shows answered at once; the
   follow-up's effects appear a few minutes later. Left behind: commits; no
   marker.

Today the walk stops after step 2: the job waits for an unscoped wakeup that
no schedule runs.

**2. Scan upload burst (26 sessions in a few minutes); one intake run.**

1. Each PUT lands in quarantine and calls `notifyScanUpload`
   (`promote-lifecycle.ts:141-147`), which re-arms the 2-minute promote
   settle window. Activity keeps the server up.
2. Two minutes after the last PUT, one promote pass runs under the promotion
   lock (`scan/promote/core.ts:223-250`). It marks scan's own wakeup owed
   before import (`:185-188`), runs `bbx upload --as scan` per credential
   group, and `scan-import` commits the sessions and appends them to the
   unscoped normal intake job (`session-discard.ts:92`).
3. Those commits run the hook: the added session cards and the job request a
   trigger wakeup. The trigger's 2-minute window starts.
4. The pass runs scan's own wakeup inline (`:266`), unchanged: one agent
   session gets one intake job holding every session from the burst.
5. The trigger's window ends while scan's wakeup still runs: its child skips
   on the cycle lock, returns `lockSkipped`, and re-arms. When scan's run
   ends, the trigger's run finds no normal job, starts no agent, and clears
   its marker. Cost: one connector sync.

Today: steps 1, 2 and 4. The 26-session job in production predates
`2e477780c` (2026-09-29), when scan intakes stopped getting their own
`-scan.intake` file. Whether a triggered run that left it pending is why it
stalled is unverified: box content was not read. Under this plan the
trigger's own run (up to three cycles) would retry it.

**3. Phone capture.**

- With words: delivered to a chat (`quick-capture/runtime.ts:24-29`). If the
  chat agent files it, no job exists and nothing runs. If the agent writes a
  job card or an inbox card and commits it, the hook requests a wakeup; walk
  1 from step 3.
- Without words: the 60-second lifecycle sweep (`runtime.ts:53-74`) appends
  the capture's doc to the unscoped intake job and commits
  (`filing-sweep.ts:86-88`); the hook requests a trigger wakeup; filing also
  starts its own wakeup (`runtime.ts:42`). As in walk 2, one of the two skips
  on the cycle lock and the later one starts no agent. The agent retitles or
  moves the doc; the next sweep sees it filed (`filing.ts:1-5`).
- A capture whose browser vanished: the server's 10-minute sweep seals it as
  partial and fires preparation (`capture/register.ts:63-77`). Unchanged.

**4. CLI `bbx answer` on the server, box server idle.**

1. Operator: `sudo -u bbx-<slug> -H bash -lc '... bbx answer <path> "yes"'`.
   `executeAnswer` writes the job and the card and commits
   (`cli/commands/answer.ts:25-27`).
2. The hook calls `requestWakeup`: marker written, bus row written, no
   endpoint file, unit host, so it connects to `/run/beebox/<slug>.sock` and
   requests `/api/build-info`. systemd starts `beebox-box@<slug>`.
3. The new server registers `startWakeupTrigger`, finds the marker, and arms
   the window; walk 1 from step 5.
4. The CLI prints `Answered:` and `Created follow-up job:` as today; the hook
   prints nothing (it started the server).

With the server running, step 2 returns `running` and the server's bus poll
reads the row. On a standalone host with no server, the hook prints its one
line and the marker waits for the next start.

**5. The box server idle-exits mid-burst.**

- During a burst, each request sets `lastActivityAt` (`idle-exit.ts:71-77`),
  so `decideIdle` returns `recent-activity` for 30 minutes after the last one.
  An exit cannot start inside a burst.
- After the burst, while the triggered wakeup runs, `liveRuns` includes the
  live wakeup, so `decideIdle` returns `live-runs` (`idle-exit.ts:44`). The
  server stays up and serves requests.
- The run ends; 30 minutes after the last activity the server drains and
  exits 0. The marker is gone, or kept with a retry delay; a kept marker
  re-arms at the next start, and a later commit's wake step starts that.
- Today: the server can start its drain while a scan or filing wakeup runs.
  It closes its listener (`idle-exit.ts:129`) and its `onClose` waits for the
  pass (`promote-lifecycle.ts:216`), so new requests wait in systemd's socket
  queue until the run ends. Found by reading; not observed.

## NOT in scope

- **Moving scan onto the trigger.** Scan's runner is in production and
  tested. The shared module keeps scan's `newWork` rule (finding 3), but the
  trigger's lock-skip refund and multi-cycle runs differ from scan's judgment.
  Folding scan in waits until the trigger has run on production; the cost
  until then is one extra connector sync per scan batch (walk 2).
- **Moving wordless-capture filing onto the trigger.** It has a per-capture
  kick budget and a "Filing is waiting" state the person sees
  (`beebox/src/core/quick-capture/filing.ts:12`). Same overlap cost as scan.
- **Routing scheduled `notify:` actions and promotion notices on the
  on-wakeup path** (`run-action.ts:82`, `promotion.ts:92` reached from
  `tick-utils.ts`). They run in a wakeup child only for on-wakeup scripts,
  which the boxholder has not asked about. File an issue when this plan
  lands.
- **The `bbx notify` refactor onto `routedSender`.** Not needed; it keeps its
  own `deliver` (`notify/command.ts:181-191`). Two short routing bodies until
  a later change folds them.
- **A per-job attempt count.** No second use yet; see the critical gap.
- **Question aging on boxes with no wakeups at all.** Finalize runs only after
  a reactor run (`beebox/src/core/reactor/engine/core.ts:158-163`). The daily
  `question-review` procedure is the existing backstop.
- **Widening the tooling allowlist with push keys.** Rejected by the
  boxholder.
- **Unfiled captures in `tmp-capture/`.** The health check counts delivered
  capture cards the chat agent did not file
  (`beebox/src/core/capture/sweep.ts:22-24` *"filing them is the chat agent's
  duty, per the schema instructions"*). No wakeup files them.
- **Fixing the stale "UI Sync button" comment** beyond one line in Track C's
  commit.

## Open design questions

1. **Bound on cycles per triggered run (finding 5).** A triggered wakeup runs
   up to `TRIGGER_MAX_CYCLES` reactor cycles and stops early when a cycle
   processes nothing (`core.ts:152-155`). Each cycle is one agent session (30
   turns, `maxBudgetUsd: 10`). Options: 1 (today's wakeup; remaining jobs wait
   for the next request), 3 (the reactor's default), more. Lean: 3.
2. **A job that fails every run.** See the critical gap. Lean: accept and
   watch `stalled-jobs`; add a per-job attempt count only if one appears.
3. **Should a triggered run sync connectors?** A full wakeup runs every
   configured connector (`beebox/src/cli/commands/wakeup/connectors.ts:58-61`)
   and on-wakeup scripts (`command.ts:142-153`), even when the boxholder
   disabled the check-email schedule. Scan and filing triggers do this today.
   Lean: keep the full wakeup; revisit if a boxholder disables a connector
   schedule to save cost.
4. **Contains backfill and other low-priority unscoped work.** No action owns
   "a card lacks `contains:`", so no trigger can own it. It rides along: a
   triggered run with normal work selects every pending job, low-priority
   included (`beebox/src/core/reactor/engine/cycle.ts:145-147`), and queues
   the next 25-card batch before its reactor step (`command.ts:209-219`). On a
   box with no actions it waits. Least periodic guaranteed option: a daily
   `bbx engine wakeup` whose precheck skips unless an unscoped job is older
   than 24h. Lean: ride-along only, with `stalled-jobs` as the signal. The same
   answer covers the low-priority `inbox-low` intake job.
5. **How the one-time drain runs.** Operator shell (Track E) or the boxholder
   asking the box's chat to run `bbx force-wakeup`, which runs the same cycle
   in the box server inside the sandbox (`beebox/src/cli/commands/force-wakeup.ts:8-12`).
   Lean: operator shell, because it allows the dry run first.

Settled in this revision: a CLI answer on an idle unit-host box wakes the
server (Track C step 4).

## Knowledge audits

Skipped: infrastructural. No agent-facing verb or card shape changes. An agent
that commits a job card now starts a wakeup, but the agent does nothing
different to cause it. Agents still answer with `--via chat`, which writes no
job.

## What will hold this after it ships

All tiers are `t.check` tests. Each names one claim that could be wrong.

- **Route choice** (`routedSender`): with the three env vars set, `send`
  calls the server and never `notifyBoxholder`; with one missing, it sends in
  process. A filesystem test with a fake tRPC client.
- **Sent rule** (`notificationSent`, pure): `sent` → true; all `skipped` →
  true; one `failed` and nothing reached → false; `failed` on one channel but
  `shown` → true.
- **Nudge not latched on a thrown send**: one question past its nudge
  threshold, sender throws; the latch has no `nudged` entry.
- **Nudge not latched on a returned `failed`**: sender returns a `failed`
  delivery; same assertion.
- **Alert not latched on failure**: one fresh question, sender returns
  `failed` (and, separately, throws); afterwards the latch `paths` does not
  contain it, and the next call sends again.
- **Unit-host box name** (`buildEnv`): with `BBX_UNIT_HOST=1`, no endpoint
  file, `BBX_PUBLIC_URL=https://h`, box at `/var/lib/beebox/fam/box`, the env
  has `BBX_SERVER_URL=https://h` and `BBX_BOX_NAME=fam`.
- **Compare-and-delete** (`shouldClearMarker`, pure, plus a filesystem test):
  a marker rewritten during the run survives.
- **Write during clearing**: hold the marker lock as the clearer, start a
  `markWakeupPending` that blocks on it, release; the marker exists with the
  writer's id.
- **Distinct ids**: two writes with the same frozen box time produce
  different ids.
- **Six consecutive kills**: a runner that throws without returning (as a
  killed child would) six times; the seventh `runPendingWakeup` does not call
  the runner and `wakeup-abandoned` exists. Also at trigger startup.
- **`newWork` kept**: scan's retry pass (only `promoting` entries) leaves the
  attempt count unchanged.
- **Lock skip refunds**: a runner result `lockSkipped` leaves the attempt
  count as it was and re-arms at the settle window.
- **Trigger debounce and single-flight** (injected `run`, fake clock, as the
  promote-debounce tests do): five events inside the window cause one run; an
  event during a run causes exactly one more.
- **Cross-process hearing**: an event emitted on a second `createEventBus`
  instance reaches the server bus listener (route test via
  `makeTestServer()`).
- **Startup**: a marker present at registration causes one run after the
  settle window; an abandoned one causes none.
- **Wake step**: with no endpoint file and `BBX_UNIT_HOST=1`, `requestWakeup`
  connects to the socket path it derives (a test Unix-socket server records
  one `GET /api/build-info`) and returns `started`; a refused connection
  returns `none` and keeps the marker.
- **`--max-cycles`**: the wakeup command passes the value to `runReactor`
  (injected reactor seam).
- **Idle decision** (`decideIdle`): `liveRuns` from a live wakeup keeps the
  server up.
- **Owed paths** (`requestsWakeup`, pure): unscoped normal job → true;
  `connector: gmail` job → false; `priority: low` job → false; an inbox
  `.doc.card` → true; `_content/inbox/email/…` → false; `.capture-session.card`
  → false; `feedback/` → false.
- **Hook requests on an answer commit**: a `makeTmpBox()` box with the hook
  installed; `bbx answer` writes the marker and one `wakeup-requested` row;
  `--via chat` writes neither.
- **Blocked commit requests nothing**: a staged invalid card plus a job card;
  no marker.
- **In-wakeup skip**: with `BBX_FULL_WAKEUP=1` in the committer's env, the
  hook writes no marker.
- **Standalone line**: no endpoint, not a unit host; the hook's stderr has the
  one line.

No new tier and no new mock beyond the existing injected seams and a local
Unix-socket test server.

## Implementation order

1. Track A: `NotifySender`, `routedSender`, `notificationSent`, nudge and
   alert latching, finalize passing the sender. Commit. Then the `buildEnv`
   unit-host fallback. Commit.
2. Track B: directory parameter, request id and lock, compare-and-delete,
   required `newWork`, count-before-run with pre-spawn check; scan still the
   only user. Commit.
3. Track C: `requestWakeup` (no wake step), the bus event,
   `startWakeupTrigger`, `--max-cycles`, live-wakeup idle signal. Depends on
   2. Commit. Then the unit-host wake step. Commit.
4. Track D: `inboxItemPriority` and `requestsWakeup`; the hook call; the
   `BBX_FULL_WAKEUP` skip; the standalone line. Depends on 3. Commit.
5. Docs: `beebox/docs/design/processing.md` ("recurring runs come from the
   `bbx tick` daemon" becomes triggers), `beebox/src/core/reactor/DESIGN.md:58`,
   the hook header in `install-validation-hooks.ts`, the stale Sync-button
   comment, and the Track E runbook in `beebox/deploy/README.md`. Commit.
6. After the boxholder says to land and deploy: Track E on the two
   production boxes with stalled jobs, with a separate yes for touching production.

## Rollout shape

Tests first, per chunk, as listed in *What will hold this*. Done when every
test there passes, change-selected tests pass, and `pnpm typecheck` and
`pnpm layout-check` pass from `beebox/`.

Before landing, on the probe VM (not production): with the box server
idle-exited, run `bbx answer` as the box user and confirm the unit starts and
the trigger runs; repeat while the server is mid-drain to settle Prior art
premise 2.

No data migration. The trigger's marker files are new; scan's stay where they
are. The event-schema bump truncates persisted bus rows on first open, the
existing resync path (`beebox/src/core/event-bus/core.ts:31-36`).

No knowledge audits land with this plan (see Knowledge audits).

After deploy: read one production box's notification log for a
`question-nudge` delivery that went through the server, and the box server's
journal for the trigger's run after an answer. Then run Track E.
