---
title: "Resident workstreams application"
status: active
workstream: workstreams
issues:
  - ../../../issues/code-quality/2026-08-13-resident-workstreams-app.md
---

# Resident workstreams application

Move the interactive workstreams, issues, plans, and testing surfaces out of the
dependency-light dev router and into a resident application. Keep the router as
the authenticated bootstrap proxy and diagnostic fallback.

## Job to be done

When I move between agent workstreams, I want one responsive place to inspect
state, triage issues, and start lifecycle actions, so I can manage the work
without waiting for a box or editing repository files by hand.

When the main application or a worktree install is broken, I want the router to
retain a small diagnostic surface, so I can see the failure and recover without
depending on the broken build.

## Stated preferences this plan trades against

- Engineering principle 3, **validate at boundaries**
  (`docs/engineering-principles.md:37-47`): validate every app API input and
  every filesystem or child-process result with Zod.
- Principle 4, **resilient and never silent** (`:49-62`): show app startup,
  proxy, mutation, and lifecycle failures in the UI and router fallback.
- Principle 7, **hierarchy is a discoverability contract** (`:87-93`): give the
  app a top-level workspace package. Do not hide it under `bin/` or import
  private callback-box frontend source.
- Principle 8, **one way to do each thing** (`:95-104`): retain one workstream
  domain implementation and one mutation path while replacing the renderer.
- Principle 9, **formal structure for essential complexity** (`:106-114`): use
  XState only for long-running lifecycle jobs with meaningful phases.
- Principle 10, **testability is architectural** (`:116-125`): separate pure
  domain reads, API handlers, process supervision, and UI state.
- Principle 12, **the maintainer is usually an agent** (`:141-149`): enforce
  route inputs and state variants with types instead of prose conventions.
- `callback-box/CLAUDE.md` and `callback-box/code-style.md` remain the coding,
  logging, validation, and scope contracts. This plan does not weaken lint.
- The shipped workstreams control surface is the behavior precedent. The new
  app preserves its URL vocabulary, authorization posture, staged issue edits,
  resume progress, quota cache cadence, and workstream registry semantics.

## What already exists

- `bin/router.ts:1044-1058` owns `/workstreams/*` dispatch. The new router proxy
  replaces that call site; the path remains stable.
- `bin/router-auth.ts:216-237` classifies workstreams reads and mutations before
  dispatch. Reuse this fail-closed outer authorization gate.
- `bin/router-workstreams.ts:231-280` already treats `bin/workstreams` as a
  process boundary. Preserve the CLI as the canonical lifecycle command surface.
- `bin/router-workstreams.ts:1193-1373` combines routing, data access, actions,
  HTML, JavaScript, CSP, and error handling. Split these responsibilities; do
  not port the string renderer into React.
- `bin/workstreams` is an agent-facing command surface. Its `list --json` branch
  deliberately keeps liveness in Bash (`bin/workstreams:487-507`) so there is
  one guard in front of destructive actions. The app shells through this
  command and validates its JSON with Zod. It does not change or reimplement it.
- `/__router/status` exposes router-owned live process state. Add a narrow
  internal endpoint for the data the app cannot derive from the CLI. Do not let
  the app import router-core objects.
- `callback-box/src/frontend/src/router.tsx:1-69` uses code-based TanStack Router
  routes and Zod search validation. Reuse this pattern, not the issue's stale
  reference to React Router.
- `callback-box/src/frontend/vite.config.ts:10-60` documents prefix-aware Vite
  and HMR behind the router. Reuse the base-path behavior at `/workstreams/`.
- `callback-box/src/frontend/src/components/ui/` contains useful visual
  primitives, but it is private application source rather than a package. The
  app does not import, extract, or share that code. It reuses patterns only.
- `bin/router-docs.ts:823-894` reads `dev/` directly from each checkout without
  waking it. Preserve this property.
- `pnpm-workspace.yaml:16-27` enumerates workspace packages. Add the new package
  explicitly so installs, lint, typecheck, and builds are owned at the root.

## Prior art (external)

- Fastify provides an explicit route table, schema validation, hooks, and
  injectable HTTP tests. These solve the concrete gaps in the current ad hoc
  handler: <https://fastify.dev/docs/latest/Reference/Routes/> and
  <https://fastify.dev/docs/latest/Reference/Server/>.
- tRPC has an official Fastify adapter. It keeps frontend and backend procedure
  types in one package: <https://trpc.io/docs/server/adapters/fastify>.
