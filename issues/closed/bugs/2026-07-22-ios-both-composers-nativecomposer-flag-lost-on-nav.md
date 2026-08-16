---
title: "Regression: iOS shows both native + web composers after navigating (nativeComposer=1 lost on nav)"
workstream: unknown
area: callback-box
resolution: implemented
filed-by: agent
discovered-in: main session — boxholder on iOS, a landmark chat
---

**Closed (implemented + boxholder-confirmed) 2026-07-31.** Fix landed in
`9ccf1b68`: native-shell detection now keys off the injected bridge (installed at
document start on every navigation), with `nativeComposer=1` kept only as an
initial-load fallback — so internal same-origin navigation can no longer make the
web composer reappear under the native one. Boxholder confirms on-device: only the
native composer shows after navigating into a landmark / switching sessions, and
send is acknowledged. Reopen if the double-composer or send-confirm failure
returns.

## Implemented 2026-07-23

Commit `9ccf1b68` makes the injected native bridge authoritative for native-shell
detection, with `nativeComposer=1` retained as an initial-load fallback. Because
the bridge is installed at document start on every navigation, internal
same-origin navigation can no longer make the web composer reappear.

Automated coverage exercises native-shell detection through the bridge. Manual
verification remains on a real iPhone: load the initial chat, navigate into a
landmark and switch sessions, confirm only the native composer remains visible,
then send and confirm the native receipt is acknowledged.

In the iOS app, **both** the native composer (top dock) and the web composer
(bottom "Type…" bar) show at once — see screenshot. Send also fails ("The chat
did not confirm the message. Try sending it again"). A regression.

## Cause

The web app suppresses its own composer only when `nativeComposer` is true:
`composerSection={embedded || nativeComposer ? null : <ComposerRegion/>}`
(`InteractiveChat-view.tsx:330`). That flag is derived **only** from a URL query
param — `ChatPage.tsx:70`: `const nativeComposer = String(search.nativeComposer)
=== "1"`.

The iOS app sets that param **only on the initial chat URL** —
`ios-app/CallbackBox/Models/PairedBox.swift:50`:
`URLQueryItem(name: "nativeComposer", value: "1")` on `box.chatURL`. Internal
navigations (into a landmark's chat — the screenshot's landmark (`… / Recent`) — a
session switch, a link) load a fresh app URL that the web router builds **without**
`?nativeComposer=1`. So after the first in-app navigation the flag goes false and
the web composer re-appears under the native one.

**Why it's a regression now:** `57a33f45 Fix iOS new-window routing and keyboard
cursor` made same-origin links load in-place in the existing `WKWebView`. Before
that, those affordances didn't navigate the WebView (a `_blank` did nothing), so
you stayed on the initial `?nativeComposer=1` URL and the flag held. Making
navigation work exposed that the flag doesn't survive navigation.

## The clean fix: detect the shell by its bridge, not a URL param

The native shell already injects a bridge on **every** page load via a
`WKUserScript` (`ChatWebView.swift:602`, `startupScript()` sets
`window.callbackboxNativePost`, the native queues, etc.). That signal survives
navigation; the URL param doesn't. So:

- `ChatPage` (and anything keying off `nativeComposer`) should treat "native
  shell present" as **`window.callbackboxNativePost` exists** (or a dedicated
  `window.callbackboxNativeComposer` flag the startup script sets), not the
  `?nativeComposer=1` query param. Self-healing across navigation, no per-URL
  plumbing.
- Keep the URL param as a fallback if desired, but the bridge presence should be
  authoritative.

Alternative (worse): preserve `nativeComposer` across every web-router navigation
— brittle, every `navigate()`/`Link` in the app would have to carry it.

## The send failure ("did not confirm the message")

Likely downstream of the same confusion — with both composers live, a send may go
through the wrong path (web ComposerRegion vs the native emission bridge), so the
native emission receipt (`callbackboxEmissionReceipt`) never comes back and the
chat reports no confirmation. Verify it clears once the shell is detected
consistently (one composer, native path); if it persists after that, it's a
separate emission-bridge bug — file separately.

## Verify

On the device: pair a box, open chat (initial load — should be native-only),
then navigate into a landmark / switch sessions and confirm the composer stays
native-only. Then send from the native composer and confirm it's acknowledged.

Sits on the [iOS input-plane parity](../../features/2026-07-19-ios-input-plane-parity.md)
surface and is downstream of the new-window routing change
([ios new-tab](2026-07-21-ios-no-new-tab-needs-back-or-overlay.md)).
