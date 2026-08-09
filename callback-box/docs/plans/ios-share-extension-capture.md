---
title: "iOS Share Extension Capture"
status: partial
workstream: unknown
issues: []
---
# iOS Share Extension Capture

This plan defines a native iOS Share Extension for the Callback Box companion app. Its shipped first slice lets a person send one shared URL or text item to a recent landmark chat or save it in Inbox or a landmark that advertises itself as a share destination.

## Implemented first slice

- Track 1's shared paired-box snapshot, selected-box default, shared-Keychain credential migration, app/extension entitlements, and failure-preserving tests are implemented.
- Tracks 2–3's `share` landmark role, two-row recent landmark-chat query, exact direct chat sends, and Inbox/landmark textual saves are implemented.
- Track 6's extension target and destination UI activate URL and text only. Unsupported media types are deliberately not advertised.
- Track 7's URL/text contract, fixtures, simulator build/XCTest, and backend doctests are implemented. The issue remains open with `needs: [manual-testing]` for the physical-device script.

Tracks 4–5 (exact capture targets, terminal receipts/status, and attachment-safe movement), and the media portions of Tracks 6–7 remain future work. The later sections preserve their original design so those follow-ups can land without reopening the destination model.

**Issues addressed.**

- `issues/features/2026-05-11-ios-share-sheet-capture.md`
- `issues/features/2026-03-05-share-to-box-images-files.md` (older Shortcut/upload proposal superseded by the native extension)
- `issues/bugs/2026-07-17-ios-token-plaintext-not-keychain.md` (credential migration required by the extension process boundary)

**Jobs to be done.**

- When I find a URL or passage in another app and know the conversation it belongs in, I want to send it to a recent landmark chat without first opening Callback Box.
- When I find something useful but do not yet know what to do with it, I want to save it to Inbox so I can triage it later.
- When I already know where an item belongs, I want to save it directly to an explicit landmark destination without creating a chat.

The selected destination determines the effect. A chat destination sends the content to that exact chat. A save destination creates durable box content and does not start an agent turn.

## Stated preferences this plan trades against

- `docs/engineering-principles.md` principle 3, validate at boundaries. The extension validates provider values, and the server validates session IDs and landmark destinations again.
- `docs/engineering-principles.md` principle 4, be resilient rather than silent. The extension remains open until the box accepts the operation and shows stale-destination, auth, upload, and finalize failures.
- `docs/engineering-principles.md` principle 5, fail closed. A missing credential, invalid directory, stale chat, or protected box that was not unlocked cannot receive a share.
- `docs/engineering-principles.md` principle 8, test the contract. Swift request/response shapes, TypeScript Zod schemas, and shared mobile-contract fixtures change together.
- `docs/engineering-principles.md` principle 10, keep one source of truth. Landmark cards remain the source of filing destinations. Chat husks and transcript activity remain the source of recent chats.
- `docs/engineering-principles.md` principle 12, make invalid states difficult to represent. The server uses discriminated chat/save targets instead of nullable target fields with implicit fallback.
- `ios-app/CLAUDE.md:8-18`: *"The app is a native SwiftUI shell around the existing web chat"* and wire changes must update Swift, TypeScript, the mobile contract, and shared fixtures together. The extension reuses those server contracts and does not add a second chat model.
- `ios-app/CLAUDE.md:46-60`: *"Adding a `.swift` file on disk is insufficient"*. The new target and every shared source file need explicit Xcode project membership.
- `ios-app/CLAUDE.md:120-135`: runtime diagnostics are part of an iOS feature. The plan includes metadata-only extension diagnostics and a durable App Group spool.
- `callback-box/CLAUDE.md` requires the smallest feature that satisfies the task. V1 accepts one logical item, one explicitly named paired box, two recent chats, and explicit save destinations. It does not add automatic routing or a full chat browser.

## What already exists