- Vite documents custom backend integration and a build manifest. Development
  can proxy Vite assets; a built Fastify app can serve hashed assets from the
  manifest: <https://vite.dev/guide/backend-integration.html>.
- TanStack Router supports a base path and typed, Zod-validated search state.
  This fits the existing filter and selected-issue URL contract:
  <https://tanstack.com/router/latest/docs/api/router/RouterOptionsType> and
  <https://tanstack.com/router/latest/docs/framework/react/guide/search-params>.
- TanStack Query owns request caching, mutation state, retries, and explicit
  invalidation. This replaces hand-written fetch and dirty-state coordination:
  <https://tanstack.com/query/v5>.
- No external pattern removes the bootstrap circularity. The resident app still
  depends on the main checkout install, so the router must remain able to report
  that the app cannot start.

## Tracks / scope

### Track A — Package and typed domain boundary

**What.** Add a top-level `workstreams-app/` workspace package. It contains a
Fastify backend, tRPC router, Zod schemas, and separately built React frontend.

**Why this needs to change.** The current view module owns transport, parsing,
filesystem reads, child processes, HTML, and browser behavior. That prevents a
real API contract and makes each new mutation repeat security-sensitive work.

**Direction.** Define `WorkstreamSummary`, `WorkstreamDetail`, `IssueSummary`,
`PlanSummary`, `QuotaSnapshot`, and discriminated lifecycle job states at the
server boundary. Put data assembly behind injected `WorkstreamsService` and
`IssuesService` interfaces. The production adapter shells through
`bin/workstreams list --json --include-removed` for joined workstream state. It
validates stdout before use and reports failures with bounded stderr context.
Tests use injected command results and temporary repositories. tRPC is the
default request/response boundary. A server-sent event or subscription is added
only if bounded polling proves inadequate for lifecycle progress.

**First implementation chunk.** Scaffold the workspace package, schemas,
service interfaces, Fastify `buildApp()` factory, health endpoint, and doctests.
No production route changes occur in this chunk.

### Track B — Resident process and authenticated proxy

**What.** Start one resident app for the main checkout and proxy
`/workstreams/*` to it after the existing router authorization decision.

**Why this needs to change.** The app needs its own dependency and failure
domain, but users must keep the stable URL and existing owner-only mutations.

**Direction.** Add a small supervisor with explicit `starting`, `ready`,
`restarting`, `failed`, and `stopped` states. The router binds the app to
loopback on an internal port. It strips no public path prefix. It forwards the
authenticated request only after `classifyRouterRoute` accepts it. It never
forwards trust in a client-supplied identity header. The app rejects direct
requests without a router-generated per-process capability.

The supervisor watches only the main checkout files that build the workstreams
app. A landed commit that changes those files triggers a graceful app-only
restart. It does not require a router restart. Coalesce bursts from merges and
installs, wait for the tree to become quiet, and keep serving the fallback while
the replacement starts. A periodic source fingerprint reconciles missed watcher
events. Frontend-only edits flow through Vite HMR. Backend edits set a pending
restart. The supervisor does not restart a healthy backend while it owns an
active lifecycle job or serves an in-flight mutating procedure; it restarts
after every mutation is settled and all jobs reach a terminal state. A
crashed backend loses its in-memory progress record, and the UI reports the
interrupted job instead of claiming completion. Changes to router code still
require the boxholder to restart the shared router.

The resident runtime is one Fastify backend plus one Vite development server,
matching callback-box development. It serves source from the main checkout and
does not run a production bundle. Root post-merge installation owns dependency
updates. If dependencies are not ready, health stays failed and the fallback
reports that condition. Production-like verification runs `vite build`, but the
shared router does not build in response to an HTTP request or file event.

If the app is unavailable, the router serves buildless HTML containing the app
state, last failure, log path, and retry action. The root router page keeps a
small worktree/process summary so loss of the app does not remove diagnostics.

Disable tRPC batching. Classify API GET queries as `control-read` and POST
mutations as `control`; deny other methods. The router strips incoming internal
headers, then injects the per-process capability after authorization for TCP and
UDS callers.

**First implementation chunk.** Add the supervisor, capability, health wait,
proxy, watched app-only restart, active-job deferral, periodic reconciliation,
fallback page, and dependency-injected router tests behind an opt-in development
flag. The existing renderer remains the default until Track E.

### Track C — Read-only React surfaces

