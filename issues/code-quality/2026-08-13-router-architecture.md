---
title: "The dev router grew ad hoc and its environment is underpowered"
workstream: unattached
area: router
needs: [design]
labels: [router, architecture]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder observation
---

`bin/` is now **~12,500 lines** of router, and it started as a small script. It
does a lot: process supervision for every worktree, a fail-closed
authenticating proxy on two listeners, Vite/hub child lifecycle, the `/dev/`
static and Markdoc surface, a faceted issues browser, and the `/workstreams/`
app with action endpoints.

The problem isn't size — it's that the **environment underneath is thinner than
what's being built on it.**

| File | Lines |
|---|---:|
| `router-issues.ts` | 2190 |
| `router.ts` | 1451 |
| `router-workstreams.ts` | 1373 |
| `router-docs.ts` | 895 |
| `router-core.ts` | 746 |

## What's missing, concretely

- **No routing table.** Dispatch is a chain of `pathname ===` / `startsWith`
  comparisons inside request handlers. Adding a surface means finding the right
  place in an if-chain; nothing enumerates what routes exist.
- **No middleware.** Auth, CSP headers, cache-control, and error handling are
  applied per-handler by hand, so every new surface re-remembers them — and a
  forgotten one fails open or ships without a header.
- **No request/response validation.** No schema layer for query params or POST
  bodies, in a process that now performs destructive actions (worktree removal,
  issue mutation).
- **HTML by string concatenation** — 36 template-literal builders across the
  three view files, with `escapeHtml` applied by discipline rather than by
  construction.
- **No structured logging.** Diagnosing the router means reading prose lines.

Meanwhile the parts that *were* designed deliberately are good and shouldn't be
disturbed: the UDS-vs-TCP capability boundary, the fail-closed auth posture, the
concurrency invariants promoted into `bin/docs/router-protocol.md`, and 23 test
files including real coverage of auth and lifecycle.

## The UI half should probably use the house stack

Boxholder, 2026-08-13: the UI surfaces should mostly follow callback-box's own
conventions — React, XState, React Router, Vite — rather than hand-rolled
server-rendered strings.

It is already drifting that way without the benefits. `router-issues.ts:1540`
emits `<script src=".../issues/priority.js">` and `:2161` serves that file, with
`script-src 'self'` in the CSP. So there is already client-side interactivity,
written by hand, outside the stack that exists one directory over — with its own
state handling, its own event wiring, and no component model.

**But the router is the tool you reach for when things are broken**, and that
argues for keeping *some* of it buildless. `/dev/` is deliberately served
straight from disk so it never cold-starts a worktree. If the router's UI
depended on the app's build output, a broken build would take out the surface
you'd use to diagnose the broken build.

So the split is probably by *kind of surface*, not by file:

- **Always-available, buildless**: the worktree list, status, error pages,
  `/dev/` artifact serving. Small, boring, works when nothing else does.
- **App-shaped, house stack**: `/workstreams/` and the issues browser. These do
  filtering, mutation, and POST actions — they are applications, and they are
  where the hand-rolled cost is concentrated.

Open: who builds that bundle and where it lives, given the router supervises the
install that would produce it. A bundle built once and committed, or built by
the main checkout only, may sidestep the circularity — decide it before writing
components.

## The tension worth deciding first

Adopting a framework (Fastify, Hono) would supply routing, middleware,
validation, and logging — but `bin/` is deliberately dependency-light and boots
fast, and the router supervises the very install that would provide those
dependencies. A bootstrap that needs `node_modules` to serve a worktree whose
`node_modules` is still installing is a real hazard.

So the honest options are roughly: a framework, a small in-repo router
abstraction (route table + middleware chain + a typed handler signature), or
targeted extraction leaving dispatch alone. **Pick deliberately** — the middle
option is the one that's easy to start and easy to leave half-done.

## Why now

Every recent addition has made the gap wider rather than narrower: the
workstreams app added POST actions and a second view surface, and the issues
browser gained interactive mutation that writes to the main checkout. The next
feature will pay the same tax, and destructive endpoints raise what a missing
guard costs.

Related, unfiled: the issues browser's interactive priority control writes to
the main checkout without committing (`router-issues.ts:1355`), which leaves
main dirty — and `bin/land` refuses to merge into a dirty main checkout, so
triage in the browser can block every worktree's `/finish`.
