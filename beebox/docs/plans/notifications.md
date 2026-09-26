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
a small set of pieces (notify now, notify at a time, notify when a condition
becomes true, judge cheaply inside a procedure) and puts the policy in the
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
the `bbx remind` path here is the durable alternative; the bug stays filed),
Google auth expiry
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
| A. Vocabulary, one notification card, presence, `bbx notify` | 550 | 350 | 40 |
| B. APNs: server connector and device registration | 500 | 250 | 60 |
| C. APNs: iOS client | 300 Swift | 60 | 20 |
| D. Timed and conditional: `bbx remind`, watch cards, Jev judge in procedures | 700 | 400 | 80 |
| E. Sources: callouts, question sweep, health demotion and promotion | 250 | 200 | 20 |
| F. Guidance: briefing section, agent guide, chat prompt, audits | 60 | 40 | 120 |
| Total | 2,360 | 1,300 | 340 |

Additions plus deletions, estimated. Authored docs are the last column; there
is no generated output. **BIG CHANGE:** about 3,700 changed lines. The size
comes from three channels that each need a delivery path, plus a new card
type with an evaluator. What the fuller design buys over the smallest fix:
the phone, which is the surface the boxholder uses; reminders and watches
with no agent at fire time; and demoted health alerts, without which the
channel trains the person to ignore it. The boxholder approved the direction
in discussion on 2026-09-26; approval of this size is requested with the plan.

## Stated preferences this plan trades against

- **One way to do each thing** (`docs/engineering-principles.md:95`). The July
  web push plan wrote one output card per channel and deferred a
  channel-agnostic card "only if channel count grows enough to make
  N-cards-per-intent the worse cost"
  (`docs/implemented-plans/web-push-notifications.md`, NOT in scope). This
  plan adds a third channel and a presence gate that applies to the intent,
  not the channel. That condition is met; Track A replaces the two per-channel
  cards with one `notification` card. The boxholder's standing preference is
  to consolidate over blast-radius fear.
- **Minimize invented concepts** (boxholder preference). Loudness is one word
  with three values, replacing web push's `severity: info | alert`
  (`src/schemas/web-push.ts:25-35`). The reminder is a scheduled-script card,
  not a new card type. The watch is a new card type because no existing card
  can hold a criterion and a cursor. The Jev judge is a phase field on an
  existing procedure step, not a new step kind.
- **Arrange context, do not automate judgment** (boxholder preference). Code
  owns delivery, timing, and the yes/no evaluation of a criterion the agent
  wrote. Code never decides that an outcome is notification-worthy; the
  briefing does. The health promotion rule (Track E) is the one place code
  decides, and it is a mechanical fact: a scheduled thing did not run.
- **Nothing retries forever** (boxholder preference). APNs 410 and 400
  BadDeviceToken prune the token at once, matching web push's 404/410 rule
  (`docs/implemented-plans/web-push-notifications.md`, Track B). A watch has
  an `until`.
- **Resilient and never silent** (`docs/engineering-principles.md:49`). A
  notification with no reachable channel is written and stamped `failed`
  today (`src/connectors/output-cards.ts:95-103`). This plan keeps that and
  adds the health page entry so a failed delivery is seen in the app.
- **Scope anchored to the incident** (boxholder preference). Unread state on
  chat replies and quiet hours are deferred by the boxholder's ruling
  (2026-09-26): device Do Not Disturb covers quiet hours; unread is filed for
  later.
- **The most recent shipped precedent** is the web push plan itself
  (`docs/implemented-plans/web-push-notifications.md`): endpoint-keyed
  server-level store, `PushService` real and fake, output card flushed by
  finalize, `push-debug.log` sink. Track B clones this shape for APNs, with
  the device record instead of a separate store.

## What already exists

- **Dispatcher.** `src/core/notify-boxholder.ts:69` `notifyBoxholder(boxRoot,
  input)` with `NotifyInput { title, body, url, severity?, tag?, name?,
  deliver?, ... }` (`:45-60`). Writes a web-push card when a device is
  subscribed and a telegram card when `healthAlerts.telegramChat` is set.
  **Reuse and extend:** it becomes the single writer of the `notification`
  card and gains `loudness` and `target`.
- **Callers, all system code:** `src/core/question-alert.ts:104`
  (`severity: "alert"`), `src/core/question-aging.ts:214` (`severity:
  "info"`), `src/core/schedule/health-alert.ts:84`,
  `src/core/schedule/connector-activity-alert.ts:61`,
  `src/core/schedule/google-auth-alert.ts:86`,
  `src/core/agent/engine-unavailability-apply.ts:38`. **Reuse:** Track E
  changes what loudness each passes.
- **Output-card delivery helper.** `src/connectors/output-cards.ts:57`
  `deliverPendingOutputCards(...)`: `send` returns `null` on success (card
  deleted, `:91-92`) or a message (card stamped `status: failed`, `:95-103`).
  **Reuse:** the `notification` card's connector uses it; the per-channel
  status lives inside the card, see Ontology.
- **Web push sender and store.** `src/core/send-push.ts` `sendPush`,
  `src/core/push-subscriptions.ts` endpoint-keyed store,
  `src/services/push.ts` real and fake, `src/connectors/push.ts:51`
  `sendOutputPushCards`. **Reuse** the sender and store; the connector is
  folded into the notification connector.
