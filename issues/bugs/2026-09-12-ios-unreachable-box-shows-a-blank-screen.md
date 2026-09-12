---
title: "An unreachable box gives the iOS app a blank screen — the only diagnostic is written to the box it cannot reach"
workstream: unattached
area: ios-app
priority: important
labels: [ios, error-reporting, pairing]
filed-by: agent
discovered-by: Ian
discovered-in: main session — a local box opened fine in the browser and showed nothing on the phone
---

The boxholder opened a local box on the phone while Tailscale was down. The app
showed **a blank screen**: no error, no retry, no hint that the box was
unreachable rather than empty.

## Why nothing appears

`ios-app/BeeBox/Views/ChatWebView.swift` implements both failure callbacks —
`didFailProvisionalNavigation` (:403) and `didFail` (:411) — and both route to
`noteNavigationFailure`, which does exactly one thing:

```swift
BoxLog.warn("chat navigation failed stage=\(stage) urlError=…", category: .webview)
```

No view state changes, so the `WKWebView` keeps showing its empty document.
The app is not confused about what happened — it has the `URLError` code and a
localized description in hand — it just never tells the person holding the
phone.

**And the one diagnostic it does write goes to the box's debug log**, forwarded
over the network by `LogForwarder`. In this failure the box is exactly what
cannot be reached, so the record of the failure is written to the place the
failure prevents reaching. Whatever gets built should not depend on the box
being up to explain that the box is down.

## Reaching a local box is genuinely hard, which makes the silence worse

The dev router binds loopback only (`workstreams-app/src/router/router-core.ts:53`
— `server.listen(port, "127.0.0.1")`), so a local box is reachable from the
phone only through Tailscale. Two distinct ways it fails, and the person cannot
tell them apart from a blank screen:

- **Tailscale down or no serve config** — a transport failure the app sees as a
  `URLError`.
- **A stored base URL that can never work.** `boxBaseUrl()` in
  `CompanionPairingSection.tsx:20-24` derives the paired base URL from
  `window.location.origin`, so a QR generated while viewing
  `http://localhost:3210/…` hands the phone `http://localhost:3210/<box>` —
  which on the phone means the phone. No network fix helps; it must be
  re-paired. (Same root as the `label=chat` bug in
  `2026-09-11` iOS pairing work: pairing details derived from the browser's
  current URL rather than the box's reachable identity.)

## What it should do

- **Render the failure.** Something in place of the blank document: what was
  being reached, that it could not be, and a retry. The `URLError` code already
  distinguishes "cannot connect to host" from "hostname not found" from
  "offline", which maps to genuinely different advice.
- **Name the localhost case specifically** when the stored base URL is
  loopback. That one is not a network blip and retrying will never fix it — the
  honest message is "this box was paired from a URL only its own machine can
  reach; re-pair it."
- **Keep a local record.** A failure whose whole nature is "the box is
  unreachable" cannot rely on `LogForwarder` to report itself.


## Fixed 2026-09-12 (network half)

`ChatWebView` gained a `NavigationFailure` value and an `onNavigationFailure`
callback. `noteNavigationFailure` now reports to the VIEW as well as to
`BoxLog` — the point being that `BoxLog` goes to the box, which is what is
unreachable — and `didFinish` clears it, so a recovered load removes the
overlay on its own.

`RootView` holds the failure in state and overlays `UnreachableBoxView` on the
webview. That view distinguishes the two cases the boxholder could not tell
apart from a blank screen:

- **Transport failure** (this report's case — Tailscale was down): names the
  host that could not be reached and says it may be asleep, off the network, or
  behind a VPN that is not connected.
- **Paired to loopback**: when the stored `baseURL` host is `localhost`,
  `127.0.0.1` or `::1`, the advice is to re-pair rather than retry, because no
  network fix reaches an address that means the phone itself.

The underlying `error.localizedDescription` renders quietly beneath, since it
is what separates "offline" from "host not found" when someone reports this.

Verified with `swiftc -typecheck` against the iphoneos SDK over the whole
target — exit 0. NOT verified on a device or simulator: the overlay's
appearance and the loopback copy want a real look. `UnreachableBoxView` lives
in `RootView.swift` rather than its own file because the Xcode project uses
explicit `project.pbxproj` references and a new file needs registering in three
places by hand.
