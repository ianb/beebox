# Scan Upload Wire Contract

The HTTP contract between the stand-alone `scan-uploader/` package (laptop
client) and beebox's scan routes (server). The two sides share **no
code** — this document is the single coordination point. Every implementation
site that encodes part of this contract carries the breadcrumb comment:

```
// WIRE CONTRACT (scan-upload): must match docs/scan-upload-contract.md — change both sides together.
```

Breadcrumbed sites: the server routes (`src/webapp/routes/scan-upload*.ts`),
the client's HTTP layer (`scan-uploader/src/`), and the server route doctests
(`test/webapp/routes/scan-upload.doctest.md`) — the doctests exercise this
contract exactly as the client sends it and are its executable form. Design
history: [`plans/scanner-ingest.md`](plans/scanner-ingest.md).

## Auth

Every request: `Authorization: Bearer <scan-token>`.

Scan tokens are per-box credentials minted by the boxholder (`scanTokens`
tRPC procedures), stored hashed in `.beebox/scan-tokens.secret.json`.
They authorize **only** the two routes below — verified independently by the
hub (which also requires the path to be exactly one of those two routes under
`/<slug>/`, hash form included; nothing else in the `/api/scan/` subtree is
reachable with a scan token) and by the box child. They are not mobile device tokens; they cannot mint session
cookies, open WebSockets, or reach any other surface. A full owner identity
(browser session) is also accepted on these routes.

Failures: `401` invalid/revoked token; `401` from the hub for a scan token on
any non-scan path.

## Hashes

SHA-256 of the file bytes, lowercase hex, 64 chars. Used as the PUT path
segment, the check key, and the server's dedup/idempotency key.

## `POST /<box>/api/scan/check`

Request body (JSON): `{ "hashes": ["<sha256>", …] }` — batch, ≤500 entries.

Response `200` (JSON):

```json
{ "states": { "<sha256>": { "state": "unknown" }, "<sha256>": { "state": "rejected", "reason": "…" } } }
```

Per-hash `state`:

| state | meaning | client behavior |
|---|---|---|
| `unknown` | never seen | PUT it |
| `pending` | validated, in quarantine, awaiting promote | confirmed — apply disposition |
| `imported` | in the box's upload ledger | confirmed — apply disposition |
| `rejected` | failed validation; `reason` says why | never disposition; report; re-PUT only with retry flag |

`pending`/`imported` count as confirmed so a client that crashed between PUT
and disposition converges on the next run. A server-side entry mid-promotion
is reported as `pending` — the wire vocabulary stays at these four states.

An empty `hashes` array is legal (`200`, empty `states`). A malformed body,
a malformed hash (not 64 lowercase hex), or >500 hashes → `400`.

A box that cannot receive scans at all answers **every** request on both routes
— check included — with the retryable `503 { "status": "server-error", … }`
below, so a client learns the box is unavailable on its first call rather than
on its first upload. The one condition today is a box that has not been
converted to git-annex: promotion stages raw asset bytes, which a
manifest-scheme box gitignores, so an `accepted` there would be a lie the
client acts on by deleting its only copy.

## `PUT /<box>/api/scan/files/<sha256>`

Body: the raw file bytes, `Content-Type: application/octet-stream`, streamed.
`Content-Length` required (`411` without it). Malformed path hash or
missing/unusable `X-Upload-Filename` → `400`.

Headers:

| header | required | meaning |
|---|---|---|
| `X-Upload-Filename` | yes | original filename (basename only; server sanitizes) |
| `X-Scan-Profile` | no | free-text scanner profile name (≤200 chars), recorded as provenance |

Server behavior: streams to quarantine while metering bytes (over-limit →
`413`, partial file deleted), re-hashes, then validates (magic-byte sniff vs
extension allowlist; `qpdf --check` for PDFs, image decode for images).

Responses (JSON, `status` field is the vocabulary):

| HTTP | body | meaning |
|---|---|---|
| `200` | `{ "status": "accepted" }` | stored + validated; now `pending` |
| `200` | `{ "status": "duplicate" }` | hash already `pending`/`imported` |
| `422` | `{ "status": "rejected", "reason": "…" }` | validation failed; recorded as `rejected` |
| `422` | `{ "status": "hash-mismatch" }` | received bytes ≠ path hash; nothing recorded — retry |
| `413` | — | over size limit (50 MB) |
| `429` | — | rate limited; honor `Retry-After` |
| `503` | `{ "status": "server-error", "reason": "…" }` | server temporarily unable to accept this file (e.g. qpdf missing, box not annex-converted); nothing recorded — report, never disposition, retry a later run |

Re-PUT of a `rejected` hash re-runs validation (the retry path after a
validator fix). Re-PUT of `pending`/`imported` is a no-op `duplicate`. PUT is
idempotent throughout — retrying any response is safe.

## Server-side lifecycle (why `check` answers change on their own)

Accepted files sit in the box's scan quarantine until the **promote worker**
(`src/core/scan/promote.ts`) runs — debounced two minutes after the last PUT
(accepted or rejected), once at box-serve startup, and on a slow GC sweep for
boxes that stop scanning — under a per-box cross-process lock. A pass
imports pending files through `bbx upload --as scan` (materialized under their
original filenames, tagged `--source scan-upload/<token-name>`), raises one
question card per rejection, runs a supervised full `bbx wakeup` recorded by a
durable marker until it succeeds, and garbage-collects quarantine. The GC is
what makes the answers below stable rather than eventually-empty:

| Entry | When it goes | What `check` says afterwards |
|---|---|---|
| imported | next pass, file + sidecar | `imported`, from the upload ledger |
| rejected, question pending | never | `rejected` + reason |
| rejected, question resolved | file now; sidecar becomes a tombstone | `rejected` + reason |
| rejected, resolved 30+ days ago | everything | `unknown` — a re-upload re-validates |

Client consequence: a `rejected` hash can eventually return to `unknown`. That
is deliberate, and far enough out that re-sending deserves fresh validation.

## Limits

50 MB per file; 60 requests/min per token; 500 hashes per check call.

## Client obligations

The uploader must: apply a settle gate (skip files modified <10 s ago),
snapshot file identity (dev, inode, size, mtime-ns) before hashing, and
**restat before any disposition** (archive/trash), skipping the disposition
if identity changed. Disposition only after `accepted`/`duplicate` on PUT or
`pending`/`imported` from check. `rejected` files are never moved or
deleted.

## Change discipline

Any change to routes, headers, states, statuses, limits, or hashing updates
this doc, both breadcrumbed implementations, and the route doctests in the
same change.
