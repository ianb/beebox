---
title: "Chat images: keep the original as a file the agent can use"
status: active
workstream: chat-image-files
issues:
  - ../../../issues/features/2026-09-16-uploaded-chat-images-have-no-file-the-agent-can-use.md
---
# Chat images: keep the original as a file the agent can use

When I paste a screenshot or photograph a receipt into chat, I want the agent
to see it at once (as today) and also be able to crop, OCR, attach, or move
it, so the image is not "visible and untouchable." Concretely: a receipt
photo the agent should file into an expense card; a screenshot the agent
should crop and annotate; a document photo the agent should hand to an OCR
API. On iOS today none of these work because the only bytes that exist are
a downscaled base64 copy inside the transcript.

**Issues addressed:**
`issues/features/2026-09-16-uploaded-chat-images-have-no-file-the-agent-can-use.md`
(this plan). Related, not resolved here:
`issues/bugs/2026-09-05-codex-image-viewing-tool-unsupported.md` (Codex's
`view_image` could read the path this plan produces; noted in NOT in scope).
Searched the queue for `paste`, `screenshot`, `image` × `chat`, `upload`,
`_tmp`: no duplicate of this plan's problem.

## Smallest fix and budget

**Smallest fix:** on the web composer only, upload each inline photo's
original `File` through the existing `POST /api/chat/upload-file` route in
addition to inlining it, and add an `[image#N]: _tmp/...` line to the
message's existing `<attachments>` block. One prompt sentence. No server
changes except teaching the shared `[image#N]` expander to leave the
attachments block alone. Roughly 150 source lines.