- **Web push card and SW.** `src/schemas/web-push.ts:25-35` fields `status,
  title, body, url, severity, tag, error`; `createWebPushTemplate` (`:63`).
  **Rebuild:** replaced by the `notification` card. Zero of these cards exist
  on disk anywhere (the feature never ran and cards delete on delivery,
  `issues/code-quality/2026-07-04-web-push-followup-testing.md`), so this is
  a schema removal with no data migration. The service worker payload
  `{ title, body, url, tag }` stays.
- **Telegram card.** `src/schemas/telegram-message.ts:23-29` fields `status,
  chat-id, text, response, error`. **Keep unchanged:** it is also the outbound
  chat reply path, not only notifications. `notifyBoxholder` stops writing it;
  the notification connector sends Telegram directly through
  `TelegramService` as one channel of the notification card.
- **`bbx push test`.** `src/cli/commands/push.ts:14-26` calls `sendPush`
  directly. **Rebuild** as `bbx notify --channel web-push` so the test goes
  through the card path.
- **Scheduled scripts.** `src/schemas/scheduled-script.tsx` fields `cron, at,
  rrule, until, once, runs, requires, create-after-success`. `bbx tick` runs
  `runs` with `execWithTimeout(parsed.runs, { cwd: boxRoot, env: scriptEnv })`
  (`src/cli/commands/tick-helpers.ts:275-282`), deletes a `once` card after
  success (`:184-201`), and skips a card whose `requires.connectors` are
  missing with a log line only: `Skipping ${scriptName}: missing connectors`
  (`:142-144`). **Reuse:** a reminder is a scheduled script; the skip site is
  where Track E's promotion rule lives.
- **Chat timers.** `<schedule in="20m" ...>` (`src/core/chat/session/prompts.ts:166`)
  arms a `setTimeout` in the server process, persisted in
  `.beebox/chat-schedules.json` (`src/core/chat/schedules.ts:11`), and fires a
  `<schedule-fired>` message into the chat session
  (`src/core/chat/session/pool.ts:287`). It runs an agent at fire time, lands
  only in the chat, and breaks past about 25 days
  (`issues/bugs/2026-08-25-chat-timer-over-25-days-fires-instantly.md`).
  **Keep:** it is the right tool for a same-conversation follow-up within
  hours. Track F tells the chat agent when to use it and when to use
  `bbx remind`.
- **Callouts.** `<callout context="...">` marks "content the user must
  actually read" and its prompt already says the body must stand alone "in a
  digest or notification" (`src/core/chat/session/prompts.ts:155-160`).
  Consumed by `src/frontend/src/components/chat/CalloutBlock.tsx` and
  `ambient/projection.ts`. **Reuse:** a callout is the chat agent's notify
  (Track E).
- **Event bus.** `src/core/event-bus.ts` SQLite with replay; `chat-complete`
  (`src/core/event-bus-schemas.ts:173`) carries `sessionId`. `card-created`
  (`:126`) is emitted only by the UI action routes
  (`src/webapp/trpc/routers/actions.ts:111`, `src/webapp/routes/actions.ts:76`),
  not by connectors or agents. **Consequence:** a watch cannot read new cards
  from the bus; it reads them from git (Track D). `chat-complete` is the hook
  for callout delivery.
- **Live subscribers.** `src/webapp/trpc/routers/events.ts:62` `subscribe` is
  the one long-lived subscription every open web app holds, per box. No
  registry counts them. **Extend:** Track A counts them for presence.
- **Jev.** `src/services/jev.ts:15-17` `JevService.decide({ state, criteria })`
  returns a Choice distribution; real client at `:118` posts to
  `https://openrouter.ai/api/alpha/decisions` (`:128`) with model
  `typesafe/jev-1.13` (`:92`); fake at `:169` `createFakeJev`. Key via the
  `openrouter` secret, purpose listed at `src/core/secrets/uses.ts:78`.
  **Extend:** add `judge({ state, question })` for the Noul type (Track D).
- **Procedures.** `src/schemas/procedure.ts:54` a step has `precheck`, `run`,
  `validate`; each phase has `shells`, `agents`, `instructions`, `whys`
  (`:30-33`); `precheck` adds `pass-output` (`:39`). **Extend:** `precheck`
  gains a `judge` field (Track D).
- **Pairing device record.** `src/core/mobile/pairing.ts:19`
  `MobileDeviceSchema { id, label, tokenHash, createdAt, createdBy,
  lastUsedAt?, revokedAt? }` in the box-level
  `.beebox/mobile-devices.secret.json` (`:5`). Bearer resolution at `:167`.
  **Extend:** the record gains an `apns` field (Track B).
- **iOS app.** `@UIApplicationDelegateAdaptor(BeeBoxAppDelegate.self)`
  (`ios-app/BeeBox/BeeBoxApp.swift:5`); `onOpenURL` (`:39`) feeds the pairing
  inbox; `scenePhase` handling at `ios-app/BeeBox/Views/RootView.swift:147`;
  every request is authenticated by `BoxRequest.apply`
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
  `trpc.health.check` (`src/webapp/trpc/routers/health.ts:342`);
  `HealthWarnings.tsx:40` renders failing checks. `/box/health` as a deep
  link does not exist as a route; callers that pass it land on the dashboard.
  **Reuse:** demoted health alerts appear here; the plan fixes the target to
  the dashboard path.
