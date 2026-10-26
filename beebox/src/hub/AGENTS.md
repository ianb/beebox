# Hub

`bbx hub` routes `/<slug>/...` to per-box `bbx serve` children (`supervisor/core.ts`
owns the children, `server/core.ts` owns HTTP/WS routing + auth, `config.ts`
the `hub.json` schema).

## Health endpoints

`/healthz` reports a derived verdict (`health.ts`'s `hubVerdict`): 503 when
any box is crash-looping or crash-budget-latched, 200 otherwise — a `stopped`
(idle) box is NOT a fault. `/healthz/canary` actively cold-starts one box to
prove a child can serve (what the passive verdict can't see on a lazy hub).
Both are diag-key-gated (`server/health-routes.ts`) — they used to be open and
leaked slugs/PIDs/ports. The deploy verifies both; full rationale in
`docs/server/health-checks.md`. Do NOT derive health from `restarts` (a lifetime
counter) — the live signal is `consecutiveFailures`.

## Spawned children get an allowlisted env, not a spread

`supervisor/child-env.ts`'s `buildChildEnv` is a fail-closed ALLOWLIST: only named vars
(plus a couple of prefixes) reach a spawned box's `bbx serve` process. This is
deliberate — the hub process env holds `BBX_SESSION_SECRET`, which no box may
see (it's symmetric, so a box that can verify a session cookie could forge
one for a sibling box). A box needing to read a new env var requires adding
it to `CHILD_ENV_ALLOWLIST`/`CHILD_ENV_PREFIX_ALLOWLIST` with a reasoned
comment — never widen this by reverting to a `process.env` spread.

The same posture applies one level down: what a box's *own* subprocesses
(agents, tricks, scheduled scripts) inherit from the `bbx serve` child is
`src/core/script-env/allowlist.ts`, whose agent profile additionally withholds
every connector credential. Keep the two lists' overlapping entries in sync by
hand.

## Lazy mode

`hub.json`'s `lazy: true` flag makes every configured box start "stopped";
`Supervisor.ensureRunning()` cold-starts a box on its first proxied request
and idle-stops it after `idleMs` — the same semantics `workstreams-app/src/router/server/listener.ts` uses
for dev worktrees. Non-lazy (the default) starts every box resident at hub
boot and never idle-stops them. The server no longer uses the `Supervisor` at
all (every production box is a socket unit, below); the spawning path stays
because the dev router runs on it, so do not retire it as server-only
leftovers.

`keepRecent: N` (lazy-only; a positive value on a resident hub is a config
error) keeps the N most-recently-used boxes alive instead of idle-stopping
them: when a box's idle timer fires, it re-arms instead of stopping if it's
among the `keepRecent` most-recently-active running boxes (`keepSetSlugs()`),
so it only stops once displaced by more-recently-used boxes. Recency is
persisted to `hub-state.json` (a sibling of the loaded config file — see
`supervisor/state.ts`): `touch()` records per-slug activity, `stopAll()` flushes it,
and a lazy `startAll()` pre-starts the top-`keepRecent` slugs by persisted
recency so a hub restart (every deploy restarts it) resumes the working set
rather than everything or nothing. Defaults to 0 (pure idle-stop). The
idle-fire decision is factored into `evaluateIdle(slug)` so it's testable
without real timers; the clock is injectable (`SupervisorOptions.now`).

**Chat schedules override idle-stop.** A box holding pending chat `<schedule>`
timers must stay running — they live in its `bbx serve` process and a missed
alarm is unacceptable. `evaluateIdle` checks the box's on-disk
`chat-schedules.json` (via `supervisor/pending-schedules.ts`, reusing the same loader
`bbx serve` re-arms from) and keeps a schedule-holding box alive
(`kept-schedule`) even outside the keep-set, re-checking each idle cycle until
the file empties. `startAll` also pre-starts every schedule-holding box at
boot, independent of `keepRecent`, so schedules fire on time after a restart.

## A unit host: the hub only routes

When every `hub.json` entry names a `socket` (`isUnitHostConfig`), systemd owns
the box processes (`deploy/systemd/beebox-box@.*`, docs/plans/per-box-units.md)
and `bbx engine hub` builds a `SocketProvider` (`socket-provider.ts`) instead of
the `Supervisor`. It polls `systemctl list-units beebox-box@*` every two seconds
into a map; `get()` answers from the map (a WebSocket reconnect never wakes a
box), `ensureRunning()` connects to the socket, which starts the unit, and waits
for readiness; a failed unit's last journal line rides the 503. `lazy`, `idleMs`
and `keepRecent` are config errors there: the engine exits itself when idle
(`bbx engine serve --idle-exit`, in the unit).

The hub runs as `beebox`, in no box group, and reads one file per box:
`<box>/.beebox/hub-meta.json` (`core/hub-meta.ts`), behind the process-wide
switch `enableHubMetaReads()`. It carries `allowedEmails`, a pending-schedule
flag, SHA-256 hashes of the agent, mobile and scan tokens, and the box's
display identity (name and symbol, for the picker); `canAccessBox`, the gates
in `server/box-credentials.ts` and `describeBoxes` consult it, so a junk
bearer is refused without waking a box. The mobile session cookie is verified
too: on a unit host its key derives from the box's hub secret
(`core/mobile/session.ts`, `deriveMobileSessionKey`), which the hub holds for
that box. One hub secret per box per boot lives in
`/run/beebox/<slug>.hub-secret` (`secrets.ts`), read by the unit as a systemd
credential; `/etc/beebox/box.env` is rewritten at each start from the child
env allowlist (`box-env-file.ts`).

## SIGHUP only clears the crash-loop latch

SIGHUP (`Supervisor.reloadUnhealthy()`) gives any box that's exhausted its
restart budget (`status: "unhealthy"`) a fresh one and retries it. It does
**not** re-read `hub.json` — adding or removing a box entry still needs a
full hub restart.
