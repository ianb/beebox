# iOS input-plane parity

This plan brings the native iOS composer to semantic parity with the web input
plane while preserving native keyboard, camera, picker, and speech behavior. It
extends the native draft and bridge to carry the complete web `Emission`, makes
unsent and rejected work durable, and keeps the embedded web chat authoritative
for target state and final dispatch.

**Status:** active — Tracks 1-4 are implemented: canonical
V2 encoding/decoding and shared fixtures; a box-scoped `ComposerDraftStore`;
atomic, quarantining manifests; one-shot text migration; reducer/token/Unicode-
caret coverage; a caret-aware, autosizing `UITextView`; and file-backed camera
and Photos images with stable IDs and no arbitrary count cap. Track 3 also has
Files import with the existing authenticated upload route, byte progress,
durable upload failure/retry state, Paste Image, and visible-webview Screenshot
acquisition. Image source bytes are persisted before processing, interrupted or
failed processing restores as a retryable chip, and incomplete attachments
block send. Track 4 adds strict durable companion-selection commands,
idempotent acknowledgements, typed tokens, active-dictation anchors, native
detail chips, and complete V2 selection emission. Track 5's pending-send half
is implemented: sends persist
before delivery, immediately clear to a fresh editable draft, replay with the
same ID after relaunch/navigation, accept receipts in any order, and expose
rejected Retry / Restore / Discard actions without overwriting newer work.
Track 5 is complete: voice uses an explicit composition state machine, keyword
sends persist their draft and copied audio before clearing, HQ work resumes
after relaunch, later drafts remain isolated, and later emissions wait behind
earlier voice preparation. Track 6 remains; its visual coverage and real-device
acceptance matrix are required before this plan ships. Track 6's fixture host
and first simulator sweep are implemented. All thirteen deterministic states
were captured on iPhone 17 Pro; attachment overflow was also checked on iPhone
17e in dark mode at Accessibility Large, rejection UI on iPad (A16) at XXXL,
and the focused editor with the software keyboard. This sweep fixed context
overflow and long-transcript horizontal expansion. A final lifecycle pass also
made draft activation generation-safe, disables composition until restoration
finishes, and accepts startup selection commands only after the target box is
ready. Landscape and the real-device matrix remain.

## Stated preferences this plan trades against

- `docs/engineering-principles.md`: **#1 types are structure** (draft items,
  upload phases, bridge commands, and pending sends are closed types), **#2
  strict producers and tolerant consumers** (Swift emits one canonical payload;
  the web decoder preserves documented compatibility), **#3 validate at
  boundaries** (bridge JSON, file-upload responses, persisted manifests), **#4
  resilient and never silent** (a failed attachment, restore, or receipt is
  visible and recoverable), **#5 failure paths in signatures** (upload and
  delivery state are values, not captions inferred from booleans), **#8 one way
  to do each thing** (all native sends become ordinary web `Emission`
  dispatches), **#9 explicit structure for essential complexity** (one draft
  store and one pending-send state machine), **#10 testability is
  architectural** (filesystem, upload, text selection, and bridge transports
  have test seams), and **#12 the maintainer is usually an agent** (shared
  fixtures enforce the Swift/TypeScript contract).
- `AGENTS.md`: keep the change scoped to the native input plane and its bridge;
  do not duplicate the web chat client, target controls, or capture pipeline.
  Work runs in a worktree and is not merged until the boxholder asks.
- `code-style.md`: TypeScript uses validated `unknown` boundaries, exhaustive
  unions, explicit exported return types, and visible errors. Swift follows the
  same intent with `Codable` wire values, exhaustive enums, and actor-isolated
  mutable state.
- `docs/testing.md`: pure draft and protocol behavior gets doctests/XCTest;
  integrated webview delivery gets simulator coverage; keyboard, camera,
  Photos, Files, backgrounding, and dictation finish with a real-device pass.
- Shipped precedent: `docs/implemented-plans/input-extraction.md` establishes
  **Emission / Input / Target**. The native composer is another Input that
  produces the same value; it is not a separate Target or transport.
- Active precedent: `docs/plans/ios-native-capture-mode.md` keeps capture media
  durable and delegates preparation/delivery to the existing server pipeline.
  Ordinary composer attachments need similar local durability, but remain
  ordinary chat emissions rather than capture sessions.

## What already exists

### Architectural baseline

