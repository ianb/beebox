# User Location (`cb location get`)

> **Status: implemented (2026-06-29).** Frozen design record. The code lives in
> `src/core/location-store.ts`, `src/core/location-format.ts`,
> `src/cli/commands/location.ts`, `src/webapp/trpc/routers/location.ts`,
> `src/frontend/src/lib/location-share.ts`, `src/frontend/src/hooks/useLocationShare.ts`,
> and `src/frontend/src/components/chat/ShareLocationMenuItem.tsx`; the agent
> guide section is `src/core/agent-guide/location.ts`. Codex-reviewed at both
> plan and diff stages. The frontend browser-permission flow is pending manual
> verification in a real browser.

Let the web frontend capture the boxholder's geographic location (with
explicit consent) and expose it to the box agent on demand via a new
`cb location get` command. Location is fundamentally different from the
existing ambient context (channel, local-time, calendar): it cannot be
derived passively from the request — it requires the browser
Geolocation API and an explicit user permission grant. This plan
designs the acquisition flow, the privacy model, the storage shape, and
the CLI surface as one unit.

## Settled decisions (from design discussion)

These four were settled with the boxholder before this plan was written;
they are direction, not open questions:

1. **Acquisition = opt-in ambient capture** (web only). A toggle prompts
   once; the frontend POSTs coords; the backend caches them; the CLI
   reads last-known. Not an on-demand round-trip.
2. **On-demand only** — location never rides the always-on per-turn
   snapshot. The agent reads it via `cb location get` when relevant.
3. **Coords only** — store/return `lat,lng` + accuracy. No
   reverse-geocoding in v1 (no service exists; it would add a
   third-party dependency that receives the coords).
4. **`get` only** — no `clear`, no `set`. `clear` is privacy theatre
   (the next capture rewrites it); real consent control is the
   permission grant + toggle. `get` reports `unknown` when absent and
   age + a `stale` flag when present.

## Stated preferences this plan trades against

- `callback-box/CLAUDE.md:101` — *"Read before writing. Don't guess
  file formats... This project has specific conventions that differ
  from defaults."* This plan reuses existing state-file, route, and
  guide patterns rather than inventing new ones.
