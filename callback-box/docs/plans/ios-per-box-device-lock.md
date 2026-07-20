# iOS per-box device lock

**Status:** active — implementation is underway; automated tests plus simulator
and physical-device authentication/background checks are required before ship.

This plan adds an optional, device-local navigation lock to each box paired with
the iOS companion. A protected box requires Face ID, Touch ID, or device
passcode before its mounted chat/composer becomes visible and interactive, and
it re-locks when the app backgrounds or the user switches boxes.

## Stated preferences this plan trades against

- `docs/engineering-principles.md` **#1 types are structure**, **#3 validate at
  boundaries**, **#4 resilient and never silent**, **#5 failure paths visible in
  signatures**, **#6 right-sized defensiveness**, **#8 one way to do each
  thing**, **#9 formal structure for essential complexity**, **#10 testability
  is architectural**, and **#12 the maintainer is usually an agent**. The
  relevant text is *"Prefer types that make illegal states unrepresentable"*
  (`docs/engineering-principles.md:12-21`), *"Config is untrusted content too"*
  (`docs/engineering-principles.md:37-47`), and *"Seams ... are built into
  production code deliberately"* (`docs/engineering-principles.md:116-125`).
- `CLAUDE.md` requires reading existing formats before writing
  (`CLAUDE.md:104-109`) and leaving the repository tested and clean
  (`CLAUDE.md:111-116`). The iOS boundary remains: *"The webview is still the
  chat client"* (`../../../ios-app/CLAUDE.md:7-18`). The lock neither creates a
  second transcript nor changes server authentication.
- `code-style.md` requires visible failure handling (`code-style.md:24-33`) and
  exhaustive dispatch (`code-style.md:53-59`). Swift follows the same intent
  with a typed authentication result and main-actor state.
- `docs/testing.md` says tests first force useful decomposition, then document
  behavior, then anchor regressions (`docs/testing.md:3-17`). XCTest covers the
  state/persistence seams; Apple UI and lifecycle behavior finish on
  simulator/device.
- Settled product preference: the lock is for sharing an unlocked phone, not a
  storage-security boundary. The issue calls it a *"navigation gate"* and
  rejects biometric-wrapped tokens/caches
  (`../../../issues/features/2026-07-19-per-box-lock-native-auth.md:36-55`).
- Shipped mobile precedent says a one-platform mobile capability updates the
  parity matrix and gets an explicit follow-up for the other platform
  (`docs/implemented-plans/mobile-parity-sync.md:115-134`). This feature changes
  no wire shape, but its implementation is still accounted for.

## What already exists

- **Paired-box identity and persistence — extend.** `PairedBox` has a stable UUID
  and is stored in Application Support
  (`../../../ios-app/CallbackBox/Models/PairedBox.swift:3-16`;
  `../../../ios-app/CallbackBox/Storage/PairedBoxStore.swift:5-23,128-153`). The
  local preference belongs in this record, not another file.
- **Migration hazard — handle explicitly.** The synthesized `Codable` model
  would reject old JSON missing a new required Boolean, and the store's broad
  load fallback would replace the paired list with empty state
  (`PairedBoxStore.swift:128-137`). Decode a missing lock field as `false` and
  test that existing IDs, URLs, sessions, and tokens survive. Preserve the field
  in `withSessionID(_:)`, which reconstructs `PairedBox`
  (`PairedBox.swift:33-35`).
- **Management surface — extend.** `PairBoxView` lists each paired box
  (`../../../ios-app/CallbackBox/Views/PairBoxView.swift:47-68`). Add the local
  lock toggle there. Enabling is immediate; disabling requires successful
  device authentication so the locked screen cannot turn itself off.
- **Mounted chat and durable composer — preserve.** `RootView` constructs the
  webview/composer together (`../../../ios-app/CallbackBox/Views/RootView.swift:33-110`).
  The integrated input-parity work owns durable draft and pending-send stores in
  `RootView` (`RootView.swift:5-15,94-109,130-144`). Keep those views mounted
  behind an opaque, non-interactive lock layer; do not reload `WKWebView` merely
  because the phone backgrounded.
- **Presented native surfaces — dismiss on re-lock.** `NativeComposerView`
  presents actions, pairing, camera, capture, Files, and selection detail from
  local state (`../../../ios-app/CallbackBox/Views/NativeComposerView.swift:20-33,121-168`).
  Re-lock clears these presentation bindings before the protected content can
  become interactive again.
