# iOS per-box device lock

**Status:** active — implementation has not started; simulator and real-device
background/authentication acceptance are required before this plan ships.

This plan adds an optional, device-local navigation lock to each box paired with
the iOS companion. A locked box requires Face ID, Touch ID, or the device
passcode before its web chat or native composer is constructed, and it re-locks
when the app backgrounds or the user switches boxes.

## Stated preferences this plan trades against

- `docs/engineering-principles.md` **#1 types are structure**: authentication
  and access phases are an exhaustive state rather than correlated booleans;
  **#3 validate at boundaries**: persisted paired-box JSON and
  `LocalAuthentication` results are decoded once; **#4 resilient and never
  silent**: cancellation, unavailable device auth, and failed auth remain visibly
  locked; **#5 failure paths visible in signatures**: the authentication adapter
  returns a typed result; **#6 right-sized defensiveness**: this is a navigation
  gate, not encryption; **#9 formal structure for essential complexity**: late
  async results and lifecycle changes go through one state machine; **#10
  testability is architectural**: OS authentication sits behind an injected
  adapter; and **#12 the maintainer is usually an agent**: the state shape and
  tests carry the lifecycle rules forward. The underlying principles say,
  respectively, *"Prefer types that make illegal states unrepresentable"*
  (`docs/engineering-principles.md:12-21`), *"Config is untrusted content too"*
  (`docs/engineering-principles.md:37-47`), and *"Seams ... are built into
  production code deliberately"* (`docs/engineering-principles.md:116-125`).
- `CLAUDE.md`: read the existing formats and API shapes before writing
  (`CLAUDE.md:104-109`), leave the repository clean and tested
  (`CLAUDE.md:111-116`), and do not duplicate web-chat state in the native shell.
  The iOS guide fixes that boundary: *"The webview is still the chat client"*
  (`../../../ios-app/CLAUDE.md:7-18`).
- `code-style.md`: keep failure handling visible (`code-style.md:24-33`) and
  exhaustive closed-state dispatch explicit (`code-style.md:53-59`). Swift is
  not ESLint-governed, but the plan follows the same intent with exhaustive
  enums, main-actor state, and no swallowed authentication errors.
- `docs/testing.md`: tests first force the authentication and lifecycle logic
  out of `RootView`, then document it, then anchor regressions. This is the
  declared order of value for tests (`docs/testing.md:3-17`).
- Settled product preference: the lock is for the unlocked-phone handoff case,
  not a storage-security boundary. The source issue says *"the gate is a
  navigation gate"* and explicitly rejects wrapping tokens or caches in a
  biometric-protected key (`../../../issues/features/2026-07-19-per-box-lock-native-auth.md:36-55`).
- Shipped mobile precedent: native contract changes must update the contract,
  shared fixtures, and parity matrix together
  (`docs/implemented-plans/mobile-parity-sync.md:115-134`). This plan deliberately
  avoids a wire change, but it still updates the parity matrix because it adds an
  iOS-only companion capability.

## What already exists

### Per-device box identity and persistence

- **Reuse `PairedBox` as the setting owner.** Each paired entry already has a
  stable UUID and is persisted in Application Support
  (`../../../ios-app/CallbackBox/Models/PairedBox.swift:3-16` and
  `../../../ios-app/CallbackBox/Storage/PairedBoxStore.swift:5-23,128-153`). Add
  `requiresDeviceUnlock: Bool` there; do not create a second preferences file.
- **Migrate old snapshots during decode.** `PairedBox` is currently synthesized
  `Codable` (`PairedBox.swift:3-16`), so adding a required Boolean would make
  every existing `paired-boxes.json` fail to decode and the store would silently
  reset to no boxes through its broad load fallback
  (`PairedBoxStore.swift:128-137`). Add explicit decoding that defaults a missing
  field to `false`, plus XCTest proving old snapshots survive. This follows
  principles #3 and #4: persisted JSON is a boundary and migration failure must
  not erase the user's paired list.
- **Extend the existing management UI.** `PairBoxView` already lists every
  paired box and its token status (`../../../ios-app/CallbackBox/Views/PairBoxView.swift:47-68`).
  Add a local “Require Device Unlock” toggle per row and a store mutation that
  persists it. The existing composer box picker is the normal switch surface
  (`../../../ios-app/CallbackBox/Views/ComposerActionsView.swift:51-70`); give
  protected entries a lock icon rather than introducing another box model.