- **Canonical web value — extend, do not fork.** `Emission` already includes
  `id`, `origin`, `text`, images, uploaded file references, selections, and
  diarization (`src/frontend/src/input/emission.ts:22-46`). Its fields are
  deliberately framework-free and serializable (`emission.ts:1-15`). The iOS
  wire type should mirror this semantic value.
- **Canonical mutable draft — port its invariants.** `EmissionDraft` holds text,
  images, pending-image work, files, and selections
  (`src/frontend/src/input/emission-store.ts:33-69`). Its editor owns monotonic
  IDs, token removal, and reset behavior (`emission-store.ts:79-117,129-190`).
  Swift needs an equivalent model, not another collection of view-local
  `@State` properties.
- **Target and assembly — reuse unchanged.** The web bridge converts native
  input to an `Emission`, then the normal chat target assembles and dispatches
  it. The existing bridge doctest states this ownership explicitly
  (`test/frontend/native-emission-bridge.doctest.md:1-26`).
- **Cross-platform contract fixtures — extend.** One golden fixture corpus is
  already loaded by TypeScript and XCTest
  (`test/mobile-contract/fixtures.doctest.md:1-23`). Full-emission fixtures,
  bridge commands, and out-of-order receipt cases belong there.

### Detailed comparison

Parity means equivalent composition capability, durability, and send outcome.
It does **not** mean rendering the React toolbar in Swift or making web users
interact like iOS users.

| Dimension | Web input plane today | iOS input plane today | Parity decision |
|---|---|---|---|
| Draft owner | One box-scoped `EmissionStore`, lifted above session remounts | View-local `text`, `images`, and one `lastSentEmission` (`../../../ios-app/CallbackBox/Views/NativeComposerView.swift:14-25`) | Add one box-scoped native `ComposerDraftStore`; Swift is authoritative only while the native composer is active. |
| Text editing | Autosizing textarea; desktop Enter sends and Shift+Enter inserts a newline; mobile Enter remains a newline (`src/frontend/src/components/chat/InteractiveChat-composer.tsx:35-72`; `InteractiveChat-mobile-row.tsx:45-60`) | Native multiline `TextField`, 1-5 lines (`NativeComposerView.swift:132-142`) | Keep the native keyboard and newline behavior. Wrap `UITextView` for stable caret access and dynamic height; keep the visible send button. |
| Idle controls | Mobile has add/capture, keyboard, and mic controls (`InteractiveChat-composer.tsx:193-283`) | `+`, always-visible text field, mic/send (`NativeComposerView.swift:42-57,144-187`) | Preserve the current native dock design. Visual identity is an intentional divergence; command availability is not. |
| Images | Paste/drop/file input, asynchronous processing, thumbnails, remove, and `[imageN]` tokens (`InteractiveChat-attachments.ts:1-17`; `ChatAttachments.tsx:1-12`) | Camera/gallery, thumbnails, remove; four-image cap; base64 held in memory; no tokens (`NativeComposerView.swift:36-40,361-389`; `ComposerActionsView.swift:32-49`) | Keep camera/gallery, add paste and screenshot actions, file-back image data, show processing/failure, and insert stable caret-aware tokens. Remove the arbitrary four-image cap; enforce documented byte/count limits instead. |
| Files | Arbitrary files upload to `tmp/`, become chips, and insert `[fileN]` tokens (`src/frontend/src/lib/file-upload.ts:1-44`; `src/webapp/routes/chat-uploads.ts:44-82`) | No regular-composer file attachment | Add Files picker, authenticated multipart upload to the same route, progress/retry/remove UI, and full file metadata in the draft. |
| Selections | Companion-pane selections become pills plus `[selectionN]`; voice selections use transcript anchors (`InteractiveChat-selections.ts:21-56`; `InteractiveChat-view.tsx:263-307`) | Companion selection mutates the hidden web draft, so it cannot appear in or ship with the native draft | Route selection intents web-to-native in native-shell mode. Native assigns IDs, inserts typed tokens or voice anchors, and displays removable detail chips. |
| Screenshot | Add menu can acquire a screenshot (`InteractiveChat-composer.tsx:193-221`; `ScreenshotMenuItem.tsx:51-105`) | None | Add “Screenshot” using a visible-content `WKWebView` snapshot. This is the native equivalent, not browser display capture. |
| Location | Add menu invokes the existing location bridge | Native add sheet invokes that same bridge (`ComposerActionsView.swift:46-48`) | Already semantically aligned. Retain one-shot status/result behavior. |
| Capture mode | Full-screen capture is a separate input mode | Native full-screen capture is implemented and launched from `+` (`NativeComposerView.swift:103-129,189-199`) | Keep it separate. Capture output does not become a composer attachment. |
| Voice | Live transcript, explicit cancel/edit/send controls, keyword send, selection anchors, and recovered dictation | Native Speech framework/Apple SpeechAnalyzer path, keywords, HQ transcription, stop button; current attachments follow voice sends (`NativeComposerView.swift:150-186,238-332`) | Preserve native recognition and keywords. Add an explicit voice state machine and lossless interruption/recovery; a voice send carries the same current draft fields as typed send. |
| Target state | `TargetStrip` shows ready/busy, queued count, interrupt, and speech stop (`InteractiveChat-view.tsx:313-337`) | The same strip remains visible in the webview because only `composerSection` is suppressed | Do not duplicate it in Swift. Native must stop blocking composition while a prior send awaits a receipt, so the existing target UI remains truthful. |
| Sending | A send snapshots the full draft; further sends may queue while the target is busy | One `lastSentEmission` disables add, mic, and send until receipt (`NativeComposerView.swift:80-93,219-236,334-348`) | Separate editable draft from a collection of pending emissions. Allow continued composition and out-of-order receipts. |
| Rejection | Dispatch failure is represented by a receipt/error while the input architecture retains explicit emission identity | Rejection restores the one message directly into current text/images (`NativeComposerView.swift:80-92`) | Keep rejected snapshots as failed pending items with Retry and Restore. Never overwrite a newer draft. |
| Persistence | Whole box-scoped draft persists across session switches/reloads; dead `tmp/` files are removed with notice (`src/frontend/src/hooks/useEmissionPersistence.ts:50-72,85-110,116-183`) | Only text is stored in `UserDefaults`; media, voice work, and pending sends are volatile (`NativeComposerView.swift:61-65,350-359`) | Persist the complete native draft and unacknowledged sends in Application Support with atomic manifests and file-backed payloads. |
| Bridge contract | Web `Emission` supports files and selections | Native payload carries only text/origin/diarized/images; parser hardcodes files/selections empty (`src/frontend/src/components/chat/native-emission.ts:7-29`; `docs/mobile-contract.md:220-257`) | Extend the versioned bridge to the complete value and make new fields optional for older Android/iOS clients. |
| Box management | Outside the web composer | Included under native `+` by prior product decision (`ComposerActionsView.swift:51-70`) | Keep as an intentional native-shell action; it is not part of emission parity. |