- **Lifecycle seam — reuse.** `RootView` already observes `.background` to flush
  drafts (`RootView.swift:137-144`). Add re-lock to that observer rather than
  creating a second app lifecycle path.
- **Tests/project wiring — reuse.** The app has a simulator XCTest target and
  documented build commands (`../../../ios-app/CLAUDE.md:49-79`). New Swift
  files still require all four manual project entries
  (`../../../ios-app/CLAUDE.md:89-104`).

## Prior art (external)

- Apple defines `LAContext` as the system mechanism for biometrics or passcode
  and requires `NSFaceIDUsageDescription` when Face ID may be used. Use a fresh
  context per attempt. <https://developer.apple.com/documentation/localauthentication/lacontext>
- `LAPolicy.deviceOwnerAuthentication` uses available biometrics and falls back
  to passcode; it specifically reports `passcodeNotSet` when no device passcode
  exists. Use it instead of biometrics-only policy.
  <https://developer.apple.com/documentation/localauthentication/lapolicy/deviceownerauthentication>
- `evaluatePolicy` is async and prior success does not guarantee later success.
  Every unlock and every attempt to disable a lock therefore evaluates again.
  <https://developer.apple.com/documentation/localauthentication/lacontext/evaluatepolicy(_:localizedreason:reply:)>
- Apple says `canEvaluatePolicy` results must not be persisted because
  availability can change. Check immediately before each attempt.
  <https://developer.apple.com/documentation/localauthentication/lacontext/canevaluatepolicy(_:error:)>
- SwiftUI's `.background` means the scene is not visible and may precede
  termination. It is the deterministic re-lock boundary.
  <https://developer.apple.com/documentation/SwiftUI/ScenePhase/background>
- No third-party lock/auth library is warranted. LocalAuthentication and the
  existing stores cover the scope, consistent with the no-third-party iOS rule
  (`../../../ios-app/CLAUDE.md:23-24`) and principle #6.

## Tracks / scope

### Track 1 — Persist and safely manage the local lock preference

**What.** Add `requiresDeviceUnlock: Bool` to `PairedBox`, migrate existing
snapshots, persist changes through `PairedBoxStore`, and expose one management
toggle.

**Why this needs to change.** The preference is local to this phone. A server
field would imply synchronization/enforcement outside the settled scope, while
a second local preferences file would duplicate paired-box identity. A naive
required field would erase the current paired list on decode failure.

**Direction.** Give `PairedBox` explicit `CodingKeys`, `init(from:)`, and
`encode(to:)`; use `decodeIfPresent(Bool.self, forKey:) ?? false` only at the
disk boundary so the in-memory type remains non-optional. Its explicit
initializer requires the Boolean with no default, forcing every reconstruction
(including `withSessionID`) to preserve it. New/manual/paired boxes pass
`false` explicitly. Add `PairedBoxStore.setRequiresDeviceUnlock(_:for:)`.

`PairBoxView` renders a `Toggle("Require Device Unlock", ...)`. Turning it on
persists immediately. Turning it off calls the shared authentication manager;
only `.authenticated` persists `false`. Cancellation/failure leaves the toggle
on. If the device specifically reports `passcodeNotSet`, show an explicit
confirmation explaining there is no device credential and allow **Disable Lock
Anyway**; unexpected inability/failure never enables that bypass. This closes
the review-discovered two-tap off-switch while retaining the issue's graceful
no-passcode behavior, tracing to principles #4-#6.

The composer box picker shows `lock.fill` for protected boxes while retaining
the selected checkmark. The setting defaults off independently on every phone.

**Vocabulary lock-ins.** `requiresDeviceUnlock`; **Require Device Unlock**;
**Disable Lock Anyway**. Do not say PIN, encrypted, secure data, or server
policy.

**First implementation chunk.** Tests first: legacy JSON decode, canonical
round-trip, `withSessionID` preservation, and lock-toggle store mutation. Then
land the model/store/toggle. No storage-failure refactor is added solely for this
feature; the store's existing persistence policy stays consistent, per
principle #6.

### Track 2 — Add a small authentication manager with late-result protection