**What.** Implement the workstreams list/detail, issues list/detail pane, plans,
manual-testing queue, quotas, search, filters, and selected-item URL state.

**Why this needs to change.** These are already client applications expressed
as HTML strings and a growing hand-written script.

**Direction.** Use React 18, TanStack Router, TanStack Query, Vite, Zod, and the
React Compiler. Reproduce callback-box design patterns and semantic tokens in
app-owned components. Do not import, extract, or publish callback-box UI code.
Encode filters and selected issue paths in validated search params. Give every
query an explicit freshness rule. Quotas remain demand-led and preserve the
provider cache rules. Repository state invalidates after mutations and may refresh on
window focus; it does not poll continuously while hidden.

**First implementation chunk.** Build the shell and read-only workstreams list
against fixture service data, then prove prefix navigation and full-height pane
scrolling in a standalone browser on a non-router port.

### Track D — Mutations and lifecycle progress

**What.** Port workstream actions, issue staging/save/reset, priority and next
action editing, archive/close/focus/resume, and manual-test confirmation.

**Why this needs to change.** These actions mutate git repositories and launch
terminal sessions. They require visible pending, success, and failure states.

**Direction.** Keep writes server-authoritative. Validate each target and
precondition. Issue edits remain browser-staged until Save, then one server
transaction writes and commits the selected files. Model the backend resume job
as a discriminated union plus pure transition function. Use XState only in the
frontend if coordinating request, polling, reload recovery, and rendered
progress warrants it. The phases are user-visible: request accepted, worktree
restoring, dependencies ready, terminal opening, terminal opened, or failed.
The server keeps bounded job records and exposes terminal states.

**First implementation chunk.** Port issue staging/save/reset with conflict
detection and doctests. Port lifecycle mutations only after that smaller write
path proves the transport and error contract.

### Track E — Cutover and compatibility

**What.** Cut over the existing workstreams, issues, plans, and testing URLs.
Keep all `/dev/` handling, including the docs browser, in the router.

**Why this needs to change.** The new app must replace the interactive renderer
without breaking stable bookmarks or removing buildless diagnostics.

**Direction.** After parity checks, make the app path the default and remove
`serveWorkstreams`, its embedded scripts/styles, and the migrated issue view.
Preserve existing `/workstreams/` URLs and safe query state. The root router
page keeps its buildless diagnostic list. A separate follow-up issue owns moving
the docs browser later.

**First implementation chunk.** Add compatibility route tests and switch the
proxy flag in a production-like alternate-port rehearsal.

### Track F — Operational ownership and documentation

**What.** Integrate install, build, lint, typecheck, test, logging, and shutdown
with root workflows. Document the failure boundary and local test commands.

**Why this needs to change.** A resident app that silently depends on stale or
missing build output is harder to recover than the current buildless UI.

**Direction.** Development runs backend plus Vite under the router supervisor.
Production-like verification builds the frontend and starts a test Fastify
backend against those assets on an alternate port. This is a verification mode,
not the resident runtime.
The router log identifies app lifecycle events; the app has structured request
and action logs without issue bodies or private paths. Root install owns all
dependencies. The router never runs package installation in response to an HTTP
request.

**First implementation chunk.** Add package scripts and root aggregators with
failure-propagation tests before enabling the app by default.

## Could this be simpler?

The simplest plausible change is to keep `bin/router-workstreams.ts` as the
backend and replace only its HTML strings with a Vite React bundle. That avoids
a process, proxy, capability, and API package.

It does not solve the issue's routing, validation, failure-domain, or bootstrap
concerns. It also leaves destructive actions inside the same process that must
diagnose broken worktrees. The separate resident process buys a real validated
boundary and independent failure handling, per principles 3, 4, and 10.

The fuller plan does **not** modernize all router dispatch. Fastify inside the
app solves app routes. The dependency-light bootstrap router stays custom. A
general router framework migration is a separate decision and is not required
to extract this product.

## Subplans (when a sub-question needs its own design step)

No subplan is required. Shared callback-box UI code and the docs-browser move
are explicitly separate work.

