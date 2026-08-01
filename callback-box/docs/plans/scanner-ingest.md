# Scanner Ingest

**Status:** active — design, not yet implemented

A pipeline from a ScanSnap desktop scanner to triage-ready cards in a hosted
box. ScanSnap profiles save searchable PDFs and images into per-box folders on
the boxholder's laptop. A stand-alone uploader sends new files to
cb.ianbicking.org with a scoped, upload-only credential. The server validates
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
- `callback-box/CLAUDE.md` — "Never change credentials to unblock yourself"
  (token minting is boxholder-initiated); "Keep source and docs generic — never
  hardcode personal names" (the uploader config carries box slugs; source
  stays generic); the tRPC-vs-raw-Fastify rule ("Raw Fastify routes … are only
  for things that don't fit the tRPC request/response shape: file
  upload/download" — this is file upload, so raw routes are correct).
- `callback-box/code-style.md` — Result-vs-throw for the wire contract's
  failure shapes; no default parameters; custom error classes.
- Precedents (denser than docs): the mobile pairing/device-token machinery
  (`src/core/mobile/pairing.ts`), the bulk-upload streaming route
  (`src/webapp/routes/bulk-upload.ts`), the upload dedup ledger
  (`src/core/commands/upload-helpers.ts`), and `docs/plans/pdf-intake-design.md`
  (this plan amends it — see Track 4).

## What already exists

Reuse throughout; the only rebuilt piece is the document-mode internals
(Track 4), justified there.

- **Scan entry point and dedup ledger** — `cb upload --as scan` with SHA-256
  content-hash dedup. `src/core/commands/upload-helpers.ts:1-4`: *"Helpers for
  the `upload` command — content-hash dedup ledger and streaming SHA-256 of
  files. The ledger lives at `.callback-box/uploads.json` (per-box, untracked)
  and survives file renames/relocations because it keys on content."*
  `src/core/commands/upload.ts:45`: `const SUPPORTED_KINDS = ["scan"] as
  const;` — the kind dispatcher was built as a plug point. **Reused** as the
  server-side entry after validation, and its ledger doubles as the remote
  side of the uploader's dedup negotiation (Track 2).
- **scan-import** — `src/core/commands/scan-import.ts` dispatches: all-images
  → photo flow (Gemini analysis, front/back pairing, question cards); single
  PDF with text layer → document mode; textless PDF → rendered pages → photo
  flow. Output is a `capture-session` card + attach scope in `box/inbox/`,
  committed with `Created-By: scan-import`, then
  `createOrAppendIntakeJob` (`src/connectors/intake-utils.ts:36-38`: *"Create
  a new intake job or append items to an existing pending one from the same
  source."*). **Reused**; Track 4 replaces only the document-mode internals.
- **Per-box scan priors** — `src/core/commands/scan-import-session.ts:47-49`:
  `readScanContextFile` reads `CLAUDE_SCANS.md` from the box root into the
  per-page analysis prompt. **Reused**; Track 6 authors the files for the two
  boxes (test1's is the template).
- **Bearer-token auth that traverses the hub** — the mobile device-token
  store, `src/core/mobile/pairing.ts:9`:
  `.callback-box/mobile-devices.secret.json`, with hashed tokens, pairing
  tickets (10-min TTL, `pairing.ts:12`), revocation, and dual verification by
  hub and box child (`pairing.ts:14-16` comment; hub side
  `src/hub/hub-server.ts:161`). **Reused**: Track 1 adds a `scope` field
  rather than a parallel token system (principle #8).
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
- **Scheduler daemon on prod** — `docs/scheduler.md:21`: *"The daemon runs `cb
  tick` every 60 seconds for each configured box."* Relevant background, but
  Track 3 does **not** add a schedule card — see the retired-pattern note
  there.
- **Retired pattern, deliberately not reused** — the capture pipeline once
  auto-created a one-shot `process-captures` scheduled-script;
  `src/core/migrations.ts:106-110` prunes it (*"Prune the retired
  process-captures procedure card + its one-shot trigger"*). Captures now
  deliver into chat. Scans are inbox/triage-shaped, not chat-shaped, so this
  plan triggers processing by running `cb wakeup` directly from the promote
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

### Track 1 — Scoped upload tokens

- **What:** Add a `scope` field to the mobile device-token store and a
  `scan-upload` scope that authorizes only the Track 2 routes.
- **Why this needs to change:** the boxholder wants an uploader credential
  with a deliberately small blast radius — "it can blindly upload to a known
  location … due to the limited amount it can do we wouldn't be creating a
  huge hole." Today a device token is full box access; nothing narrower
  exists.
- **Direction:** Extend the device record schema in
  `src/core/mobile/pairing.ts` with `scope: "full" | "scan-upload"`
  (default `"full"` for existing records — additive, no migration).
  `resolveMobileRequestAuth` (`src/core/mobile/request-auth.ts:54`) returns
  the scope; the Track 2 routes require `scan-upload` or `full`; every other
  authenticated surface requires `full`. Enforcement lives in one place — the
  auth resolver's result type — so a new route cannot forget to check
  (principle #2: make the compiler ask). Pairing UX: the existing
  `pairing.create` tRPC procedure gains an optional `scope` input; the
  boxholder mints a scan token from the browser exactly like pairing a phone.
  Revocation and hashed storage come free from the existing store.
  Provenance: the upload route records the device name into the quarantine
  entry, and scan-import carries it onto the session card as
  `source: scan-upload/<device-name>`.
- **Vocabulary lock-ins:** scope names `full` and `scan-upload`; the
  provenance string `scan-upload/<device-name>`.
- **First implementation chunk:** schema + resolver change with doctests
  proving (a) an unscoped legacy record reads as `full`, (b) a `scan-upload`
  token is rejected by a `full`-gated route, (c) revocation works unchanged.

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
    `{ "unknown": ["<sha256>", …] }`. Answered from the Track 2 ledger wrapper
    around `.callback-box/uploads.json` plus the current quarantine contents
    (so an uploaded-but-not-yet-promoted file is not re-requested).
  - `PUT /api/scan/files/<sha256>` — body is the raw bytes
    (`application/octet-stream`, streamed to disk via the bulk-upload
    passthrough-parser pattern, `bulk-upload.ts:80-90`); metadata in headers:
    `X-Upload-Filename` (required, same header as bulk-upload),
    `X-Scan-Profile` (optional, free-text scanner profile name). The hash in
    the path is the idempotency key: the server hashes the received bytes and
    responds 422 on mismatch (truncation/corruption defense), 200 with
    `{ "status": "accepted" }` on success, 200 `{ "status": "duplicate" }` if
    already known, 422 `{ "status": "rejected", "reason": "…" }` on
    validation failure.
  - Auth: `Authorization: Bearer <token>` with scope `scan-upload` or `full`
    (Track 1).
  - Limits: existing 50 MB body cap; plus a per-token rate limit (60
    requests/min — an order of magnitude above real scanner cadence) that 429s
    and logs at `warn`.
- **Direction — quarantine and validation:** files land in
  `tmp/scan-quarantine/<sha256>.<ext>` with a sidecar
  `<sha256>.json` (original filename, device name, profile, received-at).
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
  in-process alongside the route, same shape as the bulk-upload worker)
  sweeps validated quarantine entries, moves them into `tmp/scan-staging/`,
  and runs the `upload` command with kind `scan` (`upload.ts:45`), which
  dedups against the ledger and invokes scan-import. Batch settle: the worker
  runs when no new PUT has arrived for 2 minutes, so a 10-document session
  becomes one scan-import batch and one wakeup, not ten.
- **Vocabulary lock-ins:** route prefix `/api/scan/`; header `X-Scan-Profile`;
  quarantine dir `tmp/scan-quarantine/`; response statuses
  `accepted | duplicate | rejected`.
- **First implementation chunk:** the two routes + validation stack + sidecar
  writing, with route doctests (via `makeTestServer()`) exercising the
  contract exactly as the client will: check → PUT → duplicate PUT → hash
  mismatch → smuggled extension → structurally broken PDF. Promote worker is
  the second chunk.

### Track 3 — Processing trigger

- **What:** After a promote batch completes, run `cb wakeup` for the box so
  the intake job drains promptly.
- **Why this needs to change:** scan-import ends at
  `createOrAppendIntakeJob`; jobs drain only when something runs `cb wakeup`.
  Prod default schedules are connector-specific (`src/core/box/defaults.ts`
  — check-email, check-calendar, etc.; no plain periodic wakeup), so without
  a trigger a scan session sits until an unrelated wakeup happens.
- **Direction:** the promote worker spawns `cb wakeup` (detached, logged)
  after scan-import finishes. Direct invocation, not a scheduled-script card:
  the one-shot-card pattern was retired (`src/core/migrations.ts:106-110`)
  and reintroducing it would fork the vocabulary (principle #8). The wakeup's
  existing lock discipline handles overlap with a concurrently scheduled
  wakeup.
- **First implementation chunk:** part of the promote-worker chunk in
  Track 2; listed as its own track because it is a distinct design decision.

### Track 4 — Docling document mode and `document.card`

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
     `cb document reanalyze --force-ocr` remains the escape hatch for junk
     text layers (accepting the known long-document force-OCR bug as an
     escape-hatch-only risk). No OCR model weights deploy — the model
     pre-fetch shrinks to layout + TableFormer (~100 MB).
  3. **Dispatch boundary:** scan-import's existing three-way dispatch stands.
     Images and textless PDFs → Gemini photo flow (front/back pairing — the
     boxholder's photo case — already handled there). Text-layer PDFs →
     this document mode. The batch question is settled at the scanner:
     ScanSnap profiles are configured one-PDF-per-scan-job, so multi-document
     splitting stays out of scope (as pdf-intake also deferred).
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
  `docling.ref:`; command name `cb document reanalyze`.
- **First implementation chunk:** the `document` schema + a
  `runDoclingExtraction` wrapper with a doctest against a fixture PDF
  (Docling faked via the services pattern — the real binary is exercised by
  one gated integration doctest), leaving `scan-import-document.ts` calling
  it behind the existing entry point.

### Track 5 — The stand-alone uploader

- **What:** A new monorepo package `scan-uploader/` — TypeScript, zero
  runtime dependencies (Node stdlib: `crypto`, `fetch`, `fs`), bundled by
  esbuild into a single self-contained `.mjs` runnable with plain `node` on
  any machine, no `cb`, no checkout, no install. The client half of the
  Track 2 wire contract.
- **Why this needs to change:** nothing exists on the laptop side, and the
  boxholder wants it stand-alone ("`cb` isn't necessarily something running
  locally here"). The `dist/cli.mjs` bundle precedent gives Go-style
  copy-one-artifact deployment without adding a language.
- **Direction — behavior:** config JSON next to the bundle maps folders to
  targets: `{ folder, serverUrl, box, tokenPath, disposition }`. Each run:
  walk each folder (non-recursive; skip `imported/`), apply the **settle
  gate** (skip files whose size or mtime changed within the last 10 seconds —
  ScanSnap writes multi-page PDFs incrementally, and a truncated upload would
  pass the hash-integrity check because truncated bytes hash consistently),
  hash the rest, `POST /api/scan/check`, PUT each unknown file, then apply
  the per-folder disposition **only after a confirmed `accepted`/`duplicate`
  response**:
  - `keep` (default) — leave in place; the remote ledger makes re-sweeps
    no-ops.
  - `archive` — move to `<folder>/imported/`.
  - `trash` — move to macOS Trash (`trash` CLI when present, `osascript`
    Finder fallback); never `unlink`.
  A `rejected` response leaves the file in place and prints it; the exit code
  is non-zero if any file was rejected (principle #5: failure in the
  signature).
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

- **What:** Per-box content, no engine code: `CLAUDE_SCANS.md` for the family
  and estate boxes (test1's is the template; injected via
  `readScanContextFile`, `scan-import-session.ts:47-49`); triage landmark
  destination cards in the estate box matching its existing
  `store/documents/README.md` taxonomy (`property/ financial/ legal/
  personal/`) — categories are landmark cards discovered by glob, so this is
  content, not code.
- **Why:** without priors the photo flow misreads names/dates; without
  landmark destinations, triage has no scanned-document categories to route
  to. The estate `bill` schema's `sources[]` field already provides the
  provenance link from a filed bill back to its scanned source card; no
  schema change needed.
- **First implementation chunk:** the two `CLAUDE_SCANS.md` files, written
  with the boxholder (they contain personal names by design — per-box config
  is the sanctioned home for those).

## Subplans

None. The one candidate — multi-document PDF splitting — is explicitly out of
scope rather than a subplan, because the scanner-side convention (one PDF per
scan job) removes the need rather than deferring a design.

## Failure modes

> **Critical gap (resolved in-plan):** scan-import on a manifest-scheme prod
> box commits wrong — errors or strands unmanifested bytes. Track 0 is a hard
> prerequisite; Track 2's routes refuse (503, logged `error`) if the box is
> not annex-shaped (checked once at route registration via the same detection
> `annex/doctor.ts` uses), so a sequencing mistake fails loud, not silent.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| ScanSnap writes a file mid-sweep; uploader hashes a truncated PDF | planned (uploader doctest with a growing fixture file) | settle gate (Track 5); server-side `qpdf --check` rejects most truncations; a settled-but-truncated file self-heals — the completed file has a different hash and uploads next sweep | clear — rejected entry surfaces as question card |
| Uploaded bytes don't match the path hash (network corruption, client bug) | planned (route doctest) | server re-hashes, 422 on mismatch; client leaves file in place and retries next sweep | clear |
| Smuggled type (e.g. HTML renamed `.pdf`) | planned (route doctest) | magic-byte sniff + extension agreement check, 422 `rejected` | clear |
| Structurally broken but correctly-typed PDF | planned (route doctest) | `qpdf --check` fails → `rejected`, stays in quarantine, question card on next promote | clear |
| Docling crashes / hangs on a valid PDF | planned (faked-docling doctest for the error path) | `status: new` card with `error:` field, original PDF preserved; timeout kills the subprocess | clear — card is visibly unextracted |
| Docling emits empty markdown | planned | `status: analyzed`, empty body — "no readable content" (pdf-intake's decision, kept) | clear enough — body absence is visible |
| Promote worker dies mid-batch (server restart) | planned (worker doctest: restart resumes) | quarantine sidecars are the durable state; promote re-scans quarantine on box start, same as bulk-upload's stranded-batch sweep | clear |
| `cb wakeup` spawn fails after promote | planned | logged `error`; intake job still exists and drains on any later wakeup — degradation is latency, not loss | clear (logged), degradation acceptable |
| Token leaks | n/a (operational) | scope limits blast radius to feeding quarantine; rate limit caps volume; revocation one-line; provenance on every card identifies the device | clear after the fact via provenance |
| Hash-membership oracle via `/check` | n/a (accepted risk) | none — a `scan-upload` token holder can test whether a specific file was ever uploaded | documented here; accepted: smallest possible read surface, confined to scan hashes |
| Uploader's Trash disposition on a non-Mac | planned (unit test of platform guard) | `trash` disposition refuses with a clear error on non-darwin platforms rather than falling back to `unlink` | clear |
| Rate limit trips during a legitimate huge session | planned (route doctest) | 429 with `Retry-After`; uploader backs off and resumes; nothing lost (files stay local) | clear |
| Quarantine fills with rejected files | not planned | swept by the existing 7-day `tmp/` sweep (`box-tmp.ts:6`) **after** their question cards exist; sidecar prevents re-accepting the same rejected hash meanwhile | clear |

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
  card while a wakeup-triggered reactor is running. **ADDRESSED**: scan-import
  commits before the wakeup spawn (Track 3 ordering), and wakeup's existing
  lock discipline serializes cycles; the intake job append uses
  `createOrAppendIntakeJob`'s existing find-or-create.
- **Hand-edit drift** — boxholder hand-edits a `document.card`'s frontmatter.
  **ADDRESSED** by the standard card-validation hooks (schema validation on
  commit); nothing scan-specific needed.
- **Fabricated free-form value** — the photo flow inventing names is the
  known risk; `CLAUDE_SCANS.md` explicitly instructs disambiguation-only, and
  Track 6 copies that instruction into both new files. **ADDRESSED** (test1
  precedent). The document path has no generative step at intake
  (`description` stays empty, filled downstream — pdf-intake's decision,
  kept).
- **Validation error UX** — rejection reasons are written for the question
  card the boxholder reads ("magic bytes say text/html but extension is
  .pdf"), not just HTTP bodies. **ADDRESSED** in Track 2's sidecar → question
  card path.
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
  questions; `cb document reanalyze` makes it possible later.
- **Migrating existing image paths off ImageMagick onto sharp** — sharp
  enters as a dependency, but converting `describe-images` etc. is unrelated
  churn.
- **ScanSnap Cloud / scanner-direct upload** — the boxholder scans to local
  folders; no cloud integration.
- **A general-purpose scoped-permission system** — exactly one new scope
  (`scan-upload`); a full capability matrix is speculative until a second
  consumer exists.
- **Non-Mac uploader polish** — the uploader is platform-neutral except the
  `trash` disposition, which is Mac-only and guarded; Windows/Linux Trash
  support waits for a real need.
- **Bun-compiled single binary** — `node <bundle>.mjs` suffices; the Bun
  escape hatch is noted, not taken.

## Open design questions

- **Pairing UX for scoped tokens**: reuse the existing pairing dialog with a
  scope dropdown, or a separate "mint scan token" admin action? Lean:
  dropdown on the existing dialog — one surface, and the flow is identical.
  Cosmetic; does not block Track 1's chunk (the tRPC input is the same either
  way).
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
  came from and what `CLAUDE_SCANS.md` is for.
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
7. **Track 6** — `CLAUDE_SCANS.md` × 2 + estate landmark destinations.
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
  mismatch/smuggle/broken-PDF/rate-limit/scope-rejection),
  `test/core/scan-promote.doctest.md` (worker: batch settle, restart
  resume, wakeup spawn failure), `test/core/commands/document-extract.doctest.md`
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