### Existing pieces to reuse

- **Image acquisition/orientation — extend.** The camera and Photos picker paths
  are working (`NativeComposerView.swift:103-129,361-389`). Reuse their encoder
  and orientation normalization, but write normalized bytes to a draft-owned
  file instead of retaining base64 in SwiftUI state.
- **Native capture storage patterns — reuse the pattern, not the store.** Capture
  already has durable manifests and media lifecycles
  (`docs/plans/ios-native-capture-mode.md:81-86,233-240`). Composer files have a
  different acknowledgement and cleanup lifecycle, so they get a small
  `ComposerDraftRepository` rather than entering capture staging.
- **Authenticated chat-file upload — reuse server behavior.** The web helper
  already applies mobile auth and validates the response
  (`src/frontend/src/lib/file-upload.ts:10-44`). Extract/share request-building
  behavior on iOS; do not add another server endpoint.
- **Pending delivery queue — repair and persist.** `RootView` can hold multiple
  emissions and removes them by receipt ID
  (`../../../ios-app/CallbackBox/Views/RootView.swift:3-11,32-66`). Move this
  state below a durable coordinator so navigation, app suspension, and box
  switching cannot erase it (`RootView.swift:77-83`).
- **Web target UI — reuse.** `TargetStrip` is outside the composer suppression
  boundary (`src/frontend/src/components/chat/InteractiveChat-view.tsx:311-337`).
  It remains the one owner of chat busy/queue/interrupt state.

## Prior art (external)

- `UITextView` is the appropriate multiline native editor and exposes the
  current `selectedRange`, giving deterministic insertion of attachment tokens
  at the caret. It also makes keyboard dismissal the app's explicit
  responsibility. <https://developer.apple.com/documentation/uikit/uitextview>
  and <https://developer.apple.com/documentation/uikit/uitextview/selectedrange>