- **Admin Notifications section.**
  `src/frontend/src/components/admin/NotificationsSection.tsx`, registered as
  `scope: "device"` (`admin-sections.ts:59`). **Reuse:** it lists the phone's
  registration state too (Track B).
- **Box config.** `healthAlerts.telegramChat` (`src/core/box/config.ts:75-79`)
  is read from an unvalidated cast (`:359-362`). **Keep** the field; no new
  config keys are added, so no validation work is pulled in.
- **Searched and not found:** `bbx remind`, `bbx notify`, any watch card, any
  unread concept outside Gmail, any `UIBackgroundModes`, any notification
  mention in the iOS plans.

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

- **Notification.** One intent to reach the person: `title`, `body`,
  `target`, `loudness`, optional `tag` (collapse key), `source` (which code or
  agent wrote it). Identified by its card path in `_bookkeeping/output/`
  (`docs/box-layout.md:177`). It is NOT a channel message; one notification
  fans out to every channel that can reach the person. New card type
  `notification` (Track A), replacing `web-push`
  (`src/schemas/web-push.ts:25`).
- **Loudness.** `dot | quiet | loud`. On the phone: badge only; passive
  banner; active banner with sound. On desktop web push: nothing; muted
  notification; notification. In the app: an event on the bus for all three.
  Telegram: `dot` sends nothing; `quiet` and `loud` send a message, `quiet`
  with `disable_notification`. Replaces `severity`.
- **Target.** Where tapping lands. `chat:<sessionId>`, `chat:new`, `card:<path>`,
  `question:<path>`, `dashboard`. A string with a scheme, parsed by one
  function that also renders the deep-link URL for each channel. It is NOT a
  raw URL. `question:` and `card:` point at cards by path
  (`src/core/question-alert.ts:100` builds the browse URL today).
- **Channel.** A way to deliver: `apns`, `web-push`, `telegram`. Each has a
  service (real and fake), an audience lookup, and a per-notification
  status inside the card. Exists today as separate connectors; Track A folds
  delivery into one connector with a table of channels.
- **Device.** A paired phone: the existing `MobileDevice`
  (`src/core/mobile/pairing.ts:19`), extended with
  `apns: { token, environment: "sandbox" | "production", registeredAt }`.
  A device belongs to a box (the file is box-level) and to the person who
  paired it (`createdBy`).
- **Presence.** Whether a live web session exists for the box: the count of
  open `events.subscribe` subscriptions (`src/webapp/trpc/routers/events.ts:62`).
  A boolean per box, not per target (target-level presence is deferred with
  unread).
- **Reminder.** A scheduled-script card (`src/schemas/scheduled-script.tsx`)
  with `at`, `once: true`, and `runs: bbx notify ...`. NOT a new card type.
  Identified by its filename in `_config/schedules/`.
- **Chat timer.** The existing `<schedule>` tag entry in
  `.beebox/chat-schedules.json` (`src/core/chat/schedules.ts:26`). NOT a
  reminder: it re-enters a chat and runs an agent.
- **Watch.** A criterion the box tests against new cards: `under` (path
  prefix), `criteria` (natural-language yes/no), `threshold`, `then`
  (`notify` fields or `run` command), `once`, `until`, `enabled`. New card
  type `watch` in `_config/watches/` (Track D). Its cursor (last evaluated
  commit) lives in `.beebox/watches.json`, never in the card.
- **Judgment.** One Jev question over one state: `question` (Noul text) and
  the returned probability. Exists as `JevDecision` for Choice
  (`src/services/jev.ts:9`); Track D adds the Noul form. A judgment is NOT a
  decision: code compares it to a threshold the card set.
- **Callout.** The existing chat tag for content the person must read
  (`src/core/chat/session/prompts.ts:155`). Gains an optional `loudness`
  attribute (Track E). A callout in a turn that completes with no presence
  becomes a notification targeting that chat.
- **Health entry.** A failing check in `getHealthSnapshot`
  (`src/webapp/trpc/routers/health.ts:342`). Exists. Demoted alerts are health
  entries plus a `dot`.

## Tracks / scope

### Track A. Vocabulary, one notification card, presence, `bbx notify`

**What.** Replace the per-channel output cards written by `notifyBoxholder`
with one `notification` card, add `loudness` and `target`, deliver through one
connector with a channel table, gate the push channels on presence, and expose
it all as `bbx notify`.

**Why this needs to change.** Two per-channel cards were the July decision
for two channels. A third channel and a presence gate that applies once per
intent make the per-channel shape the worse cost, by the July plan's own
condition. Agents have no command at all today
(`src/core/agent-guide/` has no notify section; searched).

**Direction.**

- `src/schemas/notification.ts`: `cardSchema("notification", { fields: {
  title, body, target, loudness: enum(dot, quiet, loud).default("quiet"),
  tag?, source, status: enum(pending, failed, partial).default("pending"),
  channels: record(channel, { status: enum(sent, skipped, failed), detail?
  }), error? } })`. `partial` means at least one channel sent and one failed;
  the card stays for inspection like `failed`. Delete `src/schemas/web-push.ts`
  and its registry entry.
- `src/core/notification/target.ts`: `parseTarget(s): Target` and
  `targetUrl(target, boxSlug): string` (root-relative, the shape
  `question-alert.ts:100` builds today). `chat:new` renders to the chat page
  with a `seed` query carrying the notification's body, so the first message
  is the reminder context; the frontend reads `seed` once and drops it from
  the URL.
