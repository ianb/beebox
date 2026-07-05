# Stack Decisions

Technology choices for Callback Box. Each decision includes reasoning and alternatives considered. The status table below tracks what's actually implemented vs. planned.

## Status Summary

### Done

| # | Decision | Notes |
|---|---|---|
| 2 | [tRPC (API layer)](#decision-2-api-layer--trpc) | Default for HTTP endpoints. A small, deliberate set stays REST (SSE streaming, file uploads, WebSocket, OAuth, webhooks, binary proxy) — see the watch-list in the decision. |
| 3 | [TanStack Query (data fetching)](#decision-3-data-fetching--tanstack-query) | All tRPC-migrated components use TanStack Query via `@trpc/react-query` hooks. |
| 5 | [Fastify (keep)](#decision-5-backend-server--fastify-keep) | Already in use, no change needed. |
| 7 | [Zod (expand)](#decision-7-schema-validation--zod-keepexpand) | All tRPC input schemas use Zod (now zod v4). No manual validation in new API code. |
| 10 | [simple-git](#decision-10-git-operations--simple-git) | `src/cli/lib/git.ts` rewritten from execa to simple-git. |
| 12 | [Agent SDK](#decision-12-agent-invocation--anthropic-agent-sdk) | `@anthropic-ai/claude-agent-sdk` drives agent invocation: typed message stream, session resume, in-process hooks, structured output. MCP tools + file checkpointing not yet used. |
| 14 | [Testing (TAP + doctest)](#decision-14-testing-strategy--tap--doctest--snapshot-testing) | Doctest system built (runner: `tap`). DI pattern established. |
| 15 | [Markdoc](#decision-15-markdown-parsing--markdoc) | Frontend renders markdown via `@markdoc/markdoc` (replaced react-markdown/remark in 2026-05) for custom tags like `{% quote %}`. See `docs/cards-as-markdown.md`. |
| 23 | [Utility library replacements](#decision-23-utility-libraries--replace-hand-rolled-code) | Adopted: execa, sanitize-filename, ky. proper-lockfile reverted 2026-04 → `src/lib/file-lock.ts`. date-fns still TODO. html-entities now orphaned (rss connector removed). |
| 1 | [XState (frontend state)](#decision-1-frontend-state-management--xstate) | All 6 machines migrated (`src/frontend/src/machines/`), replaced ~30 useState + ~15 useRef hooks. SSR state injection via `cb render` with scenario/state exploration. |
| 20 | [Overmind + node --watch](#decision-20-dev-runner--overmind--node---watch) | Superseded by Decision 24. `cb serve --dev` still works for backend-only. |
| 4 | [TanStack Router](#decision-4-routing--tanstack-router) | Code-based route tree, typed params, `href()` helper for dynamic paths. Replaced react-router-dom (dep removed). |

### Up next

| # | Decision | Status | Notes |
|---|---|---|---|
| 6 | [Tailwind + component catalog](#decision-6-component-system--tailwind--custom-components) | **Partial** | Tailwind in use. Build catalog when agent component duplication becomes a problem. |
| 19 | [Knowledge/acceptance audits](#decision-19-acceptance-testing--extend-knowledge-audit-framework) | **Partial** | knowledge-audit.ts exists. Extend to task completion audits when needed. |

### Deferred

| # | Decision | Notes |
|---|---|---|
| 8 | [SQLite file index](#decision-8-file-based-storage-with-queryable-index) | Build when query-time parsing is a bottleneck. |
| 9 | [Resource subscription](#decision-9-resource-subscription-service) | Depends on #8. Current SSE works. |
| 11 | [CASL authorization](#decision-11-authorization--typed-principals--casl) | Build when agent API keys are needed. |
| 13 | [Pino + OTel + Jaeger](#decision-13-tracing-and-logging--pino--opentelemetry--jaeger) | Still console.log. Build when debugging becomes painful. |
| 16 | [react-hotkeys-hook](#decision-16-keyboard-shortcuts--react-hotkeys-hook) | Add when shortcuts are needed. |
| 17 | [Phosphor Icons](#decision-17-icons--phosphor-icons) | Add when icon surface grows. |
| 18 | [Mistral Voxtral](#decision-18-speech-recognition--mistral-voxtra) | Note for future model preference. |
| 21 | [View Transitions API](#decision-21-page-transitions--view-transitions-api) | Pure CSS, no dependency. Add when transitions are desired. |
| 22 | [Syntax highlighting](#decision-22-syntax-highlighting--rehype-highlight-or-rehype-prism) | Premise gone (no remark pipeline — Markdoc now). If wanted, do it Markdoc-style, not via rehype-highlight. |

---

## Guiding Principles

These principles emerged from the state management evaluation and apply broadly to future stack decisions.

### Introspectability / Enumerability

Can you programmatically see what the system *can do*? A system that declares its structure as data — not just as imperative code — enables tooling, analysis, and understanding at a higher level. XState's state graph, where you can enumerate every reachable state and every path through the machine, is the gold standard for this. Prefer systems that are self-describing over systems where behavior is buried in opaque functions.

### Well-Typedness (Meaningful, Not Ceremonial)

Types should tell you something useful, not just satisfy the compiler. A type system that catches "you sent an event that doesn't exist in this state" is meaningful. A type system that requires `as Instance<typeof Model>` casts to bridge between your API layer and your state layer is ceremonial. Prefer types that guide you toward correct code over types that require workarounds.

### Accessibility to Tooling

Can external tools — CLI scripts, test harnesses, CI checks, an AI agent — interact with the system programmatically? This means: can you inject state from outside? Can you observe state changes? Can you validate inputs? Can you record and replay interactions? The more a system exposes itself to programmatic manipulation, the more leverage you get from tooling.

### Unidirectional Data Flow (State In, UI Out)

For any given state of the application, you should be able to hand it a JSON blob and get exactly that UI rendered. This isn't just for testing — it's a development workflow. It means mocking is built into the architecture, not bolted on. Effects and data fetching happen on the side, not interleaved with rendering.

### Isolation / Modularity

Branches of state should be self-contained. A component's state shouldn't need to know where it lives in the tree. Mutations should be scoped — a sub-system modifies itself without the root having to understand every detail. Communication between modules should be explicit (events, not shared mutable references).

### Ecosystem Health

Is the project alive and growing? Is there a company or committed team behind it? What's the bus factor? A declining or maintenance-mode project is a risk, even if the code is solid today. Prefer projects with active development, growing adoption, and clear stewardship.

### Minimal Distance from Intuitive

How far is the framework from what you'd write without it? Every step away from the "obvious" approach is a learning cost and a potential source of bugs. This doesn't mean "pick the simplest thing" — it means the complexity should pay for itself. Generators that exist to work around a framework limitation (MST's `flow`) are bad distance. State machines that prevent impossible states (XState's transitions) are good distance.

### Power / Leverage

What can you do with this system that you *couldn't* do without it? If the framework just reorganizes code you'd write anyway, it's low leverage. If it enables fundamentally new capabilities — exhaustive state exploration, event sourcing, runtime validation, structured undo/redo — it's high leverage. The best frameworks make hard things possible, not just easy things slightly easier.

---

## Decision 1: Frontend State Management — XState

**Decided:** 2026-03-02
**Choice:** XState v5
**Runner-up:** MobX-State-Tree (MST)
**Also considered:** Zustand
**Not considered:** Redux (too old/verbose), Valtio (proxy-based, no snapshot restore), Jotai (atomic, wrong model)

### What we were looking for

A state management approach for the React frontend that supports unidirectional data flow — give the app a JSON state blob, get the rendered UI out. Not just for testing but as a development workflow: a CGI-style renderer that takes a route + state and produces HTML. This requires state to be serializable, inspectable, and separable from rendering.

### How we evaluated

Built real implementations of the HistoryPage (commit browser with sidebar, timeline, detail view) using three frameworks alongside the original `useState`-based version. All four render identically — same Sidebar, CommitTimeline, CommitDetail components. The differences are entirely in how state is defined, mutated, and observed.

Also built a CGI-style renderer (`src/dev/render-page.tsx`) that takes a framework name + state fixture and outputs rendered HTML via React SSR. This validated the "state blob in, UI out" approach — a presentational component receives state as props and renders, bypassing store plumbing entirely.

### Evaluation dimensions

| Dimension | Zustand | MST | XState | Notes |
|---|---|---|---|---|
| Typing / state quality | 1 | 3 | 2 | MST has runtime types; XState has typed events + state constraints |
| Distance from intuitive | 3 | 2 | 2 | Zustand is closest to raw useState; MST/XState require new mental models |
| Isolation / modularity | 2 | 3 | 3 | Zustand's flat stores are awkward to coordinate; MST/XState have tree/actor models |
| Power features | 1 | 3 | 3 | MST: snapshots, patches, validation. XState: state graph, event sourcing, model-based testing |
| Ecosystem health | 2 | 1 | 3 | XState: 3.8M weekly downloads, growing. MST: 130K, flat. Zustand: healthy but less relevant |
| Composability | 2 | 2 | 2 | All handle it; none dramatically better |
| **Total** | **11** | **14** | **15** | |

### Why XState over MST

MST scored higher on typing (runtime type validation, Zod-like `validate()`) and had impressive data-level power features (JSON Patches, action recording, inverse patches for undo). But several factors tipped toward XState:

**Ecosystem trajectory.** XState has 30x MST's download volume and is actively growing. MST hasn't released in over a year. XState's creator (David Khourshid) commits weekly; MST's original creator stepped back in 2018.

**Structural introspection.** XState machines are data — you can enumerate all states, all transitions, all paths. `@xstate/graph` does exhaustive state exploration: find every reachable state, verify no dead ends, generate test paths. MST can observe *effects* of actions (via patches) but can't introspect *what actions are possible* without running them.

**Event model.** `send({ type: "SELECT", hash: "abc" })` is a serializable, self-documenting event. Every state change has a name and payload. This enables record/replay, event sourcing, and makes transitions explicit. MST's action calls are function invocations — less inspectable, less replayable.

**Impossible states are impossible.** XState's state nodes constrain what events are accepted in each state. You can't `LOAD_MORE` from the `error` state — the machine won't accept it. This is a compile-time and runtime guarantee, not just a convention.

**MST's ergonomic costs.** Generators (`flow/yield`) for all async actions, with manual type annotations on every `yield`. `as Instance<>` casts at API boundaries. `.slice()` needed to pass MST arrays to non-observer components. These are friction points that exist because of framework limitations, not because they make the code better.

### What XState asks of us

- **Think in state charts.** Each page's behavior is modeled as states + transitions, not ad-hoc boolean flags.
- **Events, not function calls.** UI triggers `send({ type: "EVENT" })`, not `store.doThing()`.
- **Loading is a state, not a flag.** Async operations are modeled as state nodes with invoked actors, not `setLoading(true/false)`.
- **Pair with a data-fetching library.** XState manages client state and orchestration; server state (API data, caching, pagination) should use TanStack Query or similar. This split is endorsed by both ecosystems.

### What we lose vs MST

- Runtime type validation of state blobs (`Model.validate()`) — would need Zod schemas separately
- JSON Patch emission for every mutation — would need custom middleware
- Built-in undo/redo via inverse patches
- `applySnapshot()` for hot-reloading state (XState has `getPersistedSnapshot()` but it's more involved)

### Stately ecosystem pieces we'll use

- **@xstate/store** — Under 1KB event-driven store for simple pages (Settings, Admin) where a full state machine is overkill. Same `send()` API, so upgrading to a full machine later is smooth. (recorded as adopted but never installed as of 2026-07 — unresolved; see docs/plans/docs-reorg.md open questions)
- **@xstate/graph** — Exhaustive state exploration and test path generation. Core to the testing strategy.
- **@statelyai/inspect** — Runtime debugging via `inspect` callback on `createActor()`. Sees every event and transition. Will wire this into a debug panel / event logger.
- **@statelyai/agent** — Not a dependency, but the *pattern* of using Zod schemas as event validators for external input (LLM actions, user events, API responses) is directly relevant. Borrow the pattern, don't import the library.

### Open questions

- What's the right granularity — one machine per page? Per feature? Per app?
- How do we handle the URL ↔ state synchronization? Routable states (v5.28.0) are machine-internal only — still need a URL router.

### Implementation notes

Evaluation prototypes (history-xstate.ts, HistoryPageXState.tsx, state-fixtures.ts, render-page.tsx) have been deleted. The comparison document (`docs/implemented-plans/state-management-comparison.md`) still exists. Zustand and MST were removed from package.json.

### Machines

All machines live in `src/frontend/src/machines/`. Each owns one feature's lifecycle.

| Machine | File | States | Resources owned |
|---|---|---|---|
| voiceRecorderMachine | `voiceRecorderMachine.ts` | idle → requestingMic → recording → uploading | MediaRecorder, MediaStream (callback actor) |
| realtimeTranscriptionMachine | `realtimeTranscriptionMachine.ts` | idle → connecting → recording → finalizing | WebSocket, AudioContext, MediaStream, AudioWorkletNode (single callback actor) |
| speechPlaybackMachine | `speechPlaybackMachine.ts` | idle → playing | TTS client (promise actor per segment sequence) |
| sseMachine | `sseMachine.ts` | connecting → connected / waiting → reconnect | EventSource (callback actor), auto-reconnect via `after` delay |
| claudeAuthMachine | `claudeAuthMachine.ts` | loading → idle → starting → polling / loggingOut | Poll interval (callback actor), 3-min timeout |
| chatMachine | `chatMachine.ts` | loading → idle ⇄ streaming → refreshing → idle, plus resetting | SSE fetch stream (callback actor) |

### Patterns established

- **Callback actors own non-serializable resources.** MediaRecorder, WebSocket, AudioContext, EventSource, fetch ReadableStream — all live inside `fromCallback` actor closures, not in context. Actors receive commands via `receive()`, send events back via `sendBack()`. Cleanup functions release resources on state exit.
- **Context stays serializable.** Only strings, numbers, booleans, arrays, and plain objects. No browser API objects in context.
- **`fromCallback` for long-lived resources.** WebSocket connections, SSE streams, polling intervals, timers — anything that produces events over time.
- **`fromPromise` for one-shot async.** Mic permission, fetch calls, file uploads, API requests with a single result.
- **`after` delays for timeouts/reconnects.** SSE reconnect (5s), transcription finalization timeout (5s), auth poll timeout (3min).
- **Thin hook wrappers preserve public interfaces.** `useVoiceRecorder`, `useRealtimeTranscription`, `useSpeechPlayback`, `useSSE` all preserve their original return types. Components consuming them needed zero changes.
- **Direct `useMachine` for page-level machines.** `ChatPage` and `AdminPage.ClaudeCodeSection` use `useMachine()` directly since only one component consumes each.
- **Granularity: per-feature.** Each machine covers one hook or one component's behavior. Machines are focused and independently testable.
- **SSR state injection via `useSSRMachine`.** Drop-in replacement for `useMachine` that checks an `SSRStateContext` for a pre-built snapshot. During SSR (`cb render`), machines start in the injected state instead of their initial state. `machine.resolveState({ value, context })` builds snapshots from plain serializable data.
- **State registry for exploration.** `src/frontend/src/ssr/state-registry.ts` declares all machines, their states, default contexts, and named scenarios per route. `cb render --list-states` enumerates what's available; `cb render --scenario streaming` renders a page in that state. This is the "state blob in, UI out" workflow the architecture was designed for.

### Deferred: parent orchestrator for voice turn-taking

ChatPage coordinates three independent machines (chat, transcription, speech playback) for voice turn-taking: transcription → send message → stream response → play speech → restart transcription. Currently this coordination uses refs (`turnTakingRef`, `transcriptionRef`, `machineStateRef`) and a `useEffect` that detects state transitions (`streaming → refreshing → idle`).

This works but is the one area where the machine boundaries leak — each machine doesn't know about the others, so the component bridges them imperatively. A parent orchestrator machine could model the full turn-taking cycle as explicit states, making the flow visible and testable. Defer until: the turn-taking logic gets more complex (e.g., barge-in detection, multi-turn conversation policies, concurrent voice + text input).

---

## Decision 2: API Layer — tRPC

**Decided:** 2026-03-02
**Rigor:** Directional (discussed, not built/benchmarked)
**Choice:** tRPC
**Alternative considered:** OpenAPI with code generation (better for polyglot backends)
**Current state:** Done. tRPC is the default for HTTP endpoints; the routers live in `src/webapp/trpc/routers/` (see `router.ts` for the current set — kept as the source of truth rather than enumerated here, since it churns). REST is retained only for the deliberate exceptions listed below.

### Why tRPC

- **End-to-end types without code generation.** Client code gets full type inference from server procedure definitions. No manually keeping `api.ts` interfaces in sync with route handlers.
- **Zod validation is first-class.** Input schemas are Zod objects that provide both TypeScript types and runtime validation. The current codebase has Zod installed but uses manual `if (!body.field)` checks in routes.
- **Introspectable.** An agent can inspect the router definition to see all available procedures and their exact input/output types programmatically. This aligns with the Introspectability principle.
- **Works with existing Fastify.** tRPC has a Fastify adapter — can be mounted alongside existing routes for incremental migration.

### What tRPC asks of us

- **TypeScript on both sides.** tRPC only works when client and server share a TypeScript project or monorepo. This is already the case (frontend imports types from `../api`).
- **Procedure-based thinking.** Routes become `query` (read) and `mutation` (write) procedures, not GET/POST endpoints. Conceptually similar but the vocabulary changes.
- **Migration.** 64 existing REST routes need to be migrated incrementally. The Fastify adapter allows tRPC and REST routes to coexist during transition.

### Concerns resolved

- **SSE/streaming.** Stays as REST. Chat send, command execute, file-watcher events all use SSE patterns that tRPC doesn't handle. These live in `api.ts` alongside `getApiBase()`. Not worth migrating — tRPC subscriptions use WebSocket which is a different transport.
- **File uploads.** Stay as REST. Voice memos (`createVoiceMemo`) and file uploads (`uploadFile`) use `multipart/form-data`. Brief feedback with audio converts Blob→base64 and sends through tRPC (acceptable for small audio clips).
- **Incremental adoption.** Worked perfectly. tRPC mounted at `/:boxSlug/api/trpc` alongside REST at `/:boxSlug/api/*`. Both coexist — old REST routes still registered but frontend no longer calls them for migrated endpoints.

### Implementation notes

**Infrastructure:**
- `src/webapp/trpc/trpc.ts` — initTRPC with context
- `src/webapp/trpc/context.ts` — TrpcContext: `{ boxRoot, boxSlug, eventBus, services }`
- `src/webapp/trpc/router.ts` — Root appRouter merging the sub-routers, exports `AppRouter` type
- Fastify adapter registered per-box at `/:boxSlug/api/trpc`
- Frontend: `@trpc/client`, `@trpc/react-query`, `@tanstack/react-query` in TrpcProvider

**Routers:** The sub-router set lives in `src/webapp/trpc/routers/` and is registered in `router.ts`. It grows and shifts as features land (e.g. the old `briefs` router was removed; `drive`, `files`, `landmarks`, `todos`, `transcription`, `health` were added), so the live `router.ts` is the source of truth — this doc no longer enumerates routers/procedures. Patterns worth knowing: cursor-based pagination (`history`) uses `useInfiniteQuery`; `card.patch` uses a Zod discriminated union for ops; mutations emit via `ctx.eventBus.emit()`.

**Type sharing:** Frontend imports `type { AppRouter }` via relative path. `RouterOutput` helper type (`inferRouterOutputs<AppRouter>`) provides inferred types for component props — eliminates manually duplicated interfaces.

**What stays REST (and why) — the watch-list.** These are deliberate exceptions, each with a real transport reason. The list is small on purpose; if it starts growing for reasons other than the categories below (streaming, binary, multipart, webhooks, OAuth redirects), that's a signal worth revisiting.

| Endpoint | Why not tRPC |
|----------|-------------|
| `chat/send` | SSE streaming — tRPC is request/response; this streams Claude's response chunks progressively. tRPC subscriptions exist but require WebSocket transport, which is a different architecture. |
| `commands/execute` | SSE streaming — streams command stdout/stderr as it runs. Same constraint as chat. |
| `/api/events` | SSE file-watcher — long-lived connection pushing file-change events. Could use tRPC subscriptions eventually. |
| `actions/create-voice-memo` | Multipart file upload — tRPC doesn't handle `multipart/form-data`. Audio blob sent as FormData. |
| `/upload` | Multipart file upload — same constraint. Generic file upload endpoint. |
| `transcribe-ws` | WebSocket — bidirectional audio streaming to Mistral. tRPC subscriptions are one-directional (server→client). |
| `auth.ts` | OAuth redirect flows — browser redirects, not API calls. No request/response to model. |
| `telegram.ts` | Inbound webhook — Telegram POSTs to us. External caller, not our frontend. |
| `chat/tts` | Binary proxy — streams audio bytes from TTS service. tRPC is JSON-only. |

**Frontend `api.ts`** shrank substantially (from ~815 lines) and now holds only `getApiBase()`, SSE/streaming functions, file upload functions, and legacy type exports. These functions use manual `fetch()` (not TanStack Query) because TanStack Query is designed for cacheable request/response patterns — SSE streams, file uploads, and long-lived connections don't fit that model.

### Lessons learned

- **Define explicit return interfaces** when procedures return complex data. TypeScript's inference breaks down with index signatures (`[key: string]: unknown`), conditional spreads (`...(flag ? {x} : {})`), and `[] as Array<Record<string, unknown>>` fallbacks. All of these produce `unknown` or `{}` on the frontend via `RouterOutput`.
- **tRPC manages query keys.** Don't pass `queryKey` in tRPC hook options — use `utils.X.invalidate()` for cache busting.
- **`as const` casts on string literals** are needed when backend types use `string` but the frontend expects a union (e.g., `sentiment: r.sentiment as "positive" | "negative" | "neutral"`). Better to fix the upstream type, but casting works when the source type comes from a parser.
- **`@jsxImportSource` pragma required on schema `.tsx` files.** The frontend's `@backend/*` path alias causes TypeScript to follow the full backend import chain, including `src/schemas/*.tsx` files that use cardworks custom JSX. Without per-file `/** @jsxImportSource cardworks/jsx */` pragmas, the frontend typecheck applies `react-jsx` to those files and reports hundreds of false errors. The cardworks `package.json` also needed a `./jsx/jsx-dev-runtime` export entry.

---

## Decision 3: Data Fetching — TanStack Query

**Decided:** 2026-03-02
**Rigor:** Directional (consensus from state management research, not independently evaluated)
**Choice:** TanStack Query (React Query)
**Current state:** Done. All request/response API calls use TanStack Query via `@trpc/react-query` hooks.

### Why TanStack Query

All three state management frameworks (Zustand, MST, XState) converged on the same recommendation: use a dedicated data-fetching library for server state. TanStack Query provides:

- **Automatic caching and deduplication** — multiple components requesting the same data share one fetch
- **Loading/error states** — `isLoading`, `error`, `isFetching` without manual boolean tracking
- **Background refetching** — stale data is served while fresh data loads
- **Pagination** — `useInfiniteQuery` for scroll-to-load patterns (like the commit timeline)
- **Mutations** with optimistic updates and rollback

### Relationship to XState and tRPC

The three form a clear separation:

| Concern | Tool |
|---|---|
| Server state (fetching, caching, sync) | TanStack Query |
| Client state (UI mode, selections, workflows) | XState |
| API contract (types, validation) | tRPC |

TanStack Query integrates well with tRPC — `@trpc/react-query` provides typed hooks that combine tRPC's type safety with Query's caching. This is a well-tested pairing.

### What doesn't use TanStack Query (and why)

- **SSE streams** (`sendChatMessage`, `executeCommand`, `/api/events`). TanStack Query is request/response oriented — it caches a response and refetches on invalidation. SSE streams are long-lived connections that push data incrementally. These use raw `fetch()` with `ReadableStream` parsing instead.
- **File uploads** (`createVoiceMemo`, `uploadFile`). These are fire-and-forget POSTs with `FormData`. No caching or refetching behavior needed — a simple `fetch()` call is sufficient.
- **Chat status/history/interrupt/reset** (`getChatStatus`, `getChatHistory`, etc.). These *could* use TanStack Query (they're normal request/response), but they're tightly coupled to the chat SSE flow and managed by the chat component's own state. Moving them to Query would split the chat state across two systems for no benefit.

### Concerns to investigate

- **Relationship with XState actors.** When an XState machine invokes a fetch actor, should that go through TanStack Query's cache, or directly? Need to decide whether XState or Query "owns" the fetch for each case.

### Implementation notes

**Fully adopted** via `@trpc/react-query`. The `TrpcProvider` in `src/frontend/src/lib/trpc-provider.tsx` wraps the app with both QueryClientProvider and trpc.Provider.

**Patterns in use:**
- `useQuery` — most data fetching (status, inbox, card details, briefs, schedules, etc.)
- `useInfiniteQuery` — paginated history with cursor-based pagination
- `useMutation` — all write operations (answer questions, create memos, submit feedback, etc.)
- `utils.X.invalidate()` — cache busting after mutations or SSE events
- SSE event handler in DashboardPage calls `utils.status.invalidate()` + `utils.scheduler.invalidate()` on file-change events, bridging the SSE push with Query's cache

---

## Decision 4: Routing — TanStack Router

**Decided:** 2026-03-02
**Rigor:** Directional (brief discussion, not evaluated against principles)
**Choice:** TanStack Router
**Current state:** Implemented. `@tanstack/react-router@^1.166.3`. Code-based route tree in `src/frontend/src/router.tsx`.
**Alternative:** Stay with React Router

### Why TanStack Router

- **Same ecosystem as TanStack Query.** Consistent philosophy, designed to integrate with Query's data loading.
- **Type-safe route parameters.** Route params and search params are typed, reducing runtime errors.
- **Data loaders.** Routes can declare data requirements that load before rendering, integrating with the API layer.

### Notes from the migration

- **XState routable states.** Investigated: XState v5.28.0's "routable states" are a machine-internal feature for jumping to any marked state via `{ type: "xstate.route", to: "#stateId" }`. They have **no URL awareness** — no path matching, no params, no `pushState`. A URL router is still needed regardless. Routable states are useful for within-machine navigation but don't replace a URL router.
- **Migration cost (resolved).** The move off React Router v7 touched every route definition and every `useParams`/`useNavigate` call. The `href()` helper (`src/frontend/src/lib/routing.ts`) centralizes dynamic-path construction so call sites get typed paths.
- **Maturity (resolved).** TanStack Router is newer than React Router but proved solid for this app's ~15 routes. Type-safe params were the main draw; loader integration is available but not heavily leaned on yet.

### Implementation notes

**Done.** Code-based route tree in `src/frontend/src/router.tsx` using `@tanstack/react-router@^1.166.3` (`createRouter` / `createRoute` / `createRootRoute`). `href()` helper in `src/frontend/src/lib/routing.ts`. `react-router-dom` has been removed from `package.json` (no remaining imports).

---

## Decision 5: Backend Server — Fastify (keep)

**Decided:** 2026-03-02
**Rigor:** Low (no alternatives seriously considered)
**Choice:** Fastify v5 (already in use)
**Current state:** Raw route files in `src/webapp/routes/`, WebSocket support (`@fastify/websocket`), SSE via `reply.hijack()`. Most endpoints have moved to tRPC (Decision 2); the remaining raw routes are the streaming/upload/OAuth/webhook exceptions.

### Why keep Fastify

- Already in use with a mature route structure.
- Good TypeScript support with generic route types.
- tRPC has a Fastify adapter for incremental migration.
- Supports WebSockets (`@fastify/websocket`) and SSE.
- Performance is strong. Plugin architecture is clean.

### If we needed to reconsider

Hono would be the alternative — lighter, designed for edge/serverless environments (Cloudflare Workers, Lambda). If serverless deployment becomes a goal, Hono's portability advantage would matter. For now, Fastify on Node.js is fine.

### Implementation notes

Done. No action needed.

---

## Decision 6: Component System — Tailwind + Custom Components

**Decided:** 2026-03-02
**Rigor:** Directional (discussed approach, not evaluated alternatives)
**Choice:** Tailwind CSS with a custom component library, documented via JSDoc
**Current state:** Tailwind is already in use; components exist but aren't cataloged

### Approach

Build a custom component library rather than adopting a third-party component library (Radix, shadcn, etc.). Tailwind's utility-class isolation works well with agentic development — components are self-contained, composable, and don't depend on global CSS state.

### Component discoverability

The challenge: an agent creating UI tends to reinvent the same component repeatedly rather than reusing existing ones. A catalog/registry helps the agent know what already exists.

**Approach chosen:** JSDoc documentation on component files, with a build-time extraction script that generates a queryable index. Components are documented at the source, and agents get a compiled registry they can search.

**Not chosen:** Storybook. It's a visual browser for humans, not a semantic index for agents. Agents need to understand component purpose, props, and usage constraints — not interact with a rendered preview. Storybook's maintenance overhead (writing stories for every component) doesn't pay for itself in an agentic workflow.

### Open questions

- What format for the JSDoc annotations? Standard JSDoc tags, or a custom structured format?
- How does the extraction/indexing script work? TypeDoc, custom parser, or something else?
- Should the registry include usage examples, or just props and descriptions?

### Implementation notes

Tailwind is in use. The component catalog/registry (JSDoc extraction, queryable index) is not built. This is low priority until agents are regularly creating UI components and duplicating existing ones becomes a real problem.

---

## Decision 7: Schema Validation — Zod (keep/expand)

**Decided:** 2026-03-02
**Rigor:** Low (already in use, natural fit with tRPC)
**Choice:** Zod
**Current state:** Done. Zod (`zod@^4.4.3`) is the standard for validation — every tRPC procedure input is a Zod schema. (Originally adopted at v3; upgraded to v4.)

### Why Zod

- Already a dependency.
- First-class integration with tRPC (procedure inputs are Zod schemas).
- Derives TypeScript types from schemas (`z.infer<typeof schema>`), eliminating type duplication.
- Provides runtime validation with structured error messages.
- Fills the gap left by choosing XState over MST — MST had built-in `Model.validate()`, but XState's context is unvalidated. Zod schemas can validate XState context shapes.

### Zod + XState integration pattern

Investigated: no dedicated library needed, but clear patterns exist:
- Define context schema in Zod, use `z.infer<>` as the type in `setup({ types })` — single source of truth.
- Validate persisted snapshots with `contextSchema.safeParse(raw)` before restoring actors.
- Validate events before sending — wrap `actor.send()`. Stately's own `@statelyai/agent` library does exactly this: LLM-generated events are validated against Zod schemas before the machine accepts them.
- No XState middleware hook for automatic context validation on every transition — validation is explicit in `assign` actions or guards.

### Alternatives considered

- **Typia** — The "types-first" dream: a TypeScript compiler transformer that generates runtime validators from standard TS interfaces. No schema DSL. Your types *are* the validators. Tradeoff: requires `ts-patch` or bundler plugin for the compiler transform. Intellectually appealing but adds build complexity.
- **Valibot** — Same schema-first paradigm as Zod but tree-shakeable (up to 95% smaller bundles). Drop-in alternative if Zod's size becomes a concern.
- **ArkType** — Syntax resembles TypeScript (`"string | number"`) but is still a string-based DSL, not actual TS types. Fast (100x Zod claimed) but a different mental model.
- **TypeBox** — Produces JSON Schema objects. Best for OpenAPI/Fastify interop and cross-language schema sharing. More verbose than Zod.

Zod wins on ecosystem integration (tRPC, XState agent library) and existing adoption in the codebase.

### What needs to happen

- Define Zod schemas for API inputs/outputs (currently just TypeScript interfaces in `api.ts`).
- Use Zod schemas as the single source of truth for types, replacing manual interface definitions.
- Validate XState machine context when loading persisted snapshots.
- Define event schemas for XState machines where events come from external sources (user input, API responses, agent actions).

### Implementation notes

Zod is installed and used in service definitions and test helpers. Expansion to API route validation is natural but blocked on or best done alongside tRPC migration (Decision 2), since tRPC makes Zod schemas the input definition format. Could also expand independently by adding `.safeParse()` to existing Fastify route handlers.

---

## Decision 8: File-Based Storage with Queryable Index

**Status:** Directional — design settled, build when needed
**Current state:** Files (cards — mostly YAML frontmatter, some legacy XML) are canonical storage. Git provides history. No structured index.

### The need

Structured files (cards) need to be queryable — find all files of a type, query attributes across files, extract and assemble documents from multiple sources. Currently this requires reading and parsing files at query time. A previous attempt at SQLite indexing was abandoned because keeping the index in sync with file changes was painful — especially around schema migrations and edge cases.

### Approach: Ephemeral SQLite index, rebuilt from source files

No off-the-shelf library exists for this. Contentlayer, Velite, Content Collections, and Astro Content Layer all handle static site content at build time, not runtime-watched file trees. TinaCMS comes closest — it builds an ephemeral SQLite index from Git-backed files and treats it as a derived cache — but it's tightly coupled to its own CMS stack.

The architecture is build-your-own with proven components:

**@parcel/watcher** for file watching. Key feature: `getEventsSince(dir, snapshotPath)` takes a saved snapshot and returns all changes since that snapshot was taken. This means after a process restart, a `git pull`, or a `git checkout`, the watcher can catch up on missed changes without a full rescan. Saves a snapshot to disk periodically, so even if the server was off during a `git` operation, it knows what changed.

**better-sqlite3** for the index database. Synchronous API (no async overhead for reads), WAL mode for concurrent access, fast enough for the scale of data involved (thousands of cards, not millions).

**Zod schemas** define the shape of each collection. `z.infer<>` provides TypeScript types for query results.

### Key design decisions

**Ephemeral index model.** The SQLite database is a derived artifact, never a source of truth. Schema change = drop the database and rebuild from files. This eliminates the migration pain entirely — no ALTER TABLE, no version tracking, no data transforms. Files in Git are the source of truth; the index is a disposable cache.

**Central files table + domain tables joined by file path.** A `files` table tracks source file metadata (path, mtime, content hash). Each domain table (e.g., `inbox_cards`, `capture_records`, `card_references`) has a foreign key back to the files table. When a file changes: delete all rows referencing that file across all domain tables, re-parse, re-insert. This makes the delete-on-change behavior clean and universal regardless of how many tables a single file populates.

**Transform functions per table.** Each table is defined by: a glob pattern (which files to watch), a CREATE TABLE statement (self-documenting SQL), and a transform function `(path, content) => Record[]` that parses a file and returns zero or more rows. Returning an empty array means "this file doesn't produce records for this table" — a natural way to skip files that don't match. One file can feed multiple tables through separate transform registrations.

**Content hashing for efficient resync.** Store file mtime + content hash in the files table. During a full resync (startup, or when @parcel/watcher's snapshot is too old), skip files whose mtime + hash match. Only re-parse files that actually changed.

**SQL types live in SQL, Zod types live in TypeScript.** Each table has an explicit CREATE TABLE statement — no Zod-to-DDL magic. Zod schemas validate and type query results on the way out. Two definitions to keep in sync, but both are simple and co-located in the same table registration.

### Investigated and set aside

**Dolt** — A MySQL-compatible database with Git-like version control (branches, merges, diffs, blame at the row level). Technically impressive, built on Prolly Trees for efficient structural sharing. But it doesn't fit this use case:
- Not embeddable from Node.js — it's a standalone Go binary (or hosted service). Would require running a separate database server.
- Stores data in its own opaque format, not as files on disk. This breaks the filesystem-as-state principle — you can't `cat` a row or have agents read/write data as files.
- Essentially a Git *replacement* for relational data, not a Git *companion*. Our data is already in Git as files; Dolt would be a parallel versioning system.
- Worth keeping in mind if the project ever needs a versioned relational database (e.g., for structured data that doesn't map well to files). But for indexing file-based cards, SQLite is the right tool.

**In-memory-only index** — Simpler but doesn't persist across restarts. With @parcel/watcher's snapshot feature, SQLite can catch up quickly on restart, so the persistence cost is low and the query flexibility is much higher.

### Implementation notes

Not started **as a card index**. Note that `better-sqlite3` is now a dependency, but for unrelated uses (token-usage tracking in `src/core/usage.ts`, the event bus) — not a queryable card index. `@parcel/watcher` is still not installed; `chokidar` remains the file-watch primitive. Build the index when query-time file parsing becomes a bottleneck or when the resource subscription service (Decision 9) needs a solid foundation. The current approach of reading/parsing files at query time works for the current scale.

---

## Decision 9: Resource Subscription Service

**Status:** Directional — design settled, build when needed
**Current state:** SSE file watcher exists but is ad-hoc. No general resource subscription pattern.

### The need

Clients viewing a file or resource need to know when it changes — typically because an agent committed, or the user edited something, or a background process updated state. This isn't collaborative editing (two people typing in the same document). It's **reactive views on committed state**: something changed a file, now push that update to anyone viewing it.

### The abstraction

A resource subscription service where a client says "I want this resource" and gets back:
1. The current content, parsed into a typed representation
2. A subscription that notifies when the resource changes, with the new content

The server knows how to parse different file types into their typed representations:
- **Cards** (`.card` files — YAML frontmatter) → structured JSON via `parseCardText` / `loadCardFile` (`src/core/card-io.ts`)
- **JSON files** → parsed JSON
- **JSONL files** → array of parsed JSON lines
- **Other files** → raw text or binary, depending on type

### How the pieces fit together

```
file watcher (@parcel/watcher)
    │
    ├──→ SQLite index update (Decision 8)
    │
    └──→ client notification
            │
            ├──→ SSE/subscription channel: "resource X changed"
            │
            └──→ TanStack Query cache invalidation → re-fetch → UI updates
```

One file watcher pipeline, two consumers: the queryable index and client notifications. The file watcher is the shared engine underneath.

**tRPC** defines the typed contract: "give me this resource as parsed data." The return type varies by file type — a card query returns a card schema, a JSON file returns its parsed shape.

**TanStack Query** on the client handles caching, deduplication, and re-fetching when invalidated. The subscription channel tells Query which queries to invalidate (medium granularity: "these files changed," not "here's the full new content" and not "something changed somewhere").

**SSE** (existing) or **tRPC subscriptions** carry the invalidation signals. The current SSE infrastructure already does a version of this — the question is whether to formalize it through tRPC's subscription model or keep SSE as a separate channel.

**ETag-style versioning.** The content hash from the files table (Decision 8) doubles as a version identifier. Client holds the hash from the last response and sends it on reconnect — server returns 304 (not modified) if the hash still matches, or the new content if it doesn't. This makes reconnection cheap: no full re-fetch of unchanged resources after a network hiccup or page reload.

### What this is NOT

- **Not collaborative editing.** No CRDTs, no OT, no conflict resolution. Changes come through commits (agents) or saves (user). The server is always authoritative.
- **Not a database sync engine.** Unlike ElectricSQL or Zero, we're not syncing table rows to the client. We're notifying that a file-based resource changed and letting the client re-fetch it.
- **Not Firebase.** Firebase/Firestore own the data and provide real-time sync as a service. Here, files in Git own the data; we're building a notification layer on top. Same UX goal (UI stays current), different architecture (files are canonical).

### Investigated and set aside (for now)

**Full collaborative editing (Yjs, Automerge, CRDTs)** — The dominant approach for real-time co-editing. Yjs has bindings for every major editor (ProseMirror, TipTap, CodeMirror, Monaco). But CRDTs store state in opaque binary formats, which conflicts with files-as-source-of-truth. The hard problem is reconciling CRDT state with external file changes (agent commits). Not needed for the current use case — agents do batch edits and commit, they don't live-edit alongside users. If true co-editing is ever needed, **Yjs + Hocuspocus** (TipTap's self-hosted WebSocket server with file load/save hooks) is the most pragmatic path.

**Hosted sync services (Firebase, Liveblocks, Supabase Realtime)** — Provide real-time sync as a service, but data lives in their systems. Wrong fit when files in Git are the source of truth.

**Server reconciliation without CRDTs (Weidner's approach)** — Interesting idea: if you have a central server, just order operations server-side without CRDT overhead. Worth revisiting if we ever need finer-grained sync than commit-level.

### Implementation notes

Not started, and in practice this hasn't mattered. The current ad-hoc SSE watcher (coarse "something changed, invalidate" signals bridged into TanStack Query) is doing the job naively and that's fine — fine-grained per-resource subscriptions and ETag-style versioning remain a "build if it ever becomes a real pain point" idea, not a pending task. Depends on Decision 8 (file index) for the shared file-watcher infrastructure if it's ever formalized.

---

## Decision 10: Git Operations — simple-git

**Decided:** 2026-03-02
**Rigor:** Low (clear winner from landscape review)
**Choice:** simple-git
**Current state:** execa-based shell-outs to `git` CLI (previously raw `child_process`)

### Why simple-git

- **Typed output parsing.** `log()` returns parsed commit objects, `status()` returns a structured status object, `diff()` returns parsed hunks. Eliminates hand-written `--format=...` strings and stdout parsing.
- **11M weekly downloads**, actively maintained (last release Feb 2026). The dominant git library for Node.js.
- **`.raw()` escape hatch** — anything without a dedicated method (including worktree operations) passes through to the git binary directly. Never blocked by missing API coverage.
- **Same performance as shell-out** — it spawns the real `git` binary, so hooks fire, worktrees work, and every git feature is available.

### What we investigated

- **isomorphic-git** — Pure JS reimplementation. Worktrees broken, no hooks, no rebase, slower than CLI. Its value is browser-side git, not server-side.
- **nodegit** — libgit2 native bindings. Last npm release 6 years ago. Dead.
- **dugite** — GitHub Desktop's wrapper. No structured output parsing; bundles a git binary (pointless on a controlled server).

### What simple-git doesn't add

No new capability over the git CLI. It's a convenience layer: TypeScript types + structured parsing + promise API. The git binary does all the work.

### Implementation notes

Adopted. `src/cli/lib/git.ts` rewritten from execa shell-outs to simple-git. All exported types and function signatures preserved — no caller changes needed (~30 importing files). Eliminated manual `--format` string parsing for log/status. Trailer parsing retained since simple-git doesn't parse git trailers. One edge case: simple-git's `modified` excludes working-tree deletions (unlike porcelain `D` status), so `deleted` files are merged into `modified` to match original behavior.

---

## Decision 11: Authorization — Typed Principals + CASL

**Decided:** 2026-03-02
**Rigor:** Directional (library chosen, implementation pattern designed, not built)
**Choice:** CASL for authorization rules, typed Principal union for identity
**Current state:** `getSessionEmail()` returns `string | null`, scattered `allowedEmails.includes()` checks

### The model

A discriminated union representing who is making a request:

```typescript
type Principal =
  | { type: "human"; email: string; isOwner: boolean }
  | { type: "agent"; keyId: string; agentId: string; scopes: string[] }
  | { type: "system" }
  | { type: "anonymous" };
```

Resolved early in the Fastify request lifecycle: check for `Authorization: Bearer` header (agent), then session cookie (human), then anonymous.

### Why CASL

- **6KB, isomorphic, fully typed.** Defines abilities as `(action, subject)` tuples with optional conditions. Replaces scattered permission checks with `ability.can('write', 'Card')`.
- **Framework-agnostic.** Works with Fastify, no adapter needed.
- **Separates who from what.** Principal resolution is one function; ability definition is another. Extend either independently.

### API keys for agents

Store hashed tokens in box config (consistent with filesystem-as-state). On inbound requests with `Authorization: Bearer`, hash the token, look up the key, resolve to an agent principal with scopes. No database needed.

### What we investigated and set aside

- **better-auth** — Most complete auth framework with Fastify support, includes API keys with rate-limiting. But it wants to own the user database, conflicting with filesystem-as-state. The current hand-rolled HMAC cookie auth works correctly.
- **casbin / permify** — Full policy engines. Overkill for a system with one owner and a small allowlist.
- **oso** — Deprecated (company pivoted to hosted SaaS).
- **Auth.js** — No Fastify support.
- **Lucia** — Deprecated as a framework; companion libraries Arctic (OAuth client) and Oslo (auth primitives) remain active and worth knowing about.

### What stays the same

Current session auth (HMAC-signed cookies, Google OAuth) is fine. No framework switch needed for authentication — just formalize the principal model and add CASL for authorization.

### Implementation notes

Not started. The Principal type and CASL rules can be added without changing the auth flow. First step: define the Principal type, add a Fastify hook that resolves the principal from request headers/cookies, and replace one `allowedEmails.includes()` check with `ability.can()`. Build when agent API keys become needed.

---

## Decision 12: Agent Invocation — Anthropic Agent SDK

**Decided:** 2026-03-02
**Rigor:** Directional (researched), then adopted
**Choice:** `@anthropic-ai/claude-agent-sdk`
**Current state:** **Done.** Agent invocation runs through the SDK (`@anthropic-ai/claude-agent-sdk@^0.2.128`). Stdout parsing is gone.

### What the Agent SDK is

Not just an API client — it wraps the Claude Code binary and provides a typed programmatic interface. Same execution model as the CLI (tool loops, file operations, context management), but with structured IPC instead of stdout parsing.

### Key capabilities over CLI subprocess

- **Typed message stream.** `query()` returns an async generator of `SDKMessage` objects — no stdout parsing.
- **Hooks.** `PreToolUse` / `PostToolUse` — intercept, block, or modify every tool call before execution. Can audit and gate git operations, redirect file paths, inject context.
- **In-process MCP tools.** Define custom tools as TypeScript functions with Zod input schemas. Expose box APIs (query inbox, read cards, check status) without running a separate MCP server process.
- **Session resume.** `resume: sessionId` picks up where a previous invocation left off with full context.
- **File checkpointing.** `enableFileCheckpointing` + `rewindFiles()` — roll back file changes to a prior state without relying on git.
- **Structured output.** `outputFormat: { type: 'json_schema', schema }` — enforce typed JSON results from agent runs.
- **Subagents.** Define named agents with their own tools, models, and prompts. Parent delegates via the `Task` tool.

### What it doesn't provide

No workflow orchestration, job queuing, state machines, or retry logic. Those remain ours (procedure engine, scheduler). The SDK is a cleaner agent runner, not a higher-level framework.

### What got adopted

- **Typed message stream.** `query()` from the SDK drives agent runs in `src/core/agent.ts` — no more stdout parsing.
- **Session resume.** `agent.ts` resumes a session via `resumeSessionId` (e.g. the "didn't commit → resume with a nudge" retry path).
- **In-process hooks.** `src/core/sdk-hooks.ts` runs a `PostToolUse` hook inside the server process — it replaced the file-based `plugins/card-validator/` plugin, so card/markdown linting runs without per-tool-call shell startup and with structured logging.
- **Structured output.** `outputFormat: { type: "json_schema", schema }` (agent.ts) enforces typed JSON results where a run needs them.

### Not (yet) adopted

- **In-process MCP tools** (`createSdkMcpServer` / `tool()`) — no box-specific MCP tools defined yet.
- **File checkpointing** (`enableFileCheckpointing` / `rewindFiles`) — not used; git remains the rollback story.
- **Subagents** via the SDK's `Task` tool.

### Implementation notes

**Done** for the core motivation (typed streams, hooks, structured output, resume). The `Agent` interface and test infrastructure (`createAgent`/`createFakeAgent`, `ensureAgentCommitted`) survived the switch — the SDK replaced the internals, not the seams. Note: `src/services/claude-cli.ts` still shells out, but only for `claude auth status/login/logout` (the admin auth surface) — it is not the agent-invocation path. MCP tools and file checkpointing remain the open follow-ups.

---

## Decision 13: Tracing and Logging — Pino + OpenTelemetry + Jaeger

**Decided:** 2026-03-02
**Rigor:** Directional (landscape reviewed, approach chosen, not built)
**Choice:** Pino for structured logs, OpenTelemetry for spans/traces, Jaeger for visualization
**Current state:** `console.log` / ad-hoc logging, no tracing

### The need

Understanding what code did during an operation — a wakeup cycle, an agent run, a request chain. Not production monitoring dashboards; developer tooling for understanding code flow, timing, and causality. The ability to add annotations to code and then see them, filter them, and drill into specific traces.

### The stack

**Pino** for structured log output. Fastify's built-in logger. Child loggers stamp context (request ID, agent run ID, operation type) on every message without threading context through function signatures. Pipe through `pino-pretty` in dev for readable terminal output.

**OpenTelemetry** for spans and traces. Auto-instrumentation catches every Fastify request and every outbound HTTP call for free. Manual spans wrap the things we care about — wakeup cycle phases, agent invocations, procedure steps, connector calls — with typed attributes (model name, card count, operation type). Spans have parent-child structure and timing, giving a Gantt chart view of what called what and how long each step took.

**`@opentelemetry/instrumentation-pino`** bridges the two: auto-injects `trace_id` into every Pino log record. Logs and spans are correlated — find a log line, jump to its trace.

**Jaeger** (all-in-one Docker container) for trace visualization. Single container, ephemeral storage, web UI at `localhost:16686`. Search traces by service, operation, time range, or tags. Drill into a trace to see the span timeline. If persistence matters later, swap to SigNoz (Docker Compose, ClickHouse-backed, logs+traces in one UI).

### Setup cost

- 4 npm packages (`@opentelemetry/sdk-node`, `@opentelemetry/api`, `@opentelemetry/auto-instrumentations-node`, `@opentelemetry/exporter-trace-otlp-http`)
- 15-line `instrumentation.ts` loaded via `--import`
- `docker run -p 16686:16686 -p 4318:4318 jaegertracing/jaeger:latest`

### The process boundary gap

`child_process.spawn()` is a process boundary OTel doesn't cross automatically. Agent invocations via CLI appear as disconnected traces. Fix: inject `TRACEPARENT` env var when spawning, extract in the child. The Agent SDK's hooks (Decision 12) may provide a cleaner injection point.

### What we investigated

- **winston** — Legacy, slower than Pino, string-interpolation style. No OTel integration.
- **AsyncLocalStorage DIY** — Can build lightweight trace IDs without OTel, but no span visualization. Good for just stamping trace IDs on logs; not enough for understanding timing and causality.
- **Grafana Tempo** — More powerful but requires multiple containers. Worth it later if we want metrics + logs + traces correlated.
- **SigNoz** — Best all-in-one option (ClickHouse-backed, persistent). Upgrade path from Jaeger when we want persistence.

### Assertive errors — errors come to you, not the other way around

The default for logging is passive — errors go into a stream and someone has to look. For this project, errors should be assertive: they actively surface to whoever or whatever triggered the operation.

**In tests:** A test helper hooks into Pino at the start of each test and collects error-level log entries. After the test's own assertions pass, the helper asserts the error collection is empty. Silent errors — code that catches an exception, logs it, and continues — become test failures. Expected errors can be explicitly allowlisted per test.

**In agent development workflows:** When an agent invokes something (the CGI renderer, a CLI command, a server request), errors logged during that invocation should surface as a clear message back to the agent. Options:
- A CLI tool like `cb check-errors --since=<timestamp>` that queries recent error-level logs and returns them as structured output. The agent calls this after running commands, or it's wired into a post-invocation hook.
- The CGI renderer and similar tools write errors to stderr in a structured format (JSON lines) that the agent naturally sees in tool output.
- The Agent SDK's `PostToolUse` hook (Decision 12) could automatically check for new errors after each tool execution and inject them as context.

The point: agents don't see terminal colors. They need errors surfaced as text in their message stream — either automatically via hooks, or via a lightweight "any errors since I last checked?" query.

**In interactive dev:** Pino transport that pushes error-level logs to the frontend via SSE. A toast or banner appears: "Error in wakeup cycle — [trace link]". On the server, optionally notify via Telegram for errors that happen outside a watched session.

**The principle: errors are assertive, not passive.** You shouldn't have to go looking for them.

### Implementation notes

Not started. No dependencies installed. The Pino part is low-friction (Fastify has built-in Pino support — set `logger: true` in server options). OTel is more involved but mechanical. Could adopt Pino alone first without the full OTel stack. The assertive errors pattern is independent of the logging library choice.

---

## Decision 14: Testing Strategy — TAP + Doctest + Snapshot Testing

**Decided:** 2026-03-02
**Rigor:** Deep (extensive discussion of philosophy and mechanics, library research)
**Choice:** TAP protocol (runner: `tap`), doctest-style markdown tests, custom `check()` with display serializers
**Current state:** Done. Doctests are the primary test format. (Test/file counts intentionally not tracked here — they churn constantly and aren't the argument.)

### Philosophy: testing for agents, not just humans

Tests serve different purposes in an agent-driven workflow than in traditional development:

1. **Types already act as smoke tests.** TypeScript catches most of the errors that simple unit tests would catch. The incremental value of a test that just confirms "this function returns a string" is near zero when the type system already enforces it.

2. **Tests force decomposition.** The real value of writing tests is that untestable code is a design smell. If you can't test a function in isolation, it's doing too much. Tests are a forcing function for good architecture — even when the test itself rarely fails.

3. **Tests are documentation.** A test that shows how to use a function, with realistic inputs and readable output, is better documentation than a JSDoc paragraph. Doctest-style testing makes this explicit: the example IS the test.

4. **Agents read test output.** TAP (Test Anything Protocol) is a text protocol that agents parse naturally. Fancy terminal UIs (Vitest's default, Jest's watch mode) are designed for humans staring at a terminal. TAP is `ok 1 - test name` or `not ok 2 - test name` followed by YAML diagnostics. An agent reads this, understands what failed, and acts on it.

### Test runner: TAP protocol

**`tap`** is the runner in use (`"test": "tap"`) and handles TypeScript adequately. **node:test** (built into Node.js) also outputs TAP natively. The key commitment is to the TAP protocol, not a specific runner — any runner that outputs TAP is compatible with the tooling.

**Not Vitest.** Vitest is excellent for humans but its value is in the interactive terminal experience, which agents don't benefit from. TAP's simplicity is the feature.

**Not BDD.** No `describe`/`it`/`should` ceremony. Tests are functions with names. `test("loading a card returns parsed XML", ...)` — direct, no nesting.

### Doctest-style testing

Markdown literate tests (`.doctest.md`) are the primary test format. Code blocks with setup, test, and cleanup sections. Expected output via `=>` assertions. TypeScript supported via esbuild transform.

Infrastructure includes:
- `makeTmpBox()` — temp directory with optional git init
- `makeTestServer()` — Fastify inject, no network
- `createFakeAgent()` — records invocations, configurable responses
- `print()` — accumulates lines for multi-line assertions
- Wildcards in expected values: `«*»` (anything), `«int»`, `«date»`, `«codeblock»` (a fenced block), `«blankline»`, plus named extractions (`«name=*»`, `«name=type»`). See `.claude/rules/doctest.md`.

### Display serializers

Purpose-built string representations of domain types for testing. Not `JSON.stringify`, not `util.inspect` — human/agent-readable representations designed to be tested against.

### No mock libraries

Mocking is built into the code through explicit dependency injection, not bolted on by a test library. Functions that depend on external services take an options/context object. Service fakes exist for all external dependencies (Telegram, Claude CLI, Google Calendar, OpenAI Audio, etc.).

### Not yet implemented from original vision

- **JSDoc `@example` extraction** — Mode 1 (inline doctests in source files) is not built. All tests are Mode 2 (markdown files).
- **Self-describing services with scenarios** — Services don't export test scenarios yet.
- **Property testing via fast-check** — Not adopted.
- **~~Snapshot as interactive agent tool~~** — **Done.** `cb render` is the CGI-style renderer: takes a route + state and produces HTML. Supports `--scenario`, `--machine` (XState state override), `--mock` (tRPC data override), `--selector` (CSS extraction), `--list-states` (enumerate available states/scenarios). State registry in `src/frontend/src/ssr/state-registry.ts`.
- **Source document tracing** (`data-source` attributes) — Not built.
- **~~HTML simplification for agent consumption~~** — **Partially done.** `cb render` strips scripts and styles by default, outputs clean HTML. CSS selector extraction (`--selector=h3`) lets agents focus on specific elements. Full Tailwind class stripping not implemented.
- **Knowledge audits** — Framework exists (`src/dev/knowledge-audit.ts`) but not expanded to task completion audits.

### Implementation notes

Core doctest system is **done** and working well. The remaining items from the original vision are future enhancements, not blockers.

---

## Decision 15: Markdown Parsing — Markdoc

**Decided:** 2026-03-02 (remark/unified) → **revised 2026-05 (Markdoc)**
**Rigor:** Originally compared 5 libraries against specific requirements; later revised when cards moved to a Markdown + YAML-frontmatter format with inline structured tags.
**Choice:** **`@markdoc/markdoc`** — frontend rendering pipeline (`src/frontend/src/components/Markdown.tsx`, `src/frontend/src/lib/markdoc-config.ts`)
**Previously:** remark/unified via react-markdown + remark-gfm
**Also considered (2026-03):** marked, markdown-it, micromark, MDX

> **Superseded in practice (2026-05).** The frontend no longer uses react-markdown / remark / rehype — it renders via Markdoc (`parse → transform → renderers.react`), with built-in node renders mapped to our components (`Link`, `Img`, `Para`, …) and custom block/inline tags like `{% quote %}` and `{% transcription %}`. `react-markdown` and `remark-gfm` are no longer dependencies. The driver was the card-format migration: cards became Markdown body + YAML frontmatter + **Markdoc inline tags** (validated per-type), so using Markdoc for rendering too means one tag system end-to-end rather than card-body tags in one dialect and rendering in another. Full rationale: **`docs/implemented-plans/cards-as-markdown-rfc.md`**.
>
> The remark-specific rationale below is retained as history. Note its load-bearing claims for *other* decisions have shifted: the markdown pipeline that Decision 22 (syntax highlighting) and the source-position-tracing ideas assumed no longer exists in that form — Markdoc has its own AST with source locations, but the rehype-highlight plan in particular is moot.

### Why remark (historical — 2026-03 rationale)

The decision was driven by three specific requirements:

**Source position tracking.** Every AST node in remark/unified's mdast includes `position: { start: { line, column, offset }, end: { line, column, offset } }`. This is native to the format, not a plugin. marked has no position tracking. markdown-it has basic `[line_begin, line_end]` maps but no column info. Only remark provides full source mapping out of the box.

Position tracking is needed for:
- Source document tracing in rendered output (Decision 14) — mapping rendered content back to source lines
- Doctest extraction — error messages that point to the exact line in the markdown file
- Future: click-to-edit features where rendered output links back to source

**KaTeX/LaTeX support.** `remark-math` for parsing + `rehype-katex` for rendering. Well-maintained plugins in the unified ecosystem.

**Code block extraction for literate testing.** `remark-code-blocks` and the AST structure make it straightforward to find fenced code blocks with their language tags, metadata, and exact source positions. This is the foundation for the markdown literate testing in Decision 14.

### Tradeoffs

- **Larger than marked.** marked is ~20KB with zero deps. remark with plugins is significantly larger. Acceptable because we need the AST features, not just HTML output.
- **Learning curve.** The unified ecosystem (remark for markdown, rehype for HTML, mdast/hast for ASTs) has more concepts than marked's straightforward `marked.parse()`. But the plugin architecture pays off when you need to do non-trivial things with the AST.
- **Plugin composition.** Math support requires composing `remark-math` + `rehype-katex` rather than a single extension. More modular but more setup.

### What we use it for

- **Rendering markdown content** in the frontend (card bodies, documentation, chat messages) — originally via `react-markdown` + `remark-gfm`; **migrated to `@markdoc/markdoc` in 2026-05** to support custom tags (see below).
- **Extracting code blocks** for the literate testing system (Decision 14) — custom doctest loader (still on the remark/unified AST).
- **Source position mapping** for tracing rendered output back to source files.

### Implementation notes

**Frontend rendering — migrated to Markdoc (2026-05).** The frontend now renders markdown through `@markdoc/markdoc`. The driver is the shared `<Markdown>` component at `src/frontend/src/components/Markdown.tsx`; the Markdoc config and the custom `{% quote %}` tag live in `src/frontend/src/lib/markdoc-config.ts`; node overrides (link, image, paragraph, document → React components) and the Quote tag implementation (`src/frontend/src/components/Quote.tsx`) hang off that pipeline. All ~8 consumer sites (`MarkdownCardView`, `RecipeView`, `ChatMessages`, `CommitDetail`, `CardTreeView`, `CalloutBlock`, `renderers/markdown.tsx`, `renderers/image.tsx`) still go through `<Markdown>` — the swap was transparent to them. `react-markdown`, `remark-gfm`, `rehype-raw`, and the custom `remark-comments` / `rehype-strip-ref` plugins are gone from `package.json` and from `src/`.

Why the switch: Markdoc's tag syntax (`{% quote from="people/dana" %}…{% /quote %}`) gives us first-class custom content types with attributes, validated at parse time, without bolting on rehype plugins to invent syntax inside HTML comments. See `docs/implemented-plans/cards-as-markdown-rfc.md` for the fuller rationale (cards moved to the same Markdoc tag system).

**Doctest loader.** A separate concern, unaffected by the render swap. It extracts fenced code blocks from `.doctest.md` files with plain regex (`agent-doctest/src/doctest-hooks.mjs`), not an AST — so the remark/unified-based source-position story this decision originally imagined never actually got built, and remark/unified is no longer a dependency anywhere in the repo.

KaTeX/math support is not currently wired into the Markdoc pipeline — revisit if math rendering is needed.

---

## Decision 16: Keyboard Shortcuts — react-hotkeys-hook

**Decided:** 2026-03-02
**Rigor:** Low (prior positive experience)
**Choice:** react-hotkeys-hook
**Future:** cmdk for command palette (⌘K pattern)

### Why react-hotkeys-hook

Good prior experience with it. React-native hook API: `useHotkeys('ctrl+s', handler)`. Wraps hotkeys-js, handles focus scoping, works with React's lifecycle. Lightweight, well-maintained.

**cmdk** (command palette) is a natural complement for the future — the ⌘K pattern for discoverability of actions. Not needed immediately but worth keeping in mind as the action surface grows.

### Implementation notes

Not started. Not in package.json. Low priority — add when keyboard shortcuts become needed.

---

## Decision 17: Icons — Phosphor Icons

**Decided:** 2026-03-02
**Rigor:** Low (reviewed options)
**Choice:** Phosphor Icons
**Also considered:** Lucide, Heroicons, Tabler Icons

### Why Phosphor

7000+ icons across 6 weights (thin, light, regular, bold, fill, duotone). The weight system is the differentiator — same icon at different visual weights means consistent styling without hunting for alternatives. Tree-shakeable React components.

Heroicons (from the Tailwind team) has only ~300 icons — too small a set. Lucide is solid but Phosphor's weight variants and larger set win.

### Implementation notes

Not started. Not in package.json. Currently using custom/inline SVG icons. Adopt when the icon surface area grows enough to warrant a library.

---

## Decision 18: Speech Recognition — Mistral Voxtra

**Decided:** 2026-03-02
**Rigor:** Low (based on usage experience)
**Choice:** Mistral Voxtral for speech-to-text
**Current state:** Whisper via the Thinking Machine frontend

### Why Voxtral

Good results in practice. For any speech recognition work beyond the current Whisper integration, Voxtral is the preferred model.

### Implementation notes

N/A — this is a model preference note, not a library decision. Current Whisper integration works. Voxtral is the recommendation if/when adding server-side transcription.

---

## Decision 19: Acceptance Testing — Extend Knowledge Audit Framework

**Decided:** 2026-03-02
**Rigor:** Directional (approach chosen, not built)
**Choice:** Extend the existing knowledge audit framework to include action/task audits
**Not chosen:** Playwright, Cypress, or other browser automation frameworks

### The existing pattern

The knowledge audit (`src/dev/knowledge-audit.ts`) tests what agents know — prompts in YAML, behavioral checks on the transcript, reports with expected vs actual knowledge levels. This pattern generalizes naturally to action audits: "can the agent do X?" not just "does the agent know X?"

### Extension: task completion audits

Same YAML-driven structure, but the prompt asks the agent to *do* something, and the checks verify the result:

```yaml
- id: create-memo-card
  prompt: "Create a memo card titled 'Test' in the inbox"
  expected_outcome: file_created
  check_path: "box/inbox/*.card"
  check_contains: ["<title>Test</title>"]
  tags: [actions, cards]
```

The framework runs the prompt, lets the agent act, then checks filesystem state, git status, or other observable outcomes. Same report format — expected behavior, actual behavior, automated checks, assessment field.

### Screenshots / Page rendering

~~Lightweight screenshot capability for visual verification — a CLI tool that renders a page and outputs an image.~~ **Implemented as `cb render`** — renders any page to HTML via React SSR instead of as a screenshot image. More useful for agents than pixel screenshots because the output is semantic HTML that agents can parse, search, and reason about. Supports CSS selector extraction (`--selector`), named scenarios (`--scenario streaming`), machine state overrides (`--machine chat=idle`), and tRPC data mocking (`--mock`). See Decision 1 for architecture details.

### Not Playwright

Playwright is designed for browser automation test suites with selectors, waits, and interaction sequences. That's the wrong model here — we're testing agent capabilities, not UI click paths. The CGI-style render pattern (Decision 14) handles UI testing without a browser. Playwright's overhead and complexity don't pay off.

**Puppeteer** may be useful later for a different purpose: automating the agent itself (driving browser interactions on behalf of the user). That's an automation tool, not a testing framework.

### Implementation notes

Partial. `src/dev/knowledge-audit.ts` and `src/dev/knowledge-audits.yaml` exist and work. Task completion audits (the extension) are not built. Page rendering is done (`cb render` — see Decision 1). Expand when agent behavioral testing becomes a priority.

---

## Decision 20: Dev Runner — Overmind + node --watch

**Decided:** 2026-03-02
**Superseded:** 2026-05-26 by Decision 24 (custom dev router) when the monorepo migration made per-worktree dev servers a requirement.
**Rigor:** Deep (researched zombie process issues, signal propagation, alternatives)
**Choice:** Overmind (Procfile-based process manager) + `node --watch --import tsx`
**Current state:** `cb serve --dev` spawns `tsx --watch`, separate Vite dev server

### The problem

The current dev setup suffers from zombie child processes. Root causes:

1. **tsx --watch + npm = broken signals.** npm v10.3+ changed how it sends SIGINT to process groups. tsx's watcher doesn't get a chance to let the child exit gracefully, prints "Previous process hasn't exited yet. Force killing..." and leaves orphans (tsx issue #586, open since 2024).
2. **No process group management.** When the server spawns sub-processes (agent invocations, git operations), killing the parent leaves grandchildren alive. Node's `child_process.kill()` only signals the direct child, not descendants.
3. **Agent edit storms.** An agent making 20 file edits in 5 seconds triggers 20 watcher restarts. Each restart that doesn't clean up properly compounds the zombie problem.

### The solution

**Overmind** is a Go-based process manager that runs each Procfile entry in its own tmux session. Proper signal propagation, individual process restart, and real job control.

```
# Procfile.dev
backend: node --watch --import tsx ./src/webapp/server.ts
frontend: npx vite dev
```

`overmind start -f Procfile.dev` runs both. `overmind restart backend` restarts just the server. Ctrl+C kills everything cleanly because tmux sessions have proper job control.

**`node --watch --import tsx`** instead of `tsx watch`. Uses Node's native watcher while tsx handles TypeScript compilation. Simpler process tree — no tsx wrapper process between you and your server.

**Key rules:**
- Never run watch commands through `npm run` — invoke binaries directly to avoid signal propagation breakage
- The Procfile approach does this naturally

### Agent edit debouncing

May not be needed immediately — `node --watch` already has some built-in debouncing. If it becomes a problem, two options:
- **Lock file sentinel**: Agent creates `.editing` before bulk changes, removes when done. Watcher skips restarts while file exists.
- **Configurable debounce**: 2-second delay after last file change before restarting.

### Investigated and set aside

- **tsx --watch** — Broken signal handling when run through npm (issue #586). Running directly works but is fragile.
- **node --watch alone** — Hardcoded SIGTERM instead of SIGINT (Node issue #49321). Servers that do graceful shutdown on SIGINT don't clean up properly.
- **concurrently** — Popular but has its own orphaned process issues (issue #67). Shell-spawned commands may fork to different PIDs than what concurrently tracks.
- **turbo dev** — Graceful shutdown is an open issue (#4274). Good for build orchestration, rough edges for dev servers.
- **ts-node-dev** — Long-standing issue where child processes are not killed on restart (issue #79).
- **Bash trap script** — `trap 'kill 0' EXIT` works for simple cases but no colored output, no individual restart, no attach-to-process.

### Implementation notes

**Done.** Three entry points, all using `node --watch --import tsx` directly (no `npx tsx --watch`):

1. **`cb serve --dev [dirs...]`** — spawns `node --watch` with signal forwarding. Accepts same port/host/dir args as production mode.
2. **`Procfile.dev`** — for Overmind: `overmind start -f Procfile.dev` runs backend + vite frontend together. Edit box dirs in the file.
3. **`.thinking/services/cb-serve`** — shell script with `exec` for Thinking Machine's ServiceManager.

`server.ts` has a standalone entry point that accepts box dirs as argv and PORT/HOST as env vars, so all three approaches use it directly without the CLI wrapper.

```bash
# Option A: CLI (backend only)
cb serve --dev ~/src/boxes/test1

# Option B: Overmind (backend + frontend)
brew install overmind  # one-time, requires tmux
cd callback-box && overmind start -f Procfile.dev
overmind restart backend    # restart just the server
overmind connect backend    # attach to tmux session
```

---

## Decision 21: Page Transitions — View Transitions API

**Decided:** 2026-03-02
**Rigor:** Low (browser API is the obvious choice)
**Choice:** View Transitions API (browser-native)
**Future:** Motion library if CSS can't express what's needed

### Why View Transitions API

Baseline as of October 2025 — supported in Chrome, Edge, Firefox 133+, Safari 18+. Zero JavaScript, pure CSS `::view-transition-*` pseudo-elements. TanStack Router has built-in support (`defaultViewTransition: true`). React itself has an experimental `<ViewTransition>` component heading toward stable.

No library to install, no bundle size, no API to learn beyond CSS. Start here. Add **Motion** (Framer Motion's successor, same team, lighter bundle) only if CSS transitions can't express what's needed.

### Implementation notes

Not started. Pure CSS — add when page transitions become desired. No dependency needed.

---

## Decision 22: Syntax Highlighting — rehype-highlight (or rehype-prism)

**Decided:** 2026-03-02
**Rigor:** Low (follows from Decision 15)
**Choice:** ~~rehype-highlight (wraps highlight.js) within the remark/unified pipeline~~ — **premise gone** (see note)
**Current state:** highlight.js still installed; rendering is now Markdoc, not remark/rehype

> **Premise invalidated (2026-05).** This decision assumed the remark/unified pipeline from Decision 15. That pipeline was replaced by Markdoc, so "run highlighting inside the rehype chain" no longer applies. If/when syntax highlighting in rendered markdown is wanted, it needs a Markdoc-shaped approach (a fence/code node render that calls highlight.js, or a Markdoc transform) — not rehype-highlight. The rest of this section is retained for history.

### Why rehype-highlight

Since Decision 15 chose remark/unified for markdown parsing, syntax highlighting should run inside the same pipeline rather than as a separate post-processing step. `rehype-highlight` wraps highlight.js and integrates with the remark→rehype rendering chain. highlight.js is already installed, so this adds integration rather than a new dependency.

Alternative: `rehype-prism` uses Prism instead of highlight.js. Either works — highlight.js has broader language coverage, Prism has a more modern plugin architecture. Since highlight.js is already in the project, rehype-highlight is the path of least resistance.

### Implementation notes

Not started. highlight.js is used directly. Moving it into the remark pipeline via rehype-highlight is a small refactor — do it when touching the markdown rendering pipeline for other reasons.

---

## Decision 23: Utility Libraries — Replace Hand-Rolled Code

**Decided:** 2026-03-02
**Rigor:** Low (code scan identified patterns, libraries are obvious replacements)

### Replacements

| Library | Replaces | Status |
|---|---|---|
| **execa** | Duplicate `execFile` wrappers with manual error handling | ✅ Done — used in `procedure/shell.ts` (git operations moved to simple-git, Decision 10) |
| **date-fns** | Ad-hoc date formatting with manual month/day/hour logic | ❌ **Not done (TODO)** — never landed; not a dependency. Date formatting is still ad-hoc native (`toLocaleDateString`/`Intl`) across ~15 files. See the TODO below. |
| **html-entities** | Regex-based HTML stripping and entity decoding in `rss.ts` | ⚠️ Adopted, now orphaned — the RSS/news connector (`rss.ts`) was removed, so there are no remaining `src/` imports. `html-entities` is still in `package.json`; candidate for removal. |
| **sanitize-filename** | Multiple duplicate `safeFilename()` functions | ✅ Done — wraps sanitize-filename with existing alphanumeric/underscore/50-char constraints |
| ~~**proper-lockfile**~~ | Two separate file-locking implementations | ❌ Reverted 2026-04 — see note below |
| **ky** | Bare `fetch()` with no retry or error normalization | ✅ Done — retry + timeout for external APIs (~11 files) |

### TODO: adopt date-fns

Not yet done — a self-contained task to hand off:

1. Add `date-fns` to `callback-box/package.json` (it formats dates only; no extra runtime deps).
2. Replace ad-hoc/native date formatting with date-fns `format()` / `formatDistanceToNow()` etc. Current hand-rolled sites to convert (from a `toLocaleDateString`/`Intl`/manual `getMonth()` scan) include, on the backend: `src/connectors/google-calendar.ts`, `src/connectors/calendar-utils.ts`, `src/cli/commands/status.ts`, `src/dev/doc-graph-html.ts`, `src/dev/prompt-report.ts`; and on the frontend: `src/frontend/src/components/CommitTimeline.tsx`, `CommitDetail.tsx`, `SessionLog.tsx`, `dashboard/ScheduleOverview.tsx`, `dashboard/SystemInfo.tsx`, `settings/DriveSection.tsx`, `renderers/image.tsx`, `renderers/sheet.tsx`. (Re-grep before starting — the list drifts.)
3. **Watch out for timezone semantics.** Calendar code (`google-calendar.ts`, `calendar-utils.ts`) is timezone-sensitive — verify against existing tests rather than mechanically swapping; date-fns formats in local time unless paired with `date-fns-tz`.
4. Keep the project conventions: no default parameters, double quotes, explicit types. Add/adjust doctests for any user-visible format change.

### Why these and not others

Each replaces code that was written because the project needed the functionality before choosing a library. The hand-rolled versions work but have gaps:

- **html-entities** handles edge cases (named entities, surrogate pairs) the regex approach misses
- **ky** adds retry with backoff (critical for connectors hitting rate-limited APIs) while staying close to native fetch
- **sanitize-filename** handles platform-specific reserved names and characters the custom functions miss

### Reverting proper-lockfile (2026-04)

`proper-lockfile` was adopted to consolidate two hand-rolled lock implementations, but its mtime-heartbeat staleness model failed in practice on this codebase:

1. **macOS sleep paused the heartbeat**, so live locks looked stale on wake and could be stolen mid-run.
2. **SIGKILL (per-script timeouts firing) left orphaned `.lock.lock` directories** that no read path cleaned up — once `proper-lockfile` saw one of these, future acquisitions on the same name failed until the directory was manually removed.

Replaced by `src/lib/file-lock.ts`: a JSON lock file whose body records `{pid, bootEpochSeconds, hostname, acquiredAt, metadata}`. Liveness via `process.kill(pid, 0)` plus a boot-epoch comparison — no clocks, no heartbeats, no auxiliary directories. Dead holders self-heal on the next read. See the file's header for full rationale.

### Why ky over ofetch

Both are modern fetch wrappers with retry support. ky is ~3KB gzipped (ofetch is ~64KB), stays closer to native fetch semantics, and doesn't try to be a framework. Sindre Sorhus maintains it actively. The "minimal distance from intuitive" principle applies here — ky adds what's missing from fetch without reinventing the API.

---

## Dependencies to remove (migration cleanup)

| Package | Reason to remove |
|---|---|
| ~~**mobx, mobx-react-lite, mobx-state-tree**~~ | ✅ Removed. Decision 1 chose XState; these were evaluation remnants. |
| ~~**zustand**~~ | ✅ Removed. Evaluation remnant from the state management comparison. |
| ~~**react-router-dom**~~ | ✅ Removed (2026-05). Replaced by TanStack Router (Decision 4); had no remaining imports. |
| **xml2js** | The legacy XML card format (and cardworks, which parsed it) has since been removed entirely — cards are YAML frontmatter only. xml2js should not be used directly (no direct `src/` imports found — safe to drop). |
| **chokidar** | Still the file-watch primitive. Decision 8 imagined migrating to @parcel/watcher, but that index was never built and @parcel/watcher was never installed — so chokidar stays for now. |
| **html-entities** | Orphaned after the RSS/news connector was removed (no `src/` imports). Drop it. |
| **highlight.js** | Decision 22's rehype-highlight plan is moot (no remark pipeline — see Decision 15). highlight.js is still installed but not directly imported in `src/frontend/src`; reassess whether it's needed at all under Markdoc. |

---

## Decision 24: Dev Runner — Custom Path-Routing Router

**Decided:** 2026-05-26
**Supersedes:** Decision 20 (Overmind + Procfile.dev)
**Rigor:** Deep (researched lazy-start patterns, surveyed alternatives, weighed scope of build)
**Choice:** A single Node daemon (`bin/router.ts`) that listens on one port and lazy-spawns a Vite + Fastify pair per worktree on first HTTP request.

### Why we replaced Overmind

The monorepo migration introduced parallel git worktrees, each with its own
copy of the source. Agents work in their own worktrees in parallel; each
agent occasionally needs a dev server to test its work. That means
**multiple dev-server pairs running simultaneously**, each on different
ports, with the agent expected to report a working URL back to a human.

Overmind doesn't model "one dev-server pair per worktree" — it's one
Procfile per checkout. Running N overminds eats memory whether the
worktree is actively in use or not. We also wanted a single well-known
URL the agent can refer to (`localhost:3210/<worktree>/<box>/...`) rather
than asking the user to remember which port maps to which worktree.

### The router

`bin/router.ts` listens on `:3210`. It parses the first URL path segment
as a worktree name, and:

1. If that worktree's Vite + Fastify pair isn't running, it spawns them as
   direct children (no tmux, no Procfile wrapper — the process tree is
   `router → {vite, fastify}` per worktree).
2. Proxies the HTTP request to Vite (configured with `base: '/<name>/'` so
   the prefix is handled natively by Vite's router and Fastify still sees
   the unprefixed routes after Vite's proxy rules `rewrite`).
3. HMR bypasses the router entirely — Vite's `server.hmr.clientPort` is
   set to its internal port so the browser opens the WebSocket directly.
4. Tracks a per-worktree idle timer; 5 minutes of no traffic and the
   pair is shut down (SIGTERM, escalating to SIGKILL after 2s).

`bin/worktrees` is the CLI wrapper: `serve` (run the router), `status`
(query `/__router/status`), `down <name>` (stop one worktree), `panic`
(nuclear cleanup).

### Orphan resistance

Per-worktree PID files at `~/.cache/callback-box/pids/<name>.json`. On
startup the router sweeps that directory: any PID still alive from a
previous router (crashed/SIGKILLed without cleanup) gets SIGTERMed and
its file removed. Clean shutdown kills all children with the same
SIGTERM → grace → SIGKILL pattern. The CLI's `panic` is a manual escape
hatch when something's clearly stuck.

### Why not just use what exists

Researched (mid-2026): no off-the-shelf tool fits well on macOS for the
specific shape "one shared dispatcher on a known port + per-worktree
backends + lazy start + idle shutdown". Closest options were
`systemd-socket-proxyd` (Linux only) and Sablier (container-only).
Other process supervisors (`mprocs`, `process-compose`, `pm2`,
`hivemind`) don't support request-triggered start. The custom router is
~400 lines of Node and uses boring building blocks: `http-proxy`,
`get-port`, `execa`.

### Implementation notes

**Done.** Lives at `bin/router.ts` and `bin/worktrees`. See the root
`CLAUDE.md` for the user-facing workflow. The old Overmind-based dev
runner (Decision 20) is gone — `Procfile.dev` deleted, `cb serve --dev`
still works for the rare "just the backend" case.

---

## Decisions not yet made

| Area | Notes | Status |
|---|---|---|
| Build tooling | Vite (keep) | No reason to change |
| Full-text search | BM25 ranking (e.g., MiniSearch, Orama, or SQLite FTS5). Fancier than keyword search. | To research |
| Embedding / vector search | Orama (`@orama/orama`) already used in ske with OpenAI `text-embedding-3-small` (512 dims). Supports both full-text and vector similarity search with persistence. Could reuse the same setup. | Future |
| Token usage tracking | Log usage via Pino (or direct writes) — token counts from API responses, tagged with context (agent run, box, task). Custom visualizer/reporter on top. Cost-per-token mapping is fuzzy (varies by model, changes over time) but approximate is fine. No external service needed. | Future |
| Retell.ai integration | AI phone call service — future connector for voice interactions | Future |
| agentmail.to integration | Email service designed for agents — potential connector | Future |
| WebTiles | Embeddable widget framework for embedding box views in other contexts | Future |
| Documentation indexing | Framework for making all docs (code docs, box docs, guides) work together as a searchable, cross-referenced corpus | To think about |
