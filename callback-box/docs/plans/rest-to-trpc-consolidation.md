# REST → tRPC route consolidation

Retire the duplicated raw Fastify routes in `src/webapp/routes/` in favour of
their tRPC equivalents, so each endpoint has one implementation. The end state:
raw Fastify is used **only** for non-JSON bytes (file/image/audio upload &
download, byte streaming) and callers that aren't our tRPC client (the Telegram
webhook, the OAuth redirect flow). Everything else — including the chat
control-plane and the clerk extension API — moves to tRPC. Surfaced by the slopo
duplication pass (see `docs/implemented-plans/slopo-codehealth-adoption.md`), which
flagged the `webapp/routes/*` ⇄ `webapp/trpc/routers/*` parallel implementations.

## Stated preferences this plan trades against

- **`callback-box/CLAUDE.md`** — the canonical-side decision is already made:
  *"HTTP endpoints go in tRPC by default … Raw Fastify routes in
  `src/webapp/routes/` are only for things that don't fit the tRPC
  request/response shape: file upload/download, OAuth redirects, webhooks, and
  the `/chat/send` POST … Older raw routes are tech debt — migrate when you
  touch the area."* This plan is that migration; tRPC wins every JSON endpoint.
- **`callback-box/CODE-STYLE.md`** — Zod-validated inputs, `only export what's
  used` (deleting raw handlers must delete their now-unused helpers/exports too).
