---
title: "iOS app rendering of the hub's box-closed 503 is unverified"
workstream: box-maintenance-no-wedge
discovered-in: worktree-box-maintenance-no-wedge — while landing box-maintenance-no-wedge
area: beebox
resolution: implemented
---

Resolved in `worktree-box-maintenance-no-wedge`. The iOS companion does not
inspect HTTP status itself: its `WKWebView` renders whatever body the chat URL
returns (`ios-app/BeeBox/Views/ChatWebView.swift`, `authenticatedRequest`), and
the "box returned 404" text came from the dev router's mobile bootstrap
(`workstreams-app/src/router/router-mobile-bootstrap.ts`), not from Swift. Two
changes make the message reach the screen on both paths, with no iOS change:

- The router's bootstrap quotes the box's own sentence (`message`, else
  `error`) after the status: "Mobile session bootstrap failed: box returned
  503: Box test1 is closed for migration (pid …); it reopens when that process
  finishes or exits" (`test/router/router-mobile-bootstrap.test.ts`).
- The hub answers a page navigation (`Accept: text/html`, which the web view
  sends) with that sentence and the retry interval as plain text instead of the
  JSON body (`beebox/src/hub/box-unavailable.ts`, `test/hub/hub-router.doctest.md`).

Not exercised: a live simulator walk against a closed box. The rendering claim
rests on `WKWebView` displaying a `text/plain` 503 body, which is its standard
behaviour for a top-level navigation.


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
