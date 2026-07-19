# Hub `/healthz` reflects box-child health

The hub's `/healthz` cannot report a failure: its status field is the literal
`"ok"`, and the per-box supervisor state it already returns is evaluated by
nothing. It is also served unauthenticated, publicly leaking slugs, PIDs,
ports, and error strings. This plan derives the hub's health verdict from
supervisor state, closes the auth leak, adds a diag-gated **canary** route that
actively cold-starts one box so a child-level startup failure is detected, and
makes `deploy.sh` evaluate both.

The originating incident: during the Node 22→24 upgrade (2026-07-16) every
per-box `cb serve` child crash-looped on a better-sqlite3 ABI mismatch while
`/healthz` returned 200 throughout. See
`issues/closed/bugs/2026-07-16-healthz-blind-to-box-children.md`.

**This is the second draft.** The first proposed a `/livez` route on the box
server plus a recurring liveness probe of every already-running box on each
`/healthz` hit. A cross-model (codex) review found the probe was a second
feature that did not fix the incident better than supervisor-state aggregation,
introduced an idle-shutdown race, and — critically — that the endpoint it hung
off is public. The probe and `/livez` are **cut**; see NOT in scope for the
full rationale. The verdict, the auth fix, and an explicit canary remain.

## Stated preferences this plan trades against

- **Principle 1, types are structure** (`docs/engineering-principles.md:12`):
  *"Prefer types that make illegal states unrepresentable ... literal unions
  (`"warn" | "review" | "abort"`) over a bare `string` discriminator."* The
  current `status: "ok"` literal is a one-member union. The verdict is
  *derived* from `BoxRunStatus`, not stored as a second field that could
  contradict it — the first draft's separate `probe` field permitted
  `stopped + ok` and similar illegal combinations, which this draft avoids by
  computing rather than storing.
- **Principle 2, exhaustiveness is enforced** (`:23`): the verdict function
  dispatches over `BoxRunStatus`, a closed set, with `assertNever`. Adding a
  run status must fail to compile, not be silently treated as healthy.
- **Principle 4, resilient AND never silent** (`:49`): *"Degradation is
  allowed for failures that can genuinely happen; invisible degradation is
  not."* A stopped box is genuine, expected degradation; a crash-looping one
  is a failure being reported as health. This is the principle the plan serves.
- **Principle 3, validate at boundaries** (`:37`): `deploy.sh` reads an HTTP
  body — a boundary. It currently reads only the status code.
- **Principle 6, right-sized defensiveness** (`:75`): argues *for* cutting the
  recurring probe (a monitoring subsystem the incident did not require) and
  *for* the canary being one box, diag-gated, deploy-only.
- **The boxholder's fail-closed / strict-by-default steer** (this session):
  a health check that cannot tell healthy from broken is worse than none; and
  a leaking endpoint gets closed even though the leak predates this plan.
- **`callback-box/CLAUDE.md`'s** "HTTP endpoints go in tRPC by default ... Raw
  Fastify routes ... only for things that don't fit": the canary and `/healthz`
  are hub-server routes, not box tRPC — the hub has no tRPC surface, and these
  are diagnostic endpoints on the router itself.

## What already exists

