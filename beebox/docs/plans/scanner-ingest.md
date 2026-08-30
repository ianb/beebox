---
title: "Scanner Ingest"
status: implemented
workstream: unknown
issues: []
---
# Scanner Ingest

A pipeline from a ScanSnap desktop scanner to triage-ready cards in a hosted
box. ScanSnap profiles save searchable PDFs and images into per-box folders on
the boxholder's laptop. A stand-alone uploader sends new files to
bbx.ianbicking.org with a scoped, upload-only credential. The server validates
each file, runs the existing scan-import path (extended with a Docling-based
document mode), and the result lands in `box/inbox/` with an intake job, where
the existing triage flow takes over.

Two boxes take scans initially: the family box and the estate box. The design
is generic — any box can opt in by minting a scan token and adding a folder to
the uploader config.

## Stated preferences this plan trades against

- `docs/engineering-principles.md` — findings trace to: **#3
  validate-at-boundaries** (the upload route is a hard trust boundary), **#4
  resilient-and-never-silent** (rejected files must surface, not vanish), **#5
  failure paths visible in signatures** (the uploader/server wire contract),
  **#6 right-sized defensiveness** (defense concentrates at the upload
  boundary; interior code trusts scan-import's types), **#8 one way to do each
  thing** (reuse the pairing token store, the upload ledger, the
  octet-stream-with-header upload pattern), **#12 the maintainer is usually an
  agent** (breadcrumb comments across the no-shared-code boundary).
