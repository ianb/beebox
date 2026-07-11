# Web Push notifications

> **Status: implemented and merged** (Tracks A–E). All doctests + the full suite
> pass; the Admin "Enable notifications" UI is browser-verified on desktop.
> Remaining verification + the prod VAPID-keys ops step are tracked in
> `issues/code-quality/2026-07-04-web-push-followup-testing.md` — the feature stays dormant in
> prod until those keys are set.

Add W3C Web Push so the box can reach the boxholder on phone (incl. iOS) and
desktop without Telegram. Standard Push API + Service Worker + Notification API
+ VAPID — one codebase covers Chrome/Firefox/Edge/Android and desktop Safari;
iOS works only for a Home-Screen-installed PWA (iOS 16.4+). The load-bearing
decision this plan settles is **how a push send relates to the box's existing
outbound model** ("write an output card → a connector delivers it").

## Stated preferences this plan trades against

- `callback-box/CLAUDE.md:Behavioral Notes` — *"Read before writing. Don't
  guess file formats... read the existing code, read the test patterns."* This
  plan reuses the existing outbound contract rather than inventing a parallel one.
- `callback-box/CLAUDE.md:Behavioral Notes` — *"HTTP endpoints go in tRPC by
  default... Raw Fastify routes ... are only for things that don't fit the tRPC
  request/response shape: file upload/download, OAuth redirects, webhooks."* The
  manifest/SW asset routes are static-file shaped → raw Fastify; subscribe/
  vapid-key are request/response → tRPC.
- `callback-box/CLAUDE.md:Behavioral Notes` — *"Keep source and docs generic —
  never hardcode personal names."* Subscriptions are server-level machine state,
  VAPID is a server secret; no boxholder identity in committed source.
- `callback-box/CLAUDE.md:Cards` — the Phase-2 YAML-frontmatter card format and
  the `box/output/` outbound contract (`src/schemas/telegram-message.ts`).
- `callback-box/CODE-STYLE.md` — no `any`, no default parameters, max-2
  positional params (named-object beyond), custom error classes, files ≤300 /
  functions ≤150 lines.
- Most recent precedent for "a server-secret + a per-box opt-in feeding an
  outbound alert": `src/core/schedule-health-alert.ts` (the health-alert path).
  This plan generalizes that path rather than cloning it.

## What already exists

- **PWA shell, installable.** `src/frontend/public/manifest.webmanifest` (`display:
  standalone`, icons, name "Callback Box") and a registered SW in
  `src/frontend/src/main.tsx:23-25`: *"if ('serviceWorker' in navigator)
  { navigator.serviceWorker.register(withBase('/sw.js')); }"*. **Reuse** the
  manifest groundwork; **rebuild** `public/sw.js` — it is a 2-line no-op stub
  (`src/frontend/public/sw.js:1-2`) with zero push capability.
- **The outbound contract.** `src/connectors/telegram-output-cards.ts:32`
  `sendOutputCards()` flushes `*.telegram-message.card` files from `box/output/`,
  deletes on success, stamps `failed` on error. **Reuse** as the telegram sink;
  this plan adds web-push as a second sink, not a replacement.
- **The existing "reach the boxholder" trigger.** `src/core/schedule-health-alert.ts:60`
  `checkHealthAndAlert()` hand-writes a telegram-message card and flushes it. Called
  from the scheduler tick at `src/core/scheduler.ts:207`: *"const alert = await
  checkHealthAndAlert(boxPath, { now: new Date() });"*. **Reuse** as the first
  caller migrated to the new dispatcher.
- **Outbound card lifecycle precedent.** `src/schemas/telegram-message.ts:31-44`
  (status `pending`/`failed`, committed, deleted on success) +
  `src/connectors/telegram-output-cards.ts:32-92`. **Reuse the shape** for the new
  `web-push` card + connector (Track C). `docs/box-layout.md:57` already lists
  `box/output/` as holding "push notifications... Flushed by `cb finalize`".
- **`cb finalize` connector dispatch.** `src/cli/commands/finalize.ts:18-32`
  initializes connectors and runs `getAllConnectors()`; telegram flushes its cards
  here (`src/connectors/telegram.ts:124`). **Reuse** — the push connector registers
  the same way and flushes `web-push` cards at finalize.
