---
title: "iOS quick capture: Siri, voice, and sharing with context"
status: draft
workstream: siri-app-intents
issues:
  - ../../../issues/bugs/2026-08-08-ios-siri-app-intent-capture.md
---
# iOS quick capture: Siri, voice, and sharing with context

This plan gives a person fast ways to get words and material into a predictable box. Siri thoughts, voice notes, and shares with instructions use one durable acceptance and recovery path, followed by processing when appropriate.

**Issues addressed:** [Siri capture failure](../../../issues/bugs/2026-08-08-ios-siri-app-intent-capture.md). This implements the iOS portion of [quick-drop entry points](../../../issues/features/2026-09-25-quick-drop-entry-points.md); that umbrella remains open for other platforms and broader routing design. [Incomplete shared webpages](../../../issues/bugs/2026-09-21-share-sheet-webpage-stub-never-completed.md) remains separate: preserving a URL is not claiming its page was downloaded.

The [dated iOS research](../../../research/ios-quick-capture-2026-10-12.md) supports the techniques below. The [earlier product-shape review](ios-app-intent-capture.product-shape.review.md) explains why the previous text-only repair was insufficient. This revision supersedes that repair's scope. Implementation is not authorized by this document.

## Design

### Situations

- When Priya is walking and remembers something, she wants to tell Siri a thought without handling the phone, so the box keeps it before she forgets.
- When Priya wants to talk through something longer, she wants one action to start a voice note and an obvious way to stop, so she can preserve her actual words and voice.
- When Priya shares a screenshot of a confusing error, she wants to say “Find the problem shown here” with the screenshot, so the box receives both the evidence and her intent.
- When Priya has no instructions yet, she wants to save the screenshot or link alone, so she can think about it later without inventing a task now.
- When Priya later knows what she wants, she wants to add words to that particular saved item, so an intervening capture cannot redirect them.
- When Priya browses a different box, she wants her capture destination to stay predictable, so a private thought does not land in the wrong place.
- When Priya is offline, she wants an honest saved-on-phone result and recoverable content, so capture does not require waiting for the box.
- When Priya is talking to someone else or cancels a recording, she does not want incidental speech sent to the box.

### Right place, right time

| Situation | Act, show, or quiet | Surface and record | Attention |
|---|---|---|---|
| Short thought, hands busy | Invoke then ask for words; accept promptly | Siri dialog; retained memo and receipt | Brief spoken acknowledgment naming box |
| Longer voice note | Start only on explicit invocation; show microphone state | Native voice screen and Live Activity; audio plus transcript | Visible ongoing recording, explicit Stop and Save |
| Screenshot plus instructions | Preview and accept the complete submission | Share extension, material preview and optional words | Return to originating app after local persistence |
| Material alone | Save; do not invent a command | Same share sheet; retained material | Quiet, findable later |
| Later explanation | Select the original item, then accept context | Capture detail, Add context | No global “latest” guess |
| Offline/uncertain delivery | Preserve and show pending state | Native capture list; server receipt when available | Brief result; no unsolicited agent reply read aloud |
| Wrong/default box missing | Require repair, never silently switch | Setup or inline refusal naming destination | Ask only when needed |
| No invocation/cancel | Stay quiet | No submission; explicit local discard for cancellation | No ambient capture |

### Spirit

- **Serves:** `architecture/spirit.md`, “The best stuff comes from the people”: “The box's job is to collect, preserve, and organize those things.” Audio and supplied words remain sources; transcription is a derivative.
- **Serves:** “Feedback is everywhere, and it's not all commands”: preserve material and thoughts that have no task.
- **Risks:** “You should be able to see the gears”: “Every action has a source.” Distinct local, remote, processing, and failed states keep acceptance from masquerading as completed work.

### Trust

Saving is automatic after explicit capture invocation; it needs no second confirmation. It never implies authorization for an external action. Text and voice thoughts continue quick-chat's existing open-ended input semantics. Share instructions and later context are human input about specified material. Material alone is save-only, without autonomous chat dispatch or the current capture worker's annotate/file/delete policy. Existing box trust rules govern actions requested in human words. Do not require a command, category, or save-versus-task toggle from the person.

### When it goes wrong or does nothing

Say “Saved on your phone for <box>” only after local bytes and manifest persist. Say the box accepted it only after server receipt. A microphone failure says recording never started. An interrupted recording retains the playable portion and shows Interrupted; it never claims a complete transcript. A transcription failure leaves audio playable. Removed target, invalid credentials, unavailable storage, and missing shared material produce actionable states. A protected box stays unavailable through Siri even with an unlocked phone; share UI may use its existing authenticated unlock flow.

### Walkthrough

