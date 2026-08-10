---
title: "Three layers each verify credentials independently — is that the right shape?"
workstream: browse-back-url
area: callback-box
filed-by: agent
discovered-in: worktree-browse-back-url — adding CB_BROWSE_API_KEY touched six call sites across three layers
needs: [decision]
---

A request to a box in local dev crosses three authenticating layers, and each
one decides for itself which credentials exist. Adding a credential therefore
costs six edits, and missing one fails silently. This may still be the right
design — the layering has real reasons — but nobody has looked at it as a whole,
and it is now the main cost of touching auth.

## The layers

1. **The dev router** (`bin/router-auth.ts`, resolvers in
   `bin/router-auth-deps.ts`). Authenticates every TCP request before proxying
   or cold-starting anything. Per-box credentials resolve in
   `resolveMobileForBox` (`router-auth-deps.ts:128`); worktree Vite assets have
   their own separate rung, `resolveWorktreeAsset`.
2. **`cb hub`** (`callback-box/src/hub/hub-server.ts`). Gates the HTTP
   catch-all (`:478`) and the WebSocket upgrade (`:535`) through
   `hasMobileAuth` (`:148`) plus `decideHubAuth` (`:246`), then injects the
   identity headers the box trusts. `/api/boxes` (`:190`) reaches auth
   independently of both.
3. **The box's own Fastify wall** (`callback-box/src/webapp/server-box-scope.ts`).
   The preHandler ladder runs diag key (`:82`), agent bearer (`:91`), browse key
   (`:96`), mobile (`:102`), then session identity (`:107`) and `canAccessBox`
   (`:139`). The tRPC context (`:217`, `:242`) is a **fourth** verification
   point: it recomputes `authed`/`isOwner` on its own, because the WebSocket
   path has no preHandler.

## Why it is like this (the reasons are good)

- The hub holds the session HMAC secret because a process that can verify a
  cookie could forge one for a sibling box, and boxes are mutually untrusting.
  So only the hub reads session cookies.
- The box must fail closed on its own: it is reachable directly on loopback, so
  it cannot assume the hub ran.
- The router must gate because it is exposed over Tailscale, and in dev it — not
  the hub — is the front door.

Each layer is individually defensible. The tension is only visible in aggregate.

## What it actually cost

Adding `CB_BROWSE_API_KEY` (`callback-box/src/core/browse-key.ts`) needed six
call sites: router per-box resolver, router worktree-asset resolver, hub
catch-all, hub `/api/boxes`, box preHandler, box tRPC context.

Two were missed on the first pass, and neither failed loudly:

- Omitting `/api/boxes` rendered **"Box not found"** on every page while every
  other request authenticated fine.
- Omitting the tRPC context left protected procedures at `authed: false`, so the
  credential opened every public read and nothing else. Nothing caught this
  because `authedProcedure` is currently unused — it would have surfaced later,
  in unrelated work.

The prior state was the same failure in reverse: the router and the box both
accepted the box agent token, the hub did not, and that disagreement was
invisible until someone tried to drive a browser
([browse-cannot-authenticate-dev-pages](../closed/bugs/2026-07-31-browse-cannot-authenticate-dev-pages.md)).

## The tensions, named

- **No shared registry.** There is no one place that answers "which credentials
  authenticate a box request?" Each layer answers separately, in its own idiom.
- **Silent divergence.** A layer that lacks a rung produces a login redirect, an
  empty box list, or `authed: false` — never "this credential is not configured
  here". The failure looks like a normal auth denial.
- **Mixed scopes, uniform treatment.** The agent token and mobile tokens are
  per-box; the diag key and the browse key are machine-wide. The gates do not
  express that difference — a machine-wide key just returns true at a per-box
  rung.
- **Two front doors in dev.** In prod the hub is the front door. In dev the
  router sits in front of the hub, so two layers do the same job with different
  credential sets.
- **Surfaces outside the main gate.** `/api/boxes` and the Google-services
  callback authenticate independently, so "the gate" is really several gates.

## Options (not researched)

- **Keep it, add a registry.** One module enumerating box credentials that all
  layers import, so adding one is a single edit and a layer cannot silently
  lack a rung. Least disruptive; addresses the main cost, not the duplication.
- **Keep it, test the matrix.** A credential × layer table asserted in one test,
  so a missing rung is a failing test rather than a mystery. Cheapest.
- **Collapse dev to one gate.** Have the hub trust the dev router the way it
  trusts itself in prod, so dev has one front door too. Reduces layers but
  weakens the "box fails closed independently" property.
- **Do nothing.** Defense in depth is deliberate, and credentials are added
  rarely. If the answer is "this is correct, the cost is real and accepted",
  that is a legitimate outcome — write it down so the next person adding a
  credential knows the shape is intentional and knows all six sites.

## Research (incomplete)

Worth establishing before deciding: how often a credential is actually added
(git history on the three gate files); whether any layer can be shown redundant
in a given deployment; and whether the tRPC context's independent recomputation
could read the preHandler's decision instead without reopening the WS gap it
exists to close.