- `src/core/notification/presence.ts`: `livePresence(boxRoot): { web: number }`
  from a module-level counter that `events.subscribe` increments on entry and
  decrements in its `finally` (`src/webapp/trpc/routers/events.ts:62`). The
  scheduler and `bbx` run in other processes, so the count is written to
  `.beebox/presence.json` with a heartbeat timestamp every 30 seconds by the
  server and read by anyone; a stale heartbeat (older than 90 seconds) counts
  as zero.
- `src/core/notify-boxholder.ts`: `notifyBoxholder(boxRoot, { title, body,
  target, loudness, tag?, source, deliver? })` writes one card, emits a
  `notification` bus event (new schema entry: the card's fields plus the
  rendered URL) so an open app shows it at once, commits, and delivers when
  asked. `notifyChannels` returns `{ apns, webPush, telegram }` booleans from
  the device records, the subscription store, and box config.
- `src/connectors/notification.ts`: one connector using
  `deliverPendingOutputCards` with `cardSuffix: ".notification.card"`. Its
  `send` walks a channel table: `apns` (Track B), `web-push` (`sendPush`),
  `telegram` (`TelegramService.sendMessage` to `healthAlerts.telegramChat`).
  Presence rule inside `send`: when `livePresence.web > 0` and loudness is
  not `loud`, push channels are `skipped` with detail `present`; Telegram
  follows the same rule. A channel with no audience is `skipped` with detail
  `no-audience`. The card deletes when every channel is `sent` or `skipped`
  and at least one is `sent` or the bus event was emitted to a present
  session; it is stamped `failed` when no channel sent and none was skipped
  for presence. Replace `src/connectors/push.ts` and the telegram write in
  `notify-boxholder.ts`.
- `src/cli/commands/notify.ts`: `bbx notify <title> [--body] --target <t>
  [--loudness dot|quiet|loud] [--tag] [--later]`. Delivers at once unless
  `--later` (wait for finalize). `--channel <name>` restricts delivery for
  testing and replaces `bbx push test`. Exit 1 with the card path when the
  card is stamped `failed`, so a procedure sees it.
- Service worker: `severity` never reached the payload; no change. The
  `quiet` loudness sets `silent: true` in the payload; `dot` is not sent to
  web push.

**Vocabulary lock-ins.** `loudness` and its three values; `target` scheme
strings; channel names `apns`, `web-push`, `telegram`; card status
`pending | failed | partial`; the bus event name `notification`.

**First implementation chunk.** The schema, `target.ts`, the rewritten
`notifyBoxholder`, the connector with the `web-push` and `telegram` channels,
and a filesystem doctest: a box with a fake subscription and a telegram chat
gets one card; delivery marks both channels `sent` and deletes the card; a
failing push marks `partial` and keeps the card; a present session skips
push and the card deletes with `skipped: present`. Existing callers pass
`loudness: "loud"` and a parsed target in this chunk so nothing regresses;
Track E changes them.

### Track B. APNs: server connector and device registration

