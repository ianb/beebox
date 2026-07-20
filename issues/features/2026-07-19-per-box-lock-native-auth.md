---
title: "Per-box lock: require re-auth (biometric/device) to open a sensitive box in a multi-box client"
area: callback-box
needs: [design]
filed-by: agent
discovered-in: main session — boxholder raised it while working through the queue
---

A multi-box client authenticates **once, to the app** — the iOS companion holds
every paired box behind a single app-level auth. But **sensitivity isn't uniform
across boxes.** Some hold routine working material; others hold personal
financial, legal, or medical matter. Today they're equally reachable the moment
the app is open.

Proposal: mark some boxes as **locked**, so opening one requires an additional
gate even inside an already-authenticated client.

## Use the platform's auth, not a hand-rolled PIN

Boxholder's own refinement, and it's the right instinct: reach for **native auth
facilities** rather than inventing a PIN.

- **iOS** — `LocalAuthentication` (Face ID / Touch ID, falling back to the device
  passcode). No secret for us to store, hash, rotate, or let the user forget;
  hardware-backed; a UX users already understand. It also composes with Keychain
  access control, so the gate can protect *material* rather than just a screen
  (see the honesty question below).
- **Android** — `BiometricPrompt` is the direct analogue when
  [the companion](2026-07-18-android-companion-track1-unblocked.md) gets there.
- **Web/PWA** — WebAuthn/passkeys is the analogue, though a browser context makes
  the "protects material vs. protects a screen" problem sharper.

A hand-rolled PIN would mean storing and verifying another secret, a reset path,
and lockout policy — all of which the platform already solved.

## The question that decides whether this is real

**What does the gate actually protect?**

If the box's data is already cached on the device and its session token is
already valid, a lock that only gates *navigation* is a **speed bump** — good
against shoulder-surfing, a handed-over phone, or a glance while the app is open;
useless against someone with the unlocked device who is willing to look further.

That is still a legitimate feature (it's the same value a password manager's
auto-relock provides), but it should be **built and described honestly**. The
stronger version is to gate the *material*: keep the locked box's token — or its
local cache — behind a biometric-protected Keychain item, so failing the check
means the data genuinely can't be read, not merely that a view won't render.
Which of those we're building is the first thing to decide, because it changes
everything downstream.

Related and worth resolving together: iOS currently stores its device token in
plaintext rather than the Keychain
([ios-token-plaintext-not-keychain](../bugs/2026-07-17-ios-token-plaintext-not-keychain.md)).
Moving to the Keychain is a prerequisite for the strong version *and* an
independent fix — doing them in one pass is cheaper than twice.

## Other design questions

- **Where does "locked" live?** A per-box declaration in the box's own config
  (travels with the box, every client can honor it, the box asserts its own
  sensitivity) versus a per-device client preference (honest that it's a local UI
  affordance). Server-declared is more meaningful but a client can always ignore
  it — so server-declared + client-enforced is a trust statement, not a
  guarantee. Probably still worth it: it means a newly paired device inherits the
  intent instead of defaulting to open.
- **Re-lock policy** — on app background? After N minutes idle? On every box
  switch? This single choice decides whether the feature is useful or merely
  irritating, and it should be tunable per box rather than global.
- **Fallback when biometrics are unavailable or fail** — device passcode is the
  natural fallback; decide whether a locked box is reachable *at all* on a device
  with no biometric/passcode set (fail-closed says no).
- **Relationship to the in-flight local auth work.** The
  [local password auth](2026-07-16-local-password-auth-default-on.md) design
  (being written now) is redefining what `isAuthEnabled()` means and adding a
  local credential method. This is a **second, orthogonal axis**: that one is
  "is this client authenticated at all," this one is "may it open *this* box
  right now." Design them aware of each other so the second doesn't get bolted
  onto a gate the first just moved.

## Naming nit

Call it **lock**, not **pin**. In UI vocabulary "pin" overwhelmingly means
favorite/stick-to-top, and this feature is the opposite of promoting a box —
someone reading `pinned: true` in a box config would guess wrong.
