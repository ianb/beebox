# Bulk file upload

**Status:** active — reviewed by the boxholder 2026-07-27; decisions recorded under Open design questions (now Resolved); implementation in progress

Let a user dump many files (order of 100 MB / dozens of items — camera-roll
batches, document folders) into a box at once. The upload surface only gets the
bytes into a durable landing spot; the **chat agent** does the actual filing,
prompted by a first-class user message ("N files were uploaded to <dir>")
injected after the batch settles. The intelligence lives in the agent turn, not
the upload widget.

A cross-model (Codex) review of the first draft falsified several "free reuse"
claims; this revision incorporates the verified findings. Where the reviewer's
recommendation is a genuine fork rather than a factual correction, it appears
under Open design questions.

## Stated preferences this plan trades against

- `docs/engineering-principles.md` — chiefly **#1 types are structure** (a
  batch's lifecycle as a typed state machine, not booleans), **#3 validate at
  boundaries** (multipart/header input, manifest on disk), **#4 resilient and
  never silent** (partial upload failure must be visible to both user and
  agent), **#6 right-sized defensiveness**, **#10/#12** (agent-maintainable
  conventions; see Knowledge audits).
- `callback-box/CLAUDE.md` — "HTTP endpoints go in tRPC by default … Raw
  Fastify routes in `src/webapp/routes/` are only for things that don't fit the
  tRPC request/response shape: file upload/download …" (uploads stay raw
  Fastify); "Read before writing"; don't add features beyond what the task
  requires.
- `code-style.md` — custom error classes, named-params, no default params,
  Result-vs-throw boundary.
- **Shipped precedent: capture mode** (`docs/implemented-plans/capture-mode.md`,
  code under `src/core/capture/`). The densest preference signal here — it
  already solved staged multi-file upload, background iOS upload, delivery as
  a first-class chat message, and "agent files the landing zone." This plan
  builds on it — with eyes open about which parts genuinely transfer (see the
  per-item caveats in What already exists).
- **`docs/asset-manifests.md`** — the box's large-asset model: "*Manifest in
  git, blobs out of git.*" Binding for where 100 MB of uploads may land.
- Boxholder's standing preference to consolidate duplicated mechanisms rather
  than build parallel ones.

## What already exists

Each item states what is genuinely reusable and what is NOT (first-draft
overclaims corrected).