## Failure modes (the load-bearing section)

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Main install is absent or broken | Add supervisor doctest | Buildless fallback with exact command/log | Clear |
| App process exits after startup | Add lifecycle doctest | State changes to failed; proxy returns fallback | Clear |
| Landed backend update arrives while requests are active | Add watcher/lifecycle doctest | Coalesce, drain, stop, replace; fallback remains visible | Clear |
| Landed backend update arrives during resume | Add lifecycle doctest | Mark restart pending until the job reaches a terminal state | Clear |
| Install exposes a temporarily incomplete app tree | Add quiet-period doctest | Delay restart until relevant files settle | Clear |
| Watcher misses a filesystem event | Add reconciliation doctest | Periodic source fingerprint schedules the missed restart | Clear |
| Direct request bypasses router auth | Add route doctest | Loopback plus per-process capability rejects it | Clear |
| Router forwards a newly added mutation as a read | Extend auth table test | Default unknown denies it | Clear |
| CLI JSON shape drifts | Add schema doctest | Boundary validation rejects with command context | Clear |
| Checkout disappears during a read | Add filesystem doctest | Typed not-found response; refresh list | Clear |
| Issue changes after browser staging | Add mutation doctest | Revision precondition rejects; retain draft | Clear |
| Save writes some files then fails | Add repository doctest | Preflight, atomic file writes, one commit or rollback | Clear |
| Resume takes minutes | Add state-machine doctest | Named progress phases and bounded status history | Clear |
| Terminal launch cannot be observed | Add fake launcher doctest | Distinguish requested/opened/failed; do not claim focus | Clear |
| Quota provider is slow or unavailable | Extend quota doctest | Preserve provider caches; mark last good snapshot stale | Clear |
| A query refetches while tab is hidden | Add browser instrumentation check | Disable intervals; focus/demand invalidation only | Clear |
| Old URL is bookmarked | Add redirect table doctest | Stable redirect preserving safe query state | Clear |
| Browser remains open across an app restart | Add supervisor and browser checks | Backend and Vite restart as one generation; failed API requests remain visible and Vite's normal reconnect reloads the page | Clear |

There is no accepted critical gap. Physical Terminal opening and real shared
router behavior still require boxholder acceptance; automated tests use fakes.

## Agent-flow / user-flow edge cases

- Two browser tabs edit the same issue. The second save gets a revision conflict;
  it never overwrites the first silently.
- An agent modifies issue frontmatter in a worktree while the human views main.
  The selected workstream overlay remains the precedence rule and is labeled.
- A workstream is removed between list rendering and resume. Resume re-resolves
  registry and git state and reports the recovery phase.
- A lifecycle request survives a page reload. Its job ID stays in the URL or
  query cache long enough to reconnect to bounded server status.
- A process reaches “terminal requested” but macOS automation does not open a
  tab. The UI does not report “opened” without positive launcher evidence.
- The main checkout is dirty for unrelated reasons. Issue Save uses the shipped
  path-scoped commit behavior and blocks only when a selected issue file has
  conflicting staged or unstaged edits
  (`workstreams-app/src/server/issues-mutation-service.ts`).
- A private issue appears in a worktree overlay. The API preserves visibility
  and never includes private content in logs or public search results.
- A hidden quota panel remains closed for days. It does not poll. Opening it
  requests server state; existing caches remain one minute for Codex and ten
  minutes for Claude (`bin/agent-quotas.ts:64-65`).
- An app update and browser tab cross generations. The supervisor replaces the
  backend and Vite processes together. Vite's development client reconnects and
  reloads the page; an API request that overlaps replacement fails visibly and
  can refetch after reload or focus. The health build ID is diagnostic only:
  there is no app-specific client/backend mismatch detector.

## NOT in scope

- Replacing the router's UDS/TCP capability model, outer authentication, box
  proxy, or worktree concurrency protocol.
- Converting the entire router to Fastify, Hono, or another framework.
- Moving any `/dev/` surface, including the docs browser, raw or scripted
  `dev/*.html`, or `dev/tools.json` into React.
- Sharing or extracting source code between callback-box frontend and this app.
- Changing workstream registry semantics, culling policy, issue vocabulary,
  priority values, quota providers, or terminal automation.
- Adding a database. Git and registry files remain sources of truth.
- Server rendering, offline/PWA support, or a public multi-user deployment.
- Importing private callback-box frontend modules across package boundaries.

## Open design questions

None. The boxholder locked these decisions on 2026-08-13:

- Reuse callback-box patterns, not callback-box source code.
- The router supervises and authenticates the resident app.
- Landed app changes restart the app without restarting the router.
- A private HTTP API exposes router-owned live state.
- This plan does not change the agent-facing `bin/workstreams` surface.
- `/dev/docs/` remains in the router for now and has a follow-up issue.
- The broad router-architecture issue remains open after app extraction.

## Knowledge audits