- `src/cli/commands/hub.ts:79` — `const getHealth = (): HubHealth => ({ status:
  "ok", boxes: supervisor.getStatuses() });`. The verdict is a constant.
  **Rebuilt** (it's one expression).
- `src/hub/hub-server.ts:72-75` — `export interface HubHealth { status: "ok";
  boxes: BoxRuntimeStatus[]; }`. **Reused, widened.**
- `src/hub/hub-server.ts:252` — `app.get("/healthz", async (_request, reply) =>
  reply.send(getHealth()));`. Unconditional 200, no auth. **Reused, gated, given
  a status code.**
- `src/hub/supervisor.ts:49-57` — `BoxRuntimeStatus` carries `slug`, `status`,
  `pid`, `port`, `restarts`, `lastError`. **Reused**, plus one new exported
  field: `consecutiveFailures`, already tracked internally at `:65`, incremented
  at `:456`/`:481` and reset to 0 on a successful launch (`:442`).
- `src/hub/supervisor.ts:232` — `async ensureRunning(slug)` cold-starts a
  stopped box and waits for readiness, coalescing concurrent callers.
  **Reused verbatim** — it is exactly the canary's mechanism. On a non-lazy hub
  it degrades to `get()` (`:235`), so the canary works on both hub flavors.
- `src/webapp/auth.ts:62-70` — `verifyDiagBearerKey(request)`, constant-time
  bearer check, false when `CB_DIAG_API_KEY` is unset. **Reused** to gate both
  hub routes, mirroring the box server's own `/healthz`
  (`src/webapp/server-root.ts:141-147`).
- `src/webapp/auth.ts:51-53` — `isAuthEnabled()`. Not needed by the routes
  (diag key is independent of OAuth), noted because the canary's
  can't-drive-a-box-through-the-hub constraint stems from `decideHubAuth`
  (`src/hub/hub-server.ts:216`) honoring only session cookies — see Track B.
- `test/hub/hub-router.doctest.md` — hub routes tested against a
  `staticEndpointProvider` and a real `Supervisor`. **Reused** as the pattern
  for the verdict and canary tests.
- `test/webapp/healthz-schema-failures.doctest.md:1-8` — the internal precedent
  for rolling a per-box condition into `/healthz`, with its own regression
  trap. **Reused as the test-shape pattern.**
- `deploy/deploy.sh:551-579` — the verification block. **Rebuilt.**

## Prior art (external)

- **Kubernetes deprecated its API server's `/healthz` in v1.16 in favor of
  `/livez` and `/readyz`**, because one endpoint conflating liveness and
  readiness cannot distinguish "restart this" from "stop routing to this".
  The review cited this *against* the first draft: publishing child-readiness
  failure through the hub's liveness endpoint is exactly the conflation the
  split exists to avoid. This draft keeps `/healthz` as the hub's own liveness
  verdict and does **not** let one broken child claim the hub itself is
  process-dead — see the verdict table's treatment of `stopped`, and NOT in
  scope on restart semantics.
  <https://kubernetes.io/docs/reference/using-api/health-checks/>
- **kiali issue #3493, "Idle status taking precedence over degraded health
  status"** — a real instance of this plan's hazard: an idle state masking a
  degraded one in an aggregate. Confirms idle-vs-broken is a known aggregation
  failure, not a quirk of our lazy hub.
  <https://github.com/kiali/kiali/issues/3493>
- **Health-aggregation state sets in the wild use four states — healthy,
  degraded, unhealthy, and *unknown*** — rather than a boolean, supporting
  treating `stopped` as an explicit unknown rather than folding it into either
  pole.
  <https://oneuptime.com/blog/post/2026-02-01-go-service-health-aggregation/view>
- **Searched and found nothing for** a lazy-supervisor health-aggregation
  pattern specific to per-tenant child processes. Closest analogues are
  serverless cold-start readiness discussions, which assume an external
  orchestrator owns the lifecycle; ours is in-process. No pattern to adopt.

## Tracks / scope

Ordered by implementation dependency: Track A is the derived verdict + auth
gate, Track B the canary (depends on A's gating helper), Track C the deploy
consumer (depends on both).

### Track A — a derived, gated health verdict

**What.** Replace the constant verdict with one computed from supervisor state,
give `/healthz` a status code that reflects it, and require the diag bearer key.

**Why this needs to change.** Two defects. (1) The supervisor already knows a
box is crash-looping or has latched `unhealthy` (`src/hub/supervisor.ts:480`)
and nothing reads it. (2) The endpoint is public: `src/hub/hub-server.ts:252`
registers it with no key check, and nginx proxies `/` straight to the hub
(`deploy/setup-server.sh:312-313`), so slugs, PIDs, ports, and `lastError`
strings are internet-readable today. The box server's own `/healthz` already
requires the key (`src/webapp/server-root.ts:141-147`); the hub's diverged.

**Direction.**

```ts
export type HubVerdict = "ok" | "unhealthy";

export interface HubHealth {
  status: HubVerdict;
  boxes: BoxRuntimeStatus[];   // now includes consecutiveFailures
}
```

`BoxRuntimeStatus` (`src/hub/supervisor.ts:49`) gains `consecutiveFailures:
number`. The verdict, per box, dispatching exhaustively over `BoxRunStatus`
(`src/hub/supervisor.ts:47`):

| `status` | condition | box is broken? |
|---|---|---|
| `running` | — | no (supervisor proved readiness at launch; ongoing crash is caught by the exit handler flipping it off `running`) |
| `starting` | `consecutiveFailures > 0` | **yes** — crash-looping now |
| `starting` | `consecutiveFailures === 0` | no — booting |
| `stopped` | — | no — unknown, expected resting state |
| `unhealthy` | — | **yes** — crash budget latched |

`status` is `"unhealthy"` if any box is broken, else `"ok"`. HTTP **503** when
unhealthy, **200** otherwise, so a monitor reading only the code still alarms.
Gating mirrors the box server exactly: **503 `unconfigured`** when
`CB_DIAG_API_KEY` is unset, **401** when the key is wrong/absent, else the
verdict. `getHealth` stays synchronous — no network, no side effects.

`restarts` deliberately does **not** feed the verdict: it is a lifetime counter
(`src/hub/supervisor.ts:503`, `box.restarts += 1`) that never resets, so keying
on it would pin the hub red forever after one old blip. `consecutiveFailures`
is the live signal; `restarts` stays informational in the body.

**Why `running` is trusted without a probe.** The first draft probed running
boxes to catch a wedged-but-listening child. The review's judgment, which this
draft accepts: the incident crashed children *before* they reached `running`
(`checkReady` times out → launch fails → `unhealthy`), so the verdict alone
catches it; a running box that wedges its event loop while still holding its
port is a real but distinct failure not worth a per-request network fan-out
behind a public endpoint. Documented in NOT in scope.

**First implementation chunk.** `consecutiveFailures` on `BoxRuntimeStatus`;
the pure verdict function with `assertNever`; `HubHealth` widened; `hub.ts:79`
rewired; the route gated and given 200/503. Verdict function unit-tested
directly (it's pure over `BoxRuntimeStatus[]`); route tested in
`hub-router.doctest.md`.

### Track B — a diag-gated canary that cold-starts one box

**What.** Add `GET /healthz/canary` to the hub, diag-gated, which calls
`ensureRunning(slug)` for one configured box and returns 200 if it reaches a
live endpoint, 503 otherwise.

**Why this needs to change.** The passive verdict (Track A) only sees boxes the
supervisor already tried to start. On a lazy hub most boxes rest `stopped`
(prod: `keepRecent: 1`, 4 of 5 stopped), reporting nothing. A fleet-wide
startup break like the ABI mismatch is invisible to the passive verdict on any
box that was never started. The first draft tried to close this by leaning on
`prestartLazy` always starting the `keepRecent` box — but the review showed
that guarantee is false: `prestartLazy` starts only *persisted* slugs
(`src/hub/supervisor.ts:189-192`) and the first-boot / empty-state /
corrupt-state case starts **zero** boxes (proven by
`test/hub/supervisor.doctest.md:403`, and `hub-state.json` load returns an empty
map on any read failure). So the deploy needs to *actively* start a box, not
hope one was started.

It cannot do so through a normal request: prod runs with auth on
(`GOOGLE_OAUTH_CLIENT_ID` set), and `decideHubAuth`
(`src/hub/hub-server.ts:216`) authorizes only via session cookie — a box path
carrying just the diag bearer key is redirected to login (verified against the
live server: `GET /box-family/healthz` with the diag key returns 302). Hence a
dedicated diag-gated hub route that drives `ensureRunning` server-side.

**Direction.**

```ts
// hub-server.ts, gated by verifyDiagBearerKey exactly like /healthz
app.get("/healthz/canary", async (request, reply) => {
  // 503 unconfigured / 401 unauthorized, same as /healthz
  const slug = (request.query as { box?: string }).box ?? endpoints.slugs()[0];
  if (!slug) return reply.status(503).send({ status: "no-boxes" });
  const endpoint = await endpoints.ensureRunning?.(slug) ?? endpoints.get(slug);
  if (!endpoint) {
    return reply.status(503).send({ status: "canary-failed", slug });
  }
  return reply.send({ status: "ok", slug });
});
```

`?box=` lets the deploy name the canary; unset picks the first configured slug.
On a lazy hub `ensureRunning` cold-starts and waits; on a non-lazy hub it's
`get()` and the box is already up. During the ABI incident this returns 503
(the child crash-loops, `ensureRunning` never gets a live endpoint) — the exact
signal the deploy needed.

**Route ordering / slug collision.** `GET /healthz/canary` is a more specific
path than the catch-all `/*` and than `/healthz`; Fastify matches it before the
proxy catch-all, so no box named `healthz` is involved (and `healthz` is
already reserved — `src/hub/hub-config.ts:35-40`). No new reserved slug is
needed: `canary` never appears as a top-level segment. This is the concrete
defect the review caught in the first draft's `/livez` (which *would* have
needed `livez` reserved); the sub-path shape sidesteps it.

**Side effect — the canary leaves one box running.** `ensureRunning` arms the
idle timer, so the canaried box stays resident for `idleMs` (prod: 30 min)
after a deploy, then idle-stops normally. One box for 30 min post-deploy is
acceptable and is typically the `keepRecent` box anyway. Noted, not mitigated.

**First implementation chunk.** The route, sharing a small `requireDiagKey`
helper with Track A's gating. Tested in `hub-router.doctest.md` with a real
lazy `Supervisor` + fake `spawnChild`/`checkReady`: a slug that comes ready →
200; a slug whose fake child never becomes ready → 503.

### Track C — deploy verification that reads the body and canaries a box

**What.** Rewrite `deploy/deploy.sh:551-579` to poll longer, parse the
`/healthz` body, then hit `/healthz/canary`.

**Why this needs to change.** Three defects in one block:

1. **It reads only the status code** (`deploy.sh:567`, `if [ "$body" = "200"
   ]`). Even after Track A it would pass on a 200 it never inspected.
2. **The 30s poll raced the hub's boot** (`deploy.sh:563`, `for i in $(seq 1
   30)`). Not generic slowness: `src/cli/commands/hub.ts:58` does `await
   supervisor.startAll()` *before* creating the server, and a failing launch
   blocks on `READY_TIMEOUT_MS` (`src/hub/child-spawn.ts:51`, 30s) before
   giving up — so the hub does not answer *precisely when a box is failing*.
   The incident's "healthz FAILED" was the crash timing out, misread as deploy
   flakiness.
3. **It never verifies a child** — the issue's core complaint.

**Direction.** Poll `/healthz` (with the diag key) for up to 180s. On the first
response, parse the body with `node -e` (**not** `jq` — verified absent on the
server; `node` v24.18.0 present) and fail unless `status === "ok"`. A box
`starting` with `consecutiveFailures > 0` makes `status` `unhealthy`
immediately, so the deploy fails fast rather than waiting out the ~2.5-3 min
crash-loop latch. Then `GET /healthz/canary` (diag key); require HTTP 200.
On any failure, echo the parsed body so the offending slug and its
`lastError` land in the deploy log — the diagnostic whose absence made the
original incident hard to read.

**First implementation chunk.** The whole block; one heredoc.

## Subplans

None. Track A is one pure function plus a route gate, Track B is one route
reusing `ensureRunning`, Track C is a shell rewrite. No sub-question needs its
own design step.

## Failure modes

**Critical gap: none outstanding.** The two accepted residual risks
(wedged-but-listening running box; fleet-wide idle blindness between deploys)
are documented below with rationale.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A box crash-loops at startup (the incident) | Yes — verdict unit test + `hub-router.doctest.md` canary 503 case | `unhealthy`/`starting+failures` → 503; canary → 503 | Clear — slug + `lastError` in body and deploy log |
| A running box wedges its event loop but keeps its port | No — accepted | Not detected (no probe) | **Silent** — accepted residual, see below |
| Every box is `stopped` (genuinely idle) and a latent break exists | N/A — accepted | Passive verdict says `ok`; **canary actively starts one and would catch a fleet-wide break** | Clear at deploy (canary), silent between deploys until first real request |
| `hub-state.json` is empty/corrupt so `prestartLazy` starts nothing | Covered by not depending on it | Canary starts a box explicitly; deploy no longer relies on prestart | Clear — this is the first draft's critical bug, fixed by Track B |
| Diag key unset in prod `.env` | To add: doctest asserting 503 `unconfigured` | Both routes 503 `unconfigured`; deploy's existing "skip if no key" branch stays | Clear |
| `deploy.sh`'s `node -e` hits malformed JSON | No | Parse failure exits non-zero → deploy fails | Clear — fail-closed, body echoed |
| A future `BoxRunStatus` member defaults to "healthy" | Compile-time | `assertNever` in the verdict switch | Clear — build breaks (principle 2) |
| Canary picks a slug that is legitimately slow to cold-start, exceeding readiness timeout | Partially — the ready/not-ready doctest cases | `READY_TIMEOUT_MS` (30s) is the same budget a real request gives; 180s deploy poll wraps it | Clear — canary 503 names the slug |
| Hub `/healthz` now 401s a pre-existing unauthenticated monitor | N/A | Behavior change, documented in `deploy/README.md` | Clear — monitor gets 401, operator adds the key (already used for external checks per `deploy.sh:585`) |

**Accepted risk — wedged-but-listening running box.** Dropping the probe means
a box that reaches `running` and then blocks its event loop while still holding
its port is not detected. Rationale: the incident's failure mode (crash before
`running`) *is* caught; this distinct mode did not occur, and catching it cost a
per-request network fan-out behind a public endpoint (principle 6). If it
recurs, a probe can be added later as its own plan.

**Accepted risk — fleet-wide idle blindness between deploys.** Between deploys,
if every box is `stopped`, the passive verdict cannot distinguish a healthy idle
fleet from a broken one, and this plan does not wake boxes on a monitor hit. The
moment that matters — a deploy — is covered by the canary. Between deploys a
break surfaces on the first real request that lazy-starts a box and fails. This
is the deliberate trade over an always-probe-everything design.

## Agent-flow / user-flow edge cases

Infrastructure plan: no card type, tag, or field; no agent reads or writes what
it produces. Most scenarios are structurally inapplicable — stated, not faked.

- **Wrong tag / wrong field** — **N/A.** No agent-selected vocabulary.
- **Stale ref** — **N/A.** No refs.
- **Two agents touching the same card** — **N/A.** No cards.
- **Hand-edit drift** — **ADDRESSED where it applies.** `hub.json` is
  hand-edited. A `?box=` naming a slug not in `hub.json` makes `ensureRunning`
  return undefined → canary 503, naming the slug: a clear failure, not a
  vacuous pass. An empty `boxes` map → canary 503 `no-boxes`.
- **Fabricated free-form value** — **ADDRESSED by construction.** Every field is
  machine-derived from supervisor state; no free-form field exists.
- **Validation error UX** — **ADDRESSED.** The consumer is `deploy.sh`; on
  failure it echoes the parsed body so the failing slug and `lastError` reach
  the deploy log.
- **Partial migration / transition state** — **ADDRESSED.** The transition is a
  hub restart, during which the hub does not answer at all (`hub.ts:58` blocks
  `listen`), so no caller sees a half-migrated body. Hub and children share one
  engine build (all boxes symlink `/opt/callback/callback-box`), so the new
  body shape and its only consumer (`deploy.sh`) ship together.

## NOT in scope

- **A recurring liveness probe of running boxes / a `/livez` route on the box
  server** (both in the first draft). Cut after review: the probe was a second
  feature that did not fix the incident (which crashes children before
  `running`, already caught by the verdict); it introduced a genuine
  idle-shutdown race (a health request could snapshot `running`, then probe a
  child `evaluateIdle` had concurrently stopped, and false-report `failed`); and
  it hung network fan-out off a public endpoint. Traces to principle 6.
- **Reordering `startAll()` and `listen()`** so the hub answers during boot.
  Would remove the cold-boot wait, but a hub answering before pre-start finishes
  reports every box `stopped`, which needs a "boot complete" concept that
  doesn't exist. The 180s poll solves the observed problem. Filed as
  `issues/code-quality/2026-07-19-hub-startall-blocks-listen.md`.
- **Restart-on-probe-failure / hub self-healing a wedged box.** A supervision
  policy change with its own failure modes (killing a slow box mid-work);
  its own plan. Keeping `/healthz` as a pure verdict (not a restart trigger) is
  the deliberate liveness/readiness separation the Kubernetes prior art argues
  for.
- **Folding the child's `/healthz` body** (template drift, schema failures) into
  the hub verdict. That data is a drift/monitoring concern, already exposed
  per box; folding it into a liveness verdict is the conflation the prior art
  warns against.
- **Alerting / external monitoring integration.** This plan makes the endpoint
  tell the truth and stop leaking; who watches it is separate.
- **`tech-talk`, on disk at `/home/callback/boxes/` but absent from
  `hub.json`.** Noticed while verifying the fleet; unrelated. Filed as
  `issues/docs-and-chores/2026-07-19-tech-talk-box-not-in-hub-config.md`.

## Open design questions

- **Should the canary check *all* configured boxes, not just one?** Starting all
  5 on every deploy is what the boxholder rejected (memory-constrained host).
  One box proves the engine boots and a child serves — the fleet-wide class of
  break (shared engine, shared native module) shows up on any single box.
  **Lean: one box, `?box=` overridable.** A per-box break (one box's package
  install) is the residual the single canary misses; accept it, or rotate the
  `?box=` slug across deploys later.
- **Should `/healthz` stay gated, given a pre-existing monitor might rely on it
  being open?** **Lean: gate it** (fail-closed, matches the box server, the
  external-check example already sends the key). If a real open-monitor
  dependency surfaces, a minimal unauthenticated hub-only liveness (no box
  detail) can be split out — but don't build that speculatively (principle 4,
  "never resilient to the impossible").

## Knowledge audits

**Skip, with rationale.** Knowledge audits verify a *box agent* can recall a
convention from its context. This plan adds no agent-facing concept: the
verdict, the canary route, and the deploy assertion are engine and deployment
internals no box agent reads, writes, or recalls. The verdict/canary/auth
conventions are maintainer-facing and belong in route doc comments,
`deploy/README.md`, and `docs/health-checks.md`.

## Implementation order

1. **Track A** — `consecutiveFailures` exported; pure verdict function with
   `assertNever`; `HubHealth` widened; `hub.ts:79` rewired; `/healthz` gated +
   200/503. Plus a shared `requireDiagKey` gating helper.
2. **Track B** — `/healthz/canary` route reusing the helper and
   `ensureRunning`. Depends on A's helper.
3. **Tests** — verdict unit test (the table, incl. the high-`restarts`/zero-
   `consecutiveFailures` → `ok` trap); `hub-router.doctest.md` gains the gated
   200/401/503 cases and the canary ready/not-ready cases.
4. **Track C** — `deploy.sh` rewrite. Depends on the final body shape.
5. **Docs** — `deploy/README.md` on what verification now asserts and the new
   401; `docs/health-checks.md` on the verdict semantics and the canary;
   route doc comments carrying the liveness-vs-canary rationale.

Chunks 1-4 are commit boundaries within the worktree, not ship boundaries. The
plan ships as one merge.

## Rollout shape

**Test posture.** Per `docs/testing.md`, tests come first as a design tool.

- **Verdict unit test** (pure function over `BoxRuntimeStatus[]`): a
  crash-looping box (`starting`, `consecutiveFailures > 0`) → `unhealthy`; an
  `unhealthy` box → `unhealthy`; an all-`stopped` idle fleet → `ok`; a
  `running` box with high `restarts` but zero `consecutiveFailures` → `ok`
  (the trap pinning the decision not to key on the lifetime counter).
- **`hub-router.doctest.md`** gains: `/healthz` returns 503 `unconfigured` with
  no key, 401 with a wrong key, the verdict with the right key; `/healthz/canary`
  returns 200 for a slug whose fake child comes ready and 503 for one that never
  does, and 503 `no-boxes` for an empty config. Follows the file's existing
  `staticEndpointProvider`/`Supervisor` setup.

**Done-when**, as checkable assertions: `/healthz` returns 503 naming the
offending slug when a box is crash-looping, 200 when boxes are merely idle, and
401 without the diag key; `/healthz/canary` cold-starts a stopped box and
returns its readiness verdict; `deploy.sh` fails when its canary box cannot
start.

**Migration.** None. No on-disk shape changes; `HubHealth` is a response body
whose only machine consumer is `deploy.sh`, updated in the same plan.

**Deployment ordering.** `deploy.sh` ships in the same commit range as the
engine; all boxes symlink one engine, so the new script and body shape arrive
together. A rollback restores both.
