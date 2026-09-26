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
running, watch a stream) and puts the policy in the briefing. The experience
and rulings behind it are in
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
| A. Vocabulary, bus-based delivery, presence, `bbx notify` | 450 | 250 | 40 |
| B. APNs: server service, device registration, delivery | 400 | 250 | 60 |
| C. APNs: iOS client | 300 Swift | 60 | 20 |
| D. Timed and conditional: `notify:` on schedules, judge precheck with defer, watch cards | 620 | 400 | 80 |
| E. Sources: callouts, question sweep, health demotion and promotion | 250 | 200 | 20 |
| F. Guidance: briefing section, agent guide, chat prompt, audits | 60 | 40 | 120 |
| Total | 2,080 | 1,200 | 340 |

Additions plus deletions, estimated; Track A includes about 250 lines of
deletion (the `web-push` card, its connector, `bbx push test`). Authored
docs are the last column; there is no generated output. **BIG CHANGE:**
about 3,600 changed lines. The size comes from three channels that each
need a delivery path, plus the conditional pieces. What the fuller design
buys over the smallest fix: the phone, which is the surface the boxholder
uses; reminders and watches with no agent at fire time; cheap judgments
before agent runs; and demoted health alerts, without which the channel
trains the person to ignore it. The boxholder approved the direction in
discussion on 2026-09-26; approval of this size is requested with the plan.

## Stated preferences this plan trades against

- **Rules in git, deliveries transient** (boxholder decision, 2026-09-26).
  The July web push plan routed every push through a committed output card
  (`docs/implemented-plans/web-push-notifications.md`, Track C). Several
  notifications a day, each committed on write and deleted on delivery per
  channel, is git history that is all plumbing. This plan keeps in git what
  is a rule or a run (a schedule card, a watch card, a procedure run card,
  the briefing) and puts each intent and delivery in a gitignored
  append-only log, `.beebox/notifications.jsonl`, shown in the app. The
  event bus (`src/core/event-bus.ts`) carries the live signal to an open
  app and nothing more: the server prunes it at 24 hours
  (`src/webapp/server.ts:244`), so it is not a record.
- **Minimize invented concepts** (boxholder preference). Loudness is one word
  with three values. The reminder is a scheduled-script card with a
  `notify:` field, not a command and not a card type. The judge is a field
  on an existing procedure precheck, and its "not yet" is the scheduler's
  existing `deferred` outcome (`src/core/schedule/state.ts:39-45`). The
  watch is the one new card type, because a per-item cursor over a stream
  has no home in an existing card.
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
  (`docs/implemented-plans/web-push-notifications.md`, Track B). A watch has
  an `until`. A delivery is attempted once, at emit time; the outcome is
  logged and a failure becomes a health check. No retry queue.
- **Resilient and never silent** (`docs/engineering-principles.md:49`). An
  intent with no channel at all returns with no trace today
  (`src/core/notify-boxholder.ts:107-109`). This plan logs every intent
  and every delivery outcome and raises a health check when nothing could
  send. Health checks are computed on request by `runHealthChecks`
  (`src/webapp/trpc/routers/health.ts:153`); the new checks read the log,
  the watch state, and the schedule state. There is no entry store.
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
  stays the single entry point, takes a `NotificationIntent`, emits to the
  bus, and hands delivery to the channel workers (Track A).
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
  parsed. A watch cannot read new cards from the bus and reads git instead
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
  **Extend:** add `judge({ state, question })` for the Noul type (Track D).
- **Procedures.** `src/schemas/procedure.ts:54` a step has `precheck`, `run`,
  `validate`; each phase has `shells`, `agents`, `instructions`, `whys`
  (`:30-33`); `precheck` adds `pass-output` (`:36-40`). The runner's
  `runPrecheck` (`src/core/procedure/engine-step.ts:133`) executes the
  shells and treats exit 75 (`CHECK_SKIP_CODE`, `src/core/procedure/shell.ts:12`)
  as skip. The run card records `status: pass | fail | skip`
  (`src/schemas/procedure-run.ts:15-19`). **Extend:** a `judge` field on
  `precheck`, evaluated after the shells (Track D).
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
  promotion rule for watches reads it.
