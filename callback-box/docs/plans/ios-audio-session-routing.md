# iOS audio-session routing

The iOS app configures `AVAudioSession` in two record paths and never
configures it for playback. The result is audio that leaves Bluetooth and
plays quietly. This plan gives the app one owner for the audio session, one
recording configuration, and an explicit idle configuration.

Source issue:
[iOS: audio drops off Bluetooth and plays very quietly](../../../issues/bugs/2026-07-31-ios-audio-session-bluetooth-drop-low-volume.md).

Authority for every AVFoundation claim below is the iOS 26.5 SDK header
shipped with the installed Xcode 26.6:

```text
$(xcrun --sdk iphoneos --show-sdk-path)/System/Library/Frameworks/
  AVFAudio.framework/Headers/AVAudioSessionTypes.h
```

Referred to below as `AVAudioSessionTypes.h:<line>`. Apple's HTML
documentation renders through JavaScript and cannot be fetched by an agent;
the header carries the same text and is checkable from this machine.

## Stated preferences this plan trades against

- `callback-box/docs/engineering-principles.md:49` — **4. Resilient AND never
  silent.** The current failure is silent: audio quietly degrades and no code
  path reports it. New route failures must not repeat that.
- `callback-box/docs/engineering-principles.md:116` — **10. Testability is
  architectural.** Audio routing cannot be tested headlessly. A pure decision
  core separated from the IO shell can be.
- `callback-box/docs/engineering-principles.md:95` — **8. One way to do each
  thing.** Two record paths currently hold two different, independently wrong
  session configurations.
- `callback-box/docs/engineering-principles.md:23` — **2. Exhaustiveness is
  enforced.** The session has a small set of roles. A Swift enum with an
  exhaustive `switch` is the right shape.
- `ios-app/CLAUDE.md:36` — *"The deployment target is iOS 17; newer APIs
  require availability checks and an older-system fallback."* One option in
  this plan is iOS 26.0 only.
- `ios-app/CLAUDE.md:213` — *"A change is not fully verified when it depends
  on camera hardware, iCloud Photos, microphone/speech models, audio
  interruptions, background execution, QR pairing, signing, or physical
  keyboard/safe-area behavior until it passes on a real phone."* This plan
  ends in a manual device check by the boxholder.
- `CLAUDE.md` (monorepo root) — *"Treat noisy command output as a bug."* The
  option the issue proposes (`.allowBluetooth`) is deprecated in the iOS 26
  SDK and would add a build warning.
- Precedent: `CaptureAcquisition.swift:624` — the
  `CaptureAudioSessionControlling` protocol. The app already treats the audio
  session as an injectable seam in one of the two paths. This plan extends
  that precedent rather than inventing a second shape.

`code-style.md` is TypeScript-specific and does not govern Swift files. No
Swift lint preset exists in the repo, so the Swift conventions followed here
are the ones already visible in `ios-app/CallbackBox/Services/`.

## What already exists

- **`ios-app/CallbackBox/Services/SpeechDictation.swift:287-292`** — the
  dictation session:
  ```swift
  try audioSession.setCategory(
      .playAndRecord,
      mode: .measurement,
      options: [.defaultToSpeaker, .duckOthers]
  )
  try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
  ```
  Rebuilt by this plan. The call site moves to the new owner; the surrounding
  startup sequence stays.
- **`ios-app/CallbackBox/Services/CaptureAcquisition.swift:629-639`** — the
  capture session, behind a protocol:
  ```swift
  struct SystemCaptureAudioSession: CaptureAudioSessionControlling {
      func activate() throws {
          let session = AVAudioSession.sharedInstance()
          try session.setCategory(.record, mode: .default, options: [.duckOthers])
          try session.setActive(true, options: .notifyOthersOnDeactivation)
      }

      func deactivate() {
          try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
      }
  }
  ```
  The `CaptureAudioSessionControlling` seam at `:624` is **reused**. Only the
  body of `SystemCaptureAudioSession` changes; the protocol keeps its two
  methods, and `CaptureAudioRecorder`'s injection point at `:690` is
  untouched.