**What.** Put Apple authentication behind an injected protocol and keep only the
minimum state required to cover/uncover the selected box.

**Why this needs to change.** Authentication completes asynchronously while the
app may background, the user may switch boxes, or a newer attempt may start. A
late success must not unlock a later selection or satisfy a later disable
request.

**Direction.** Add:

```swift
enum DeviceAuthenticationResult: Equatable {
    case authenticated
    case cancelled
    case passcodeNotSet
    case failed
}

protocol DeviceAuthenticating {
    func authenticate(reason: String) async -> DeviceAuthenticationResult
    func cancel()
}
```

`LocalDeviceAuthenticator` creates a fresh `LAContext`, checks
`.deviceOwnerAuthentication`, evaluates it, and maps only `passcodeNotSet` to
that bypass-capable result. User/app/system cancellation maps to `.cancelled`;
everything else maps to `.failed`. Add honest `NSFaceIDUsageDescription` copy:
“Use Face ID to unlock boxes you choose to lock in Callback Box.”

`BoxLockManager` is `@MainActor` and owns `unlockedBoxID`, a small presentation
status (`locked`, `authenticating`, `failed`, `passcodeNotSet`), the current
auth task, and a monotonically increasing attempt generation. The exact-ID
visibility predicate is:

```swift
box.requiresDeviceUnlock == false || unlockedBoxID == box.id
```

Selecting any different box or backgrounding increments the generation,
cancels/invalidate the context, clears `unlockedBoxID`, and returns to locked.
Completion changes state only when its generation and box ID still match.
Unlock is always user-initiated through **Unlock**; cold launch never raises a
surprise system prompt. A separate `authenticateForLockRemoval` uses the same
typed adapter and never treats a prior navigation unlock as permission to
disable the preference. These choices trace to principles #1, #5, #9, and #10.

**Vocabulary lock-ins.** `DeviceAuthenticating`,
`DeviceAuthenticationResult`, `LocalDeviceAuthenticator`, `BoxLockManager`.

**First implementation chunk.** Write a controllable fake and XCTest for
success, cancellation, failure, passcode-not-set, background cancellation, box
switch, repeated attempt, late completion, and separately authenticated lock
removal. Implement only enough manager/adapter code to pass them.

### Track 3 — Cover mounted content and close presented escape paths

**What.** Keep the chat/composer mounted but make it opaque, non-interactive,
and accessibility-hidden while protected; render the lock controls above it.

**Why this needs to change.** Removing the content branch would reload
`WKWebView`, discard visual position/streaming continuity, and remount the native
composer on every background. A mere root overlay is insufficient if composer
sheets remain presented above it.

**Direction.** `RootView` uses a `ZStack`: existing chat/composer content stays
mounted, then a fully opaque `LockedBoxView` is placed above it whenever the
exact-ID predicate fails. The underlying content receives
`.allowsHitTesting(false)` and `.accessibilityHidden(true)` while locked.

`LockedBoxView` displays the box label and:

- **Unlock** while locked;
- progress plus **Cancel** while authenticating;
- generic failure plus **Retry** after failure/cancellation;
- no-passcode explanation plus **Open Anyway** only for `passcodeNotSet`;
- **Choose Another Box** and **Manage Boxes** in every state.

Before a selected protected box re-locks, clear RootView's pairing sheet and
have `NativeComposerView` dismiss actions, pairing, camera, capture, Files, and
selection detail and stop dictation. Pair management intentionally remains
available from the lock screen, but Track 1 authenticates disabling. Box labels,
URLs, and the fact a box is paired are not protected content.

On selected-box change call `lockManager.relock()`. On `.background`, call it
synchronously and retain the existing async draft flush. Do nothing special on
`.inactive`: app-switcher snapshot privacy is explicitly outside this plan, and
adding a scene-level privacy window would exceed the phone-navigation scope.

Use ordinary SwiftUI previews for locked/authenticating/failure/no-passcode
layout; do not add a DEBUG launch-argument fixture matrix. This implements the
minimal gate while preserving app state, tracing to principles #6, #8, and #10.

**Vocabulary lock-ins.** `LockedBoxView`; **Unlock**, **Cancel**, **Retry**,
**Open Anyway**, **Choose Another Box**, **Manage Boxes**.