- **Fail-closed / strict bias** (the boxholder's standing preference) — the
  owner-auth parity gate below is non-negotiable: a migration that drops an
  owner check is worse than the duplication it removes.
- The slopo plan's **consolidation posture** — combine and push upstream; a wide
  diff (frontend callers + callback-clerk) is accepted cost.

## What already exists

The decisive fact: **most migrate-set endpoints already have a working tRPC
procedure** — the raw routes are the stale half of a parallel pair, and the
frontend is already ~⅔ migrated. Verified procedure inventories:

- `trpc/routers/status.ts` — `status inbox questions context activity browse`
  (covers raw `routes/api.ts`: `/api/status /api/inbox /api/questions
  /api/context`; `/api/health` is `trpc/routers/health.ts` `check`).
- `trpc/routers/admin.ts:22-236` — `telegramStatus telegramSetup
  telegramDisconnect boxConfig gmailConfig updateGmailConfig updateBoxConfig
  claudeStatus claudeLogin claudeLogout` (covers most of raw `routes/admin.ts`).
- `trpc/routers/commands.ts` — `list get executeSync` (covers raw
  `/api/commands/list`; raw `/api/upload` is a file upload → stays).
- `trpc/routers/calendar.ts:16-66` — `available config updateConfig` (covers raw
  `routes/calendar.ts` fully).
- `trpc/routers/debugLog.ts` — `get submit clear` (covers raw
  `routes/api-debug-log.ts` `GET`/`DELETE /api/debug-log`).
- `trpc/routers/history.ts` — `list facets diff sessionLog` (covers raw
  `routes/history.ts` JSON; `/history/blob/*` binary download stays).
- `trpc/routers/scheduler-schedules.ts` / frontend `trpc.scheduler.schedules` —
  covers raw `/api/schedules`.
- `trpc/routers/actions.ts` — `answer create` (covers the JSON actions in
  `routes/actions.ts`; `/api/actions/create-voice-memo` is audio bytes → stays).
- `trpc/routers/views.ts` — `resolveRef` (does **not** obviously cover raw
  `GET /api/views` *list* — verify in Track 2).

**Gaps — no tRPC twin exists yet** (Track 2 adds them):
- The chat control-plane in `routes/chat.ts` / `chat-*-routes.ts`, called from
  the frontend `api-chat.ts`: `/chat/status /chat/default /chat/set-model
  /chat/features /chat/set-feature /chat/sessions /chat/interrupt /chat/restart
  /chat/schedules /chat/schedules/cancel /chat/voice-config`. All JSON control
  calls, no streaming/bytes — belong in a `trpc/routers/chat.ts` expansion.
- The Google-services admin endpoints `/api/admin/google-status /google-setup
  /google-disconnect` (`useGoogleServices.ts:45,91,113`) don't map 1:1 to the
  `gmailConfig`/`updateGmailConfig` procedures — reconcile in Track 2.
- `routes/clerk.ts` (`/api/clerk/commentary-destinations`, `/api/clerk/commentary`,
  `/api/clerk/actions`, dismiss) has **no** `trpc.clerk` twin — Track 3 adds one.

**Frontend raw-fetch call sites to repoint** (exhaustive, via `getApiBase()`):
`components/admin/*` (`AllowedEmailsSection.tsx:21,49`, `TelegramSection.tsx:24,52,75`,
`useGoogleServices.ts:45,91,113,133`), `components/DebugLog.tsx:35`,
`api.ts:78` (`/actions/create-voice-memo` — stays raw), `api-chat.ts:*` (chat
control-plane), `CommitDetail-tabs.tsx:23` (`/history/blob` — stays).
**callback-clerk** callers: `../callback-clerk/src/platform/clerk-api.ts:63,72`.

**Auth guard that must be preserved:** `routes/admin.ts:58-71,158` wraps admin
routes in an `addOwnerCheck` `preHandler`. The tRPC admin procedures are
`publicProcedure` (`trpc/routers/admin.ts:6,22,...`) and `trpc.ts:7` defines
**only** `publicProcedure` — there is no owner/authed procedure builder yet.

## Prior art (external)

- **tRPC Fastify adapter + CORS** — the earlier claim that "cross-origin needs
  raw" is wrong; `@fastify/cors` (or per-route headers) applies to the tRPC
  mount like any HTTP handler. No search turned up a tRPC limitation here; the
  clerk extension can call a tRPC endpoint (typed client or plain HTTP POST to
  `/trpc/clerk.x`). Confirmed against our own usage — the tRPC HTTP+WS split
  already runs cross-origin-capable via `wsLink`/`splitLink` (`CLAUDE.md`).
- **SSE is already fully retired here** (verified, not assumed): 0
  `text/event-stream` handlers; `trpc/routers/events.ts:9,54` says the SSE route
  *"used to do this"* — it's a WS subscription now; `useBusSubscription.ts:4-5`
  replaced `useSSE`. So "convert streaming to WS" is a no-op; only stale naming
  remains (Track 4). No external prior art needed — internal migration.
- No other external dependencies in play.

## Tracks / scope

Ordered by dependency: Track 0 unblocks safe deletion of owner-gated routes;
Track 1 is the cheap already-have-a-twin dedup; Track 2/3 add missing
procedures; Track 4 is a naming rider.

### Track 0 — owner/authed procedure builders (security prerequisite)

**What.** Add `authedProcedure` and `ownerProcedure` to `trpc.ts` (middleware
asserting a logged-in user / the box owner from `ctx`), and apply
`ownerProcedure` to every admin mutation/query that the raw side gated with
`addOwnerCheck`. Audit *all* existing routers for procedures that should have
been protected and silently weren't.

**Why this needs to change.** `trpc/routers/admin.ts` exposes `telegramSetup`,
`telegramDisconnect`, `updateBoxConfig`, `claudeLogin`, etc. as
`publicProcedure`, while the raw equivalents require the box owner
(`routes/admin.ts:58`). This is already a latent fail-open gap, and Track 1
would widen it by pointing the frontend at the unprotected procedures. Fixing
auth parity is the gate for the whole plan.

**Direction.** In `trpc.ts`, define middleware that reads the authenticated user
from `ctx` (the box-scope auth hook, `server-box-scope.ts:49-67`, already
populates request auth) and the owner from box config, throwing `TRPCError`
`UNAUTHORIZED`/`FORBIDDEN` otherwise. Re-export `ownerProcedure`. Convert admin
(and any other owner-only) procedures. This mirrors `addOwnerCheck` exactly —
same allow/deny, same owner source — so behaviour is preserved, only the
enforcement point moves.

**First implementation chunk.** Add the two procedure builders + a doctest
proving `ownerProcedure` rejects a non-owner ctx and admits the owner; convert
the admin router; leave the raw `addOwnerCheck` routes in place (both enforce
until Track 1 deletes the raw side). No open questions inside.

### Track 1 — dedup endpoints whose tRPC twin already exists

**What.** Repoint the frontend raw-fetch stragglers to the existing procedures,
then delete the now-dead raw handlers: `routes/api.ts` (status/inbox/questions/
context), `routes/calendar.ts`, `routes/commands.ts` (`list` only — keep
`/api/upload`), `routes/api-debug-log.ts`, the JSON half of `routes/admin.ts`
(telegram/claude/box-config — google-services deferred to Track 2), and confirm
`routes/history.ts` JSON is already unused (blob stays).

**Why this needs to change.** These are true duplicates — two implementations,
already drifted (e.g. the telegram-disconnect ENOENT handling and `baseServerUrl`
normalisation slopo flagged). Deleting the raw side makes the tRPC version the
single source and resolves the drift by removal.

**Direction.** Per endpoint: (1) confirm the tRPC twin is behaviourally complete
(same return shape, same error handling — read both) and owner-protected if the
raw side was; (2) switch the frontend call from `fetch(getApiBase()+...)` to the
tRPC client; (3) delete the raw handler + its now-unused imports/helpers; (4)
if a route file's endpoints are *all* migrated, drop its `register*Routes` call
in `server-box-scope.ts` and the file.

**First implementation chunk.** The admin JSON endpoints (highest drift + the
Track 0 auth work lands here): repoint `TelegramSection.tsx`,
`AllowedEmailsSection.tsx`, `useGoogleServices.ts` (box-config parts), delete the
corresponding `routes/admin.ts` handlers, keep `addOwnerCheck` only for whatever
raw admin endpoints remain (google-services until Track 2).

### Track 2 — migrate JSON endpoints that lack a twin (add procedures)

**What.** Add tRPC procedures for the chat control-plane
(`status/default/set-model/features/set-feature/sessions/interrupt/restart/
schedules/schedules-cancel/voice-config`), the Google-services admin trio, and
`/api/views` list (if used); repoint `api-chat.ts` + `useGoogleServices.ts` +
any `/api/views` caller; delete the raw handlers.

**Why this needs to change.** These are JSON control calls currently only on raw
routes — the remaining tech debt after the easy dedup. They fit the tRPC
request/response shape (no bytes/streaming), so per `CLAUDE.md` they belong there.

**Direction.** Expand `trpc/routers/chat.ts` with the control-plane procedures
(mutations for set-model/interrupt/restart/set-feature; queries for
status/features/default/voice-config/schedules). Reconcile google-services into
admin (`googleStatus`/`googleSetup`/`googleDisconnect` or fold into the gmail
procedures — decide in the chunk). Verify `/api/views` list has a caller before
adding a `views.list` procedure; if dead, delete instead.

**First implementation chunk.** The chat read procedures (status/features/
default/voice-config) — pure queries, lowest risk — plus repointing their
`api-chat.ts` callers; leave the raw handlers until the mutation procedures land
in the next chunk.

### Track 3 — clerk extension API → tRPC

**What.** Add a `trpc/routers/clerk.ts` (`commentaryDestinations`, `commentary`,
`actions`, `dismiss`), update `callback-clerk` (`clerk-api.ts:63,72`) to call it,
delete `routes/clerk.ts`.

**Why this needs to change.** clerk's handlers are plain JSON
(`routes/clerk.ts:58,125,131,137`); CORS is not a reason to stay raw, and
callback-clerk is our code. Consolidating removes the last non-binary raw JSON
surface.

**Direction.** Mirror the clerk handlers as tRPC procedures behind an
appropriately-scoped procedure (commentary write may want `authedProcedure`).
Update the extension's `clerk-api.ts` to the tRPC client (or plain HTTP POST to
`/trpc/clerk.commentary` with the existing CORS headers). Because the extension
ships on its own cadence, **keep `routes/clerk.ts` mounted until the updated
extension is released** (see failure modes) — this is the one track with a real
transition window.

