---
title: "Dev router: tRPC WebSocket upgrade closes 1006; UI shows Disconnected"
workstream: top-nav-ia
area: bin
filed-by: agent
discovered-in: worktree-top-nav-ia — unified app bar browse walk
resolution: implemented
---

Resolved in `e4014a52`. The router upgrade forwarding was not the cause. The
lazy box hub intentionally returned HTTP 503 when a stopped box received a
WebSocket upgrade. It does not cold-start boxes from reconnecting sockets,
because an abandoned tab could otherwise keep a box alive indefinitely.

The old visible-tab keepalive reached only the outer worktree and Vite. It did
not reach the box-scoped hub path. The fix adds a cheap box-scoped HTTP
keepalive, awaits it before each development tRPC WebSocket open, and sends it
periodically while the tab is visible. This preserves the hub's fail-closed
WebSocket policy and removes the cold-start race.

Browsing a box through the shared dev router
(`http://localhost:3210/<checkout>/<box>/...`), the tRPC WebSocket never
establishes: the client's upgrade to the router closes with code 1006
(abnormal closure, no close frame) and retries in a loop. The Dashboard's
connection indicator reads "Disconnected" as long as the page is open.

Observed on the `top-nav-ia` worktree and reproduced on the `main` prefix of
the same router, so it is the router's WebSocket handling generally, not
worktree lazy-start specifically. Every probed path closes 1006 identically
(`/<checkout>/<box>/trpc`, `/<checkout>/<box>/api/trpc`, and a nonexistent
`/trpc`), which points at the upgrade being dropped before any route
matching rather than at a path mismatch.

Consequence: nothing that rides the WebSocket works in a worktree session.
Bus events (`events.subscribe`) never reach the client, so live-update
surfaces don't update — `FileView` doesn't refresh when a card changes on
disk, and any UI verification of "does this react to a file change" is
untestable in a worktree. HTTP-only behavior is unaffected, which is why
this stays invisible until you specifically test live update.

Pre-existing and environmental — not caused by any feature branch; nothing
in the branch it was noticed on touches the upgrade path. The suspect is
the router → Vite → Fastify proxy chain's `upgrade` forwarding, not the
app: the client builds the URL from the same API base that HTTP and SSE
use successfully (`src/frontend/src/api-core.ts` `getWebSocketUrl`).

**Diagnosis belongs in a main-checkout session.** The live router is shared
across all sessions and runs the *main* checkout's `bin/router.ts`, so a
fix in a worktree does nothing until it is merged to `main` and the
boxholder restarts `pnpm dev`. A worktree session cannot iterate on it
(and must not restart the shared router). An isolated second router
(`BBX_STATE_DIR` + `ROUTER_PORT`) is the way to reproduce without
touching the shared one.