**First implementation chunk.** Bind the tested manager into `RootView`, add
the opaque blocking layer and alternate-box escape path, then add presentation
dismissal. Verify the webview remains mounted across lock/unlock.

### Track 4 — Parity accounting and device acceptance

**What.** Run the full automated/device matrix, record iOS/Android parity, and
leave the issue with a precise human closure gate.

**Why this needs to change.** Fakes cannot verify Face ID/passcode UI or actual
background transitions. The iOS guide says background-dependent behavior is not
fully verified until exercised on a real phone
(`../../../ios-app/CLAUDE.md:158-164`).

**Direction.** Add **Per-box local device lock** to `docs/mobile-parity.md` as
iOS done / Android planned, linked to a focused Android parity issue. There is
no `docs/mobile-contract.md` change because nothing crosses the wire. Commits
touching `PairedBox.swift`/`PairedBoxStore.swift` must include this exact trailer:

```text
Contract-Unchanged: Per-box lock preference remains local to iOS and changes no mobile wire contract.
```

Exercise successful biometric/passcode auth, cancellation, failure, background
during prompt, background after unlock, lock removal authentication, explicit
no-passcode degradation, switching protected/unprotected boxes, force
quit/relaunch, and durable composer/pending-send continuity. After code lands,
the feature issue changes from design-complete to `needs: [manual-testing]`
until the boxholder completes physical-device checks.

**Vocabulary lock-ins.** Parity capability **Per-box local device lock**.

**First implementation chunk.** Update parity/issue artifacts, run all checks,
and record only genuinely unperformed hardware cases as manual testing.

## Subplans

No subplan is required. There is no server policy, cryptography, Keychain work,
or wire protocol. If live synchronization or server-provided defaults become a
requirement, stop and write a separate policy subplan; principles #6 and #9
forbid growing it opportunistically here.

## Failure modes

There are no accepted critical gaps.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Old paired-box JSON lacks the Boolean | XCTest decodes legacy JSON and preserves every old field | Boundary decoder defaults only the lock to false | Clear in test; no reset |
| `withSessionID` drops the lock | XCTest reconstructs a protected box | Required initializer argument/compiler plus explicit forwarding | Clear test/compiler failure |
| Borrower opens management and disables lock | Fake-auth toggle test | Disabling always authenticates; cancellation/failure preserves true | Clear prompt/state |
| Device has no passcode while disabling | Fake-auth test and explicit confirmation test | Only passcodeNotSet offers Disable Lock Anyway | Clear degraded path |
| Protected box is selected at launch | Manager/root test | No matching unlocked ID; opaque layer blocks content | Clear lock screen |
| User cancels or fails auth | Manager tests and simulator | Remain locked; cancellation is quiet, failure offers Retry | Clear |
| Unexpected canEvaluate/evaluate error occurs | Fake adapter mapping test | Failed; never Open Anyway | Clear generic failure |
| Auth completes after background/switch/newer attempt | Suspended-fake generation tests | Stale generation/box result ignored | No access granted; asserted |
| Background prompt remains active | Manager cancellation test and device acceptance | Context invalidated and state re-locked | Clear |
| Webview reloads during lock/unlock | Root identity/integration inspection and device acceptance | Content remains mounted under overlay | Clear regression check |
| Composer sheet remains above lock | View interaction/device check | Re-lock dismisses every composer presentation | Clear lock screen |
| Underlying content remains tappable/accessibility-visible | View inspection | Hit testing disabled and accessibility hidden | Clear test/manual check |
| Switching away and back retains prior grant | Manager transition test | Every selection change clears unlocked ID | Clear prompt |
| Existing drafts/pending sends regress | Existing composer XCTest plus full suite | Stores remain RootView-owned and mounted | Clear regression failure |
| Face ID usage description missing | `plutil` check plus prompt inspection | Required key lands with authenticator | Clear check/device failure |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field — ADDRESSED.** No card tag exists; the only field is
  local `requiresDeviceUnlock`, never server `locked` (Track 1).
- **Stale ref — ADDRESSED.** Exact paired-box UUID gates visibility; removal or
  selection change clears the grant (Track 2).
- **Two agents touching the same card — NOT APPLICABLE.** No runtime card edits.
  The already-committed input-parity work is integrated before lock edits.
