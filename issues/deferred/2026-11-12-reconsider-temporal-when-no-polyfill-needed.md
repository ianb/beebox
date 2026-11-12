---
title: "Reconsider Temporal once the browser floor has it natively"
workstream: unattached
area: beebox
activate-on: 2027-05-12
category: exploration
filed-by: agent
discovered-by: boxholder
discovered-in: worktree-web-guidance-scan — Temporal adoption reverted 2026-11-12
---

On 2026-11-12 Temporal was removed from the web app and the box-view
guidance. The iOS app's WKWebView (iOS 18, Safari 18.0) lacks native
Temporal, so the app loaded `temporal-polyfill` asynchronously in `boot()`;
Node 24 lacks it too. The boxholder judged a partial adoption not worth it,
and would "definitely consider switching to Temporal" when no polyfill is
needed.

Check, in order:

- Which Safari version first ships Temporal natively, and whether the iOS
  deployment target (`ios-app/`, `IPHONEOS_DEPLOYMENT_TARGET`) has reached
  it. The browser floor is written in `beebox/frontend.md`, "Browser
  support".
- Whether the Node version in `package.json` `engines` and the Dockerfile has
  Temporal without a flag.
- If both hold, read the parked plan
  [temporal-everywhere](../../beebox/docs/unimplemented-plans/temporal-everywhere.md)
  and its cross-model review findings (persisted usage buckets, all-day
  calendar events, fractional mtimes, module-load ordering, child-process
  coverage). Most of those concerned the polyfill or a full conversion.

The date direction in force meanwhile: store UTC; use the box's timezone
mostly for display, or explicitly where a format carries a zone (`.ics`).
Open date bugs:
[date bugs found by the Temporal census](../bugs/2026-11-12-date-bugs-found-by-temporal-census.md).