### Native shell and lifecycle

- **Gate above both native surfaces.** `RootView` currently constructs
  `ChatWebView` and then adds `NativeComposerView` as its safe-area inset
  (`../../../ios-app/CallbackBox/Views/RootView.swift:27-67`). The access decision
  belongs above that branch so neither sensitive transcript pixels nor native
  composer state are rendered while locked. This preserves the architectural
  boundary and principle #8, one way to enter a box.
- **Reuse scene lifecycle observation.** The committed iOS input-parity work
  already observes `scenePhase` in `RootView` to flush drafts on background
  (`b7aa43f7:ios-app/CallbackBox/Views/RootView.swift:5-7,137-144`). Integrate
  lock transitions into that one observer after the parity branch lands; do not
  add competing app-delegate notifications. This plan is implemented after
  `worktree-ios-input-parity` is integrated so the final `RootView` is edited
  once, following principles #8 and #12.
- **Reuse ordinary background work unchanged.** Capture uploads subscribe to the
  paired-box list at app startup (`../../../ios-app/CallbackBox/CallbackBoxApp.swift:9-19`).
  A navigation lock must not revoke tokens, stop upload coordination, or mutate
  drafts; it only controls construction of the selected box's interactive UI.

### Native test and simulation infrastructure

- **Reuse XCTest and DEBUG fixtures.** The app already has a simulator XCTest
  target and shared-fixture loader (`../../../ios-app/CLAUDE.md:49-79`), while
  DEBUG launch arguments select fixture screens before ordinary root content
  (`RootView.swift:13-24`). Add focused controller/model XCTest and a lock-screen
  fixture; do not make the real `LAContext` prompt the unit-test dependency.
- **Reuse the manual Xcode project discipline.** New Swift files require a file
  reference, build-file entry, group membership, and target source membership
  (`../../../ios-app/CLAUDE.md:89-104`). The implementation adds both app and
  test files intentionally and verifies the project immediately.

## Prior art (external)

- Apple documents `LAContext` as the system mechanism for authenticating with
  biometrics or the device passcode, and requires `NSFaceIDUsageDescription`
  when Face ID may be used. Use one fresh context per attempt and add honest
  usage copy to `Info.plist`.
  <https://developer.apple.com/documentation/localauthentication/lacontext>
- `LAPolicy.deviceOwnerAuthentication` tries available biometrics and falls back
  to device passcode; it fails with `passcodeNotSet` when the device has no
  passcode. This is the correct policy; do not use the biometrics-only policy.
  <https://developer.apple.com/documentation/localauthentication/lapolicy/deviceownerauthentication>
- Apple exposes `evaluatePolicy` as async and warns that prior success does not
  guarantee later success. Every unlock therefore creates a new attempt and
  handles cancellation/failure explicitly rather than caching an `LAContext`.
  <https://developer.apple.com/documentation/localauthentication/lacontext/evaluatepolicy(_:localizedreason:reply:)>
- Apple says not to persist `canEvaluatePolicy` because availability may change.
  Check it immediately before every evaluation and map its error into the typed
  result.
  <https://developer.apple.com/documentation/localauthentication/lacontext/canevaluatepolicy(_:error:)>
- SwiftUI defines `inactive` as foreground but non-interactive and `background`
  as not visible, possibly immediately preceding termination. Use `inactive` to
  cover content for app-switcher snapshots, but clear authorization only on
  `background`; this avoids treating every transient interruption as a full
  re-auth while still serving the phone-share case.
  <https://developer.apple.com/documentation/SwiftUI/ScenePhase/inactive> and
  <https://developer.apple.com/documentation/SwiftUI/ScenePhase/background>
- No third-party authentication or lock library is warranted. LocalAuthentication,
  SwiftUI lifecycle, and the existing persistence/store patterns cover the
  complete scope, consistent with the app's no-third-party-dependencies rule
  (`../../../ios-app/CLAUDE.md:23-24`) and principle #6.

## Tracks / scope

### Track 1 — Persist the local per-box lock preference

**What.** Add a device-local `requiresDeviceUnlock` preference to every
`PairedBox`, expose it in box management, and visually mark protected entries in
box pickers.