- SwiftUI `PasteButton(payloadType:onPaste:)` reads `Transferable` values and is
  disabled when matching pasteboard content is unavailable. Use it for an
  explicit image-paste action instead of polling the pasteboard.
  <https://developer.apple.com/documentation/swiftui/pastebutton/init(payloadtype:onpaste:)>
- `WKSnapshotConfiguration` plus `WKWebView.takeSnapshot` returns a native image
  for a chosen webview rectangle. This supports a visible-chat screenshot
  without browser display-capture APIs.
  <https://developer.apple.com/documentation/webkit/wksnapshotconfiguration>
- The existing app targets iOS 17 (`../../../ios-app/CallbackBox.xcodeproj/project.pbxproj`),
  so the plan does not depend on newer SwiftUI text-selection APIs. A small
  `UIViewRepresentable` around `UITextView` is the stable compatibility path.
- No third-party editor, upload queue, or bridge library is warranted. UIKit,
  WebKit, PhotosUI, UniformTypeIdentifiers, Foundation, and the existing app
  patterns cover the required boundaries.

## Tracks / scope

### Track 1 — Lock the full emission and bridge protocol

**What.** Make the native wire value a versioned, complete projection of web
`Emission`, and add the web-to-native command needed for companion selections.

**Why this needs to change.** The current parser silently manufactures empty
`files` and `selections` (`src/frontend/src/components/chat/native-emission.ts:7-29`).
No later Swift UI work can create parity while the transport discards those
fields. The current contract also mixes a queue/event transport with an
unversioned payload (`docs/mobile-contract.md:220-257`).

**Direction.** Introduce these `Codable`/validated JSON values:

```ts
interface NativeEmissionV2 {
  version: 2;
  id: string;
  origin: "typed" | "voice";
  text: string;
  diarized: boolean;
  images: Array<{ id: number; mimeType: string; dataBase64: string }>;
  files: Array<{
    id: number;
    path: string;
    originalName: string;
    size: number;
    mimetype: string;
  }>;
  selections: Array<{
    id: number;
    ref: string;
    text: string;
    position: string;
    anchor: string | null;
    spokenWords: number | null;
  }>;
}

type NativeComposerCommand = {
  version: 1;
  id: string;
  kind: "add-selection";
  selection: { ref: string; text: string; position: string };
};
```

`nativeEmissionFromDetail` accepts V2 exactly and continues accepting legacy
payloads under the documented leniency policy. Unknown versions reject with a
receipt that names the unsupported version. The queue remains authoritative and
the event remains a wake signal. Add `callbackboxComposerCommand` as a
web-to-native `WKScriptMessageHandler`; acknowledge each command by ID so the
web side can show a failure rather than silently losing a selection. In
native-shell mode, `handleAddSelection` posts the command instead of mutating the
hidden web `EmissionStore`. Outside native-shell mode it remains unchanged.

Voice emissions gain `files` in `VoiceEmissionInput`; both web and native voice
sends snapshot all current attachment/selection fields. This is a correction to
the canonical helper, which currently hardcodes `files: []`
(`src/frontend/src/input/emission.ts:68-88`).

Update `docs/mobile-contract.md` and golden fixtures in the same commit. TypeScript
doctests and XCTest decode the same V2 full-emission, malformed-item, legacy,
unknown-version, and add-selection command fixtures. New fields remain optional
only on legacy payloads, keeping the future Android client compatible.

**Vocabulary lock-ins.** `NativeEmissionV2`, wire `version: 2`,
`NativeComposerCommand`, `kind: "add-selection"`, and handler
`callbackboxComposerCommand`. The canonical nouns remain `Emission`, `files`,
and `selections`; do not introduce iOS-only synonyms.

**First implementation chunk.** Extend the TypeScript parser and canonical
voice helper, add the V2/command fixtures and doctests, update the contract, and
add matching Swift wire structs plus fixture decoding. Do not change the visible
iOS composer in this chunk.

### Track 2 — Build one durable native draft store

**What.** Replace composer-local content state with a box-scoped draft domain
and file-backed repository.

**Why this needs to change.** Text is currently the only persisted field, while
images are reindexed and held as base64 in memory (`NativeComposerView.swift:350-389`).
The view also conflates editable content, dictation preparation, and the one
pending send. App termination, box switching, or rejection can therefore lose
or overwrite valid user work.

**Direction.** Add an actor-isolated `ComposerDraftStore` with an exhaustive
state model:

