---
title: "Independent origin for agent-authored dev surfaces"
workstream: unattached
area: router
filed-by: agent
discovered-by: Ian
discovered-in: worktree-workstream-story — while removing the /dev sandbox CSP
priority: backlog
---
When the `/dev/` sandbox CSP was removed (2026-08-19, see
[dev md images broken](../closed/bugs/2026-08-19-dev-md-images-broken-opaque-origin.md)),
the boxholder noted the ideal shape: agent-authored browsable surfaces
(`/dev/` pages, possibly worktree frontends) would live on an **independent
origin** from the router's control routes, so browser origin isolation — not
trust — separates rendered content from `/__router/*` and
`/workstreams/action/*`.

It is deliberately not built now, because the trust argument makes it moot in
the current setup: the dev agent authors the router's own code, so isolating
its HTML output guards nothing ("it could do bad things everywhere"). The
router is also only exposed on localhost and the owner's tailnet.

This becomes worth building when that trust assumption weakens — running
third-party branches, exposing the router beyond trusted devices, or serving
content not authored by the repo's own agents. Prior art in the repo:

- The exhibits origin already exists as an isolated origin for interactive
  agent pages (`workstreams-app/docs/exhibits.md`) — a starting point or
  template.
- The workstreams plan's Track D residual names the escalation path: move
  `/workstreams/` to its own port/origin; the one-file `router-workstreams.ts`
  seam keeps it cheap. The same move could carry `/dev/`.

Nothing to decide until a trigger fires; this records the direction so the
CSP-removal decision comment has somewhere durable to point.