**Why this needs to change.** The threat being addressed exists at the phone UI,
and the current persisted model has no per-box presentation preference
(`PairedBox.swift:3-16`). A server declaration would either be fetched before
every navigation or become stale after pairing. The former turns a local
navigation affordance into a network policy protocol; the latter silently
claims a box is locked when an already-paired phone still opens it. Neither is
right-sized for the explicitly non-security boundary.

**Direction.** Make the phone's paired-box record the sole source of truth:

```swift
struct PairedBox: Codable, Equatable, Identifiable {
    // existing fields
    var requiresDeviceUnlock: Bool
}
```

Decode a missing key as `false`; always encode the canonical Boolean. Add
`PairedBoxStore.setRequiresDeviceUnlock(_:for:)`, which updates one box and
atomically saves the existing snapshot. In `PairBoxView`, each paired-box row
gets a `Toggle("Require Device Unlock", ...)`. Enabling it on the selected box
must make the next root render locked immediately; disabling it opens the box
without another prompt. The composer box picker shows `lock.fill` for protected
boxes and preserves its existing checkmark for the selected box.

The preference is intentionally per device. Pairing a box on another phone
defaults to unlocked until the boxholder enables it there. This accurately
describes a local navigation affordance and avoids inventing a remote enforcement
promise, tracing to principles #4 and #6.

**Vocabulary lock-ins.** User-facing noun **lock**; model field
`requiresDeviceUnlock`; UI label **Require Device Unlock**. Do not use “PIN,”
“encrypted,” “secure box,” or “protected data.”

**First implementation chunk.** Write failing paired-box decoding/round-trip
tests, add the model/store migration, and add the management toggle. This chunk
has no authentication prompt yet, but enabling a selected box must route to a
temporary locked placeholder so it never creates a false “enabled but open”
state. This follows principles #3, #4, and #10.

### Track 2 — Build the access state machine and LocalAuthentication adapter

**What.** Isolate box access transitions from SwiftUI and isolate the Apple
framework behind a narrow injectable adapter.

**Why this needs to change.** Authentication completes asynchronously while box
selection and scene phase may change. A late success for box A must never unlock
box B; backgrounding during a prompt must cancel the attempt and remain locked.
View-local booleans cannot make those invalid combinations unrepresentable.

**Direction.** Add these shapes, adjusted only for Swift naming details during
implementation:

```swift
enum DeviceAuthenticationResult: Equatable {
    case authenticated
    case cancelled
    case unavailable(message: String)
    case failed(message: String)
}

protocol DeviceAuthenticating {
    func authenticate(reason: String) async -> DeviceAuthenticationResult
    func cancel()
}

enum BoxAccessState: Equatable {
    case unrestricted
    case locked(boxID: UUID)
    case authenticating(boxID: UUID, attemptID: UUID)
    case unavailable(boxID: UUID, message: String)
    case failed(boxID: UUID, message: String)
    case unlocked(boxID: UUID)
}
```

`BoxAccessController` is `@MainActor` and owns the selected-box transition,
unlock attempt, scene-background transition, and exact-ID visibility predicate.
Selection of an unprotected box is `.unrestricted`. Selection of a protected
box is visible only when the state is `.unlocked` for that same UUID. Switching
boxes clears the prior unlock; returning to it prompts again. Backgrounding
calls `cancel()`, invalidates the attempt ID, and synchronously returns a
protected selection to `.locked`. A result is accepted only when both attempt
ID and selected box still match.

`LocalAuthenticationService` creates a fresh `LAContext`, calls
`canEvaluatePolicy(.deviceOwnerAuthentication, ...)`, then async
`evaluatePolicy`. It maps user/app/system cancellation to `.cancelled`,
`passcodeNotSet` and other inability to evaluate to `.unavailable`, and genuine
failed/error outcomes to `.failed`. Its reason is “Unlock this box.” Add
`NSFaceIDUsageDescription`: “Use Face ID to unlock boxes you choose to lock in
Callback Box.” These typed transitions implement principles #1, #4, #5, #9,
and #10.

**Vocabulary lock-ins.** `DeviceAuthenticating`,
`DeviceAuthenticationResult`, `BoxAccessController`, and `BoxAccessState`.
“Authenticated” is one attempt's result; “unlocked” is the selected box's
current in-memory navigation state.