```swift
struct ComposerDraft: Codable, Equatable {
    var text: String
    var selection: NSRangeValue
    var images: [DraftImage]
    var files: [DraftFile]
    var selections: [DraftSelection]
    var nextImageID: Int
    var nextFileID: Int
    var nextSelectionID: Int
}

enum DraftTransferState: Equatable {
    case local
    case uploading(progress: Double)
    case uploaded(path: String)
    case failed(message: String)
}
```

Store one draft per paired box, not per chat session, matching the web's lifted
box-level lifetime. Persist a small versioned JSON manifest under Application
Support and keep acquired image/file bytes in sibling files. Use write-temp +
atomic replace. Flush on scene background and after every structural mutation;
debounce text/caret writes. On restore, validate the manifest, local files, and
server `tmp/` references. Missing local/server payloads are removed together
with their token and surfaced in a dismissible notice.

The store owns monotonic IDs and token insertion/removal. IDs are never
renumbered after deletion. A pure reducer handles add/remove/restore and is
covered by XCTest, including Unicode caret offsets. `NativeComposerView` becomes
a rendering/binding layer over this store.

The native and browser drafts are intentionally device-local and independent.
When `nativeComposer=1`, the native store is the only draft owner; the hidden web
store must not be mutated. There is no cross-device or browser-to-phone draft
synchronization.

**Vocabulary lock-ins.** `ComposerDraft`, `ComposerDraftStore`,
`ComposerDraftRepository`, `DraftTransferState`, and box-scoped draft identity.

**First implementation chunk.** Add the pure draft reducer, repository, atomic
manifest format, per-box lifecycle, legacy text-only `UserDefaults` one-shot
migration, and XCTest coverage. Bind only text to the new store, proving restore
and box switching before moving attachments.

### Track 3 — Complete text editing and attachment acquisition

**What.** Give the native dock the full regular-composer acquisition surface:
caret-aware text, photos, camera, image paste, screenshot, arbitrary files, and
location, all represented in the durable draft.

**Why this needs to change.** Native image additions have no textual reference,
files cannot be attached, pending work is invisible, and the four-photo cap is
an implementation artifact. The web gives every item stable identity, visible
state, and a token that controls where the agent sees the reference.

**Direction.** Replace the SwiftUI `TextField` with a narrow
`UIViewRepresentable` `UITextView` that binds text, caret/selection, focus, and
content height. Return inserts a newline. The dock's existing arrow button is
the only keyboard-visible send action; no input accessory send button is added.
Inserting an item replaces the selected range with a spacing-aware token and
places the caret after it. Removing a chip removes its matching token without
renumbering other items.

Expand the `+` sheet's Add section to:

- Take Photo
- Choose Photos
- Paste Image, enabled only when image data is available
- Choose File
- Screenshot
- Share Location

Keep Capture and Pair or Manage Boxes in their existing sections. Images are
normalized for orientation, downscaled/encoded with the same policy as web,
written locally, then represented by thumbnail rows with processing/failure
state and remove/retry controls. File imports copy security-scoped content into
the draft directory before the picker URL expires. The app uploads files using
authenticated multipart `POST /api/chat/upload-file`, validates the existing
response shape, and persists returned metadata. Screenshot uses the visible
`WKWebView` rectangle and enters the normal image pipeline.

Send is disabled only while an attachment required by that draft is still
processing/uploading or when the draft is empty. A failed item does not block
forever: it exposes Retry and Remove. The server's actual request/body limits
become named client validation constants and visible messages; no arbitrary
count cap remains. Base64 conversion happens only when snapshotting an image
into a V2 emission, off the main actor.

**Vocabulary lock-ins.** Existing `[imageN]` and `[fileN]` tokens; menu labels
above; `DraftTransferState` for every asynchronous attachment.

**First implementation chunk.** Land the `UITextView` wrapper and token reducer,
then migrate the existing camera/Photos path to durable `DraftImage` values and
stable IDs. This chunk is independently simulator-testable before files,
paste, and screenshot are added in the next commit.

### Track 4 — Bring companion selections into the native draft

**What.** Complete the web-to-native selection command and render selections in
the native attachment area.

**Why this needs to change.** The companion pane remains web content. Today its
selection callback writes to the hidden web draft
(`src/frontend/src/components/chat/InteractiveChat-view.tsx:263-307`), while
the visible native composer cannot display, remove, persist, or send that
selection. This is a silent split-brain state.