- The app already has a selected-box rule. `ios-app/CallbackBox/Storage/PairedBoxStore.swift` returns the selected id or falls back to the first paired box. Use that as the extension's default while allowing a per-share choice among every paired box.
- Paired-box metadata was not extension-readable and its token was plaintext. Move the token to shared Keychain access and publish only non-secret metadata for every paired box, plus the selected id, through an App Group.
- Native HTTP auth has one shaping helper. `ios-app/CallbackBox/Services/BoxRequest.swift:3-9` says `ChatAPI`, `CaptureAPI`, `BulkUploadAPI`, and `LogForwarder` share the same credential, and `:21-27` applies the bearer token. Compile this helper into the extension.
- Swift already demonstrates direct non-batched tRPC calls. `ios-app/CallbackBox/Services/LogForwarder.swift:283` posts to `trpc/debugLog.submit`. The mobile contract describes this as raw JSON input at `callback-box/docs/mobile-contract.md` section 5.7. Reuse that request shape for share mutations.
- The tRPC server explicitly permits POST for queries. `callback-box/src/webapp/server-box-scope.ts:195-198` sets `allowMethodOverride: true`. Lock the extension's non-batched POST query shape in a server doctest and the mobile contract instead of relying on an undocumented client assumption.
- The normal chat-send contract already accepts a session and an optional retry ID. `callback-box/src/webapp/routes/chat-helpers.ts:45-57` requires `message` and `session`; `messageId` is optional. `callback-box/src/webapp/routes/chat-send-routes.ts:228-235` claims a supplied `messageId`, while `:40` bounds deduplication to five minutes. URL and plain-text chat shares use this route with a required extension-generated ID and a new exact-session check.
- Recent chat metadata already comes from durable chat husks and transcript activity. `callback-box/src/core/chat/session/list.ts:4-13` calls husks the source of truth and `:32-67` returns every resumable chat in most-recent-activity order. Reuse this loader.
- The existing picker already groups chats by landmark and uses a seven-day fresh window. `callback-box/src/webapp/trpc/routers/chat.ts:125-149` documents and loads that model. `:170-188` exposes the latest fresh chat per non-root landmark. Extract a small core selector so the web picker and share query use the same freshness semantics.
- Landmark filing destinations are already typed and discoverable. `callback-box/src/core/landmark/destination.ts:19-21` defines `triage` and `commentary`. `callback-box/src/core/landmark/list-destinations.ts:32-67` validates and lists destinations by kind. Add `share` to this vocabulary and reuse the listing function.
- Clerk already creates the required saved-URL card type. `callback-box/src/webapp/trpc/routers/clerk.ts:58-73` writes a `.webpage.card` with title, URL, capture time, readable Markdown, and optional metadata. `callback-box/src/schemas/webpage.tsx:82-114` provides `createWebpageTemplate`. Extract the reusable webpage write operation; the iOS save omits frozen HTML, extraction metadata, and commentary.
- Clerk already has an honest fallback when extraction is absent. `callback-clerk/src/domain/commentary.ts:39-42` uses the URL as the title fallback and a Markdown link as the readable body fallback. Reuse the same escaped minimal-link helper for iOS URL saves.
- Capture already stages and uploads photos, audio, and files. `callback-box/src/webapp/routes/capture.ts:123-146` creates a session, `:179-183` accepts the raw upload, and `:204-247` seals it for preparation. `ios-app/CallbackBox/Services/CaptureAPI.swift` mirrors these requests.
- Capture card writing already accepts an arbitrary destination directory. `callback-box/src/core/capture/write-cards.ts:224-275` writes child media cards and the capture-session card into `destRelDir`. Reuse this writer for media saves instead of inventing new card shapes.
- Capture delivery currently has unsafe fallback semantics for a share sheet. `callback-box/src/core/capture/prepare.ts:196-209` resolves a nullable target and derives `tmp-capture/`; `callback-box/src/core/capture/deliver.ts:78-101` falls back to the most-active chat when the requested chat is absent. New share targets must be exact and must not use that fallback.
- Capture has no durable terminal status for a native poller. `callback-box/src/webapp/routes/capture.ts:123-247` exposes create, upload, delete, and finalize but no per-session status read. `callback-box/src/core/capture/prepare.ts:368-378` emits completion and then deletes staging. Add a completion receipt before cleanup and a status route that reads active staging or that receipt.
- Inbox movement is not attachment-safe today. `callback-box/src/core/intake.ts:123-158` explicitly moves card files and skips directories. `callback-box/src/core/triage/routing.ts:65-75` also renames only the card. This would detach a saved capture-session card from its sibling `.attach/` scope. Reuse and harden the existing card-plus-attach move seam in `callback-box/src/core/commands/move-phase2.ts:34-58` for intake and triage.
- The Xcode project has one app and one test product today, and `ios-app/CallbackBox.xcodeproj/project.pbxproj:622` identifies the app as `app.callbackbox.ios`. Add one extension product with explicit source membership and embedding.

## Prior art (external)

