---
title: "agent browser scoped to box"
workstream: shared-browser
needs: [design]
area: beebox
priority: backlog
---

The box agent can read and write box files directly, but it can't *see the rendered box the way the principal does* — the actual web UI: how a custom view renders, whether a card page shows anything (cf. the workshop `.sandbox.card` blank-page incident, 2026-06-12, where the agent built a correct view but had no way to look at it), whether a dashboard or interactive app actually works in the browser. The dev-side `bin/browse` (agent-browser wrapper) gives main-repo agents exactly this against the local dev router; the box agent has no equivalent against its own deployed box.

Idea: give each box agent a preconfigured agent-browser that loads the box at the principal's effective permissions — authenticated as (or impersonating, server-side) the boxholder, scoped to that box's URL prefix, so the agent sees precisely what the principal sees, no more. Then "go look at the page you just built and tell me if it renders" becomes a real capability, and the agent can self-verify UI work instead of shipping blind.

Design questions:
- **Auth/identity.** The agent already authenticates loopback calls with the per-box agent token (`core/agent-token.ts`); the browser session needs an equivalent that the auth wall accepts AND that resolves to the principal's box-scoped permissions (not owner/global). Probably a short-lived browser-cookie minted from the agent token, gated to the box prefix. Must NOT become a privilege-escalation path — box-scoped, principal-level, read-oriented.
- **Where it runs.** Server-side (the box agent runs on the server, so a headless Chromium next to it hitting `127.0.0.1:3210/<box>/...`) vs. handed to the chat subprocess. Reuse the agent-browser infra `bin/browse` already wraps.
- **Capability surface.** Likely read-mostly: navigate, snapshot the a11y tree, screenshot, read console — the self-verification loop. Click/fill is more fraught (real mutations as the principal) and can come later behind explicit intent.
- **Connection to the views/interactive-app work.** This is the missing half of "agent builds an interactive app": build it (the view write API + card-type→view binding) AND look at it. Pairs with [Capability map for the boxholder agent](../exploration/2026-05-19-capability-map.md) — "I can view the rendered box" is a composed capability the agent won't infer from its tool list.

## Research (2026-10-29)

The wider ask is a browser the agent and the person share for any website,
with handoff both ways. Survey, spike and recommended shape:
[research/embedded-browser/](../../research/embedded-browser/README.md). The
box-scoped self-check described above is one use of the same per-box browser:
the agent opens its own box's pages through the same broker.

Boxholder direction (2026-10-29): desktop only, no beebox-built viewer, no
image per box, no input arbitration. The agent drives an agent-browser session
through `bbx browser`; the person uses agent-browser's dashboard on the same
session to log in and get past blocks.

## Status 2026-10-30 (shared-browser landing)

Partly resolved. Done: the box has one browser the agent drives with `bbx browser` and the person opens from the avatar menu ([plan](../../beebox/docs/plans/shared-browser.md)). Still open: the self-view half above, where the agent loads its own box's pages at the boxholder's permissions. The shared browser carries no box credential, so the agent cannot yet open authenticated box pages in it. Needs the box-scoped credential design named under "NOT in scope" in the plan.