**First implementation chunk.** Add the clerk tRPC router + a doctest; do **not**
delete the raw route yet.

### Track 4 — stale SSE naming cleanup (rider)

**What.** Rename `components/chat/InteractiveChat-sse.ts` → `-ws.ts` (it uses
`useBusSubscription` over WS), purge "SSE"/"via SSE" comments in
`routes/chat-send-routes.ts:4`, `server.ts:177`, `server-box-scope.ts:49,67,93,153`,
and remove the `ssr/setup.ts` EventSource polyfill if nothing constructs an
`EventSource` after Track 2. Pure naming/comment hygiene — no behaviour change.

**Why this needs to change.** The comments claim a design (SSE) the code no
longer uses, which misleads readers mid-migration.

**First implementation chunk.** The rename + comment purge; gate the polyfill
removal on a grep proving no live `new EventSource`.

## Subplans

None. Each track is a cohesive chunked unit; none has an unsettled sub-question
needing its own design step (the one real decision — google-services procedure
shape — is small enough to settle inside Track 2's first chunk).

## Failure modes

**Critical gap (resolved by ordering):** owner-auth fail-open — pointing the
frontend at `publicProcedure` admin operations, or deleting the `addOwnerCheck`
raw routes, before Track 0 lands would expose owner-only mutations to any
caller. Resolution: Track 0 is a hard prerequisite for Track 1's admin deletes.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| tRPC admin procedure stays `publicProcedure` after raw owner-route deleted | Track 0 doctest asserts `ownerProcedure` rejects non-owner | `ownerProcedure` gate | Would be **silent** (unauthorized success) — the doctest + "audit all routers" step is the guard |
| Raw handler deleted but its tRPC twin lacks a behaviour the raw one had (the drift: ENOENT swallow, trailing-slash normalisation) | Per-endpoint: read both, add a doctest for the reconciled behaviour | Reconcile before delete | Silent (wrong response shape) — mitigated by read-both-then-delete |
| A frontend caller of a deleted raw route is missed | grep `getApiBase\(\)` after each track; typecheck catches tRPC client typos | 404 at runtime | **Clear** — 404, not silent |
| Old callback-clerk build hits `/api/clerk/*` after the raw route is deleted | manual: extension release gates the delete | keep raw clerk mounted through the transition window | Clear (extension breaks visibly) — avoided by not deleting until the extension ships |
| `/api/views` list has a caller we didn't find, deleted as "dead" | grep before delete | add `views.list` instead of deleting | Clear (404) |
| Chat control-plane procedure changes a return shape the frontend depends on (Hyrum) | doctest the reconciled shape | read the raw handler + frontend consumer before writing the procedure | Silent — read-both discipline |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — **N/A** (no card schema/tag work).
- **Stale ref** — **N/A** (no card refs).
- **Two agents touching the same card** — **N/A**.
- **Hand-edit drift** — **N/A**.
- **Fabricated free-form value** — **N/A**.
- **Validation error UX** — **ADDRESSED**: tRPC inputs get Zod schemas
  (`CODE-STYLE`), so migrated endpoints gain typed input validation the raw
  handlers often lacked; error messages surface through the tRPC client.
- **Partial migration / transition state** — **ADDRESSED**: during the rollout
  window both implementations coexist per endpoint (repoint frontend → then
  delete raw), so no endpoint is ever unbacked. The only cross-repo transition
  is clerk (Track 3), explicitly gated on the extension release.

## NOT in scope

- **Anything binary or foreign stays raw** — file/image serving
  (`routes/api-files*`, `api-image`, `proxy-image`, `figure`, `views/*/module.js`),
  uploads (`/api/upload`, `capture`, `chat-uploads`, `/actions/create-voice-memo`,
  `/chat/transcribe-audio`), binary download (`/history/blob/*`), scheduler file/
  log streaming, the Telegram webhook, and the OAuth redirect flow (`routes/auth.ts`).
  These fit no tRPC request/response shape.
- **`/chat/send`** — the response already streams over the WS event bus; the POST
  *could* become a tRPC mutation, but it's load-bearing (session registry + the
  request user + the retry/idempotency logic in `chat-send-routes.ts`) and
  `CLAUDE.md` explicitly carves it out. Deferred — revisit only if the rest lands
  cleanly and there's appetite.