**Direction.** When the native shell receives `add-selection`, validate the
source ref/text/position, mint the next native selection ID, and snapshot voice
context from the native dictation state. During typing, insert
`[selectionN]` at the native caret. During active dictation, store the last eight
recognized words and spoken-word count as `anchor`/`spokenWords`, matching web
behavior (`src/frontend/src/components/chat/InteractiveChat-selections.ts:31-45`).

Render compact selection chips above the dock. Tapping opens source, position,
and full text; remove strips the token (typed) or removes the anchored value
(voice). Post a command acknowledgement only after the durable draft mutation
succeeds. If native rejects the command, the companion pane shows a clear error
and offers Add again.

**Vocabulary lock-ins.** Existing `SelectionItem` fields and `[selectionN]`.
The bridge event is an `add-selection` intent, not a second persisted selection
model in JavaScript.

**First implementation chunk.** Route typed selections through the command,
acknowledge them, render/remove/persist chips, and verify assembly with a golden
fixture. Add voice anchors only after the typed path is green.

### Track 5 — Separate the editable draft from pending sends and voice work

**What.** Make delivery and dictation explicit state machines so one send no
longer freezes the next composition and a rejection never destroys newer work.

**Why this needs to change.** `lastSentEmission` disables the entire composer
until one matching receipt arrives and restores rejected content directly over
the current view state (`NativeComposerView.swift:80-93,334-348`). Meanwhile HQ
transcription is asynchronous and still reads attachment state when it finishes
(`NativeComposerView.swift:263-332`). These assumptions fail as soon as multiple
sends or continued editing are allowed.

**Direction.** On send, atomically snapshot the complete `ComposerDraft` into a
durable `PendingEmission`, clear to a fresh draft, and immediately allow more
composition. `PendingEmissionState` is exhaustive:

```swift
enum PendingEmissionState: Codable, Equatable {
    case awaitingWebView
    case awaitingReceipt(attempt: Int, sentAt: Date)
    case rejected(reason: String)
}
```

The delivery coordinator, not `RootView`, owns the persisted ordered collection.
It retries `awaitingWebView` after load/navigation, deduplicates by emission ID,
handles receipts in any order, and keeps timeout/rejection visible. A failed row
offers Retry, Restore into Empty Draft, and Discard. Restore is disabled when the
current draft is nonempty; the user can instead keep the failed item or discard
the current draft explicitly. Sent/queued receipts remove the local pending
snapshot without a success toast because the web transcript/queue is already
the confirmation.

Voice gets a separate `VoiceCompositionState` covering idle, requesting
permission, recording, preparing HQ transcription, editable result, and failed.
Keyword send snapshots attachment/selection state at keyword detection, before
awaiting HQ transcription; later edits belong to the new draft. Cancel, erase,
mic-off, stop-and-edit, and direct keyword send remain distinct transitions.
Interruption or HQ failure preserves the live transcript and attachment
snapshot. Voice sends use the same V2 emission builder as typed sends.

Do not duplicate `TargetStrip`; it already remains visible and owns target
busy/queued/interrupt state. This track merely lets native input continue while
that target is busy.

**Vocabulary lock-ins.** `PendingEmission`, `PendingEmissionState`,
`VoiceCompositionState`, and receipt actions Retry / Restore / Discard.

**First implementation chunk.** Add the pure pending-emission reducer and
durable coordinator, move the existing bridge queue out of `RootView`, and cover
two sends with reversed receipts, navigation-before-receipt, timeout, and
rejection-with-new-draft. Then refactor voice onto its state machine.

### Track 6 — Integrated UI states, accessibility, and acceptance

**What.** Finish the visual states and verify the complete input plane in
simulator and on a real phone.

**Why this needs to change.** The composer spans keyboard, safe area, webview,
system sheets, media loading, dictation, and network receipts. Unit-correct
pieces can still overlap, disappear, or mislead in the assembled app.

**Direction.** Add a DEBUG composer fixture screen, parallel to the capture
fixture, with deterministic states: empty, typing, multiline, many attachments,
uploading, failed upload, selection detail, recording, HQ preparation, two
pending sends, rejected send, expired attachment, and keyboard shown. Fixture
state uses production views with injected stores/transports.

Run screenshot assertions on compact and current iPhones plus iPad, portrait and
landscape where supported, light/dark mode, and large accessibility text. Verify
that the dock remains flush with the safe area, controls remain at least 44pt,
chips scroll instead of compressing the editor, the keyboard cannot cover the
active line, and no status caption shifts controls unexpectedly. VoiceOver names
each attachment and exposes Remove/Retry actions.

