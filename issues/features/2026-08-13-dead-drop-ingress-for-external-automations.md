---
title: "A dead-drop ingress so external automations can POST into a box"
workstream: unattached
area: callback-box
needs: [design]
labels: [ingress, connectors, soft-launch]
filed-by: agent
discovered-by: Ian
discovered-in: main session — Apple Health / Shortcuts use case
priority: backlog
---

There is no easy way for an external automation to put data **into** a box. The
auth posture is fail-closed by design — every TCP request authenticates — so
anything without a session or a device token is refused. That's correct for the
app and wrong for a webhook.

Wanted: a framework for standing up a narrow, credentialed ingress URL — a dead
drop — roughly mirroring how publishing is set up for the outbound direction.

## The motivating case

Apple Health, entirely native and free, no third-party app:

1. Shortcuts personal automation, trigger **Workout — Completed** (fires when
   the Watch finishes logging one).
2. **Get Workouts** / **Get Health Sample** for the data.
3. **Get Contents of URL** to POST it to an endpoint you control.

The whole pipeline is Apple-native and owned end to end. The only missing piece
is a URL that will accept the POST.

The pattern generalizes well beyond Health: anything that can POST — a Shortcut,
an IFTTT-style service, a webhook from another tool, a script on another
machine — becomes an intake path without writing a connector.

## The precedent already exists: scan tokens

This does not need inventing from scratch. The **scan-upload surface** is
already a narrow, token-authenticated ingress carved out of the fail-closed
posture:

- The router allowlists it *by shape* — `POST /<w>/<box>/api/scan/check` and
  `PUT /<w>/<box>/api/scan/files/<sha256>` (`bin/router-auth.ts:62-65`).
- The bearer is verified **independently** by the hub's scan gate and by the box
  child, so neither trusts the other.
- Tokens live in a per-box store (`.callback-box/scan-tokens.secret.json`,
  `src/core/token-store.ts`), separate from session and mobile auth —
  `resolveMobileRequestAuth` structurally cannot resolve a scan token.
- There's a rate limiter alongside it that is explicitly *not* the security
  control (`scan-rate-limit.ts:5`); the token is.

That is the shape to generalize: a capability token, scoped to one narrow
surface, verified at every hop, stored apart from user auth.

## What the design has to settle

- **What lands.** A dead drop that accepts arbitrary JSON needs somewhere to put
  it — an intake card, a typed card per source, or a raw drop that triage picks
  up. Getting this wrong makes every new source a schema negotiation.
- **Token lifecycle.** Minting, scoping to a single drop, revocation, and
  expiry. Mobile device tokens still have no expiry (a filed gap) — don't repeat
  it here, where the credential will be pasted into a third-party automation.
- **Blast radius of a leaked token.** A Shortcut on a phone is not a secure
  store. The token should be able to *write one kind of thing to one place* and
  nothing else — no read, no listing, no other surface.
- **Abuse and size.** An open-ish URL invites junk. Rate limiting, a size cap,
  and a per-token quota are the minimum, and the token stays the actual control.
- **Discovery/setup UX.** `cb pub setup` is the outbound analogue and worth
  reading for shape — and for its warning: its instructions went stale and
  dashboard-bound (filed separately). Prefer a flow that mints and prints the
  URL over one that documents clicking through a console.