- **Hand-edit drift — ADDRESSED.** Explicit boundary decoding handles the missing
  legacy field but rejects malformed required identity/URL fields (Track 1).
- **Fabricated free-form value — ADDRESSED.** Framework error descriptions do
  not become security copy; the result is a closed enum (Track 2).
- **Validation error UX — ADDRESSED.** Cancel, fail, and passcode-not-set have
  distinct behavior/actions (Tracks 2-3).
- **Partial migration — ADDRESSED.** Missing means false; the next save writes
  canonical Boolean JSON (Track 1).

## NOT in scope

- Encrypting tokens, WebKit data, caches, or drafts; the issue rejects that
  threat model and Keychain storage has its own issue.
- Server/box configuration, pairing metadata, or synchronization; the setting
  is local to one iOS installation.
- Hand-rolled PINs, recovery codes, lockout counters, or passwords.
- Idle timers or grace periods; re-lock is background or box switch.
- Re-authentication for individual actions after the selected box is unlocked.
- Hiding box labels, URLs, or the fact a box is paired.
- App-switcher snapshot privacy and scene-level privacy windows; this plan gates
  returning to interactive box content, not OS snapshots.
- Stopping background capture uploads, notifications, or draft maintenance.
- Web/PWA or Android implementation; Android receives a parity follow-up.
- General pairing-flow cleanup or mobile-token Keychain migration.

## Open design questions

No open question blocks implementation. Unlock prompts are user-initiated;
background and every box switch discard the grant; only `passcodeNotSet` permits
explicit bypass; and disabling the preference re-authenticates independently.
Physical-device checks validate Apple lifecycle behavior without changing these
product decisions silently.

## Knowledge audits

No knowledge audit is needed. This is native app state, not a card schema,
agent command, or convention a box agent must recall. Types, XCTest, the parity
matrix, and the plan carry the behavior, following principle #12.

## Implementation order

1. **Revise plan and integrate prerequisite.** Record the reviewed minimal
   design and integrate the committed iOS input-parity branch before code edits.
2. **Tests-first persistence.** Add legacy decode/round-trip/reconstruction and
   store-toggle tests, then implement `requiresDeviceUnlock` and management UI.
3. **Tests-first authentication.** Add fake-driven manager/adapter-result tests,
   then implement LocalAuthentication, usage copy, and project membership.
4. **Mounted lock UI.** Add opaque blocking UI, box switching/management,
   authenticated disable, presentation dismissal, and background re-lock.
5. **Parity and closure.** Update parity/Android issue and feature issue, then
   run targeted/full XCTest, build, docs, and device/simulator acceptance.

These are commit boundaries, not shipping milestones; the full plan ships as
one unit.

## Rollout shape

### Automated checks

- `PairedBoxLockPreferenceTests`: legacy decode, canonical round-trip,
  `withSessionID`, store mutation.
- `BoxLockManagerTests`: success/cancel/failure/passcode-not-set, repeated and
  late attempts, background/switch, independent lock-removal auth.
- Existing composer/pending/capture XCTest remains green.
- Run `xcodebuild -list`, a signing-free generic simulator build, full XCTest on
  a discovered simulator UDID, and `plutil -lint`/`plutil -p` for `Info.plist`.
- Run callback-box doctests only if callback-box code changes beyond docs/parity;
  always run doc/path checks and normal hooks.

### Simulator and physical-device acceptance

- Simulator: successful Face ID, non-match, cancel/retry, authenticated disable,
  protected/unprotected switching, background/foreground, force quit/relaunch.
- Physical phone: biometric plus passcode fallback, cancel/failure, background
  during and after prompt, authenticated disable, no-passcode path if practical,
  switching, force quit, and large type.
- Confirm WebKit stays mounted and composer drafts/pending sends survive
  re-lock/unlock; confirm composer presentations dismiss on re-lock.

### Migration and release

- Migration is lazy: old JSON decodes lock=false; the next ordinary save writes
  the explicit Boolean. No standalone or server migration exists.
- Default is off for existing and new boxes; opt-in happens per phone.
- No feature flag is needed because the stored preference is default-off.
- Done means automated checks pass, simulator behavior is exercised, parity and
  follow-up artifacts exist, and physical-device checks are complete. Until the
  boxholder performs hardware acceptance, the issue remains open with
  `needs: [manual-testing]`.