The real-device pass exercises camera, Photos (including an iCloud-backed item),
Files, paste permission behavior, location, screenshot, dictation keywords,
audio interruption, app background/foreground, force-quit restore, offline
upload/retry, webview navigation during send, and two quick sends while the
target is busy. The plan remains active until this pass is recorded.

**Vocabulary lock-ins.** DEBUG argument `--composer-fixture=<state>` and the
acceptance state names above.

**First implementation chunk.** Add the fixture host and baseline screenshots
before final polish so every subsequent UI commit can be compared at the same
viewports.

**Simulator results (2026-07-19).** `--composer-fixture=<state>` and
`ios-app/scripts/capture-composer-fixtures` now provide the full deterministic
state set through the production composer with isolated stores. Portrait visual
checks passed on iPhone 17 Pro in light mode, iPhone 17e in dark mode at
Accessibility Large, and iPad (A16) at XXXL. The software-keyboard fixture kept
the active line and all three controls above the keyboard. Attachment-heavy
context scrolls vertically within a 220-point cap while photos and selection
chips retain horizontal scrolling. Attachment/recovery controls have 44-point
targets and named VoiceOver actions. These are simulator results only;
landscape, VoiceOver traversal on device, and the real-device matrix below are
not yet accepted.

## Subplans (when a sub-question needs its own design step)

No subplan is required. The bridge, native draft, attachments, selections,
delivery, and acceptance work have concrete boundaries above. If implementation
discovers that ordinary chat uploads cannot safely support the server's current
buffering limits on mobile, stop and write a transport subplan rather than
quietly introducing a second upload route inside this work.

## Failure modes (the load-bearing section)

No unresolved critical gap is accepted. Every row below must have both the
named test and visible handling before the plan ships.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| V2 payload contains an unknown version or malformed file/selection | Planned golden fixture + web doctest + XCTest | Reject whole V2 payload with a reason; legacy leniency remains separately tested | Clear receipt/error |
| Web selection command arrives twice | Planned command-ID reducer test | Persist first mutation and return idempotent acknowledgement | Clear/idempotent |
| Web selection command arrives before native store is ready | Startup activation/selection XCTest | Activate or await the target box, persist the command, then acknowledge | Clear rejection if the selected box changed |
| Selection source becomes stale after it is attached | Planned assembly test with stale `ref` | Preserve the quoted selected text and source metadata; the agent receives the snapshot even if ref resolution later fails | Clear in emitted context |
| Draft manifest is truncated or has a future version | Planned repository XCTest | Quarantine bad manifest, preserve payload files for diagnostics/recovery, show “Draft could not be restored” | Clear |
| App dies between payload copy and manifest replace | Planned injected-crash repository test | Orphan sweep retains recent unreferenced files for one recovery window, then removes them | Clear recovery notice if adopted |
| App backgrounds inside debounce window | Planned scene-transition XCTest | Synchronous manifest flush before suspension | Clear through successful restore |
| Imported security-scoped file URL expires | Planned fake-provider XCTest + device Files pass | Copy into app storage before picker callback completes; failed copy creates a visible failed item | Clear |
| Photos/iCloud transfer fails | Planned loader XCTest + device pass | Failed item with Retry/Remove; other independent items continue | Clear |
| Image orientation metadata is lost | Existing orientation XCTest, extended through draft encode/send | Normalize pixels at acquisition and preserve MIME metadata | Clear test failure |
| Image/file exceeds server or bridge limit | Planned boundary tests | Reject before upload/send with actual limit and remove/replace actions | Clear |
| File upload succeeds but manifest save fails | Planned repository/upload coordinator test | Keep local copy and server result in retry journal; reconcile on next launch | Clear recovery status |
| Uploaded `tmp/` file is swept before restored draft sends | Existing web precedent; planned native HEAD test | Remove item and token, show expired-attachment notice | Clear |
| Screenshot requested before webview is ready | Planned coordinator test | Disable action until a visible webview exists; snapshot errors create no draft item and show reason | Clear |
| Caret is inside a composed Unicode sequence | Planned reducer tests with emoji/combining marks | Convert UIKit UTF-16 range through one tested helper; reject invalid persisted ranges to end-of-text | Clear test/invariant |
| User manually edits or duplicates an attachment token | Planned assembly/reducer tests | Attachment arrays remain authoritative; missing tokens are allowed, unknown tokens remain ordinary text, remove strips only the matching known token | Clear deterministic behavior |
| Attachment finishes processing after user removes it | Planned cancellation race XCTest | Generation/item ID check discards result and deletes temporary payload | Clear/no reappearance |
| HQ transcription finishes after keyword send while user edits next draft | Voice reducer/repository race XCTest | Keyword transition persists and clears the snapshot first; completion mutates only its pending voice snapshot | Clear/no clobber |
| Speech permission/interruption/model failure | Voice state/resolver XCTest plus pending device pass | Preserve editable live transcript; expose retry or send live transcript | Clear |
| Two emissions receive receipts in reverse order | Pending-store XCTest | Match strictly by emission ID and remove only that snapshot | Clear |
| Webview navigates or reloads after injection but before receipt | Coordinator integration XCTest | Reset inflight transport state, redeliver durable pending ID, rely on backend dedup | Clear pending state |
| Receipt never arrives | Injected-delay coordinator XCTest | Move to rejected/timed-out state with Retry/Restore/Discard; never auto-discard | Clear |
| Rejected emission returns while a newer draft is nonempty | Pending restore/rejection XCTest plus rejected fixture | Keep failed pending row; do not overwrite draft; Restore requires an empty draft | Clear |
| User switches boxes with draft/pending work | Draft and pending-store lifecycle XCTest | Flush old box, load new box's independent state, continue old pending delivery only when its box is active | Clear per-box state |
| Location permission or bridge request fails | Existing contract fixtures, extended UI test | Existing visible result message; draft remains unchanged | Clear |
| Native shell and hidden web store both accept a selection | Planned native-shell browser test | Exactly one branch: command in native mode, web store mutation otherwise | Clear invariant/test failure |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field — ADDRESSED.** Native never assembles `<typed>`,
  `<voice>`, `<attachments>`, or selection markup. It sends the canonical
  `Emission`; the existing chat target remains the only assembler (Track 1).