- **Server-level state precedent.** `src/core/scheduler.ts:30` (`~/.local/share/cb`
  log dir) and `src/core/boxes-config.ts:26` (`~/.config/cb`). **Reuse the level** —
  the endpoint-keyed subscription store lives at `~/.local/share/cb/`, outside any
  box (it is *not* per-box; a `PushSubscription` is per-SW-registration).
- **Server-secret home, wired to both units.** `deploy/setup-server.sh:152-154`
  (serve) and `:178-180` (scheduler) both set `EnvironmentFile=$CB_HOME/.env`.
  **Reuse** for VAPID keys, visible to both the API server (serves the public key)
  and the scheduler/finalize (sends pushes). Caveat: the setup script seeds only
  `PUBLIC_URL`/`PATH`/optional-key placeholders (`deploy/setup-server.sh:110-126`),
  so adding the VAPID vars is an explicit new ops step, not a pre-existing slot
  (codex #6). No per-box-secret friction (`docs/ideas.md:510`).
- **Runtime base/box derivation.** `src/frontend/src/api-core.ts:45` `withBase()`
  and `:60` `getApiBase()` derive the worktree base (build-time `BASE_URL`) and box
  slug (runtime `window.location.pathname`). **Reuse** to build the subscribe URL
  and the deep-link `url` carried in each push payload.

## Prior art (external)

- **`web-push` (web-push-libs/web-push), npm.** Node library: `generateVAPIDKeys()`,
  `setVapidDetails()`, `sendNotification()`. The standard server sender — **use it**.
  Package metadata confirms version 3.6.7 (codex spot-check); confirm the current
  publish/maintenance status with `npm view web-push` at implementation time rather
  than relying on a blog's "maintained" claim.
  https://github.com/web-push-libs/web-push ,
  https://www.npmjs.com/package/web-push
- **Gone-endpoint pruning.** `sendNotification()` rejects with an error carrying
  `statusCode`; **404/410 means the endpoint is dead and must be pruned**. Other
  status codes (429, 5xx) are transient — keep the subscription. web.dev confirms
  the pattern. https://web.dev/articles/sending-messages-with-web-push-libraries
- **iOS reliability is best-effort.** iOS 16.4+ supports Web Push *only* for
  Home-Screen-installed PWAs (never a Safari tab); no install-prompt API, so we
  must coach Share → "Add to Home Screen". Subscriptions can silently "disappear"
  after prolonged inactivity even on iOS 18 — design for resubscribe, don't assume
  durability. The Home-Screen-only requirement is WebKit-confirmed; the
  silent-disappearance and unsubscribe-trap specifics below come from secondary
  blogs, not a primary source — treat as likely-but-unverified and confirm during
  the iOS device test. https://brainhub.eu/library/pwa-on-ios ,
  https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide
- **iOS unsubscribe trap (important, secondary-sourced).** Calling
  `subscription.unsubscribe()` on the client (e.g. a "disable" button) reportedly
  makes Safari refuse a *new* subscribe without a fresh user gesture.
  **Recommendation: never client-unsubscribe to disable; remove server-side
  instead** (cheap insurance whether or not the trap reproduces). Same source as above.
- **`pushsubscriptionchange` event.** Spec event fired when the UA rotates keys;
  *Safari may not fire it*, but handling it is cheap and correct — the SW re-posts
  the new subscription to the backend. https://developer.mozilla.org/en-US/docs/Web/API/Push_API
- **Service-worker scope is single, prefix-match.** A registration's scope
  prefix-matches page URLs; one SW per scope. **Consequence for us (verified
  against our code):** in prod `BASE_URL` is `"/"` so `withBase('/sw.js')`
  registers scope `/` — *one SW controls every box*. In dev it's `/<worktree>/`.
  So the SW is **not** inherently box-scoped; the box a notification belongs to
  must be carried in the stored subscription + the push payload, not inferred from
  scope. https://github.com/w3c/ServiceWorker/issues/566

## Tracks / scope

Ordered by implementation dependency, then surface size. The architecture below
reflects two boxholder decisions (2026-06-29) made after a codex review
(`web-push-notifications.review-codex.md` findings #1, #2): **(1)** push
subscriptions are **server-level, keyed by endpoint** (a `PushSubscription` is
bound to the one SW registration, not to a box — `src/frontend/src/main.tsx:23-24`
registers a single SW and the same frontend is served at root and every box prefix,
`src/webapp/server.ts:100-106`); **(2)** push delivery goes **through a durable
`box/output` card flushed by `cb finalize`**, exactly like telegram — not a direct
send. `docs/box-layout.md:57` already anticipates this: *"Outbound cards staged for
delivery (push notifications, replies). Flushed by `cb finalize`."*

### Track A — Service worker push handlers + manifest line fix

**What.** Replace the `sw.js` stub with a real SW that handles `push` (show a
notification from the payload), `notificationclick` (focus/open the deep-link URL),
and `pushsubscriptionchange` (re-post the rotated subscription to the subscribe
endpoint).

**Why this needs to change.** The current SW is a no-op installability stub
(`src/frontend/public/sw.js:1-2`); it can receive no push.

**Direction.**
- `public/sw.js` (plain JS, served as-is — not bundled): `push` →
  `self.registration.showNotification(title, { body, data: { url }, tag, icon })`;
  `notificationclick` → `clients.matchAll()`, focus an existing client whose URL
  starts with `data.url` else `clients.openWindow(data.url)`; `pushsubscriptionchange`
  → resubscribe with the cached VAPID key and POST the new subscription to the
  server-level subscribe endpoint (re-posting the *one* endpoint — correct now that
  storage is endpoint-keyed, Track B; the old per-box plan couldn't know which box
  endpoints to re-post, codex #1).
- **One root/base-scoped SW, box carried in payload `data.url`.** Keep registering
  at `withBase('/sw.js')` (scope `/` prod, `/<wt>/` dev). One SW serves all boxes;
  the per-box target is the fully-qualified deep-link `url` in each notification's
  payload, and which boxes an endpoint wants lives in the endpoint's server-level
  record (Track B). Matches the single-SW reality verified in code.
- **Manifest:** leave it root-served and root-scoped for v1 (per-box install
  identity deferred — see NOT in scope). The plan's earlier `start_url` citation was
  wrong: `src/frontend/public/manifest.webmanifest` line 3 is `short_name`, line 4
  is `start_url: "./"` (codex #7). No SW behavior depends on this for v1.

**First implementation chunk.** The real `sw.js` (push + notificationclick +
pushsubscriptionchange) plus the `cb push test` command (Track B) to confirm a
notification renders through `localhost:3210/<wt>/<box>/...`. The SW payload
contract `{ title, body, url, tag }` is fixed here; Tracks B–E conform.

### Track B — Server-level subscription store + `web-push` sender + observability

**What.** A **server-level** store of PushSubscription objects keyed by endpoint
(each record carrying the set of box slugs that endpoint opted into), and a sender
that pushes to the endpoints opted into a given box, pruning dead ones.

**Why this needs to change.** Nothing server-side can send a push today; no
`web-push` dep exists. Per-box storage would duplicate one browser's endpoint
across box files and break 410-pruning + `pushsubscriptionchange` (codex #1).

**Direction.**
- Add `web-push` dep. VAPID via `process.env.CB_VAPID_PUBLIC_KEY` /
  `CB_VAPID_PRIVATE_KEY` (+ `mailto:` subject). Generated once with `npx web-push
  generate-vapid-keys`; written to `/home/callback/.env` (loaded by both the serve
  and scheduler units, `deploy/setup-server.sh:152-154`, `:178-180`). Note: the
  setup script seeds only `PUBLIC_URL`/`PATH`/optional-keys placeholders
  (`deploy/setup-server.sh:110-126`), so the VAPID keys are a **new explicit ops
  step** — write both vars + restart both services (codex #6). Local dev: same vars
  in the dev shell env. Document in `deploy/README.md`.
- **Server-level store** at `~/.local/share/cb/push-subscriptions.json` (the same
  server-state level as the existing log dir `src/core/scheduler.ts:30`
  `~/.local/share/cb`, and `~/.config/cb` `src/core/boxes-config.ts:26`) — *outside*
  any box, so it's never committed and one endpoint is stored once. Shape:
  `{ [endpoint]: { keys: {p256dh, auth}, boxes: string[], createdAt, ua? } }`.
  `src/core/push-subscriptions.ts`: `addSubscription(boxSlug, sub)` (adds boxSlug to
  the endpoint's `boxes`), `removeEndpoint(endpoint)`, `endpointsForBox(boxSlug)`.
  Read-modify-write guarded by `src/lib/file-lock.ts` (API subscribe + finalize
  prune both write it; CLAUDE.md *"All cross-process locks go through ...file-lock.ts"*).
- **`PushService` interface, real + fake** (mirroring `TelegramService`,
  `src/services/CLAUDE.md`): `sendNotification(subscription, payload)` →
  `{ ok } | { gone }` (404/410) | throws (transient). Real wraps `web-push`; fake
  records calls in observable state for doctests + the observability sink.
- `src/core/send-push.ts`: `sendPush(boxSlug, { title, body, url, tag }, { push? })`
  — resolves `endpointsForBox`, sends via injected-or-real `PushService`, on `gone`
  calls `removeEndpoint`, returns `{ sent, pruned, failed }` (the **`sent` count is
  the delivery-confirmation signal** the push connector latches on, Track C / codex
  #3). Re-throws transient to the connector (so it can stamp the card `failed`),
  logs anomalies only. Never logs endpoints/keys.

**Dev observability — "see" a push without a subscribed device.**
- **Sink:** `sendPush` appends each delivered payload (`{ title, body, url, tag,
  sentAt, sent, boxSlug }`, *no* endpoints/keys) to gitignored
  `.callback-box/push-debug.log` (JSONL, sibling to `client-debug.log`). Answers
  "did the trigger fire, what would it say, how many devices?" with zero subscribers.
- **Forced-fake dev mode:** `CB_PUSH_FAKE=1` routes `sendPush` through
  `FakePushService` against one synthetic endpoint, so any trigger writes a
  `push-debug.log` line with no real subscription. Exercises every trigger path on
  desktop with zero setup.
- **`cb push test [--box <slug>] [--text ...]`**: fires one push through the real
  `sendPush` to subscribed endpoints — the manual "does my desktop browser actually
  receive it" check.

**First implementation chunk.** `push-subscriptions.ts` (endpoint-keyed store) +
`PushService` (real + fake) + `send-push.ts` + sink, with a filesystem doctest:
add the same endpoint under two boxes (assert stored once, `boxes` has both),
inject `FakePushService`, assert a `gone` prunes the endpoint from *all* boxes at
once, a healthy endpoint survives, `sent` counts correctly, and a `push-debug.log`
line is written.

### Track C — `web-push` output card + push connector (durable delivery via finalize)

**What.** A `web-push` output card type (the durable push analog of
`telegram-message`) and a push connector that flushes pending `web-push` cards
during `cb finalize`, mirroring the telegram output-card path.

**Why this needs to change (THE architecture decision, revised).** Direct
`sendPush` has no committed intent, no replay, no failed-card artifact, and no `cb
finalize` path (codex #2). The boxholder chose to route push through the durable
card model. This also resolves the silent-latch risk (codex #3): a push that fails
to deliver leaves a `failed` `web-push` card in `box/output/` — an inspectable
artifact, exactly like a failed telegram card (`telegram-output-cards.ts:60-68`) —
so latching an alert episode never silently drops it.

**Direction.**
- New schema `src/schemas/web-push.ts` via `cardSchema("web-push", { fields })`,
  registered in `src/schemas/registry.ts`. Fields: `title`, `body`, `url`,
  `severity: "info" | "alert"`, `tag?`, `status: "pending" | "failed"`, `error?`.
  No `chat-id` analog — the audience is "this box's subscribed endpoints", resolved
  at send time via `endpointsForBox(boxSlug)`. Filename
  `<name>.web-push.card` in `box/output/`.
- New connector `src/connectors/push.ts` `createPushConnector(boxRoot, push?)`,
  registered so `getAllConnectors()` picks it up and `cb finalize` runs it
  (`finalize.ts:18-32`). Its `sync()` mirrors `telegram-output-cards.ts:32`:
  read pending `*.web-push.card`, call `sendPush(boxSlug, payload)`, **delete the
  card when `sent ≥ 1`**, stamp `status: failed` + `error` and **leave it in place**
  when total delivery failed (durable artifact), commit with trailers. Endpoints
  pruned inside `sendPush` (Track B).
- Box opt-in: push needs at least one subscribed endpoint for the box; no telegram-
  style config flag is required (subscribing *is* the opt-in). A `web-push` card for
  a box with zero subscriptions is delivered to nobody → `sent: 0` → the connector
  stamps it `failed` so the situation is visible, not silently dropped.

**First implementation chunk.** `web-push.ts` schema + `createPushConnector` with a
filesystem doctest (`makeTmpBox()` + injected `FakePushService`): a pending card
with a healthy endpoint is sent and deleted; a card whose only endpoint returns
`gone` is stamped `failed` and the endpoint pruned; `cb finalize --connector push`
flushes it.

### Track D — `notifyBoxholder` dispatcher + rewire health alert + question sweep

**What.** A `notifyBoxholder(boxRoot, { title, body, url, severity })` that writes
the durable cards for every configured channel — a `web-push` card (always) **and**
a `telegram-message` card (when `healthAlerts.telegramChat` is set). Then rewire the
two v1 triggers to call it: schedule-health alerts and a finalize-time pending-
question sweep.

**Why this needs to change.** `checkHealthAndAlert` hand-writes a telegram card
today (`schedule-health-alert.ts:80-89`); web push must reach the boxholder through
the same intent without a second silo. Fan-out happens at **card-write time** (each
channel gets its own durable, single-consumer card with the simple existing
lifecycle), not at delivery — so the telegram path is untouched and the push path is
its mirror.

**Direction.**
- `src/core/notify-boxholder.ts`: writes a `web-push` card (via the Track C schema
  template) and, if telegram is configured, a `telegram-message` card (reusing
  `createTelegramMessageTemplate`). Commits them. Both flushed at the next
  `cb finalize` by their respective connectors. No new generic card and no multi-
  consumer lifecycle — two simple cards.
- **Rewire `checkHealthAndAlert`** to build `{ title, body, url, severity: "alert" }`
  and call `notifyBoxholder`, moving its telegram-specific text-building into the
  call. The existing latch (`schedule-health-alert.ts:91-97`) is now safe: a delivery
  failure leaves a `failed` card (codex #3 resolved).
- **Question sweep (the boxholder's "do it on finalize, like Telegram" approach).**
  A new finalize-time check `checkPendingQuestionsAndNotify(boxRoot)` scans pending
  questions — the data `getSystemState` already gathers (`src/core/state.ts:128-132`
  scans `box/questions/`) — diffs against a per-question latch (same latch pattern as
  health alerts, `schedule-state.ts`), and calls `notifyBoxholder` for newly-pending
  questions with `severity: "alert"` and a deep-link `url` to the question. This needs
  **no per-producer hook** — triage/scan-import/etc. keep writing to `box/questions/`
  untouched (codex #4 dissolved: the cheap hook is the finalize sweep, not a central
  createQuestion event). Run it from the same place the health check runs.

**Vocabulary lock-ins.** `severity: "info" | "alert"`; payload/card field names
`{ title, body, url, tag, severity }` shared verbatim across SW, sender, card
schema, connector, and dispatcher.

**First implementation chunk.** `notify-boxholder.ts` with a filesystem doctest
asserting the card matrix (telegram-only → one telegram card; push-context box →
one web-push card; both → both), then rewire `checkHealthAndAlert`. The question
sweep is a second chunk (it depends on the latch + deep-link URL shape).

### Track E — Frontend enable/subscribe flow + iOS coaching

**What.** A user-gesture "Enable notifications" affordance that requests permission,
`PushManager.subscribe`, and POSTs `{ boxSlug, subscription }` to the server-level
store; plus iOS standalone-detection that shows Add-to-Home-Screen coaching instead
of a dead button.

**Why this needs to change.** No subscribe path exists; iOS Safari (not installed)
can't subscribe and needs coaching.

**Direction.**
- tRPC `push` router (`src/webapp/trpc/routers/`): `vapidPublicKey` (query) and
  `subscribe` (mutation, Zod-validated `{ endpoint, keys }`; the box slug comes from
  the request's box scope, persisted via `addSubscription`). **No client-side
  `unsubscribe`** (iOS trap — Safari then refuses re-subscribe without a gesture,
  prior art); a "disable" affordance calls a `removeEndpoint` mutation server-side.
- Component under a page's `components/` (FRONTEND.md primitives, className-only-for-
  layout). State machine: unsupported → iOS-needs-install (coaching) →
  installable/prompt → subscribed. Standalone detect via
  `window.matchMedia('(display-mode: standalone)').matches || navigator.standalone`.
- Placement: settings/admin surface (Open question 1).

**First implementation chunk.** The tRPC `push` router (`vapidPublicKey` +
`subscribe` + `disable`) with a route doctest (`makeTestServer()`): subscribe
persists to the server-level store under the request's box, is idempotent on the
same endpoint, and `disable` removes it. Frontend component follows.

## Subplans

None. No sub-question here has independent research/vocabulary/schema decisions
warranting a separate plan — the subscription-ownership and durability decisions
were settled inline (boxholder + codex review) rather than deferred to a subplan.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Push endpoint 404/410 (expired/rotated) | Track B chunk doctest | `sendPush` prunes the endpoint from all boxes, persists | Clear (pruned + counted) |
| Transient send failure (429/5xx) | Track C connector doctest | `sendPush` re-throws → connector stamps card `failed`, leaves it | Clear (durable `failed` card) |
| `web-push` card delivers to zero endpoints | Track C doctest | `sent:0` → connector stamps `failed` (not deleted) | Clear (durable artifact) |
| VAPID env vars unset on server | Plan: doctest the guard | custom error from `sendPush` → connector stamps card `failed`; telegram card unaffected (separate connector) | Clear (failed card + warn; telegram still delivers) |
| Health latch suppresses an undelivered episode (codex #3) | Track D doctest | latch is safe — failed delivery leaves a `failed` `web-push` card to inspect | Clear (resolved by card model) |
| Same browser subscribes under two boxes | Track B doctest | endpoint stored once, `boxes[]` holds both; prune removes once | Clear |
| Two writers race the server-level store (subscribe vs finalize prune) | Plan: doctest concurrent write | `file-lock.ts` serializes read-modify-write | Clear |
| iOS subscription silently disappears | n/a (UA behavior) | resubscribe on next visit; `pushsubscriptionchange` re-posts | Silent by nature → documented best-effort |
| Client `subscribe()` denied (permission) | Track E component test | state machine shows denied state, no retry loop | Clear (UI state) |
| Notification payload missing `url` | SW handler default | `notificationclick` falls back to box root | Clear |
| SW not yet active when subscribe called | Track E | `navigator.serviceWorker.ready` await before subscribe | Clear |
| Trigger fires but no browser subscribed | Track B/C doctest | `sent:0`, `push-debug.log` line written, card stamped `failed` | Clear (inspectable) |

**Critical gap (documented risk, accepted):** *iOS subscription disappearance* —
no test, UA-side, partially silent. Accepted because it is inherent to iOS Web
Push (prior art); mitigated by resubscribe-on-visit and `pushsubscriptionchange`.
We surface it to the boxholder as "best-effort on iOS" rather than engineering
around an Apple limitation.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — ADDRESSED. There IS a new agent-authorable card
  (`web-push`), but agents don't hand-author it — `notifyBoxholder` writes it from
  the trigger code. Its schema validates on load (`cb validate`), so a malformed
  hand-edit is flagged like any card.
- **Stale ref** — ADDRESSED. The card/payload carries a self-contained deep-link
  `url`, not a card ref; `notificationclick` on a since-changed page degrades to a
  normal navigation, not a broken ref.
- **Two agents touching the same card** — ADDRESSED. `web-push` cards are single-
  consumer (the push connector, like telegram cards); the server-level subscription
  store is guarded by `file-lock.ts` (Failure modes).
- **Hand-edit drift** — ADDRESSED. The subscription store is machine state outside
  any box (`~/.local/share/cb/`), not a hand-edited card. The `web-push` card's
  `severity`/`status` are schema-enumerated, so a bad hand-edit fails validation —
  unlike `loadBoxConfig`, which is an unvalidated `JSON.parse` (`box-config.ts:94-103`),
  so no push *policy* lives in box.json (subscribing is the opt-in; codex #5).
- **Fabricated free-form value** — ADDRESSED. Card title/body come from the trigger
  code that builds today's telegram text (`schedule-health-alert.ts` `alertLine`),
  not free agent prose.
- **Validation error UX** — ADDRESSED. Subscribe input is Zod-validated in tRPC;
  `web-push` cards validate via `cb validate` on load. Malformed → typed error /
  lint flag, not a silent drop.
- **Partial migration / transition state** — ADDRESSED. No data migration (net-new
  server-level store + net-new additive card type). During rollout, a box with no
  subscriptions and no telegram config gets no alerts — identical to today; an
  un-flushed `web-push` card from a pre-connector build just sits pending until the
  connector lands (same as any pending output card).

## NOT in scope

- **A single channel-agnostic `notification` card consumed by multiple connectors.**
  Deferred — instead, `notifyBoxholder` writes one durable card *per channel*
  (`web-push` + `telegram-message`), each single-consumer with the simple existing
  lifecycle. A multi-consumer card needs per-channel delivery tracking in one card's
  lifecycle (when is it deleted?); per-channel cards avoid that. Promote to a unified
  card only if channel count grows enough to make N-cards-per-intent the worse cost.
- **Per-box PWA install identity (dynamic manifest).** Deferred (boxholder call,
  2026-06-29) — root/base-scoped install opening to the box selector is acceptable;
  push works across boxes regardless. Revisit if the selector-first install proves
  annoying in daily use.
- **New push triggers beyond health alerts + new-questions.** Deferred — v1 covers
  schedule-health alerts and a finalize-time new-question sweep (boxholder call);
  don't invent further interruptive noise (briefing watch-out; CLAUDE.md "don't add
  features beyond...").
- **Per-endpoint box policy beyond "subscribed = wants this box".** Deferred — an
  endpoint opts into a box by subscribing while viewing it; no per-severity or
  per-trigger filtering per device in v1.
- **Per-user (multi-boxholder) subscriptions.** Deferred — the store is keyed by
  endpoint with box opt-ins, not by authenticated user; mirrors the current single-
  boxholder model (cf. `docs/ideas.md:745` per-user Google tokens, also deferred).
- **Telegram removal.** Out of scope — web push is additive; telegram stays.
- **Rich notifications (actions, images, badging).** Deferred — title/body/deep-link
  only for v1.
- **Android/desktop install prompt (`beforeinstallprompt`).** Deferred — those
  browsers auto-offer install; only iOS needs the manual coaching we do build.

## Open design questions

1. **Where the "Enable notifications" affordance lives.** Lean: the existing
   admin/settings surface for the box. Open: a dedicated settings card vs a
   dashboard banner that appears only when supported-and-unsubscribed.

**Resolved (boxholder + codex review, 2026-06-29):**
- *Subscription ownership* (codex #1) — **server-level, endpoint-keyed** with box
  opt-ins (Track B). A `PushSubscription` is per-SW-registration, not per-box.
- *Push vs the outbound card model* (codex #2) — **route through a durable
  `web-push` `box/output` card flushed by `cb finalize`** (Track C), not a direct
  send. This also resolves the silent-latch risk (codex #3).
- *Per-box PWA install identity* — **deferred** (see NOT in scope). Root/base-scoped
  install opening to the selector is acceptable.
- *"A question needs an answer" pushes* — **yes, via a finalize-time sweep** of
  `box/questions/` (boxholder's "do it on finalize, like Telegram"). No per-producer
  hook and no central createQuestion event needed (dissolves codex #4) — the sweep
  reuses the data `getSystemState` already gathers and latches per question.

## Knowledge audits

**Decision at implementation (2026-06-29): skip, with rationale.** The plan
originally proposed a `knows_directly` audit for "how does box code notify the
boxholder across channels → `notifyBoxholder`". But `knowledge-audits.yaml` tests
what a **box agent** recalls from the agent guide, whereas `notifyBoxholder` is
**callback-box dev-repo internal** — box agents never call it. The only
agent-facing slice is "to send the boxholder a push, write a `.web-push.card` in
`box/output/`", and that is covered on-demand by the schema's `instructions`
(injected when an agent handles such a card), not a CLAUDE.md convention an agent
must recall cold. So there is no well-aimed `knows_directly` audit here — the
concept is either dev-facing (notifyBoxholder, the connector, the store) or
on-demand schema instructions. Skip-with-rationale per this section's allowance.

## Implementation order

1. **Track A** — real `sw.js` (push/click/change handlers); verify a notification
   renders through the dev router (driven by step 2's `cb push test`). (No deps.)
2. **Track B** — endpoint-keyed server-level `push-subscriptions.ts` + `PushService`
   (real + fake) + `send-push.ts` + `push-debug.log` sink + `CB_PUSH_FAKE` +
   `cb push test` + VAPID env wiring; filesystem doctest (prune-from-all-boxes,
   two-box endpoint, sink-written). (Ordered early; C/D/E consume it.)
3. **Track C** — `web-push` card schema + `createPushConnector` (finalize delivery,
   delete-on-sent, stamp-failed-otherwise); filesystem doctest with injected fake.
   (Deps: B.)
4. **Track D** — `notifyBoxholder` (per-channel card writer) + rewire
   `checkHealthAndAlert`; then the finalize-time question sweep
   (`checkPendingQuestionsAndNotify` + per-question latch + deep-link URL);
   knowledge audit written + run. (Deps: C for the card schema, B for `sendPush`.)
5. **Track E** — tRPC `push` router (`vapidPublicKey` + `subscribe` + `disable`) +
   frontend enable/coaching component. (Deps: B for the store.)
6. **End-to-end** — two passes: (a) `CB_PUSH_FAKE=1` → fire each trigger → `cb
   finalize` → confirm the `push-debug.log` payloads + the cards' delete/failed
   lifecycle (verifies *triggers + durable delivery* with zero browser setup); then
   (b) real desktop subscribe (Chrome/Firefox — real Web Push, no install) →
   `cb push test` + a real health alert → receive the actual notification; then a
   real iOS Home-Screen install device test (boxholder assists).

The plan ships as one unit (merge to main) only after the end-to-end test passes,
on the boxholder's explicit go — not after any single chunk.

## Rollout shape

- **Test posture.** Doctests as a design tool (`docs/testing.md`): the load-bearing
  new codepaths get filesystem doctests with the injected `FakePushService`
  (service-injection pattern, `src/services/CLAUDE.md` / `src/connectors/CLAUDE.md`)
  — Track B's endpoint-keyed store + prune-from-all-boxes, Track C's connector
  delete-on-sent / stamp-failed lifecycle, Track D's per-channel card matrix; Track
  E's subscribe gets a route doctest (`makeTestServer()`). The `FakePushService` +
  `push-debug.log` sink + `CB_PUSH_FAKE` mode are what let trigger paths be
  exercised on desktop with no subscribed device. The SW handlers and the iOS
  coaching UI are verified by the manual desktop + device end-to-end (UA behavior
  can't be unit-tested meaningfully). Done-when = those doctests pass + each trigger
  produces the expected `push-debug.log` payload and `web-push` card lifecycle + a
  real desktop push is received.
- **Knowledge-audit entries.** One `knows_directly` audit (Track D), landed run.
- **Migration approach.** None — net-new server-level state file
  (`~/.local/share/cb/push-subscriptions.json`, outside any box) + a net-new
  additive `web-push` card type. No existing on-disk card shape changes, so no
  `cb-migration` migrator. New server secret (`CB_VAPID_*` in `/home/callback/.env`)
  is an ops step (write both vars + `systemctl restart` serve **and** scheduler,
  since the setup script does not seed them — codex #6), documented in
  `deploy/README.md`, applied once before the feature is exercised in prod.
- **Secrets/logging discipline.** Subscription endpoints + keys live only in the
  server-level store (outside any repo), never committed and never logged (CLAUDE.md
  noise rule + briefing watch-out); the `push-debug.log` sink records payloads only,
  no endpoints/keys. VAPID private key only in `.env`, excluded from rsync
  (`deploy/deploy.sh:29` `--exclude '.env'`).
```
