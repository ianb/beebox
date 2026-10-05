---
title: "Tailscale onboarding for a packaged box: the box owns its tailnet node and signs in from the admin UI"
workstream: unattached
area: beebox
labels: [install]
filed-by: agent
discovered-in: worktree-installable-app — installable-app research
design: ../../research/installable-app/README.md
---

Job: a boxholder who installed beebox with compose wants to reach the box
from their phone away from home, without learning Tailscale's admin console
or handling auth keys.

Today there are two routes, and neither fits that job:

- `bbx tailscale setup` drives the host's Tailscale. The box shares the
  host's node and name, and a rename orphans the mapping
  ([operational polish #1](2026-07-22-bbx-tailscale-dev-router-operational-polish.md)).
- `beebox/docker/compose.tailscale.yaml` gives the box its own node, but
  requires a pre-made `TS_AUTHKEY` in a separate env file. It has never run
  against a real tailnet (ledger item 2 in
  [installation-remaining-work](2026-07-19-installation-remaining-work.md)).

The research recommends that the box owns its node (the sidecar today, a
tsnet Go helper for any non-container package) and that the admin Tailscale
section drives onboarding: show the login URL, the node's `ts.net` name,
HTTPS-certificate state, key-expiry date, and a re-sign-in prompt before the
180-day user-key expiry. Default stays tailnet-only; the Funnel refusal
stays.

## Open questions

- Does the `tailscale/tailscale` container print a login URL when
  `TS_AUTHKEY` is absent, and can the box read it (sidecar logs, or the
  sidecar's LocalAPI socket on a shared volume)?
- Can HTTPS certificates be enabled without the user finding the admin
  console? `tailscale serve` raises a consent link through LocalAPI
  `QueryFeature`; tsnet has no helper for it.
- The pairing QR should carry the `ts.net` URL when one exists
  (`beebox/docs/mobile-contract.md` §1.1).

## First step

Run ledger item 2 once on a real tailnet and pair the iOS app over it from
off the home network. That answers whether the auth-key step is tolerable
before anything is built.