- **`ios-app/CallbackBox/Services/SpeechDictation.swift:209`** and
  **`CaptureAcquisition.swift:637`** — both stop paths call
  `setActive(false, options: .notifyOthersOnDeactivation)` and nothing else.
  Reused as the deactivation half; the category restore is added there.
- **`ios-app/CallbackBox/Services/NativeEarcons.swift:165-182`** — earcon
  playback creates an `AVAudioPlayer` and calls `player.play()`. It never
  touches `AVAudioSession`. It stays that way: it is a client of whatever
  category the new owner has installed.
- **`ios-app/CallbackBox/Views/ChatWebView.swift:139-140`** —
  `allowsInlineMediaPlayback = true` and
  `mediaTypesRequiringUserActionForPlayback = []`. Web-side audio (earcons in
  `callback-box/src/frontend/src/lib/audio/context.ts:71`, `<audio controls>`
  on commit detail at `CommitDetail-tabs.tsx:36`) plays under the app's
  session category. It is the second client of the idle category.
- **`ios-app/CallbackBox/CallbackBoxAppDelegate.swift`** — the launch hook.
  Reused as the place to install the idle category once.
- **Nothing else configures audio.** `grep -rn "setCategory" ios-app` returns
  exactly the two sites above. There is no existing audio-session helper to
  reuse, so the new file is net-new rather than a rebuild of something
  existing.

## Prior art (external)

- **`.measurement` lowers output level — confirmed, not inferred.**
  `AVAudioSessionTypes.h:157-159`: *"Appropriate for applications that wish to
  minimize the effect of system-supplied signal processing for input and/or
  output audio signals. This mode disables some dynamics processing on input
  and output resulting in a lower output playback level."* The issue's
  symptom-to-flag mapping is correct.
- **`.defaultToSpeaker` does NOT override Bluetooth — the issue is wrong
  here.** `AVAudioSessionTypes.h:491-498`: *"`AVAudioSessionCategoryPlayAndRecord`:
  DefaultToSpeaker will default to false, but can be set to true, routing to
  Speaker (instead of Receiver) **when no other audio route is connected**."*
  So `.defaultToSpeaker` is not the cause of the Bluetooth drop, and removing
  it would route dictation output to the earpiece whenever no accessory is
  connected. This plan keeps it.
- **Missing `.allowBluetoothA2DP` IS the Bluetooth drop.**
  `AVAudioSessionTypes.h:521-531`: *"`AVAudioSessionCategoryPlayAndRecord`:
  AllowBluetoothA2DP defaults to false… `AVAudioSessionCategoryMultiRoute` and
  `AVAudioSessionCategoryRecord`: AllowBluetoothA2DP is false, and cannot be
  set to true. Other categories: AllowBluetoothA2DP is always implicitly true."*
  A2DP is available by default for `.playback` and off by default for
  `.playAndRecord`. Activating today's dictation session therefore removes the
  A2DP route.
