---
title: "Request credentials are resolved in many places with different lists"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261110-003006
---

Which credentials a request carries is decided in several places, and each place accepts a different set. `resolveBoxIdentity` (`beebox/src/webapp/box-identity.ts`) has six callers, root routes use `resolveRequestIdentity` (`beebox/src/webapp/auth.ts`), the tRPC context recomputes bearer, mobile, and browse flags, and the root SPA fallback (`registerSpaFallback`, `beebox/src/webapp/server-root/root-routes.ts`) has its own list. A new credential must be added at each gate.

The agent-self-view workstream added a browser pass. The dev walk passed, but the built app's SPA fallback refused the pass. Cross-model review found this, and also found two gates the first plan draft missed (standalone root `/api/boxes` and the hub WebSocket upgrade). The workstream asked for one function that returns the whole credential picture for a request, so that each gate reads its answer from one place.

A gate-by-credential table in `docs/security-report.md` or `beebox/docs/server/` was also asked for. It would show the current differences before any code changes.

Related: [browse key is not a signed-in owner](../bugs/2026-10-09-browse-key-is-not-a-signed-in-owner.md) (one effect of the split between the two resolvers).

Evidence: `agent-self-view/20261108T164003Z-plan-reviewed.md`, `agent-self-view/20261108T181514Z-review-adjudicated.md`.