**First implementation chunk.** Write controller tests with a controllable fake
authenticator for launch, success, cancellation, unavailable auth, failure,
background cancellation, box switch, and late completion. Then implement the
adapter and controller until those tests pass. No real prompt is required in
XCTest, following principle #10.

### Track 3 — Gate and cover the native shell

**What.** Replace the selected-box branch with an exhaustive access-state render
that withholds the webview/composer, offers recovery and box switching, and
covers content while the scene is inactive.

**Why this needs to change.** `RootView` currently constructs the sensitive
surfaces immediately for any selected box (`RootView.swift:27-67`). Also, the
ordinary box switcher lives inside the native composer, so it becomes
inaccessible once that composer is correctly withheld
(`ComposerActionsView.swift:51-70`). The locked state needs its own escape path.

**Direction.** Inject one `BoxAccessController` into `RootView`. The selected
box renders exactly one of:

- unprotected or unlocked: the existing `ChatWebView` plus native composer;
- locked: a neutral `LockedBoxView` with box label, **Unlock**, **Choose Another
  Box**, and **Manage Boxes**;
- authenticating: the same neutral surface with progress and Cancel;
- unavailable: explanation that device authentication is not configured,
  **Open Anyway**, **Choose Another Box**, and **Manage Boxes**;
- failed/cancelled: remain locked, show a short failure only for genuine failure,
  and offer Retry. User/system cancellation is not presented as an alarming
  error.

“Open Anyway” is shown only for `.unavailable`, never ordinary failure. It is the
explicit graceful degradation chosen by the source issue for a phone with no
passcode; it avoids making the box unreachable without silently pretending an
unlock happened. The screen says this lock controls access inside the app and
does not claim encryption.

Observe `scenePhase` at the existing root lifecycle seam. When phase becomes
`.inactive`, overlay an opaque neutral privacy cover over the entire scene so
the app-switcher snapshot does not show the transcript. Do not clear the
authorization merely for `.inactive`. When phase becomes `.background`, clear
authorization synchronously and keep the cover. On `.active`, remove the cover;
if the selected box is protected, the already-reset controller displays the
lock screen. Preserve the input-parity branch's draft flush in the same
background handler. This separates visual covering from re-lock policy and
traces to principles #4, #8, and #9.

Add a DEBUG `--box-lock-fixture=<locked|authenticating|unavailable|failed>`
surface for compact/regular widths, light/dark mode, and large type. It uses no
real box content and no real `LAContext`, following principle #10.

**Vocabulary lock-ins.** `LockedBoxView`; buttons **Unlock**, **Retry**,
**Open Anyway**, **Choose Another Box**, and **Manage Boxes**. A lock icon may
identify the state, but no shield/encryption copy is used.

**First implementation chunk.** Render `LockedBoxView` from the tested
controller, prove by inspection/test seam that `ChatWebView` is not constructed
for a protected locked UUID, and add the alternate-box escape path. Then wire
scene covering/re-lock and DEBUG fixtures.

### Track 4 — Acceptance, parity accounting, and handoff

**What.** Verify actual LocalAuthentication and lifecycle behavior, record the
iOS/Android divergence, and leave a human-testable closure path.

**Why this needs to change.** A fake can prove state transitions but not system
prompt copy, Face ID fallback, app-switcher snapshots, or the precise ordering
of scene transitions on hardware. The iOS guide explicitly says simulator-only
coverage is insufficient for background behavior
(`../../../ios-app/CLAUDE.md:158-164`).

**Direction.** Add a row to `docs/mobile-parity.md`: per-box local device lock is
done on iOS and planned on Android, linked to a focused Android parity issue.
Because the preference and authentication never cross the native/server wire,
`docs/mobile-contract.md` and golden fixtures do not change; use a justified
`Contract-Unchanged:` trailer if the mobile tripwire requires one.

Exercise the real prompt in Simulator using its Face ID enrollment/matching and
non-matching controls. Then exercise on a physical iPhone: Face ID/Touch ID or
passcode fallback, Cancel/Retry, locked-to-unlocked and locked-to-locked box
switches, app switcher/background/foreground, notification/control-center
inactive transitions, screen rotation, force quit/relaunch, and large type.
Confirm the app-switcher snapshot never exposes the selected protected box and
that background capture uploads/durable composer state continue unaffected.

After code lands, replace the feature issue's `needs: [design]` with
`needs: [manual-testing]` until the physical-device checklist above is signed
off; an agent must not clear it. This follows issues queue policy and principles
#4 and #10.

