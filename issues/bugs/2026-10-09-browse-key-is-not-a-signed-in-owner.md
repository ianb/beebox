---
title: "The browse key is not a signed-in owner at /auth/me, so Settings and Admin panels behave as signed out"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — F-newcomer journey walks, 2026-10-09
---

On a box with `agentBrowsing: "owner"`, a browse-key session is treated as the owner by box routes, but `GET /auth/me` answers 401. In the F-newcomer walk (session `aa-f2`, `GET /journey-walks-oct/auth/me` gave 401):

- Settings shows "Password: Sign in to manage a local password" (`PasswordSection` shows this when `/auth/me` gives no user).
- Secrets and Cloudflare refused ("requires an authenticated owner").
- The chat treated the same person as the owner.

The boxholder has said a Secrets panel an agent cannot exercise is a bug.

## Mechanism (read in source)

`registerAuthMe` (`beebox/src/webapp/routes/auth/register.ts:201-206`) calls the base `resolveRequestIdentity`. That function never returns the `"browse"` source (documented at `beebox/src/webapp/auth.ts:369-376`). The browse rung exists only in `resolveBoxIdentity` (`beebox/src/webapp/box-identity.ts:97-111`), which the box auth hook (`server-box-scope.ts:112,241`), chat send (`routes/chat/send-routes.ts:84`) and capture (`routes/capture-request-owner.ts:20`) use. So `/auth/me` sees no email and returns 401. The frontend reads `/auth/me` through `useCurrentUser`.

The secret store in the walk was isolated, so the shared-store guard (`server-box-scope.ts:305-316`) is not the cause. The Cloudflare refusal path was not traced.

## Why the fix is not obvious

`/auth/me` is the session-cookie truth, and `auth.ts` states that the browse key is still a machine credential. Making `/auth/me` answer for it widens what the SPA believes about the browse key (password change, sign out). Options: answer `/auth/me` with `resolveBoxIdentity` and a flag such as `source: "browse"` that the SPA reads; or leave it and accept that agent walks cannot exercise these panels. This is the same defect as the 2026-10-08 F walk's harness note; the 2026-10-08 report left it unverified.

Related: [browse cannot authenticate dev pages](../closed/bugs/2026-07-31-browse-cannot-authenticate-dev-pages.md) (closed; the earlier browse-auth work).

Report: [F](../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-09.md) (rows 42, 55, 81; harness note H3).