- `callback-box/CLAUDE.md` (Behavioral Notes) — *"HTTP endpoints go in
  tRPC by default... Raw Fastify routes ... are only for things that
  don't fit the tRPC request/response shape: file upload/download,
  OAuth redirects, webhooks, and the `/chat/send` POST (it needs the
  request's user + the session registry)."* Location capture is a plain
  box-state write that needs neither the session registry nor (in v1)
  the request user, so it goes in **tRPC** — the default. (An earlier
  draft proposed a raw route citing a `getSessionUser` need; that need
  doesn't exist in v1 — see What already exists.)
- `callback-box/CLAUDE.md` (Behavioral Notes) — *"Keep source and docs
  generic — never hardcode personal names ... Refer to 'the user' or
  'the boxholder'."* All prose/guide text stays generic.
- `callback-box/CLAUDE.md` (Cards) — the don't-build-beyond-the-task
  rule. v1 is coords + get only; geocoding, history, and per-user keying
  are explicitly out of scope.
- `callback-box/code-style.md` — no default parameters, max 2 positional
  params (named object beyond that), no `any`, no bare `catch {}`,
  custom error classes, files < 300 lines.
- `callback-box/frontend.md` — UI primitives + the `className`-only-for-
  outer-layout rule (`restrict-component-classes`). The toggle reuses
  the `Toggle` primitive.
- Privacy as a first-class design constraint (this plan's own framing):
  coordinates are sensitive PII; the box git history is permanent.

## What already exists

- **Gitignored box state dir.** `cb init` generates the box `.gitignore`
  with `.callback-box/` (the whole directory) — `src/core/box.ts:135`
  (*"`.callback-box/`"* under *"Generated agent docs"*); also documented
  at `docs/box-layout.md:18-22`. State files there are never committed.
  **Reuse** — `location.json` lives here; no gitignore edit needed.
- **Box-state read/write pattern.** `src/webapp/routes/chat-send-routes.ts:148`
  (`dedupStatePath` → `path.join(boxRoot, ".callback-box", "message-dedup.json")`,
  written with `fs.mkdirSync({recursive:true})` + `fs.writeFileSync(JSON.stringify(...))`,
  read with try/catch on ENOENT) — this is the JSON-state precedent to
  follow. (`src/webapp/routes/api-debug-log.ts:35` is a *rolling log*
  with append/truncate that swallows file errors, not a JSON
  read/modify/write — not the right model here.) **Reuse** the
  `message-dedup.json` pattern for `location.json`. The
  transient-connector helper `src/connectors/transient-state.ts:32`
  (`loadTransientState`/`saveTransientState`) is an even closer fit
  (generic load-with-default + save), but it hardwires the path to
  `config/connectors/<name>.state.json`, not `.callback-box/`. **Rebuild
  minimally** — a tiny `location-store.ts` with explicit
  `.callback-box/location.json` path; do not retrofit transient-state.ts
  (its path convention is connector-specific).
- **Channel classification.** `src/webapp/routes/chat-send-routes.ts:237`
  `classifyChannel(request.headers["user-agent"])`. The backend already
  distinguishes web from other channels. **Reuse** the concept: location
  capture only happens on the web frontend, so no channel gating is
  needed on the write side (only web posts), and `cb location get`
  reports `unknown` everywhere until a web capture lands.
- **tRPC context.** `src/webapp/trpc/context.ts:4-8` exposes `boxRoot`,
  `boxSlug`, `eventBus`, `services` — but **not** the request user. v1
  stores one fix per box and never keys by user, so this is sufficient;
  the capture mutation reads `ctx.boxRoot` and writes the store. (If
  per-user keying is ever needed, `src/webapp/auth.ts:157`
  `getSessionUser(request)` would be threaded into the tRPC context
  then — not a reason to use a raw route now. See NOT in scope.)
- **tRPC mutation precedent.** `src/webapp/trpc/routers/debugLog.ts:12`
  (`publicProcedure.input(z.object({...})).mutation(async ({ input }) => {...})`,
  returning `{ ok: true }`), registered in `src/webapp/trpc/router.ts:28`.
  **Reuse** this shape for `location.capture`.
- **Frontend tRPC client.** `src/frontend/src/lib/trpc.ts` exposes the
  per-box client; **reuse** via `trpc.location.capture.mutate(...)`. The
  capture is decoupled from the chat send (not piggybacked on the send
  body), so toggle-enable can capture immediately, before any chat.
- **Toggle primitive.** `src/frontend/src/components/ui/Toggle.tsx`
  exists. **Reuse** for the "Share location" control.
- **localStorage persistence precedent.** `src/frontend/src/lib/composer-draft.ts`
  + `src/frontend/src/hooks/useComposerDraft.ts`. **Reuse** the pattern
  to persist the toggle's opt-in state per box.
- **Agent guide composition.** `src/core/agent-guide/index.ts:64`
  statically concatenates section functions into the always-loaded
  `.callback-box/agent-guide.md`. Sections are **not** gated on box
  state — they're generated by `cb init`/reactor. **Reuse** by adding a
  small `locationSection()` to the array; it is always present and
  states that `cb location get` returns `unknown` until the boxholder
  shares location from the web UI. (The earlier idea of gating the
  section on the state file's existence does not fit this architecture —
  the guide is generated, not evaluated per request.)
- **CLI command shape + registration.** `src/cli/commands/health.ts`
  (single command, `--json`, `--box`, `requireBoxRoot`, `getBoxTime`),
  `src/cli/commands/drive.ts:55` (subcommands), `src/cli/commands/index.ts`
  (export registry). **Reuse** — `locationCommand` with a `get`
  subcommand, exported from `index.ts`.

## Prior art (external)

- **Geolocation requires a secure context; localhost is exempt.**
  Chrome removed Geolocation from insecure origins in Chrome 50; the API
  is HTTPS-only except `localhost`, which browsers treat as secure for
  development. Source:
  https://developer.chrome.com/blog/geolocation-on-secure-contexts-only
  and https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API .
  **Implication:** the dev router serves on `http://localhost:3210/<wt>/...`
  — still a `localhost` origin, so geolocation works in dev through the
  proxy. Prod is `https://box.example.com`, also secure. No HTTPS work
  needed; **verify in dev as part of rollout** (router proxy path is the
  one untested wrinkle).
- **Permissions-Policy can block geolocation even on a secure origin.**
  Same MDN page notes the feature "may be blocked by the geolocation
  Permissions-Policy." We control the app and set no restrictive policy,
  so this is not expected to bite — noted so a future CSP/Permissions-
  Policy addition doesn't silently break capture.
- **No prior art inside the project** — geolocation is greenfield here.
  A grep for `geocod|nominatim|reverseGeocode|maps.googleapis` over
  `src/` returns nothing; `refresh-maps` is unrelated (MAP.md doc
  generation). This confirms reverse-geocoding would be net-new.

## Tracks / scope

Ordered by implementation dependency: storage → CLI → route → frontend →
guide. Each track's first chunk has no open questions inside it.

### Track 1 — Location store (backend state module)

- **What:** A small module that reads/writes `.callback-box/location.json`.
- **Why this needs to change:** Nothing persists geolocation today; the
  CLI and the route both need one canonical reader/writer so the on-disk
  shape is defined in exactly one place.
- **Direction:** New file `src/core/location-store.ts`:
  ```typescript
  export interface StoredLocation {
    lat: number;
    lng: number;
    accuracy: number;        // meters, from GeolocationCoordinates.accuracy
    capturedAt: string;      // ISO 8601 UTC
    source: "web";           // only source in v1; field reserved for future
  }
  // path: <boxRoot>/.callback-box/location.json
  export function locationStatePath(boxRoot: string): string;
  export async function loadLocation(boxRoot: string): Promise<StoredLocation | null>; // null on ENOENT
  export async function saveLocation(boxRoot: string, location: StoredLocation): Promise<void>;
  ```
  Read degrades on ENOENT to `null` and logs (not silently) on any other
  read/parse error (CODE-STYLE: never silently ignore errors). Validates
  the **full** parsed shape — `lat`/`lng`/`accuracy` finite + plausible
  ranges, `capturedAt` a parseable ISO date, `source === "web"` — and
  treats any malformed content as `null` with a `console.warn`. Notably
  an unparseable `capturedAt` must be rejected here: an invalid date
  would otherwise feed `NaN` into `describeElapsed`
  (`src/core/session-context.ts:116`) and render nonsense like
  "NaN weeks ago". A corrupt file must not crash `cb location get` or
  the agent's turn.
- **Vocabulary lock-ins:** field names `lat`, `lng`, `accuracy`,
  `capturedAt`, `source`. File name `location.json`. These are committed
  across CLI, route, and any future reader.
- **First implementation chunk:** `location-store.ts` + a pure-function
  doctest (`test/location-store.doctest.md`, `makeTmpBox()` tier)
  covering: absent file → `null`; round-trip save/load; malformed JSON →
  `null` + warning; **unparseable `capturedAt` → `null`** (the NaN-age
  guard); `source` other than `"web"` → `null`.

### Track 2 — `cb location get` CLI

- **What:** New `cb location` command with a single `get` subcommand.
- **Why this needs to change:** This is the agent's read interface and
  the whole point of the feature.
- **Direction:** New file `src/cli/commands/location.ts`, exported from
  `src/cli/commands/index.ts`, registered in the main CLI alongside the
  others.
  - `cb location get` — human line. Present:
    `45.5231,-122.6765 (±20m, captured 4 minutes ago, web)`. The age
    uses the existing `describeElapsed` from `src/core/session-context.ts`
    (reuse — already produces "4 minutes", "2 hours" strings). Absent:
    prints `unknown` to stdout, exit 0 (absence is not an error).
  - `--json` → the `StoredLocation` object plus computed
    `{ ageMs, stale }`, or `{ "status": "unknown" }` when absent.
  - **Staleness:** define `LOCATION_STALE_MS` (lean: 1 hour). Past it,
    the human line appends ` [stale]` and JSON sets `stale: true`. Still
    reported — the agent judges relevance; we never withhold a known fix.
  - `--box <path>` like every other command (`requireBoxRoot` default).
  - **Never logs raw coords** beyond the intended stdout output (no
    debug logging of lat/lng).
- **First implementation chunk:** `location.ts` + the index export +
  a route/CLI-tier doctest is deferred to Track 5's combined doctest
  (the CLI's interesting behavior — fresh/stale/absent formatting — is
  pure given a `StoredLocation`, so a `location.ts` formatter helper gets
  its own pure doctest here).

### Track 3 — Capture mutation (`location.capture`)

- **What:** A tRPC mutation that accepts `{ lat, lng, accuracy }` and
  writes via the Track-1 store.
- **Why this needs to change:** The browser needs an endpoint to push
  coords to; only the backend can write into the box.
- **Direction:** Add a `location` tRPC router
  (`src/webapp/trpc/routers/location.ts`) with a `capture` mutation,
  registered in `src/webapp/trpc/router.ts` (alongside `debugLog`,
  `todos`, etc.). Shape follows `debugLog.ts:12`:
  ```typescript
  capture: publicProcedure
    .input(z.object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      accuracy: z.number().finite().nonnegative(),
    }))
    .mutation(async ({ input, ctx }) => {
      await saveLocation(ctx.boxRoot, {
        ...input,
        capturedAt: new Date().toISOString(),
        source: "web",
      });
      return { ok: true };
    });
  ```
  - **Why tRPC, not a raw route:** it's a plain box-state write needing
    only `ctx.boxRoot` (`trpc/context.ts:4`) — not the session registry,
    and not the request user (v1 stores one fix per box). This is the
    CLAUDE.md default; the raw-route carve-out doesn't apply. (An earlier
    draft proposed a raw `POST /api/location` citing a `getSessionUser`
    need — that need does not exist in v1.)
  - Zod rejects out-of-range/non-finite input; tRPC returns the error to
    the client. **No coords logged** on rejection or success — any
    diagnostic logs accuracy/age, never the coordinate.
  - Response is the settled `{ ok: true }` (no `204`/JSON ambiguity).
  - Frontend calls `trpc.location.capture.mutate({...})` — no `fetchJson`
    involved, so the `api-core.ts:107` "success must be JSON" gotcha
    can't bite.
- **First implementation chunk:** `location.ts` router + `router.ts`
  registration + a route-tier doctest (`makeTestServer()`) covering valid
  capture → stored + readable, and out-of-range input → rejected +
  nothing written.

### Track 4 — Frontend "Share location" affordance

- **What:** A toggle that requests geolocation permission and sends
  captures via `location.capture`.
- **Why this needs to change:** This is the consent surface and the only
  source of captures.
- **Direction:**
  - A **labelled control**, not a bare `Toggle`. Note `Toggle.tsx:34`
    uses `label` only as `aria-label`/`title` — it renders no visible
    text — so the affordance is a visible label/text + the `Toggle`
    switch beside it (a small "Share location" row), or a labelled item
    inside the composer's existing Add menu. Exact form finalized with
    the **cb-frontend** skill; the component owns its own label and
    error text (no wrapping landmark — boxholder's standing a11y rule).
    Web-chat-scoped placement, where location is meaningful.
  - Opt-in state persists in `localStorage` per box, following the
    `composer-draft` precedent (`lib/composer-draft.ts` +
    `hooks/useComposerDraft.ts`). A new `lib/location-share.ts` +
    `hooks/useLocationShare.ts`.
  - **Enable flow:** toggling on calls `navigator.geolocation.getCurrentPosition`
    on that user gesture (the permission prompt), with **explicit
    options** — a finite `timeout` (~10s; the browser default is
    `Infinity`, which would leave the enable flow pending forever),
    `maximumAge` (~60s, allows a recent cached fix), `enableHighAccuracy:
    false` (coarse is enough, cheaper/faster). On success → call
    `trpc.location.capture.mutate(...)`.
  - **Enable failure (denied / timeout / position-unavailable / mutate
    error):** the toggle **reverts to off**, persisted opt-in stays off,
    and a short inline message shows ("Location unavailable" / "permission
    denied"). The toggle never reads "on" unless a capture actually
    stored. Never retried automatically. *(This is the first-enable
    failure path — distinct from the best-effort refresh below.)*
  - **Opportunistic refresh:** when the toggle is on and a chat send
    occurs, if the last successful capture is older than ~10 min,
    re-capture quietly (no reprompt — permission already granted) and
    `mutate`. Fire-and-forget; a failed refresh never blocks the send and
    never surfaces an error (the existing fix stays). No `watchPosition`
    (battery).
  - **Reconcile revoked permission:** on mount, if opt-in is persisted
    "on", query `navigator.permissions.query({name:"geolocation"})` where
    available; if it now reads `denied`, flip the toggle off so a stale
    "on" doesn't imply sharing that the browser has since revoked.
  - **Feature detection:** if `navigator.geolocation` is undefined
    (or `window.isSecureContext` is false), the toggle renders disabled
    with a tooltip; no capture attempted.
- **First implementation chunk:** `useLocationShare` hook +
  `location-share.ts` (localStorage + capture/mutate logic, feature
  detection), unit-tested where pure; then the `Toggle` placement +
  refresh-on-send hook. Frontend behavior verified manually in the dev
  app (see Rollout).

### Track 5 — Agent guide section

- **What:** Teach the agent that `cb location get` exists.
- **Why this needs to change:** Location is on-demand only; without a
  guide line the agent never knows to call it (`agent-guide/index.ts:64`
  is always-loaded context).
- **Direction:** New `src/core/agent-guide/location.ts` exporting
  `locationSection(): string[]`, slotted into the array in `index.ts`
  (after `calendarSection`/`driveSection`, with the other capability
  sections). Content (generic, no names): location is available only
  when the boxholder has shared it from the web UI; read it with
  `cb location get` (mention `--json`); it reports `unknown` when not
  shared and flags `[stale]` fixes; it is web-only and never appears
  automatically — query it when the conversation needs the user's
  whereabouts. Keep it short (≈6–8 lines), matching the density of
  `calendarSection`.
- **First implementation chunk:** `location.ts` + the `index.ts` slot.

## Subplans

None. No sub-question here is large enough to need its own design step —
the four load-bearing decisions were settled before this plan, and each
track's shape is fully specified above.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `location.json` absent (never shared) | Yes (T1 doctest) | Yes — `loadLocation` → `null`; CLI prints `unknown` | Clear |
| `location.json` malformed/corrupt | Yes (T1 doctest) | Yes — validate → `null` + `console.warn` | Clear (warns, degrades to unknown) |
| `capturedAt` unparseable / `source` wrong (hand-edit) | Yes (T1 doctest) | Yes — full-shape validate → `null` (no `NaN` age) | Clear (degrades to unknown) |
| Mutation input malformed / out-of-range | Yes (T3 doctest) | Yes — Zod reject, nothing written | Clear (tRPC error) |
| Browser denies permission | Manual verify (T4) | Yes — toggle reverts, inline message | Clear (UI) |
| Geolocation hangs (no timeout) | Manual verify (T4) | Yes — finite `timeout` option → enable-failure path | Clear (UI message) |
| First-enable capture fails (denied/timeout/mutate error) | Manual verify (T4) | Yes — toggle reverts to off, inline message; never reads "on" without a stored fix | Clear (UI) |
| Persisted "on" but permission later revoked | Manual verify (T4) | Yes — `permissions.query` on mount flips toggle off | Clear (UI) |
| Geolocation unsupported / insecure context | Manual verify (T4) | Yes — toggle disabled + tooltip | Clear (UI) |
| Capture mutate fails (network) on refresh | Manual verify (T4) | Yes — fire-and-forget, send unaffected | Silent **by design** (refresh is best-effort; existing fix stays) |
| Fix is stale (old capture) | Yes (T2 formatter doctest) | Yes — `[stale]` flag / `stale:true`, still reported | Clear (flagged) |
| Agent reads coords on a non-web channel | Yes (covered by absent-file path) | Yes — `unknown` until a web capture exists | Clear |
| Raw coords leak into logs | No automated test | Convention: routes/store never log lat/lng | Risk — see below |

> **Critical gap:** none. The closest is "raw coords leak into logs" —
> there is no test enforcing it, only the convention that the route and
> store never log coordinates. Accepted as a documented risk: the
> surface is two small files (`location-store.ts`, the `location` tRPC
> router) whose logging is reviewed at implementation; a leak would land in the
> gitignored `client-debug.log` / server logs, not git history. If this
> proves fragile, a lint rule or a coord-redacting log helper is the
> follow-up — out of scope for v1.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — N/A. No new card type or Markdoc tag;
  the only agent-facing surface is one CLI command.
- **Stale ref** — N/A. Location is not a card ref; no cross-card linkage.
- **Two agents touching the same card** — N/A. No card is written.
  Concurrent captures to `location.json`: last-write-wins is acceptable
  (a single value, idempotent-ish; a slightly older overwriting a
  slightly newer fix is harmless and self-heals on next capture).
  **ADDRESSED** by accepting last-write-wins (cite this paragraph); no
  file lock needed (contrast `src/lib/file-lock.ts`, which is for
  cross-process card mutations).
- **Hand-edit drift** — boxholder hand-edits `location.json`. **ADDRESSED**
  — the store validates lat/lng ranges + finiteness and degrades a
  malformed file to `unknown` with a warning (T1).
- **Fabricated free-form value** — the agent could *claim* a location
  without calling `cb location get`. **ADDRESSED** by design: there is no
  free-form location field for the agent to fill; the only source of
  truth is the command output. The guide section (T5) tells the agent to
  query rather than guess.
- **Validation error UX** — a malformed capture is rejected by Zod in the
  mutation; the agent never sees it (the frontend captures, not the
  agent). `cb location get` never
  errors on absent/stale — it returns readable `unknown`/`[stale]` text.
  **ADDRESSED**.
- **Partial migration / transition state** — N/A. No existing data shape
  changes; `location.json` is net-new and gitignored. No migration.

## NOT in scope

- **Reverse-geocoding to a place name.** Settled: coords only. Adding a
  geocoder is a third-party dependency that receives the coords; defer
  until there's a demonstrated need. (Rationale: don't-build-beyond-the-
  task; privacy — don't send coords out.)
- **`cb location clear` / `set`.** Settled: `clear` is privacy theatre;
  `set` is unneeded for v1. Real consent control is the permission +
  toggle.
- **Location in the per-turn snapshot.** Settled: on-demand only, to keep
  whereabouts out of every turn's context.
- **Per-user keying.** v1 stores one fix per box (the boxholder's). If a
  box ever has multiple distinct human users sharing location, keying by
  `getSessionUser` is the follow-up. (Rationale: boxes are effectively
  single-boxholder today; the `source`/file shape leaves room.)
- **Location history / trail.** Single last-known fix only. A timestamped
  trail is a different feature with its own privacy weight.
- **Non-web channels.** Telegram et al. have no geolocation; they report
  `unknown`. No attempt to derive location from IP or other signals.
- **`watchPosition` continuous tracking.** Capture is gesture- and
  send-triggered only.

## Open design questions

- **Stale threshold value.** Lean: 1 hour (`LOCATION_STALE_MS`). Not
  inside any first chunk's correctness — the flag is reported either
  way; only the boundary moves. Settle during T2 implementation; trivial
  to tune.
- **Toggle placement in the composer.** Lean: in the chat composer tool
  row. Finalized with the cb-frontend skill during T4 (a UI-placement
  detail, not a design unknown).

## Knowledge audits

This plan introduces one agent-facing concept: the `cb location get`
command and the rule "location is on-demand, web-only, query don't
guess." Per the skill's default (each new agent-facing concept gets at
least one `knows_directly` audit), add one entry to
`src/dev/knowledge-audits.yaml`:

- A `knows_directly` audit verifying the agent recalls that user
  location is read with `cb location get`, that it returns `unknown`
  until the boxholder shares it from the web UI, and that the agent
  should call it rather than fabricate a location.

The audit lands **run**, not just written:
`pnpm knowledge-audit run --box <absolute-path-to-a-test-box> --filter <id>`
(per memory: `--box` is a path; use an absolute path or omit, never a
bare name that resolves inside the monorepo). Record the status comment
in `knowledge-audits.yaml` before the plan completes.

## Implementation order

1. **Track 1 — location-store.ts** (+ doctest). No dependencies. Defines
   the on-disk shape every other track consumes.
2. **Track 2 — cb location get** (+ formatter doctest). Depends on T1.
   Gives an immediately exercisable read path (manually droppable
   `location.json` → `cb location get`).
3. **Track 3 — `location.capture` tRPC mutation** (+ route doctest). Depends on T1.
   Now the full backend loop is testable end-to-end without the
   frontend.
4. **Track 4 — frontend toggle + capture/refresh.** Depends on T3.
   Verified manually in the dev app (router-proxy localhost path).
5. **Track 5 — agent-guide section + knowledge audit.** Depends on T2
   (the command must exist and behave as the guide describes). Run the
   audit last, against a test box.

Chunks 1–3 are committable independently within the worktree; none ships
until the whole plan completes.

## Rollout shape

- **Tests (design-first):**
  - `test/location-store.doctest.md` (`makeTmpBox()`): absent → null,
    round-trip, malformed → null+warn. Written as T1 is designed.
  - A pure formatter doctest for the CLI's fresh/stale/absent line
    (T2) — the formatting is pure given a `StoredLocation`.
  - `test/location-route.doctest.md` (`makeTestServer()`): valid
    `location.capture` → stored + readable; out-of-range input → rejected
    + nothing written (T3).
  - Frontend capture/permission flow: **manual verification** in the dev
    app via the **verify**/**browse** skill — confirm (a) the toggle
    prompts, (b) a granted capture lands in `.callback-box/location.json`
    through the `localhost:3210/<wt>/...` router proxy (the one untested
    secure-context wrinkle from Prior art), (c) `cb location get` then
    reports it, (d) denial reverts the toggle cleanly. Geolocation +
    browser-permission UI is not doctestable; manual is the honest
    posture here.
- **Knowledge audit:** one `knows_directly` entry, written and **run**
  against a test box, status recorded in `knowledge-audits.yaml` before
  completion (see Knowledge audits).
- **Migration:** none — `location.json` is net-new and gitignored; no
  existing data shape changes.
- **Done-when:** all four doctests pass; the manual frontend verification
  succeeds through the dev router; the knowledge audit passes; `cb
  location get` returns `unknown` cleanly on a box that never shared.