**Vocabulary lock-ins.** Parity capability name **Per-box local device lock**.
Android gets its own follow-up rather than silently inheriting an iOS behavior.

**First implementation chunk.** Add the parity row and Android follow-up issue,
run the full automated suite, capture DEBUG fixture screenshots, and write the
specific remaining physical-device checklist into the source issue.

## Subplans

No subplan is required. The design deliberately keeps policy device-local and
uses the platform's existing authentication UI, so there is no server policy,
credential-storage, cryptography, or cross-platform wire protocol to design.
If implementation uncovers a requirement for server-declared defaults or live
policy synchronization, stop and write a separate policy-sync subplan rather
than extending this navigation-lock plan opportunistically. This is the scope
boundary required by principles #6 and #9.

## Failure modes

There are no accepted critical gaps. Every new codepath has either automated
coverage plus handling, or an explicit device-verification gate before closure.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| An old `paired-boxes.json` lacks `requiresDeviceUnlock` | XCTest decodes a legacy snapshot and preserves all boxes | Explicit decoder defaults only that field to `false` | Clear in test; no destructive reset |
| Persisting a changed toggle fails | Store test injects an unwritable repository or save failure seam | Revert the in-memory toggle and show an error in management UI; do not claim it saved | Clear |
| A protected box is selected at cold launch | Controller launch test | Initial state is `.locked`; content visibility requires matching `.unlocked(boxID)` | Clear lock screen |
| User cancels Face ID/passcode | Fake-auth controller test and simulator check | Remain locked; offer Retry without alarming error copy | Clear |
| Authentication genuinely fails | Fake-auth controller test and simulator non-match | Remain locked; show concise failure and Retry | Clear |
| Device has no passcode or auth policy is unavailable | Fake-auth test; real-device check when practical | `.unavailable` explains limitation and offers explicit Open Anyway or another box | Clear degraded path |
| App backgrounds while the system prompt is active | Controllable suspended-auth XCTest; device acceptance | Cancel context, invalidate attempt, synchronously lock | Clear |
| A successful result arrives after backgrounding or switching boxes | Late-result XCTest | Attempt UUID plus exact box UUID rejects the stale completion | Silent to user, asserted by test; no access granted |
| User switches from unlocked A to protected B | Controller transition test | A's grant is cleared; B starts locked | Clear lock screen |
| User returns to previously unlocked A | Controller transition test | Every box switch discarded A's grant; prompt again | Clear lock screen |
| Scene goes inactive for Control Center but never backgrounds | Controller/cover state test and device acceptance | Opaque cover while inactive; retain grant until actual background | Clear visual cover |
| App-switcher snapshot races the privacy cover | DEBUG fixture plus physical-device screenshot inspection | Release is blocked on manual verification; if SwiftUI timing is insufficient, move cover to the scene/app lifecycle boundary | Clear release gate |
| Enabling lock on the currently displayed box | Model/controller integration test | Exact-ID visibility predicate hides content on the next render and enters `.locked` | Clear lock screen |
| Disabling lock while selected | Model/controller integration test | State becomes `.unrestricted`; no stale prompt remains | Clear |
| Locked screen offers no way to reach another box | View fixture/interaction check | Dedicated Choose Another Box action exists outside the composer | Clear |
| Background capture or draft persistence is accidentally stopped | Existing capture/composer XCTest plus full suite | Access controller owns only rendering/auth state and does not mutate runtime queues | Clear regression failure |
| `NSFaceIDUsageDescription` is missing or misleading | `plutil` assertion in acceptance script/checklist plus real prompt inspection | Required key lands with the adapter; copy names local box unlock only | Clear build/acceptance failure |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field — ADDRESSED.** This feature introduces no card tag.
  The analogous risk is using a vague server field such as `locked`; Track 1
  fixes the sole field as device-local `requiresDeviceUnlock` and principles #1
  and #6 support that narrower vocabulary.
- **Stale ref — ADDRESSED.** Box identity is the persisted UUID already used by
  selection (`PairedBoxStore.swift:18-23,105-107`). A missing/removed UUID cannot
  retain access because the controller visibility predicate requires the current
  selected UUID, per Track 2.
