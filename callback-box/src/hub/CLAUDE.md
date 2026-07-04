# Hub

`cb hub` routes `/<slug>/...` to per-box `cb serve` children (`supervisor.ts`
owns the children, `hub-server.ts` owns HTTP/WS routing + auth, `hub-config.ts`
the `hub.json` schema).

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

## SIGHUP only clears the crash-loop latch

SIGHUP (`Supervisor.reloadUnhealthy()`) gives any box that's exhausted its
restart budget (`status: "unhealthy"`) a fresh one and retries it. It does
**not** re-read `hub.json` — adding or removing a box entry still needs a
full hub restart.
