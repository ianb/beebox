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

## Scope: the phone-share case, deliberately — not a security boundary

**Settled 2026-07-19 (boxholder): "the lock is for the phone share, no more."**

The threat model is handing your unlocked phone to someone — to show them a
photo, look something up, let a kid play — and not wanting a sensitive box one
tap away. It is **not** meant to withstand someone who has the device and is
determined to read its storage.

So the gate is a **navigation gate**, and that's the intended design, not a
compromise:

- Don't build the heavyweight version (biometric-protected Keychain item
  wrapping the token or local cache, so failing the check makes data
  unreadable). That solves a threat model we've explicitly declined.
- Don't *describe* it as protection either — in docs, UI copy, and any prompt
  text, it's "locked" the way a screen lock is, not encryption. Overstating it
  would invite someone to rely on it for the case it doesn't cover.
- Correspondingly, the implementation should stay small. If it starts growing a
  key-management story, that's the signal it has drifted past this scope.

Independently: iOS stores its device token in plaintext rather than the Keychain
([ios-token-plaintext-not-keychain](../bugs/2026-07-17-ios-token-plaintext-not-keychain.md)).
That's a real fix worth doing on its own merits — it is **not** a prerequisite
for this feature under the scope above, so the two need not be sequenced
together.

## Other design questions

- **Where does "locked" live?** A per-box declaration in the box's own config
  (travels with the box, every client can honor it, the box asserts its own
  sensitivity) versus a per-device client preference (honest that it's a local UI
  affordance). Server-declared is more meaningful but a client can always ignore
  it — so server-declared + client-enforced is a trust statement, not a
  guarantee. Probably still worth it: it means a newly paired device inherits the
  intent instead of defaulting to open.
- **Re-lock policy** — this is now the *main* design question, since the scope is
  settled. Re-lock on app background is the one that actually serves the
  phone-share case (you hand the phone over after backgrounding, or they
  background it themselves). An idle timer alone would leave the box open in
  exactly the moment that matters. Probably: lock on background, plus on every
  box switch, with no timer to reason about.
- **Fallback when biometrics are unavailable or fail** — device passcode is the
  natural fallback. Given the scope, a device with no biometric *and* no passcode
  set is already an unlocked phone; a lock there is close to meaningless, so
  degrade gracefully rather than making the box unreachable.
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