- **Two agents touching the same card — NOT APPLICABLE.** No card is edited at
  runtime. Source-level merge overlap is likely in `RootView` while iOS parity is
  in flight, so implementation waits for that committed branch to integrate and
  edits the resulting lifecycle seam once (What already exists).
- **Hand-edit drift — ADDRESSED.** A hand-edited or legacy paired-box JSON file
  is parsed by explicit `Codable` migration; malformed required identity/URL
  fields remain an invalid snapshot rather than being guessed. This follows
  principle #3.
- **Fabricated free-form value — ADDRESSED.** Authentication errors are mapped to
  a closed result and user copy; the UI does not interpolate arbitrary framework
  descriptions as security claims. Principle #4 requires the failure to remain
  visible without overstating it.
- **Validation error UX — ADDRESSED.** The unavailable and failed states have
  different actions and copy in Track 3. Cancellation stays locked but is not
  mislabeled as failure, following principles #4 and #5.
- **Partial migration / transition state — ADDRESSED.** Missing Boolean means
  unlocked, newly encoded records always contain it, and no server/client
  version handshake exists. Track 1 tests both old and new snapshots.
- **Compaction/agent rediscovery — ADDRESSED.** The implementation updates the
  iOS guide only if it adds a reusable lifecycle/auth convention; otherwise the
  plan, parity matrix, exhaustive types, and tests are sufficient. This applies
  principle #12 without turning one feature into general infrastructure docs.

## NOT in scope

- **Encrypting tokens, WebKit data, caches, or drafts.** The source issue rejects
  that threat model; the separate Keychain issue remains independent.
- **Server-declared lock policy or `config/box.json` field.** A server value
  cannot enforce a native navigation affordance, and syncing it would add a
  policy protocol disproportionate to the phone-share scope. A future
  server-provided default requires its own subplan.
- **A hand-rolled PIN, recovery code, lockout counter, or password.** The device
  owner authentication policy owns those concerns.
- **Idle timers or configurable grace periods.** Re-lock is deterministic:
  background or any box switch. No elapsed-time state exists.
- **Re-authentication for each sensitive action inside an unlocked box.** One
  successful attempt unlocks the selected box until switch/background.
- **Hiding box labels or lock icons.** The navigation gate protects entry to box
  content, not the fact that a paired box exists.
- **Stopping capture uploads, notifications, scheduled work, or persisted draft
  maintenance.** Those background operations do not render box content.
- **Web/PWA and Android implementation in this plan.** Android receives a parity
  issue; WebAuthn would be a different browser threat/UX design.
- **Keychain migration of the existing mobile token.** Tracked separately by
  `issues/bugs/2026-07-17-ios-token-plaintext-not-keychain.md`.
- **General pairing-flow cleanup.** Duplicate redeem dispatch and loud pairing
  failure remain owned by their existing issue; this plan changes only the local
  setting UI around paired entries.

## Open design questions

No question blocks the first implementation chunk. The following are explicit
post-implementation observation points, not license to vary the design silently:

- **Does `.inactive` cover render early enough for app-switcher snapshots on all
  supported devices?** Lean: yes with an opaque root overlay; physical-device
  acceptance decides. If not, move only the cover trigger to a lower UIKit scene
  lifecycle hook while retaining `.background` as the authorization reset.
- **Should a future box declaration supply the initial local toggle default?**
  Lean: only if repeated multi-device setup becomes a demonstrated problem. It
  needs a policy-sync subplan because “default at pairing” and “live enforced
  policy” have materially different stale-state behavior.
- **Should inactive transitions also revoke authorization?** Lean: no. Incoming
  calls, permission prompts, and Control Center can make a scene inactive without
  the user handing the phone away. The opaque cover handles exposure; background
  remains the simple re-lock boundary settled in the issue.

## Knowledge audits

No knowledge-audit entry is needed. `requiresDeviceUnlock` is native application
state, not a card format, agent command, schema field, or convention a box agent
must recall. Future maintainers are protected by the model migration tests,
state-machine tests, iOS guide pointer if warranted, and mobile parity row. This
is an explicit principle #12 judgment: enforce in types/tests rather than add an
irrelevant prompt-memory audit.

## Implementation order

1. **Integrate prerequisite iOS parity work.** Land/rebase the committed
   `worktree-ios-input-parity` work, then refresh `RootView` citations and run its
   existing XCTest suite. This avoids parallel lifecycle implementations.