Priya shares a screenshot, sees default box A, and dictates “Find the problem shown here” into the optional instruction field. The extension copies the image to app-group storage, seals one manifest containing image and words, and returns a saved-on-phone receipt. Upload and acceptance can continue separately. The server accepts only when all declared bytes exist and the matching manifest seals. Its worker creates the retained memo/material refs, commits them, then submits the human words and source ref through box-wide routing. Priya can find the item and delivery state on the box screen. If she instead supplied no words, the item stays saved without a chat task. Later Add context targets that capture ID in A; browsing B or saving another screenshot does not affect it.

## Smallest fix and budget

The smallest Siri bug fix is registration plus correct dialogs and a device check. It would still omit actual audio, screenshot instructions, stable capture destination, and explicit later context. This plan implements those requested behaviors together.

**BIG CHANGE — proposed, not yet approved for implementation.** Estimate additions plus deletions: 1,500–2,200 Swift source lines (shared store, delivery, recording, controls, share/detail UI), 800–1,200 backend/shared/schema lines, 700–1,000 test lines. Authored documentation: 450–650 lines including plan, review, mobile contract, and guides. Generated output: none expected; project-file target entries are counted as source. Total exceeds 2,000 lines. The next implementation go-ahead must explicitly cover this scale, or the human can choose a smaller complete scenario set. These are estimates, not permission to grow scope.

Commit-sized tracks below are dependency order, not partial ship boundaries. The media durability and phone lifecycle work drive the size. No SiriKit extension or iOS 27 toolchain change is included.

## Stated preferences this plan trades against

- Human: “I have no opinion on the shortcut or the techniques available on ios, I just want the behavior.” Choose task-shaped intents and direct share/recording surfaces, not a required personal automation project.
- Human: “Well, I want Siri too. Or some quick way to make a voice note.” Provide both Siri thought capture and actual recording. Do not substitute typing or a text-only Dictate Text recipe for audio preservation.
- Human: screenshot is not the entirety; “I have to say what to do with it.” Words and evidence share acceptance. Later context is explicit rather than heuristic.
- Human decision: `requiresDeviceUnlock` stays unavailable through Siri. Keep this policy distinct from normal authenticated share access.
- `docs/design/trust.md`, “capture must cost nothing in the moment, or the thought is not captured.” Local persistence precedes networking/model work; person sees a short truthful result.
- `ios-app/AGENTS.md`, “Native must submit an `Emission` to the visible web session”; quick-chat is the documented exception. This plan adds a documented box-level capture boundary, not a parallel native chat client. Webview transcript/session ownership stays intact.

## What already exists

| Verified source and exact anchor | Reuse/change |
|---|---|
| `ios-app/BeeBox/Intents/CaptureThoughtIntent.swift:12`: `@Parameter(title: "Thought") var thought: String` | Keep text adapter and replace its destination/acceptance dependency |
| `ios-app/BeeBox/BeeBoxApp.swift:19`: `AppDependencyManager.shared.add(dependency: { await AppRuntime.pairedBoxStore })` | Register shared capture dependencies and update App Shortcuts at launch |
| `ios-app/BeeBox/Storage/SharedSelectedBoxSnapshot.swift:58`: `return boxes.first { $0.id == selectedBoxID } ?? boxes.first` | Shared share selection has the same fallback; capture default must be separate here too |
| `beebox/src/webapp/trpc/routers/share/router.ts:41`: `saveTextual: authedProcedure`; `:67`: `Share ID already belongs to different content` | Preserve existing landmark URL/text save; reuse identity/conflict conventions |
| `beebox/src/core/chat/session/prompts.ts:55`: `No audio recording is attached.` | Add retained-recording framing, without applying live speech semantics |
| `ios-app/BeeBox/Storage/PairedBoxStore.swift:38`: `return boxes.first { $0.id == selectedBoxID } ?? boxes.first` | Browsing selection and fallback cannot define capture destination |
| `ios-app/BeeBox/Storage/BoxScreenStore.swift:200`: `await outbox.retry(id: entry.id)` | Keep legacy quick chat; external capture acknowledgment no longer awaits routing |
| `ios-app/BeeBox/Storage/QuickChatOutbox.swift:62`: `An entry leaves the outbox only when` submit returns | Reuse stable-ID/write-before-network principles; not its text-only format for files |
| `ios-app/BeeBoxShareExtension/ShareViewController.swift:217`: `This version can share a web link or text.` | Add image provider loading, preview, instructions, durable acceptance |
| `ios-app/BeeBoxShareExtension/ShareViewController.swift:157`: `.deviceOwnerAuthentication` | Preserve explicit authenticated share access |
| `ios-app/BeeBox/BeeBox.entitlements:9`: `group.app.beebox.ios` | Existing app group is shared by the share extension; add control target membership |
| `ios-app/BeeBox/Services/CaptureAPI.swift:139`: `app.beebox.ios.capture-upload-v1` | Reuse file-based background transport pattern with a separate transfer namespace |
| `beebox/src/webapp/routes/bulk-upload/validation.ts:29`: `targetSessionId: z.string().min(1)` | Public bulk upload needs a chat, so do not call it unchanged for box capture |
| `beebox/src/webapp/routes/bulk-upload/register.ts:331`: `batch whose failed list or note wasn't recorded yet` | Adapt composite sealing and shared byte-staging helpers; preserve current bulk semantics |
| `beebox/src/core/chat/routing/quick-chat-submit/submit.ts:207`: `throw new QuickChatTextConflictError()` | Immutable original delivery; follow-up is a new event ID |
| `beebox/src/core/chat/routing/quick-chat-store.ts:14`: `import { writeFileAtomic }` | Use existing atomic write and file-lock helpers for server receipts |
| `beebox/src/schemas/memo.ts:41`: `brief: "A captured text/voice note"`; `:75`: `The recorded audio file lives in the memo's attach scope` | Retained memo is the source envelope; reuse audio attachments and transcription fields |
| `beebox/src/cli/commands/wakeup/steps.ts:308`: `entry.endsWith(".card")` | Inbox discovery ignores memo capture identity; source records live outside inbox |
| `beebox/src/schemas/capture-session.tsx:83`: `Annotate by default.` | Do not reuse its automatic processing/deletion instructions for save-only input |