- **Searched and not found:** `bbx remind`, `bbx notify`, any watch card, any
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
- **Judgment.** One Jev Noul question over one state, returning a
  probability. Exists as `JevDecision` for Choice (`src/services/jev.ts:9`);
  Track D adds the Noul form. A judgment is NOT a decision: code compares it
  to a threshold the card set.
- **Deferred.** The scheduler's existing outcome for "not the task's fault,
  try again next time" (`src/core/schedule/state.ts:39-45`). A judge below
  threshold records it, with the probability. NOT a failure and NOT a
  success: `once` does not fire on it.
- **Watch.** A criterion the box tests against new cards: `under` (path
  prefix), `criteria` (natural-language yes/no), `threshold`, `then`
  (`notify` fields or `run` command), `once`, `until`, `enabled`,
  `requires.connectors` (the same field scheduled scripts have). New card
  type `watch` in `_config/watches/` (Track D). In git, as the rule. Its
  cursor lives in `.beebox/watches.json`.
- **Callout.** The existing chat tag for content the person must read
  (`src/core/chat/session/prompts.ts:155`). Gains an optional `loudness`
  attribute (Track E).
- **Health entry.** A failing check in `getHealthSnapshot`
  (`src/webapp/trpc/routers/health.ts:342`). Exists. Demoted alerts are
  health entries; they never notify on their own (Track E).

## Tracks / scope

### Track A. Vocabulary, bus-based delivery, presence, `bbx notify`

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
  `readRecent(boxRoot, { days })`, `getIntent(boxRoot, id)`, trim at
  finalize. Read by a `notifications` tRPC router (`recent`, `get`).
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
  `quiet` and `dot`: every channel with an audience unless `activeWeb > 0`,
  then none (`dot` reaches `apns` only). Presence suppresses everything but
  `loud`; a walkthrough showed an always-sent `dot` badges the phone on
  every reply while the person is at the desktop. Channels not tried get a
  `skipped` delivery with `present` or `no-audience`.
- `src/core/notify-boxholder.ts`: `notifyBoxholder(boxRoot, intent, {
  services?, now? })` appends the intent, emits the bus event, calls each
  chosen channel's `send` once in process, and appends each delivery. No
  queue and no retry: a failure is a `failed` line and a health check.
  Callers are the scheduler daemon (in process, `scheduler.ts:250`), the
  server (callouts), and `bbx` (agents); all three already build services
  the same way the health alert does with `deliver: true` today.
- `src/core/notification/health.ts`: two checks added to `runHealthChecks`
  (`src/webapp/trpc/routers/health.ts:153`): "notifications that could not
  be delivered in the last 24 hours" and "notifications with no channel",
  both read from the log with the titles.
- `src/cli/commands/notify.ts`: `bbx notify <title> [--body <text> |
  --body-file <path> | stdin] --target <t> [--loudness dot|quiet|loud]
  [--tag] [--channel <name>] [--check]`. `--body-file` and stdin exist
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
device token registration on the pairing record, and a worker with pruning.

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
  and sound; `quiet` and `dot` present nothing. The webview already shows the
  bus event toast when it is open (Track A).
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

### Track D. Timed and conditional: `notify:` on schedules, judge precheck with defer, watch cards

**What.** A reminder is a scheduled-script card whose action is a
notification; a procedure precheck can ask Jev a yes/no question and defer
until it says yes; a `watch` card tests a criterion against each new card
under a path.

**Why this needs to change.** A reminder today is a chat timer that runs an
agent, lands only in the chat, and dies past 25 days. A scheduled procedure
that checks a condition runs an agent every time, which is what makes many
small proactive tasks too expensive
(`issues/features/2026-09-21-jev-triage-and-quick-capture-routing.md`). The
boxholder asked for a defer state: "runs regularly until the judge says it
fires."

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
- **`jev.judge`.** `src/services/jev.ts`: `judge({ state, question }):
  Promise<{ probability, model }>` for the Noul type, same request path;
  fake support via `createFakeJev({ noul: (question) => number })`.
