---
title: "Chat photo batch upload"
status: active
workstream: unknown
issues: []
---
# Chat photo batch upload

> **Superseded on the web (2026-09-06).** Track 2's routing sent every non-image
> — and every over-threshold photo selection — to the full-screen
> `BulkUploadOverlay`, which seals and sends a message of its own. That made it
> impossible to attach a couple of documents to the message you were writing
> (`issues/bugs/2026-09-06-add-files-cannot-attach-a-couple-of-files-inline.md`).
> The web composer now decides a *representation* instead of a destination: a
> few photos inline, everything else uploads and is referenced by `[file#N]` in
> the user's own message. The web overlay and its client
> (`components/bulk-upload/`, `lib/bulk-upload-api.ts`,
> `chat/use-bulk-upload-launch.ts`, `chat/composer-fold.ts`) were deleted with
> that change, so the file references below no longer resolve.
>
> **The bulk pipeline itself is untouched and live**: the routes, the worker,
> the `upload-batch` card, the `<upload>` message and its chat rendering all
> remain, and the native iOS composer still uses them for a camera roll
> (Track 3). Only the web's *entry point* into them is gone. The current
> cross-platform rule is stated in `docs/mobile-contract.md` §8.


Submitting many photos to a box's chat fails today: the composer base64-inlines
every photo into one `/chat/send` request, and at camera-roll scale that payload
is too large to send. This plan routes a photo selection above a small threshold
through the **already-shipped** bulk-upload pipeline (upload the bytes, land an
`upload-batch` card, deliver an `<upload>` message the agent files) instead of
inlining, on both the web composer and — as the deferred Track 3 of
[bulk-file-upload](../implemented-plans/bulk-file-upload.md) — the iOS native
composer.

The driving failure is recorded in
[`issues/bugs/2026-07-30-many-photos-to-chat-fails-ios.md`](../../../issues/closed/bugs/2026-07-30-many-photos-to-chat-fails-ios.md):
the boxholder selected 70+ camera-roll photos in the iOS app and the send failed
client-side with no server-side trace at all.

## Stated preferences this plan trades against

- [`docs/engineering-principles.md`](../engineering-principles.md) — chiefly
  **#3 validate at boundaries** (the `note` is untrusted client prose; the
  threshold decision is a boundary), **#4 resilient AND never silent** (a batch
  that partly fails must be visible to user and agent; a dropped photo is the
  exact bug being fixed), **#6 right-sized defensiveness**, **#8 one way to do
  each thing** (web and iOS must apply the *same* threshold rule, not two
  drifting ones), **#12 the maintainer is usually an agent**.
- [`beebox/CLAUDE.md`](../../CLAUDE.md):101 — *"Read before writing. Don't
  guess file formats, XML structures, or API shapes."* — and its rule that raw
  Fastify routes are for *"file upload/download"*, which is where the bulk
  endpoints already live.
- [`code-style.md`](../../code-style.md) — no default parameters, max 2
  positional params, custom error classes, the `as`-is-`unsafe` rule.
- [`ios-app/CLAUDE.md`](../../../ios-app/CLAUDE.md) — *"do not route ordinary
  composer attachments through capture staging"*, and the bridge-discipline rule
  that *"Native must submit an `Emission` to the visible web session; it must not
  call chat-send APIs behind the webview."* This plan honors both: batched
  photos are **not** an Emission and **not** capture staging — they are the
  third, already-designed thing (`/api/bulk/*`).
- **Shipped precedent: bulk file upload**
  ([`docs/implemented-plans/bulk-file-upload.md`](../implemented-plans/bulk-file-upload.md)),
  whose §4 explicitly reserves this work: *"iOS may later get a dedicated native
  uploader built for robustness at this scale … That work gets its own plan when
  taken up."* This is that plan.
- **Shipped precedent: capture mode** — for the *uploader* discipline
  specifically, since `worktree-fixup-capture` just hardened it (`ac4e12b9`
  *"fix(capture): serialize uploads, stall-based timeouts, unblock Done"*).

