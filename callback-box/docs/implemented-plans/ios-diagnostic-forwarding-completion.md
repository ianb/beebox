# iOS diagnostic forwarding completion

**Status:** implemented 2026-08 — boxholder approved box-hosted logging instead of on-device export

This plan completes iOS runtime observability through the existing box-owned
`client-debug.log`. It adds useful state transitions and media failure details
without adding an export journal, share sheet, or second retention system.

**Issues addressed.**

- `issues/bugs/2026-07-27-ios-native-runtime-errors-not-observable.md`

No related or duplicate issue was found.

## Stated preferences this plan trades against

- Engineering principle 4, resilient and never silent. Runtime degradation must
  leave enough context in the existing debug log to diagnose it.
- Engineering principle 8, one way to do each thing. The shipped `BoxLog` and
  `LogForwarder` remain the only native logging pipeline.
- Engineering principle 10, testability is architectural. Queue classification
  and browser media diagnostics get focused behavioral tests.
- The boxholder explicitly prefers regular upload to the box over a complicated
  user-facing share process. The box and its logs are one privacy space, so this
  plan does not add export-specific URL/content scrubbing.
- The shipped metadata-only discipline and device-token backstop remain intact.
  They are existing logging safety properties, not new export privacy machinery.

## What already exists

- `ios-app/CallbackBox/Services/BoxLog.swift` logs every native entry through
  unified logging and forwards error/warn through `LogForwarder`.
- `ios-app/CallbackBox/Services/LogForwarder.swift` provides the persisted
  offline queue, two-second foreground debounce, launch/foreground flush,
  authenticated `debugLog.submit` request, queue caps, and token redaction.
- `callback-box/src/webapp/trpc/routers/debugLog.ts` writes the box-owned rolling
  `.callback-box/client-debug.log` and accepts `info` as a wire level already.
- `callback-box/src/frontend/src/components/DebugLog.tsx` regularly forwards
  browser error/warn entries to the same box log.
- `callback-box/src/frontend/src/lib/audio/context.ts` logs every explicit
  `play()` rejection and three media-element `onerror` paths. The current
  `onerror` logs include an opaque `Event`, not `MediaError.code`,
  `networkState`, or `readyState`.
- `RootView`, `ChatWebView`, and `AudioSessionRouting` already own the app,
  navigation, playback, response, and audio-session state boundaries.

## Prior art (external)

No new library or OS facility is introduced. The shipped forwarding plan's
research on bounded iOS background execution still applies: persistence is the
offline guarantee and foreground flush is opportunistic. No additional external
research is needed for this internal extension.

## Tracks / scope

### Track 1 — Forward selected native info transitions

**What.** Extend the existing native queue to carry `info` and make
`BoxLog.info` enqueue it.

**Why this needs to change.** Failures are present, but the preceding app state
is not. Unified logging alone is not available to the box after the fact.

**Direction.** Add `info` to `BoxLogLevel`. Forward it through the existing
queue, persistence, debounce, transport, and wire renderer. Preserve room for
failures: per-box and global eviction removes the oldest info entry before an
error/warn entry. Existing queue-overflow markers remain warning-level and
report total dropped entries. Do not change the server wire shape; it already
accepts `info`.

Add transition logs only for:

- app scene phase (`active`, `inactive`, `background`);
- selected box changes (box UUID when a destination exists; never URL/token);
- main-frame web-view navigation start and finish;
- speech playback and response-active state;
- audio-session role application (`idle` or `recording`).

Log only actual changes at state callback sites. Audio-session role lines record
successful configuration operations because the system session controller does
not own durable role state. Do not log transcript, composer, session-title,
URL, request-body, or media content.

**Vocabulary lock-ins.** `BoxLogLevel.info`; `BoxLogCategory.lifecycle` and
`BoxLogCategory.audio`.

**First implementation chunk.** Add queue tests proving info flushes, failure
entries survive an info storm, and wire levels remain correct. Then add the enum
cases and transition call sites.

### Track 2 — Make browser playback failures diagnostic

**What.** Improve the existing console error/warn messages at media failure
sites so the already-shipped browser forwarder sends useful metadata.

**Why this needs to change.** `console.error(..., event)` serializes as `{}` in
the forwarding patch. Automatic speech playback can therefore skip with no
useful reason in the box log.

**Direction.** At the URL, blob, and streaming `audio.onerror` handlers, log a
fixed metadata string containing operation, `audio.error?.code`,
`audio.networkState`, and `audio.readyState`. Keep the existing promise
resolution/rejection behavior unchanged. At `play().catch` and streaming setup
or pump exceptions, log operation and a stable error name/message string. Do
not add a new WKScriptMessage channel: the browser console forwarder already
uploads these messages.

