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
history: [`implemented-plans/scanner-ingest.md`](implemented-plans/scanner-ingest.md).

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
{ "contractVersion": 1,
  "states": { "<sha256>": { "state": "unknown" }, "<sha256>": { "state": "rejected", "reason": "…" } } }
```

`contractVersion` is the box's own contract version (see "Client identity").
It is a sibling of `states`, and a client that does not know about it ignores
it.

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
| `X-Scan-Contract` | no | the client's contract version (integer) — see "Client identity" |
| `X-Scan-Client-Build` | no | the client's build revision, or `source` for a checkout |
| `X-Scan-Client-Built-At` | no | ISO 8601 time the client bundle was built |

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

## Client identity

The uploader is a stand-alone package that never updates itself: a copied
`dist/scan-uploader.mjs` sits at whatever revision it was built from until
somebody copies a new one over it. So it volunteers who it is, and the box
reports an uploader that has fallen behind.

**`SCAN_CONTRACT_VERSION`** is one monotonic integer, spelled once on each side
(`beebox/src/core/scan/contract-version.ts`,
`scan-uploader/src/contract-version.ts`). The client sends it as
`X-Scan-Contract`; the box returns its own as `contractVersion` on the check
response; the client compares them every sweep and reports which side is
behind.

### When to bump `SCAN_CONTRACT_VERSION`

**The test: would a client built before this change now do the wrong thing, or
fail to do a right thing, even though it still parses every response?** If yes,
bump. The version exists for exactly the changes that do *not* announce
themselves — a client that can no longer parse the wire already throws a
protocol error and needs no version to make that visible.

Bump for:

| Change | Why it is a bump |
|---|---|
| A client obligation changes — the settle window, the identity snapshot, restat-before-disposition, or which responses permit a disposition | These live only in the client. An old client applies the old rule to a real scan, and the rule decides whether the only copy of a file is moved to the Trash. |
| A check `state` is added, removed, or changes what it means for the client | An unknown state throws, so *adding* one is loud — but redefining an existing one is silent. Treat the whole vocabulary as versioned. |
| A response status stops meaning what the client branches on (e.g. `422 hash-mismatch` becoming non-retryable) | The client's switch still compiles and now does the wrong thing. |
| A limit or requirement gets stricter than a client built before the change **can comply with** — lowering the 500-hash batch cap below what it chunks to, or the 50 MB file cap below what it will send | The old client keeps sending what used to be legal and every such request now fails. |
| Hash algorithm, hash encoding, or a route's path shape | Silent mismatch, not a parse error. |

Do **not** bump for:

| Change | Why it is not |
|---|---|
| A new optional request header, or a new response field an older client ignores | Additive in both directions; `contractVersion` itself shipped this way. |
| Anything server-internal the client cannot observe — quarantine layout, promote debounce or GC timing, question-card wording, the upload ledger's shape | The client's behaviour is unchanged, and a bump here trains people to ignore bumps. |
| Error-message or `reason` text | The client reports `reason` verbatim and never branches on it. |
| Box-side surfaces — health checks, tRPC procedures, UI | Not on this wire. |
| A fix that makes the server match what this document already said | The contract did not change; the implementation caught up. |
| Relaxing a requirement, or dropping a response detail the client already copes with — making `X-Upload-Filename` optional, or omitting `Retry-After` on a `429` | The old client's behaviour is already correct. Check the client before deciding: `parseRetryAfter` (`scan-uploader/src/wire-client.ts`) already defaults when the header is absent, so that one is a non-event. |

The row above is the one to read carefully, because it is where a plausible
reading goes wrong: the question is never "does this touch a limit or a header
the contract mentions", it is **"can a client built before this change still do
the right thing"**. Go and read the client's handling before deciding.

**When it is genuinely unclear, bump.** The cost of a needless bump is one
spurious "out of date" line telling someone to re-copy a file they could have
kept. The cost of a missed bump is a stale client reported as current, which is
worse than having no version at all, because it answers the question wrongly
rather than not at all. Nothing can test that a human bumped this, so the bump
is part of the change discipline below rather than a separate obligation.

Mechanically, a bump is: `+1` to **both** constants in the same change (they
are two spellings of one number, never per-side versions), this document, and
the route doctests. Bumping does not refuse anything — an old client keeps
uploading and starts being reported. And never bump the build stamp: it is a
build artifact, not a hand-maintained number.

### Adding something the client must now send

A bump reports; it never refuses. But a change that makes the server **require**
something new — a new mandatory header, a stricter body shape — refuses on its
own, and every copied bundle in the field fails until somebody walks to that
machine and copies a new file over. Nothing here auto-updates. So a bump is not
sufficient for this shape of change, and the ordering is part of the change:

1. Ship the server side **accepting but not requiring** it, and the client side
   sending it. Verify-if-present; a missing value stays legal.
2. Wait until every uploader has actually been re-copied. The box can tell you:
   the `scan-uploaders` health check reports each uploader's build, so "have
   they all been updated" is a question with an answer rather than a guess.
3. Only then make it mandatory — and bump again, because *that* is the change
   that alters what a correct client must do.

Collapsing this into one step is the mistake, and it fails in the field rather
than in a test: the doctests exercise a current client against a current box,
which is the one pairing that cannot show the breakage.

**The build stamp** (`X-Scan-Client-Build`, `X-Scan-Client-Built-At`) answers a
different question: not "does this client still speak the protocol" but "how
old is it". A client can be current on the contract and still be missing
features. A checkout sends `source`, because it runs current source on every
sweep and cannot drift; only a copied bundle can. The box records both on the
scan token's record and compares the build time against its own deploy time —
two timestamps from the same monorepo, which is ordered in a way comparing git
revisions could not be.

All three request headers ride **both** routes (the table above lists them
under PUT, but the check request sends them too), so a box that only ever sees
uploads still learns what is talking to it.

**Neither is a credential and neither gates anything.** The box never refuses
an old client: a contract change that genuinely breaks a client already fails
loudly at parse (an unknown `state` or an unexpected status is a protocol
error), and refusing a client that still works would strand scans on the
laptop with nothing to show for it. A box reporting no `contractVersion`, and a
client sending no identity headers, both mean "no opinion" — never "drifted".
Every one of these fields is additive over a parser that ignores unknown keys
and unknown headers, in both directions, so no flag day is needed.

Note the prefix: these must **not** be named `x-bbx-*`. The hub deletes every
client-supplied header in that namespace before it reaches a box (its spoof
wall), so such a header would silently never arrive.

## Change discipline

Any change to routes, headers, states, statuses, limits, or hashing updates
this doc, both breadcrumbed implementations, and the route doctests in the
same change. A change that alters the client obligations, the state vocabulary,
or a route's shape also bumps `SCAN_CONTRACT_VERSION` on both sides (see
"Client identity") — that bump is part of this same change, not a follow-up.
