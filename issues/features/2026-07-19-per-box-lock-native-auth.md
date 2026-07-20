---
title: "Per-box lock: require re-auth (biometric/device) to open a sensitive box in a multi-box client"
area: callback-box
design: ../../callback-box/docs/implemented-plans/ios-per-box-device-lock.md
needs: [manual-testing]
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

The implementation-ready iOS design is
[`ios-per-box-device-lock.md`](../../callback-box/docs/implemented-plans/ios-per-box-device-lock.md).
It resolves the declaration question in favor of an honest device-local
preference: this feature gates navigation on one phone and does not introduce a
server policy that can become stale or imply enforcement a client cannot provide.

## Use the platform's auth, not a hand-rolled PIN

Boxholder's own refinement, and it's the right instinct: reach for **native auth
facilities** rather than inventing a PIN.

- **iOS** — `LocalAuthentication` (Face ID / Touch ID, falling back to the device
  passcode). No secret for us to store, hash, rotate, or let the user forget;
  hardware-backed; a UX users already understand. It also composes with Keychain
  access control, so the gate can protect *material* rather than just a screen
  (see the honesty question below).
- **Android** — `BiometricPrompt` is the direct analogue; parity is tracked in
  [android-per-box-device-lock-parity](2026-07-20-android-per-box-device-lock-parity.md).
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

- **Where does "locked" live? Settled 2026-07-20 (boxholder): locally in the
  iOS app.** It is a per-device preference on the paired-box record, not a field
  in the box's config and not server-synchronized. That is honest about this
  being a local navigation affordance and avoids implying enforcement the box
  cannot provide. Each phone opts its boxes in independently.
- **Re-lock policy — settled by the design:** lock on app background and every
  box switch, with no idle timer. App-switcher snapshot privacy is outside the
  phone-share navigation scope and can be considered separately if needed.
- **Fallback when biometrics are unavailable or fail** — device passcode is the
  natural fallback. Given the scope, a device with no biometric *and* no passcode
  set is already an unlocked phone; a lock there is close to meaningless, so
  degrade gracefully rather than making the box unreachable.
- **Relationship to local auth.** The
  [local password auth](../closed/features/2026-07-16-local-password-auth-default-on.md)
  work has shipped. This remains a **second, orthogonal axis**: that one is
  "is this client authenticated at all," this one is "may it open *this* box
  right now." The iOS-only local preference does not alter server authentication.

## Naming nit

Call it **lock**, not **pin**. In UI vocabulary "pin" overwhelmingly means
favorite/stick-to-top, and this feature is the opposite of promoting a box —
someone reading `pinned: true` in a paired-box record would guess wrong.

## Implementation status (2026-07-20)

The iOS implementation has landed on `main`:

- the preference is stored only in the local paired-box JSON, with legacy
  snapshots defaulting safely to unlocked;
- every unlock and every attempt to disable the preference uses a fresh
  `LocalAuthentication` request;
- backgrounding or changing boxes invalidates in-flight authentication and
  discards the current grant;
- protected chat/composer views remain mounted but opaque, non-interactive, and
  accessibility-hidden; presented composer surfaces dismiss when the lock
  returns;
- the full simulator XCTest suite passes, and seeded locked layouts were
  inspected on iPhone 17e and iPad (A16) simulators.

Close this issue only after physical-device acceptance covers successful Face
ID/Touch ID and passcode fallback, cancellation/failure, background during and
after the prompt, authenticated lock removal, protected/unprotected box
switching, force quit/relaunch, large type, and the no-passcode degradation if
practical. Also confirm the webview stays mounted and composer drafts/pending
sends survive re-lock/unlock.
