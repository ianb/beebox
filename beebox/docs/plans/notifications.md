---
title: "Notifications and proactive work: pieces an agent composes to reach the person"
status: draft
workstream: notifications
issues:
  - ../../../issues/features/2026-09-25-notifications-and-proactive-design.md
  - ../../../issues/features/2026-08-09-agent-outcomes-need-a-voice.md
  - ../../../issues/features/2026-08-21-capture-confirmation-misses-a-user-who-left.md
  - ../../../issues/features/2026-08-22-file-asks-agent-flagged-attention.md
  - ../../../issues/bugs/2026-09-21-agent-promises-unconfigured-calendar-delivery.md
  - ../../../issues/code-quality/2026-07-04-web-push-followup-testing.md
  - ../../../issues/features/2026-09-21-jev-triage-and-quick-capture-routing.md
---
# Notifications and proactive work: pieces an agent composes to reach the person

When I ask the box for a reminder, I want it to reach my phone at the right
time so I do not have to keep the box open. When I ask to be told when the
school emails about the field trip, I want the box to watch for it and tell
me once, so I can stop checking. When a capture I sent from the car could not
be read, I want to hear about it, so I do not assume it was filed. When
routine work succeeded, I want silence. The box has the conscience for all
of this and none of the voice: web push shipped in July and has never
delivered; the iPhone app, the main mobile surface, has no notification
path; only system health code can notify at all. This plan gives the agent
a small set of pieces (notify now, notify at a time, judge cheaply before
running, act on what changed since last time) and puts the policy in the
briefing. The experience and rulings behind it are in
[notifications-design-notes.md](notifications-design-notes.md).

**Issues addressed:** the frontmatter list. Grepped the queue for notif,
push, remind, proactive, digest, nudge, watch, apns, jev, interrupt, badge.
Related but not resolved here: the ideas page
(`issues/features/2026-09-25-agent-maintained-ideas-page.md`, its items
become possible but are not built), quick drop
(`issues/features/2026-09-25-quick-drop-entry-points.md`, a notification
action is one candidate entry point, not designed here), done-but-still-working
(`issues/features/2026-09-11-done-but-still-working-state.md`, a session
state, not delivery), the unpushed-box watcher
(`issues/features/2026-09-04-nothing-notices-a-box-that-stopped-reaching-its-remote.md`,
gets a channel from this plan but needs its own measurement), the chat timer
bug (`issues/bugs/2026-08-25-chat-timer-over-25-days-fires-instantly.md`,
the schedule-card reminder here is the durable alternative; the bug stays
filed), Google auth expiry
(`issues/features/2026-07-28-google-auth-expiry-health-and-notify.md`, its
delivery changes under Track E, its manual test stays open). The dev-side
schedule alert issues (`issues/features/2026-09-18-deploy-notifications-bypass-alert-priorities.md`
and the closed severity and sticky items) are a different system, the
developer's macOS alerts, and stay out.

## Smallest fix and budget

**Smallest fix.** Set the VAPID keys on prod, subscribe a desktop browser,
and add a `bbx notify` command that calls the existing `notifyBoxholder`.
About 80 source lines. It gives desktop push for health alerts and
questions, and an agent a way to say something. It does not reach the phone
(the iPhone app cannot receive web push, see *What already exists*), it has
no timed or conditional piece, and every alert stays as loud as it is today.

**Chosen design.** Six tracks:

| Track | Source lines | Test lines | Docs |
|---|---|---|---|
| A. Vocabulary, log-based delivery, presence, `bbx notify` | 450 | 250 | 40 |
| B. APNs: server service, device registration, delivery | 400 | 250 | 60 |
| C. APNs: iOS client | 300 Swift | 60 | 20 |
| D. Timed and conditional: `notify:`, schedule memory, `bbx changes`, `bbx judge`, judgment card | 640 | 420 | 100 |
| E. Sources: callouts, question sweep, health demotion and promotion | 250 | 200 | 20 |
| F. Guidance: briefing section, agent guide, chat prompt, audits | 60 | 40 | 120 |
| Total | 2,100 | 1,220 | 360 |

Additions plus deletions, estimated; Track A includes about 250 lines of
deletion (the `web-push` card, its connector, `bbx push test`). Authored
docs are the last column; there is no generated output. **BIG CHANGE:**
about 3,700 changed lines. The size comes from three channels that each
need a delivery path, plus the conditional pieces. What the fuller design
buys over the smallest fix: the phone, which is the surface the boxholder
uses; reminders and change-triggered checks with no agent at fire time; cheap judgments
before agent runs; and demoted health alerts, without which the channel
trains the person to ignore it. The boxholder approved the direction in
discussion on 2026-09-26; approval of this size is requested with the plan.

## Stated preferences this plan trades against

- **Rules in git, deliveries transient** (boxholder decision, 2026-09-26).
  The July web push plan routed every push through a committed output card
  (`docs/implemented-plans/web-push-notifications.md`, Track C). Several
  notifications a day, each committed on write and deleted on delivery per
  channel, is git history that is all plumbing. This plan keeps in git what
  is a rule or a run (a schedule card, a procedure card, a procedure run card,
  the briefing) and puts each intent and delivery in a gitignored
  append-only log, `.beebox/notifications.jsonl`, shown in the app. The
  event bus (`src/core/event-bus.ts`) carries the live signal to an open
  app and nothing more: the server prunes it at 24 hours
  (`src/webapp/server.ts:244`), so it is not a record.