- **Staging store + caps** — `src/core/capture/staging-store.ts` (per-session
  dir under `tmp/capture-staging/<session-id>/` with a `session.json`
  manifest); `src/core/capture/staging-limits.ts:13-14`:
  `MAX_STAGED_BYTES = 1024 * 1024 * 1024; MAX_STAGED_ITEMS = 500`, enforced
  under a per-session lock, mapped to 413 (`capture-upload.ts:127`).
  **Reused**, with two hardening items this plan adds: `session.json` was
  written with a plain `writeFile` and any read/parse/schema error was
  swallowed to `null` (`catch (_e) { return null; }`) — a corrupt manifest
  silently strands the whole batch. Bulk needs temp-file+rename writes and a
  non-silent corrupt-manifest path (principle #4). **Done in Track 0**: this
  logic moved to `src/core/capture/staging-manifest-io.ts`
  (`readStagingSession`/`writeStagingSession`), which now does exactly that —
  temp-file+rename writes, and a corrupt manifest gets a loud `console.error`
  plus quarantine to `session.json.corrupt` instead of a silent `null`.
- **Upload route** — `src/webapp/routes/capture-upload.ts` already accepts
  `X-Capture-Kind: file` items, one HTTP call per item, per-capture-session
  owner auth (`capture-request-owner.ts`), and replay/idempotency handling
  (`upload-replay.ts`). **Reused as the route shape**, but NOT free at this
  scale: the body is buffered wholly in memory (`capture-upload.ts:30`
  `readUploadBuffer`) and written under the session lock
  (`staging-store.ts:200`). Bulk adds streaming-to-tempfile writes (hash/size
  computed while streaming) so dozens of ~50 MB items don't buffer in RAM.
  The single-file `POST /api/chat/upload-file` (`routes/chat-uploads.ts`) is
  left untouched for the existing attach-one flow.
- **iOS background upload** — `ios-app/CallbackBox/Services/CaptureUploadCoordinator.swift`:
  background `URLSession` upload tasks per item, per-item retry, durable
  across relaunch. **Reused/generalized — but not a parameter-only change**:
  the local `CaptureManifest` has no batch kind (`CaptureModels.swift:190`),
  capture resume picks the latest manifest per chat without lifecycle
  filtering (`NativeCaptureController.swift:537`), and photo import runs
  sequentially through in-memory `Data` before any upload task exists
  (`CaptureAcquisition.swift:219`) — background durability only covers tasks
  already created, and a force-quit cancels them. Track 3 scopes this
  honestly.
- **iOS multi-select pickers** — `NativeCaptureView.swift:203`
  `PhotosPicker(… maxSelectionCount: 50 …)` + `.fileImporter(allowsMultipleSelection: true)`
  (`NativeCaptureView.swift:103-106`); composer has an unlimited
  `PhotosPicker` (`ComposerActionsView.swift:43-49`). **Reused** as entry
  pickers (the composer's unlimited picker currently feeds the in-memory
  attachment path, not staging — bulk must not route through that path).
- **Web multi-file upload state model** —
  `src/frontend/src/pages/capture/useCaptureUploads.ts`: per-item
  `UploadState`, derived counts, `retryFailedUploads`. **Reused as the model
  only.** Not free at this scale: retry payloads live only in React refs
  (`useCaptureUploads.ts:83`), selection starts all uploads at once with no
  concurrency cap (`useCaptureInputs.ts:53`), there is a 30 s per-upload
  timeout (`capture-api.ts:172` `UPLOAD_TIMEOUT_MS = 30_000` — a 50 MB file
  needs >13 Mbps to beat it), and `fetch` gives no byte progress. Bulk adds a
  bounded queue and a size-scaled (or removed) timeout; per-item byte
  progress is cut from v1 (item states only).
- **First-class message injection** — `src/core/capture/deliver.ts:191`
  `deliverCaptureMessage(…)`; at-most-once probe `captureMessageAlreadyLanded`
  (`deliver.ts:155`). **Reused/generalized, with one known hole this plan
  closes for bulk**: when the target session is busy the message goes into an
  in-memory queue, and capture explicitly accepts that "*a crash before drain
  loses the notification*" (`prepare.ts:308-311`). For bulk, a lost
  notification defeats the feature's premise (nothing else prompts filing),
  so delivery gets a reconciliation pass (Direction §3).
- **Landing-zone convention** — `docs/box-layout.md:88-91` (`tmp-capture/`
  inside the target chat's context dir, "must not accumulate"), duties
  injected via schema `instructions`
  (`src/schemas/capture-session.tsx:92-95`). **Reused as the pattern.**
- **Large-asset landing format** — `docs/asset-manifests.md:43`: "*Manifest in
  git, blobs out of git. Each `.attach/` directory contains a `manifest.json`
  that records every asset in it. The manifest commits; the assets are
  gitignored.*" **Binding**: the first draft's "commit raw files in a tracked
  dir" contradicted this; the batch now lands as a card + `.attach/` scope
  with an asset manifest (Direction §2).
- **Unfiled-work sweep** — `src/core/capture/sweep.ts:131` warns
  (console-only) on captures unfiled 7+ days. **Extended** for bulk — and the
  bulk variant surfaces to the agent, not just the server log (Direction §3).
- **Inbox/triage pipeline** — `docs/box-layout.md:109`: "*(Composer captures
  don't land here — they deliver to chat; see below.)*" Bulk uploads follow
  the same exception; the agent MAY route individual files into `box/inbox/`
  while filing.
- **`cb mv` limitation** — `src/core/commands/move.ts:191-195` rejects
  sources that are neither `.card` files nor directories, so "file each file
  with `cb mv`" (first draft) is wrong for loose files. Filing instructions
  are written against what the tooling actually supports (Direction §3), and
  attach-scope asset moves go through the asset-manifest tooling.

## Prior art (external)

- **PhotosPicker at scale**: load selected assets as *file* representations
  rather than in-memory data; per-item (not blocking) progress since assets
  may need an iCloud download —
  [WWDC22 "What's new in the Photos picker"](https://developer.apple.com/videos/play/wwdc2022/10023/),
  [PhotosPicker in production](https://www.theswift.dev/posts/photospicker-production-swiftui/).
- **Background uploads**: tasks in a background `URLSessionConfiguration`
  continue when the app is backgrounded; multipart bodies must be file-backed
  (`uploadTask(with:fromFile:)`); durability covers only *already-created*
  tasks, and force-quit cancels them —
  [Apple background-session docs](https://developer.apple.com/documentation/foundation/urlsessionconfiguration/background(withidentifier:)),
  [Apple dev forums on background upload](https://developer.apple.com/forums/thread/756333).
  Consequence: the iOS import loop (picker → temp file → create task) must
  run eagerly per item so tasks exist as early as possible; the app must stay
  foreground only through import, not through upload.
- **Web `<input type="file" multiple accept="image/*">` on iOS
  Safari/WKWebView** presents the native multi-select photo picker (standard
  WebKit behavior). Moot inside the iOS app (web composer suppressed under
  `nativeComposer=1`) but the plain web overlay works on mobile browsers with
  no extra work.
- No named external pattern needed for the batch-manifest/notification
  mechanism itself; the internal precedent (capture mode) governs.

## Direction

One pipeline, thin surfaces on top of (selectively hardened) capture
infrastructure:

1. **Batch = staging session of `file` items, with a predeclared item set.**
   Creating a bulk batch registers the expected items up front — stable item
   IDs plus name/size/mimetype descriptors — *before* any bytes transfer
   (items may be appended while the picker streams, but every upload names a
   registered item ID). This is what lets the server compute "settled,"
   distinguish 37-selected from 34-received after a dead tab, and build a
   truthful `failed`/missing list — the first draft had no way to know what
   never arrived. `session.json` gains `kind: "capture" | "bulk"` (default
   `"capture"`) so capture preparation/resume ignores bulk sessions and vice
   versa.

2. **Finalize → durable landing in the asset-manifest model.** A bulk
   `prepare` (`src/core/bulk-upload/prepare.ts`) **copies** (not moves — parity
   with capture retaining staging until confirmed delivery, `prepare.ts:341`)
   the staged files into the target chat's context dir as:

   ```
   tmp-upload/<batch-slug>/Batch.upload-batch.card
   tmp-upload/<batch-slug>/Batch.upload-batch.attach/   ← blobs, gitignored
   ```

   with the `.attach/` directory's `manifest.json` recording every asset
   (name, size, hash, mimetype) per `docs/asset-manifests.md` — manifest and
   card commit; blobs stay out of git. The card's frontmatter carries the
   batch summary: counts, total bytes, and the server-computed
   received/missing/failed item lists. Original filenames are preserved
   (sanitized; collisions deduped with a numeric suffix) because filenames
   carry meaning the agent uses when filing. Staging is deleted only after
   commit + delivery are confirmed.

3. **Delivery → first-class user message, with reconciliation.** A
   generalized deliver core (extracted from `deliverCaptureMessage`; capture
   keeps its wrapper) injects:

   ```
   <upload doc="<contextDir>/tmp-upload/<batch>/Batch.upload-batch.card" files="34" bytes="112MB" failed="3">
   34 files uploaded (112 MB); 3 more failed to upload.
   </upload>
   ```

   documented in `CHAT_SYSTEM_PROMPT` beside `<capture …>` as real user input
   expecting a reply.

   - **Durable notification.** Busy-path delivery is an in-memory enqueue
     (`deliver.ts:243`; loss-on-crash accepted for capture,
     `prepare.ts:308-311`). Bulk cannot accept that: a batch marked
     `delivered` whose `doc` path never appears in the target transcript
     (existing probe, `deliver.ts:155`) is re-delivered by a reconciliation
     check at server start and at sweep time. Cheap (a probe we already
     have), and it converts the only silent-loss path into an eventually-
     delivered one.
   - **No most-active fallback.** The overlay is always launched from a
     specific chat, so the target session is always known; unlike capture's
     deep-link case, a bulk delivery with no resolvable target is a broken
     invariant → fail loudly and keep the batch retryable, never deliver a
     heterogeneous file dump into "whatever chat was most active"
     (`deliver.ts:119-135` behavior is capture-only).
   - **Filing duties** (schema `instructions`): read the card + attach
     manifest, trust the directory over the manifest if they disagree,
     inspect files as needed, then file each file or coherent group — into a
     destination card's attach scope (asset-manifest tooling), `store/`, or
     `box/inbox/` — using the file-level tools that actually exist (`git mv`
     is fine for tracked files; attach-scope blobs move via the manifest
     helpers; `cb mv` only for cards/directories, `move.ts:191`). Shrink the
     card's remaining-list as it goes; delete card + dir when empty;
     `tmp-upload/` must not accumulate; if not finishable in one turn, say so
     and continue later. A batch found missing (already filed) is done — no
     error theater. **And: a batch that arrives without introduction — no
     accompanying user text explaining what the files are or where they
     should go — gets questions first, not filing.** Ask what the batch is
     for before operating on the files; only proceed unprompted when the
     destination is genuinely unambiguous (boxholder decision, 2026-07-27).

4. **Entry surfaces.**
   - **Web (v1 core)**: "Upload files…" in the composer's Add dropdown
     (`InteractiveChat-composer.tsx:213-220`), opening a full-screen overlay
     (same hand-rolled `role="dialog"` idiom as `CaptureOverlay`): file
     picker (`multiple`), per-item state list (queued/uploading/uploaded/
     failed — no byte progress in v1), bounded-concurrency upload queue,
     retry-failed, Done → finalize. Finalize failure surfaces inline; nothing
     is lost (batch stays staged/resumable).
   - **iOS: deferred behind an explicit uploader boundary** (boxholder
     decision, 2026-07-27). The server contract — batch session + item
     registry + per-item uploads + finalize — is uploader-agnostic; web is
     one uploader, and iOS may later get a *dedicated* native uploader built
     for robustness at this scale (eager background-task creation, its own
     lifecycle) rather than a parameterized `CaptureUploadCoordinator`. That
     work gets its own plan when taken up; nothing in v1 may assume the web
     uploader is the only client (no browser-only assumptions in the batch
     endpoints).
   - **Not** a standalone page in v1 (see NOT in scope).

### Vocabulary lock-ins

- `tmp-upload/` — bulk-upload landing dir inside a chat context dir (sibling
  of `tmp-capture/`).
- `upload-batch` — new card schema (status: `new` → `delivered` →
  emptied/deleted), with `.attach/` asset scope.
- `<upload doc="…" files="N" bytes="…" failed="M">` — chat-message wrapper,
  doctested exact like `buildCaptureWrapper` (`deliver.ts:41`).
- Staging `session.json` gains `kind: "capture" | "bulk"` and (bulk only) the
  predeclared item registry.

(Whether `upload-batch` vocabulary should exist at all vs reusing a
files-only capture session is Open question 1.)

## Tracks / scope

Ordered by implementation dependency.

**Track 0 — Staging hardening (shared with capture). DONE (`0ef4d69c`).**
- *Why*: bulk leans on staging as durable; before this track it wasn't
  (silent-null manifests, non-atomic writes).
- *Direction*: temp-file+rename `session.json` writes; corrupt manifest →
  quarantine + `console.error` with box/session context, never silent `null`.
  Benefits capture too.
- *First chunk*: exactly that, with doctests. Shipped as
  `src/core/capture/staging-manifest-io.ts` (the plain-`writeFile`/silent-`null`
  logic this track replaced previously lived in `staging-store.ts`, since split
  up).

**Track 1 — Core: batch sessions, prepare, deliver (backend).**
- *Direction*: `kind` + predeclared item registry on staging sessions;
  streaming-to-file upload writes for `kind=file`; `upload-batch` schema;
  `src/core/bulk-upload/prepare.ts` (copy + card + attach manifest + commit);
  deliver-core extraction + `buildUploadWrapper` (pure, doctested exact);
  finalize route (raw Fastify, beside capture staging routes) running
  prepare-then-deliver with capture's retry discipline plus the
  reconciliation check; `CHAT_SYSTEM_PROMPT` addition; sweep coverage that
  surfaces unfiled batches to the agent (self-note), not just the server log.
- *First chunk*: staging `kind` + item registry + `upload-batch` schema +
  prepare (no delivery), doctests at the `makeTmpBox()` tier.

**Track 2 — Web UI.**
- *Direction*: Add-menu entry + `BulkUploadOverlay`, state model derived from
  `useCaptureUploads` but with a bounded queue (start with concurrency 3),
  size-scaled upload timeout, retained-payload retry, finalize on Done with
  named failures shown. Drag-and-drop onto the overlay.
- *First chunk*: overlay with picker + bounded queue + item states + finalize
  happy path, exercised via `bin/browse`.

**Track 3 — iOS: deferred (own plan later).** See Direction §4. The findings
that scoped it stay recorded there for whoever picks it up: import must
create background tasks eagerly per item (`CaptureAcquisition.swift:219` is
sequential in-memory today), force-quit cancels created tasks, the local
manifest needs a `kind` (`CaptureModels.swift:190`), resume needs kind
filtering (`NativeCaptureController.swift:537`), and a dedicated uploader —
not a parameterized capture coordinator — is on the table.

**Track 4 — Agent knowledge + docs.**
- *Direction*: knowledge audits (below), `docs/box-layout.md` update,
  `docs/mobile-parity.md` row (also correct its stale "≤4 photos" cell — the
  cap is already gone in code), capture-mode doc cross-reference.

## Subplans

None. The iOS coordinator generalization is the closest candidate; Track 3's
scope statement above bounds it enough to stay inline.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Item upload fails mid-batch (network drop) | Track 2 doctests / Track 3 coordinator tests | Bounded-queue retry; server knows the item is missing via the predeclared registry | Clear: item state + named in `failed` list |
| Tab/app dies after some uploads, before finalize | Track 1 doctest (resume listing) | Batch enumerable + resumable (registry says what's missing); staging retained | Clear: "resume batch" affordance; sweep surfaces abandoned staging |
| Batch exceeds 1 GiB / 500 items | existing (`staging-limits`) | 413 (`capture-upload.ts:127`) | Clear: item error in overlay |
| Single file exceeds the batch cap | new doctest | 413; item marked failed, batch continues | Clear: item error with size — see Implementation notes: bulk has no separate per-file cap, only the shared 1 GiB batch cap |
| Finalize crashes after commit, before deliver | Track 1 doctest | Retryable (`failed:deliver` shape) + at-most-once probe | Clear: retried; never double-delivers |
| Message enqueued to busy agent, server crashes before drain | Track 1 doctest | Reconciliation: `delivered` batch with no transcript hit → re-deliver at startup/sweep | Clear: eventually delivered |
| Target chat gone at delivery | Track 1 doctest | Fail loudly, batch stays retryable (no most-active fallback for bulk) | Clear: error surfaced, nothing misdelivered |
| Filename collision within batch | new doctest | Numeric-suffix dedupe in prepare; manifest records both | Clear |
| Corrupt/unparseable `session.json` | Track 0 doctest | Quarantine + logged error (`staging-manifest-io.ts`; was silent `null` in the pre-Track-0 `staging-store.ts`) | Clear after Track 0 |
| Commit of batch card/manifest fails | route-tier doctest | Finalize fails loudly; staging retained (copy, not move) | Clear |
| Agent never files the batch | sweep doctest | Sweep ≥7 days → self-note to the chat agent (not just `console.warn`) | Clear |
| iOS force-quit mid-batch | deferred with Track 3 | (deferred — the item registry already makes missing items detectable server-side) | n/a in v1 |

No unresolved critical gaps: the two from the first draft (unfinalized-batch
loss; busy-queue notification loss) are handled by the item registry +
retained staging and the reconciliation pass respectively.

## Agent-flow / user-flow edge cases

- **Wrong tag** (`<upload>` vs `<capture>` vs `<attachments>`) — ADDRESSED:
  all server-generated, documented side by side in the prompt.
- **Stale ref** (batch card gone when the agent reads it) — ADDRESSED in the
  *instructions*, not delivery-time verification (delivery sends a computed
  string and does not stat the path): a missing batch means already-filed —
  treat as done.
- **Two agents touching the batch** — ADDRESSED: sweep only warns/notifies,
  never mutates; filing is chat-agent-only (division per
  `capture-session.tsx:14-15`).
- **Hand-edit drift** (boxholder hand-moves files out of the attach dir) —
  ADDRESSED: instructions say trust the directory listing over the manifest
  and reconcile; the attach pre-commit hook re-syncs `manifest.json`.
- **Fabricated free-form value** — ADDRESSED with a correction from the first
  draft: `originalName`/`mimetype` are client-supplied headers
  (`capture-upload.ts:115`), not server-computed; sizes/hashes ARE
  server-computed during the streaming write. The card labels which is which;
  instructions tell the agent to trust bytes over claimed mimetype when they
  disagree.
- **Validation error UX** — ADDRESSED, right-sized: schema validation covers
  frontmatter shape only (it cannot reconcile directory contents;
  `card-lint.ts` reference checks are warn-only); directory↔manifest
  reconciliation is the agent's duty per instructions, not a validator.
- **Partial migration / transition state** — ADDRESSED: old staging manifests
  lack `kind`; parser defaults `"capture"`. No existing data changes shape.

## NOT in scope

- **Standalone upload page / browse-page upload** — the chat overlay covers
  the ask; revisit if it proves cramped.
- **Per-item byte progress on web** — `fetch` doesn't expose upload progress;
  item-state granularity (queued/uploading/done/failed) is enough for v1.
- **Share-sheet intake (iOS)** — explicitly separate (`docs/mobile-parity.md`
  Track E; `issues/features/2026-03-05-share-to-box-images-files.md`).
- **Content-hash dedupe across batches** — separable; hashes are in the
  manifest, so the agent can detect dupes while filing. File an `issues/`
  item if it bites.
- **Changing the single-file attach flow** — untouched; bulk is a sibling.
- **Automatic/background filing by a non-chat procedure** — agent-in-the-loop
  filing is the point.
- **Raising the 1 GiB per-batch cap** — current cap covers the stated scenario.
  (The 50 MB per-file multipart cap named in the first draft turned out to be
  capture-specific — see Implementation notes.)
- **Android** — no shell exists; contract rows keep it implementable.

## Open design questions — RESOLVED (boxholder, 2026-07-27)

1. **`upload-batch` vocabulary**: approved — separate card type, not a
   files-only capture session.
2. **iOS**: deferred out of v1, behind the uploader boundary (Direction §4);
   possibly a *dedicated* iOS uploader later, as its own plan.
3. **Landing dir name**: `tmp-upload/` (planner's lean, unobjected).
4. **Done-with-failures**: deliver immediately with `failed` named in the
   message (planner's lean, unobjected).

Plus one addition from review: unintroduced batches get questions before
filing (folded into Direction §3 duties).

## Knowledge audits

New agent-facing concepts: the `<upload …>` message, `upload-batch` duties,
`tmp-upload/` must-not-accumulate. Two `knows_directly`/`discoverable` entries
landed in `src/dev/knowledge-audits.yaml` (`=== Bulk file upload ===` section):
`upload-message-meaning` (what the message is, including the ask-before-filing
rule for an unintroduced batch) and `upload-batch-found-outside-chat` (a stray
`tmp-upload/` batch discovered outside a chat turn). Both pass as of
2026-07-27 — see the yaml's status comment for the one real finding along the
way (a genuinely leftover `tmp-upload/` batch in the test box from this
plan's own E2E verification, cleaned up rather than papering over the audit).

## Implementation notes

Two places where the shipped code diverges from this plan's original text,
recorded here rather than silently left stale:

- **No per-file multipart cap for bulk.** The plan's failure-mode table
  originally named a "single file > 50 MB multipart cap" inherited from
  capture's buffered upload route. Bulk's upload route
  (`src/webapp/routes/bulk-upload.ts`) streams the raw request body straight to
  a temp file (`addFileStreamed`, `src/core/capture/staging-stream.ts`) instead
  of buffering a multipart body in memory, so that capture-specific 50 MB
  per-file cap (`capture-upload.ts`'s multipart limit) never applied to bulk in
  the first place. Only the shared `MAX_STAGED_BYTES` (1 GiB) batch cap from
  `staging-limits.ts` bounds a bulk item.
- **`<upload>` wrapper byte formatting.** `buildUploadWrapper`
  (`src/core/bulk-upload/deliver.ts`) renders `bytes` via `humanBytes()` —
  spaced, human units (`bytes="112 MB"`), not a raw byte count — and omits the
  `failed` attribute entirely when the batch has zero failures (a clean batch
  carries no `failed` marker at all, rather than `failed="0"`). Both are
  doctested exact as vocabulary lock-ins.

## Implementation order

1. Track 0: staging hardening (atomic writes, loud corrupt-manifest path).
2. Track 1 chunk 1: staging `kind` + item registry + `upload-batch` schema +
   prepare — `makeTmpBox()` doctests.
3. Track 1 chunk 2: streaming upload writes; deliver extraction +
   `buildUploadWrapper` + finalize route + reconciliation + prompt addition +
   sweep→self-note — route-tier doctests.
4. Track 2: web overlay end-to-end (verify in the real app via `bin/browse`).
5. Track 4: docs, parity-matrix correction, knowledge audits (run).

Dependencies: Track 1 needs Track 0; Track 2 needs Track 1; Track 4 last.
(Track 3/iOS deferred out of v1.)

## Rollout shape

- **Tests first as design tool**: `buildUploadWrapper` doctested exact
  (vocabulary lock-in); prepare at the filesystem tier; finalize +
  reconciliation at the route tier (`makeTestServer()`), including
  crash-between-commit-and-deliver and busy-enqueue-then-crash; failure-mode
  rows name their tests.
- **Knowledge audits** land run.
- **No data migration**: staging `kind` is additive with a default; no
  existing card shape changes. Mobile-contract doc updates land in the same
  commits as the surfaces they describe (pre-commit tripwire enforces this).
- Ships as one unit from this worktree when the boxholder says so; commits
  land per-chunk inside the worktree.