- **HFP beats A2DP on a device that offers both.**
  `AVAudioSessionTypes.h:534-538`: *"Setting both
  `AVAudioSessionCategoryOptionAllowBluetoothHFP` and
  `AVAudioSessionCategoryOptionAllowBluetoothA2DP` is allowed. In cases where a
  single Bluetooth device supports both HFP and A2DP, the HFP ports will be
  given a higher priority for routing. For HFP and A2DP ports on separate
  hardware devices, the last-in wins rule applies."* This is the cost of the
  boxholder's decision to allow the Bluetooth microphone, and it is inherent
  to the platform, not to this design. Corroborated by
  [Understanding AVAudioSession Routes on iOS](https://medium.com/@mehsamadi/understanding-avaudiosession-routes-on-ios-7718d934d0c0).
- **`.allowBluetooth` is deprecated in the iOS 26 SDK; the replacement is a
  pure rename.** `AVAudioSessionTypes.h:468-469`:
  *"Deprecated - please see `AVAudioSessionCategoryOptionAllowBluetoothHFP`"*,
  with `API_DEPRECATED_WITH_REPLACEMENT(...)`. Both constants are `0x4` and
  `allowBluetoothHFP` is `API_AVAILABLE(ios(1.0))`, so the replacement needs
  no availability guard at the iOS 17 deployment target. Apple confirmed the
  behaviour is identical and that the iOS 8 deprecation annotation is a
  mistake:
  [Apple Developer Forums](https://developer.apple.com/forums/thread/797379),
  [Swift Forums](https://forums.swift.org/t/xcode-26-avaudiosession-categoryoptions-allowbluetooth-deprecated/80956).
- **iOS 26 can have the Bluetooth microphone without losing quality.**
  `AVAudioSessionTypes.h:580-602` describes
  `AVAudioSessionCategoryOptionBluetoothHighQualityRecording`
  (`API_AVAILABLE(ios(26.0))`): *"the session will enable full-bandwidth audio
  in both input & output directions, if the Bluetooth route supports it (e.g.
  certain AirPods models). It is currently compatible only with mode
  `AVAudioSessionModeDefault`… This option may be combined with
  `AVAudioSessionCategoryOptionAllowBluetoothHFP`, in which case HFP will be
  used as a fallback if the route does not support this
  `AVAudioSessionCategoryOptionBluetoothHighQualityRecording` option."* The
  header also warns it *"may increase input latency… not recommended for
  real-time communication usage"*, which does not apply to dictation and
  memo capture. Introduced in
  [WWDC25 — Enhance your app's audio recording capabilities](https://developer.apple.com/videos/play/wwdc2025/251/);
  hardware support is AirPods 4, AirPods 4 with ANC, and AirPods Pro 2
  ([Apple newsroom coverage](https://techcrunch.com/2025/06/09/apple-airpods-get-new-features-including-studio-quality-audio-and-a-camera-remote)).
  This is the reason the "allow Bluetooth input" decision is not simply a
  quality regression on current hardware.
- **`.duckOthers` is invalid with the categories and modes both sites use.**
  `AVAudioSessionTypes.h:463-466`: *"DuckOthers is only valid with
  `AVAudioSessionCategoryAmbient`, `AVAudioSessionCategoryPlayAndRecord`,
  `AVAudioSessionCategoryPlayback`, and `AVAudioSessionCategoryMultiRoute`
  **with `AVAudioSessionModeDefault`**."* Today's dictation session pairs it
  with `.measurement`, and today's capture session pairs it with `.record`.
  Neither combination is sanctioned. This was not in the issue.
- **`.duckOthers` requires deactivation to un-duck.**
  `AVAudioSessionTypes.h:456-458`: *"the other audio will be ducked for as long
  as the current session is active. You will need to deactivate your audio
  session when you want to restore full volume playback (un-duck) other
  sessions."* This rules out `.duckOthers` for the idle category — see Open
  design questions.
- **Deactivation does not reset the category.** `AVAudioSession.h:242-262`
  documents `setActive:` entirely in terms of activation state and running
  I/O; `category` is a separate property set only through `setCategory` and is
  read back through `AVAudioSession.sharedInstance().category`. No API resets
  it. The issue assumed the existing `setActive(false)` calls were enough to
  restore playback behaviour. They are not, and that is why the symptom
  outlives the recording.
- **Bluetooth route changes break a running `AVAudioEngine` tap.** Connecting a
  Bluetooth device switches the engine's input format (commonly 44.1 kHz to
  16 kHz) and a tap installed with the old format raises *"required condition
  is false: format.sampleRate == hwFormat.sampleRate"*. Apple's guidance is to
  observe `AVAudioEngineConfigurationChangeNotification` and reconfigure:
  [Apple Developer Forums thread 711583](https://developer.apple.com/forums/thread/711583),
  [Audio crashes when connected to AirPods](https://developer.apple.com/forums/thread/705706).
  This plan makes that route change reachable for the first time, so it is
  Track 3.
- **Searched and found nothing useful:** a search for prior art on "restore
  `.playback` after recording" as a named pattern returned only scattered
  Stack Overflow answers with no agreed shape. There is no established idiom
  to copy; the design below is ordinary state ownership.

## Tracks / scope

Ordered by implementation dependency. Track 1 defines the vocabulary the
other two use.

### Track 1 — one audio-session owner with a pure decision core

**What.** Add `ios-app/CallbackBox/Services/AudioSessionRouting.swift`. It
holds an exhaustive role enum, a pure function from role to session
configuration, and the IO shell that applies a configuration.

**Why this needs to change.** Two call sites hold two different
configurations, each wrong in a different way, and neither is reachable from
a test. `AVAudioSession` is process-global shared state with no owner —
engineering principle 8, and principle 10 for the missing seam.

**Direction.**

```swift
enum AudioSessionRole {
    case idle       // nothing is recording: playback is the only client
    case recording  // dictation or capture is running
}

struct AudioSessionConfiguration: Equatable {
    let category: AVAudioSession.Category
    let mode: AVAudioSession.Mode
    let options: AVAudioSession.CategoryOptions
}

enum AudioSessionRouting {
    /// Pure. `highQualityBluetoothAvailable` is the iOS 26 capability check,
    /// passed in so the decision is testable on any simulator.
    static func configuration(
        role: AudioSessionRole,
        highQualityBluetoothAvailable: Bool
    ) -> AudioSessionConfiguration
}
```

The two configurations it returns:

| Role | Category | Mode | Options |
|---|---|---|---|
| `.idle` | `.playback` | `.default` | `[.mixWithOthers]` |
| `.recording` | `.playAndRecord` | `.default` | `[.duckOthers, .defaultToSpeaker, .allowBluetoothA2DP, .allowBluetoothHFP]` plus `.bluetoothHighQualityRecording` when `highQualityBluetoothAvailable` |

Each option, with its reason:

- **`.playAndRecord`, not `.record`, for capture too.** `.record` cannot carry
  `.allowBluetoothA2DP` (`AVAudioSessionTypes.h:527-528`), cannot legally carry
  `.duckOthers` (`:463`), and the high-quality option is specified for *"a
  category that supports both input and output"* (`:583`). One recording
  configuration for both paths satisfies principle 8. The cost is that capture
  holds an output-capable category it does not use; that is inert.
- **`.default`, not `.measurement`.** Removes the documented output-level
  reduction (`:157-159`). Not `.voiceChat` or `.videoChat`: both have *"the side
  effect of setting `AVAudioSessionCategoryOptionAllowBluetoothHFP`"*
  (`:141`, `:170`) and both state that without the VoiceProcessing IO unit
  *"Dynamic processing on input and output will be disabled resulting in a
  lower output playback level"* — the same quiet-output defect under a
  different name. Not `.spokenAudio`: that is a playback mode about
  interruption policy (`:176-179`), not a record mode. `.default` is also the only
  mode compatible with `.bluetoothHighQualityRecording` (`:583`) and the only
  mode that makes `.duckOthers` legal (`:463`).
- **`.defaultToSpeaker` kept.** It applies only *"when no other audio route is
  connected"* (`:493-494`). Dropping it would send dictation earcons to the
  earpiece on a bare phone. It does not fight Bluetooth.
- **`.allowBluetoothA2DP` added.** Restores the high-quality output route that
  the record category otherwise removes. This is the fix for the reported
  Bluetooth drop when the accessory is an output-only speaker.
- **`.allowBluetoothHFP` added** — the boxholder's decision to allow the
  Bluetooth microphone. Spelled `allowBluetoothHFP`, not `allowBluetooth`,
  because the latter is deprecated in this SDK and would add a build warning;
  the constants are identical (`:468-487`).
- **`.bluetoothHighQualityRecording` when available (iOS 26+).** Behind
  `if #available(iOS 26.0, *)`, per `ios-app/CLAUDE.md:36`. On supporting
  AirPods it keeps full-bandwidth audio in both directions; elsewhere the
  header specifies HFP fallback (`:594`), which is the pre-iOS-26
  behaviour. There is no downside branch to write.
- **`.playback` for idle.** A2DP is implicitly available for output-only
  categories (`:530-531`), and no dynamics processing is disabled, so playback
  is full-volume on Bluetooth. `.playback` ignores the ring/silent switch —
  accepted deliberately; see Open design questions.
- **`.mixWithOthers` for idle, not `.duckOthers`.** Ducking obliges the app to
  deactivate to un-duck (`:456-458`), and nothing deactivates the idle
  session: `AVAudioPlayer` and `WKWebView` activate it implicitly and never
  deactivate. `.duckOthers` there would leave other apps ducked indefinitely.

**Vocabulary lock-ins.** `AudioSessionRole` with cases `.idle` and
`.recording`; `AudioSessionConfiguration`; the controller protocol name
`AudioSessionControlling` with `activate(role:) throws` and `deactivate()`.
`CaptureAudioSessionControlling` is deleted in favour of it — one protocol,
not two.

**First implementation chunk.** The new file plus
`ios-app/CallbackBoxTests/AudioSessionRoutingTests.swift`, plus the four
`project.pbxproj` entries each new file needs (`ios-app/CLAUDE.md:120-133`).
No call site changes yet. No open questions inside this chunk.

### Track 2 — install the idle configuration, and restore it on every stop

**What.** Apply `.idle` at launch and after every recording stops. Route both
record paths through the Track 1 controller.

**Why this needs to change.** This is the actual reported bug. Deactivation
leaves the category in place, so today the first dictation of a session
permanently installs `.playAndRecord` + `.measurement` on the process. Every
later earcon, voice-memo playback, and web `<audio>` element plays through a
record category with dynamics processing disabled and A2DP unavailable. Before
the first dictation the app runs on the implicit `.soloAmbient` default,
which no code chose.

**Direction.**

- `CallbackBoxAppDelegate` applies the `.idle` configuration once at launch,
  without activating. The app then always has a category it chose.
- `SpeechDictation.start` calls `controller.activate(role: .recording)` in
  place of `SpeechDictation.swift:287-292`.
- `SystemCaptureAudioSession.activate()` calls the same thing, so both record
  paths install one configuration.
- Every stop path performs, in this order:
  1. Stop the I/O first. `AVAudioSession.h:253-255` requires it: *"When
     deactivating a session, the caller is required to first stop or pause all
     running I/Os"*. `SpeechDictation.endRecording` already stops the engine at
     `:181-184` before `:209`; `CaptureAudioRecorder.stop` already calls
     `recorder?.stop()` before `audioSession.deactivate()` at
     `CaptureAcquisition.swift:783-785`. Both orderings are preserved.
  2. `setActive(false, options: .notifyOthersOnDeactivation)` while the
     recording category is still installed, so other apps un-duck.
  3. Apply the `.idle` configuration without activating it. The next
     `AVAudioPlayer` or `WKWebView` playback activates it implicitly, on the
     right category.
- The failure of any of these is logged, not swallowed. Today both stop paths
  use `try?` and discard the error (`SpeechDictation.swift:209`,
  `CaptureAcquisition.swift:637`). Silent discard is what let this bug persist
  — engineering principle 4.

**Vocabulary lock-ins.** None beyond Track 1.

**First implementation chunk.** Route `SystemCaptureAudioSession` through the
controller and add the idle restore, with the capture tests updated. Capture
is done first because it already has the injectable seam, so the change is
observable in a test before it is made in the harder path. Note that
`CaptureAudioRecorder`'s lifecycle had no test at all before this plan — only
the pure `shouldSoftStop` helper (`CaptureAcquisitionTests.swift:83`) — so the
fakes for its four injection points are written here, not reused.

### Track 3 — do not let a mid-recording route change fail silently

**What.** Observe `AVAudioEngineConfigurationChangeNotification` in
`SpeechDictation` and end the recording with a visible message when the engine
reconfigures mid-capture.

**Why this needs to change.** Allowing the Bluetooth microphone makes this
reachable. Today the input route is always the built-in microphone, so
connecting AirPods mid-dictation does not change the input format. After
Track 1 it does: the engine switches to the HFP input and the tap installed at
`SpeechDictation.swift:347` with the format captured at `:295` no longer
matches the hardware. The documented outcome is a hard exception (see Prior
art). `SpeechDictation` observes `AVAudioSession.interruptionNotification` at
`:123` but nothing else.

**Direction.** On the notification, while `state == .recording`, call
`endRecording(cancelTranscription: false)` — keeping the transcript captured
so far — and set `errorMessage` to a short line naming the cause ("Audio
device changed. Dictation stopped."). Restarting into the new route is the
user's choice, not automatic.

Reconfiguring the engine live (re-installing the tap at the new format and
re-seeding the analyzer session) is explicitly **not** attempted here — see
NOT in scope.

**Vocabulary lock-ins.** None.

**First implementation chunk.** The observer plus the stop-and-report path.
The reducer already has a `.fail(message:)` event (`:242`), so no state-machine
change is needed.

## Subplans

None. Each track is a single decision resolved in this document; none carries
its own research or vocabulary question. The one genuinely deferred design —
live engine reconfiguration on a route change — is deferred out of scope
rather than into a subplan, because nothing in this plan depends on it.

## Failure modes

No critical gaps. Every row below has either a test or a visible failure.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `setCategory` rejects the recording option set on some device (e.g. a future SDK tightens `.duckOthers` validity) | Yes — `AudioSessionRoutingTests` asserts the exact option set for both roles, so a change is caught in review, not on a phone | Yes — `activate(role:)` is `throws`; `SpeechDictation.start` already routes a thrown error to `VoiceCompositionReducer.reduce(&state, .fail(message:))` at `:367-368`, and capture's `start()` catch at `CaptureAcquisition.swift:757-768` surfaces `notice` | Clear — the user sees the message; dictation does not start |
| `.bluetoothHighQualityRecording` is rejected at runtime on an iOS 26 device whose route does not support it | Partial — the pure function is tested for both branches; the runtime rejection is not reproducible in a simulator | Documented by Apple as fallback, not error (`AVAudioSessionTypes.h:588-591`); if it does throw, the `throws` path above catches it | Clear — same error path |
| `setActive(false)` returns `IsBusy` because an earcon `AVAudioPlayer` is still playing when dictation stops (`AVAudioSession.h:256-258`; `NativeEarcons.swift:138` keeps players alive) | No — timing-dependent, not reproducible headlessly | Partial — the session deactivates anyway per the header; the idle category is applied in step 3 regardless of step 2's result | Clear once logged — this plan replaces `try?` with a logged failure, so the case becomes visible instead of invisible |
| Idle category applied but a stale recording route is still current | No | The route follows the category change; iOS re-evaluates on the next activation | Silent by design — this is the normal path, and the manual device check is what confirms it |
| Bluetooth device disconnects mid-dictation (user walks out of range) | No — needs hardware | Track 3: the engine configuration change stops the recording and reports it | Clear — message shown, partial transcript kept |
| Bluetooth device connects mid-dictation | No — needs hardware | Track 3, same path | Clear |
| Recording starts while a phone call holds the microphone | No | Existing: `setActive(true)` fails with `InsufficientPriority` (`AVAudioSession.h:249-251`) into the same throw path | Clear |
| App is backgrounded during capture | No — the observer at `CaptureAcquisition.swift:696-702` has no test; `CaptureAudioSessionTests` covers the equivalent `stop(reason: .interruption)` path, not the notification itself | Existing; unchanged by this plan | Clear |
| `.playback` idle category plays an earcon while the phone's silent switch is on | No | None — this is the deliberate behaviour change | Clear — deliberate; speech output is not a ringer, decided 2026-07-31 |

## Agent-flow / user-flow edge cases

The template's seven scenarios describe cards, tags, refs, and box agents.
This plan changes native Swift audio configuration and adds no card, schema,
tag, or agent-facing surface, so six of the seven have no analogue. Stating
them rather than omitting them:

- **Wrong tag / wrong field** — no tag or field surface. Not applicable.
- **Stale ref** — no refs. Not applicable.
- **Two agents touching the same card** — no cards. Not applicable.
- **Hand-edit drift** — nothing here is hand-edited by the boxholder. Not
  applicable.
- **Fabricated free-form value** — no free-form values. Not applicable.
- **Validation error UX** — no validation surface in the box sense.
  **ADDRESSED** in the adjacent sense: `setCategory` failures now reach the
  user as composer/capture error text rather than being discarded.
- **Partial migration / transition state** — no data shape changes. **ADDRESSED**
  in the adjacent sense: the transition state that matters is a build of the
  app that has Track 1 and Track 2 but not Track 3, which is exactly the
  window where a mid-dictation route change can raise the format exception.
  The tracks land in one plan, in order, and the plan ships as one unit.

The real edge cases for this plan are device-flow, and they are the Failure
modes table above.

## NOT in scope

- **Live engine reconfiguration on a route change.** Re-installing the tap at
  the new hardware format, re-creating the `AVAudioFile` (whose settings come
  from the old format at `SpeechDictation.swift:344`), and re-seeding the
  analyzer session mid-utterance is a separate design. Track 3 stops cleanly
  instead. Deferred because a clean stop is honest and small, and the
  alternative is a substantial rewrite of the dictation startup path.
- **A user-facing input-device picker.** iOS 26 ships an input picker
  (WWDC25 session 251). Choosing the microphone is a product decision the
  boxholder has not asked for.
- **Background audio.** The app declares no `UIBackgroundModes` audio
  entitlement, and `.playback` does not grant one. Recording and playback
  still stop on suspend. Unchanged, deliberately.
- **`.spokenAudio` / `interruptSpokenAudioAndMixWithOthers` for the idle
  category.** Would make podcast apps pause rather than mix when our audio
  plays. Correct only once we know how the boxholder wants voice-memo playback
  to interact with other audio — see Open design questions.
- **The web-side audio path.** `callback-box/src/frontend/src/lib/audio/context.ts`
  is untouched; it becomes correct as a consequence of the native category
  being correct.
- **`AVAudioSession.setPrefersNoInterruptionsFromSystemAlerts`**, which the
  header recommends alongside high-quality recording
  (`AVAudioSessionTypes.h:600-601`). It suppresses call ringtones during
  recording — a behaviour change with its own consequences, and not part of
  the reported bug.

## Open design questions

None remain. The three questions this plan opened were resolved by the
boxholder on 2026-07-31; the decisions and their reasons are recorded here
because the reasoning is not visible in the code.

- **Resolved — the idle category is `.playback`, which ignores the
  ring/silent switch.** The switch silences ringers and alerts. This app's
  output is speech and voice memos, which the user asked for; it is not a
  ringer. `.ambient` would respect the switch but would also silence a
  deliberate playback on a muted phone, which is the wrong failure.
- **Resolved — the idle category mixes rather than ducks.** *Ducking* means
  temporarily lowering another app's audio (music, a podcast) while ours
  plays, then restoring it. iOS restores the other app's volume only when our
  session deactivates (`AVAudioSessionTypes.h:456-458`), and nothing
  deactivates the idle session: `AVAudioPlayer` and `WKWebView` activate it
  implicitly and never release it. Ducking there would leave other apps quiet
  indefinitely. `.mixWithOthers` has no such obligation. Ducking is still
  correct for the `.recording` role, where both paths do deactivate on stop.
  The consequence to watch on the device: a voice memo plays over the user's
  music instead of pausing it.
- **Resolved — capture uses the same recording configuration as dictation,
  Bluetooth microphone included.** The boxholder's instruction is to support
  connected devices as well as possible and to weigh capture audio fidelity
  less. So capture accepts the HFP microphone even though it produces 44.1 kHz
  AAC (`CaptureAcquisition.swift:664-670`) that an HFP route cannot fill on
  pre-iOS-26 hardware, and picks up `.bluetoothHighQualityRecording` on
  iOS 26 hardware that supports it. One configuration, per engineering
  principle 8.

## Knowledge audits

**Skip, with rationale.** `callback-box/src/dev/knowledge-audits.yaml` verifies
that a box agent can recall agent-facing conventions. This plan adds no
convention an agent must recall: it changes native Swift configuration inside
the iOS app, introduces no card type, tag, or instruction, and no box agent
reads or writes any of it. The audience for `AudioSessionRouting` is whoever
next edits the Swift code, and the plan document plus header citations in the
source comments serve that reader.

## Implementation order

1. **Track 1 core.** `AudioSessionRouting.swift` + `AudioSessionRoutingTests.swift`
   + `project.pbxproj` entries. Commit. Verified by `xcodebuild test`.
2. **Track 2, capture path.** `SystemCaptureAudioSession` adopts the
   controller; `deactivate()` restores idle; capture tests assert the restore
   through the existing protocol seam. Depends on 1. Commit.
3. **Track 2, dictation path.** `SpeechDictation` adopts the controller;
   `endRecording` restores idle and logs failures instead of discarding them.
   Depends on 1. Commit.
4. **Track 2, launch.** `CallbackBoxAppDelegate` installs the idle
   configuration at launch. Depends on 1. Commit.
5. **Track 3.** Engine configuration-change observer in `SpeechDictation`.
   Depends on 3, because it uses the stop path that step 3 rewrites. Commit.
6. **Cross-model review** with the `codex` skill over the full branch diff,
   per the monorepo CLAUDE.md rule. Findings surfaced to the boxholder, not
   quietly applied.
7. **Manual device check** by the boxholder (below). The issue keeps
   `needs: [manual-testing]` until then.

## Rollout shape

**Test posture.** The testable part of this change is the decision, not the
routing — `AVAudioSession` cannot be exercised headlessly, and the simulator
has no Bluetooth. The decomposition in Track 1 exists to make the decision
testable, which is engineering principle 10 doing its job rather than a
coverage exercise.

Done-when, as assertions:

- `AudioSessionRoutingTests` asserts `configuration(role: .recording,
  highQualityBluetoothAvailable: false).options` equals exactly
  `[.duckOthers, .defaultToSpeaker, .allowBluetoothA2DP, .allowBluetoothHFP]`,
  and that the `true` case adds `.bluetoothHighQualityRecording` and nothing
  else.
- It asserts `.recording` uses `mode == .default` — the regression anchor for
  the low-volume bug, which was a mode choice.
- It asserts `.idle` is `.playback` / `.default` / `[.mixWithOthers]`.
- A capture test asserts that a fake `AudioSessionControlling` receives
  `activate(role: .recording)` on start and `deactivate()` on every stop path,
  including the size-limit, interruption, and background stops that
  `CaptureAcquisitionTests` already exercises.
- The full iOS suite passes: `xcodebuild -quiet -project
  ios-app/CallbackBox.xcodeproj -scheme CallbackBox -configuration Debug
  -destination 'platform=iOS Simulator,id=<UDID>' test`.
- The signing-free simulator build is clean **and warning-free** — the
  `allowBluetoothHFP` spelling exists so this change adds no deprecation
  warning.

There are no new TypeScript codepaths, so no doctest applies. Nothing in
`callback-box/` changes, so the pre-commit checks there are unaffected.

**Knowledge-audit entries.** None, per the section above.

**Migration.** None. No persisted data changes shape. The recorded WAV from
dictation follows the hardware format, which can now be 16 kHz mono on an HFP
route where it was previously the built-in microphone's rate — a quality
change in new recordings, not a format incompatibility, and
`AVAudioFile(forWriting:settings:)` at `SpeechDictation.swift:344` already
takes the format from the live hardware.

**Manual device check** (the boxholder clears this; it is what
`needs: [manual-testing]` on the issue means). On an iPhone with Bluetooth
headphones or a speaker paired:

1. Play a voice memo or trigger an earcon with nothing recording. Confirm it
   plays on the Bluetooth device at normal volume.
2. Start dictation. Confirm the microphone works, output does not jump to the
   phone speaker, and nothing goes quiet. On AirPods with iOS 26, confirm
   audio does not audibly drop to call quality.
3. Stop dictation. Play audio again. Confirm it is on Bluetooth at full
   volume.
4. Repeat 1-3 with a native audio capture instead of dictation.
5. With no accessory connected, start dictation and confirm earcons come from
   the speaker, not the earpiece — this is what `.defaultToSpeaker` protects.
6. With the ring/silent switch on, confirm speech output and voice memos
   still play — that is the intended behaviour of the `.playback` idle
   category, not a defect.
7. While music or a podcast is playing from another app, play a voice memo.
   Confirm both are audible: the idle category mixes rather than ducking.
