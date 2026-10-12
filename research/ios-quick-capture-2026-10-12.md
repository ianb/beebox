# iOS quick capture: Siri, voice notes, and sharing with instructions

Research snapshot: 2026-10-12. Recommendations for `siri-app-intents`, before implementation. This follows the [product-shape review](../beebox/docs/plans/ios-app-intent-capture.product-shape.review.md) and supersedes the earlier assumption that repairing a text App Shortcut covers the desired product.

## Behaviors to preserve

The boxholder wants Siri too, or a quick way to make a voice note. Both deserve first-class paths. The implementation technique is our responsibility. A screenshot can need instructions that are absent from the image. Capturing it must allow those words now, or an explicit follow-up later. The destination box must be predictable.

Recommended experiences:

| Situation | Recommended path | What remains after acceptance |
|---|---|---|
| Hands busy; a short thought | Siri invokes capture, asks what to save, then acknowledges local acceptance | Exact dictated text, fixed box ID, capture ID, delivery state |
| Want to talk freely or preserve the voice | Siri or one button starts recording; visible recording state and a clear Stop and Save action | Audio file first; transcript when available; same capture ID |
| Screenshot, photo, link, or clipping needs explanation | Share sheet shows material, box, and optional instructions; keyboard dictation can supply words | Material and instructions together, with their roles distinguished |
| Explanation arrives afterward | Open the particular captured item and Add context | Context attached by original capture ID and box ID |
| Automation supplies input | Shortcuts action accepts text, URLs/files, optional instructions, and optional explicit box | Same capture record and delivery operation |

These are different ways to acquire input. They share acceptance, destination rules, recovery, and delivery. A voice recording is not just Siri's transcript. Saving material alone does not imply a task request. Explicit instructions may request work; material remains evidence, not an instruction source.

## Siri: three mechanisms, different capabilities

### App Shortcuts: supported baseline

