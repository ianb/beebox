---
title: "iOS app rendering of the hub's box-closed 503 is unverified"
workstream: unattached
discovered-in: worktree-box-maintenance-no-wedge — while landing box-maintenance-no-wedge
area: beebox
---

Before `box-maintenance-no-wedge` (see
`beebox/docs/implemented-plans/box-maintenance-no-wedge.md`), a closed box
answered every hub request with a bare `404 {"error":"not_found","message":"No
running box for …"}`. The iOS companion showed this as "Mobile session
bootstrap failed: box returned 404", with no distinction between an unknown
slug and a known box that could not be served.

The hub now answers a known-but-unavailable slug with `503
{error:"box_closed"|"box_unavailable", message, ...}` and a `Retry-After`
header (`beebox/src/hub/box-unavailable.ts`). Whether the iOS app surfaces that
message usefully, or still shows a generic failure, has not been exercised
against a live 503 response.

Check the iOS client's handling of a 503 from the mobile bootstrap/session
endpoints and, if it falls back to a generic error, surface `message` (and
ideally `Retry-After`) to the user.