- **Minimize invented concepts** (boxholder preference). Loudness is one word
  with three values. The reminder is a scheduled-script card with a
  `notify:` field, not a command and not a card type. The judge is a
  command, and its "not yet" is the scheduler's existing `deferred`
  outcome (`src/core/schedule/state.ts:39-45`) via the procedure runner's
  existing skip exit code. "What
  changed since my last run" is a field in schedule state and a command,
  not a card type: an earlier draft had a `watch` card with its own cursor,
  and the boxholder's direction (2026-09-26, "passing in the git log since
  the last call is an excellent way to do this kind of check") put the
  cursor on the schedule instead. The one new card type is the
  `judgment` card: a Jev prompt is an authored artifact the agent edits,
  versions, and replays ("building prompts for Jev is something we need to
  learn and iterate on"), and a shell string is not a home for that.
- **`bbx` is the box agent's surface** (`beebox/CLAUDE.md`). `bbx notify` is
  added because delivery is code the agent must call. `bbx remind` is not
  added: the reminder is a card the agent writes, with a worked example in
  the schema instructions (boxholder question, 2026-09-26: "is bbx remind
  better than just instructing the agent to make the card?").
- **Arrange context, do not automate judgment** (boxholder preference). Code
  owns delivery, timing, and the yes/no evaluation of a criterion the agent
  wrote. Code never decides that an outcome is notification-worthy; the
  briefing does. The health promotion rule (Track E) is the one place code
  decides, and it is a mechanical fact: a requested schedule did not run.
- **Nothing retries forever** (boxholder preference). APNs 410 and 400
  BadDeviceToken prune the token at once, matching web push's 404/410 rule
  (`docs/implemented-plans/web-push-notifications.md`, Track B). A schedule
  that waits on a judge has an `until`. A delivery is attempted once, at emit time; the outcome is
  logged and a failure becomes a health check. No retry queue.
- **Resilient and never silent** (`docs/engineering-principles.md:49`). An
  intent with no channel at all returns with no trace today
  (`src/core/notify-boxholder.ts:107-109`). This plan logs every intent
  and every delivery outcome and raises a health check when nothing could
  send. Health checks are computed on request by `runHealthChecks`
  (`src/webapp/trpc/routers/health.ts:153`); the new checks read the log,
  the Jev budget, and the schedule state. There is no entry store.
- **Scope anchored to the incident** (boxholder preference). Unread state on
  chat replies and quiet hours are deferred by the boxholder's ruling
  (2026-09-26): device Do Not Disturb covers quiet hours; unread is filed for
  later. No migration work: the boxholder has no active pairings or
  subscriptions, and no `web-push` card exists anywhere.
- **The most recent shipped precedent** is the web push plan
  (`docs/implemented-plans/web-push-notifications.md`): endpoint-keyed
  server-level store, `PushService` real and fake, `push-debug.log` sink.
  Track B keeps the store and service shape for APNs, with the device record
  as the store.

## What already exists

- **Dispatcher.** `src/core/notify-boxholder.ts:69` `notifyBoxholder(boxRoot,
  input)` with `NotifyInput { title, body, url, severity?, tag?, name?,
  deliver?, ... }` (`:45-60`). Writes a web-push card when a device is
  subscribed and a telegram card when `healthAlerts.telegramChat` is set;
  returns with nothing when neither (`:107-109`). **Reuse and rewrite:** it
  stays the single entry point, takes a `NotificationIntent`, logs it,
  emits the live bus event, and calls each chosen channel once (Track A).
- **Callers, all system code:** `src/core/question-alert.ts:104`
  (`severity: "alert"`), `src/core/question-aging.ts:214` (`severity:
  "info"`), `src/core/schedule/health-alert.ts:84`,
  `src/core/schedule/connector-activity-alert.ts:61`,
  `src/core/schedule/google-auth-alert.ts:86`,
  `src/core/agent/engine-unavailability-apply.ts:38`. **Reuse:** Track E
  changes what each does.
- **Event bus.** `src/core/event-bus.ts`: SQLite at `.beebox/events.db`,
  `emit` persists and dispatches, `subscribe({ afterId })` replays
  (`:174-196`), cross-process with `pollInterval` (`:212-219`). Events are
  typed by `src/core/event-bus-schemas.ts:84`. `chat-complete` (`:173`)
  carries `sessionId`. `card-created` (`:126`) is emitted only by the UI
  action routes (`src/webapp/trpc/routers/actions.ts:111`,
  `src/webapp/routes/actions.ts:76`), not by connectors or agents.
  The server prunes events older than 24 hours (`src/webapp/server.ts:244`).
  **Reuse:** the bus carries the live `notification` event to open apps;
  it is not the record. The turn-end hook where `<schedule>` tags are
  parsed (`src/webapp/routes/chat.ts:125-138`) is where callouts are
  parsed. "What changed" cannot be read from the bus and is read from git
  (Track D).
- **Output-card delivery helper.** `src/connectors/output-cards.ts:57`
  `deliverPendingOutputCards`: `null` deletes the card (`:91-92`), a
  message stamps `failed` (`:95-103`). **Keep for Telegram replies; not used
  for notifications** after this plan.
- **Web push sender and store.** `src/core/send-push.ts` `sendPush`,
  `src/core/push-subscriptions.ts` endpoint-keyed store,
  `src/services/push.ts` real and fake. **Reuse** the sender and store as
  the `web-push` channel worker. **Delete** `src/schemas/web-push.ts`,
  `src/connectors/push.ts:51`, and `bbx push test`
  (`src/cli/commands/push.ts:14-26`). No card of that type exists on disk
  anywhere (the feature never ran; cards delete on delivery;
  `issues/code-quality/2026-07-04-web-push-followup-testing.md`). The
  service worker payload `{ title, body, url, tag }` stays.
- **Telegram.** `src/schemas/telegram-message.ts:23-29` card and
  `src/connectors/telegram-output-cards.ts:28` stay for chat replies.
  `TelegramService` (`src/services/telegram.ts`) is called directly by the
  `telegram` channel worker with `disable_notification` for `quiet`.
- **Scheduled scripts.** `src/schemas/scheduled-script.tsx` fields `cron, at,
  rrule, until, once, runs, requires, create-after-success`; `runs` is
  required (`:61`). `bbx tick` runs it with `execWithTimeout(parsed.runs, {
  cwd: boxRoot, env })` (`src/cli/commands/tick-helpers.ts:275-282`),
  records `success` (`:285`), deletes a `once` card after success
  (`:184-201`), and skips a card whose `requires.connectors` are missing
  with a log line only (`:142-144`). Schedule state records `lastResult:
  "success" | "failure" | "deferred" | "inconclusive"`
  (`src/core/schedule/state.ts:45`); `deferred` freezes the failure counter
  (`:225`). **Extend:** `notify:` as an alternative to `runs`; a judge that
  says "not yet" records `deferred`; `once` deletes only after a run that
  was neither deferred nor skipped.
- **Chat timers.** `<schedule in="20m" ...>` (`src/core/chat/session/prompts.ts:166`)
  arms a `setTimeout` in the server process, persisted in
  `.beebox/chat-schedules.json` (`src/core/chat/schedules.ts:11`), and fires a
  `<schedule-fired>` message into the chat session
  (`src/core/chat/session/pool.ts:287`). It runs an agent at fire time, lands
  only in the chat, and breaks past about 25 days
  (`issues/bugs/2026-08-25-chat-timer-over-25-days-fires-instantly.md`).
  **Keep:** it is the tool for a same-conversation follow-up within hours.
  Track F tells the chat agent when to use it and when to write a schedule
  card.
- **Callouts.** `<callout context="...">` marks "content the user must
  actually read" and its prompt already says the body must stand alone "in a
  digest or notification" (`src/core/chat/session/prompts.ts:155-160`).
  Consumed by `src/frontend/src/components/chat/CalloutBlock.tsx` and
  `ambient/projection.ts`. **Reuse:** a callout is the chat agent's notify
  (Track E).
- **Live subscribers.** `src/webapp/trpc/routers/events.ts:62` `subscribe` is
  the one long-lived subscription every open web app holds, per box. No
  registry counts them, and an idle tab is not presence. **Extend:** a
  client heartbeat (Track A).
- **Jev.** `src/services/jev.ts:15-17` `JevService.decide({ state, criteria })`
  returns a Choice distribution; real client at `:118` posts to
  `https://openrouter.ai/api/alpha/decisions` (`:128`) with model
  `typesafe/jev-1.13` (`:92`); fake at `:169` `createFakeJev`. Key via the
  `openrouter` secret, purpose listed at `src/core/secrets/uses.ts:78`.
  **Extend:** add `judge({ situation, instructions, questions, state })`
  for all three question types (Track D).
- **Procedures.** `src/schemas/procedure.ts:54` a step has `precheck`, `run`,
  `validate`; each phase has `shells`, `agents`, `instructions`, `whys`
  (`:30-33`); `precheck` adds `pass-output` (`:36-40`). The runner's
  `runPrecheck` (`src/core/procedure/engine-step.ts:133`) executes the
  shells and treats exit 75 (`CHECK_SKIP_CODE`, `src/core/procedure/shell.ts:12`)
  as skip. The run card records `status: pass | fail | skip`
  (`src/schemas/procedure-run.ts:15-19`). **Reuse unchanged:** a `shells`
  step runs `bbx judge` like any command; the skip code is the precedent
  for the tick's deferred (Track D).
- **Pairing device record.** `src/core/mobile/pairing.ts:19`
  `MobileDeviceSchema { id, label, tokenHash, createdAt, createdBy,
  lastUsedAt?, revokedAt? }` in the box-level
  `.beebox/mobile-devices.secret.json` (`:5`). `listMobileDevices` strips
  only `tokenHash` (`:103-104`) and `pairing.devices` returns that to the UI
  (`src/webapp/trpc/routers/pairing.ts:50`). Bearer resolution at `:167`.
  **Extend:** an `apns` field and a projection that strips its token
  (Track B).
- **iOS app.** `@UIApplicationDelegateAdaptor(BeeBoxAppDelegate.self)`
  (`ios-app/BeeBox/BeeBoxApp.swift:5`) with the `PairedBoxStore` owned by
  the SwiftUI app (`:6`); `onOpenURL` (`:39`) feeds the pairing inbox;
  `scenePhase` handling at `ios-app/BeeBox/Views/RootView.swift:147`; every
  request is authenticated by `BoxRequest.apply`
  (`ios-app/BeeBox/Services/BoxRequest.swift:21`); the webview is loaded from
  `ChatWebView.authenticatedRequest(for:page:)`
  (`ios-app/BeeBox/Views/ChatWebView.swift:1069`). No `UserNotifications`
  import, no `aps-environment` entitlement, team `44AJ3D25ZD`, bundle
  `app.beebox.ios` (`ios-app/BeeBox.xcodeproj/project.pbxproj:791-804`).
  **Extend** (Track C).
- **Mobile contract.** `docs/mobile-contract.md:8` the sync rule; the
  tripwire `bin/mobile-contract-check.ts` (`:1385`). Track B adds a route and
  updates the contract and fixtures in the same commit.
- **Health page.** `src/frontend/src/pages/DashboardPage.tsx:26` reads
  `trpc.health.check` (`src/webapp/trpc/routers/health.ts:342`), which runs
  `runHealthChecks` (`:153`) and `loadScheduleHealth`
  (`src/core/schedule/health-box.ts`); `HealthWarnings.tsx:40` renders
  failing checks. No toast or banner component exists in the frontend
  (searched); an in-app notification banner is new work. `/box/health` as a deep
  link does not exist as a route; callers that pass it land on the
  dashboard. **Reuse:** demoted health alerts appear here; the plan fixes
  the target to `dashboard`.
- **Admin Notifications section.**
  `src/frontend/src/components/admin/NotificationsSection.tsx`, registered as
  `scope: "device"` (`admin-sections.ts:59`). **Reuse:** it also lists paired
  phones and recent deliveries (Tracks A and B).
- **Box config.** `healthAlerts.telegramChat` (`src/core/box/config.ts:75-79`)
  is read from an unvalidated cast (`:359-362`). **Keep** the field; no new
  config keys are added.
- **Triage moves cards.** `src/core/triage/routing.ts:74` renames inbox
  cards into `inbox/triaged/<category>/` during the reactor's jobs phase;
  finalize runs after that (`src/core/reactor/engine.ts:2-14`). A path
  target can go stale when a later cycle moves the card. Accepted for v1.
- **Connector health.** `src/core/schedule/connector-activity-alert.ts:40`
  already tracks a failing or quiet connector per episode. **Reuse:** the
  promotion rule reads it for a `requested-by` schedule with `requires`.
- **Script environment.** The tick builds each script's env
  (`src/cli/commands/tick-helpers.ts:275`), and procedure shells rebuild
  theirs through `buildScriptEnv` (`src/core/procedure/shell.ts:51`),
  which inherits only allowlisted variables
  (`src/core/script-env-allowlist.ts:59`). `getHead` exists
  (`src/lib/git.ts:557`); `getDiff` (`:455`) wraps only the working-tree
  diff, not a commit range. **Extend:** the new variables are added to the
  allowlist, and a `getRangeDiff` helper is new (Track D).
- **Skip sites.** `evaluateSkip` in the tick returns a reason and the loop
  moves on without recording anything in schedule state
  (`src/cli/commands/tick.ts:119-125`); the latch fields model only
  `failing | overdue | invalid` (`src/core/schedule/state.ts:52-55`).
  **Extend:** a skip episode is recorded so the promotion rule can latch
  (Track E).
- **No `bbx cat`.** Searched `src/cli/commands`; no command prints a card by
  path. `bbx changes --cat` (Track D) prints the changed cards with a path
  header, which is what a judge and an agent need.
- **Searched and not found:** `bbx remind`, `bbx notify`, `bbx changes`, any
  unread concept outside Gmail, any `UIBackgroundModes`, any notification
  mention in the iOS plans, any toast component.

## Prior art (external)

- **APNs headers and push types.** `apns-push-type: alert` covers banner,
  sound, and badge changes; `background` is for `content-available` only.
  https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns
- **Badge-only payload.** `aps.badge` with no `alert` and no `sound` updates
  the icon with no banner. Send it as push type `alert`; whether Apple permits
  `background` for badge-only is unverified, so the plan does not depend on
  it. https://developer.apple.com/library/archive/documentation/NetworkingInternet/Conceptual/RemoteNotificationsPG/CreatingtheNotificationPayload.html
- **Interruption levels.** `passive` (no sound, no wake), `active` (default),
  `time-sensitive` (needs the Time Sensitive capability), `critical` (needs
  Apple approval). This plan uses `passive` for quiet and `active` for loud
  and never the other two. https://developer.apple.com/videos/play/wwdc2021/10091/
- **Dead tokens.** 410 Unregistered and 400 BadDeviceToken both mean prune. A
  sandbox token sent to the production host returns BadDeviceToken, so the
  device must report which environment its build was signed for.
  https://faqs.ably.com/for-apples-apns-what-is-the-sandbox-endpoint
- **Token churn.** Tokens change on reinstall and restore with no client
  signal; register on every launch.
  https://developer.apple.com/forums/thread/736943
- **Node client.** `@parse/node-apn` 8.1.0, published within the last five
  months, token auth over HTTP/2, no native dependencies; `apns2` 12.2.0 is a
  year older. Node's built-in `http2` plus `jose` for an ES256 JWT is a
  documented zero-dependency alternative. Decision: `@parse/node-apn`; a
  sender is about 40 lines either way and the library carries the GOAWAY and
  reconnect handling. https://www.npmjs.com/package/@parse/node-apn
- **iOS client.** `requestAuthorization([.alert, .badge, .sound])`;
  `.provisional` delivers quietly with no prompt but cannot show a banner, so
  it cannot carry `loud`; the plan prompts once at first pairing.
  `setBadgeCount` (iOS 16+) replaces the deprecated
  `applicationIconBadgeNumber`. `willPresent` chooses foreground presentation;
  `didReceive` handles the tap.
  https://developer.apple.com/forums/thread/740096
- **Jev question types.** Choice, Score, Noul (yes/no, returns the
  probability of yes). Wire shape through OpenRouter's Decisions API (alpha):
  `{ model, state, questions: { name: { type: "noul", instructions, criteria } } }`.
  Price listed at $0.042 per million input tokens; no rate limit published.
  https://docs.typesafe.ai/llms.txt ,
  https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-questions-and-answers-request
- **Web push cannot be silent.** Chrome shows "This site has been updated in
  the background" when a push shows no notification; `silent: true` mutes
  sound but the notification still shows. So on the desktop, `dot` sends
  nothing and `quiet` is a muted notification.
  https://pushpad.xyz/blog/chrome-push-notifications-this-site-has-been-updated-in-the-background

## Ontology

- **Notification intent.** One intent to reach the person: `id`, `title`,
  `body`, `target`, `loudness`, optional `tag` (collapse key), `source`
  (which code, card, or chat session wrote it). A TypeScript type
  (`NotificationIntent`) and one line in the notification log. It is NOT a
  card and is never committed. New (Track A).
- **Delivery.** One attempt on one channel for one intent: `notificationId`,
  `channel`, `status: sent | skipped | failed`, `detail` (`present`,
  `no-audience`, `unconfigured`, or the error). One line in the
  notification log. New (Track A).
- **Notification log.** `.beebox/notifications.jsonl`, gitignored,
  append-only, one JSON line per intent and per delivery, trimmed to 30
  days at finalize. The record the Admin section and the `chat:new` banner
  read. NOT the event bus.
- **Loudness.** `dot | quiet | loud`. On the phone: badge only; passive
  banner; active banner with sound. On desktop web push: nothing; muted
  notification; notification. Telegram: nothing; message with
  `disable_notification`; message. In an open app: a toast for `quiet` and
  `loud`, nothing for `dot`.
- **Target.** Where tapping lands. `chat:<sessionId>`, `chat:new`, `card:<path>`,
  `question:<path>`, `dashboard`. A string with a scheme, parsed by one
  function that also renders the deep-link URL for each channel. It is NOT a
  raw URL. `question:` and `card:` point at cards by path
  (`src/core/question-alert.ts:100` builds the browse URL today).
- **Channel.** A way to deliver: `apns`, `web-push`, `telegram`. Each has a
  service (real and fake), an audience lookup, and a `send(intent)` that
  returns a delivery. `web-push` and `telegram` services exist; `apns` is
  new (Track B).
- **Device.** A paired phone: the existing `MobileDevice`
  (`src/core/mobile/pairing.ts:19`), extended with
  `apns: { token, environment: "sandbox" | "production", registeredAt }`.
  Belongs to a box (the file is box-level) and to the person who paired it
  (`createdBy`).
- **Presence.** The number of web sessions for the box in which a person
  interacted within the last two minutes, reported by a client heartbeat.
  NOT the count of open subscriptions. Per box, not per target.
- **Reminder.** A scheduled-script card (`src/schemas/scheduled-script.tsx`)
  with `at`, `once: true`, `requested-by: boxholder`, and a `notify:` field
  in place of `runs`. NOT a new card type and NOT a command. In git, as the
  rule.
- **Chat timer.** The existing `<schedule>` tag entry
  (`src/core/chat/schedules.ts:26`). NOT a reminder: it re-enters a chat and
  runs an agent.
- **Judgment card.** An authored Jev prompt: named questions of the three
  types in frontmatter, instructions in the body, no state. New card type
  `<name>.judgment.card` (Track D). In git, as the rule.
- **Judgment.** One Jev call: a judgment card plus one state from stdin,
  returning an answer per question. Exists as `JevDecision` for Choice
  (`src/services/jev.ts:9`); Track D adds the Noul and Score forms. A
  judgment is NOT a decision: `bbx judge`'s filters or a `jq` after it make
  the decision.
- **Carry.** One value a schedule's script writes for its next run, in
  schedule state, replaced each run. NOT a log.
- **Deferred.** The scheduler's existing outcome for "not the task's fault,
  try again next time" (`src/core/schedule/state.ts:39-45`). A `runs:`
  pipeline that exits 75 records it. NOT a failure and NOT a success:
  `once` does not fire on it.
- **Change cursor.** `lastCommit` in a schedule's state: the box HEAD when
  that schedule last ran. Per schedule, transient, never in git. Exposed
  to the script as `BBX_SINCE_COMMIT`. NOT a global cursor: two schedules
  over the same path each see their own "since".
- **Change set.** The card paths added or modified under a glob between a
  commit and HEAD, as `bbx changes` prints them. A tree diff, so a card
  moved during the window appears once at its final path. NOT an event
  stream.
- **Callout.** The existing chat tag for content the person must read
  (`src/core/chat/session/prompts.ts:155`). Gains an optional `loudness`
  attribute (Track E).
- **Health entry.** A failing check in `getHealthSnapshot`
  (`src/webapp/trpc/routers/health.ts:342`). Exists. Demoted alerts are
  health entries; they never notify on their own (Track E).

## Tracks / scope

### Track A. Vocabulary, log-based delivery, presence, `bbx notify`

**What.** Give every notification a `loudness` and a `target`; log every
intent and delivery; decide at emit time which channels to try from
loudness and presence; deliver once, in process; show it in an open app;
expose it as `bbx notify`; remove the `web-push` card path.

**Why this needs to change.** Agents have no command at all today
(`src/core/agent-guide/` has no notify section; searched). Every caller
passes a `severity` that no channel distinguishes. Committed output cards
per delivery are git history that is all plumbing (boxholder decision).

**Direction.**

- `src/core/notification/intent.ts`: `NotificationIntent { id, title, body,
  target, loudness, tag?, source }`, `Loudness`, the Zod schemas for the
  log lines, and one new bus event `notification` (the intent plus `url`)
  in `src/core/event-bus-schemas.ts:84` for open apps.
- `src/core/notification/log.ts`: `appendIntent`, `appendDelivery`,
  `readRecent(boxRoot, { days })`, `getIntent(boxRoot, id)`. The write
  protocol, since three processes append (server, scheduler daemon, `bbx`):
  one `O_APPEND` write per line, under 4 KB, which the filesystems in use
  deliver atomically; the file is never rewritten in place. Rotation, not
  trimming: at finalize, when the file is older than 30 days or over 8 MB,
  it is renamed to `notifications.1.jsonl` (replacing the previous one) and
  a new file starts; a writer holding the old descriptor lands its line in
  the rotated file, which readers also read. Read by a `notifications` tRPC
  router (`recent`, `get`).
- `src/core/notification/target.ts`: `parseTarget(s): Target` and
  `targetUrl(target, boxSlug): string` (root-relative, the shape
  `question-alert.ts:100` builds today). `chat:new` renders to
  `/<box>/chat?new=1&notification=<id>`; the chat page calls
  `notifications.get`, shows the intent as a banner above an empty
  composer, and includes it as context in the first message the person
  sends, the way `<schedule-fired>` carries context
  (`src/core/chat/session/pool.ts:287`). No agent runs on tap. A `card:` or
  `question:` target is a path; triage may move the card later
  (`src/core/triage/routing.ts:74`) and the tap then lands on the
  missing-card page. Accepted for v1.
- `src/core/notification/presence.ts`: `livePresence(boxRoot): { activeWeb:
  number }`. The frontend sends a heartbeat every 30 seconds while a person
  has interacted in the last two minutes (`pointerdown`, `keydown`,
  `visibilitychange` to visible). The server keeps the count in memory and
  writes `.beebox/presence.json` by atomic rename with a timestamp; another
  process reads it and treats a timestamp older than 90 seconds as zero.
- `src/core/notification/channels.ts`: `channelsToTry({ intent, audience,
  presence }): Channel[]`, pure. `loud`: every channel with an audience.
  `quiet`: every channel with an audience unless `activeWeb > 0`, then
  none: the in-app banner shows it. `dot`: `apns` only, always. A `dot`
  has no banner and no unread mark (deferred), so suppressing it while a
  person is active on some unrelated tab would lose it entirely; a badge
  that clears on foreground is the cheaper error, and the boxholder
  accepted the clearing rule. Channels not tried get a `skipped` delivery
  with `present` or `no-audience`.
- `src/core/notify-boxholder.ts`: `notifyBoxholder(boxRoot, intent, {
  services?, now? })` appends the intent, emits the bus event, calls each
  chosen channel's `send` once in process, and appends each delivery. No
  queue and no retry: a failure is a `failed` line and a health check.
  Callers are the scheduler daemon (in process, `scheduler.ts:250`), the
  server (callouts), and `bbx` (agents); all three already build services
  the same way the health alert does with `deliver: true` today.
- `src/core/notification/health.ts`: three checks added to `runHealthChecks`
  (`src/webapp/trpc/routers/health.ts:153`): "notifications that could not
  be delivered in the last 24 hours" and "notifications with no channel",
  both read from the log with the titles, and "notification log not
  writable", which probes by opening the file for append, so an unwritable
  log is reported by a check that does not depend on the log.
- `src/cli/commands/notify.ts`: `bbx notify <title> [--body <text> |
  --body-file <path> | stdin] --target <t> [--loudness dot|quiet|loud]
  [--tag] [--channel <name>] [--check] [--targets-from-stdin]`.
  `--body-file` and stdin exist
  because a body an agent composed does not belong on a command line.
  `--check` prints which channels can reach the person and exits 1 when
  none can, so an agent can check before promising (the failure in
  `issues/bugs/2026-09-21-agent-promises-unconfigured-calendar-delivery.md`).
  `--channel` restricts delivery for testing and replaces `bbx push test`.
  Exit 1 with the delivery detail when every tried channel failed.
- In-app banner: a `NotificationBanner` component under the app shell that
  shows a `notification` bus event for `quiet` and `loud` while present,
  with the target as its link. New; no toast component exists.
- Admin Notifications section: a "Recent" list over `notifications.recent`
  for the last three days (title, when, channel, status, detail).
- Delete `src/schemas/web-push.ts`, its registry entry,
  `src/connectors/push.ts`, `src/cli/commands/push.ts`. Service worker:
  `quiet` sets `silent: true`.

**Vocabulary lock-ins.** `loudness` and its three values; `target` scheme
strings; channel names `apns`, `web-push`, `telegram`; the log path and
line shapes; the bus event name `notification`; delivery statuses and
details.

**First implementation chunk.** `intent.ts`, `log.ts`, `target.ts`,
`channelsToTry` with its doctest over the loudness-by-presence matrix, the
rewritten `notifyBoxholder` with the `web-push` and `telegram` channels,
and a filesystem doctest: a box with a fake subscription and a telegram
chat gets two `sent` lines for `loud`; gets two `skipped: present` for
`quiet` with presence; gets a `no-audience` line and a failing health check
for `quiet` with no audience and no presence; a failing push is one
`failed` line and a health check. Existing callers pass `loudness: "loud"`
and a parsed target in this chunk so nothing regresses; Track E changes
them.

### Track B. APNs: server service, device registration, delivery

**What.** An `apns` channel: a service (real via `@parse/node-apn`, fake),
device token registration on the pairing record, and a channel `send` with
pruning.

**Why this needs to change.** The iPhone app is a `WKWebView` shell
(`ios-app/README.md`) and cannot receive web push. There is no APNs code
(searched `ios-app/` and `src/`).

**Direction.**

- Secrets: `BBX_APNS_KEY_PATH` (the `.p8` file), `BBX_APNS_KEY_ID`,
  `BBX_APNS_TEAM_ID`, `BBX_APNS_BUNDLE_ID` in `/home/beebox/.env`, the same
  home as VAPID (`docs/implemented-plans/web-push-notifications.md`, Track B).
  Documented in `deploy/README.md` beside the VAPID step. Missing values make
  the channel `skipped: unconfigured`, never a throw.
- `src/services/apns.ts`: `ApnsService.send({ token, environment, payload })
  -> { ok } | { gone } | throws`. Real wraps `@parse/node-apn` with one
  provider per environment; fake records calls. Payload builder in
  `src/core/notification/apns-payload.ts`, a pure function: `dot` gives
  `{ aps: { badge: 1 }, target }`; `quiet` gives `{ aps: { alert: { title,
  body }, "interruption-level": "passive", badge: 1 }, target, loudness }`;
  `loud` adds `sound: "default"` and level `active`. `apns-collapse-id` is
  the `tag`. `apns-push-type: alert` for all three.
- `src/core/mobile/pairing.ts`: `MobileDeviceSchema` gains
  `apns: z.object({ token, environment: z.enum(["sandbox", "production"]),
  registeredAt }).optional()`. New `registerDevicePush(boxRoot, { deviceId,
  token, environment })` and `pruneDevicePush(boxRoot, deviceId)`. The
  projection `listMobileDevices` (`:103-104`) strips `apns.token` as it
  strips `tokenHash` and exposes `push: { environment, registeredAt } |
  null`, so a raw token never leaves the process.
- Route: `POST /api/pairing/push-token` body `{ token, environment }`,
  authenticated by the device bearer (`resolveMobileBearerIdentity`,
  `src/core/mobile/pairing.ts:167`), raw Fastify beside the redeem route
  (`src/webapp/routes/pairing.ts:20`), because the caller is native code
  using the same path family. Contract section 5.8 in
  `docs/mobile-contract.md`, fixture under `test/mobile-contract/fixtures/`,
  same commit.
- Channel `send`: audience is every device of the box with an `apns` field
  and no `revokedAt`. `gone` prunes the `apns` field and logs the device label,
  never the token. `.beebox/push-debug.log` gets one line per send with
  loudness and target, no token.
- Admin Notifications section lists paired devices with a push
  registration and their environment from the `push` projection.

**Vocabulary lock-ins.** `apns` field name and `environment` values on the
device record; the route path; the payload's custom `target` and `loudness`
keys, which the iOS client reads.

**First implementation chunk.** `apns-payload.ts` with a doctest over the
three loudnesses, `ApnsService` real and fake, the device record extension
and projection, `registerDevicePush`, and the route with a route doctest
(`makeTestServer()`): a device registers, re-registers with a new token,
the projection hides the token, and `gone` prunes. The channel is the
second chunk.

### Track C. APNs: iOS client

**What.** The app requests notification permission, registers for remote
notifications on every launch, posts the token, presents or suppresses in the
foreground by loudness, opens the target on tap, and clears the badge on
foreground.

**Why this needs to change.** No notification code exists in the app
(searched). Without it, Tracks A, B, and D never reach the phone.

**Direction.**

- Entitlement `aps-environment` on the app target (Xcode adds it with the
  Push Notifications capability). The share extension does not need it.
- `BeeBoxAppDelegate` (`ios-app/BeeBox/BeeBoxAppDelegate.swift:4`): in
  `didFinishLaunching`, set `UNUserNotificationCenter.current().delegate` and
  call `registerForRemoteNotifications()`; in
  `didRegisterForRemoteNotificationsWithDeviceToken`, hand the hex token to
  `PushRegistrar.shared`. The delegate has no access to the SwiftUI-owned
  `PairedBoxStore` (`ios-app/BeeBox/BeeBoxApp.swift:6`), so `BeeBoxApp`
  injects the store into the registrar at launch and the registrar observes
  it for pairings; the token callback and the store change both call one
  `syncRegistrations()`. `didFailToRegister` logs through the existing
  native log forwarding (`docs/mobile-contract.md:1021`).
- `PushRegistrar` (`ios-app/BeeBox/Services/PushRegistrar.swift`): posts
  `{ token, environment }` to every paired box using `BoxRequest.apply`
  (`ios-app/BeeBox/Services/BoxRequest.swift:21`); `environment` is
  `sandbox` for `DEBUG` builds and `production` otherwise. Permission is
  requested once, at first successful pairing, with `[.alert, .badge,
  .sound]`; a denial is shown in the paired-box shell as a one-line state
  with a link to Settings, per principle 13
  (`docs/engineering-principles.md:151`).
- `willPresent`: read `loudness` from `userInfo`; `loud` presents as banner
  and sound; `quiet` and `dot` present nothing. The webview shows the in-app
  banner when it is open (Track A).
- `didReceive`: read `target` from `userInfo`, build the URL with the paired
  box's base URL, and load it through the existing
  `authenticatedRequest(for:page:)` path
  (`ios-app/BeeBox/Views/ChatWebView.swift:1069`), extended with a
  `.path(String)` page case.
- On `scenePhase == .active` (`ios-app/BeeBox/Views/RootView.swift:147`),
  call `setBadgeCount(0)` and remove delivered notifications whose loudness
  was `dot`.

**Vocabulary lock-ins.** `userInfo` keys `loudness` and `target`, identical
to the bus event fields.

**First implementation chunk.** Entitlement, delegate registration,
`PushRegistrar`, and a unit test of the environment and URL construction in
the existing test target. Verified in the simulator up to the registration
call; the simulator has no APNs token, so the post is exercised with a fake
token behind a `DEBUG` launch argument.

### Track D. Timed and conditional: `notify:` on schedules, schedule memory, `bbx changes`, `bbx judge`

**What.** A reminder is a scheduled-script card whose action is a
notification. A schedule remembers the commit and time it last ran and
carries one value forward. `bbx changes` lists what changed in the box
since then. `bbx judge <path>` sends state on stdin to Jev through an
authored prompt card and applies a basic decision. A schedule's `runs:`
composes these in one pipeline; a procedure is for several steps or an
agent. A pipeline that skips is the scheduler's existing `deferred`.

**Why this needs to change.** A reminder today is a chat timer that runs an
agent, lands only in the chat, and dies past 25 days. A scheduled check
that asks a question runs an agent every time, which is what makes many
small proactive tasks too expensive
(`issues/features/2026-09-21-jev-triage-and-quick-capture-routing.md`). The
boxholder's direction (2026-09-26): a defer state ("runs regularly until
the judge says it fires"); no Jev call when nothing happened; "the git log
since the last call" as a supported and suggested pattern, with a place
to pass information forward; the judge not hard-coded to one question and
one rule, because "building prompts for Jev is something we need to learn
and iterate on"; paths, not names. Earlier drafts had a `watch` card and
then a `judge` precheck field; both are replaced by commands.

**Direction.**

- **`notify:` on scheduled scripts.** `src/schemas/scheduled-script.tsx`:
  `runs` becomes optional and `notify: { title, body?, loudness?, target?,
  context? }` is added; exactly one of the two, enforced by a refinement
  whose message says so. `requested-by: "boxholder"` is added as an optional
  marker that Track E's promotion rule reads. `bbx tick` runs a `notify:`
  card by calling `notifyBoxholder` in process, with `target` defaulting to
  `chat:new` and `source` the card path; the `once` deletion and state
  recording are unchanged. Pure data: no shell quoting of a title. The
  schema instructions carry this worked example:

  ```yaml
  # _config/schedules/remind-pepper-vet.scheduled-script.card
  at: 2026-10-02T08:30
  once: true
  requested-by: boxholder
  description: Reminder asked for in chat on 2026-09-26
  notify:
    title: Call the vet about Pepper's shots
    loudness: loud
    target: chat:new
    context: pets/pepper-shots.todo.card
  ```

  Firing is the scheduler tick; no agent runs. Tapping opens a new chat
  with the reminder and its context as the banner. `bbx remind` is not
  added.
- **Schedule memory.** Schedule state (`src/core/schedule/state.ts:45`)
  gains `lastCommit: string | null` (the box HEAD from `getHead`,
  `src/lib/git.ts:557`, recorded at the end of every run that was not
  deferred for budget) and `carry: string | null` (at most 4 KB; the last
  value the script wrote, replaced each run, never appended). `lastRun`
  exists. The tick exposes them to the script's environment
  (`src/cli/commands/tick-helpers.ts:275`, beside the existing env) as
  `BBX_SINCE_COMMIT`, `BBX_SINCE_TIME`, `BBX_CARRY_IN`, and a writable file
  path `BBX_CARRY_OUT`, plus `BBX_DEFER_FILE` (below); after the run the
  tick reads the carry file into `carry`. The five names are added to the
  script env allowlist (`src/core/script-env-allowlist.ts:59`), which is
  the only way they reach a procedure's shells
  (`src/core/procedure/shell.ts:51` rebuilds the env through it). Before a
  schedule's first run the tick sets `lastCommit` to the current HEAD and
  saves state, so `BBX_SINCE_COMMIT` is never empty inside a schedule and
  the first run sees no changes: a schedule is about the future.
- **`bbx changes`.** New command; the env variables are its defaults, not
  its contract: `bbx changes [--since <commit>] [--match <glob>]... [--kind
  added|modified|any] [--log] [--or-skip]` prints one box-relative card
  path per line changed under the matching globs between `--since`
  (default `$BBX_SINCE_COMMIT`) and HEAD, from a commit-range tree diff
  (a new `getRangeDiff(boxRoot, { from, to, filter })` in `src/lib/git.ts`;
  the existing `getDiff` at `:455` covers only the working tree), so a
  card triage moved during the window appears once at its final path
  (`src/core/triage/routing.ts:74`). `--cat` prints each listed card in
  full after a `=== <path>` header line instead of the bare path, so a
  judge and an agent downstream keep the path with the text; `--cat --all`
  prints every card matching the globs, not only the changed ones, for a
  snapshot judge that still wants to skip when nothing moved. `--log`
  prints the commit subjects in the window instead. `--or-skip` writes
  `{ reason: "no-change" }` to `$BBX_DEFER_FILE` when set and exits
  `CHECK_SKIP_CODE` (75, `src/core/procedure/shell.ts:12`) on an empty
  result. With no `--since` and no env (ad hoc use outside a schedule) it
  exits 2 with "no since: pass --since or run from a schedule", never a
  guess. Flags only; no JSON argument, the surface is small.
- **The judgment card.** `src/schemas/judgment.ts`: `cardSchema("judgment",
  { fields: { questions: record(name, { type: enum(noul, choice, score),
  criteria }), situation?: ref, model? }, body })`, where `criteria` takes
  the wire shape for its type: `{ true, false }` for `noul`, a map of option
  to description for `choice`, an ordered list of level descriptions for
  `score` (the Decisions API reference under *Prior art*); filename
  `<name>.judgment.card`, anywhere in the box, by convention
  `_config/judgments/`. The body is the instructions Jev receives, after
  the `situation:` text (an optional ref; default the root briefing's
  purpose statement) so every judgment knows whose box this is. The
  state is never in the card: it arrives on stdin at run time. One
  refinement per type says which `criteria` shape it needs. The card is the prompt, so it is what the agent edits, versions,
  and tests when a judgment is wrong.
- **`bbx judge`.** `bbx judge <card-path> [--per-line [--cards]] [--min
  name=p]... [--choice name=option]... [--decide <json>] [--select]
  [--or-skip] [--dry-run] [--replay <file>]`. Reads the state from stdin;
  with `--per-line` each line is one state (with `--cards`, each line is a
  card path and the card text is the state); sends the card's questions
  in one Jev call per state (`jev.judge`, the Noul, Choice, and Score
  forms added to `src/services/jev.ts` beside `decide`); prints one JSON
  line per state: `{ input, answers: { name: { probability | choice |
  score, confidence } } }`. The decision is separate and basic: `--min`
  and `--choice` are the common cases, `--decide` takes a JSON object of
  the same conditions for anything with several, and `jq` is the escape
  hatch. `--select` prints only the inputs that passed, one per line, so
  the next command in the pipe gets paths. `--or-skip` exits 75 when
  nothing passed. `--dry-run` prints the exact request without sending.
  `--replay <file>` runs the card against a saved state file, for tuning a
  prompt against a kept example. `--echo` passes stdin through to stdout
  on a pass, for a `pass-output` precheck that feeds an agent. Without
  `--per-line` the whole of stdin is one state; `--cards` reads each card
  in full, with a per-card body cap of 4,000 characters (the trial's 400
  was too short to judge on) and a `--max-batch` (default 20 items) above
  which the command refuses a batch and says to use `--per-line`, because
  a batch is only right when the whole says something the items do not,
  and a batch of 69 with 39 duplicates diluted a clear positive to 55%. The model
  id is `typesafe/jev-1.13` as in `src/services/jev.ts:92`; `jev-latest`
  is not served by OpenRouter (trial, 2026-09-26). Every question carries
  `instructions`; the API rejects one without. Every call and its answers go to
  `.beebox/jev-debug.log` (state truncated), the learning record.
- **Deferred at the tick, with evidence.** Exit 75 alone is not enough:
  any command may exit 75 (`EX_TEMPFAIL`), and the scheduler's existing
  `deferred` needs evidence, not a code (`src/core/schedule/engine-wait.ts`
  requires engine-unavailability evidence). The tick gives each run a fresh
  `BBX_DEFER_FILE` path; `bbx changes --or-skip` and `bbx judge --or-skip`
  write `{ reason }` to it (`no-change`, `no-pass`, `budget`,
  `jev-unavailable`, `unconfigured`) before exiting 75. The tick records
  `deferred` with that reason in state (`lastDeferReason`) only when the
  file exists; exit 75 without it is a `failure`. `bbx health` shows
  `waiting: <reason>`. `once` deletes the card only after a run recorded
  `success` (`tick-helpers.ts:184` reads the recorded result). A procedure
  precheck that skips exits its `bbx procedure run` with 75 and the marker
  its inner command wrote, so the same rule covers both shapes. `cron` or
  `on-wakeup`, plus `once`, plus a pipeline that defers, is "run until it
  fires, then stop".
- **When `lastCommit` advances.** Settled, not an open question: `success`
  advances; `failure` advances (a failing run is on the health page, and
  re-judging the same items on every retry multiplies Jev calls for a bug
  the person has to fix); `deferred` with `no-change` or `no-pass`
  advances (the items were seen); `deferred` with `budget`,
  `jev-unavailable`, or `unconfigured` keeps the cursor, so the items are
  judged next time. The tick reads the reason from the marker file.
- **Jev budget.** A per-box daily cap of Jev calls (default 500) in
  `.beebox/jev-budget.json`, enforced in `bbx judge`: over the cap it
  writes `budget` to the defer file and exits 75; the cursor rule above
  keeps the items for next time. A health check says how many runs
  deferred for budget.
- **Schedule versus procedure.** A schedule card holds when, `once`,
  `until`, `requires`, `requested-by`, the memory, and `runs:`. When the
  notification text is fixed, `runs:` is a one-line pipeline. In the common
  case the judge gets everything and gives one answer ("is there something
  here worth telling?"), and turning that into a relevant notification
  needs an agent: then `runs:` is `bbx procedure run <name>`, the
  procedure's precheck is the `changes | judge` pipeline with
  `pass-output: true` (`src/schemas/procedure.ts:39`), and its run phase is
  an `agents:` step whose prompt receives that output and ends with `bbx
  notify`. Nothing about Jev lives in the procedure schema; a `shells` step
  runs `bbx judge` like any command. The judge precheck field from the
  earlier draft is gone.
- **Worked examples**, in the scheduled-script and judgment schema
  instructions and the agent guide:

  The common shape: one judgment over everything new, then an agent
  writes the notification. A schedule card, a procedure card, a judgment
  card:

  ```yaml
  # _config/schedules/watch-field-trip.scheduled-script.card
  on-wakeup: true
  not-before: 20m
  once: true
  until: 2026-11-01
  requested-by: boxholder
  requires: { connectors: [gmail] }
  description: Tell me when the school emails about the field trip
  runs: bbx procedure run watch-field-trip
  ```
  ```yaml
  # _config/procedures/watch-field-trip.procedure.card
  name: watch-field-trip
  steps:
    - id: look
      precheck:
        pass-output: true
        shells:
          - |
            bbx changes --match '_content/inbox/**/*.email.card' --cat --or-skip \
              | bbx judge _config/judgments/field-trip.judgment.card --min trip=0.8 --or-skip --echo
      run:
        agents:
          - model: efficient
            prompt: |
              The emails below arrived since the last check, each after a
              `=== <path>` line, and a judge says at least one is the
              school writing about the spring field trip. Find it, and tell
              the boxholder what matters (dates, form, payment, deadline)
              in one or two sentences with
              `bbx notify --loudness loud --target card:<that path> --body-file -`.
              If none of them is really about the trip, do nothing.
  ```
  ```yaml
  # _config/judgments/field-trip.judgment.card
  questions:
    trip:
      type: noul
      criteria:
        true: "At least one of these emails is from the school about the spring field trip: dates, permission form, or payment."
        false: "None is; a newsletter that mentions the school, or a receipt, does not count."
  ---
  You are looking at the email cards that arrived in a family inbox since
  the last check, concatenated. Judge only what the emails say.
  ```

  `bbx judge --echo` passes its stdin through on success so the agent gets
  the same material the judge saw. The agent runs only when the judge said
  yes; a quiet inbox costs nothing and a busy one costs one Jev call. The
  per-line form (`--per-line --cards --select`) is for the rarer case where
  each item is judged alone and the text is fixed.

  The fixed-text shape: one schedule card, no agent, for when the
  notification needs no wording beyond what the card says:

  ```yaml
  # _config/schedules/watch-contractor-quote.scheduled-script.card
  cron: "0 */2 * * *"
  once: true
  until: 2026-10-31
  requested-by: boxholder
  requires: { connectors: [google-drive] }
  runs: >
    bbx changes --match 'drive/Quotes/**' --kind any --cat --all --or-skip
    | bbx judge _config/judgments/contractor-quote.judgment.card --min quote=0.8 --or-skip
    && bbx notify --loudness loud --target card:drive/Quotes "The contractor's quote is in"
  ```

  `bbx notify --targets-from-stdin` takes one target path per line and
  sends one notification per line, for the per-line form. The carry slot
  is for "what I already told them": an agent step can read
  `$BBX_CARRY_IN`, and write to `$BBX_CARRY_OUT`, to avoid repeating a
  notification across runs when `once` is not set.

**Vocabulary lock-ins.** `notify:` and `requested-by` on scheduled scripts;
`lastCommit`, `carry`, and `lastDeferReason` in schedule state;
`BBX_SINCE_COMMIT`, `BBX_SINCE_TIME`, `BBX_CARRY_IN`, `BBX_CARRY_OUT`,
`BBX_DEFER_FILE`; the defer reasons; `bbx changes` and `bbx judge` and
their flags; the `judgment` card and its `questions` shape; exit 75 plus
the marker as deferred at the tick.

**First implementation chunk.** `jev.judge` for the three question types
with a doctest against the fake; the `notify:` field and its tick path with
a doctest (an `at` card fires a notification and deletes itself; a `notify`
plus `runs` card fails validation with the message). Second chunk: the
memory fields, the env variables, the carry file, and `bbx changes` with a
filesystem doctest over a temporary repo (three commits add three cards,
one moved by a rename; `--match` selects; `--cat` headers each card;
`--or-skip` writes the marker and exits 75 on empty; no since outside a
schedule exits 2; the first run sees nothing because `lastCommit` was
initialized; a carry written is read back next run; a procedure's shells
see the variables). Third chunk: the `judgment` schema and `bbx judge` with a
doctest (per-line cards, `--min`, `--select`, `--decide`, `--dry-run`
output, `--replay`, budget exit with the marker); then the tick's deferred
rule with a doctest (a pipeline that defers with a marker records
`deferred` with its reason and survives `once`; exit 75 with no marker
records `failure`; the cursor advances or holds per reason; one that
passes records `success` and is deleted).

### Track E. Sources: callouts, question sweep, health demotion and promotion

**What.** Change what each existing source sends, and add the chat callout as
a source.

**Why this needs to change.** Every current caller passes `severity: "alert"`
(`src/core/schedule/health-alert.ts:84` and the others under *What already
exists*). The boxholder's ruling: health stays in the app unless it blocks
something asked for; questions are a dot unless time-bound; agent outcomes
reach the person only when the agent marks them.

**Direction.**

- Callouts: `<callout loudness="quiet">` attribute, default none. At turn
  end, where `<schedule>` tags are parsed today
  (`src/webapp/routes/chat.ts:125-138`), the server parses callouts with a
  sibling `parseCalloutTags`. One intent per turn: body is the first
  callout, loudness the highest any callout asked for, else `dot`, target
  `chat:<sessionId>`, tag the session id so a later turn replaces rather
  than stacks. Presence nonzero sends nothing: the callout is on screen. This is the "voice" for
  `issues/features/2026-08-09-agent-outcomes-need-a-voice.md` and
  `2026-08-22-file-asks-agent-flagged-attention.md`.
- Question sweep (`src/core/question-alert.ts:104`): `loudness: "dot"`. The
  question card gains `urgency?: "time-bound"`, set by the agent when the
  question blocks something with a date; the sweep sends `quiet` for those.
  Nudge (`src/core/question-aging.ts:214`): `quiet`.
- Health alerts: `health-alert.ts`, `connector-activity-alert.ts`,
  `google-auth-alert.ts`, `engine-unavailability-apply.ts` stop calling
  `notifyBoxholder`. Each becomes a health entry in the snapshot the
  dashboard already renders (`HealthWarnings.tsx:40`), with the same
  once-per-episode latch. No badge, no push.
- Promotion: the tick's skip path (`src/cli/commands/tick.ts:119-125`)
  records nothing today. It gains a saved `skipped: { reason, since }` in
  schedule state, set when `evaluateSkip` returns a reason (missing
  connectors, `tick-helpers.ts:142-144`; engine quota, `engine-wait.ts`)
  and cleared on any run. For a card with `requested-by: boxholder`, the
  first tick that sets `skipped` for a new `since` sends `loud` ("Your
  reminder could not run: Google needs reconnecting", target `dashboard`)
  and stamps `alertedFor: "skipped:<reason>"` beside the existing latch
  values (`state.ts:52-55`); later ticks with the same `since` send
  nothing; a run clears both. Two more triggers for the same
  rule: a `requested-by` schedule whose `requires` connector is in a failing
  episode (`connector-activity-alert.ts:40`) even though the script itself
  could run, and a judge that cannot run because the Jev key is missing.
- Capture failure: the capture pipeline's terminal failure (the
  `capture-status` event, `src/core/event-bus-schemas.ts:206`) sends
  `quiet` with target `chat:<sessionId>` when presence is zero. Success
  sends nothing.

**Vocabulary lock-ins.** `urgency: time-bound` on questions; the
`loudness` attribute on callouts.

**First implementation chunk.** The loudness changes to the six existing
callers and the question `urgency` field, with the existing doctests updated
to assert loudness. Callouts and the promotion rule are the second chunk.

### Track F. Guidance: briefing section, agent guide, chat prompt, audits

**What.** The policy, written where agents read.

**Why this needs to change.** The pieces are useless without the judgment,
and the boxholder ruled the judgment lives in briefings.

**Direction.**

- `createBriefingTemplate` (`src/schemas/briefing.tsx:241`) installs a
  "Reaching me" section in the root briefing with the default text from the
  design notes. `bbx init` installs the briefing only when it is missing
  (`src/core/box/defaults.ts:229-234`), so existing boxes do not get the
  section from the template. For them, the agent guide carries the default
  text and says: when the root briefing has no "Reaching me" section, apply
  the default and propose adding the section at the next retro.
- Agent guide: a "Reaching the boxholder" section in
  `src/core/agent-guide/commands.ts`: `bbx notify`, loudness, targets, the
  reminder card, schedule memory and `bbx changes`, the judgment card and
  `bbx judge`, "check what changed before you judge, and judge before you
  run an agent", "the briefing owns
  when", and "run `bbx notify --check` before promising a reminder or a
  change-triggered check; if nothing can reach the person, say so instead
  of promising". Chat prompt (`src/core/chat/session/prompts.ts:163`): `<schedule>`
  is for coming back to this conversation within hours; a schedule card
  with `notify:` is for anything that must reach the person later or
  elsewhere; `<callout loudness>` is how to make an outcome reach them when
  they have left.
- Schema instructions on scheduled-script (`notify:`, the pipelines) and
  on the `judgment` card carry the worked examples from Track D, plus a
  "writing a judgment" section drawn from a trial against two real boxes
  (2026-09-26, findings in the workstream's scratch): one question per
  thing decided; `instructions` say what the state is and name what does
  NOT count (with loose criteria a quarterly statement scored 54% as a
  renewal notice, with explicit negatives 12%); the state must carry the
  body, since a subject and snippet alone put every answer near 50%, which
  reads as uncertainty and not as no; code computes numbers and dates
  before the call (raw due dates 79% and the wrong bill, precomputed days
  93% and the right one); a batch yes/no finds a salient condition (90%+)
  and a negative control sits near 10%, but a subtle condition among many
  items muddles toward 50%, so ask a crisp gate question and let the agent
  read; a Choice over the items is a pointer for the agent, not a
  decision; Score is fooled by dates in marketing and needs negatives too.
  Batch only when the whole says something the items do not ("is anything
  here worth an agent's look"); judge per item when each item is its own
  question, and never batch more than `--max-batch`. Prefer a Choice with a
  counter-category and a "cannot tell" option over a bare yes/no: per item, {expects a reply, needs none, cannot tell} was
  right on every email in the trial at 90%+ confidence where the yes/no
  batch had given 55%, and "cannot tell" surfaced the thin-state case that
  a yes/no hides as 50%. Give Jev the situation: a judgment card carries an
  optional `situation:` ref, defaulting to the root briefing's purpose
  statement (`src/schemas/briefing.tsx`, the `{% purpose %}` block), which
  `bbx judge` prepends to the instructions; in the trial the situation let
  Jev apply "the recipient's own messages are not requests of him", which
  it could not without knowing who the recipient was. Include identity
  fields (`to:`, `from:`) in email state. `bbx judge` warns when a state is
  under a few hundred characters.
- `docs/notifications.md` reference doc: the vocabulary, the pieces, the
  channel table, what is in git and what is transient, the ops steps, the
  verification walk.

**Vocabulary lock-ins.** The section title "Reaching me".

**First implementation chunk.** The briefing section and the agent guide
section, with the knowledge audits below written and run.

## Could this be simpler?

The simplest version that works: keep the July card path, add an `apns` card
and `bbx notify`, and skip the cursor and judges. Reminders work through
`runs: bbx notify ...` on a schedule card.

What the fuller plan buys:

- **A log instead of cards** (Track A): several deliveries a day committed
  and deleted per channel is git history with no reader (boxholder
  decision). An append-only JSONL file and one bus event replace the card
  schema, its connector, and the test command. One attempt at emit time
  replaces the queue: the July plan's replay was for durability the
  boxholder has now said deliveries do not need.
- **`notify:` instead of `runs: bbx notify`** (Track D): the shell form
  needs the agent to quote a title correctly inside YAML inside a shell
  string; a fabricated-value failure. The field is data.
- **`bbx judge` and the judgment card** (Track D): without them a
  scheduled check runs an agent every time, which is the cost that keeps
  small proactive tasks from existing. A command plus a prompt card, rather
  than a schema field with one question type and one rule, is what lets
  prompts be iterated and replayed. The defer outcome already exists; the
  change is to record it from exit 75 and to make `once` respect it.
- **The change cursor and `bbx changes`** (Track D): without them a
  scheduled check either calls Jev every run over a growing pile or keeps
  its own cursor in shell, which is the same thing written badly in every
  procedure. One field in schedule state and one command make "nothing
  happened, do nothing" the default cost. This replaced a separate `watch`
  card type: same behavior, no new card.

Dropped because the simple version does not fail without them: unread
state, target-level presence, quiet hours in the dispatcher, a notification
center page beyond the Admin recent list, rich actions on notifications,
`bbx remind`.

## Subplans

none. The one research question (Jev Noul wire shape and cost) is answered
under *Prior art*. The iOS work is a track, not a subplan, because its shape
is fixed by Apple's API and the contract rule.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Intent with no channel to try (no audience, no presence) | Track A doctest | today: silent return (`src/core/notify-boxholder.ts:107-109`); plan: health entry naming the title | Clear |
| One channel fails, another sends | Track A doctest | per-channel log lines; the failure is a health check for 24 hours | Clear |
| Process dies between send and log append | none: window is one write | the person got the notification; the log lacks the line; Admin shows the intent without a delivery | Silent, accepted: no user-visible harm |
| Log unwritable | Track A doctest | `notifyBoxholder` still sends and logs an error; the append-probe health check reports it without reading the log | Clear |
| Rotation races an appender | Track A doctest | rename is atomic; a line written through the old descriptor lands in the rotated file, which readers also read | Clear |
| Bus DB unreadable | existing bus `unknown` sentinel (`src/core/event-bus.ts:24-31`) | the live event is skipped; delivery unaffected | Clear |
| Agent promises a reminder with no channel | Track F audit; `--check` route doctest | `bbx notify --check` exits 1; the guide says check first | Clear |
| Card target moved by triage after the send | none | tap lands on the missing-card page | Silent, accepted for v1: no stable card id exists |
| Presence heartbeat counts an idle open tab | Track A doctest of the heartbeat rule | heartbeat only while interacted within two minutes | Clear |
| Present session skips `quiet`; person walked away within the 90 s window | Track A doctest of the rule | bounded to the heartbeat staleness | Silent by nature, bounded: accepted |
| Presence file written by server, read by scheduler mid-write | Track A doctest | atomic rename; unreadable counts as absent | Clear (falls to push) |
| APNs 410 or BadDeviceToken | Track B doctest | prune `apns` from device, log label | Clear |
| APNs keys unset on server | Track B doctest | `skipped: unconfigured`, Admin section says so | Clear |
| Sandbox token sent to production host | Track B doctest of environment routing | device reports environment; mismatch prunes; re-register on next launch restores | Clear |
| Device token changes after reinstall | Track C unit test | re-post every launch; old token pruned on 410 | Clear |
| Permission denied on the phone | Track C manual | shell shows the denied state with a Settings link | Clear |
| Schedule card with both `notify` and `runs`, or neither | Track D schema doctest | refinement message names the rule | Clear |
| Reminder fires while the scheduler is down | existing catch-up (`docs/scheduler.md` sleep recovery) | fires on next tick | Clear |
| A command exits 75 for its own reasons (`EX_TEMPFAIL`) | Track D doctest | no marker file, so recorded `failure`, not `deferred` | Clear |
| A skipped `dot` while the person is on another tab | none needed | `dot` is never suppressed by presence | Clear |
| Schedule state lost (`.beebox/` wiped) | Track D doctest | `lastCommit` null; the next run sees nothing and sets it; cards added meanwhile are never judged; health check `schedule cursors reset` | Clear |
| Two ticks run the same schedule | existing schedule lock (`tick-helpers.ts:250`) | serialized | Clear |
| `bbx judge` over the daily budget | Track D doctest | marker `budget`, exit 75; cursor held; health check | Clear |
| Jev unreachable or invalid response | existing `JevError` (`src/services/jev.ts:19`); Track D doctest | marker `jev-unavailable`, exit 75; `deferred`, cursor held; health check after two consecutive | Clear |
| Jev key missing | Track D doctest | marker `unconfigured`, exit 75; health check; a `requested-by` card promotes (Track E) | Clear |
| `bbx changes` with a bad `--since` (commit gone after a history rewrite) | Track D doctest | error, precheck fails, run recorded `failure` with the message | Clear |
| `bbx notify` fails after the judge passed | Track D doctest | pipeline exits 1; `failure` recorded; cursor advanced; the item is not re-judged; the failure is on the health page | Clear |
| Judgment card invalid (a `noul` with `options`) | schema doctest | `bbx judge` exits 2 with the refinement message; run recorded `failure` | Clear |
| Carry over 4 KB | Track D doctest | truncated with a warning line in the tick log | Clear |
| Pipeline exits 75 forever (nothing ever matches) | Track D doctest | `deferred` each run; `until` ends it; health shows `waiting` | Clear |
| Same card judged by two schedules | Track D doctest | each fires; `tag` is the schedule name so the phone collapses only within one | Clear |
| Callout turn completes, presence flips during delivery | Track E doctest | notification still sent; seen twice at worst | Clear |
| Promotion rule fires for a system-scheduled script | Track E doctest | only `requested-by: boxholder` promotes | Clear |
| Promotion repeats every tick | Track E doctest | `alertedFor: skipped:<reason>` latched on the episode's `since` | Clear |
| `chat:new` opened after the log trimmed the intent | Track A route doctest | chat opens without the banner and logs the id | Clear |

No critical gap. The presence window is the one accepted silent behavior,
bounded to the heartbeat staleness.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field.** ADDRESSED: `loudness` is one enum; a wrong
  value fails schema validation with the three allowed values in the message.
  `<schedule>` versus a schedule card is the real confusion; Track F's prompt
  text draws the line by horizon and destination, and the knowledge audit
  tests it.
- **Stale ref.** ADDRESSED: a `card:` target that no longer exists renders to
  the browse URL, which shows the normal missing-card page. A `chat:` target
  whose session was deleted opens the chat page with the existing
  deleted-session state (`docs/plans/chat-session-delete.md`).
- **Two agents touching the same card.** ADDRESSED: no card is written per
  delivery; the log is append-only from three processes (server, scheduler,
  `bbx`), one line per write, and JSONL appends of under 4 KB are atomic on
  the filesystems in use; the change cursor is written by the tick under
  the existing per-schedule lock (Track D). A schedule or procedure card
  edited by an agent while a run is in progress is read once per run.
- **Hand-edit drift.** ADDRESSED: schedule, procedure, and judgment cards
  are schema-validated on load; a `noul` with a map `criteria`, a `choice`
  with fewer than two options, and a schedule with both `notify` and `runs`
  fail with a message naming the rule.
- **Fabricated free-form value.** ADDRESSED for criteria: a judge question is
  free text by design and is tested by Jev, not trusted. Target paths for
  `--targets-from-stdin` come from `bbx judge --select`, not from the agent.
  A reminder title is a YAML string, not a shell argument. For notification bodies from agents: the briefing asks
  for a body that stands alone, the same rule callouts have today.
- **Validation error UX.** ADDRESSED: `bbx notify` and `bbx judge` print the
  schema message and exit 2; `bbx judge` prints its answers as JSON and says
  on stderr why it skipped; `bbx health` shows `waiting` with the last
  stderr line.
- **Partial migration / transition state.** ADDRESSED: no `web-push` card
  exists on disk; the boxholder has no active pairings or subscriptions; the
  device record field is optional. A box with no paired phone and no keys
  behaves as today minus the never-delivered web push card. During Track A
  before Track B, `apns` is not in the channel list.

## NOT in scope

- **Unread state on chat replies and target-level presence.** Boxholder
  ruling 2026-09-26: not important now; filed as a follow-up issue when the
  plan lands. The `dot` is a badge, not a count.
- **Quiet hours in the dispatcher.** Boxholder ruling: device Do Not Disturb.
- **Migration of existing pairings or subscriptions.** None exist
  (boxholder, 2026-09-26).
- **`bbx remind`.** The reminder is a card the agent writes.
- **A notification history beyond the Admin recent list.** The log keeps
  30 days; a page over it is a later ask.
- **Web push on iOS via Home-Screen install.** The native app replaces it;
  the coaching text in `NotificationsSection.tsx` is removed when Track C
  ships.
- **Telegram as a designed channel.** Kept working; only
  `disable_notification` for `quiet`.
- **Rich notifications**: actions, images, reply from the notification.
  Deferred until the plain path is verified on a device.
- **A `watch` card type and a `judge` precheck field.** Both considered and
  replaced by `bbx changes` and `bbx judge` in a schedule's `runs:`
  pipeline; the schema instructions carry the pipelines as examples.
- **A JSON argument for `bbx changes`.** Its surface is a few flags; `bbx
  judge` has `--decide` because a decision can have several conditions.
- **Field-level matching in `bbx changes`.** `--match` is a path glob; a
  filter on frontmatter is a shell pipe after it, until a second caller
  wants more.
- **Jev for triage routing and quick capture.** Its own issue
  (`issues/features/2026-09-21-jev-triage-and-quick-capture-routing.md`);
  this plan adds the `judge` method it will also use.
- **Multi-person delivery policy.** Devices belong to the person who paired
  them; every notification goes to every device of the box. Per-person
  targeting waits for a second boxholder.
- **The dev-side schedule alert system.** Separate.
- **Fixing the 25-day chat timer.** Its issue stays open; the schedule card
  is the path for long horizons.

## Open design questions

1. **Where the reminder lands.** `chat:new` seeded with the reminder, or the
   linked todo card. Lean: `chat:new`, because a phone user types one line
   and the chat agent has the todo through `context`.
2. **Presence heartbeat interval.** 30 s write, 90 s stale. Lean as stated;
   tune after the device test.
3. **Default loudness for `bbx notify` and `notify:`.** `quiet` for the
   command, `loud` for a `requested-by: boxholder` schedule. Lean as stated.
4. **Whether `dot` badge should be a count.** Not without unread state; the
   badge is 1 and clears on foreground. Revisit with the unread issue.
5. **The `--decide` JSON shape.** Lean: an object of `{ name: { min?, max?,
   is? } }` combined with AND; anything else is `jq`. Settled in Track D's
   third chunk, not before.

## Knowledge audits

New agent-facing concepts, each with a `knows_directly` entry in
`src/dev/knowledge-audits.yaml`, run with `pnpm knowledge-audit run --box
<absolute test box path> --filter <id>` and the status comment recorded:

- `notify-loudness`: "The person is away. A capture could not be read. How
  do you tell them, and how loud?" Expects `bbx notify` with `quiet` and a
  chat target, and cites the briefing section.
- `remind-vs-schedule`: "The person asks to be reminded next Tuesday to call
  the vet. In chat, what do you do?" Expects a schedule card with `notify:`
  and `requested-by: boxholder`, not `<schedule>` and not a shell `runs`.
- `changes-since`: "The person says: tell me when the school emails about
  the field trip." Expects an `on-wakeup` schedule whose `runs:` is `bbx
  procedure run ...` whose precheck pipes `bbx changes --or-skip` through
  `bbx judge <card> --or-skip --echo` with `pass-output`, and whose run is
  an agent that ends with `bbx notify`; a judgment card; `once`;
  `requires: { connectors: [gmail] }`.
- `judge-gate`: "A daily procedure should only run an agent when today's
  calendar has an event needing preparation. How do you keep it cheap, and
  how does it stop once it has fired?" Expects `bbx changes --or-skip`
  before `bbx judge`, and `once: true`.
- `health-silence`: "Gmail sync has been failing for two days. Do you notify
  the person?" Expects no, unless a requested schedule is blocked.

## What will hold this after it ships

- **Filesystem doctests** reach every decision: `channelsToTry` (pure), the
  dispatcher with the log and the service fakes, the
  APNs payload builder (pure), the `notify:` tick path, `bbx judge` with a
  fake Jev, exit 75 as `deferred` at the tick, the
  `bbx changes` over a real temporary git repo, the promotion rule at the
  skip site. Cost: ordinary; the fakes exist for push, Telegram, and Jev,
  and the plan adds one for APNs in the same shape.
- **Route doctests** for the push-token route and `bbx notify --channel`.
- **Schema doctests** for scheduled-script (`notify` versus `runs`), the
  `judgment` card,
  and the question `urgency` field.
- **The mobile contract fixture** for the new route, checked by the existing
  tripwire.
- **iOS unit tests** for environment selection and target URL construction;
  the rest of the client is verified on a device by the boxholder, recorded
  in the reference doc's verification walk.
- **Knowledge audits** above, run and landed.
- No new test tier. No mock beyond the service fakes, which record calls
  rather than encode behavior.

## Implementation order

1. **Track A** chunk 1: intent, log, target, `channelsToTry`, the
   rewritten dispatcher with the web-push and telegram channels, health
   checks, doctests; the `web-push` card, connector, and `bbx push test`
   deleted. Chunk 2: presence heartbeat and file, `bbx notify` with
   `--check` and `--body-file`, the `notifications` router, the in-app
   banner, the `chat:new` banner, the Admin recent list.
2. **Track B** chunk 1: payload builder, service, device record and
   projection, route, contract update. Chunk 2: the `apns` channel, Admin
   device list, debug log.
3. **Track C**: entitlement, delegate, registrar, presentation, tap handling,
   badge clearing. Simulator-verified; device test with the boxholder.
4. **Track D** chunk 1: `jev.judge`, `notify:` on schedule cards and its tick
   path. Chunk 2: schedule memory, the env variables and allowlist, the
   carry and defer files, `getRangeDiff`, `bbx changes`. Chunk 3: the
   `judgment` card, `bbx judge`, the tick's deferred rule and cursor rule,
   `once` semantics, budget.
5. **Track E** chunk 1: loudness on existing callers, question `urgency`.
   Chunk 2: callouts at turn end, health entries, promotion rule,
   capture failure.
6. **Track F**: briefing section, agent guide, chat prompt, schema
   instructions, reference doc, knowledge audits written and run.
7. **End-to-end**: `BBX_PUSH_FAKE=1` and the APNs fake through every source;
   then desktop web push with real VAPID keys; then the boxholder's device
   walk: pair, register, `bbx notify --loudness loud`, tap, land; a schedule
   card with `at` two minutes out; the field-trip pipeline over a test
   mail; the quote pipeline over a mounted folder; `bbx judge --replay`
   against a saved email to tune the prompt. The ops steps (VAPID keys, APNs key, Apple capability)
   are the boxholder's.

Tracks A and D have no dependency on each other beyond `notifyBoxholder`'s
new signature; they can run in separate sessions once A's chunk 1 has landed
in the worktree. B depends on A's channel shape; C depends on B's route; E
depends on A; F is written last so it describes what shipped.

## Rollout shape

- **Tests first.** Each chunk names its doctest above and is done when it
  passes with typecheck and lint. The Failure-modes column names the doctest
  for each row.
- **Knowledge audits** land with Track F, run against the test box.
- **Migration.** None on disk: no `web-push` card exists; no active pairings
  or subscriptions exist; the device record field is optional; `runs` on
  existing schedule cards stays valid; `lastCommit` and `carry` are new
  optional state fields; `judgment` is a new type. The briefing
  section reaches new boxes through the template; existing boxes get the
  default from the agent guide until the section is written (Track F).
  Adding it to the boxholder's own boxes is a step in the verification walk.
- **Ops, reserved for the boxholder.** VAPID keys on prod; an APNs key
  (`.p8`) from the Apple Developer account, its key id, and the team id in
  `/home/beebox/.env`; the Push Notifications capability on the app target in
  Xcode; a Debug build on the boxholder's phone for the sandbox walk, then a
  Release build for production.
- **Ships as one unit** when the device walk passes and the boxholder says
  so. Track A alone removes the card path every existing alert uses and
  must not land without Track E's loudness changes.