No knowledge audit is required. The change affects developer infrastructure and
human UI, not knowledge loaded by a box agent. Update root and `bin/` guidance so
future coding agents can locate the package, test it, and preserve the bootstrap
boundary. Validate those docs with `pnpm --dir callback-box doc-check`.

## Implementation order

1. Track A: package, domain schemas, injected services, Fastify factory, health.
2. Track B: resident supervisor, capability, proxy, app-only restart watcher,
   and fallback behind a flag.
3. Prove that the watcher ignores unrelated main changes, coalesces a landed app
   update, defers for active jobs, reconciles a missed event, and replaces the
   child without restarting the router.
4. Track C: read-only shell and views on a standalone test port.
5. Track D1: issue staging, conflicts, Save, Reset, and commit behavior.
6. Track D2: remaining mutations and lifecycle progress state machine.
7. Track E: compatibility and cutover.
8. Track F: root scripts, structured logs, build ownership, operator docs.
9. Run package tests, root lint/typecheck/test, route doctests, and built-asset
   smoke tests. Run the router app on an alternate port and browser-test every
   view, mutation pending/error state, URL restoration, full-height panes, and
   narrow viewport.
10. Run a cross-model review of the implementation diff. Resolve findings.
11. With the boxholder, enable the new default and rehearse router restart,
    app failure fallback, issue save, workstream resume, Terminal opening, and
    recovery from a broken main install. Do not self-certify this step.
12. Remove the old renderer and flag only after parity is demonstrated. Update
    issue and reference docs. Commit each numbered track as a bisectable chunk.

## Rollout shape

This plan ships as one completed change, but uses a reversible in-branch flag.
During implementation the legacy renderer remains the default. Before removal,
the new app runs at an internal test path and alternate port. The cutover keeps
the public `/workstreams/` URLs stable.

Rollback before merge selects the legacy renderer. Rollback after merge reverts
the cutover/removal commit; the router fallback remains available either way.
The initial router-supervisor implementation requires one boxholder router
restart. After that, landed workstreams-app changes restart only the child. No
worktree agent restarts the shared router.

## Review

Claude Fable reviewed this plan on 2026-08-13 after the boxholder decisions.
The review found eight items:

1. **Accepted:** use `bin/workstreams list --json`; do not invent TypeScript
   domain modules for its deliberately single-source Bash liveness join.
2. **Accepted:** specify the resident runtime. It is Fastify plus Vite in
   development; production build is a verification mode.
3. **Accepted:** defer automatic backend restarts during active lifecycle jobs
   and in-flight mutations, then reconcile missed watcher events with a periodic
   fingerprint.
4. **Accepted:** define tRPC method classification at the outer auth gate and
   disable batching.
5. **Accepted:** use a backend discriminated union, not backend XState.
6. **Accepted:** remove the impossible non-loopback-request case and specify
   capability injection after internal-header stripping.
7. **Accepted:** preserve the different Codex and Claude quota cache periods.
8. **Accepted, source was newer than the original issue:** preserve the shipped
   path-scoped issue commit and selected-file conflict checks.

No review finding remains unresolved.

Claude Fable reviewed the implementation diff on 2026-08-13. The review found
ten items, all resolved before the final verification pass:

1. Issue paths now have strict shared schema validation plus canonical
   resolve-under-root, regular-file, extension, and symlink containment checks.
2. Legacy `/workstreams/issues/<path>` links redirect into SPA query state,
   preserving private visibility.
3. Workstream issue ownership, discovery, and activity are computed by the
   server instead of being reconstructed incorrectly in the browser.
4. Restart deferral counts every in-flight mutation, including issue saves.
5. Watcher and fingerprint exclusions agree and ignore Vite/install/test cache
   churn.
6. Public and private issue identity includes both visibility and relative path
   in staged edits and URL state.
7. The remaining legacy issue implementation was removed; the resident app is
   the sole issue-domain and issue-mutation implementation.
8. The `needs` filter is applied and represented in active filter state.
9. Boundary doctests now cover traversal, symlink escape, private isolation,
   capability rejection, conflicts, scoped commits, and atomic-write rollback.
10. The false build-ID mismatch claim was removed. The documented contract is
    coordinated backend/Vite replacement with visible overlapping failures and
    Vite's normal reconnect reload.

Recommendation: proceed to the isolated-router and boxholder rehearsals because
the independent review's security, compatibility, and lifecycle findings are
now implemented and covered by focused tests.