App Shortcuts provide discoverable app actions without requiring the person to construct a Shortcut. Their phrases can include predefined values/entities; they cannot use an arbitrary free-form string as a wildcard in the initial phrase. A required text parameter can produce a subsequent spoken question. Use that two-turn interaction as the baseline, not “Add to Bee Box that …” as a promised one-utterance grammar. [WWDC22 App Shortcuts](https://developer.apple.com/videos/play/wwdc2022/10170/), [WWDC24 design guidance](https://developer.apple.com/videos/play/wwdc2024/10176/).

Register/update parameters at launch as Apple's sample does. Use `.applicationName`, appropriate app-name synonyms, and short phrases that avoid recipient-like ambiguity. Correct transcription does not prove intent selection. The existing action already appears and runs in Shortcuts: missing registration is a defect, but is not an established explanation for this phone's Siri failure. Keep a named user Shortcut as an alternate invocation path; Apple documents running one by saying its name. [Apple sample](https://developer.apple.com/documentation/appintents/acceleratingappinteractionswithappintents), [Run shortcuts with Siri](https://support.apple.com/en-nz/guide/shortcuts/apd07c25bb38/ios).

Candidate fallback: Dictate Text → Bee Box capture, pinned to a box, invoked by its chosen Shortcut name or the Action Button. This captures text, not audio. Its dictation termination and no-touch behavior need a phone check; do not sell it as a recorder.

### SiriKit notes: a real compatibility option, with a sunset

The earlier review missed `INCreateNoteIntent`. It supports title, body, and group resolution through a SiriKit handling extension. Apple's examples include a complete spoken note. Bear's own guide documents both a simple invocation and an utterance containing title and body. This is evidence for the interaction, not proof of Bear's implementation or Bee Box phrase matching. [Apple create-note intent](https://developer.apple.com/documentation/intents/increatenoteintent), [Bear Siri guide](https://bear.app/faq/how-to-use-bear-with-siri-on-ios/).

Current Apple documentation metadata says introduced iOS 11 and deprecated at iOS 27, recommending Notes or Reminders App Schemas. The installed iOS 26.5 SDK still contains it without a deprecation annotation. Deprecation is not removal. Apple's older iOS 15 removal list includes append-to-note, not create-note. [Current metadata](https://developer.apple.com/tutorials/data/documentation/intents/increatenoteintent.json), [Deprecated domains](https://developer.apple.com/support/deprecated-sirikit-intent-domains).

Recommendation: investigate this as an adapter for one-utterance capture on supported older phones, after defining a real retained note/capture. Do not make it the only Siri route. Do not add a required title ceremony merely to fit the API. Verify whether a generated title and supplied content avoid another prompt. Do not use the removed append intent for later commentary.

### App Schemas: potentially honest notes, not a generic send-message disguise

Apple's current `.notes.createNote` schema describes a note with content, attachments, and a returned note entity. Its metadata currently specifies iOS 27. The local toolchain is Xcode 26.6 with iOS 26.5 SDK; it cannot build that API today. Schema-driven Siri also requires the relevant Apple Intelligence support, device, language, and region. It cannot be the universal baseline. [Create-note schema](https://developer.apple.com/documentation/appintents/appschema/notesintent/createnote), [Metadata](https://developer.apple.com/tutorials/data/documentation/appintents/appschema/notesintent/createnote.json), [Apple Intelligence requirements](https://support.apple.com/en-la/121115).

A retained thought can honestly be a note even though Bee Box does more than notes. Apple's guidance allows apps to adopt suitable schemas from multiple domains. The previous blanket rejection on “Bee Box is not a notes app” grounds was too strong. Conversely, wrapping transient agent dispatch as a note without an identifiable saved item would misrepresent the behavior. `messages.sendMessage` should not be adopted merely because it accepts prose: our capture has no messaging recipient model. [Schema guidance](https://developer.apple.com/documentation/AppIntents/making-actions-and-content-discoverable-by-apple-intelligence), [WWDC26 Siri integration](https://developer.apple.com/videos/play/wwdc2026/240/).

Recommendation: reserve a Notes-schema adapter for the newer platform when the toolchain and target device permit it. Keep the underlying capture record generic. Neither schema adoption nor arbitrary initial-utterance recognition is guaranteed by an ordinary App Shortcut.

## Voice note: native recording, with visible lifecycle

`AudioRecordingIntent`, available from iOS 18, is Apple's dedicated protocol for starting, stopping, or modifying recording. It requires a Live Activity throughout recording on iOS; without one, recording stops. This is a better fit than pretending a required String parameter records audio. [Recording intent](https://developer.apple.com/documentation/appintents/audiorecordingintent), [Availability metadata](https://developer.apple.com/tutorials/data/documentation/appintents/audiorecordingintent.json).

Expose Start Voice Note and Stop and Save tasks to Siri/Shortcuts. A control can toggle recording state for the Action Button, Control Center, or Lock Screen on iOS 18+. Keep distinct start/stop actions for automation: rerunning Start must not accidentally stop an active recording. A Live Activity makes ongoing microphone use and stopping discoverable. Widgets and Spotlight are secondary ways to invoke the same tasks. Controls use WidgetKit and App Intents; they are not a new upload pipeline. [WWDC24 controls](https://developer.apple.com/videos/play/wwdc2024/10157/), [Core App Intents](https://developer.apple.com/videos/play/wwdc2024/10210/).

Do not promise recording from an untouched locked phone. Just Press Record documents these same recording entry points and says microphone use requires unlocking. This is product precedent, not an Apple API guarantee. Its start/stop model is a useful pattern. [Just Press Record integration guide](https://openplanet.zendesk.com/hc/en-gb/articles/48116180645521-One-tap-recording-integrations).

Apple's runtime documentation says execution context depends on intent type and system context. ActivityKit normally requires foreground initiation but documents a LiveActivityIntent exception for background starts; current App Intents guidance also configures LiveActivityIntent for foreground execution. Those pages do not establish a universal cold-start recording guarantee. The precise recording-intent launch, Siri microphone handoff, locked-phone behavior, and Live Activities disabled case remain device gates. A dedicated foreground voice-capture screen is the explicit fallback, opening directly into recording after permission rather than requiring navigation and another tap. [Runtime behavior](https://developer.apple.com/documentation/appintents/configuring-the-runtime-behavior-of-your-app-intents), [Activity request](https://developer.apple.com/documentation/activitykit/activity/request(attributes:content:pushtype:)).

Preserve audio independently of speech recognition. A missing language model, recognition error, or network outage must not discard a recording. On interruption, retain the partial recording with an honest state; never claim “recording” before microphone activation succeeds. Preflight microphone permission and destination during setup. Stop and Save must flush the file and persist its manifest before claiming it was saved. Automatic silence stopping is optional convenience; an explicit stop path remains necessary.

Drafts demonstrates the alternative of immediately entering a dictation interface, saving text, and showing an ongoing Live Activity in its modern interface. It also documents language/network limitations. That supports a fast foreground fallback; it does not make dictation equivalent to retaining audio. [Drafts dictation guide](https://docs.getdrafts.com/docs/editor/dictation).

## Share with instructions: use the share extension

Apple's Share extension design explicitly supports previewing, editing, annotating, and configuring shared content. The existing custom share UI can gain a material preview and optional instruction field; no detour through a constructed Shortcut is needed for the ordinary screenshot scenario. [Share extension guide](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/Share.html).

Support a bounded first set: images, URLs, and text clippings. Distinguish a clipping from the person's instructions even when both are strings. A URL alone saves material; “Compare this with my current plan” requests work on that material. Persist both under one capture ID before accepting; don't send instructions first and upload the image later as an unrelated message. Copy temporary provider files into owned storage. Shortcuts can supply files through `IntentFile`, but sharing needs its own `NSItemProvider` loading/activation support. [IntentFile](https://developer.apple.com/documentation/appintents/intentfile), [Extension activation rules](https://developer.apple.com/library/archive/documentation/General/Reference/InfoPlistKeyReference/Articles/AppExtensionKeys.html).

Use keyboard dictation for spoken instructions in the share sheet, subject to phone verification. Ordinary share extensions are not the place to build a custom microphone recorder; Apple's extension guidance restricts their microphone access. Actual recorded commentary belongs in the main app voice experience. [Extension capabilities](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/ExtensionOverview.html).

Later context must select a specific saved item. Do not resolve “that screenshot” against a global latest capture: another upload or box could intervene. Show an explicit Add context action and retain the original box and capture IDs. Whether a later voice-only resolver is useful is a separate design question, not a prerequisite for the initial share experience.

## Destination, acceptance, and delivery

Proposed policy: one paired box can be the initial default; with multiple boxes, setup asks for a capture default. Browsing does not change it. A Shortcut may pin a box. Share UI shows the destination and allows an explicit override. Snapshot the resolved box ID at acceptance; retries and added context retain it. A removed or unavailable target never silently falls back to another box.

The boxholder's Siri restriction stays: `requiresDeviceUnlock` boxes are unavailable through Siri even when the phone is unlocked. An explicitly authenticated share UI can continue its existing device-owner authentication flow. A shortcut that can also be invoked by Siri must enforce the Siri-safe policy unless a separate authenticated foreground flow is established; don't infer the caller from unavailable source information.

Acceptance should be prompt after local persistence, not after routing/model work. Give distinct saved-on-phone, accepted-by-box, needs-choice, and failed states. The server's capture acceptance precedes interpretation and task dispatch. An attachment cannot be said to have reached the box while only its text has arrived.

For extension uploads Apple supports background URLSession with an app-group container; surviving uploads must be file-based. User force quit cancels background transfers and prevents automatic relaunch until reopening. Thus background transfer improves delivery, but a durable local manifest plus recovery is still necessary. Do not promise delivery while the app remains force-quit. [Shared container](https://developer.apple.com/documentation/foundation/urlsessionconfiguration/sharedcontaineridentifier), [Background transfers](https://developer.apple.com/documentation/foundation/downloading-files-in-the-background), [Force-quit behavior](https://developer.apple.com/documentation/foundation/urlsessionconfiguration/background(withidentifier:)).

The app, recording actions, and share extension may access capture storage in different processes. Use atomic records or a transactional store and stable IDs; the current app-lifetime text array is not automatically a safe composite extension outbox. Apple documents cross-process app-group storage considerations. [TN2408](https://developer.apple.com/library/archive/technotes/tn2408/).

## Fit against existing Bee Box code

Verified during this workstream's code walk; no implementation changed:

- `ios-app/BeeBox/Intents/CaptureThoughtIntent.swift:12`: `@Parameter(title: "Thought") var thought: String`. Keep a text capture adapter; it does not record audio.
- `ios-app/BeeBox/BeeBoxApp.swift:18-21` registers dependencies but omits shortcut parameter update. Fix during implementation, then measure phone invocation.
- `ios-app/BeeBox/Storage/PairedBoxStore.swift:34-38`: `return boxes.first { $0.id == selectedBoxID } ?? boxes.first`. Existing destination fallback contradicts the desired predictable capture policy.
- `ios-app/BeeBox/Storage/BoxScreenStore.swift:199-200` stores before `await outbox.retry`. Keep write-before-network, change the user-facing acceptance boundary.
- `ios-app/BeeBox/Storage/QuickChatOutbox.swift:13-28` stores text and metadata, not attachment files. Reuse stable-ID/retry principles, not a claim that it already queues screenshots.
- `ios-app/BeeBoxShareExtension/ShareViewController.swift:170-195` loads URL or text only. Add image loading and commentary together; the current UI has no instruction field.
- `ios-app/BeeBoxShareExtension/ShareViewController.swift:144-165` uses device-owner authentication. Preserve this distinct share access policy.
- `ios-app/BeeBox/Services/SpeechDictation.swift` already records alongside speech transcription. Reuse audio/session knowledge after checking ownership and interruption handling; it is currently composer-owned, not a durable standalone recorder.
- `ios-app/BeeBox/Services/CaptureAPI.swift` has file-based background upload machinery. Evaluate reuse against its capture-session semantics before defining a new uploader.
- `beebox/src/schemas/image/schema.tsx` already models images. This research does not require inventing a second image schema.

## Dispositions

**Adopt:** Siri two-turn text capture; a real quick voice-note start/stop experience; share material plus optional instructions; a capture default independent of browsing; honest persistence states. These directly serve the human's requested behaviors and replace the current narrow plan's assumptions.

**Adapt:** App Intents and controls as entry adapters; the existing text outbox's stable-ID discipline; native speech/audio work; file-based capture upload machinery. Define one composite capture acceptance contract before changing clients. Apply `bbx-ios-overlap` when planning its shared contract.

**Investigate before choosing the compatibility adapter:** SiriKit create-note on the actual target iOS version. It can improve one-utterance capture but adds an extension and faces deprecation. A retained note model and phone proof determine whether this earns its cost.

**Later, with compatible toolchain/device:** Notes App Schema integration; voice-only reference resolution; Apple Watch; lock-screen camera capture; live agent replies. None replaces baseline Siri or voice notes.

**Reject:** arbitrary-string App Shortcut phrases; Messages schema as a generic prose loophole; fake note entities; custom microphone capture inside the share extension; silently switching boxes; claiming server delivery after only local save; waiting for transcription to preserve audio.

## One batched phone exercise list for the revised plan

Use distinct short markers so each capture can be found once. The implementation should expose pending and saved items without requiring Console.app. These are future acceptance checks, not claims of current working behavior.

1. **Siri thought:** invoke the documented phrase with the app closed; answer the text prompt without touching the phone. Confirm the words, named box, and one saved item. Repeat from the lock screen where Siri is enabled. Separately try the named Shortcut fallback. If chosen, test SiriKit/schema one-utterance capture with and without a spoken title.
2. **Voice note:** invoke Start Voice Note through Siri and through the Action Button/control where available. Observe recording indication; speak, stop, and replay the audio. Check transcript failure does not remove audio. Repeat cold launch, screen lock, and an interruption; record any unlock requirement.
3. **Permissions and recording refusal:** deny microphone permission and disable Live Activities in separate runs. Confirm no false recording/saved result and an actionable foreground recovery path. Confirm Siri refuses a protected box even while the phone is unlocked.
4. **Screenshot plus words:** share a screenshot, dictate “Find the problem shown here” into the instruction field, and submit. Confirm the correct image and words form one item in the shown box. Also share a URL and text clipping without instructions; neither should become an invented command.
5. **Box stability:** set capture default A, browse B, then capture with Siri. It must reach A. Pin a Shortcut to B and override a share to B. Remove a selected target and confirm refusal or explicit repair rather than fallback.
6. **Recovery and follow-up:** capture text, audio, and screenshot-plus-words offline. Reopen after connectivity returns and confirm one delivery each. Repeat force quit after acceptance. Add context to one selected item while a newer item exists; verify the original item and box receive it.

A successful simulator build or XCTest run cannot pass these Siri, microphone handoff, system control, lock-screen, and process-lifecycle gates. The next plan must pair this phone list with local contract/persistence checks and explicit fallback behavior.