- Apple defines a Share Extension as a separate extension process that receives input through `NSExtensionContext`, performs its post, and calls `completeRequest` after acceptance. [App Extension Programming Guide: Share](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/Share.html)
- Apple requires activation rules to declare supported types and maximum counts. The built-in rules cover text, web URLs, images, and files. [Declaring Supported Data Types for a Share or Action Extension](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/ExtensionScenarios.html)
- Apple documents App Groups as the shared-container mechanism between an app and its extension. `UserDefaults(suiteName:)` is supported, and a registered App Group can also act as a Keychain access group. [Configuring app groups](https://developer.apple.com/documentation/xcode/configuring-app-groups/)
- Apple requires every participating target to carry the shared access-group entitlement. Each Keychain item belongs to one access group. [Sharing access to keychain items among a collection of apps](https://developer.apple.com/documentation/Security/sharing-access-to-keychain-items-among-a-collection-of-apps)
- Apple notes that Keychain group names configured through Keychain Sharing receive the application identifier prefix, while registered App Group names do not. This plan uses the registered App Group identifier directly as `kSecAttrAccessGroup`. [Configuring keychain sharing](https://developer.apple.com/documentation/xcode/configuring-keychain-sharing)
- Apple recommends background URL sessions for transfers that must survive extension termination. V1 stays foreground-only because capture finalization depends on create and upload results; a durable background state machine remains out of scope. [Handling Common Scenarios](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/ExtensionScenarios.html)

## Tracks / scope

### Track 1 — Shared paired-box metadata and Keychain credentials

**What.** Add an App Group to the app and extension. Publish every paired box's non-secret metadata and the selected box id to the group. Store each paired device token in Keychain under the same shared group.

**Why this needs to change.** The extension cannot read the main app's private Application Support file. Copying the existing plaintext token into the group container would broaden the plaintext exposure and leave the open Keychain issue unresolved.

**Direction.**

- Register `group.app.callbackbox.ios`. Add its App Groups entitlement to the app and Share Extension targets.
- Add `SharedPairedBoxesSnapshot { boxes, selectedBoxID }`, where each box contains `{ id, label, baseURL, requiresDeviceUnlock }`. Store one encoded snapshot in `UserDefaults(suiteName: "group.app.callbackbox.ios")`. The main app is the only writer. The extension is read-only. Continue decoding the first shipped single-box snapshot until the app republishes the complete list.
- Add `PairedBoxCredentialStore`. Store one generic-password item per box UUID with service `app.callbackbox.ios.device-token`, access group `group.app.callbackbox.ios`, and `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`.
- Keep `PairedBox.authToken` in memory so existing callers do not change. New persisted JSON omits it. Legacy decoding still accepts it.
- Migrate in this order: decode legacy metadata, write each token to Keychain, read it back, then rewrite token-free metadata and publish the selected snapshot. If any write or verification fails, retain the legacy token and show/log the migration failure.
- New pairing writes Keychain before publishing metadata. Re-pair replaces the item only after redeem succeeds. Explicit removal deletes the Keychain item first; if deletion fails, retain metadata and report the failure.
- Treat missing metadata plus missing App Group snapshot as a fresh install. Purge orphan items for this service before a new pairing. Treat corrupt metadata as recovery state: retain Keychain items and fail closed.
- The extension defaults to `selectedBoxID`, names the current box even when it is the only one, and offers the other paired boxes when present. A choice is local to the current extension process and does not write back to the main app's selection.
- On each choice, the extension reads that box's matching token into an in-memory request target and reloads destinations. A late response for an earlier choice is discarded. Missing or mismatched state is shown in the sheet and sends nothing.
- If the chosen box requires device unlock, run the existing device-owner authentication gate before loading destinations or sending. Provider classification may run first so unsupported input fails without an unnecessary authentication prompt. Cancellation leaves the extension open and offers a retry.

**Vocabulary lock-ins.** App Group `group.app.callbackbox.ios`; `SharedPairedBoxesSnapshot`; `PairedBoxCredentialStore`; Keychain service `app.callbackbox.ios.device-token`.

**First implementation chunk.** Add injected credential and snapshot stores with migration, replacement, removal, corruption, and fresh-install tests. Then wire `PairedBoxStore` and add both entitlements. This chunk contains no extension UI.

### Track 2 — Share destinations and recent landmark chats

**What.** Add the `share` landmark destination kind and one bounded destination query for the Share Extension.

**Why this needs to change.** `commentary` means page-review filing, and `triage` means automatic classification. Neither means "the boxholder explicitly chose this directory in the share sheet." The extension also needs a small recent-chat list without downloading the full web chat picker payload.

**Direction.**

- Extend `DESTINATION_KINDS` to `triage | commentary | share`. A landmark opts in with:

  ```yaml
  destinations:
    - for: [share]
  ```

- Update the landmark schema instructions, generated agent guide, destination doctests, and card examples. Existing landmark files need no migration because `for` already parses as `string[]`.
- Add an authenticated tRPC query `share.destinations`. The native caller uses a non-batched POST with raw `{}` input, supported by the server's explicit query method override. Return two arrays:
  - `chats`: at most two entries `{ sessionId, chatLabel, lastActivity, landmark: { dir, label, symbol } }`.
  - `saveDestinations`: synthetic Inbox first, then `{ kind: "landmark", dir, label, symbol }` entries returned by `listDestinations(boxRoot, "share")`.
- Build recent chats from `loadAllSessions` plus landmark summaries. Keep only chats active in the existing seven-day fresh window. Keep the newest chat for each landmark. Sort by chat activity and take two. Do not include chats whose bound directory has no landmark.
- Make `loadAllSessions` the canonical membership set for both listing and exact-target validation. Extract the freshness constant, recent selector, and `hasResumableSession` lookup into core code used by `chat.byLandmark`, `share.destinations`, direct share sends, and capture exact-target checks. Do not mix this with the older history JSON membership test and do not maintain a native recents cache.
- A save request sends `{ kind: "inbox" }` or `{ kind: "landmark", dir }`. The server resolves Inbox to `box/inbox` and re-lists `[share]` landmarks before accepting a directory. A stale or hand-crafted directory is `BAD_REQUEST` and never becomes a filesystem path.
- A chat request always carries the exact `sessionId` returned by the query. No API in this plan resolves "most active" on the extension's behalf. Every consuming route checks the same canonical resumable-session set again at acceptance time.

**Vocabulary lock-ins.** Landmark destination kind `share`; UI groups **Send to a chat** and **Save in**; synthetic destination **Inbox**.

**First implementation chunk.** Add the `share` destination kind, shared recent-chat selector, and `share.destinations` tRPC procedure with focused doctests for non-batched POST-query encoding, canonical chat membership, ordering, two-row cap, freshness, missing landmarks, Inbox precedence, and malformed landmarks.

### Track 3 — Direct URL/text chat delivery and saved cards

**What.** Send URL and plain-text shares directly to a selected chat. Save them as cards only when the user selects a save destination.

**Why this needs to change.** A chat-bound URL is already a complete user message. Creating a capture card first adds an artifact the user did not request. A save action, by contrast, needs durable typed content without starting an agent turn.

**Direction.**

- Extend `sendBodySchema` with optional `exactSession: boolean`. When true, reject `session: "new"` and reject a session absent from `hasResumableSession` before `registry.getOrCreate`. Existing callers omit the flag and retain current behavior.
- For a URL chat destination, call `POST /api/chat/send` with the exact absolute URL as `message`, the chosen `sessionId`, a stable UUID `messageId`, and `exactSession: true`. Do not create a card, wrapper, or new chat.
- For a plain-text chat destination, send the shared text unchanged through the same route. Do not add synthetic prose around it.
- This direct HTTP call is a Share Extension exception to the main app's bridge-only composer rule. The extension has no visible `WKWebView` or native bridge to own the send. The main app continues to route composer submissions through `NativeEmissionV2`; this exception does not create a second main-app chat path.
- Add an authenticated tRPC mutation `share.saveTextual` with a discriminated item union:
  - `{ kind: "url", url, title?, capturedAt }`
  - `{ kind: "text", text, title?, capturedAt }`
  and the validated save destination from Track 2.
- Extract the Clerk webpage write operation from `clerk.ts` into core code. Both callers use `createWebpageTemplate`, filename collision handling, card validation, and `stageAndCommitPaths`.
- A saved URL creates one `.webpage.card`. Set `source` to the exact URL and `captured` to the extension timestamp. Use the supplied share title when non-empty; otherwise use the URL. The body is the same escaped Markdown-link fallback that Clerk uses when readable extraction is empty. Do not create a commentary card, frozen snapshot, byline, excerpt, or site name.
- A saved text share creates one `.doc.card` with the exact text as its body. Derive a bounded display title from the supplied title or first non-empty line. Do not invent a summary.
- Validate the completed card before commit. Use collision-resistant filenames with a timestamp plus operation UUID. Return `{ created: [boxRelativePath] }` only after the path-scoped commit succeeds.
- Extend the optional frontmatter of `.webpage.card` and `.doc.card` with `share-id: <UUID>`. Keep the operation UUID stable across extension retries. Before writing, find any card with that `share-id` across the box. Return its path only when its type and immutable content match the request; return `CONFLICT` otherwise. This remains correct after Inbox, intake, triage, or a person moves or renames the card. The deterministic initial filename also includes the UUID, but the path is not the dedup source of truth.
- Direct chat replay uses the existing five-minute `messageId` window. The extension retries an ambiguous response within that window. After the window, it shows an unresolved-delivery warning instead of automatically retrying. This is bounded duplicate suppression, not an indefinite at-most-once guarantee.

**Vocabulary lock-ins.** Mutation `share.saveTextual`; item kinds `url` and `text`; chat URL delivery is the URL itself; saved URL type `.webpage.card`; optional provenance field `share-id`; chat flag `exactSession`.

**First implementation chunk.** Write the tRPC contract tests, exact-session chat-send tests, and `share-id` replay/conflict tests that move or rename the card before retry. Extract the shared webpage writer. Add URL and text card creation with validation and exact-content assertions. Add Swift request-shape tests against shared fixtures.

### Track 4 — Exact chat targets and save targets for media capture

**What.** Reuse capture staging for images, audio, and files. Add an explicit discriminated target so preparation either delivers to one exact chat or stores the capture document in one validated save destination.

**Why this needs to change.** Media needs streamed upload and card preparation. The existing nullable `targetSessionId` silently falls back to another chat, and the preparation worker always delivers a message. Neither behavior is valid for an explicit share-sheet choice.

**Direction.**

- Extend capture-session creation with optional `target`:

  ```ts
  type ShareCaptureTarget =
    | { kind: "chat"; sessionId: string; exact: true }
    | { kind: "save"; destination: { kind: "inbox" } | { kind: "landmark"; dir: string } };
  ```

- Existing callers continue to send `targetSessionId` and retain existing fallback behavior. Reject requests that send both legacy `targetSessionId` and `target`.
- At create time, resolve and persist the target. An exact chat target must exist in the canonical `loadAllSessions` set. A save landmark must currently advertise `[share]`. Persist the resolved save directory, not an unchecked client path.
- Extend the staging schema with a discriminated persisted target while keeping legacy decoding for existing sessions. Resumes reuse the persisted target and never re-resolve to a different chat or directory.
- Chat media preparation retains the existing behavior: write a capture-session card under the target landmark's `tmp-capture/`, transcribe audio, validate, commit, and deliver a `<capture>` message. Exact mode fails as `failed:target` if the selected chat vanished before delivery. It does not fall back.
- Save media preparation writes the same capture-session and child image/audio/file cards directly into the resolved save directory. It transcribes supported audio, assembles the timeline, validates, and commits. It does not create or call a chat runtime and leaves the card status `new` because no chat delivery occurred.
- Add a terminal staging state `stored`. Mark it only after the card and its attach scope are committed.
- Add a durable completion receipt under `.callback-box/capture-receipts/<session-id>.json`. It stores session ID, creator identity, terminal outcome (`stored` or `delivered`), completion time, and created card path. Write it atomically before deleting staging. Keep receipts for seven days and cap the directory at 1,000 newest entries; prune on create and startup. The receipt contains no shared content or token.
- Add authenticated `GET /api/capture/sessions/:id/status`. While staging exists, return its current state. After cleanup, return the authorized completion receipt. Return 404 only when neither exists. Use the stored creator identity for authorization after staging is gone.
- A successful finalize response still means **sealed**, not stored or delivered. The extension polls the status route until `stored`, `delivered`, or a visible `failed:*` state before it claims success. Lost finalize or status responses resume against the same session ID and receipt.
- Update every staging enumerator explicitly. `resume.ts` re-fires sealed, preparing, and delivering chat and save targets, but never terminal `stored`. `pending.ts` includes exact-chat shares for their selected chat and excludes save targets. The resumable selector excludes Share Extension sessions because their recovery stays in the active extension attempt. The abandonment sweep never partial-finalizes an open Share Extension session; it deletes stale open share staging after the normal abandonment window and re-fires only sealed or in-progress share sessions. Finalize requires a chat runtime only for chat targets.
- Inspect M4A audio with AVFoundation. AAC-family M4A enters the transcribed audio path. Other audio is preserved as a generic file. Normalize images with the existing native image normalizer. Preserve generic filenames and MIME types.
- Keep the existing native 50 MiB per-file preflight. Copy security-scoped file representations into extension temporary storage before the provider callback returns. Remove temporary copies after terminal success, confirmed cancel, or terminal rejection.
- Verify every raw upload response: `success == true`, expected filename, and exact byte count. Retry network/5xx failures with the same session ID and bytes. Do not finalize an unverified upload.

**Vocabulary lock-ins.** New capture target kinds `chat` and `save`; exact chat behavior; staging state `stored`; source `share-extension`; durable `CaptureCompletionReceipt`; status route `/api/capture/sessions/:id/status`.

**First implementation chunk.** Add target normalization, staging-schema compatibility, completion-receipt, status-route, and sweep/resume/pending decision tests. Add preparation tests for exact-chat disappearance and save-without-runtime. Then add the Swift target encoding and verified upload coordinator tests.

### Track 5 — Attachment-safe Inbox and triage movement

**What.** Make intake and triage move a card together with its sibling `.attach/` scope.

**Why this needs to change.** A saved media capture placed in Inbox is one logical bundle. Moving only its card breaks every `attach/` ref and strands media at the prior stage.

**Direction.**

- Extract a narrow `moveCardBundle(sourceCard, destinationCard)` operation from the existing Phase-2 move seam. It preflights collisions for both the card and attach destination before either rename.
- Move the attach scope first, then the card. If the card rename fails, attempt to restore the attach scope and throw an error that names both the primary failure and rollback result. Never report a routed card while its scope is elsewhere.
- Use this operation in `routeArrivals`, `advanceToStaged`, and triage `moveItem`.
- Filename normalization renames the card and attach scope together. Compute the new attach basename from the normalized card filename.
- Triage conflict checks cover both destinations. A conflicting attach directory blocks the move even when the card filename is free.
- Preserve current result payloads; tests inspect the filesystem to prove the bundle moved intact.
- This track also repairs existing scan-import capture-session movement. It does not rewrite refs in other cards because all moved refs are internal `attach/` refs and the card plus scope keep the same basename.

**Vocabulary lock-ins.** A triage item is a card bundle: card plus optional sibling `.attach/` scope.

**First implementation chunk.** Add red doctests for top-level Inbox routing, filename normalization, staging, confident triage, unsure triage, collision, and rollback with capture-session fixtures containing nested child cards and media. Then replace the three file-only moves.

### Track 6 — Native Share Extension target and destination UI

**What.** Add `CallbackBoxShareExtension`, a custom SwiftUI-backed share controller, provider classification, destination loading, and the two delivery coordinators.

**Why this needs to change.** No extension target exists. `NSItemProvider` values are process-scoped and sometimes security-scoped. The extension must copy and validate input while it owns access, authenticate independently, and show the exact destination effect.

**Direction.**

- Add bundle identifier `app.callbackbox.ios.share`, extension point `com.apple.share-services`, and embed the `.appex` in `CallbackBox.app`.
- Activate for one logical text value, web URL, image, or file. Validate the one-item rule at runtime because one provider may advertise several representations.
- Use deterministic representation precedence: M4A audio, image, web URL, plain text, then generic file. A file URL is a file, not a web URL. Reject a provider whose concrete value does not match its advertised type.
- Default to the main app's selected box, visibly name it, and offer a picker when more than one box is paired. Run the chosen box's lock gate, then call `share.destinations` for that box.
- Render two sections under the item preview:
  - **Send to a chat**: zero to two recent landmark chat rows. Each row shows landmark symbol/label and chat label.
  - **Save in**: Inbox followed by `[share]` landmark rows.
- Require one destination selection. Use one primary button whose label changes to **Send** or **Save**. Disable it while the operation is in flight.
- Once a submission has been attempted, keep its box and destination fixed for any retry because the first request may have committed before its response was lost.
- Do not add a full chat picker, automatic route suggestion, or "More" screen in v1. An empty chat list is valid; save destinations remain available.
- URL/text chat rows call direct chat send. URL/text save rows call `share.saveTextual`. Media rows use capture staging with the selected exact-chat or save target.
- Call `completeRequest` only after direct chat acceptance, committed textual save, or terminal media state `delivered`/`stored`. Keep the sheet open for retryable failures.
- On cancel after server staging exists, wait for confirmed `DELETE`. If confirmation fails, say **Discard could not be confirmed; this item may still arrive.**
- Add metadata-only diagnostics for load, classify, unlock, destination fetch, selection kind, create, upload, finalize, poll, cancel, and completion. Record box UUID, content kind, destination kind, capture session UUID, byte count, HTTP status, and platform error symbol. Never record URL, text, title, filenames derived from content, token, base URL, or media.
- Write extension diagnostics to a bounded `share-extension-log.json` in the App Group with coordinated access. The main app drains it into `LogForwarder.shared` on launch and foreground. Do not let both processes mutate the main forwarder's queue file.

**Vocabulary lock-ins.** Target `CallbackBoxShareExtension`; bundle `app.callbackbox.ios.share`; section labels **Send to a chat** and **Save in**; actions **Send** and **Save**.

**First implementation chunk.** Add provider classifier and UI-state reducer tests against fake providers/transports. Then add the target, entitlements, explicit source membership, controller, and SwiftUI surface.

### Track 7 — Contract, issue, and verification closure

**What.** Update the shared contract and issue queue. Verify the server and simulator boundaries. Leave a precise physical-device script.

**Why this needs to change.** The new extension duplicates request shapes in Swift and TypeScript. The current issue still proposes PWA and Shortcuts even though the native app exists.

**Direction.**

- Update `callback-box/docs/mobile-contract.md` with App Group/Keychain storage; the non-batched POST-query shape for `share.destinations`; `share.saveTextual` and `share-id`; direct extension chat sends with `exactSession`; the capture target union; the authenticated status route and durable completion receipt; polling states; sweep/resume/pending behavior; content mapping; auth; and drift behavior.
- Add shared JSON fixtures for destination POST-query responses, textual save inputs/results and `share-id` conflicts, exact-session chat sends, capture target compatibility, active and receipt-backed capture status, stale destinations, malformed values, and legacy capture create requests. Consume them from TypeScript doctests and XCTest.
- Rewrite `issues/features/2026-05-11-ios-share-sheet-capture.md` around the native Share Extension and link this plan.
- Reconcile `issues/features/2026-03-05-share-to-box-images-files.md` as superseded when implementation is complete.
- Close `issues/bugs/2026-07-17-ios-token-plaintext-not-keychain.md` only after migration tests and built-entitlement inspection pass.
- After automated checks pass, set `needs: [manual-testing]` on the share-sheet issue. Only the boxholder removes it after the device script passes.

**First implementation chunk.** Update the contract in the same commits that add each wire shape. Update issue status only after code and automated checks are ready for physical-device testing.

## Could this be simpler?

The smallest plausible feature would accept only URLs, always save one minimal webpage card to Inbox, and copy the token into App Group preferences. It would need no recent-chat query, share landmark role, media staging target, or bundle-safe move.

That version fails the approved job in three ways. It cannot send a URL directly to a known conversation. It cannot file an item into an explicitly chosen landmark. It puts a durable non-expiring token in a broader plaintext container. The destination split, shared Keychain, and server-side allowlists buy correct intent and fail-closed auth under principles 3, 5, 10, and 12.

The next smaller version would support URL/text completely and defer saved media. That avoids the capture target and attachment-safe movement work. It leaves Photos, Voice Memos, and Files with a misleading UI where chat works but Save does not. Because the feature registers those types, consistent destination semantics are worth the extra bounded reuse. Multi-item sharing, background continuation, a full box browser, and a full chat browser do not buy enough for v1 and remain out of scope.

## Failure modes

There is no accepted silent critical gap in the planned paths. Physical extension presentation and host-provider behavior remain manual-test boundaries, but every server-side effect has a deterministic automated contract.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Legacy token cannot be written/read from shared Keychain | New injected-store migration tests | Retain legacy token; do not publish incomplete shared state; show/log failure | Clear; credential is not lost |
| Explicit unpair cannot delete shared Keychain item | New delete-failure test | Retain paired metadata and report failure | Clear; live credential is not orphaned |
| Extension snapshot and Keychain item disagree | New snapshot/credential tests | Show open-and-pair instruction; send nothing | Clear |
| Protected-box authentication is cancelled | New extension-state test | Keep sheet open; allow retry or cancel | Clear |
| A landmark removes `[share]` after the list loads | New stale-destination doctest | Server revalidates and rejects; refresh destinations | Clear |
| A recent chat is archived between list and send | Direct-send and capture exact-target doctests | Reject exact target; refresh; never fall back | Clear |
| URL/text direct send response is lost after acceptance | Existing five-minute `messageId` dedup plus new Swift retry test | Retry with the same UUID only inside the known window; warn after it | Clear; duplicate suppression is time-bounded |
| URL save is retried after commit response is lost and the card moved | New `share-id` replay/conflict doctest across intake/triage moves | Find the moved card by immutable provenance; return it or reject conflicting reuse | Clear and non-duplicating |
| Host provider advertises several types | New precedence tests | Select one deterministic representation | Clear and non-duplicating |
| Provider returns the wrong concrete type or loses its temporary file | New fake-provider tests | Reject mismatch; finish security-scoped copy inside callback | Clear |
| Shared file exceeds 50 MiB | New cap/cap+1 tests | Reject before session creation | Clear |
| Raw upload returns a false or mismatched 2xx body | New exact-response tests | Do not finalize; retain retry/cancel state | Clear; false success is blocked |
| Capture exact chat disappears during preparation | New `failed:target` resume test | Persist failure; do not select another chat | Clear |
| Save target disappears after create | Persisted validated directory plus preparation test | Continue to the already validated directory only if it remains within box; fail on filesystem error | Clear |
| Media save commits and staging cleanup races the status poll | New completion-receipt/status doctest | Receipt is written before cleanup; poll same session ID | Clear and non-duplicating |
| Completion receipts accumulate indefinitely | New age/cap pruning tests | Retain seven days and at most 1,000 newest receipts | Clear and bounded |
| Open share staging reaches the capture abandonment sweep | New enumerator-decision doctest | Delete stale open share staging; never partial-finalize it | Clear; cancelled/abandoned share does not arrive later |
| Inbox intake moves a card but not its attach scope | New bundle movement doctests | Preflight both targets; move/rollback as one logical operation | Clear; operation fails rather than splitting |
| Attach rollback also fails | New injected-filesystem failure test | Throw combined error and log both paths for repair | Clear; manual repair needed |
| Extension is terminated before terminal acceptance | Reducer test plus physical interruption script | No success dismissal; open staging is later deleted, while explicitly finalized work may still complete and leave a receipt | Clear on next attempt; no false success claim |
| Extension diagnostic forwarding is offline | New coordinated-spool/drain tests | Main app drains bounded spool later | Clear in unified log; eventually forwarded |
| App Group entitlement is missing from one target | Build entitlement inspection and device test | Snapshot/Keychain read fails closed with setup message | Clear |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field — ADDRESSED.** URL save calls the existing webpage template. Media save calls existing capture card writers. The extension does not author free-form frontmatter.
- **Stale ref — ADDRESSED.** Bundle-safe movement keeps a card and its `attach/` scope together. Chat URL sends create no ref.
- **Two agents touching the same card — ADDRESSED.** Every share creates a uniquely named card and uses path-scoped commit. A retry finds the card by `share-id` and conflicts rather than overwriting an edited card.
- **Hand-edit drift — ADDRESSED.** Landmark destination selection re-parses and validates cards on each request. Malformed landmarks are reported and omitted.
- **Fabricated free-form value — ADDRESSED.** URL, text, and titles come from the host provider. Fallback title is the URL. The system does not fetch or summarize a page it did not capture.
- **Validation error UX — ADDRESSED.** Provider, auth, stale target, size, upload, card validation, and finalize failures map to distinct extension states.
- **Partial migration / transition state — ADDRESSED.** Legacy paired-box JSON and legacy capture `targetSessionId` remain readable. New writes use Keychain and the discriminated target.

## NOT in scope

- Multiple shared items. V1 accepts one logical item to bound memory, partial failure, and UI complexity.
- Changing the main app's selected box from the Share Extension. The extension's box choice is local to one share action.
- Automatic destination inference. Inbox is the explicit uncertain choice; the extension does not run triage before saving.
- A full landmark/chat picker or search. V1 shows two recent landmark chats and all explicit `[share]` save destinations.
- Creating a new chat from the share sheet. Chat delivery targets only an existing recent session.
- Saving a URL and also sending it to chat in one action. Chat and save destinations are mutually exclusive, so one tap has one durable meaning.
- Page fetching, Defuddle extraction, frozen HTML, or anchored commentary from iOS. A URL save is a minimal `.webpage.card`; Clerk remains the rich page-capture surface.
- Background continuation after extension termination. The dependent create/upload/finalize workflow needs a separate durable background state machine.
- App Intent, Siri, Widget, PWA `share_target`, and Shortcut flows. This work is the native Share Extension only.
- Video-specific activation or transcoding. A host-presented video file can remain a generic file when accepted; no movie-specific pipeline is added.
- Audio transcoding. AAC-family M4A uses transcription; unsupported audio remains a file.
- Changing existing capture fallback behavior. Legacy capture callers keep current resolution; only new exact targets refuse fallback.

## Open design questions

None. The boxholder approved the chat/save split, recent landmark chats, Inbox plus landmark save destinations, `share` as the destination role, direct URL chat delivery without a card, and `.webpage.card` for saved URLs. The approved URL/text slice is implemented; the remaining media and capture work remains intentionally deferred.

## Knowledge audits

The `share` landmark destination and `share-id` provenance are new agent-facing conventions. Add one `knows_directly` audit that asks how to make a directory available as an iOS share-sheet save destination and expects `destinations: [{ for: [share] }]`. Add one contrast case that distinguishes `share`, `commentary`, and `triage`. Add one case that expects an agent to preserve `share-id` when editing or moving a shared card. Run all three against the worktree test box and record their status before completion.

No audit is needed for the Swift extension lifecycle or wire shapes. Box agents do not operate those mechanisms.

## Implementation order

1. Commit Keychain/App Group stores, migration tests, entitlements, and `PairedBoxStore` integration.
2. Commit `share` destination vocabulary, the shared recent-chat selector, `share.destinations`, doctests, and the first mobile-contract fixtures.
3. Commit attachment-safe intake/triage movement and its red-to-green doctests before any media save can land in Inbox.
4. Commit the extracted webpage writer, `share.saveTextual`, idempotency seam, direct chat request fixtures, and Swift contract types.
5. Commit the discriminated capture target, legacy normalization, exact-chat/save preparation branches, completion receipts/status, enumerator decisions, `stored` state, and server doctests.
6. Extract the native provider/image/item helpers. Commit provider classification and share coordinator tests.
7. Commit the Share Extension target, SwiftUI destination UI, shared source membership, lock gate, and diagnostic spool.
8. Update the remaining mobile contract and issue queue. Run focused and broad verification.
9. Cross-model review the complete implementation diff. Address verified findings. Do not merge without explicit boxholder instruction.

## Rollout shape

- Tests land before each implementation seam. Server doctests cover destination listing and native POST-query encoding, recent-chat ordering and canonical membership, textual save idempotency after movement, exact chat send, capture target compatibility, completion receipts/status, every sweep/resume/pending decision, save preparation, and card-bundle movement. XCTest covers credential migration, App Group snapshot reads, provider precedence, tRPC/chat/capture request fixtures, state reduction, retry identity, protected-box gating, and diagnostic spooling.
- Run `pnpm --dir callback-box doc-check`, focused doctests, callback-box typecheck/lint, and the relevant normal pre-commit checks. Run the two new knowledge audits against `~/src/box-worktrees/ios-share-extension-capture/test1`.
- Run `xcodebuild -list`, the focused XCTest target, and a signing-free generic iOS Simulator build. Inspect the built app for `CallbackBoxShareExtension.appex`.
- Inspect the built app and extension entitlements for `group.app.callbackbox.ios`. Inspect the app and extension Keychain access lists if a separate Keychain Sharing entitlement is used.
- Simulator: pair the isolated worktree box, load destination fixtures, send a URL to a recent chat, save a URL to Inbox and a `[share]` landmark, and exercise image/file save states where the simulator host supports them. Simulator results do not close physical share-sheet behavior.
- Physical device, boxholder-owned:
  1. When upgrading from the first Share Extension build, invoke the share sheet once before first launching the updated app and confirm its legacy selected box still loads. Then launch the signed app so paired-box publication runs. Pair two boxes and select one in the main app.
  2. In Safari, share a URL to Callback Box. Confirm the sheet names the main app's selected box. Choose the other box, confirm its destinations load, then reopen the main app and confirm its selection did not change.
  3. Select a recent landmark chat. Confirm the exact URL appears as a user message in that chat and no `.webpage.card` is created.
  4. Share the URL again. Select Inbox. Confirm one minimal `.webpage.card` appears with the correct `source`, title fallback, timestamp, and link body.
  5. Add a landmark with `destinations: [{ for: [share] }]`. Share the URL to it and confirm the card lands directly in that directory.
  6. Share one photo from Photos to Inbox. Run intake/triage and confirm the capture-session card and its `.attach/` scope move together and remain readable.
  7. Share one Voice Memo to a recent landmark chat. Confirm it lands in that exact chat and transcribes when its stream is AAC.
  8. Remove or archive a listed chat before submission and confirm the extension reports a stale target without sending elsewhere.
  9. Repeat one save with a protected box and confirm device-owner authentication appears.
  10. Revoke the paired device and confirm the extension reports auth failure instead of success.
- When automated work is complete, the issue remains open with `needs: [manual-testing]` until the boxholder completes at least steps 2, 3, 5, and 9. Only the boxholder clears that need.