- **Rewriting the frontend data layer** (e.g. moving `api-chat.ts` wholesale to a
  hook library) — this plan repoints call sites, it doesn't restructure them.

## Open design questions

- **Google-services admin procedure shape** — three new procedures
  (`googleStatus`/`googleSetup`/`googleDisconnect`) or fold into the existing
  `gmailConfig`/`updateGmailConfig`? Lean: separate procedures mirroring the raw
  endpoints (smallest behaviour delta). Settle in Track 2 chunk 1.
- **clerk transition mechanism** — dual-mount (raw + tRPC) until the extension
  ships, or a single cut coordinated with an extension release? Lean: dual-mount,
  delete raw in a follow-up once the extension is out. Boxholder's call on cadence.
- **Is `/api/views` list still used?** — determines migrate-vs-delete. Resolve by
  grep in Track 2.

## Knowledge audits

**Skip-with-rationale.** This is infrastructure (transport layer), not an
agent-facing convention. No box agent calls these endpoints; the "tRPC by
default" rule already lives in `CLAUDE.md` and needs no new audit. If Track 0's
`ownerProcedure` becomes a pattern contributors must remember, a one-line
`CLAUDE.md` note is the right home — not a knowledge-audit entry.

## Implementation order

1. **Track 0** — `authedProcedure`/`ownerProcedure` + admin conversion + doctest.
   (Prerequisite for any admin delete.)
