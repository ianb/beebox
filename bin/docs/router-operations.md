# Router operations

## Topology

`workstreams-app/src/router/router.ts` composes the gated servers, boot, and
signal handling. Lifecycle lives in `router-core.ts`,
`router-worktree-start.ts`, `router-worktree-teardown.ts`, and
`router-lifecycle.ts`; effects in `router-effects.ts` and
`router-real-effects.ts`; pidfiles in `router-pidfile.ts`; proxy/dispatch in
`router-proxy.ts`, `router-dispatch.ts`, and `router-upgrade.ts`. Dev rendering
lives in `router-docs.ts`, `router-markdown.ts`, and `router-doc-browser.ts`
without lifecycle imports.

Read [the router protocol](router-protocol.md) before lifecycle or pidfile
edits. Its generation and concurrency invariants are authoritative.

One router on port 3210 fronts every checkout. Each worktree gets Vite plus
`bbx hub`; the hub starts one `bbx serve` child per active box.
`BBX_DEV_NO_HUB=1` selects the legacy single-server path.

## Authentication and exposure

Authentication is always on. Every TCP request authenticates before proxying,
serving dev infrastructure, or cold-starting. Owner sessions guard router
control, the worktree list, and dev infra; box routes use box/session auth.
Tailscale identity headers are never trusted.

The Unix socket at `~/.cache/beebox/router.sock` (or
`$BBX_STATE_DIR/router.sock`) is the unauthenticated trusted-local capability
used by CLI tools. The opt-in machine-wide browse key grants read-only dev
browsing, not worktree-list or control routes.

Login/setup HTML is self-contained and form, OAuth, and redirect targets keep
the worktree prefix. `bbx tailscale setup --target <routerPort>` exposes the
whole router. Before recording exposure it probes `/__router/status` without
credentials and requires `401`; `200` causes refusal and teardown.

## Environment isolation

Each checkout's gitignored `beebox/.env` is parsed with `util.parseEnv` and
merged into Vite, hub, and box children; exported variables win. Every entry,
including `PATH` and `NODE_OPTIONS`, reaches those processes.

The router loads main's file for `BBX_BROWSE_API_KEY`. One router means one
machine-wide key. Worktree creation copies main's file minus `BOXES=` so an
isolated checkout cannot serve real boxes. Older worktrees need the same exact
filter when copying by hand.

## Activity and reloads

Only HTTP cold-starts or refreshes activity. WS upgrades to a cold worktree
return 503 and clients retry. Visible pages send a one-minute HTTP heartbeat;
hidden tabs go quiet and stop after five minutes, including active chat, then
reload and recover history on focus. HMR uses the page origin.

Frontend code uses Vite HMR. The hub runs checkout TypeScript without reload:
backend changes are reported `ready (stale)`, and the human uses
`bin/workstreams down <name>` at a safe moment. Bundled box children watch the
exact CLI artifact identity, stop mutations, drain requests/chat/scheduled
delivery, and exit for replacement. Timers re-arm from persisted state. After
ten minutes an incomplete drain reopens mutations and keeps old code with a
warning. Hooks rebuild the bundle only when an input changed. Packed and
`BBX_CLI_PREBUILT` installs do not use this dev reload path.

The global scheduler checks the same bundle identity only between complete
all-box passes; launchd `KeepAlive` replaces it. A standalone foreground
`bbx serve` or scheduler has no safe supervisor, so it exits or stays visibly
stale instead of spawning an overlapping successor.

Never restart the shared router or run `panic` from a worktree without the
boxholder's permission. Isolated tests require both `BBX_STATE_DIR` and
`ROUTER_PORT`. Router/supervisor edits need a main merge and boxholder restart
before they are live; workstreams-app child edits reload independently.

Background: [router exposure design](../../beebox/docs/implemented-plans/expose-dev-router.md).