## What already exists

Every row here is **reused**; this plan adds one server field and two uploader
clients. Nothing in the bulk pipeline is rebuilt.

- **The entire bulk-upload backend** — `src/webapp/routes/bulk-upload.ts:267`
  `registerBulkUploadRoutes`, five endpoints (create / register items / upload
  item / status / cancel / finalize), streaming writes via
  `src/core/capture/staging-stream.ts` `addFileStreamed`, prepare→deliver worker
  in `src/core/bulk-upload/worker.ts:69`, reconciliation + sweep. **Merged to
  main.** Reused as-is except for the `note` field (Track 1).
- **The documented cross-platform contract** —
  [`docs/mobile-contract.md`](../mobile-contract.md):479 §5.6, which already
  states the endpoints carry *"bearer auth like every other native call, so a
  future native uploader implements exactly these rows"* and lists the native
  caller as `— (deferred; a future native uploader)`. **Reused**; Track 3 fills
  that cell and Track 1 adds one request field to the finalize row.
- **Web bulk uploader** — `src/frontend/src/components/bulk-upload/use-bulk-upload.ts:66`
  `const CONCURRENCY = 3;` plus the bounded queue at `:166`, and the typed API
  client `src/frontend/src/lib/bulk-upload-api.ts` (`createBulkSession`,
  `registerBulkItems`, `uploadBulkItem`, `finalizeBulkSession`,
  `cancelBulkSession`). **Reused wholesale by Track 2** — the composer hands it a
  file list instead of the overlay's picker doing so.
- **`BulkUploadOverlay`** — `src/frontend/src/components/bulk-upload/BulkUploadOverlay.tsx`,
  per-item state list + retry-failed + Done. **Reused by Track 2** as the
  progress affordance, opened with a pre-seeded selection rather than an empty
  picker.
- **The composer's inline photo path** —
  `src/frontend/src/components/chat/InteractiveChat-attachments.ts:122`
  `addImageFiles`, which calls `processImageBlob` per file and pushes
  `dataBase64` into the emission store. **Kept unchanged for ≤4 photos**; Track 2
  adds the branch in front of it.
- **iOS `chat/upload-file` client** — `BeeBox/Services/ChatAPI.swift:171`,
  proof the native side already speaks a raw-Fastify upload route with
  `applyAuth(to:)` bearer headers. **Reused as the auth/request idiom** for the
  new coordinator, NOT as the transport (it builds a whole multipart body in
  memory: `request.httpBody = body`, exactly what must not happen at 70 photos).
- **iOS capture upload coordinator** —
  `BeeBox/Services/CaptureUploadCoordinator.swift`, background `URLSession`
  upload tasks with per-item retry. **Reused as the structural model, not
  extended** — per `ios-app/CLAUDE.md` composer attachments must not go through
  capture staging, and the bulk plan §4 explicitly chose a *dedicated* uploader
  over a parameterized capture coordinator.
- **The failure the briefing attributed to this work is already fixed
  elsewhere.** `worktree-fixup-capture` landed `ac4e12b9` *"fix(capture):
  serialize uploads, stall-based timeouts, unblock Done"* and `d477aa24`
  *"fix(capture): synchronous seal barrier, sticky iOS skip, per-lane progress"*,
  **both merged to main**. This plan does not touch capture's uploader.

### What does *not* exist and must be built