2. **Tests-first paired-box migration.** Add legacy decode, canonical encode,
   toggle persistence/failure, and current-selection behavior tests; then add
   `requiresDeviceUnlock`, the store mutation, management toggle, and picker
   icons. Commit as one model/persistence/UI chunk.
3. **Tests-first authentication core.** Add controllable fake authentication and
   exhaustive controller tests; then add `LocalAuthenticationService`,
   `BoxAccessController`, `Info.plist` usage copy, and Xcode membership. Commit as
   one domain/adapter chunk.
4. **Locked shell and lifecycle.** Gate `ChatWebView`/composer construction, add
   locked/unavailable/failure UI and alternate-box navigation, add inactive
   cover/background reset, and preserve the parity branch's draft flush. Add
   DEBUG fixtures and commit the integrated UI chunk.
5. **Parity and closure artifacts.** Update `docs/mobile-parity.md`, file the
   Android parity follow-up, link this plan from the feature issue, and replace
   `needs: [design]` with the precise `needs: [manual-testing]` checklist after
   implementation. Commit with documentation checks.
6. **Acceptance.** Run focused and full XCTest, signing-free simulator build,
   fixture captures, simulator LocalAuthentication checks, and physical-device
   acceptance. Fix failures before requesting `/finish`; only the boxholder
   clears `needs: [manual-testing]`.

Each numbered implementation chunk may be one or a few cohesive commits, but
none is a shipping milestone. The complete plan ships as one unit, consistent
with the planning discipline and principle #8.

## Rollout shape

### Automated checks

- Tests are written before their production chunk. Required XCTest names/shapes:
  `PairedBoxLockPreferenceTests` (legacy decode, canonical round trip, toggle
  persistence), `BoxAccessControllerTests` (all transitions and late results),
  and a small root rendering seam/fixture assertion proving a locked UUID never
  constructs box content.
- Run the full iOS suite on a currently installed simulator discovered with
  `xcrun simctl list devices available`:

  ```sh
  xcodebuild -quiet \
    -project ios-app/CallbackBox.xcodeproj \
    -scheme CallbackBox \
    -configuration Debug \
    -destination 'platform=iOS Simulator,id=<SIMULATOR-UDID>' \
    test
  ```

- Run a signing-free generic simulator build and `plutil -lint`/`plutil -p` on
  `Info.plist`. Adding files also requires `xcodebuild -list` immediately after
  project-file edits, per the iOS guide.
- Run `pnpm --dir callback-box test` only if implementation touches callback-box
  code beyond docs/parity accounting. Always run the root documentation and
  path-leak checks through the normal commit hooks.
- Capture DEBUG fixture screenshots at compact iPhone and iPad widths, light and
  dark appearance, and a large Dynamic Type size. Verify buttons remain reachable
  and no box content exists behind translucent material.

### Simulator and physical-device acceptance

- Simulator: enable Face ID, unlock successfully, simulate a non-matching face,
  cancel, retry, switch between one protected and one unprotected box, background
  and foreground, force quit/relaunch, and inspect the app-switcher snapshot.
- Physical iPhone: repeat successful biometric and passcode fallback, Cancel,
  background during a prompt, app-switcher handoff, notification/control-center
  inactive transitions, rotation, force quit, and large type. If practical,
  verify the explicit unavailable/Open Anyway path on a device with no passcode;
  otherwise the injected test remains the verification and the issue records
  that device case as unexercised.
- Confirm existing composer drafts/pending sends survive re-authentication and
  existing capture uploads continue while the UI is locked. These are regression
  checks, not new lock responsibilities.

### Migration and release

- Migration is lazy and atomic: the first successful load of an old paired-box
  snapshot supplies `false` in memory; the next ordinary save writes the explicit
  field. No standalone migration script or server migration exists.
- The feature defaults off for every existing and newly paired box. Users opt in
  per phone from **Pair or Manage Boxes**. Release notes describe it as an app
  navigation lock and explicitly not encrypted storage.
- No feature flag is needed: the default-off Boolean is the rollout control.
  If LocalAuthentication is unavailable, only opted-in boxes see the explicit
  degraded screen.
- Done means all automated checks pass, DEBUG fixtures are visually clean, the
  parity row/follow-up exist, and the physical-device checklist is completed.
  Until the boxholder performs that last check, the feature issue stays open with
  `needs: [manual-testing]`.
