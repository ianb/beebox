# Plan Engineering Review — scanner-ingest

Cross-model review of `scanner-ingest.md`, run 2026-08-01 with OpenAI Codex
(`codex exec`, read-only, high reasoning) per the `/codex` skill, at the
plan's first committed revision (`f1fe31e8`). Every finding below was
spot-verified against source by the plan author before being accepted; the
plan was amended in the same commit series that adds this file. Findings are
recorded here because they falsified specific claims in the first revision —
the amended plan cites them as "review finding N."

## Findings (all accepted; plan amended)

### 1. A scope field on the mobile store cannot be contained — Critical
**Citation (verified):** `src/webapp/server-box-scope.ts:99-105` — the box
auth preHandler accepts any non-null `resolveMobileRequestAuth` result and
renews a session cookie; `src/webapp/routes/pairing.ts:55-60` —
`/api/pairing/session` mints a scope-less signed cookie from any valid
device bearer; hub verification reduces to a boolean before proxying.
**Issue:** the plan's "enforcement lives in one place" claim was false; a
`scan-upload` device token would satisfy every gate and could mint a full
cookie.
**Resolution:** Track 1 redesigned as a dedicated scan-token store
(`.beebox/scan-tokens.secret.json`) that mobile auth structurally
never reads, enforced independently at hub and child.
**Traces to preference:** principle #3 (validate at boundaries — both
boundaries), and the boxholder's stated small-blast-radius requirement.

### 2. `/check` membership bit conflated imported/pending/rejected — High
**Issue:** a client crash between PUT and disposition strands files as
forever-"known" with no confirmation; treating "known" as duplicate could
trash the only copy of a rejected file; rejected hashes were unretryable.
**Resolution:** `/check` returns per-hash `unknown | pending | imported |
rejected` (+ reason); re-PUT of a rejected hash re-validates; uploader
dispositions only on `accepted`/`duplicate`/`pending`/`imported`.

### 3. Settle gate does not protect disposition — High (silent data loss)
**Issue:** the scanner can replace/append the file after uploader EOF but
before archive/trash; the server accepted the earlier bytes; the "self-heals
next sweep" claim was false because the file is gone.
**Resolution:** uploader snapshots (device, inode, size, mtime-ns) before
hashing and restats before disposition; any change leaves the file for the
next run.

### 4. Promote worker lacked its precedent's durable state machine — High
**Citation (verified):** bulk-upload's persisted states + startup resume
(`src/core/bulk-upload/worker.ts`, `resume.ts`); unlocked read-modify-writes
in `src/core/commands/upload-helpers.ts:167` and
`src/connectors/intake-utils.ts:40,112`.
**Resolution:** sidecar state machine (`pending → promoting → imported`,
`rejected`), per-box `file-lock.ts` promotion lock, startup recovery of
quarantine and staging, and locking added around the two racy helpers.

### 5. Wakeup lock and recovery claims were false — High
**Citation (verified):** `src/cli/commands/doctor.ts:51` (wakeup otherwise
unlocked; only the reactor takes `.bbx-reactor.lock`,
`src/core/reactor/engine.ts:110`); `src/cli/commands/wakeup.ts:117`
(connector-scoped wakeups filter jobs by `source`), so `source: scan` jobs
never drain on default schedules — a lost spawn was indefinite, not latency.
**Resolution:** durable `wakeup-pending` marker + supervised, awaited, full
(unscoped) `bbx wakeup` with retry on the next worker pass.

### 6. Hash-named promotion breaks scan-import; dispatch claim wrong — High
**Citation (verified):** `<prefix>_NNN` grouping
(`upload-helpers.ts:37,97`); `scan-import.ts:117-118` — every PDF goes to
document mode today ("Flash treatment for PDFs is deferred"); no
provenance argument exists on `upload`/`scan-import`; `capture-session` has
no `source` field.
**Resolution:** promote materializes original sanitized filenames into
staging; Track 4 now owns adding the text-layer split (it was wrongly
described as existing); provenance is an explicit `--source` argument +
additive schema field, not assumed reuse.

### 7. Quarantine would never be swept; questions not idempotent — High
**Citation (verified):** `src/core/housekeeping.ts:55` — the `tmp/` sweep
skips non-files, so a quarantine *directory* is never cleaned.
**Resolution:** scan-specific GC in the promote worker (imported → next
pass; rejected → 30 days after question resolution) and a `question-ref`
sidecar field for idempotent question emission.

### 8. 50 MB `bodyLimit` does not meter passthrough streams — High
**Citation (verified):** the bulk-upload parser `done(null)` bypasses
Fastify's collection path; bulk-upload is bounded only because
`addFileStreamed` meters the stream itself
(`src/core/capture/staging-stream.ts:76`).
**Resolution:** the PUT route reuses `addFileStreamed`-style metering + an
early `Content-Length` check; overflow deletes the partial file and 413s.

## Reviewer's minimal-version suggestion — declined in part
Codex proposed cutting Track 4 (Docling / `document.card`) as a separable
project. Declined as a scope judgment the boxholder already made — Docling
extraction is an explicit goal of this work. The severability observation
stands: Tracks 1–3+5 (transport) and Track 4 (extraction) have no shared
open decisions and could land in either order.

## Things checked and found clean (per Codex)
Annex-migrated byte staging via `stageAndCommitPaths` (the narrow claim the
plan makes for Track 0), the raw-Fastify-over-tRPC route choice, quarantine
under `tmp/` (box-scoped, gitignored), and the ClamAV omission drew no
findings.
