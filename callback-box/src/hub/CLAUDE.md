# Hub

`cb hub` routes `/<slug>/...` to per-box `cb serve` children (`supervisor.ts`
owns the children, `hub-server.ts` owns HTTP/WS routing + auth, `hub-config.ts`
the `hub.json` schema).

## Health endpoints

`/healthz` reports a derived verdict (`hub-health.ts`'s `hubVerdict`): 503 when
any box is crash-looping or crash-budget-latched, 200 otherwise — a `stopped`
(idle) box is NOT a fault. `/healthz/canary` actively cold-starts one box to
prove a child can serve (what the passive verdict can't see on a lazy hub).
Both are diag-key-gated (`hub-health-routes.ts`) — they used to be open and
leaked slugs/PIDs/ports. The deploy verifies both; full rationale in
`docs/health-checks.md`. Do NOT derive health from `restarts` (a lifetime
counter) — the live signal is `consecutiveFailures`.

## Spawned children get an allowlisted env, not a spread

`child-env.ts`'s `buildChildEnv` is a fail-closed ALLOWLIST: only named vars
(plus a couple of prefixes) reach a spawned box's `cb serve` process. This is
deliberate — the hub process env holds `CB_SESSION_SECRET`, which no box may
see (it's symmetric, so a box that can verify a session cookie could forge
one for a sibling box). A box needing to read a new env var requires adding
it to `CHILD_ENV_ALLOWLIST`/`CHILD_ENV_PREFIX_ALLOWLIST` with a reasoned
comment — never widen this by reverting to a `process.env` spread.

## Lazy mode

`hub.json`'s `lazy: true` flag makes every configured box start "stopped";
`Supervisor.ensureRunning()` cold-starts a box on its first proxied request
and idle-stops it after `idleMs` — the same semantics `bin/router.ts` uses
for dev worktrees. Non-lazy (the default) starts every box resident at hub
boot and never idle-stops them.

`keepRecent: N` (lazy-only; a positive value on a resident hub is a config
error) keeps the N most-recently-used boxes alive instead of idle-stopping
them: when a box's idle timer fires, it re-arms instead of stopping if it's
among the `keepRecent` most-recently-active running boxes (`keepSetSlugs()`),
so it only stops once displaced by more-recently-used boxes. Recency is
persisted to `hub-state.json` (a sibling of the loaded config file — see
`hub-state.ts`): `touch()` records per-slug activity, `stopAll()` flushes it,
and a lazy `startAll()` pre-starts the top-`keepRecent` slugs by persisted
recency so a hub restart (every deploy restarts it) resumes the working set
rather than everything or nothing. Defaults to 0 (pure idle-stop). The
idle-fire decision is factored into `evaluateIdle(slug)` so it's testable
without real timers; the clock is injectable (`SupervisorOptions.now`).

**Chat schedules override idle-stop.** A box holding pending chat `<schedule>`
timers must stay running — they live in its `cb serve` process and a missed
alarm is unacceptable. `evaluateIdle` checks the box's on-disk
`chat-schedules.json` (via `pending-schedules.ts`, reusing the same loader
`cb serve` re-arms from) and keeps a schedule-holding box alive
(`kept-schedule`) even outside the keep-set, re-checking each idle cycle until
the file empties. `startAll` also pre-starts every schedule-holding box at
boot, independent of `keepRecent`, so schedules fire on time after a restart.

## SIGHUP only clears the crash-loop latch

SIGHUP (`Supervisor.reloadUnhealthy()`) gives any box that's exhausted its
restart budget (`status: "unhealthy"`) a fresh one and retries it. It does
**not** re-read `hub.json` — adding or removing a box entry still needs a
full hub restart.