Search found no existing composite box-level acceptance operation, capture-specific default, standalone AudioRecordingIntent, or ControlWidget in the iOS implementation. Existing image/audio schemas and bulk/capture writers cover material storage; do not create replacement media types.

## Prior art (external)

All techniques were researched before this revision. Availability is SDK evidence, not proof of device behavior.

- **Adopt:** two-turn App Shortcut text input, registration, app-name token/synonyms. [WWDC22](https://developer.apple.com/videos/play/wwdc2022/10170/), [Apple sample](https://developer.apple.com/documentation/appintents/acceleratingappinteractionswithappintents).
- **Adopt:** iOS 18+ AudioRecordingIntent and required ongoing Live Activity. [Apple recording intent](https://developer.apple.com/documentation/appintents/audiorecordingintent).
- **Adopt:** controls for Lock Screen, Control Center, and Action Button, backed by the same recording tasks. [WWDC24 controls](https://developer.apple.com/videos/play/wwdc2024/10157/).
- **Adapt:** start/stop recording tasks and visible ongoing state. Just Press Record documents these surfaces and an unlock requirement. This is product precedent, not an Apple background guarantee. [Vendor guide](https://openplanet.zendesk.com/hc/en-gb/articles/48116180645521-One-tap-recording-integrations).
- **Adopt:** share preview/annotation and file-based app-group background uploads. [Share guide](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/Share.html), [Background URLSession](https://developer.apple.com/documentation/foundation/urlsessionconfiguration/background(withidentifier:)). Force quit can cancel transfer; recovery waits for reopening.
- **Evaluated only:** SiriKit create-note supports a complete spoken note but is deprecated at iOS 27; current Notes App Schema requires iOS 27 and eligible Siri/Apple Intelligence support. Installed toolchain has iOS 26.5 SDK. Both remain later compatibility adapters. [SiriKit](https://developer.apple.com/documentation/intents/increatenoteintent), [Notes schema](https://developer.apple.com/documentation/appintents/appschema/notesintent/createnote).
- **Evaluated only:** ActivityKit/runtime documentation does not prove all cold/locked recording starts succeed. Foreground voice screen is the required fallback; no CallKit/PushToTalk misuse. [Runtime](https://developer.apple.com/documentation/appintents/configuring-the-runtime-behavior-of-your-app-intents).

Implementation adds ACKNOWLEDGEMENTS for adapted external product patterns, not for merely evaluated options.

## Ontology

- **PairedBox (existing):** native connection identity and credential scope. Box ID is fixed at local acceptance. A chat session is a destination within a box, not a box.
- **Capture default (new native preference):** explicit paired box UUID, separate from browsed selection. One paired box is suggested initially; multiple require setup choice. Removal invalidates it; never falls back.
- **Capture (new coordinator record):** client UUID, owner, timestamp, source, human input, material manifest, and states. It owns immutable original source and receipt, not an agent-created interpretation.
- **Material (new manifest role, existing storage types):** URL, text clipping, image, or audio. URL/text values are data; file items use stable item UUID, MIME, byte length, digest, safe name. No arbitrary filesystem path or remote fetch is accepted from the client.
- **Human input:** exact words spoken to Siri, transcript derived from voice, share instructions, or later context. Material contents are never promoted to this role.
- **Source memo (existing type, additive identity):** retained `_content/captures/<captureId>.memo.card` outside the automatic intake inbox, with optional `share-id: UUID`, reusing the existing external-operation identity convention, and existing `context: {url?, title?, text?}` for the single URL or clipping. Images/audio use the existing attach scope and child image refs. The coordinator manifest remains the typed material-role reader for detail and dispatch; no new material-array card field is needed. Audio stays in its attach scope. No new image/audio type; image material refs use existing image writers. Agent may move/file source, but must preserve its share-id and original source; deletion requires explicit human action.
- **Context event (new):** separate UUID and original capture UUID/box UUID, human words, optional new material, acceptance and delivery state. Never rewrites original submitted quick-chat text.
- **Acceptance receipt:** local or server evidence that the complete declared input is durably owned. Processing and chat delivery are separate states.

## Tracks / scope

### 1. Capture identity and acceptance contract

**What/why:** introduce narrow generic box capture acceptance that can save without a chat runtime or model. Existing quickChat.submit routes before its first record save; capture/bulk finalization and delivery presume chat processing even where create permits a null target. Existing share.saveTextual is box-level save-only acceptance for URL/text, but lacks files and accompanying instructions.

**Direction:** implement a small coordinator over shared byte staging, atomic manifests, and existing card writers. Proposed wire contract (names lock in when fixtures are written):

- `POST /api/quick-captures/:captureId` is one file-backed multipart acceptance request, containing a version-1 declaration and the complete declared bytes. Declaration: `{version:1, capturedAt, source, input?:string, material?: URL | clipping | image | audio, parentCaptureId?:UUID}`. File material has item UUID, MIME, byte length, digest, safe display name; no local path. Context events have parentCaptureId and input, with no material in version 1. Owner derives from auth. Empty input with no material is invalid.
- Native builds a multipart body file in the app group and schedules one background upload task before completing the share extension. Text/URL-only input uses the same logical operation without binary parts. Server parses into durable staging, verifies exact count/length/digest and immutable payload identity, then seals atomically. It rejects incomplete or extra parts. There is no client-side final accept call after an upload finishes.
- Success returns `{id, state:"accepted"}` only after durable complete-set seal. Identical replay returns the same receipt; changed input/material conflicts rather than overwriting. The server can finish acceptance and begin processing with no app/extension alive. Missing response leaves local state pending until receipt recovery.
- tRPC `quickCapture.capabilities/list/detail/retry` exposes version support, receipts, and status. Later context enters the same acceptance operation with a distinct event ID and parentCaptureId, including offline. The native event owns its draft/manifest; transfer waits for the parent receipt. No global latest resolver.

Store canonical immutable source declarations and status under `.beebox/quick-capture/`, per-ID server file locks. Byte staging cannot be removed before successful owned-source materialization. Worker writes retained memo and attach scope, commits them, then dispatches. Sealed receipts recover on startup and normal bounded sweep; failures preserve data and show status. Use a separate staging kind/delivery policy so existing capture/bulk workflows retain behavior. Acceptance survives unavailable chat. The declaration and bytes are not yet a completed agent task.

**Vocabulary lock-ins:** version 1, UUID identity, material versus input, complete-set sealing, conflict rather than mutation. Apply bbx-guide-api, bbx-guide-schemas, and bbx-ios-overlap at implementation; golden fixtures mirrored in Swift and TypeScript.

**First chunk:** schemas/types, declaration/acceptance coordinator, source writer, request/response fixtures, focused completeness/replay doctests. No caller switches until this contract exists.

### 2. Shared native capture storage and destination

**What/why:** a composite must survive extension termination and must not use browsed selection or process-local arrays.

**Direction:** app-group `QuickCaptureStore`, per-capture directories with copied media and atomic versioned manifest; coordinate cross-process writes with supported file coordination. Immutable source manifest plus separately coordinated status prevents extension/app/control lost updates. Local acceptance occurs after file flush and atomic manifest publish. Broken/incomplete temporary directories are recovered as interrupted drafts, never silently submitted. Apply file protection suitable for approved access: unprotected-box captures may use complete-until-first-authentication protection; authenticated protected-box captures remain completely protected and can wait for unlock to transfer. Reboot before first unlock is not a background capture promise. Keep credentials in the existing shared Keychain, never manifests.

Persist captureDefaultBoxID under its own key in the existing app-group UserDefaults suite via CaptureDestinationStore, independent of selectedBoxID and whole-snapshot publishing. App settings writes it; intents, sharing, and recording read it. Absence decodes as unset. Pairing, selection, and unlock-flag snapshot rewrites cannot erase or change it. Resolve explicit pinned box first; otherwise capture default. An absent default with exactly one paired box may initialize once. Multiple boxes require setup. Refuse missing/removed targets; require the explicit choice rather than falling back. App Intent paths enforce the existing protected-box refusal because actual Siri versus Shortcut invocation is not reliably distinguishable. Authenticated share retains its unlock flow. Stop a recording keeps its original box snapshot.

Retain old QuickChatOutbox independently and drain it through its old route; do not reinterpret or delete legacy entries. New external captures use the new store. A bounded retry schedule of at most seven days ends in visible Needs retry, retaining content; credential revocation/target removal stops automatic retries immediately. Recovery runs on app activation and background URLSession events; suspended/force-quit execution is not promised. Background transfer identifiers are distinct per initiating app/extension process, with durable task-to-capture/item mapping and main-app completion recovery. Extension-created configurations set sharedContainerIdentifier to group.app.beebox.ios. Extend BeeBoxAppDelegate's current capture-only identifier guard and completion handler routing for these sessions; do not assume CaptureAPI's main-app configuration is extension-ready. Refresh server receipts before deleting local files. Completed metadata remains findable; cleanup only after confirmed server-owned source and no pending context.

**First chunk:** destination pure resolver, native disk store, cross-process conflict and disk failure XCTest, legacy-outbox coexistence. No UI-specific duplicate queue.

### 3. Source processing, routing, and explicit context

**What/why:** screenshot content must not be treated as a command; source identity must survive filing; model work cannot delay capture.

**Direction:** material-only captures produce a retained source memo and no chat dispatch. Keep retained sources under `_content/captures/`, outside `_content/inbox/`: existing intake and preprocessing scan the inbox without considering capture ownership. The coordinator invokes transcription explicitly and submits only authorized human input. Do not rely on memo status or share-id to suppress intake, and do not widen global intake exclusions. Human input uses existing box-wide quick-chat routing with a reference to the materialized source. Extend QuickChatSource and the external-input wrapper with known acquisition source and optional source memo ref/recording metadata. Update prompt framing so user words and quoted material have separate roles. A recorded voice note uses an external-input wrapper naming its source memo and retained audio, not a live speech turn or the current “No audio recording is attached” claim. No live voice-out behavior is implied. Generated transcript may fill existing memo transcription fields, but original audio and input remain canonical. Retained source is not auto-deleted after processing.

For voice, accept audio immediately; transcription is asynchronous using existing dispatch services. Preserve failed transcript state and expose Retry transcription. A voice note's derived transcript is human input, routed after available; empty/failed transcription saves audio without fabricated work. Source and derived text are labeled distinctly. Siri short text remains human input and routes without needing speech services.

Each context event is independently accepted with its own immutable input and source ID. Add context works on local-only and server-accepted items: persist words in the same app-group store, display Waiting for original capture/connection, and upload after recovering the parent receipt. Parent terminal failure retains the context with an actionable blocked state. Source lookup resolves capture ID after moves; verify stored ref, then current card index/scan memo cards by share-id on miss. Explicit human deletion yields Gone; don't revive old paths or substitute a newer item. Duplicate IDs/conflicting identities are errors. Explicit human deletion leaves a Gone tombstone under the original acceptance ID so a stale retry cannot resurrect it. Save-only parent + first context starts work. If the parent already has a fixed chat, follow-up uses that chat with a new message ID. If parent routing needs choice, context waits visibly with that same choice. Do not dispatch context ahead of an unresolved parent or amend a submitted message. Respect quick-chat's six-day sending expiry and seven-day dedup horizon; status reconciliation precedes a manual retry. When remote outcome cannot be established after expiry, retain the source and request an explicit new send rather than silently minting a new message ID.

**Vocabulary lock-ins:** `share-id` on the source memo is identity across filing; event UUID is delivery ID; `apple-app-intents` attribution remains truthful for callers we cannot distinguish. Share/recording sources name only known acquisition APIs, not assumed Siri/Action Button origin.

**First chunk:** idempotent source materialization and role-preserving dispatch builder; replay/conflict/source-move tests; agent guidance and knowledge audits. Reuse quick-chat routing policy rather than a new classifier.

### 4. Siri and Shortcuts text/material adapters

**Direction:** retain a short App Shortcut trigger and required Thought prompt. Register/update parameters at launch and when box entity choices change. Add a box entity parameter for optional pinned destination, with capture default used when absent. Expose a general Save to Box action accepting optional text, URL/IntentFile material, optional instructions, and box; do not make separate capture intents for every input file type. Required Siri Thought intent is a convenient wrapper around the same acceptance operation. Named Shortcut using Dictate Text is a documented fallback, not the sole Siri implementation. A no-match Siri result creates no success claim.

**First chunk:** update registration and route text action into local acceptance; exact phrases and honest dialogs. Siri always acknowledges completed local acceptance immediately as “Saved on your phone for <box>”; it does not wait for a server/routing attempt or promise a second spoken update. Schedule the transfer before returning, and expose later server acceptance/delivery in capture detail. This proposed choice prioritizes the human's hands-free capture moment over opportunistic Sent wording. Media action follows the shared store, not direct HTTP submission. Phone phrase matching is a gate, not inferred from simulator or Shortcuts tapping.

### 5. Quick voice note and controls

**Direction:** main-app recording coordinator persists a draft and box snapshot before activation, then owns audio lifecycle. Reuse native speech/audio pieces after removing composer lifetime assumptions. Start Voice Note and Stop and Save are task-shaped intents; on iOS 18+ adopt AudioRecordingIntent and show required Live Activity. ControlWidget toggles current state, while Start is idempotent if already recording for the same box. A second Start requesting a different box reports the active recording and refuses the switch; Stop uses the recording snapshot, not current selection. Expose control for supported Action Button, Lock Screen, and Control Center; Spotlight/Shortcuts use the same tasks. iOS 17 opens the dedicated voice screen directly and starts after permission. No extra tap is required after granted permission.

Use supported foreground execution where system context cannot safely start recording. Preflight microphone/Live Activity permissions in setup, give an explicit foreground fallback, and never claim invisible locked recording. Record AAC audio with a ten-minute first-release limit and the cached advertised byte cap, whichever comes first; warn near the limit and stop/save visibly at it. Do not silently trim or claim unlimited recording. Include required background-audio capability for continued recording after a supported start, while distinguishing continuation from permission to start locked. Stop flushes and publishes to QuickCaptureStore without awaiting transcription. App interruption/background termination recovers playable partial audio. Siri may hand off microphone differently on hardware: batch the device checks. A Siri-invoked protected target remains refused; foreground normal authenticated app recording is a separate explicit flow.

**First chunk:** recording coordinator, draft recovery, permission/interruption reducers, native voice screen. Then intent/Live Activity/control target and project membership; no recording logic in the extension process. Metadata-only BoxLog at start/refusal/interruption/flush/acceptance boundaries.

### 6. Share, capture list, follow-up, and guides

**Direction:** add image loading to current share activation rules; first release accepts one image, one URL, or one clipping per share, optional instruction text up to 10,000 characters, and file sizes within existing server capabilities. Unsupported combinations show before acceptance and retain the draft. Preview images and entered words with visible box. Copy all selected supported items before acceptance; no implicit partial share. Keyboard dictation supplies spoken words; no custom share-extension microphone recorder.

Keep existing Send to a chat and Save in landmark share actions and their APIs under an explicit alternate destination choice for URL/text. They retain their current behavior and are not silently reinterpreted or migrated. Switching to a legacy mode with image material or added words is refused with an explanation while preserving the draft; no comment is silently dropped; the new default Save to box supports accompanying words and this plan's capture detail/Add context. Source IDs from old saves are not automatically imported into the new coordinator. Capability absence shows the existing choices with their limits.

Use the native box screen's existing pending area for a compact capture list including local pending and server accepted records. Detail shows original material/audio, exact instructions/transcript, named box, delivery/choice/error, Add context, Retry, and explicit discard/delete where authorized. Context can be typed or keyboard-dictated. Selecting a capture in A keeps A even if browsing B; never turn follow-up into generic new thought.

**First chunk:** share preview/instruction submission and recoverable local states. Then list/detail/Add context and current Siri usage guide, exact phone checks, source state explanations. Do not build native chat transcript/session models.

## Could this be simpler?

Registration plus a Dictate Text Shortcut is the simplest text repair. It fails audio preservation and screenshot-plus-words. A share comment field plus direct upload is smaller than this design, but extension termination and offline acceptance could lose the screenshot or separate it from the task. One local composite store and narrow sealed server receipt earn their cost under trust-to-keep. We do not add a new classifier, media schema family, generalized automation engine, or conversational Siri reply loop. SiriKit and iOS 27 schema adapters are deliberately excluded from this complete first release.

## Subplans

None currently. Contract and source fields and single-request transport are specified here; if implementation reveals a migration of existing data or different processing policy is necessary, revise before that track. Do not silently add a migration or share an incompatible staging kind with current capture clients.

## Failure modes

All new handling/tests below are proposed, not already implemented. No unresolved silent failure is accepted.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Siri transcribes trigger but selects no intent | Physical failure known; repeat exact phrases | Registration repair plus documented named Shortcut fallback planned | No Bee Box success; phone gate |
| Browsed box B changes capture from default A | New resolver XCTest planned | Independent explicit default planned | A named in acknowledgment |
| Target removed or protected | Existing text guard; new cross-surface cases planned | No fallback; stop retry, preserve already accepted local data | Actionable refusal/repair |
| One image fails to copy/upload | Composite store/API doctests planned | Refuse acceptance of incomplete manifest; keep draft | Visible pending/error, no sent claim |
| Two processes update one pending item | Native store concurrency XCTest planned | Coordinated immutable source and status update | Conflict visible; no overwrite |
| Server seals, response is lost | Accept replay doctest planned | Stable ID + digest receipt replay | Saved-on-phone until receipt recovered |
| Server restarts after seal before source commit | Worker resume doctest planned | Sealed ledger resumes; raw bytes owned until commit | Accepted, preparing or failed |
| Router/chat unavailable after acceptance | Existing routing tests; new receipt test planned | Saved source independent of dispatch, visible needs-choice/pending | Saved versus delivered distinct |
| Mic activation fails or Live Activity disabled | Reducer tests plus phone | No recording claim; explicit foreground recovery | Refusal and cause |
| Recording interrupted/terminated | Recovery XCTest plus phone | Playable partial draft and explicit Interrupted | No complete transcript claim |
| Transcription fails or is empty | New worker doctest | Audio retained; retry; no invented input | Saved audio, transcript unavailable |
| Retry after dedup window | New coordinator doctest | Bounded automatic retry, terminal Needs retry, reconcile before replay | Manual recovery, preserve source |
| Context races unresolved parent route | Context/order doctest planned | Wait same choice; immutable separate message IDs | Pending context visible |
| Source moved/deleted | Move/delete context doctest planned | Resolve stable ID; explicit Gone if deleted | No newest-item fallback |
| Image/clipping contains instructions | Prompt fixture + knowledge audit planned | Material framing separate from authored input | No fabricated task |
| Force quit cancels background transfer | Physical phone gate | Recover on reopening; no always-running claim | Pending local item remains visible |

## Agent-flow / user-flow edge cases

- **ADDRESSED — wrong role:** Track 3 distinguishes material, transcript, and direct words. Prompt/fixture must include an adversarial screenshot/clipping containing “ignore the user's instructions.”
- **ADDRESSED — stale ref:** Track 3 resolves capture ID after move and reports human deletion; context retains box identity.
- **ADDRESSED — concurrent agents:** source/context append writes use card locks and reserialize current fields. Agent processing cannot overwrite canonical source. Events do not mutate submitted quick-chat text.
- **ADDRESSED — hand-edit drift:** schema validation catches malformed material refs; detail shows source unavailable instead of inventing paths. Duplicate source share-ids are conflicts; scope lookup to memo type and coordinator ownership, not Clerk webpage capture-id.
- **ADDRESSED — fabricated values:** receipts come from store/server; transcript absence never becomes generated human input.
- **ADDRESSED — validation UX:** malformed or unsupported share remains editable before acceptance; size/MIME error identifies affected item without exposing server paths.
- **ADDRESSED — transition:** old quick-chat entries keep their decoder and endpoint; additive memo fields are optional. Existing capture/bulk policy stays unchanged. Older servers without capability return Unsupported; text-only fallback uses the old endpoint only before new acceptance, with explicit limitations, never dual delivery.
- **DEFERRED — voice-only “add this to that screenshot”:** needs a separate reference design. Explicit detail/Add context satisfies this release.

## NOT in scope

- One-utterance SiriKit/Notes-schema adapter: useful later, adds compatibility/toolchain work and must not hold baseline delivery hostage.
- iOS 27 SDK upgrade, Apple Watch, AirPods custom gestures, locked camera capture: separate platform work.
- Reading agent replies through Siri, live conversation, speech-generated answers: capture acknowledgment only.
- Full webpage fetching/extraction: URL capture preserves the URL; incomplete webpage issue remains open.
- Arbitrary document/video imports and file-bearing later context: bounded material types first; existing general bulk upload remains available.
- Cross-box routing after acceptance, automatic default switching, global latest-item guessing: violate predictable ownership.
- New notification policy, triage classifier, agent trust ladder, or redesign of all quick-chat UI: reuse existing owners.

## Open design questions

The plan makes proposed choices, pending human acceptance of the revised scope: dedicated capture default, retained memo source, automatic routing of human text versus save-only material, and the stated BIG CHANGE size. No first implementation chunk depends on a missing technique decision.

Hardware-dependent outcomes remain acceptance gates, not settled API claims: Siri phrase selection, microphone handoff and unlock, cold recording start, control execution, dictation in the share sheet. If two-step Siri or foreground recording fallback fails on the target phone, stop and revise that adapter; do not declare the product done via tapping Shortcuts. One-utterance support is later, not promised.

## Knowledge audits

Add and run targeted audits for: material versus user instructions; retained capture source identity after processing; voice transcript failure does not mean empty capture; Add context targets explicit original ID. Update memo instructions and its “generic inbox input awaiting processing” description to recognize retained sources outside inbox, without changing legacy memo intake. Update prompt framing narrowly with named readers. Update and run existing external-input-arrival-tag and siri-capture-how-to audits for recorded-source variants and capture-default destination wording, as well as the new audits. Use isolated worktree test box per box-work, realistic synthetic content only. Record run status; never call never-run audit verified. No new core-agent prompt pointer unless discoverability needs it.

## What will hold this after it ships

Doctests cover acceptance completeness, conflict/replay, worker resume, role framing, source lookup, and routing/context ordering. XCTest covers destination resolver, native atomic persistence, concurrent store writes, retry transitions, recording interruption and legacy queue coexistence. Shared golden fixtures cover valid/invalid/old wire shapes in both runtimes. Selected simulator build/UI fixtures cover share and capture detail; browser checks cover actual memo rendering and source refs. Real iPhone alone covers Siri/system entry points and lifecycle. No new test tier. Logs carry capture ID, box ID, stage, counts, symbolic platform errors; no content, tokens, raw URLs, or transcript.

## Implementation order

1. Contract fixtures and server acceptance/source types; completeness, replay/conflict, no-chat tests.
2. Shared native store and capture default resolver, legacy coexistence.
3. Server worker/source persistence, dispatch/context ordering, role framing, knowledge audits; update mobile-contract index and anchors.
4. Siri registration/text adapter and general Shortcuts Save to Box; honest local acknowledgment.
5. Voice coordinator/screen, audio preservation/transcription, then recording intent/Live Activity/control target. Add ACKNOWLEDGEMENTS for adapted recording product patterns here.
6. Share material-plus-instructions, capture detail/list and Add context; guides and complete device batch.
7. Cross-model diff review, selected verification, and final physical-phone acceptance. Commit checkpoints; land only on a human finish request.

## Rollout shape

Tests first during implementation: new `test/webapp/routes/quick-capture.doctest.md` for all declared bytes and owner replay; `test/core/quick-capture/acceptance.doctest.md` for seal/source crash recovery; `test/core/quick-capture/context.doctest.md` for original-ID ordering and moves/deletion; `test/core/quick-capture/dispatch.doctest.md` for save-only and material framing. Extend existing quick-chat submit tests for referenced capture dispatch/choice/expiry and existing media writer tests for reuse. Add `QuickCaptureStoreTests`, `CaptureDestinationTests`, `VoiceNoteCoordinatorTests`; update shared mobile fixtures. Exact filenames may follow repository module ownership; cases and boundaries are required.

Add capability negotiation for version 1 before clients switch. Keep old quick-chat and share APIs; do not reinterpret historic data. New optional memo fields need no rewrite of legacy cards. Implement new native manifest version independently from old outbox. Do not change old native composer emission or capture staging meaning. If existing cards' meaning needs change, apply bbx-migration and revise this plan first.

Done when: selected doctests/XCTest, simulator build, affected UI checks, contract checks and knowledge audits pass; cross-model findings are adjudicated; the changed authenticated routes have a security-report update; phone list below passes or explicit bounded platform limitations are accepted by the human. Simulator success cannot satisfy Siri. Guide gives exact installed phrases and names; acceptance reports do not require Console.

### Physical iPhone exercise list

Use paired synthetic boxes A/B and distinctive markers. Record installed OS/build and which surfaces exist on the phone. Confirm each source appears once and can be opened; acknowledgments alone are insufficient.

1. **Siri thought:** close app, say “Save a thought in Bee Box,” supply “Phone test alpha,” touch nothing. Confirm named default A and exact saved words. Repeat locked where Siri is enabled. Run named Shortcut fallback separately; record whether Siri asked an unrelated recipient question.
2. **Voice:** say documented Start Voice Note phrase; speak a short marker, use documented Stop and Save. Repeat via Action Button/control if supported. Replay audio and inspect transcript. Repeat cold app, locked screen, screen lock during recording, and an interruption; document required unlock and foreground fallback.
3. **Permissions/refusals:** deny microphone, disable Live Activities in separate runs, then restore. Confirm no false recording/saved result. Select a Siri-protected target with phone unlocked; refusal writes no new capture. Share to that target through its explicit authenticated unlock; verify distinct policy.
4. **Share/context:** share screenshot, keyboard-dictate “Find the problem shown here,” submit. Verify correct image and words in one item. Share URL and clipping without instructions: saved material, no invented command. Try unsupported multiple items; show the limit before acceptance and keep the entered words.
5. **Destination:** default A, browse B, Siri capture reaches A. Pinned Shortcut B and share override B reach B. Remove default/pinned target; no silent fallback. A voice note started in A finishes in A after browsing changes.
6. **Recovery/follow-up:** offline text/audio/screenshot-plus-words receive saved-on-phone states. Force quit after acceptance, restore network, reopen; one server item each. Add context while offline to a phone-only original and confirm both survive relaunch in order. Add context to an older item with newer captures present; original ID/box receives it. Repeat after source filing and during needs-choice; pending context stays visible.

No implementation tests or device checks have been run as part of writing this plan. Cross-model plan review is recorded in the sibling review artifact.