2. **Track 1** — dedup the twin-backed endpoints, admin JSON first (rides Track
   0), then status/calendar/commands/debug-log/history; delete raw handlers +
   dead route registrations.
3. **Track 2** — add chat control-plane + google-services + views procedures;
   repoint; delete raw.
4. **Track 3** — clerk tRPC router + callback-clerk update; keep raw clerk
   mounted pending the extension release.
5. **Track 4** — SSE naming/comment cleanup; polyfill removal gated on a grep.

Tracks 1–4 each land as their own commits; the plan completes when 0–4 are in
(Track 3's raw-clerk delete may trail as a follow-up tied to the extension).

## Rollout shape

- **Test posture** (`docs/testing.md` — tests as design tool, not coverage): a
  doctest for `ownerProcedure` (the security gate); a doctest per *reconciled*
  behaviour where the raw and tRPC sides had drifted (admin telegram-disconnect
  ENOENT, `baseServerUrl` normalisation) asserting the surviving contract; new
  tRPC procedures (chat control-plane, clerk) get route-doctests via
  `makeTestServer()`. No test for pure call-site repoints where the procedure
  already had coverage.
- **Knowledge-audit entries** — none (see above).
- **Migration approach** — no stored-data migration; this is transport-layer
  only. The sole cross-boundary transition is callback-clerk (Track 3), handled
  by dual-mounting the clerk route until the updated extension ships.
- **Ship as one unit** — Tracks 0–2 (+4) land together on a worktree branch and
  merge on the boxholder's signal; Track 3's raw-clerk deletion is the one piece
  allowed to trail, gated on the extension release.