**What.** An `apns` channel: a service (real via `@parse/node-apn`, fake),
device token registration on the pairing record, and delivery with pruning.

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
  body }, "interruption-level": "passive", badge: 1 }, target }`; `loud` adds
  `sound: "default"` and level `active`. `apns-collapse-id` is the `tag`.
  `apns-push-type: alert` for all three.
- `src/core/mobile/pairing.ts`: `MobileDeviceSchema` gains
  `apns: z.object({ token, environment: z.enum(["sandbox", "production"]),
  registeredAt }).optional()`. New function `registerDevicePush(boxRoot, {
  deviceId, token, environment })` and `pruneDevicePush(boxRoot, deviceId)`.
- Route: `POST /api/pairing/push-token` body `{ token, environment }`,
  authenticated by the device bearer (`resolveMobileBearerIdentity`,
  `src/core/mobile/pairing.ts:167`), raw Fastify beside the redeem route
  (`src/webapp/routes/pairing.ts:20`), because the caller is native code
  using the same path family. Contract section 5.8 in
  `docs/mobile-contract.md`, fixture under `test/mobile-contract/fixtures/`,
  same commit.
- Channel in the notification connector: audience is every device of the box
  with an `apns` field and no `revokedAt`. `gone` prunes the `apns` field and
  logs the device label, never the token.
- Admin Notifications section lists paired devices with a push token and
  their environment, read from `pairing.devices`
  (`src/webapp/trpc/routers/pairing.ts:50`), so the boxholder can see that
  the phone is registered.
- `.beebox/push-debug.log` gets one line per APNs send with loudness and
  target, no token.

**Vocabulary lock-ins.** `apns` field name and `environment` values on the
device record; the route path; the payload's custom `target` key, which the
iOS client reads.

**First implementation chunk.** `apns-payload.ts` with a doctest over the
three loudnesses, `ApnsService` real and fake, the device record extension,
`registerDevicePush`, and the route with a route doctest (`makeTestServer()`):
a device registers, re-registers with a new token, and is pruned on `gone`.
The channel wiring into the connector is the second chunk.

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
  a new `PushRegistrar` service. `didFailToRegister` logs through the existing
  native log forwarding (`docs/mobile-contract.md:1021`).
- `PushRegistrar` (`ios-app/BeeBox/Services/PushRegistrar.swift`): posts
  `{ token, environment }` to every paired box using `BoxRequest.apply`
  (`ios-app/BeeBox/Services/BoxRequest.swift:21`); `environment` is
  `sandbox` for `DEBUG` builds and `production` otherwise. Re-posts when the
  token changes or a box is paired. Permission is requested once, at first
  successful pairing, with `[.alert, .badge, .sound]`; a denial is shown in
  the paired-box shell as a one-line state with a link to Settings, per
  principle 13 (`docs/engineering-principles.md:151`).
- `willPresent`: read `loudness` from `userInfo`; `loud` presents as banner
  and sound; `quiet` and `dot` present nothing. The webview already shows the
  bus event when it is open (Track A).
- `didReceive`: read `target` from `userInfo`, build the URL with the paired
  box's base URL, and load it through the existing
  `authenticatedRequest(for:page:)` path
  (`ios-app/BeeBox/Views/ChatWebView.swift:1069`), extended with a
  `.path(String)` page case.
- On `scenePhase == .active` (`ios-app/BeeBox/Views/RootView.swift:147`),
  call `setBadgeCount(0)` and `removeAllDeliveredNotifications()` for
  notifications whose loudness was `dot`.

**Vocabulary lock-ins.** `userInfo` keys `loudness` and `target`, identical
to the card fields.

**First implementation chunk.** Entitlement, delegate registration,
`PushRegistrar`, and a unit test of the environment and URL construction in
the existing test target. Verified in the simulator up to the registration
call; the simulator has no APNs token, so the post is exercised with a fake
token behind a `DEBUG` launch argument.

### Track D. Timed and conditional: `bbx remind`, watch cards, Jev judge in procedures

**What.** A one-command reminder that writes a scheduled-script card; a
`watch` card evaluated over new cards with Jev; a `judge` precheck in
procedures so a scheduled procedure can ask a cheap question before running
an agent.

**Why this needs to change.** A reminder today is a chat timer that runs an
agent, lands only in the chat, and dies past 25 days. A watch does not exist.
A scheduled procedure that checks a condition runs an agent every time, which
is what makes many small proactive tasks too expensive
(`issues/features/2026-09-21-jev-triage-and-quick-capture-routing.md`).

**Direction.**

- `bbx remind --at <iso|"in 2h"|"thursday 08:30"> <text> [--target] [--loudness]
  [--context <ref>]`: writes `_config/schedules/remind-<slug>-<date>.scheduled-script.card`
  with `at`, `once: true`, `description`, and `runs: bbx notify "<text>"
  --target chat:new --loudness loud --context <ref>`. Relative times use the
  box time zone (`src/lib/time.ts` `getBoxTime`). `bbx remind list` and
  `bbx remind cancel <name>` are thin over the schedules directory.
- `src/schemas/watch.ts`: `cardSchema("watch", { fields: { under, criteria,
  threshold: number.default(0.8), then: { notify?: { title, body?, loudness },
  run?: string }, once: boolean.default(true), until?, enabled:
  boolean.default(true), description? } })` in `_config/watches/`. Exactly one
  of `then.notify` and `then.run`, enforced by a refinement whose message
  says so.
- `src/core/watch/evaluate.ts`: `evaluateWatches(boxRoot, { jev, now })`.
  Cursor file `.beebox/watches.json` `{ [watchName]: { commit, fired:
  string[] } }`. New items are `git diff --name-only --diff-filter=A
  <cursor>..HEAD -- <under>` (`src/lib/git.ts` already wraps git). With no
  cursor, the cursor starts at HEAD and evaluates nothing: a watch is about
  the future. For each item, `jev.judge({ state: card text truncated to a
  fixed byte budget, question: criteria })`; probability at or above
  `threshold` fires `then`. `notify` fills the target with `card:<item>` and
  substitutes `$item` in title and body; `run` executes the command with
  `WATCH_ITEM=<path>` in env through `execWithTimeout`. `once` disables the
  card after the first fire (sets `enabled: false` and commits, so the agent
  sees why). Past `until`, the card is disabled the same way with
  `expired-at`. Called from `bbx finalize` beside the question sweep
  (`src/cli/commands/finalize.ts:35`) and after `syncConnector`
  (`src/connectors/activity.ts:188`) in the wakeup path, so mail is tested
  the pass it arrives.
- Budget: a per-box daily cap of Jev evaluations in `.beebox/watches.json`
  (default 500). Over the cap, evaluation stops, the cursor does not advance,
  and a health entry says `watch backlog: N items waiting`; the next day
  resumes. Nothing is dropped.
- `src/services/jev.ts`: `judge({ state, question }): Promise<{ probability,
  model }>` for the Noul type, same request path, fake support via
  `createFakeJev({ noul: (question) => number })`.
- Procedures: `ProcedurePrecheck` gains `judge?: { question: string,
  threshold: number.default(0.8), state?: "output" }` where the state is the
  precheck's `shells` output (the only form in this plan). A judge below
  threshold ends the step as `skipped` with the probability in the run card,
  which is the existing precheck-fails path. So a scheduled procedure like
  "look at today's calendar and decide if a prep note is needed" runs
  `shells: [bbx calendar today]`, `judge: { question: "Does today hold an
  event that needs preparation the person has not done?" }`, and only then
  an `agents:` step. This is the "extend procedures" the boxholder asked
  for, and the watch evaluator uses the same `judge` call.

**Vocabulary lock-ins.** `watch` card fields; `$item` and `WATCH_ITEM`;
`judge` as the precheck field and the service method; `remind-` filename
prefix.

**First implementation chunk.** `jev.judge` with a doctest against the fake
and a serialized-request assertion; the `watch` schema; `evaluateWatches`
with a filesystem doctest: three commits add three cards, a fake Jev answers
0.9 for one, the watch fires once, disables itself, and the cursor advances;
the cap stops evaluation with a health entry and resumes. `bbx remind` and
the procedure `judge` are the second and third chunks.

### Track E. Sources: callouts, question sweep, health demotion and promotion

**What.** Change what each existing source sends, and add the chat callout as
a source.

**Why this needs to change.** Every current caller passes `severity: "alert"`
(`src/core/schedule/health-alert.ts:84` and the others under *What already
exists*). The boxholder's ruling: health stays in the app unless it blocks
something asked for; questions are a dot unless time-bound; agent outcomes
reach the person only when the agent marks them.

**Direction.**

- Callouts: `<callout loudness="quiet">` attribute, default none. On
  `chat-complete` (`src/core/event-bus-schemas.ts:173`), the chat runtime
  collects the turn's callouts; when presence is zero, each callout with a
  loudness, or the turn's callouts as one `dot` when none has one, becomes a
  notification with target `chat:<sessionId>` and body the callout text.
  Presence nonzero sends nothing: the callout is on screen. This is the
  "voice" for `issues/features/2026-08-09-agent-outcomes-need-a-voice.md` and
  `2026-08-22-file-asks-agent-flagged-attention.md`.
- Question sweep (`src/core/question-alert.ts:104`): `loudness: "dot"`. The
  question card gains `urgency?: "time-bound"`, set by the agent when the
  question blocks something with a date; the sweep sends `quiet` for those.
  Nudge (`src/core/question-aging.ts:214`): `quiet`.
- Health alerts: `health-alert.ts`, `connector-activity-alert.ts`,
  `google-auth-alert.ts`, `engine-unavailability-apply.ts` send `dot` with
  target `dashboard`; their text is already in the health snapshot or is
  added to it.
- Promotion: at the scheduler's skip site
  (`src/cli/commands/tick-helpers.ts:142-144`) and the engine-wait skip
  (`src/core/schedule/engine-wait.ts`), a skipped card whose description or
  filename marks it as boxholder-requested (`remind-` prefix, or a new
  `requested-by: boxholder` field on scheduled scripts that `bbx remind`
  sets) sends `loud` once per episode: "Your reminder could not run: Google
  needs reconnecting", target `dashboard`. The episode latch reuses
  `schedule-state.ts`.
- Capture failure: the capture pipeline's terminal failure
  (`issues/bugs/2026-08-20-capture-success-is-invisible.md` names the
  `capture-status` event, `src/core/event-bus-schemas.ts:206`) sends `quiet`
  with target `chat:<sessionId>` when presence is zero. Success sends
  nothing.

**Vocabulary lock-ins.** `urgency: time-bound` on questions; `requested-by`
on scheduled scripts; the `loudness` attribute on callouts.

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
  the default and propose adding the section at the next retro. The
  boxholder's own rules replace it once written.
- Agent guide: a "Reaching the boxholder" section in
  `src/core/agent-guide/commands.ts`: the three commands, loudness, targets,
  "the briefing owns when". Chat prompt
  (`src/core/chat/session/prompts.ts:163`): `<schedule>` is for coming back
  to this conversation within hours; `bbx remind` is for anything that must
  reach the person later or elsewhere; `<callout loudness>` is how to make
  an outcome reach them when they have left.
- Schema instructions on `watch` and the `judge` precheck carry two worked
  examples each, showing both the notify and the run form.
- `docs/notifications.md` reference doc: the vocabulary, the pieces, the
  channel table, the ops steps, the verification walk.

**Vocabulary lock-ins.** The section title "Reaching me".

**First implementation chunk.** The briefing section and the agent guide
section, with the knowledge audits below written and run.

## Could this be simpler?

The simplest version that works: keep the per-channel cards, add `bbx notify`
and an `apns` card, and skip watches and the procedure judge. Reminders via
`bbx remind` still work since they are scheduled scripts.

What the fuller plan buys:

- **One card instead of three per intent** (Track A): the presence gate runs
  once per intent, and a failed delivery is one card to inspect. With three
  per-channel cards, a present session would need three skips and the July
  plan's own condition for unifying is met. Principle 8, one way to do each
  thing.
- **Watches** (Track D): without them, "tell me when X arrives" is an agent
  run per wakeup, which is the cost that keeps these tasks from existing
  (the boxholder's stated reason for Jev). The watch is the only new card
  type in the plan.
- **The procedure judge** (Track D): a smaller change than the watch, and it
  is what lets a scheduled procedure be cheap by default. Skipping it leaves
  "extend procedures" undone.

Dropped from the fuller version because the simple version does not fail
without them: unread state, target-level presence, quiet hours in the
dispatcher, a notification center page, rich actions on notifications.

## Subplans

none. The one research question (Jev Noul wire shape and cost) is answered
under *Prior art*. The iOS work is a track, not a subplan, because its shape
is fixed by Apple's API and the contract rule.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Notification card with no channel able to send | Track A doctest | stamped `failed`, health entry | Clear |
| One channel fails, another sends | Track A doctest | `partial`, card kept | Clear |
| Present session skips push, person had already walked away | Track A doctest of the rule | heartbeat older than 90 s counts as absent; bus event still shown when they return | Silent by nature, bounded to 90 s: accepted |
| Presence file written by server, read by scheduler in another process mid-write | Track A doctest | atomic rename write; unreadable file counts as absent | Clear (falls to push) |
| APNs 410 or BadDeviceToken | Track B doctest | prune `apns` from device, log label | Clear |
| APNs keys unset on server | Track B doctest | channel `skipped: unconfigured`, Admin section says so | Clear |
| Sandbox token sent to production host | Track B doctest of environment routing | device reports environment; mismatch returns BadDeviceToken and prunes; re-register on next launch restores | Clear |
| Device token changes after reinstall | Track C unit test of re-register on launch | re-post every launch; old token pruned on 410 | Clear |
| Permission denied on the phone | Track C manual | shell shows the denied state with a Settings link | Clear |
| `bbx remind` with a past or unparseable time | Track D doctest | error before writing; no card | Clear |
| Reminder fires while the scheduler is down | existing scheduler catch-up (`docs/scheduler.md` sleep recovery) | fires on next tick | Clear |
| Watch cursor lost (`.beebox/` wiped) | Track D doctest | cursor resets to HEAD; items between are never evaluated; health entry `watch cursor reset` | Clear |
| Watch over the daily cap | Track D doctest | stop, keep cursor, health entry, resume next day | Clear |
| Jev unreachable or returns an invalid distribution | existing `JevError` (`src/services/jev.ts:19`); Track D doctest | evaluation stops for the pass, cursor kept, health entry after two consecutive passes | Clear |
| Jev key missing | Track D doctest | watches and judges skip with a health entry naming the secret purpose | Clear |
| Watch `then.run` command fails | Track D doctest | logged, cursor advances past the item, watch stays enabled, health entry | Clear |
| Same card matches two watches | Track D doctest | each fires independently; `tag` on the notification is the watch name so the phone collapses only within a watch | Clear |
| Callout turn completes, presence flips to present during delivery | Track E doctest | notification still sent; the person sees it twice at worst | Clear |
| Question `urgency` set on a question with no date | schema doctest | allowed; briefing says when | Clear (agent judgment) |
| Promotion rule fires for a system-scheduled script | Track E doctest | only `requested-by: boxholder` promotes | Clear |
| Existing `web-push` cards on disk at deploy | none exist (verified 2026-07-19 and by the delete-on-delivery lifecycle) | the schema is removed; `bbx validate` would flag any survivor as unknown type | Clear |

No critical gap. The presence window is the one accepted silent behavior,
bounded to the heartbeat interval.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field.** ADDRESSED: `loudness` is one enum; a wrong
  value fails schema validation with the three allowed values in the message.
  `<schedule>` versus `bbx remind` is the real confusion; Track F's prompt
  text draws the line by horizon and destination, and the knowledge audit
  tests it.
- **Stale ref.** ADDRESSED: a `card:` target that no longer exists renders to
  the browse URL, which shows the normal missing-card page. A `chat:` target
  whose session was deleted opens the chat page with a "conversation no longer
  exists" state that already exists for deleted sessions
  (`docs/plans/chat-session-delete.md`).
- **Two agents touching the same card.** ADDRESSED: notification cards are
  single-consumer (the connector); the watch cursor file is written only by
  `evaluateWatches`, which runs from finalize and sync, both serialized by
  the box maintenance lock (`src/lib/box-maintenance.ts`, used by
  `schedules.ts:1`). A watch card edited by an agent while evaluation runs
  is read once per pass.
- **Hand-edit drift.** ADDRESSED: watch and notification cards are
  schema-validated on load; `threshold` outside 0..1 and a `then` with both
  or neither form fail with a message naming the rule.
- **Fabricated free-form value.** ADDRESSED for criteria: a watch criterion is
  free text by design and is tested by Jev, not trusted. A `$item` in a
  notify body is substituted by code. For notification bodies from agents:
  the briefing asks for a body that stands alone, the same rule callouts have
  today.
- **Validation error UX.** ADDRESSED: `bbx notify` and `bbx remind` print the
  schema message and exit 1; the procedure judge writes the probability and
  threshold into the run card's step outcome.
- **Partial migration / transition state.** ADDRESSED: no on-disk
  `web-push` cards exist; the device record field is optional, so old
  records load; a box with no paired phone and no keys behaves as today.
  During Track A before Track B, `apns` is simply not in the channel table.

## NOT in scope

- **Unread state on chat replies and target-level presence.** Boxholder
  ruling 2026-09-26: not important now; filed as a follow-up issue when the
  plan lands. The `dot` is a badge, not a count.
- **Quiet hours in the dispatcher.** Boxholder ruling: device Do Not Disturb.
- **A notification center or activity feed page.** The app shows the bus
  event and the health page; a history page is a later ask.
- **Web push on iOS via Home-Screen install.** The native app replaces it;
  the coaching text in `NotificationsSection.tsx` is removed when Track C
  ships, since a person with the app should not be told to install a PWA.
- **Telegram as a designed channel.** Kept working as it is; no loudness
  mapping beyond `disable_notification`.
- **Rich notifications**: actions, images, reply from the notification.
  Deferred until the plain path is verified on a device.
- **Watch triggers other than new cards under a path.** Card edits,
  calendar changes, and time-of-day conditions are poll or scheduled
  procedures for now (the design notes, S3).
- **Jev for triage routing and quick capture.** Its own issue
  (`issues/features/2026-09-21-jev-triage-and-quick-capture-routing.md`);
  this plan adds the `judge` method it will also use.
- **Multi-person delivery policy.** Devices belong to the person who paired
  them; every notification goes to every device of the box. Per-person
  targeting waits for a second boxholder.
- **The dev-side schedule alert system.** Separate.
- **Fixing the 25-day chat timer.** Its issue stays open; `bbx remind` is the
  path for long horizons.

## Open design questions

1. **Where the reminder lands.** `chat:new` seeded with the reminder, or the
   linked todo card. Lean: `chat:new`, because a phone user types one line
   and the chat agent has the todo through `--context`.
2. **Presence heartbeat interval.** 30 s write, 90 s stale. Lean as stated;
   tune after the device test.
3. **Watch evaluation on the wakeup path.** After every `syncConnector` call
   or once after all connectors. Lean: once after all, at the same point the
   question sweep runs, plus finalize; simpler and mail arrives in that pass
   anyway.
4. **Default loudness for `bbx notify`.** `quiet`. An agent that wants a
   banner says `loud`. Lean as stated.
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
  the vet. In chat, what do you do?" Expects `bbx remind`, not `<schedule>`.
- `watch-setup`: "The person says: tell me when the school emails about the
  field trip." Expects a watch card under `_config/watches/` with a criterion
  and `once`, or a stated reason to poll instead.
- `judge-precheck`: "A daily procedure should only run an agent when today's
  calendar has an event needing preparation. How do you keep it cheap?"
  Expects a `judge` precheck over a `shells` output.
- `health-silence`: "Gmail sync has been failing for two days. Do you notify
  the person?" Expects no, unless a requested reminder or watch is blocked.

## What will hold this after it ships

- **Filesystem doctests** reach every decision: the channel table and
  presence rule (`send` is a pure function over the card, the audience, and
  a presence value), the APNs payload builder (pure), the watch evaluator
  with a fake Jev and a real temporary git repo, the reminder card writer,
  the promotion rule at the skip site. Cost: ordinary; the fakes exist for
  push and Jev and the plan adds one for APNs in the same shape.
- **Route doctests** for the push-token route and `bbx notify --channel`.
- **Schema doctests** for `notification`, `watch`, and the question
  `urgency` field.
- **The mobile contract fixture** for the new route, checked by the existing
  tripwire.
- **iOS unit tests** for environment selection and target URL construction;
  the rest of the client is verified on a device by the boxholder, recorded
  in the reference doc's verification walk.
- **Knowledge audits** above, run and landed.
- No new test tier. No mock beyond the three service fakes, which record
  calls rather than encode behavior.

## Implementation order

1. **Track A** chunk 1: schema, target, dispatcher, connector with web-push
   and telegram channels, doctests. Chunk 2: presence counter and heartbeat,
   `bbx notify`, bus event and the in-app toast, removal of `bbx push test`
   and `web-push.ts`.
2. **Track B** chunk 1: payload builder, service, device record, route,
   contract update. Chunk 2: the `apns` channel in the connector, Admin
   device list, debug log.
3. **Track C**: entitlement, delegate, registrar, presentation, tap handling,
   badge clearing. Simulator-verified; device test with the boxholder.
4. **Track D** chunk 1: `jev.judge`, `watch` schema, evaluator with cursor and
   cap, finalize and wakeup wiring. Chunk 2: `bbx remind`. Chunk 3: procedure
   `judge` precheck.
5. **Track E** chunk 1: loudness on existing callers, question `urgency`.
   Chunk 2: callouts on `chat-complete`, promotion rule, capture failure.
6. **Track F**: briefing section, agent guide, chat prompt, schema
   instructions, reference doc, knowledge audits written and run.
7. **End-to-end**: `BBX_PUSH_FAKE=1` and the APNs fake through every source;
   then desktop web push with real VAPID keys; then the boxholder's device
   walk: pair, register, `bbx notify --loud`, tap, land; `bbx remind --at "in
   2m"`; a watch over a test mail. The ops steps (VAPID keys, APNs key, Apple
   capability) are the boxholder's.

Tracks A and D have no dependency on each other beyond the `bbx notify`
command; they can run in separate sessions once A's chunk 1 has landed in
the worktree. B depends on A's card; C depends on B's route; E depends on A;
F is written last so it describes what shipped.

## Rollout shape

- **Tests first.** Each chunk names its doctest above and is done when it
  passes with typecheck and lint. The Failure-modes column names the doctest
  for each row.
- **Knowledge audits** land with Track F, run against the test box.
- **Migration.** None on disk: `web-push` cards do not exist; the device
  record field is optional; watch and notification are new types. The
  briefing section reaches new boxes through the template; existing boxes
  get the default from the agent guide until the section is written (Track
  F). Adding it to the boxholder's own boxes is a step in the verification
  walk.
- **Ops, reserved for the boxholder.** VAPID keys on prod; an APNs key
  (`.p8`) from the Apple Developer account, its key id, and the team id in
  `/home/beebox/.env`; the Push Notifications capability on the app target in
  Xcode; a Debug build on the boxholder's phone for the sandbox walk, then a
  Release build for production.
- **Ships as one unit** when the device walk passes and the boxholder says
  so. Track A alone changes what every existing alert does and must not land
  without Track E's loudness changes.
