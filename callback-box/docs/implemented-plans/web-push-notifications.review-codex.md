---
title: "Codex review — web-push-notifications.md"
status: implemented
workstream: unknown
issues: []
---
# Codex review — web-push-notifications.md

Cross-model (OpenAI codex, read-only repo access, high reasoning) review of the
*first* draft of `web-push-notifications.md`, run 2026-06-29. Verbatim findings
below. The plan was then revised in response — see the disposition note after each
finding and the "Resolved" block in the plan's Open design questions.

> Line numbers in the findings reference the **pre-revision** draft and no longer
> map to the current plan; the substance is what matters.

---

## Findings (verbatim)

**1. High: root-scoped SW + per-box subscription storage is the wrong owner model.**
Plan Track A says keep one root/base SW and carry box in subscription/payload, while
Track B stores subscriptions per box. Actual code registers one SW at
`withBase("/sw.js")` (`src/frontend/src/main.tsx:23-24`,
`src/frontend/src/api-core.ts:45-47`) and serves the same frontend at root and each
box prefix (`src/webapp/server.ts:100-106`, `src/webapp/server-box-scope.ts:176-183`).
A `PushSubscription` is unique to the SW registration, not to a box; MDN also calls
the endpoint a capability URL. So the same browser endpoint will be duplicated across
box files, 404/410 pruning in one box will not prune the others, and
`pushsubscriptionchange` cannot know which per-box subscribe endpoints to re-post to.
Minimal fix: make subscription storage server-level keyed by endpoint, with box
opt-ins, or have the SW persist and refresh the full enabled-box list.
→ **ADOPTED.** Subscriptions are now server-level, endpoint-keyed, with a `boxes[]`
opt-in set (Track B). Prune removes the endpoint once; `pushsubscriptionchange`
re-posts the one endpoint.

**2. High: the dispatcher bypasses the repo's durable outbound model.**
The plan says the existing model is "write an output card → connector delivers it"
but then rejects a push/notification card and calls `sendPush` directly. The
code/docs make card durability load-bearing: `box/output/` is "Outbound cards staged
for delivery (push notifications, replies)" (`docs/box-layout.md:57`), Telegram cards
are committed, deleted on success, or stamped failed
(`src/schemas/telegram-message.ts:31-44`; `src/connectors/telegram-output-cards.ts:56-68`),
and `cb finalize` runs outbound connectors (`src/cli/commands/finalize.ts:18-32`).
Direct push has no committed intent, no replay, no failed card, and no `cb finalize`
path. Either add a `.web-push.card` connector or explicitly scope v1 as a direct
alert service, not reuse of the outbound model.
→ **ADOPTED** (boxholder chose the durable card). New `web-push` card + push
connector flushed by `cb finalize` (Track C).

**3. High: push-only health alerts can be silently lost after the latch.**
Current health alerts latch tasks after writing the Telegram card, and a Telegram
delivery failure leaves an inspectable failed card
(`src/core/schedule-health-alert.ts:80-97`, `src/connectors/telegram-output-cards.ts:60-68`).
The plan's `sendPush` keeps transient failures, logs/counts them, and moves on. In a
push-only box, a transient 429/5xx can produce no user-visible artifact and still
suppress that unhealthy episode if `checkHealthAndAlert` is rewired as planned. Do
not latch on push failure unless there is a durable failed artifact or retry path.
→ **RESOLVED by #2's card model.** A failed push leaves a `failed` `web-push` card
in `box/output/` — a durable artifact — so latching is safe.

**4. Medium-high: "question needs an answer" is not a cheap existing trigger. Cut it from v1.**
The plan includes new-question pushes if a clean hook exists, but current producers
are scattered. UI emits `question-answered` and generic `card-created`, not "question
became pending" (`src/webapp/trpc/routers/actions.ts:42-47`, `:82-86`). Triage writes
questions directly to `box/questions/` (`src/core/triage-routing.ts:140-155`). Scan
import writes question cards under attach scopes
(`src/core/commands/scan-import-cards.ts:90-99`, `:128-137`, `:154-163`), while the
web status only scans `box/questions/` (`src/core/state.ts:128-132`). Minimal version:
health-alerts only; later add a central `createQuestion` API/event if question pushes
matter.
→ **DISSOLVED.** Boxholder kept question pushes but via a finalize-time sweep of
`box/questions/` (reusing the data `getSystemState` already scans), latched per
question — no per-producer hook and no central createQuestion event (Track D).

**5. Medium: "validation catches it" is overstated for push policy.**
Actual `loadBoxConfig` just `JSON.parse`s and returns the object; there is no Zod
validation or enum enforcement for `config/box.json` (`src/webapp/box-config.ts:94-103`).
Zod on the subscribe mutation will validate subscriptions, not push policy.
→ **ADOPTED.** No push policy lives in box.json (subscribing is the opt-in); the
edge-cases section now states `loadBoxConfig` is unvalidated and the `web-push`
card's enums are schema-validated instead.

**6. Medium: `/home/callback/.env` is loaded by both units, but "CB_DIAG_API_KEY already lives there" is not proven.**
The units do load `EnvironmentFile=$CB_HOME/.env` (`deploy/setup-server.sh:143-155`,
`:169-181`), but setup only creates placeholders for `PUBLIC_URL`, `PATH`, and
optional API keys, not `CB_DIAG_API_KEY` (`deploy/setup-server.sh:110-126`).
`deploy.sh:203` merely reads the key if present. The VAPID ops step must explicitly
write keys and restart both services.
→ **ADOPTED.** Reworded to "loaded by both units, but the keys are a new explicit
ops step (write + restart serve & scheduler)".

**7. Incorrect or unverifiable citations.**
`manifest.webmanifest:3` is `short_name`; `start_url` is line 4. The "web-push
actively maintained 2025" claim is not established by the repo (metadata says version
3.6.7). The iOS Home-Screen-only claim is WebKit-supported, but "silent disappearance
on iOS 18" and "unsubscribe trap" rely on secondary blogs, not the cited repo/code.
→ **ADOPTED.** Fixed the line number; downgraded the maintenance + iOS-blog claims to
"confirm at implementation / device-test time".

External checks codex used: MDN Push API, WebKit iOS Web Push post, web-push package metadata.

**Single most important change (codex):** decide subscription ownership first — make
Web Push subscriptions server-level endpoint records with per-box opt-ins, then choose
whether push delivery is a real `box/output` connector or an explicitly direct alert
path.
→ Both decided: server-level endpoint store (#1) + durable `box/output` connector (#2).