**Vocabulary lock-ins.** Operations `url`, `blob`, `stream`, and `unlock` in
`[audio]` diagnostic messages.

**First implementation chunk.** Add a focused frontend doctest for the pure
media diagnostic formatter, including absent `MediaError`, then use it at all
explicit failure sites.

### Track 3 — Documentation and issue closure

**What.** Update the implemented forwarding plan, client-debug-log reference,
and issue to describe info transitions and the decision not to build export.

**Why this needs to change.** The current issue says the remaining work is an
on-device bundle. That is no longer the boxholder's desired design.

**Direction.** Document the box-owned log as the user-accessible diagnostic
record. State the regular flush triggers and rolling retention. Record that
share/export was considered and declined because it duplicates the existing
privacy and delivery surface.

**Vocabulary lock-ins.** None.

**First implementation chunk.** Update documentation after behavior and tests
are complete, then move the issue to `issues/closed/bugs/` during finish.

## Could this be simpler?

The simpler version is the plan: reuse the existing forwarder and browser
console forwarding. A separate on-device journal and share sheet would duplicate
storage, retention, redaction, rendering, and delivery. It would not improve the
boxholder's preferred workflow because the destination is the box either way.

The only new queue complexity is priority eviction. Without it, routine info
transitions can remove the failure they are meant to contextualize. That small
policy is required by resilient-not-silent.

## Subplans

None.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Info storm fills offline queue | planned queue test | evict oldest info before failures; warning marker | clear in box log |
| Offline/box unavailable | existing `LogForwarderTests` | persist and retry on launch/foreground/enqueue | silent to UI, clear later |
| Media element has no `MediaError` | planned formatter test | log code `none` plus network/ready state | clear |
| Repeated state callback emits noise | planned transition-focused assertions where practical | compare old/new or rely on SwiftUI `onChange` | clear by test/code |
| Server rejects info | existing server enum/doctest plus new wire assertion | retain queue on transient response | clear in unified logging |
| Info evicts error/warn | planned stress-shaped queue test | priority eviction | prohibited by test |

No unresolved critical gap remains. A process killed before a fire-and-forget
entry reaches the actor retains the forwarding plan's documented residual risk.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field — ADDRESSED.** No agent-authored data format changes.
- **Stale ref — ADDRESSED.** No card refs are involved.
- **Two agents touching the same card — ADDRESSED.** No box card is written.
- **Hand-edit drift — ADDRESSED.** Queue manifest decoding remains versioned.
- **Fabricated free-form value — ADDRESSED.** Transition/media messages are
  fixed-format metadata produced by code.
- **Validation error UX — ADDRESSED.** The server already validates the closed
  level enum and caps.
- **Partial migration / transition state — ADDRESSED.** The server already
  accepts info; older iOS builds simply send fewer lines.

## NOT in scope

- On-device diagnostic journal, text bundle, share sheet, copy action, or export
  UI. The boxholder prefers regular upload to the existing box log.
- New redaction or privacy boundaries. The box log is in the same privacy space
  as the box. Existing device-token redaction and metadata discipline remain.
- Unrestricted console capture or new console patching. The existing browser
  forwarder remains the source.
- Changing playback recovery behavior. This work makes failures observable; it
  does not fix a specific playback cause.
- New server endpoint, retention system, or log viewer.
- Broad instrumentation of every native catch or state mutation.

## Open design questions

None. The boxholder chose regular box upload over on-device export and sharing.

## Knowledge audits

None. This introduces no box-agent concept or convention.

## Implementation order

1. Add focused queue and media formatter tests.
2. Extend native forwarding to info with priority eviction.
3. Add the selected native transition logs.
4. Improve media failure metadata at existing browser log sites.
5. Update docs and reconcile the issue.
6. Run cross-model diff review and final verification. The boxholder then
   approved the merge through the finish workflow.

## Rollout shape

- Run focused `LogForwarderTests` and the media diagnostic doctest.
- Run the complete iOS XCTest suite and signing-free simulator build.
- Run callback-box frontend typecheck, lint, focused doctest, and broad tests.
- Exercise foreground/background and speech playback in the simulator, then
  inspect the worktree box's `.callback-box/client-debug.log` for timestamped
  `[ios]` info/error lines and useful media metadata.
- Physical-device verification remains separate for background behavior and a
  real WebKit playback failure.
- No on-disk migration. Existing queue manifests decode after adding the enum
  case; old queued entries are unchanged.