- **Stale ref — ADDRESSED.** A selection carries a snapshot of `text`,
  `position`, and `ref`; stale source resolution cannot erase the quoted content
  (Track 4 and failure table).
- **Two agents touching the same card — DEFERRED.** Input-plane parity does not
  alter card writes or reconciliation; the chat agent's existing write
  discipline remains authoritative.
- **Hand-edit drift — DEFERRED.** Composer tokens are transient message syntax,
  not card markup. Hand-edited card syntax is outside this plan.
- **Fabricated free-form value — ADDRESSED.** Selection source/position comes
  from the companion pane and attachment paths come from validated upload
  responses; Swift does not fabricate either (Tracks 1, 3, and 4).
- **Validation error UX — ADDRESSED.** Invalid bridge values, upload responses,
  persisted manifests, and stale payloads produce item- or pending-row errors
  with recovery actions rather than disappearing (Tracks 1-5).
- **Partial migration / transition state — ADDRESSED.** V2 producers coexist
  with the documented legacy decoder; old text-only iOS drafts are adopted once;
  optional V2 fields do not require Android to update atomically (Tracks 1-2).
- **Multiple human inputs racing — ADDRESSED.** Attachment completions,
  selection commands, dictation completion, and receipts all target stable IDs
  in explicit stores; none writes through view-local snapshots (Tracks 2-5).

## NOT in scope

- **Native TTS playback or duplicated stop-speaking UI.** The boxholder
  explicitly excluded TTS playback, and the web `TargetStrip` remains visible.
- **Native chat transcript rendering, session navigation, or target state.** The
  webview remains the one chat client and target owner.
- **Pixel-for-pixel parity with the React composer.** Native keyboard, camera,
  sheets, safe-area behavior, and dock layout remain intentionally native.
- **Cross-device/browser draft synchronization.** Web and iOS drafts are local
  to their input embodiment; parity is behavioral, not cloud synchronization.
- **Moving full capture output into the regular draft.** Capture remains its own
  durable staging/preparation workflow.
- **A new server upload protocol.** Ordinary files reuse
  `/api/chat/upload-file`; transport redesign requires the subplan gate above.
- **Android UI implementation.** The versioned contract stays backwards
  compatible and fixtures become Android-ready, but this plan changes only iOS
  and shared web code.
- **Drag and drop from a desktop pointer.** Files, Photos, paste, camera, and
  screenshot are the native acquisition equivalents.
- **Editing a rejected snapshot in place.** Restore copies it into an empty
  draft; pending rows remain immutable delivery records.