**Chosen design** is that smallest fix plus the iOS mirror, because the
boxholder says iOS is where the problem bites ("it's actively an issue more
on ios"). The native composer already has an upload state machine for files
(`ios-app/BeeBox/Models/ComposerDraft.swift`, `DraftTransferState`) that
the image path reuses.

| Track | Source | Tests |
|---|---|---|
| 0. Upload route returns the path that exists (`_tmp/`, not `tmp/`) | ~5 | ~10 |
| 1. Shared token expander skips `<attachments>` | ~30 | ~40 (doctest) |
| 2. Web composer: upload originals, wire `path`, assemble the line, chips | ~180 | ~80 (doctest) |
| 3. Agent-facing prompt + contract doc | ~15 | 0 |
| 4. iOS composer: upload originals, `path` on the emission image | ~150 (Swift) | ~40 (fixtures + Swift test) |

About 380 source lines and 170 test lines, plus this plan and the contract
doc edit. Not a BIG CHANGE.

## Stated preferences this plan trades against

- **`beebox/docs/engineering-principles.md` #8 (one pipeline):** every image
  entry point (picker, paste, drop, screenshot) already funnels through
  `routeAddedFiles` (`src/frontend/src/components/chat/file-routing.ts:1-8`:
  *"Every entry point routes through here: the picker, paste, drop, and the
  screenshot grab."*). This plan adds the upload inside that one funnel, so
  screenshots get it for free. The trade: a screenshot original is uploaded
  even though it is already lossless PNG when it fits in 1920px. Accepted,
  for one rule.
- **Memory `feedback_arrange_context_not_automate_judgment`** and the
  prompt's existing `_tmp/` rule (`src/core/chat/session/prompts.ts:78`:
  *"`_tmp/` is not storage ... Once you've used a file, decide: a keeper goes
  into the box"*). The ephemera-or-content question is answered by keeping
  the file ephemeral and leaving promotion to the agent in conversation.
  This plan does NOT make images cards (direction C in the issue).
- **`feedback_bias_toward_strict`:** an image whose original failed to upload
  still sends. The pixels are the primary payload and a failed bonus must not
  block a message. Strictness is preserved by making the absence explicit
  (no `[image#N]:` line means no original) and by the prompt saying so, so
  the agent never assumes a file exists.
- **Cost:** one original upload per inline photo, bounded by
  `INLINE_PHOTO_LIMIT = 3` (`file-routing.ts:53`). The fourth photo already
  pays this (`file-routing.ts:33-37`: *"photos over the inline limit ...
  Uploaded to the box ahead of the send"*). The boxholder accepted this
  trade (2026-09-16: "OK, A on web and ios").

## What already exists

Reused, all of it. Nothing new is invented except the `[image#N]:` line.

- **Upload route** `src/webapp/routes/chat-uploads.ts:50-90`: writes
  `<boxRoot>/_tmp/<iso>_<sanitizedName>` and returns `{ path, originalName,
  size, mimetype }`. Unchanged. The client helper is `uploadChatFile` in
  `src/frontend/src/lib/file-upload.ts`.
- **Sweep** `src/core/housekeeping.ts:15-25` (`cleanupOldTmpUploads`,
  `EXPIRY_DAYS = 7`). Unchanged.
- **Upload state machine (web)** `src/frontend/src/components/chat/composer-file-uploads.ts`:
  `runUpload` with the identity check against a re-minted id
  (`composer-file-uploads.ts:47-56`), `awaitPendingUploads`, retry. Reused
  by generalizing over the item kind (image or file), see Track 2.
- **`FileTransferState`** `src/frontend/src/input/emission-store.ts:57-60`:
  `uploading | uploaded{path} | failed{message}`. Reused verbatim as the
  image's `original` state.
- **Attachments block** `src/frontend/src/input/targets/chat-assemble.ts:135-141`
  builds `<attachments>\n[file#N]: path\n</attachments>`. Extended with image
  lines.
- **Display stripping** `src/frontend/src/components/chat/message-parsing.ts:56`
  removes the whole `<attachments>` block, and `extractFileAttachments`
  (`message-parsing.ts:82-98`) only matches file lines, so image lines
  produce no stray chip. Unchanged.
- **Prompt section** `src/core/chat/session/prompts.ts:66-78` "Attachments".
  Extended.
- **Native emission parse** `src/frontend/src/components/chat/native-emission.ts:148-158`
  (`parseNativeImage`). Extended with optional `path`.
- **Downscale pipeline** `src/frontend/src/lib/image-paste.ts:129-160`
  (`processImageBlob`, `MAX_DIMENSION = 1920`). Unchanged; it stays the inline
  representation.
- **Audio precedent, rejected:** `bbx chat get-last-audio` fetches from a
  connected tab (`src/webapp/routes/chat-last-audio-routes.ts:1-30`) and
  web recordings are additionally staged on the box
  (`src/core/voice-recording/staged-audio.ts:1-6`). A tab-fetch design for
  images was considered and rejected: the browser holds no original after
  send, the retention store is memory-only with capacity 5
  (`src/frontend/src/input/retention.ts:24-26`), and headless runs get
  nothing. Decision recorded 2026-09-16.

## Prior art (external)

- **Claude Code regression** anthropics/claude-code#57623: pasted images
  stopped exposing a filesystem path; earlier versions wrote the image to a
  session temp dir and exposed the path, and `Read`, PIL, and `curl -F`
  worked. In the broken state `Read` returned a downscaled thumbnail. Bears
  on this plan twice: persist-on-arrival is a shipped, working shape, and
  the file must be the ORIGINAL bytes. Verified premise for this design:
  our originals never reach the server today (`image-paste.ts:4-6`:
  *"Images get downscaled client-side before being encoded as base64"*), so
  persistence must happen from the client's `File`, not server-side.
- No other external premise. The multipart upload and `_tmp/` sweep are
  in-repo mechanisms.

## Tracks / scope

### Track 0. The upload route returns a path that exists

**What.** `POST /api/chat/upload-file` writes to `<boxRoot>/_tmp/`
(`src/webapp/routes/chat-uploads.ts:57` via `ensureBoxTmpDir`;
`src/lib/box-layout-spec.ts:246-252` maps the `tmp` key to `_tmp`) but
returns `path: \`tmp/${filename}\`` (`chat-uploads.ts:77`). No `tmp/` alias
exists in a box (checked the test box: only `_tmp/`). The prompt tells the
agent the file is under `_tmp/` (`prompts.ts:68-72`) and the contract doc
says `_tmp/` (`docs/mobile-contract.md:880-881`), so every `[file#N]` line
today names a file that is not there. Found by the cross-model plan review;
it is the same incident as this plan (a path the agent can Read), so it is
fixed here rather than filed.

**Direction.** Return `_tmp/${filename}`. Update the comment in
`message-parsing.ts:69` and the iOS tests that pin `tmp/...`
(`ios-app/BeeBoxTests/ChatAPITests.swift:23-38`,
`ComposerDraftTests.swift:913-923`). iOS treats the value as an opaque token
(`mobile-contract.md:18-21`), so no Swift logic changes. Old messages keep
their `tmp/` lines; the sweep has removed most of those files anyway, and
the prompt already says `_tmp/` is swept. The frontend `TMP_FILENAME_PREFIX_RE`
that derives a chip's display name must accept both prefixes; the doctest
pins that.

**First chunk.** The route line, a route test in `test/webapp/` asserting
the returned path resolves to an existing file under the box root, the
regex, and the iOS test strings.

### Track 1. The `[image#N]` expander leaves the `<attachments>` block alone

**What.** `buildChatContentBlocks` (`src/shared/chat-content-blocks.ts:72-110`)
replaces EVERY `[image#N]` match in the text with an image block, and
`accepted-messages.ts:187` strips every match for the bus copy. An
`[image#1]: _tmp/x.png` line inside `<attachments>` would therefore splice a
second copy of the image into the block on the server, and the client's
optimistic copy would do the same. The bus copy matters for a different
reason: `mergeAcceptedIntoPending` (`src/frontend/src/machines/chat-shared.ts:104-112`)
dedupes an accepted bus row against the optimistic copy by comparing
`entryText`, so if the bus copy strips the token inside the block and the
optimistic copy keeps it, the texts differ and the message renders twice.
(Display is not the problem: `stripUserDisplayTags` removes the whole block,
`message-parsing.ts:56`.)

**Why this needs to change.** Without it Track 2's line cannot use the same
token vocabulary as file lines, and a second token form for the same
attachment is exactly the "two tiers" smell
(`feedback_minimal_concepts_prefer_primitives`).

**Direction.** In `src/shared/composer-tokens.ts` add one pure helper:

```ts
/** Index where the message's trailing `<attachments>` block starts, or `text.length`. */
export function attachmentsBlockStart(text: string): number
```

It finds the LAST `<attachments>` opening tag whose block runs to the end of
the text (the assembler always appends the block last,
`chat-assemble.ts:135-141`). `buildChatContentBlocks` runs its token regex
only over `text.slice(0, start)` and carries the remainder as literal text.
`accepted-messages.ts` uses the same helper so its bus copy strips the same
tokens. Both callers of `buildChatContentBlocks` (server
`messages.ts:300-318`, client `machines/chat-shared.ts:31-41`) inherit it.

**Vocabulary lock-ins.** None new. `[image#N]` keeps its meaning.

**First chunk.** The helper, the expander change, the strip change, and a
doctest in `test/shared/composer-tokens.doctest.md` plus a case in the
content-blocks coverage of `test/core/chat-session.doctest.md`: a message
with `[image#1]` in the body and `[image#1]: _tmp/a.png` in the block yields
one image block and the block text intact; the bus copy strips only the body
token.

### Track 2. Web composer uploads the original alongside the inline copy

**What.** Each photo routed `inline` also uploads its original `File`. The
`ImageItem` carries the upload's state; the emission's image carries the
landed `path`; assembly writes `[image#N]: <path>` into the attachments
block; a send waits for in-flight image uploads like it waits for files.

**Why this needs to change.** The original bytes exist only as the `File`
in the composer at routing time. Nowhere else.

**Direction.**

- `ImageItem` (`emission-store.ts:35-44`) gains `original: FileTransferState`.
  The `File` handle lives in the upload hook's ref, not in the store
  (`composer-file-uploads.ts:6-12`: the store is serializable by contract).
- `ChatImageAttachment` (`api-chat.ts:66-71`) gains `path?: string`, the
  box-relative path of the uploaded original. This is the emission and
  native-bridge shape. The `/chat/send` body's `images[]` does not carry it:
  the server-side `chatImageSchema` strips unknown keys, and the server does
  not need it because the path travels in the message text. Stripping is
  explicit in `assembleChatMessage`, which maps images to `{ id, mimeType,
  dataBase64 }` so the wire shape is written down, not incidental.
- `composer-file-uploads.ts` generalizes: `runUpload` takes a `setState`
  callback instead of calling `editor.setFileState` directly, so images and
  files share the identity check and the in-flight tracking. `addUploadFiles`
  stays; a new `uploadImageOriginal(id: number, file: File)` starts an image's
  upload and writes `editor.setImageOriginal({ id, state })`. `forget` and
  `forgetAll` cover both maps. `awaitPendingUploads` waits for both.
- `addInlinePhotos` (`InteractiveChat-attachments.ts:163-201`) starts the
  original's upload as soon as the item is added, in parallel with encoding.
  An encode failure that drops the photo also forgets its upload.
- `assembleChatMessage` writes image lines after file lines, in id order,
  only for images whose `original` is `uploaded`:
  `[image#N]: _tmp/2026-...` using the body's token spelling via
  `composerTokenIn`, and the current form when the body has no token.
  The block is emitted when either list is non-empty.
- **Every durable copy of an emission carries the path**, or a retry
  silently regresses to today's behaviour (cross-model finding). Three
  places besides the live store:
  - Draft persistence (`emission-persist.ts`): serializes `ImageItem`
    minus `objectUrl`; `original` rides along. Images are only persisted
    under `PERSIST_BYTE_BUDGET` (`emission-persist.ts:52-53`), so an image
    that was dropped for size loses its original with it, as today. An image
    restored with `original.status === "uploading"` is restored as `failed`
    with the message "Original not uploaded — the agent sees the reduced copy
    only"; retry is impossible (no `File`), so the tile offers remove, not
    retry, the same rule as `composer-file-uploads.ts:113-121`.
  - Pending-send recovery (`components/chat/conversation/pending-sends.ts:47-51`):
    `emissionSchema.images` gains `path: z.string().optional()`. Zod strips
    unknown keys, so without this a rejected send's retry drops the path.
  - Restore after a rejected send (`input/targets/chat-target.ts:138-145`,
    `applyRestorePlan`): a restored image with `path` gets
    `original: { status: "uploaded", path }`; without `path` it gets
    `failed` as above.
  A doctest stages an emission with an image path, rejects it, restores it,
  and asserts the reassembled message still carries the line.
- Image tile (`ChatAttachments.tsx`, `AttachmentTile`): a small overlay
  state, progress ring while uploading, a warning glyph with the failure
  message and a retry button on `failed`, nothing on `uploaded`. Retry
  reuses the kept `File`, the same rule as file chips.
- Send gating: `awaitPendingUploads` already runs before dispatch
  (`InteractiveChat-dispatch.ts:47-48`). A `failed` original does not block
  the send. Its image gets no attachments line.

**Vocabulary lock-ins.** `[image#N]: <path>` line in `<attachments>`;
`ImageItem.original`; `ChatImageAttachment.path`.

**First chunk.** Store and hook changes with `test/frontend/emission-editor.doctest.md`
and a new `test/frontend/composer-image-originals.doctest.md`; then
assembly with `test/frontend/emission-assemble.doctest.md` pinning the exact
block text; then the tile.

### Track 3. Tell the agent

**What.** Extend the Attachments section of `prompts.ts:66-78` with two
sentences and update `docs/mobile-contract.md` §4.1a and §5.4/§5.5.

**Direction.** Prompt text, after the file example:

> An inline image the user attached also has its original file listed the
> same way: `[image#1]: _tmp/2026-...jpg`. The image you see in the message
> is a reduced copy; the file is the original, for cropping, OCR, attaching
> to a card, or handing to an API. An image with no `[image#N]:` line has
> no file (the upload failed, or the message predates this).

The `_tmp/` keep-or-drop rule that follows already applies.

**First chunk.** The prompt edit, the contract-doc edit, and a
`knows_directly` audit (see Knowledge audits).

### Track 4. iOS composer

**What.** The native composer keeps each inline image's original bytes,
uploads them through the existing `ChatAPI.uploadFile`, and emits `path` on
the Emission V2 image entry. Track 2's assembly then writes the line.

**Why this needs to change.** Verified by trace: `ComposerDraftStore.beginImageImport`
(`ios-app/BeeBox/Storage/ComposerDraftStore.swift:251-284`) already writes
the original bytes to the draft directory as `image-source-<uuid>.<ext>`,
and `completeImageImport` (`ComposerDraftStore.swift:288-314`) deletes them
after the downscale: *"try? await repository.removePayload(filename:
sourceFilename, ...)"*. After that nothing on the device holds the original.
Every entry point (picker `loadTransferable(type: Data.self)`, camera
`jpegData(compressionQuality: 1)`, pasteboard PNG or `UIImage`) funnels
through `appendImage(data:sourceMimeType:)` (`NativeComposerView.swift:1229-1247,
1440-1455, 1567-1573`), so "original" means the best bytes each source
gives: the library asset for the picker (HEIC stays HEIC), a full-quality
JPEG for camera and pasted `UIImage`.

**Direction.**

- `DraftImage` (`Models/ComposerDraft.swift:39-44`) gains
  `original: DraftOriginal?` where `struct DraftOriginal: Codable, Equatable
  { var filename: String; var state: DraftTransferState }`. `filename` is the
  `image-source-<uuid>` payload; `state` reuses the existing enum
  (`.uploading | .uploaded(path:) | .failed(message:)`; `.local` unused
  here). The existing `state` keeps meaning "encode/import state," so
  `hasIncompleteImages` (`NativeComposerView.swift:1151-1157`) keeps its
  rule and gains one clause: an `original` in `.uploading` also blocks
  send. A `.failed` original does not block send, matching Track 2.
- `completeImageImport` stops removing the source payload and instead sets
  `original = DraftOriginal(filename: sourceFilename, state: .uploading(progress: 0))`
  and RETURNS the updated `DraftImage`. `processImage`
  (`NativeComposerView.swift:1589-1614`) holds the pre-mutation value today,
  so it must use the returned image, not its local, when it starts
  `uploadImageOriginal(image)`, a sibling of `uploadFile(_:)`
  (`:1511-1539`): read the payload, `ChatAPI.uploadFile(data:filename:mimeType:onProgress:)`,
  then `markImageOriginalUploaded(id:path:boxID:)`, which sets
  `.uploaded(path:)` and removes the source payload (it has landed). On
  throw, `.failed(message:)` and the payload stays for retry. The off-active-box
  branches of `setFileState`/`markFileUploaded` (`ComposerDraftStore.swift:385-443`)
  get image-original twins so a box switch mid-upload still lands.
- Cleanup goes through ONE accessor: `DraftImage.payloadFilenames: [String]`
  (`[filename] + original.map { [$0.filename] }`). The repository helpers
  that remove and check payloads (`ComposerDraftRepository.swift:213-234`,
  used by `discard`, `removeImage`, `PendingEmissionStore.removePayloads:532-534`,
  and `missingImageIDs`) iterate that list instead of `image.filename`, so no
  site can miss the original. `missingImageIDs` treats a missing ORIGINAL as
  "original failed" (state `.failed`), not as a missing image.
- `ChatImageAttachment` (`Models/ChatImageAttachment.swift:3-7`) gains
  `var path: String?`, encoded only when non-nil. `emissionImages(from:boxID:)`
  (`ComposerDraftStore.swift:472-483`) and `PendingEmissionStore.nativeEmission(from:)`
  (`:488`) fill it from `original?.state` when `.uploaded`.
- Web parser `parseNativeImage` (`native-emission.ts:148-158`) accepts an
  optional string `path`; a non-string `path` rejects the payload like any
  other malformed field (V2 rule, `mobile-contract.md:359-365`).
- Tile: the native image tile shows the same three states as Track 2
  (uploading ring, failed with retry, nothing when uploaded). Retry re-enters
  `uploadImageOriginal`.
- Contract doc: §4.1 image entry gains `"path"?: "<_tmp/...>"`; §4.1a notes
  the `[image#N]:` line; §8 mirrored keys row updated. Same commit.

**Vocabulary lock-ins.** `DraftImage.original`, `ChatImageAttachment.path`
(Swift and TS), `"path"` key on the V2 image entry.

**First chunk.** `DraftImage.original` + `completeImageImport` keeping the
source + cleanup sites, with a `ComposerDraftTests` case that the source
payload survives import and is removed on `markImageOriginalUploaded`; then
the upload call and gate; then the emission field, the web parser, and a
new fixture `test/mobile-contract/fixtures/emission/v2-image-with-path.json`
(plus a malformed-path case).

## Could this be simpler?

**Simplest version:** persist on the server what arrives in `/chat/send`
(the downscaled base64) to `_tmp/` and append the line server-side. About
40 lines, one file, no client work, iOS covered automatically.

**What the fuller plan buys:** the original. The server copy is 1920px
WebP at 0.85, which fails the receipt-OCR and print-quality cases and
reproduces the Claude Code thumbnail trap the issue names. Per the trap
recorded in the issue ("must hand back the original bytes or it will appear
to work while quietly degrading images"), the simple version is worse than
nothing because it looks done.

**Second simplest:** web only. Rejected by the boxholder: iOS is where it
bites.

**Things deliberately not built:** no new route, no new directory, no
sweep, no card, no CLI command, no retention store, no server knowledge of
the path.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Original upload fails (offline, 413, 500) while the inline copy is fine | Track 2 doctest | tile shows failed + retry; send proceeds without the line | clear to the user (tile), clear to the agent (no line, prompt says why) |
| Upload still in flight at send | existing `awaitPendingUploads` (`pending-sends.doctest.md`) | send waits | clear (send button state as for files) |
| Re-minted id after reset receives a stale upload result | Track 2 doctest (mirrors `composer-file-uploads.ts:47-56`) | identity check on the `File` handle | silent by design (dropped) |
| Page reload with an in-flight original | `emission-persist.doctest.md` case | restored as `failed`, remove only | clear |
| Rejected send retried from the recovery row loses the path | `pending-sends.doctest.md` case | schema carries `path`; restore sets `original` | n/a after fix |
| Upload route returns a path that does not exist (today's bug) | Track 0 route test | returns `_tmp/` | n/a after fix |
| iOS `processImage` uploads from a stale `DraftImage` without `original` | Swift test on the returned value | `completeImageImport` returns the updated image | n/a after fix |
| iOS cleanup site forgets the original payload; drafts dir leaks | Swift test over `payloadFilenames` | one accessor | n/a after fix |
| `[image#1]` token also appears inside the attachments block | Track 1 doctest | expander skips the block | n/a after fix |
| User types a literal `<attachments>` in the body | Track 1 doctest | only a TRAILING block is skipped; a mid-text one is body text as today | silent, same as today for `[file#N]` lookalikes |
| Sweep removes the file after 7 days; old message still lists it | none new; same as files today | prompt says `_tmp/` is swept | clear (Read fails with ENOENT) |
| HEIC pasted on desktop: decode fails, photo dropped | existing toast (`InteractiveChat-attachments.ts:195-197`) | upload is forgotten with the photo | clear |
| Native emission carries `path` but an old web bundle's parser drops it | Track 4 fixture | optional field, parser tolerates absence; an old bundle simply omits the line | silent, degrades to today's behaviour |
| Bus copy strips a token the transcript kept | Track 1 doctest via `accepted-baseline.doctest.md` | shared helper | n/a after fix |

No critical gap: every new codepath has a test named above and a handling
row.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field:** ADDRESSED. The agent reads a line shape it
  already knows (`[file#N]: path`) with `image` in place of `file`.
- **Stale ref:** ADDRESSED, same as files: swept path reads ENOENT and the
  prompt names the sweep (`prompts.ts:78`).
- **Two agents touching the same card:** does not apply; no card is written.
- **Hand-edit drift:** the user can edit the body token out. ADDRESSED:
  assembly appends a missing token at the end, as it does for files
  (`chat-assemble.ts:60-70`).
- **Fabricated free-form value:** none; the path comes from the server.
- **Validation error UX:** an upload error surfaces on the tile as the
  server's `error` string, the same text file chips show.
- **Partial migration / transition state:** ADDRESSED. Old messages have no
  image lines; the prompt says what that means. An old iOS build emits no
  `path`; the parser tolerates it. A new iOS build against an old web bundle
  loses the field silently but sends fine.

## NOT in scope

- **Server-side knowledge of the path** (a `path` on `/chat/send` images,
  or a text block beside the image block). Considered; the line in the
  attachments block reaches the agent without a wire change, and the
  reconciliation compare (`machines/chat-shared.ts:52-56`) stays untouched.
- **Codex adapter using the file** (`src/services/codex-sdk-session.ts:170-196`
  writes its own temp copy). It could point `local_image` at `_tmp/`, but it
  only has the downscaled bytes in the block anyway. Separate change;
  relates to `issues/bugs/2026-09-05-codex-image-viewing-tool-unsupported.md`.
- **Agent-requested screenshots** (`screenshot-request-handler.ts`) answer a
  bus request, not the composer. They already return a path to the agent.
- **Promoting an image to a card automatically.** The prompt's `_tmp/` rule
  leaves that to the agent.
- **A `bbx chat get-image` command.** Nothing to fetch that the path does not
  already give.
- **Share Extension.** Verified: it accepts only URLs and plain text
  (`ios-app/BeeBoxShareExtension/ShareViewController.swift:170-195`) and
  posts to `chat/send` directly. No images pass through it.
- **Android / mobile web:** mobile web IS the web composer, covered by
  Track 2.

## Open design questions

- Should the image line show the original filename for a picked photo
  (`IMG_1234.HEIC`)? Lean: no; the path already embeds the sanitized name,
  and the file line does the same.
- iOS picker originals are often HEIC. The file is uploaded as-is, so the
  agent may need `sips` or ImageMagick to convert it. Lean: say so in the
  prompt in half a sentence ("a phone photo may be HEIC") rather than
  transcode on the device, which would make the "original" a re-encode.

## Knowledge audits

One new `knows_directly` entry, `chat-image-original-path`: prompt "A user
pasted a photo of a receipt into chat and asks you to file it with the
expense card. Where do you get the file?" Expected: the `[image#N]:` line
in `<attachments>`, a path under `_tmp/`, and that the inline image is a
reduced copy. Run with `pnpm knowledge-audit run --box <abs test box>
--filter chat-image-original-path`; status recorded in the yaml `notes`.

## What will hold this after it ships

- Track 1: pure functions, doctest tier (`test/shared/composer-tokens.doctest.md`,
  `test/core/chat-session.doctest.md`).
- Track 2: the store, hook, assembly and persistence are framework-free or
  hook-only and already have doctest files; the tile is visual, checked by
  a browse screenshot in the exhibit.
- Track 4: the mobile-contract fixture family `emission` gains a
  `v2-image-with-path.json`; the Swift side gets a unit test on the draft
  encoder. The route is unchanged so no server test is needed.
- No new test tier, no new mock.

## Implementation order

0. Track 0 (route path). Independent; lands first so every later test
   asserts the real path.
1. Track 1 (shared expander). Unblocks the line.
2. Track 2 (web). Commit per chunk: store+hook, assembly+persist, tile.
3. Track 3 (prompt, contract doc, audit; run the audit).
4. Track 4 (iOS), with the fixture and `native-emission.ts` change.
5. Cross-model review of the branch diff; browse exhibit of the tile
   states; finish.

## Rollout shape

Tests first per track, as named. Done when: the doctests above pass, the
knowledge audit is run and recorded, the iOS app builds and its test
passes in the simulator, and a real paste in the dev box produces a
`_tmp/` file whose bytes equal the source file (checked with `cmp`). No
data migration: no stored shape changes. Old transcripts are unaffected.

## Cross-model review of the diff (2026-09-16)

Three findings, all applied:

- A restored draft did not existence-check a landed image original, so a
  swept `_tmp/` path came back as a usable line. The restore now HEAD-checks
  image originals like files; a missing one is `lost` and named in the
  expired-attachments notice.
- Originals started uploading only after every sibling encode finished. Now
  each photo's original starts the moment its own encode is done.
- A restored failure offered a retry with no `File` to retry from.
  `FileTransferState` gained `lost` (failed, nothing to retry); the tile
  shows "No file" for it and "Retry" only for a live failure.

Browser verification (worktree box): a 3000×2000 PNG pasted into chat landed
in `_tmp/` byte-identical (same sha256 and size); the stored user entry has
one image block and the `[image#1]: _tmp/…` line; the box agent read the
original unaided. Two UI finds fixed on the way: the failure strip did not
fit the tile (now one word plus `title`), and chat titles included the
`<attachments>` block (pre-existing for files; `extractSnippet` now strips
it).