- `beebox/CLAUDE.md` — "Never change credentials to unblock yourself"
  (token minting is boxholder-initiated); "Keep source and docs generic — never
  hardcode personal names" (the uploader config carries box slugs; source
  stays generic); the tRPC-vs-raw-Fastify rule ("Raw Fastify routes … are only
  for things that don't fit the tRPC request/response shape: file
  upload/download" — this is file upload, so raw routes are correct).
- `beebox/code-style.md` — Result-vs-throw for the wire contract's
  failure shapes; no default parameters; custom error classes.
- Precedents (denser than docs): the mobile pairing/device-token machinery
  (`src/core/mobile/pairing.ts`), the bulk-upload streaming route
  (`src/webapp/routes/bulk-upload.ts`), the upload dedup ledger
  (`src/core/commands/upload-helpers.ts`), and `docs/plans/pdf-intake-design.md`
  (this plan amends it — see Track 4).

## What already exists

Reuse throughout; the only rebuilt piece is the document-mode internals
(Track 4), justified there.

- **Scan entry point and dedup ledger** — `bbx upload --as scan` with SHA-256
  content-hash dedup. `src/core/commands/upload-helpers.ts:1-4`: *"Helpers for
  the `upload` command — content-hash dedup ledger and streaming SHA-256 of
  files. The ledger lives at `.beebox/uploads.json` (per-box, untracked)
  and survives file renames/relocations because it keys on content."*
  `src/core/commands/upload.ts:45`: `const SUPPORTED_KINDS = ["scan"] as
  const;` — the kind dispatcher was built as a plug point. **Reused** as the
  server-side entry after validation, and its ledger doubles as the remote
  side of the uploader's dedup negotiation (Track 2).
- **scan-import** — `src/core/commands/scan-import.ts` dispatches two ways:
  all-images → photo flow (vision analysis, front/back pairing, question
  cards); any single PDF → document mode

  > **Model note (2026-08-01):** the photo flow's analysis backend is now the
  > `ScanVision` service (`src/services/scan-vision.ts`). The default is
  > **Claude Sonnet via the Claude Agent SDK** — zero extra credential
  > (subscription auth, same as the reactor); Gemini Flash remains as an
  > opt-in backend (`BBX_SCAN_VISION=gemini` + `GEMINI_KEY`). Accepted trades
  > on the Claude path: higher per-page cost/latency, no `subject_bbox`
  > (schema-forced null), best-effort rotation. Decision + measured evidence:
  > `docs/plans/scan-vision-claude.md`. Mentions of "Gemini analysis" for the
  > photo flow elsewhere in this plan predate the switch. Document mode
  > (Docling) is unaffected.
  (`scan-import.ts:117-118`: *"PDFs are always filed as documents — Flash
  treatment for PDFs is deferred"* — there is **no** text-layer check or
  textless-PDF-to-photo-flow path today; that split is Track 4 work, not
  existing behavior). Output is a `capture-session` card + attach scope in
  `box/inbox/`,
  committed with `Created-By: scan-import`, then
  `createOrAppendIntakeJob` (`src/connectors/intake-utils.ts:36-38`: *"Create
  a new intake job or append items to an existing pending one from the same
  source."*). **Reused**; Track 4 replaces only the document-mode internals.
- **Per-box scan priors** — now `config/scan.guide.card`, compiled in-memory
  into the per-page analysis prompt (`resolveScanGuideContext`,
  `src/core/commands/scan-guide-context.ts`); `CLAUDE_SCANS.md` remains a
  deprecated, warning-logged fallback. Reshaped by the `scan-guide-card.md`
  subplan (2026-08-01); Track 6 authors the guide-card drafts for the two
  boxes.
- **Bearer-token auth that traverses the hub** — the mobile device-token
  store, `src/core/mobile/pairing.ts:9`:
  `.beebox/mobile-devices.secret.json`, with hashed tokens, pairing
  tickets (10-min TTL, `pairing.ts:12`), revocation, and dual verification by
  hub and box child (`pairing.ts:14-16` comment; hub side
  `src/hub/hub-server.ts:161`). **Pattern reused, store not**: Track 1
  extracts the store mechanics into a shared helper and keeps scan tokens
  in a separate file, because every mobile-auth gate reduces identity to a
  boolean and any device bearer can mint a session cookie
  (`src/webapp/routes/pairing.ts:55-60`) — a scope field on this store
  cannot be contained (established by cross-model review, finding 1).
- **Streaming raw-body upload pattern** — `src/webapp/routes/bulk-upload.ts:80-85`:
  *"Shadow the parent box scope's buffering octet-stream parser with a
  non-draining one, so item uploads can stream `request.raw` straight to disk
  (never buffering a ~50 MB file in memory)."* and `:181-182`: filename via
  `X-Upload-Filename` header. **Reused** as the upload wire shape (Track 2).
- **Box-scoped staging area** — `src/lib/box-tmp.ts:1-6`: `<boxRoot>/tmp/` is
  *"the blessed home for ephemeral, box-runtime scratch — uploaded files,
  capture staging …"*, gitignored, swept after 7 days. **Reused**: quarantine
  lives at `tmp/scan-quarantine/`.
- **Server packages already installed** — `deploy/setup-server.sh:19` installs
  `poppler-utils pandoc imagemagick …`; adding `qpdf` follows the pattern.
- **Body size limit** — `src/webapp/server.ts:90`: `bodyLimit: 50 * 1024 *
  1024` (and the multipart cap it matches). 50 MB comfortably covers scanner
  output; **reused**, not raised.
- **Annex migration tooling** — `src/core/annex/to-annex.ts` (plus
  `doctor.ts`, `to-annex-errors.ts`). All 12 local boxes were migrated with it
  on 2026-07-31 (`docs/assets.md:6`: *"Status: implemented; all local boxes
  converted, production not yet."*). **Reused** for Track 0.
- **Scheduler daemon on prod** — `docs/scheduler.md:21`: *"The daemon runs `bbx
  tick` every 60 seconds for each configured box."* Relevant background, but
  Track 3 does **not** add a schedule card — see the retired-pattern note
  there.
- **Retired pattern, deliberately not reused** — the capture pipeline once
  auto-created a one-shot `process-captures` scheduled-script;
  `src/core/migrations.ts:106-110` prunes it (*"Prune the retired
  process-captures procedure card + its one-shot trigger"*). Captures now
  deliver into chat. Scans are inbox/triage-shaped, not chat-shaped, so this
  plan triggers processing by running `bbx wakeup` directly from the promote
  worker (Track 3) instead of resurrecting the card pattern.

## Prior art (external)

- **Docling has no hybrid OCR.** There is no "trust the text layer, OCR only
  pages that lack one" mode; OCR region selection is bitmap-coverage-driven,
  and `force_full_page_ocr=True` discards the existing text layer. The
  skip-pages-with-text option is an open, unimplemented feature request
  (github.com/docling-project/docling issues #3464, #2036, #1229), and
  force-OCR has a reported corruption bug on long documents (#1499). This
  plan's response: default `do_ocr=False` (Track 4).
- **Docling OCR quality on messy material is weak.** An independent 14-engine
  evaluation (Towards Data Science, "I Spent May Evaluating Different Engines
  for OCR", 2026) rates Docling poorly on receipts, forms, and handwriting.
  This plan does not use Docling's OCR at all; messy material routes to the
  existing Gemini photo flow, which scan-import's dispatcher already does.
- **Docling strengths this plan leans on**: TableFormer table structure
  (~93.6% vs Tabula 67.9% / Camelot 73.0% on published benchmarks; TEDS >91%
  FinTabNet), layout + reading order, `DoclingDocument` JSON with bboxes,
  markdown export with `ImageRefMode.REFERENCED` for referenced image files.
  Docling v2.117.0 (2026-07-30), MIT, Python ≥3.10, runs via CLI/`uvx`.
- **CPU cost**: Docling is slow on CPU with OCR enabled (independent reports;
  ~2 pages/sec order of magnitude). With `do_ocr=False` the OCR stage — the
  expensive part — is absent entirely; layout + tables only. Acceptable for
  scanner volumes on the prod server; no GPU dependency.
- **uvx environment sharing**: `uvx` resolves one cached environment per
  package version in the shared uv cache; model weights cache once under the
  invoking user's home. All prod boxes run as the single `callback` user, so a
  multi-box server has exactly one Docling installation by construction.
- **macOS Trash from a script**: recent macOS ships a `trash` CLI; the
  no-dependency fallback is `osascript` Finder scripting (`tell application
  "Finder" to delete POSIX file …`), which gives recoverable, put-back-capable
  Trash semantics. Used by Track 5's `trash` disposition.
- **File-type sniffing / structural validation**: `file-type` (npm, pure JS,
  magic-byte based) for sniffing; `qpdf --check` for PDF structure; `sharp`
  (npm, prebuilt libvips, AVIF-capable) for image decode-as-validation and
  AVIF encoding. All are prebuilt-npm or one-line apt/brew installs, matching
  the boxholder's stated dependency bar.
- **No prior art search needed for the wire contract** — it is purely
  internal; the shapes reuse in-repo precedents (bulk-upload).

## Tracks / scope

Ordered by implementation dependency, then surface size. Tracks 0 and 4 are
independent of each other; both precede end-to-end operation. Track 5 needs
Tracks 1–3 live on prod.

### Track 0 — Prod annex migration (prerequisite)

- **What:** Migrate the family and estate production boxes from the
  per-directory `manifest.json` asset scheme to git-annex, using
  `src/core/annex/to-annex.ts`.
- **Why this needs to change:** scan-import stages raw asset bytes and assumes
  annex. `src/core/commands/scan-import-document.ts:61-64` stages
  `…/source.attach/source.pdf` directly via `stageAndCommitPaths`; no
  scan-import or upload code writes a `manifest.json` (grep across
  `src/core/commands/scan-import*.ts` and `upload*.ts` is empty). On a
  manifest-scheme box those paths are gitignored
  (`src/core/commands/attachments-gitignore.ts:52-56`), so the commit either
  errors or strands unmanifested bytes. `docs/assets.md:16`: *"No production
  box has been converted."* There is no runtime annex-vs-manifest branch;
  the codebase assumes annex. Migrating prod is the direction the system
  already moved; teaching scan-import the manifest scheme would be new code
  for a scheme being retired (principle #8).
- **Direction:** Run the existing migration per box on the server, with the
  same verification the local migration used (`docs/assets.md:10-14`: fsck
  clean, byte-for-byte spot check). The fresh local backups of both boxes are
  the rollback story. Coordinate with the boxholder on timing; the box is
  briefly wedged mid-migration.
- **First implementation chunk:** a dry-run of `to-annex` against a clone of
  the prod estate box (restored from the local backup), verified with
  `annex/doctor.ts`, then the runbook for the real cutover written into
  `docs/server-operations.md`.

### Track 1 — Scan upload tokens (dedicated credential)

- **What:** A dedicated, revocable scan-upload credential per box,
  accepted only by the Track 2 routes, enforced independently at the hub
  and the box child.
- **Why this needs to change:** the boxholder wants an uploader credential
  with a deliberately small blast radius — "it can blindly upload to a known
  location … due to the limited amount it can do we wouldn't be creating a
  huge hole." Today a device token is full box access; nothing narrower
  exists.
- **Direction:** A **dedicated scan-token store**, not a scope field on the
  mobile device store. Cross-model review (see `scanner-ingest.review.md`,
  finding 1) verified that mobile identity is reduced to a boolean at every
  gate — the box auth preHandler accepts any non-null mobile identity and
  renews a session cookie (`src/webapp/server-box-scope.ts:99-105`), tRPC
  gates on the same boolean, the hub reduces bearer verification to yes/no
  before proxying every path, and `/api/pairing/session`
  (`src/webapp/routes/pairing.ts:55-60`) mints a scope-less signed cookie
  from any valid device bearer. Retrofitting a scope through all of that is
  more code and more risk than a separate credential that the general auth
  path never sees.
  - Store: `.beebox/scan-tokens.secret.json`, reusing the pairing
    store's mechanics (hashed tokens, `file-lock.ts` locking, `lastUsedAt`,
    revocation) via a shared helper extracted from
    `src/core/mobile/pairing.ts` — shared code, separate file, so
    `resolveMobileRequestAuth` structurally cannot resolve a scan token and
    no mobile gate ever sees one.
  - Child enforcement: the Track 2 routes register with their own
    preHandler that verifies the scan bearer against the scan store (they
    also accept a full owner identity, so the boxholder can exercise them
    from a browser session). Every other surface is untouched and rejects
    scan bearers by construction (unknown to mobile auth). Scan tokens can
    never mint a session cookie: `/api/pairing/session` reads only the
    mobile store.
  - Hub enforcement (independent, per the review): the hub proxies a
    scan-bearer request only when the path matches
    `/<slug>/api/scan/…` and the bearer verifies against that box's scan
    store; scan bearers on any other path are 401'd at the hub. Both
    processes enforce; neither trusts the other (principle #3:
    validate at boundaries — both boundaries).
  - Minting UX: a `scanTokens.create` tRPC procedure (owner-authed, named
    token, shows the secret once), plus `list`/`revoke`. Same
    pairing-ticket indirection is unnecessary — the boxholder copies the
    token into the uploader config by hand once.
  - Provenance: the upload route records the token name into the quarantine
    entry sidecar; promote passes it through so the session card carries
    `source: scan-upload/<token-name>` (see Track 2's provenance plumbing).
- **Vocabulary lock-ins:** store file
  `.beebox/scan-tokens.secret.json`; provenance string
  `scan-upload/<token-name>`; tRPC router name `scanTokens`.
- **First implementation chunk:** the store helper (extracted +
  parameterized from `pairing.ts`) + `scanTokens` tRPC procedures + the
  route preHandler, with doctests proving (a) a scan token passes the scan
  routes, (b) a scan token is rejected by the general auth preHandler, tRPC,
  and `/api/pairing/session`, (c) a mobile device token is NOT accepted by
  the scan preHandler's scan-store path (only a full owner identity is),
  (d) revocation works, (e) the hub 401s a scan bearer on a non-scan path.

### Track 2 — Upload route, wire contract, quarantine, validation

- **What:** Two raw Fastify routes per box (raw, not tRPC, per the
  CLAUDE.md rule that file upload doesn't fit the tRPC shape), a quarantine
  directory, and an inline validation stack. This is the server half of the
  wire contract; Track 5 is the client half.
- **Why this needs to change:** no existing route accepts an upload outside a
  chat context. Bulk-upload requires a `targetSessionId` and delivers to
  chat's `tmp-upload/`; capture delivers to chat. Scans are inbox-shaped.
- **Direction — the wire contract** (documented in
  `docs/scan-upload-contract.md`, the single coordination point named in
  breadcrumbs on both sides):
  - `POST /api/scan/check` — body `{ "hashes": ["<sha256>", …] }`, response
    a **per-hash state map**, not a membership bit:
    `{ "states": { "<sha256>": { "state": "unknown" | "pending" | "imported"
    | "rejected", "reason"?: "…" } } }`. `pending` = validated, in
    quarantine, awaiting promote; `imported` = in the upload ledger
    (`.beebox/uploads.json`); `rejected` includes the rejection
    reason. The client's disposition logic keys on these distinctly (see
    Track 5): collapsing rejected and imported into "known" would let the
    client trash the only copy of a rejected file, and a crash between PUT
    and disposition would otherwise strand files as forever-"known"
    without a confirmation (review finding 2).
  - `PUT /api/scan/files/<sha256>` — body is the raw bytes
    (`application/octet-stream`, streamed to disk via the bulk-upload
    passthrough-parser pattern, `bulk-upload.ts:80-90`, metered — see
    Limits); metadata in headers: `X-Upload-Filename` (required, same
    header as bulk-upload), `X-Scan-Profile` (optional, free-text scanner
    profile name). The hash in the path is the idempotency key: the server
    hashes the received bytes and responds 422 on mismatch
    (truncation/corruption defense), 200
    `{ "status": "accepted" }` on success, 200 `{ "status": "duplicate" }`
    for an already-`pending`/`imported` hash, 422
    `{ "status": "rejected", "reason": "…" }` on validation failure.
    Re-PUT of a previously **rejected** hash re-runs validation rather than
    replaying the cached verdict — that is the deliberate retry path after
    a validator fix, and it is idempotent (review finding 2).
  - Auth: `Authorization: Bearer <scan-token>` (Track 1), or a full owner
    identity.
  - Limits: Fastify's `bodyLimit` does **not** meter a passthrough parser
    (the raw stream bypasses the string/buffer collection path), so the
    route meters the stream itself the way bulk-upload actually does —
    reuse `addFileStreamed`'s byte-metering
    (`src/core/capture/staging-stream.ts:76`), plus an early
    `Content-Length` check; overflow deletes the partial temp file and
    413s (review finding 8). Per-token rate limit (60 requests/min — an
    order of magnitude above real scanner cadence) that 429s with
    `Retry-After` and logs at `warn`.
- **Direction — quarantine and validation:** files land in
  `tmp/scan-quarantine/<sha256>.<ext>` with a sidecar `<sha256>.json`
  carrying the entry's **durable state machine** — `state: "pending" |
  "promoting" | "imported" | "rejected"`, original filename, token name,
  profile, received-at, and (for rejected) `reason` plus `question-ref`
  once a question card exists. The sidecar is the recovery source of truth:
  the promote worker's startup pass re-scans quarantine and resumes
  `promoting` entries (re-running `bbx upload` is safe — the ledger dedups),
  mirroring the bulk-upload worker's persisted-state + startup-resume shape
  rather than approximating it (review finding 4). Quarantine has its own
  GC (the generic `tmp/` sweep skips directories entirely —
  `src/core/housekeeping.ts:55` `if (!stat.isFile()) continue;` — so
  nothing else will clean it): `imported` entries are deleted on the next
  promote pass; `rejected` entries are deleted 30 days after their
  question card is resolved, and their hash stays answerable as `rejected`
  via a compact rejection ledger kept in the sidecar dir until then.
  `question-ref` makes question emission idempotent across repeated
  promote runs (review finding 7).
  Validation runs inline in the PUT, before the 200: (1) magic-byte sniff via
  `file-type`, must be in the allowlist (`application/pdf` + the image types
  from `SUPPORTED_IMAGE_EXTENSIONS`, `upload-helpers.ts:15`) and must agree
  with the claimed extension; (2) structural check — `qpdf --check` for PDFs,
  `sharp` decode for images. All checks are sub-second, so inline is safe and
  gives the client a truthful per-file verdict (principle #3:
  validate-at-boundaries; principle #5: the failure is in the response shape,
  not a log). Rejected files stay in quarantine with `"rejected"` in the
  sidecar and surface as a question card on the next promote run (principle
  #4: never silent). ClamAV is deliberately absent — the threat model is
  parser exploits and type smuggling, not commodity malware, and nothing in
  this pipeline executes uploaded bytes; the boxholder concurred.
- **Direction — promote worker:** an async, debounced worker (per box,
  in-process alongside the route) drives `pending` quarantine entries
  through the sidecar state machine under a per-box cross-process
  promotion lock (`src/lib/file-lock.ts` — the route process and any CLI
  invocation must serialize). For each batch: mark `promoting`,
  **materialize each file into `tmp/scan-staging/` under its original
  sanitized filename from the sidecar** — not its hash name — because
  scan-import's image grouping keys on scanner `<prefix>_NNN` names
  (`upload-helpers.ts:37`) and the document path records
  `path.basename(input)` as the original name; hash-named inputs would
  wreck grouping and provenance (review finding 6). Then run the `upload`
  command with kind `scan` (`upload.ts:45`) → ledger dedup → scan-import,
  mark `imported`, clean staging. Two existing helpers get locking as part
  of this chunk: the upload ledger's read-modify-write
  (`upload-helpers.ts:167` — unlocked, fixed `.tmp` name) and
  `createOrAppendIntakeJob`'s find/read/append/write
  (`intake-utils.ts:40,112`) — both wrapped with `file-lock.ts` /
  `withCardLock` so a concurrent wakeup's connector sync cannot lose
  updates (review finding 4). Batch settle: the worker runs when no new
  PUT has arrived for 2 minutes, so a 10-document session becomes one
  scan-import batch and one wakeup, not ten.
- **Direction — provenance plumbing:** `upload`/`scan-import` gain an
  optional `--source <string>` argument, and the `capture-session` schema
  gains an optional `source` field (additive; existing cards valid),
  carrying `scan-upload/<token-name>` from sidecar to card. Today neither
  command accepts provenance and the schema has no such field (review
  finding 6) — this is a small, explicit extension, not free reuse.
- **Vocabulary lock-ins:** route prefix `/api/scan/`; header `X-Scan-Profile`;
  quarantine dir `tmp/scan-quarantine/`; sidecar states
  `pending | promoting | imported | rejected`; check states
  `unknown | pending | imported | rejected`; PUT statuses
  `accepted | duplicate | rejected`; card field `source`.
- **First implementation chunk:** the two routes + validation stack + sidecar
  writing, with route doctests (via `makeTestServer()`) exercising the
  contract exactly as the client will: check → PUT → duplicate PUT → hash
  mismatch → smuggled extension → structurally broken PDF. Promote worker is
  the second chunk.

### Track 3 — Processing trigger

- **What:** After a promote batch completes, run `bbx wakeup` for the box so
  the intake job drains promptly.
- **Why this needs to change:** scan-import ends at
  `createOrAppendIntakeJob`; jobs drain only when something runs `bbx wakeup`.
  Prod default schedules are connector-specific (`src/core/box/defaults.ts`
  — check-email, check-calendar, etc.; no plain periodic wakeup), so without
  a trigger a scan session sits until an unrelated wakeup happens.
- **Direction:** after a batch reaches `imported`, the worker records a
  durable `wakeup-pending` marker (a small file beside the sidecars) and
  runs a **supervised, full (unscoped)** `bbx wakeup` — awaited with output
  captured, not fire-and-forget — clearing the marker on success and
  retrying on the next worker pass otherwise. Two facts force this shape
  (review finding 5): wakeup is *not* globally locked (only the reactor
  phase takes `.bbx-reactor.lock`, `src/core/reactor/engine.ts:110`;
  `src/cli/commands/doctor.ts:51` documents wakeup as otherwise unlocked),
  so "the lock handles overlap" was wrong — the promotion lock plus
  supervised await is our serialization; and connector-scoped wakeups
  filter jobs by `source` (`src/cli/commands/wakeup.ts:117`), so a
  `source: scan` job would *never* drain on the default connector-scoped
  schedules — a lost spawn is not "latency," it is indefinite, hence the
  durable marker + retry (principle #4: never silent). Direct invocation,
  not a scheduled-script card: the one-shot-card pattern was retired
  (`src/core/migrations.ts:106-110`) and reintroducing it would fork the
  vocabulary (principle #8).
- **First implementation chunk:** part of the promote-worker chunk in
  Track 2; listed as its own track because it is a distinct design decision.

### Track 4 — Docling document mode and `document.card`

> **Note (2026-08-24):** the card type described below as `document` was
> renamed to `pdf` (`*.pdf.card`) — `document` collided with the unrelated
> `doc.card` type. The pipeline only reads PDFs today, so the
> avoid-a-future-rename rationale for the generic name stopped paying for
> itself; `format:` still records the source type. This section is left as
> written for the historical record; see `src/schemas/pdf.ts` for current
> behavior.

- **What:** Replace document-mode's verbatim-storage internals with a Docling
  extraction pass producing a generic `document.card`. This amends
  `docs/plans/pdf-intake-design.md`; that doc gains a pointer here and its
  superseded sections are marked.
- **Why this needs to change:** today a text-layer PDF is stored as an opaque
  `source.file.card` (`scan-import-document.ts`) — no searchable text, no
  page renders, no table structure. The pdf-intake design solves this but
  predates two facts: Docling's hybrid OCR does not exist (Prior art), and
  the card type should not be PDF-specific.
- **Direction — amendments to pdf-intake-design.md:**
  1. **`document.card`, not `.pdf.card`.** The card means "extracted document
     with provenance and structured text"; Docling ingests docx/html/etc.
     through the same path, and pdf-intake's own future-review section
     anticipated this. A `format:` frontmatter field (e.g. `pdf`) carries the
     source type. Everything else keeps the pdf-intake shape: rendered
     markdown as the body, `docling.ref` to gzipped `DoclingDocument` JSON,
     page renders + figures as AVIF assets (encoded by `sharp`) in the attach
     scope, provenance fields as a superset of `.file.card`, lifecycle
     `new → analyzed | invalid`. Choosing the general name now avoids a
     rename migration later (principle #1: the type is the structure).
  2. **`do_ocr=False` is the default**, not hybrid OCR. ScanSnap emits its
     own text layer; Docling contributes layout, reading order, and tables.
     `bbx document reanalyze --force-ocr` remains the escape hatch for junk
     text layers (accepting the known long-document force-OCR bug as an
     escape-hatch-only risk). No OCR model weights deploy — the model
     pre-fetch shrinks to layout + TableFormer (~100 MB).
  3. **Dispatch boundary — this track adds the text-layer split.** Today
     every PDF goes to document mode unconditionally
     (`scan-import.ts:117-118`; the textless-PDF-to-photo-flow route does
     not exist — corrected after review finding 6). Track 4 adds the
     check: PDF **with** an embedded text layer → this Docling document
     mode; PDF **without** one (a photo batch saved as PDF) → render pages
     (Docling's page renders or `pdftoppm`) → the existing Gemini photo
     flow, which handles front/back pairing — the boxholder's photo case.
     All-image input keeps going straight to the photo flow. The batch
     question is settled at the scanner: ScanSnap profiles are configured
     one-PDF-per-scan-job, so multi-document splitting stays out of scope
     (as pdf-intake also deferred).
- **Direction — mechanics:** shell out to `uvx docling` (JSON + markdown +
  page/figure images), gzip the JSON, `sharp`-encode images to AVIF, write
  `document.card` + assets into the session attach scope, stage via the
  existing annex path. On Docling failure: `status: new` card with an
  `error:` field and the original PDF as the only asset — the current
  verbatim behavior becomes the failure fallback, so extraction failure never
  blocks intake (principle #4: resilient, and the error field keeps it
  non-silent). Deploy: add `uv` install + model pre-fetch + `qpdf` to
  `deploy/setup-server.sh` beside the existing apt line (`setup-server.sh:19`).
- **Vocabulary lock-ins:** card type `document`; frontmatter fields `format:`,
  `docling.ref:`; command name `bbx document reanalyze`.
- **First implementation chunk:** the `document` schema + a
  `runDoclingExtraction` wrapper with a doctest against a fixture PDF
  (Docling faked via the services pattern — the real binary is exercised by
  one gated integration doctest), leaving `scan-import-document.ts` calling
  it behind the existing entry point.

### Track 5 — The stand-alone uploader

- **What:** A new monorepo package `scan-uploader/` — TypeScript, zero
  runtime dependencies (Node stdlib: `crypto`, `fetch`, `fs`), bundled by
  esbuild into a single self-contained `.mjs` runnable with plain `node` on
  any machine, no `bbx`, no checkout, no install. The client half of the
  Track 2 wire contract.
- **Why this needs to change:** nothing exists on the laptop side, and the
  boxholder wants it stand-alone ("`bbx` isn't necessarily something running
  locally here"). The `dist/cli.mjs` bundle precedent gives Go-style
  copy-one-artifact deployment without adding a language.
- **Direction — behavior:** config JSON next to the bundle maps folders to
  targets: `{ folder, serverUrl, box, tokenPath, disposition }`. Each run:
  walk each folder (non-recursive; skip `imported/`), apply the **settle
  gate** (skip files whose size or mtime changed within the last 10 seconds —
  ScanSnap writes multi-page PDFs incrementally, and a truncated upload would
  pass the hash-integrity check because truncated bytes hash consistently),
  then for each surviving file: **snapshot its identity** (device, inode,
  size, high-resolution mtime), hash it, `POST /api/scan/check`, PUT each
  `unknown` (and optionally retry `rejected` — see below), and apply the
  per-folder disposition **only after both a confirmed
  `accepted`/`duplicate`/`imported` response AND a restat showing the
  identity snapshot unchanged**. The restat closes the gap the settle gate
  alone leaves open: the scanner can replace or append to the file after
  the uploader reads EOF but before disposition, and moving/trashing the
  now-different file would silently lose the only copy — the server
  accepted an earlier byte sequence and there is no next sweep (review
  finding 3). On any identity change: leave the file untouched; the next
  run re-hashes it.
  - `keep` (default) — leave in place; the remote ledger makes re-sweeps
    no-ops.
  - `archive` — move to `<folder>/imported/`.
  - `trash` — move to macOS Trash (`trash` CLI when present, `osascript`
    Finder fallback); never `unlink`.
  Check-state handling: `pending`/`imported` count as confirmed (covers a
  prior run that crashed between PUT and disposition — review finding 2);
  `rejected` files are never dispositioned — they stay in place, print
  with their server-side reason, and make the exit code non-zero
  (principle #5: failure in the signature); a `--retry-rejected` flag
  re-PUTs them (the server re-validates).
- **Direction — invocation:** ScanSnap's post-scan application hook calls a
  one-line shell wrapper around `node scan-uploader.mjs`; the same command is
  the manual/periodic sweep. Idempotency comes from the check endpoint, so
  hook-plus-sweep double-runs are harmless.
- **Direction — breadcrumbs (the no-shared-code coordination):** the uploader
  and the server share no code, so every coordination point is marked on both
  sides with the same comment: `// WIRE CONTRACT (scan-upload): must match
  docs/scan-upload-contract.md — change both sides together.` The marked
  points: the two route shapes, the header names, the response-status
  vocabulary, the hash algorithm (SHA-256, lowercase hex), and the settle/
  disposition semantics that depend on response statuses. The contract doc
  lists both file locations, and the server route doctests exercise the
  contract exactly as the client sends it — they are the executable side of
  the breadcrumb (principle #12: the maintainer is usually an agent; make the
  coupling greppable).
- **Vocabulary lock-ins:** package name `scan-uploader`; config keys
  `folder, serverUrl, box, tokenPath, disposition`; disposition values
  `keep | archive | trash`.
- **First implementation chunk:** hash/walk/settle + check-endpoint client
  with doctests against a fake server; PUT + disposition second.

### Track 6 — Box readiness

*(Reshaped 2026-08-01 by the `scan-guide-card.md` subplan: scanner priors
are now a guide card, not a bespoke file.)*

- **What:** Scanner priors live in `config/scan.guide.card` (the guide
  system's evidence model: confidence/source-tagged beliefs, compiled
  in-memory into the vision prompt by `resolveScanGuideContext`,
  `src/core/commands/scan-guide-context.ts`); `CLAUDE_SCANS.md` is a
  deprecated, warning-logged fallback. Per-box content: `scan.guide.card`
  drafts for the family and estate boxes (`scratch/box-readiness/`); triage
  landmark destination cards in the estate box matching its existing
  `store/documents/README.md` taxonomy (`property/ financial/ legal/
  personal/`) — categories are landmark cards discovered by glob, so that
  part stays content, not code.
- **Why:** without priors the photo flow misreads names/dates; without
  landmark destinations, triage has no scanned-document categories to route
  to. And a *flat* priors file is actively dangerous: the
  `scratch/model-comparison/` experiment showed the model deferring to an
  unconfirmed machine transcription recorded in the draft file over its own
  better reading — the guide card's confidence tagging keeps
  hypothesis-level beliefs out of the compiled prompt entirely. The estate
  `bill` schema's `sources[]` field already provides the provenance link
  from a filed bill back to its scanned source card; no schema change
  needed.
- **Design and migration:** `docs/plans/scan-guide-card.md` (subplan) —
  seed template, extraction-side swap, question `learning:` hook, and the
  test1 migration runbook.

## Subplans

None. The one candidate — multi-document PDF splitting — is explicitly out of
scope rather than a subplan, because the scanner-side convention (one PDF per
scan job) removes the need rather than deferring a design.

## Failure modes

> **Critical gap (resolved in-plan):** scan-import on a manifest-scheme prod
> box commits wrong — errors or strands unmanifested bytes. Track 0 is a hard
> prerequisite; Track 2's routes refuse (503, logged `error`) if the box is
> not annex-shaped, so a sequencing mistake fails loud, not silent. Implemented
> as `isAnnexBox()` (`src/core/annex/is-annex-box.ts`): probed once at route
> registration, and again at the top of every promote pass, since a box can be
> de-annexed while the server runs.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| ScanSnap writes a file mid-sweep; uploader hashes a truncated PDF | planned (uploader doctest with a growing fixture file) | settle gate + identity snapshot + restat-before-disposition (Track 5) are the real defense: e2e testing showed `qpdf --check` *reconstructs* a truncated PDF with a well-formed prefix (exit-3 warnings, accepted) and hard-rejects only unparseable corruption — so a settled-but-truncated file self-heals only because disposition is blocked on the restat; the completed file has a different hash and uploads next sweep | clear — and the truncated upload is visible as a duplicate-ish session, not silent |
| Scanner replaces the file between uploader EOF and disposition | planned (uploader doctest: mutate fixture mid-run) | restat vs identity snapshot; on mismatch leave file, retry next run (Track 5) | clear |
| Uploaded bytes don't match the path hash (network corruption, client bug) | planned (route doctest) | server re-hashes, 422 on mismatch; client leaves file in place and retries next sweep | clear |
| Smuggled type (e.g. HTML renamed `.pdf`) | planned (route doctest) | magic-byte sniff + extension agreement check, 422 `rejected` | clear |
| Structurally broken but correctly-typed PDF | planned (route doctest) | `qpdf --check` fails → `rejected`, stays in quarantine, question card on next promote | clear |
| Docling crashes / hangs on a valid PDF | planned (faked-docling doctest for the error path) | `status: new` card with `error:` field, original PDF preserved; timeout kills the subprocess | clear — card is visibly unextracted |
| Docling emits empty markdown | planned | `status: analyzed`, empty body — "no readable content" (pdf-intake's decision, kept) | clear enough — body absence is visible |
| Promote worker dies mid-batch (server restart) | planned (worker doctest: restart resumes) | sidecar state machine is the durable state; startup pass resumes `promoting` entries and recovers both quarantine and staging (re-running `bbx upload` is ledger-deduped) | clear |
| Crash in the window between scan-import's commit and the ledger write | no (accepted risk) | none — a startup re-drive re-runs upload and creates a duplicate session card. Documented risk: the window is milliseconds wide, the consequence is a visible duplicate inbox session (triage-able, no data loss), and closing it needs a durable pre-dispatch reservation `scan-import` recognizes — not worth the machinery (implementation-phase Codex finding, accepted) | visible duplicate, not silent |
| `bbx wakeup` run fails after promote | planned (worker doctest) | durable `wakeup-pending` marker + supervised retry on next worker pass (Track 3). NOTE: connector-scoped scheduled wakeups do NOT drain `source: scan` jobs (`wakeup.ts:117`), so without the marker this failure would be indefinite, not latency | clear (logged + retried) |
| Token leaks | n/a (operational) | scope limits blast radius to feeding quarantine; rate limit caps volume; revocation one-line; provenance on every card identifies the device | clear after the fact via provenance |
| Hash-membership oracle via `/check` | n/a (accepted risk) | none — a `scan-upload` token holder can test whether a specific file was ever uploaded | documented here; accepted: smallest possible read surface, confined to scan hashes |
| Uploader's Trash disposition on a non-Mac | planned (unit test of platform guard) | `trash` disposition refuses with a clear error on non-darwin platforms rather than falling back to `unlink` | clear |
| Rate limit trips during a legitimate huge session | planned (route doctest) | 429 with `Retry-After`; uploader backs off and resumes; nothing lost (files stay local) | clear |
| Quarantine fills with rejected files | planned (worker doctest) | scan-specific GC in the promote worker (Track 2): `imported` entries deleted next pass, `rejected` deleted 30 days after question resolution. The generic `tmp/` sweep does NOT cover this — it skips directories (`housekeeping.ts:55`) | clear |
| Repeated promote runs re-emit questions for the same rejected file | planned (worker doctest) | `question-ref` recorded in the sidecar makes emission idempotent (Track 2) | clear |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — the reactor triaging a scan session picks a
  wrong category. **ADDRESSED** by the existing triage confidence machinery
  (guess-level routes to `_unsure` + question card, `docs/triage.md`); Track 6
  landmark destinations give it correct categories to choose from.
- **Stale ref** — a `document.card`'s `docling.ref` or figure refs point into
  its own attach scope, moved atomically with the card; same-scope refs
  cannot go stale independently. **ADDRESSED** by construction (attach-scope
  refs, `ref-path.ts` semantics).
- **Two agents touching the same card** — promote worker commits a session
  card while a wakeup-triggered reactor is running. **ADDRESSED**:
  scan-import commits before the supervised wakeup (Track 3 ordering); the
  reactor phase holds `.bbx-reactor.lock` (`src/core/reactor/engine.ts:110`);
  and Track 2 adds locking around the two genuinely racy helpers — the
  upload ledger's read-modify-write and `createOrAppendIntakeJob`'s
  find/read/append/write — which are unlocked today (review finding 4;
  wakeup as a whole is *not* locked, so the plan does not rely on it).
- **Hand-edit drift** — boxholder hand-edits a `document.card`'s frontmatter.
  **ADDRESSED** by the standard card-validation hooks (schema validation on
  commit); nothing scan-specific needed.
- **Fabricated free-form value** — the photo flow inventing names is the
  known risk; the scan guide seed's default triage rule instructs
  disambiguation-only (as `buildScanPrompt`'s guardrail also does), and both
  Track 6 guide-card drafts carry the same rule; hypothesis-confidence
  beliefs are stripped from the compiled prompt so unconfirmed readings
  can't feed back in. **ADDRESSED** (`scan-guide-card.md` subplan). The
  document path has no generative step at intake (`description` stays
  empty, filled downstream — pdf-intake's decision, kept).
- **Validation error UX** — rejection reasons are written for the question
  card the boxholder reads (e.g. "the magic bytes match no known file type,
  but the filename claims .pdf" — `file-type` sniffs binary formats, so a
  non-binary smuggle reads as unknown-type rather than named), not just HTTP
  bodies. **ADDRESSED** in Track 2's sidecar → question card path; verified
  in the e2e walk.
- **Partial migration / transition state** — between Track 0 running on box A
  but not box B, box B's scan routes refuse at registration (see critical-gap
  note). During the window where prod lacks the new code entirely, the
  uploader gets 404s and leaves files local — nothing lost. **ADDRESSED**.

## NOT in scope

- **Multi-document PDF splitting** — solved operationally: ScanSnap profiles
  emit one PDF per scan job. Splitting a mixed batch is a downstream agent
  action if it ever arises (same deferral as pdf-intake).
- **ClamAV / antivirus** — threat model is type smuggling and parser
  exploits, covered by sniff + structural checks; nothing executes uploaded
  bytes; ~1.5 GB resident cost on a modest server. Boxholder concurred.
- **Docling OCR (any mode)** — ScanSnap provides the text layer; Docling's
  OCR is its weak axis (Prior art). `--force-ocr` escape hatch only.
- **docling-serve / resident extraction service** — `uvx` per-invocation is
  adequate at scanner volumes; revisit only if latency matters.
- **Retrofitting existing `.file.card` PDFs to `document.card`** — reanalysis
  of the back catalog is a separate decision with its own volume/cost
  questions; `bbx document reanalyze` makes it possible later.
- **Migrating existing image paths off ImageMagick onto sharp** — sharp
  enters as a dependency, but converting `describe-images` etc. is unrelated
  churn.
- **ScanSnap Cloud / scanner-direct upload** — the boxholder scans to local
  folders; no cloud integration.
- **A general-purpose scoped-permission system** — exactly one new
  credential kind (the scan token, its own store, its own routes); a full
  capability matrix retrofitted into mobile auth is speculative until a
  second restricted consumer exists — and cross-model review showed the
  retrofit is where the danger lives.
- **Non-Mac uploader polish** — the uploader is platform-neutral except the
  `trash` disposition, which is Mac-only and guarded; Windows/Linux Trash
  support waits for a real need.
- **Bun-compiled single binary** — `node <bundle>.mjs` suffices; the Bun
  escape hatch is noted, not taken.

## Open design questions

- **Where the mint-token UI lives**: the `scanTokens` tRPC procedures are
  settled (Track 1); whether the browser surface is a small admin-page
  section or CLI-only for now is cosmetic and does not block Track 1's
  chunk. Lean: admin-page section, since revocation wants a visible list.
- **`X-Scan-Profile` → box routing hint**: for now the box is fixed by the
  URL path (per-box routes); the profile header is provenance only. If a
  future single-folder-multi-box setup appears, the header could carry
  routing — deliberately not designed now.
- **Quarantine question-card cadence**: one question card per rejected file,
  or one rolling "rejected scans" card per box? Lean: per-file, matching how
  scan-import already emits per-item question cards; revisit if rejection
  volume ever makes that noisy.

## Knowledge audits

New agent-facing concepts and their audit posture
(`src/dev/knowledge-audits.yaml`):

- **`document.card` (type, lifecycle, `format:`/`docling.ref:` fields)** —
  one `knows_directly` entry: the agent can state what a `document.card` is,
  where its original bytes live, and what `status: new` + `error:` means,
  from CLAUDE.md/schema instructions without re-reading source.
- **Scan provenance (`source: scan-upload/<device>`)** — one `knows_directly`
  entry: the agent processing an intake job can say where a scanned session
  came from and what the scan guide (`config/scan.guide.card`) is for.
- **The wire contract itself** — skip, with rationale: purely infrastructural;
  no box agent ever constructs an upload request. The breadcrumb comments and
  contract doc serve the maintainer agent, which reads code, not recall.
- Audits land run (`pnpm knowledge-audit run --box <path-to-test-box>
  --filter scanner-ingest`) with status comments recorded before the plan
  completes.

## Implementation order

1. **Track 1** — scoped tokens (schema + resolver + doctests). Unblocks
   Track 2's auth.
2. **Track 2 chunk 1** — routes + validation + quarantine + contract doc +
   route doctests.
3. **Track 4** — `document` schema + Docling wrapper + amended
   scan-import-document + deploy additions (`uv`, `qpdf`, model pre-fetch).
   Independent of 1–2; testable locally against a local box; can proceed in
   parallel with them.
4. **Track 2 chunk 2 / Track 3** — promote worker + wakeup spawn + worker
   doctests.
5. **Track 0** — prod annex migration (dry-run against backup clone, runbook,
   then the real cutover with the boxholder). Sequenced late so the prod
   window is short, but it gates end-to-end testing on prod, so it may move
   earlier at the boxholder's convenience.
6. **Track 5** — `scan-uploader` package (chunk 1: walk/settle/hash/check;
   chunk 2: PUT + dispositions + wrapper script), plus ScanSnap profile
   setup notes in the contract doc's companion section.
7. **Track 6** — `scan.guide.card` drafts × 2 + estate landmark
   destinations (engine-side swap in the `scan-guide-card.md` subplan).
8. **End-to-end verification** — a real scan session through each box:
   document PDF → `document.card` in inbox → triaged; photo batch →
   photo flow → triaged. Knowledge audits run.

Dependencies: 2 needs 1; 4 needs 2-chunk-1 (it invokes the promote path) and
3 (Track 4's document mode is what promote exercises on PDFs); 6 needs 1–4 on
prod plus 0; 7 anytime; 8 needs everything.

## Rollout shape

- **Test posture** (tests first, as design tools): the wire contract exists
  as route doctests before the uploader exists — they are the executable
  specification the client is written against. Named doctests:
  `test/webapp/routes/scan-upload.doctest.md` (contract: check/PUT/duplicate/
  mismatch/smuggle/broken-PDF/oversize-stream/rate-limit/token-isolation
  including hub-path rejection),
  `test/core/scan-promote.doctest.md` (worker: batch settle, restart
  resume, wakeup spawn failure), `test/core/commands/pdf-extract.doctest.md`
  (faked Docling: success shape, failure fallback, empty markdown), one gated
  integration doctest running real `uvx docling` on a fixture PDF (skipped
  where Docling absent), and `scan-uploader/test/uploader.doctest.md`
  (settle gate, dispositions, rejected-exit-code) against a fake server.
  Done-when is encoded as these passing plus the Track 8 end-to-end walk.
- **Knowledge audits**: the two entries above land with Tracks 4 and 6
  respectively, run before completion.
- **Migration**: Track 0 is the only data migration — existing tooling,
  dry-run first, boxholder-scheduled cutover, local backups as rollback. No
  card-shape migration: `document.card` is net-new (existing `.file.card`
  PDFs are explicitly not retrofitted), and the token-store `scope` field is
  additive with a safe default.
- **Ship**: the plan ships as one unit from this worktree when all tracks
  complete — merge to main (auto-deploys the server code), then Track 0
  cutover if not already done, mint tokens, install the uploader bundle +
  config on the laptop, create the ScanSnap profiles, run Track 8. Per the
  worktree rule, the merge itself waits for the boxholder's explicit go.