- **Judge precheck and defer.** `ProcedurePrecheck` (`src/schemas/procedure.ts:36`)
  gains `judge?: { question: string, threshold: number.default(0.8) }`; the
  state is the precheck's `shells` stdout, the only form in this plan.
  `runPrecheck` (`src/core/procedure/engine-step.ts:133`) calls `jev.judge`
  after `executePhaseShells`; below threshold is a skip, and the run card's
  `RunStepPrecheck` (`src/schemas/procedure-run.ts:15`) gains `judge: {
  probability, threshold, model }` so the run shows why. A procedure whose
  every step skipped by judge exits with a new `DEFERRED_EXIT_CODE`, which
  `bbx tick` records as the existing `deferred` outcome
  (`src/core/schedule/state.ts:45`) with the probability in the log, so
  `bbx health` shows `waiting: judge 0.31`, not `failing`. `once` deletes
  the card only after a run recorded `success` (`tick-helpers.ts:184` reads
  the recorded result, not the exit code). So `cron` plus `once: true` plus
  a judge precheck is "run regularly until it fires, then stop". The engine
  receives `JevService` through the same injection the chat router uses
  (`src/webapp/trpc/routers/quick-chat.ts:68`).
- **Watch card.** `src/schemas/watch.ts`: `cardSchema("watch", { fields: {
  under, criteria, threshold: number.default(0.8), then: { notify?: { title,
  body?, loudness? }, run?: string }, once: boolean.default(true), until?,
  enabled: boolean.default(true), requires?: { connectors }, description? }
  })` in `_config/watches/`. Exactly one of `then.notify` and `then.run`.
  `requires.connectors` names the connector that feeds `under`, so a
  failing grant is reported instead of a watch that waits forever (the
  walkthrough's W2). It is the judge pattern
  specialized to a stream: one judgment per new item instead of one per
  run.
- `src/core/watch/evaluate.ts`: `evaluateWatches(boxRoot, { jev, now })`.
  Cursor file `.beebox/watches.json` `{ [watchName]: { commit, fired:
  string[] } }`. New items are `git diff --name-only --diff-filter=A
  <cursor>..HEAD -- <under>` (`src/lib/git.ts` wraps git). A product cut:
  new cards only; edits and calendar changes are polls or scheduled
  procedures (NOT in scope). With no cursor, the cursor starts at HEAD: a
  watch is about the future. The read-evaluate-write runs under
  `withFileLock` (`src/lib/file-lock.ts:464-482`) on `.beebox/watches.lock`
  with a short wait; the loser catches the lock error and skips the pass,
  because finalize and the wakeup connector loop both reach `syncConnector`
  (`src/cli/commands/finalize.ts:82`, `src/cli/commands/wakeup-connectors.ts:121`).
  For each item, `jev.judge({ state: card text truncated to a fixed byte
  budget, question: criteria })`; at or above threshold fires `then`.
  `notify` fills the target with `card:<item>` and substitutes `$item`;
  `run` executes with `WATCH_ITEM=<path>` through `execWithTimeout`. `once`
  sets `enabled: false` and commits with the item path in the message, so
  the fire is in git. Past `until`, the same with `expired-at`. Called once
  per finalize beside the question sweep (`src/cli/commands/finalize.ts:35`).
  Finalize runs after the reactor's jobs phase
  (`src/core/reactor/engine.ts:2-14`), so triage has already moved the
  cards it will move this cycle (`src/core/triage/routing.ts:74`) and the
  diff sees each card at its post-triage path.
- Budget: a per-box daily cap of Jev evaluations (default 500) in
  `.beebox/watches.json`. Over the cap, evaluation stops, the cursor does
  not advance, and a health entry says `watch backlog: N items waiting`.
  Nothing is dropped.

**Vocabulary lock-ins.** `notify:` and `requested-by` on scheduled scripts;
`judge` as the precheck field and the service method; `DEFERRED_EXIT_CODE`;
`watch` card fields; `$item` and `WATCH_ITEM`.

**First implementation chunk.** `jev.judge` with a doctest against the fake;
the `notify:` field and its tick path with a doctest (an `at` card fires a
notification and deletes itself; a `notify` plus `runs` card fails
validation with the message). Second chunk: the judge precheck, deferred
exit, and `once` semantics with a procedure doctest (a cron card with a
judge at 0.3 records `deferred` twice and survives; at 0.9 it runs, records
`success`, and is deleted). Third chunk: the watch schema and evaluator
with a filesystem doctest (three commits add three cards, fake Jev answers
0.9 for one, the watch fires once, disables itself with a commit, cursor
advances; the cap stops evaluation with a health entry and resumes).

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
- Promotion: at the scheduler's skip sites
  (`src/cli/commands/tick-helpers.ts:142-144` for missing connectors,
  `src/core/schedule/engine-wait.ts` for engine quota), a skipped card with
  `requested-by: boxholder` sends `loud` once per episode: "Your reminder
  could not run: Google needs reconnecting", target `dashboard`. The
  episode latch reuses `schedule-state.ts`. A watch gets the same rule
  twice: when a connector in its `requires` is in a failing episode
  (`connector-activity-alert.ts:40`) and when the Jev key is missing.
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
  reminder card, the watch card, the judge precheck, "the briefing owns
  when", and "run `bbx notify --check` before promising a reminder or a
  watch; if nothing can reach the person, say so instead of promising". Chat prompt (`src/core/chat/session/prompts.ts:163`): `<schedule>`
  is for coming back to this conversation within hours; a schedule card
  with `notify:` is for anything that must reach the person later or
  elsewhere; `<callout loudness>` is how to make an outcome reach them when
  they have left.
- Schema instructions on scheduled-script (`notify:`), `watch`, and the
  `judge` precheck carry two worked examples each, showing both forms.
- `docs/notifications.md` reference doc: the vocabulary, the pieces, the
  channel table, what is in git and what is transient, the ops steps, the
  verification walk.

**Vocabulary lock-ins.** The section title "Reaching me".

**First implementation chunk.** The briefing section and the agent guide
section, with the knowledge audits below written and run.

## Could this be simpler?

The simplest version that works: keep the July card path, add an `apns` card
and `bbx notify`, and skip judges and watches. Reminders work through
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
- **The judge precheck with defer** (Track D): without it a scheduled
  procedure runs an agent every time, which is the cost that keeps small
  proactive tasks from existing. The defer outcome already exists; the
  change is to record it from a judge and to make `once` respect it.
- **The watch card** (Track D): the same judge pattern over a stream. It is
  the only new card type and the last chunk built; if the judge precheck
  proves enough in practice, it can be dropped before it ships.

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
| Log unwritable | Track A doctest | `notifyBoxholder` still sends; logs an error | Clear (console error) |
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
| Judge below threshold forever on a `cron` card | Track D doctest | recorded `deferred` each run; health shows `waiting: judge p`; `until` ends it | Clear |
| Judge exit code taken as failure by an older tick | none needed: same package | `DEFERRED_EXIT_CODE` is added to the tick that reads it in the same change | Clear |
| Watch cursor lost (`.beebox/` wiped) | Track D doctest | cursor resets to HEAD; items between are never evaluated; health entry `watch cursor reset` | Clear |
| Two evaluators race the watch cursor | Track D doctest | `withFileLock`; the loser skips the pass | Clear |
| Watch over the daily cap | Track D doctest | stop, keep cursor, health entry, resume next day | Clear |
| Jev unreachable or invalid response | existing `JevError` (`src/services/jev.ts:19`); Track D doctest | evaluation stops for the pass, cursor kept, health entry after two consecutive passes; a judge precheck records `deferred` | Clear |
| Jev key missing | Track D doctest | watches and judges skip with a health entry; a `requested-by` card promotes (Track E) | Clear |
| Watch `then.run` command fails | Track D doctest | logged, cursor advances past the item, watch stays enabled, health entry | Clear |
| Same card matches two watches | Track D doctest | each fires; `tag` is the watch name so the phone collapses only within a watch | Clear |
| Callout turn completes, presence flips during delivery | Track E doctest | notification still sent; seen twice at worst | Clear |
| Promotion rule fires for a system-scheduled script | Track E doctest | only `requested-by: boxholder` promotes | Clear |
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
  the filesystems in use; the watch cursor file is written only by
  `evaluateWatches` under `withFileLock` (Track D). A watch or schedule card edited by an agent
  while evaluation runs is read once per pass.
- **Hand-edit drift.** ADDRESSED: watch and schedule cards are
  schema-validated on load; `threshold` outside 0..1, a `then` with both or
  neither form, and a schedule with both `notify` and `runs` fail with a
  message naming the rule.
- **Fabricated free-form value.** ADDRESSED for criteria: a watch criterion is
  free text by design and is tested by Jev, not trusted. A `$item` in a
  notify body is substituted by code. A reminder title is a YAML string, not
  a shell argument. For notification bodies from agents: the briefing asks
  for a body that stands alone, the same rule callouts have today.
- **Validation error UX.** ADDRESSED: `bbx notify` prints the schema message
  and exits 1; the procedure judge writes the probability and threshold into
  the run card's step outcome; `bbx health` shows `waiting: judge p`.
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
- **Watch triggers other than new cards under a path.** Card edits, calendar
  changes, and time-of-day conditions are polls or scheduled procedures with
  a judge (the design notes, S3).
- **Judge over anything but the precheck's shell output.** A judge over a
  card ref or a run phase's output waits for a second caller.
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
4. **Whether the watch card ships in this plan.** Lean: yes, as the last
   chunk, dropped if the judge precheck covers the boxholder's first real
   watch.
5. **Whether `dot` badge should be a count.** Not without unread state; the
   badge is 1 and clears on foreground. Revisit with the unread issue.

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
- `watch-setup`: "The person says: tell me when the school emails about the
  field trip." Expects a watch card, or a cron procedure with a judge
  precheck, with a stated reason for the choice.
- `judge-precheck`: "A daily procedure should only run an agent when today's
  calendar has an event needing preparation. How do you keep it cheap, and
  how does it stop once it has fired?" Expects a `judge` precheck over a
  `shells` output and `once: true`.
- `health-silence`: "Gmail sync has been failing for two days. Do you notify
  the person?" Expects no, unless a requested reminder or watch is blocked.

## What will hold this after it ships

- **Filesystem doctests** reach every decision: `channelsToTry` (pure), the
  dispatcher with the log and the service fakes, the
  APNs payload builder (pure), the `notify:` tick path, the judge precheck
  and `deferred` outcome through the procedure engine with a fake Jev, the
  watch evaluator with a real temporary git repo, the promotion rule at the
  skip site. Cost: ordinary; the fakes exist for push, Telegram, and Jev,
  and the plan adds one for APNs in the same shape.
- **Route doctests** for the push-token route and `bbx notify --channel`.
- **Schema doctests** for scheduled-script (`notify` versus `runs`), `watch`,
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
   path. Chunk 2: judge precheck, deferred exit, `once` semantics. Chunk 3:
   the watch schema and evaluator.
5. **Track E** chunk 1: loudness on existing callers, question `urgency`.
   Chunk 2: callouts on `chat-complete`, health entries, promotion rule,
   capture failure.
6. **Track F**: briefing section, agent guide, chat prompt, schema
   instructions, reference doc, knowledge audits written and run.
7. **End-to-end**: `BBX_PUSH_FAKE=1` and the APNs fake through every source;
   then desktop web push with real VAPID keys; then the boxholder's device
   walk: pair, register, `bbx notify --loudness loud`, tap, land; a schedule
   card with `at` two minutes out; a cron procedure with a judge; a watch
   over a test mail. The ops steps (VAPID keys, APNs key, Apple capability)
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
  existing schedule cards stays valid; watch is a new type. The briefing
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
