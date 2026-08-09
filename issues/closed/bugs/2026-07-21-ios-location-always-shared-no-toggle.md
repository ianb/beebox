---
title: "iOS: location is effectively always shared — the native path bypasses the consent toggle"
workstream: unknown
area: callback-box
filed-by: agent
discovered-in: "main session — boxholder: location seems always shared on iOS, not clearly toggleable"
resolution: implemented
---

**Closed (implemented + boxholder-confirmed) 2026-07-31.** The native Add-menu
location row now reads the web-owned per-box consent preference and renders
"Share Location" ↔ "Sharing Location ✓": tapping while off captures a fix and only
then reports on; tapping while on persists off without reading location, and state
sync performs no capture. So the app-level opt-in is authoritative on iOS too —
location is no longer effectively always-shared. Boxholder confirms from use.
Reopen if the native path captures location while the toggle is off.

## Implemented 2026-07-22

The native Add menu's existing location row is now the missing control. It
reads the web-owned per-box preference and renders either “Share Location” or
“Sharing Location” with a checkmark. Tapping while off captures a fix and only
then reports sharing on; tapping while on persists off without reading
location.

The web bridge proactively sends the stored state to the native shell when it
mounts, and that state synchronization performs no capture. Toggle results now
carry the authoritative `enabled` value; transport failures preserve the last
known UI state rather than falsely displaying off. The mobile contract and
shared fixtures document the new request, state, and result shapes.

Turning sharing off stops future captures/refreshes; as on the web, it does not
delete the last fix already stored by the box.

Automated verification covers state synchronization, enable and disable side
effects, shared wire fixtures, native decoding, and the full web and iOS test
suites. Manual verification remains on a real iPhone: confirm the row initially
matches the stored state, enabling prompts/captures and gains the checkmark,
disabling removes the checkmark without a permission prompt, and the state
survives closing/reopening the menu and the app.

On iOS, location appears to always be shared, with no clear way to turn it off.
The web app has a proper opt-in toggle; the native path doesn't honor it.

## The consent model on web (correct)

`hooks/useLocationShare.ts` + `lib/location-share.ts`: location is a **consent-
gated opt-in**. Its own doc — *"nothing is captured unless the user toggles on
AND the browser grants permission; the toggle never reads 'on' without a stored
fix."* The UI is `components/chat/ShareLocationMenuItem.tsx` ("Share location" ↔
"Sharing location ✓"), stored per box. Two gates: the app toggle **and** the
system permission.

## The native (iOS) path skips the app gate — the bug

The native bridge fulfils a location request without ever checking the opt-in
state. `components/chat/use-native-bridge.ts:79` `handleNativeLocationRequest`:

```ts
if (!isGeolocationAvailable()) { ...fail... }
await captureAndStore(boxSlug, Date.now());   // <- no check of the `enabled` toggle
postNativeLocationResult({ id, success: true, message: "Location shared." });
```

So when the iOS shell requests location (the agent's `cb location get`, or any
native trigger), the web bridge captures and stores it **gated only by
`isGeolocationAvailable()` + the iOS system permission** — the app-level consent
toggle (`loadLocationShareState(boxSlug).enabled`) is never consulted. Once the
user grants the one-time iOS permission (`NSLocationWhenInUseUsageDescription`),
location is effectively always available to share, with nothing in the app
gating it.

Compounding: `ShareLocationMenuItem` is documented **web-only** and lives in the
composer's Add menu. In the native iOS composer that menu item may not be
surfaced at all — so there's **no visible toggle** on iOS even though the web has
one. "Always shared + not toggleable" = both halves.

This also breaks the promise the app makes in `ios-app/CallbackBox/Info.plist`:
*"shares your location with your paired box only when you request it."* On iOS
the "request" is the agent/native side asking, not the user opting in.

## Fix direction

The web's consent gate must also gate the native path:

- `handleNativeLocationRequest` should refuse when the box's opt-in is off —
  check `loadLocationShareState(boxSlug).enabled` before `captureAndStore`, and
  return `success: false, message: "Location sharing is off."` when not enabled.
  This makes the app toggle authoritative on both platforms.
- Surface the toggle in the **native composer** so iOS users can actually turn it
  on/off (and see its state), since `ShareLocationMenuItem` is web-only today.
  Belongs with the iOS input-plane / native-composer work.
- Decide the intended UX: is "sharing on" a standing per-box opt-in (agent may
  read location while on), or strictly per-request? The web model is standing
  opt-in; make iOS match whatever that is, visibly.

## Verify

On a real device: with the toggle OFF, confirm an agent `cb location get` / native
request is refused (not silently fulfilled); with it ON, confirm it works and the
state is visible. Privacy-sensitive — this is location data leaving the device, so
treat the fix as fail-closed (default off, no capture without an explicit, visible
opt-in).

Squarely in the [iOS input-plane parity](../../features/2026-07-19-ios-input-plane-parity.md)
surface (native composer + its menu), and touches the
[mobile contract](../../../callback-box/docs/mobile-contract.md).