- Any native client of `/api/bulk/*` (the contract's own anchor table says so).
- Any way for a batch to carry the user's introductory text — finalize's body is
  `{ failedItems?: [...] }` and nothing else (`docs/mobile-contract.md`:512).
- Any threshold: both composers inline unconditionally.

## Prior art (external)

- **`PhotosPickerItem` at scale must load a *file* representation, not `Data`.**
  Loading as `Data` keeps the whole image in memory; for larger media the file
  representation is preferred, and the received URL must be copied to app-owned
  storage immediately because the transfer URL is temporary —
  [PhotosPicker In Production](https://www.theswift.dev/posts/photospicker-production-swiftui/),
  [WWDC22 "What's new in the Photos picker"](https://developer.apple.com/videos/play/wwdc2022/10023/).
  **Load-bearing:** today's `NativeComposerView.swift:715`
  `item.loadTransferable(type: Data.self)` is exactly the anti-pattern, and at 70
  photos it is a second, independent memory failure sitting behind the payload
  one. Track 3 must use a file representation.
- **Background `URLSession` upload bodies must be file-backed**
  (`uploadTask(with:fromFile:)`); durability covers only *already-created* tasks,
  and a force-quit cancels them —
  [Apple background-session docs](https://developer.apple.com/documentation/foundation/urlsessionconfiguration/background(withidentifier:)),
  [Apple dev forums](https://developer.apple.com/forums/thread/756333).
  Consequence: create the upload task per item as early as possible, and treat
  force-quit-mid-batch as a resume case, not a durability guarantee.
- **No documented hard size limit for a `WKScriptMessage` body.** A search for a
  published cap turns up only adjacent issues — a WebSocket receive regression in
  iOS 15 betas ([forum thread](https://developer.apple.com/forums/thread/684845))
  and `WKScriptMessageHandler` crash/leak reports
  ([WebKit 222336](https://bugs.webkit.org/show_bug.cgi?id=222336),
  [iOS 26.2 crash thread](https://developer.apple.com/forums/thread/810852)) —
  none of which document a body-size ceiling. **This is itself the finding:** the
  bridge failure is memory pressure, not a documented threshold, so the design
  must not try to discover the "real" limit empirically and inline just under it.
  Keeping the inline payload categorically small is the only sound posture.
- **No external prior art needed for the batch/notification mechanism** — the
  internal precedent (bulk-upload, itself modeled on capture mode) governs, and
  the parent plan already recorded its own external search.

## Tracks / scope

Ordered by implementation dependency: the server field unblocks both uploaders;
the web uploader is headlessly testable and exercises the contract before the
Swift client depends on it; iOS last; docs/audits last.

### Track 1 — `note` on finalize (server)

**What.** `POST /api/bulk/sessions/:id/finalize` gains an optional `note` — the
user's composer text at the moment the batch was submitted — which rides into
the `upload-batch` card's frontmatter and the `<upload>` message body.

**Why this needs to change.** The bulk pipeline's own filing instructions say
(`src/schemas/upload-batch.tsx:133`): *"If the batch arrived without
introduction, ask first — don't file."* Routing composer photos to a batch would
make **every** photo batch unintroduced by construction — the user typed
"receipts from the Tokyo trip" into the composer and the pipeline would throw it
away, then the agent would dutifully ask what the files are. That converts a
working interaction into an interrogation. The text must ride with the batch.

**Direction.**

- `FinalizeBodySchema` (`src/webapp/routes/bulk-upload.ts`) gains
  `note: z.string().max(10_000).optional()`. Untrusted client prose validated at
  the boundary (principle #3); the cap is well under any body limit and far above
  any real composer message.
- Whitespace-only normalizes to absent at the route boundary, so an empty
  composer produces byte-identical output to today.
- `StagingSessionSchema` (`src/core/capture/staging-schema.ts:119`) gains
  `note: z.string().optional()`, and `sealStagingSession`
  (`src/core/capture/staging-store.ts:360`) writes it **in the same CAS write as
  `failedItems`** — the existing comment at `:357` states the reason verbatim:
  *"`failedItems` (bulk only) is persisted IN the same CAS write, so the seal and
  [the report] …"*. A note recorded outside the seal could be lost by a resume
  that rebuilds the batch.
- `upload-batch` schema gains a `note: z.string().optional()` frontmatter field
  (both `uploadBatchFields` and `UploadBatchObject`), plus a line in
  `instructions` and a matching change to duty #1 so the agent knows the note
  *is* the introduction.
- `createUploadBatchTemplate` gains `note?`; `prepareBulkBatch` reads
  `session.note` and passes it through; `PreparedBulkBatch` gains `note`;
  `recoverSummaryFromCard` reads it back so an idempotent re-run reproduces the
  same wrapper.
- `buildUploadWrapper` gains `note?`, rendered in the **body**, above the
  summary, separated by a blank line.

**Vocabulary lock-ins.** The `<upload>` wrapper with a note:

```
<upload doc="<contextDir>/tmp-upload/<batch>/Batch.upload-batch.card" files="34" bytes="112 MB">
Receipts from the Tokyo trip

34 files uploaded (112 MB).
</upload>
```

A batch with no note renders **byte-identical to today** — that is the
compatibility property the existing exact-match doctests already pin, and the
new doctest asserts it explicitly. The note is body text, never an attribute:
free-form user prose containing quotes or newlines would break attribute parsing,
which `buildUploadWrapper`'s existing `invariant` at `deliver.ts:47` guards
against for `doc` precisely because that guard can't be extended to arbitrary
prose.

**First implementation chunk.** Schema + `sealStagingSession` + route field +
`buildUploadWrapper` + card template, with doctests: `buildUploadWrapper` exact
with and without a note, and a route-tier finalize test asserting the note
survives seal → prepare → wrapper.

### Track 2 — Web composer threshold

**What.** When a photo selection would push the composer above 4 inline photos,
route that selection to a bulk batch (with the composer text as the note)
instead of inlining it.

**Why this needs to change.** `src/frontend/src/lib/image-paste.ts:21`
`const MAX_DIMENSION = 1920;` — the web composer downscales to the same
dimension the iOS one does, so at JPEG q≈0.85 it produces the same ~400–700 KB
per photo, and base64 adds a third. The server's `bodyLimit` is 50 MB
(`src/webapp/server.ts:89`). The web composer has the identical cliff; a
mobile-browser user hits it the same way. Fixing only iOS would leave two
different rules on two surfaces, violating principle #8.

**Direction.**

- A shared constant + predicate, `INLINE_PHOTO_LIMIT = 4` and
  `shouldBatchPhotos({ existingInline, incoming })`, living in one module so the
  rule is stated once and the mobile-contract doc can cite it. iOS mirrors the
  constant (it cannot import it) — the contract doc is what keeps them honest.
- **The rule:** route the *new selection* to a batch when
  `existingInline + incoming > 4`. Already-inline photos stay inline and go out
  with the user's next normal send. Consequence: the inline count can never
  exceed 4, so inline payload is bounded by construction regardless of how many
  selections a user makes.
- `addImageFiles` (`InteractiveChat-attachments.ts:122`) gains the branch in
  front of its existing body. The inline path below the threshold is untouched.
- Above it: open `BulkUploadOverlay` pre-seeded with the picked files, take the
  composer text as the note, clear the composer text on successful finalize (the
  text was consumed, exactly as a normal send consumes it).
- Applies to paste and drop as well as the picker — one rule, one predicate, no
  per-entry-point special cases.

**Vocabulary lock-ins.** `INLINE_PHOTO_LIMIT = 4` — "4 photos inline, 5+ batched"
is a user-visible behavioral contract and gets a row in
`docs/mobile-contract.md`.

**First implementation chunk.** The predicate + its doctest, then the
`addImageFiles` branch wired to the existing overlay, exercised via `bin/browse`.

### Track 3 — iOS native bulk uploader

**What.** A dedicated `BulkUploadCoordinator` speaking `/api/bulk/*` over a
background `URLSession`, plus the same threshold branch in the native composer.

**Why this needs to change.** This is the reported bug.
`NativeComposerView.swift:710` `loadPhotos(from:)` loads every picked item as
in-memory `Data`, encodes it (`ComposerImageEncoder.encode`,
`NativeComposerView.swift:932`, `maximumDimension: CGFloat = 1_920`,
`jpegData(compressionQuality: 0.85)`), and appends it to the draft as base64.
Those base64 blobs then cross the WKWebView script-message bridge as one JSON
string (`NativeEmissionV2.images`, `NativeComposerContract.swift:35`) before the
web layer POSTs them to `/chat/send`. At 70 photos that is roughly 40–65 MB in a
single bridge message and a single POST — past the 50 MB `bodyLimit` and past
what the bridge will carry. The observed evidence matches exactly: a client-side
`[chat] send failed` with **zero** server-side trace, because the request never
left the device.

**Direction.**

- **`BulkUploadCoordinator.swift`** — create batch → register items → per-item
  upload → finalize, mirroring the web client's call sequence so both uploaders
  exercise one contract.
  - Concurrency **3**, matching `use-bulk-upload.ts:66`. The server 409s above 8
    concurrent streams per session (`docs/mobile-contract.md`:506), so 3 leaves
    headroom; a `409 "Too many concurrent uploads"` requeues rather than failing
    the item.
  - Background `URLSession` with `uploadTask(with:fromFile:)` — **never**
    `httpBody`, per the Apple guidance above and unlike
    `ChatAPI.uploadFileRequest`.
  - Per-item retry with backoff; an item that exhausts retries is reported in
    `failedItems` at finalize rather than silently dropped (principle #4). A
    batch where *every* item fails still finalizes, so the user sees the failure
    in chat instead of nothing.
- **Photo import must use a file representation, not `Data`** — copy each picked
  item to app-owned storage and hand the file URL to the upload task. This is the
  prior-art finding above and is what makes 70 photos survive import at all.
- **Composer branch** — `loadPhotos(from:)` applies the same
  `existingInline + incoming > 4` rule; above it, photos never enter
  `draftStore`, never become an emission, and never cross the bridge. Below it,
  today's path is untouched.
- **The note** — the composer text at batch start is sent as `note` on finalize
  and cleared on success.
- **Progress + resume** — a composer status row showing uploaded/total and a
  failed count. `resume()` reconciles against `GET /api/bulk/sessions/:id` (which
  reports `registered` vs `received`) and re-uploads only what is missing.

  **Shipped narrower than this reads, recorded honestly:** uploads go through
  `URLSession.shared` rather than a background session, and no durable local
  batch record is written, so `resume()` covers in-session retry only — a
  force-quit mid-batch strands an open batch server-side with no relaunch
  reconciliation. Making that genuinely durable needs a background
  `URLSession` plus a persisted manifest (the shape capture's
  `CaptureStore`/`CaptureUploadCoordinator` already has), which is its own piece
  of work. Flagged by the Codex review; the parity matrix says the same.

**Vocabulary lock-ins.** None new — Track 3 implements the existing contract.
The mobile-contract §5.6 anchor table's `native caller` cell changes from
`— (deferred…)` to the coordinator's path.

**First implementation chunk.** The coordinator plus XCTest coverage of request
shaping (URL, headers, auth) and the bounded queue's retry/requeue behavior,
against a stubbed transport — the same testing seam `ChatAPITests.swift:13`
already uses. The composer branch follows once the coordinator is green.

## Subplans

None. Track 3 is the subplan the parent plan reserved
(`bulk-file-upload.md` §4: *"That work gets its own plan when taken up"*), and its
scope is bounded by an already-shipped, already-documented server contract — the
usual reason to split (undecided vocabulary or shape) does not apply.

## Failure modes

**Revised after a cross-model (Codex) review, 2026-07-30.** The first version of
this table missed a whole class of row: it reasoned about each step *failing*,
but not about a step *appearing to succeed*. `finalize` returns on the seal and
runs prepare→deliver in the background, so both clients treated "accepted" as
"delivered" and destroyed their recovery state on it. Rows for that and the other
findings are marked **[review]**. The generalizable lesson: when a pipeline has an
async tail, "what does the client believe at each point, and what does it throw
away on that belief?" is its own failure-mode axis, and it needs walking
deliberately rather than falling out of per-step reasoning.

No critical gaps: every row below has either a test or explicit handling, and
none fail silently. The two that would have been critical — a dropped photo and a
lost note — are handled by the server-side item registry and by putting the note
inside the CAS seal respectively.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A photo's upload fails after retries | Track 3 XCTest (retry/requeue) | Reported in `failedItems` at finalize; server also lists it as missing via the registry | Clear: named in the `<upload>` message's `failed` count and the card's `failed` list |
| Every photo fails (offline mid-batch) | Track 3 XCTest | Batch still finalizes; user sees a failure message in chat | Clear — the current bug's whole problem is that nothing appears |
| **[review]** Finalize succeeds, prepare/deliver then fails | route + coordinator tests | Clients poll `GET /sessions/:id` to a terminal state; composer text + staged files released only on delivery | Clear: failure surfaced with everything kept, batch retryable |
| **[review]** User types during a long batch | XCTest (composer lock) | Batch participates in `isSending`; the clear is conditional on the text being unchanged | Clear: composer locked, later text never clobbered |
| **[review]** A photo fails to import (iCloud) before any upload | XCTest | Reported to finalize as a `failedItem` | Clear: named in the card + `<upload>` message |
| **[review]** Two fast pastes race the inline bound | threshold doctest | `pendingImages` counted alongside finished images | Clear: bound holds under the race |
| **[review]** Threshold crossed with photos already inline | fold-in path on both surfaces | Existing composer photos join the same batch | Clear: one act, one destination, the text describes all of it |
| **[review]** Cancel races the worker after the seal | route doctest | 409 past the seal, checked+deleted under the staging lock; clients disable cancel while finalizing | Clear: refused, never silently raced |
| **[review]** Two registry items share a name, one fails | prepare doctest | Failures keyed by id when known, name only as fallback | Clear: `registered` reconciles with received+failed+missing |
| **[review]** Batch registers items, finalizes before any bytes commit | worker check | `expectedItems` counts toward non-emptiness | Clear: all-missing card delivered, not silently deleted |
| App force-quit mid-batch | XCTest covers `resume()` itself | **Partial** — `resume()` works but nothing calls it after a cold start, and uploads use `URLSession.shared`, so the batch is NOT durable across a relaunch | Clear-ish: an open batch is stranded server-side until the abandonment sweep; **known gap, recorded in the parity matrix** |
| Note lost by a crash between finalize and prepare | Track 1 route doctest | Note rides IN the CAS seal with `failedItems` (`staging-store.ts:360`) | Clear: a resume rebuilds the same batch with the same note |
| Note contains quotes/newlines/markup | Track 1 doctest (exact) | Rendered as wrapper **body**, never an attribute | Clear: cannot break wrapper parsing by construction |
| Note exceeds the cap | Track 1 route doctest | 400 at the boundary (`z.string().max(10_000)`) | Clear: 400 with the validation error |
| Threshold drifts between web and iOS | Track 2 predicate doctest | Single predicate on web; contract doc row is the cross-surface anchor; parity matrix records both | Clear at review time; **accepted risk** — no compile-time link is possible across the language boundary |
| User picks 5+ photos with an empty composer | Track 2 `bin/browse`; device check | Batch delivers with no note → the agent's existing "ask first" duty fires, as designed | Clear: the agent asks what the files are |
| Target chat gone at delivery | existing (bulk worker doctest) | `BulkTargetGoneError`; batch left retryable, no most-active fallback (`deliver.ts:17`) | Clear: logged, nothing misdirected |
| Batch exceeds 1 GiB / 500 items | existing (`staging-limits`) | 413 / 400 | Clear: item error surfaced in the progress UI |
| Photo import runs the device out of memory | Track 3 device verification only | File representation + copy-to-storage instead of in-memory `Data` | Clear: import failure per item, not a crash — **but only device testing confirms this** |
| Concurrent-stream 409 from the server | Track 3 XCTest | Requeue with backoff (concurrency 3 vs the server's cap of 8) | Clear: transparent retry |
| A note is sent but the batch has zero received files | Track 1 doctest | Existing worker path cleans up a wholly-empty batch (`worker.ts:92`) — with a note present the batch is still worth delivering, so the emptiness check must account for it | Clear once handled; **called out as an implementation detail Track 1 must not miss** |

## Agent-flow / user-flow edge cases

- **Wrong tag** (`<upload>` vs `<capture>` vs inline `[imageN]`) — **ADDRESSED.**
  All three are server- or client-generated, never authored by the agent, and are
  documented side by side in `CHAT_SYSTEM_PROMPT`. The new note lives inside the
  existing `<upload>` body; no new tag.
- **Stale ref** (batch card gone when the agent reads it) — **ADDRESSED** by the
  existing instruction (`upload-batch.tsx:151`): a batch found missing *"was
  already filed: that's done, not an error — no error theater."* Unchanged.
- **Two agents touching the batch** — **ADDRESSED**, unchanged: the sweep only
  notifies and never mutates; filing is chat-agent-only.
- **Hand-edit drift** — **ADDRESSED**, unchanged: instructions say trust the
  directory listing over the manifest.
- **Fabricated free-form value** — **ADDRESSED, and improved.** The note is
  *verbatim user text*, not an agent- or client-invented description, and the card
  labels it as such alongside the existing server-computed/client-claimed
  distinction (`upload-batch.tsx:123`). It makes honesty easier: the agent no
  longer has to guess what a batch is for.
- **Validation error UX** — **ADDRESSED.** The one new validation (note length)
  is a 400 to the uploader, surfaced in the progress UI, never in agent context.
- **Partial migration / transition state** — **ADDRESSED.** `note` is optional
  everywhere: existing staging manifests, existing `upload-batch` cards, and an
  older client that never sends one all parse unchanged, and a note-less wrapper
  is byte-identical to today's. No data migration.
- **A user on an old iOS build against a new box** — **ADDRESSED.** The old build
  keeps inlining, which works fine at ≤4 photos and fails at 70 exactly as it does
  today; the server change is purely additive. The reverse (new build, old box)
  cannot occur — a box without `/api/bulk/*` predates the merged feature.

## NOT in scope

- **Per-item byte progress.** Item-state granularity only, matching the parent
  plan's v1 decision; `fetch` can't report upload progress and the native side
  would then differ from web.
- **Raising the 1 GiB / 500-item batch caps.** 70 photos is comfortably inside
  both; changing caps is a separate question.
- **Android.** No shell exists; the contract rows keep it implementable.
- **Share-sheet intake.** Separately tracked
  ([`issues/features/2026-03-05-share-to-box-images-files.md`](../../../issues/closed/features/2026-03-05-share-to-box-images-files.md)).
- **Touching capture's uploader.** Already fixed on main by
  `worktree-fixup-capture` (`ac4e12b9`, `d477aa24`); re-doing it here would
  collide.
- **Changing the single-file `chat/upload-file` attach flow.** Untouched; the
  `[fileN]` path is a sibling, not a competitor.
- **Folding already-inline photos into a triggered batch.** The chosen rule
  leaves them inline and bounds the inline count at 4 anyway; re-encoding
  already-encoded draft images to fold them in adds a codepath for a rare case.
- **A user-facing "send these inline anyway" override.** The threshold is
  automatic. If it proves wrong in practice that's a follow-up issue, not a v1
  setting — and a setting would need to exist identically on both surfaces.
- **Video.** The picker is `matching: .images`
  (`ComposerActionsView.swift:46`); widening it is a separate decision.

## Open design questions

- **None blocking.** The two that were open — the threshold value and how the
  composer text survives — were settled by the boxholder (2026-07-30): inline up
  to 4 photos, batch at 5+; and the composer text rides as an optional `note` on
  finalize rather than being posted as a separate preceding message.
- **Non-blocking, revisit after device testing:** whether 4 is the right number
  in practice. It is one constant in one predicate plus one mirrored Swift
  constant, and the contract doc names both — cheap to move once real use says so.
  Nothing in the design depends on the specific value.

## Knowledge audits

The agent-facing surface change is small but real: the `<upload>` message can now
carry an introduction, and duty #1 ("ask first if unintroduced") must not fire
when a note is present. That is exactly the kind of conditional rule an agent
silently forgets after compaction.

- Extend the existing `upload-message-meaning` entry (already in
  `src/dev/knowledge-audits.yaml` under `=== Bulk file upload ===`, per
  `bulk-file-upload.md` §Knowledge audits) so it covers the note case: an
  `<upload>` whose body carries the user's own introduction should be **filed
  against that introduction**, not met with "what are these files?"
- No new entry for the threshold itself — it is a client-side UX rule with no
  agent-facing vocabulary; the agent sees an `<upload>` message either way.
  Skip-with-rationale, deliberately.

Audits land **run**, per the skill's rule and the parent plan's precedent:
`pnpm knowledge-audit run --box <absolute path to a test box> --filter upload-message-meaning`,
with the result recorded in the yaml's status comment before the plan completes.
(Note the `--box` hazard: it resolves as a path, so pass an absolute path outside
the monorepo.)

## Implementation order

1. **Track 1** — `note` end to end (staging schema → seal → route → prepare →
   card → wrapper), with doctests. Unblocks both uploaders.
2. **Track 2** — the shared predicate + its doctest, then the web composer branch
   wired to `BulkUploadOverlay`; verify via `bin/browse`. Exercises the Track 1
   contract from a real client before Swift depends on it.
3. **Track 3** — `BulkUploadCoordinator` + XCTest, then the native composer
   branch, progress row, and resume. Depends on Tracks 1 and 2.
4. **Track 4** — `docs/mobile-contract.md` §5.6 (the `note` field, the native
   caller anchor, a threshold row), `docs/mobile-parity.md`, and the
   knowledge-audit extension, run.

Dependencies: 2 and 3 both need 1; 3 benefits from 2 having proven the contract;
4 last. Per `docs/mobile-contract.md`'s pre-commit tripwire, contract edits land
**in the same commit** as the surface they describe, so Track 4's contract rows
actually land with Tracks 1 and 3 — item 4 above is the parity matrix and audits.

## Rollout shape

- **Tests first, as a design tool.** Each substantial codepath names its test up
  front: `buildUploadWrapper` doctested **exact** with and without a note (the
  vocabulary lock-in, and the no-note byte-identity property); a route-tier
  finalize doctest for note validation, seal persistence, and the note-with-zero-
  files case; a pure doctest for `shouldBatchPhotos` covering the boundary at
  exactly 4 and 5 and the `existingInline` interaction; XCTest for the
  coordinator's request shaping and its retry/requeue on 409. The
  Failure-modes table's "Test exists?" column is the checklist.
- **Done-when, as assertions:** a 70-item batch registers 70, uploads 70, and
  finalizes with `received: 70, missing: 0, failed: 0`; the `<upload>` message
  carries the composer text; a note-less batch's wrapper is byte-identical to
  the pre-change output.
- **No data migration.** Every new field is optional with a compatible default;
  existing staging manifests and `upload-batch` cards parse unchanged.
- **Device verification is mandatory and is the real gate.** Headless cannot
  emulate the two failures this fixes (WKWebView memory pressure and iOS photo
  import at scale), so the issue gets `needs: [manual-testing]` until the
  boxholder confirms on a real phone: select 70+ camera-roll photos → they upload
  with visible progress → the chat receives one `<upload>` message carrying the
  typed text → the batch card lists 70 received and none missing. Per
  `ios-app/CLAUDE.md`, a simulator-only pass **must not** be described as device
  verification.
- **Ships as one unit** from this worktree when the boxholder says so; commits
  land per-chunk inside the worktree.
