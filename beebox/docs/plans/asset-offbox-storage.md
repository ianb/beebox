---
title: "Off-Box Asset Storage — Content-Addressable Backup to R2"
status: active
workstream: unknown
issues: []
---
# Off-Box Asset Storage — Content-Addressable Backup to R2

**Status: SUPERSEDED by [`asset-annex.md`](asset-annex.md).** Nothing
here was implemented.

This plan proposed keeping the hand-rolled asset manifests and building
an R2 sync on top of them, having rejected git-annex on adoption cost.
Prototyping showed that cost estimate was wrong — a clone needs two
extra commands, plain `git add` routes assets into the annex with no
code changes, and `git annex init` does not clobber our pre-commit hook.
See "Prototype findings" in `asset-annex.md`.

**Still valid and still referenced:** the measured asset inventory, and
the R2 cost and API analysis below (pricing, the Cloudflare REST API's
1,200-req/5-min account cap, the `@aws-sdk/client-s3` CRC32/R2 501
incompatibility, the ~0.1% cross-box dedup measurement). Those are the
input to the remote iteration that follows `asset-annex.md`. The
*design* below — manifest-as-inventory, `bbx attachments push/pull/fsck`
— is not.

Box assets (photos, scans, audio, video — the gitignored subset of
attachments tracked by `docs/asset-manifests.md`) currently exist on
exactly one disk. This plan gives every asset a verified second copy in
a content-addressed R2 bucket, and makes "this asset has a remote copy"
a checkable property rather than an assumption.

It does **not** delete anything from local disk. Reclaiming space is a
separate, later decision that this plan makes safe to take.

## Why now — the measured exposure

Measured 2026-07-30 across the local `personal-test` box and the six
prod boxes on `bbx.ianbicking.org`:

| box | attach assets | bytes |
|---|---|---|
| estate | 1,184 | 9,031.8 MB |
| personal | 6 | 29.2 MB |
| box-family | 8 | 21.7 MB |
| ai-class / birch / tech-talk | 0 | 0 |
| personal-test (local) | 3,016 | 271.4 MB |

Three findings shape the design:

1. **Most of prod's assets are backed up by accident.** 1,146 of
   estate's 1,184 attach files still exist as blobs in git history and
   `HEAD == origin/main` on GitHub — a legacy of pre-migration commits
   (`docs/asset-manifests.md:266`: *"After this, `du -sh .git` doesn't
   shrink (history still carries the blobs)"*). That protection
   disappears the moment we run the `git filter-repo` the same section
   contemplates.
2. **Everything captured since the migration is single-copy.** 38 files
   / 149 MB in estate exist only on the server disk, all dated
   2026-07-29. This number grows with every capture.
3. **Manifest coverage is not universal.** `personal-test` has 3,016
   assets and zero manifest entries. Any design that reads the manifest
   as an inventory inherits this hole — see Track A.

Operational context: the prod disk is at 93% (5.6 GB free of 75 GB),
with 11 GB of `backups/pre-migration-20260523` and 440 MB of
`box-backups/2026-07-04` still resident.

## Stated preferences this plan trades against

- `docs/engineering-principles.md` **#4** (resilient AND never silent —
  and never resilient to the impossible), **#3** (validate at
  boundaries), **#5** (failure paths visible in signatures), **#10**
  (testability is architectural), **#8** (one way to do each thing).
- `beebox/CLAUDE.md:98`: *"Services — Every external dependency
  is wrapped in a typed interface with real + fake implementations."*
  The R2 surface is a service, not inline `fetch`.
- `beebox/CLAUDE.md:106`: *"Read before writing."* — the
  measurements above precede the design, deliberately.
- `code-style.md` — no `any`, max 2 positional params, `Result<T,E>`
  only where callers branch on why.
- Precedent: `src/services/publish-remote-store.ts` is the most recent
  shipped R2 integration and sets the shape this plan follows.

The central trade is **#4 vs. convenience**: an upload that returns 200
is not evidence of a durable copy. The plan spends real effort on
verification rather than treating a successful PUT as done.

## What already exists

- **`src/core/asset-manifest.ts`** — the manifest format and hashing.
  `asset-manifest.ts:78` `computeEntry()` and `asset-manifest.ts:133`
  `sha256File()` already produce the exact content hash this plan keys
  on. **Reused as-is.** We do not need a second hashing path; the
  inventory is already content-addressed, which is the whole reason
  this plan is small.
- **`src/core/asset-manifest-scan.ts`** — `scanBoxAttachments()`
  (`:331`) walks every `.attach/` scope and returns claimed / refreshed
  / renamed / errors. **Reused** as the enumeration source for push.
- **`src/core/commands/attachments.ts`** — the `bbx attachments`
  subcommand dispatch, whose default arm is
  `attachments.ts:75`: *"Unknown subcommand"*. **Extended** with
  `push` / `pull` / `fsck`; no new top-level command.
- **`src/services/publish-remote-store.ts`** — an existing R2 service
  with interface + real + fake (`:87` `PublishRemoteStore`, `:163`
  `createR2PublishStore`, `:252` `createFakePublishStore`). **Shape
  reused, transport not** — see the transport decision below. Its
  header comment is also the precedent for honestly marking an
  unverifiable adapter: *"⚠️ UNVERIFIED: the real R2 adapter cannot be
  exercised without live Cloudflare credentials"*
  (`publish-remote-store.ts:12`).
- **`config/connectors/*.secret.json`** — the established
  per-box secret location, gitignored by the box `.gitignore`
  (`src/core/box/index.ts:154` writes `config/connectors/*.secret.*`).
  **Reused** for the bucket credentials.
- **`src/core/housekeeping.ts`** — deterministic non-agent cleanup that
  runs during sync (`:2`: *"Housekeeping tasks that run during sync"*).
  **Reused** as the hook point for the periodic fsck.

Nothing here is rebuilt. The plan is genuinely additive: a service, a
sync loop, and three subcommands.

## Prior art (external)

**git-annex** — evaluated seriously and rejected. It solves exactly
this problem and its invariants are the ones worth copying, but its
model fights ours:

- It requires assets to be *tracked in git* as symlinks or pointer
  files ([how it works](https://git-annex.branchable.com/how_it_works/)).
  Our model is the opposite — gitignored bytes with a committed
  manifest. Adopting annex replaces the layer we shipped in May rather
  than extending it.
- **Absence is its central concept**; our webapp routes, renderers,
  image pipeline, and box agents all assume the byte is on disk.
  Adopting annex without ever dropping content pays the complexity and
  collects none of the benefit.
- Unlocked files (which we'd need — the capture endpoint and agents
  write real files, not symlinks) cost **2× disk** unless `annex.thin`
  is set, and `git reset --hard` / `git stash` don't update their
  content without a manual `git annex smudge --update`
  ([unlocked files](https://git-annex.branchable.com/tips/unlocked_files/)).
  On a disk at 93%, 2× is not academic.
- Every clone needs the binary — server, Docker image, each dev
  machine, every `~/src/box-worktrees/` clone, and any future adopter.
  This is the objection `docs/asset-manifests.md:36` already made to
  git-LFS (*"needs an LFS server, every clone has to configure the
  filter driver"*), with more force.
- Its complexity budget is spent on N-way sync among many
  partially-populated clones. Our topology is one authoritative server,
  one GitHub remote, an occasional dev clone.

Available as `git-annex 10.20240129-1build1` on the server's Ubuntu
24.04, and its S3 special remote does work against R2
([S3 special remote](https://git-annex.branchable.com/special_remotes/S3/))
with `signature=v4` (it defaults to v2 for non-AWS hosts), `public=no`
(R2 has no ACLs) and `versioning=no` (R2 has no bucket versioning). So
the rejection is on fit, not feasibility.

**What we copy from it**, named explicitly so the debt is visible:
`numcopies` as a hard refusal to delete, `whereis` as a location
question with an answer, `fsck` as periodic re-verification rather than
trust-on-write, and preferred-content expressions as the eventual GC
policy language. This plan is a deliberate narrow re-implementation of
those four ideas for a single-remote topology.

**R2 transport.** Two live findings:

- The Cloudflare REST API used by `publish-remote-store.ts` is rate
  limited to **1,200 requests per 5 minutes per account** and the docs
  say it is *"best suited for lower-volume management and configuration
  operations"*
  ([R2 limits](https://developers.cloudflare.com/r2/platform/limits/)).
  The initial backfill is ~4,200 objects; at that ceiling it is ~18
  minutes of pure rate-limit floor, on a budget **shared with the
  publish connector**. This is why the plan reuses the service *shape*
  but not the transport.
- `@aws-sdk/client-s3` ≥ v3.729.0 sends `x-amz-checksum-crc32` by
  default, which R2 rejects with a 501
  ([Cloudflare community](https://community.cloudflare.com/t/aws-sdk-client-s3-v3-729-0-breaks-uploadpart-and-putobject-r2-s3-api-compatibility/758637)).
  The fix is `requestChecksumCalculation: "WHEN_REQUIRED"`. Anyone
  implementing this will hit it; recording it here saves the
  rediscovery.

R2 supports multipart, ListObjectsV2, and STANDARD / STANDARD_IA
([R2 S3 API](https://developers.cloudflare.com/r2/api/s3/api/)). Largest
asset measured is 11.6 MB and zero assets exceed 100 MB, so multipart
is not needed at current scale.

**Cost.** At $0.015/GB-month Standard with a 10 GB-month free tier, the
current ~9.35 GB corpus is **$0/month**; $0.14/month at list price.
Break-even against Infrequent Access ($0.010/GB-month + $0.01/GB
retrieval, 2× Class A, 30-day minimum duration) doesn't arrive until
several hundred GB, so this plan uses **Standard only**.

## Tracks / scope

Ordered by implementation dependency: A is a prerequisite for B (you
cannot back up an inventory that doesn't include the files), C depends
on B's key layout, D depends on C.

### Track A — close the manifest coverage gap

**What.** Make the pre-commit hook auto-claim unmanifested assets, as
`docs/asset-manifests.md` has always described.

**Why this needs to change.** The doc and the implementation disagree.
`docs/asset-manifests.md:137` specifies: *"**File on disk, not in
manifest** → hash, add entry, log `Auto-claimed <path>`."* The hook
`bbx init` actually installs says the opposite —
`src/core/install-validation-hooks.ts:225`: *"attachment/asset manifest
is intact (read-only scan, no auto-claim)"* — and runs
`bbx attachments verify` (`:252`), whose unclaimed-asset path is a
non-blocking summary note (`src/core/commands/attachments.ts:107`:
``notes.push(`${unclaimed} unclaimed asset(s) — \`bbx attachments
migrate\` claims them`)``). The result is measurable: `personal-test`
reports `3018 unclaimed asset(s)` and has never claimed one.

Until this is fixed, "the manifest is the inventory" is false, and a
push built on the manifest silently skips exactly the files nobody knew
about — a #4 violation (resilient but silent) at the foundation of the
plan.

**Direction.** Replace the `verify` call in the generated hook with a
claiming scan. The machinery already exists: `scanBoxAttachments()`
takes `{ dryRun?: boolean }` (`asset-manifest-scan.ts:77`) and
`runVerify` passes `dryRun: true` (`commands/attachments.ts:88`);
`runMigrate` is the same walk in write mode (`:118`). Claiming is
additive and cannot lose data, which is precisely the split
`docs/asset-manifests.md:50-57` already draws between additive
(automatic) and destructive (explicit command). Newly-written manifests
get `git add`-ed into the commit in progress.

`bbx init` must regenerate hooks on existing boxes — the marker-based
rewrite in `install-validation-hooks.ts` already handles that.

**First implementation chunk.** Change the generated hook body to call
a new `bbx attachments claim` (write-mode scan, blocking on errors,
staging modified manifests), add its doctest, regenerate hooks on
`test1`, and run `bbx attachments migrate` on `personal-test` to claim
the 3,016 backlog files. No open questions inside this chunk.

### Track B — the AssetStore service

**What.** A narrow typed interface over the R2 bucket, with a real
implementation and an in-memory fake, following
`src/services/CLAUDE.md`.

**Why this needs to change.** There is no asset-facing object store
today. `PublishRemoteStore` is bound to the publications bucket, its
prefixes (`SUBMISSIONS_PREFIX`, `ACCESS_LOG_PREFIX`,
`publish-remote-store.ts:30-31`), and a rate-limited transport.

**Direction.**

```typescript
export interface AssetStore {
  /** True when an object with this key exists. Cheap; no body transfer. */
  has(key: string): Promise<boolean>;
  /** Keys under a prefix, sorted. Paginated internally. */
  list(prefix: string): Promise<string[]>;
  /** Fetch raw bytes. Rejects if absent. */
  get(key: string): Promise<Uint8Array>;
  /** Write. Idempotent — content-addressed keys make a re-put a no-op. */
  put(key: string, opts: AssetPutOptions): Promise<void>;
  /** Size + stored digest without transferring the body. Null if absent. */
  head(key: string): Promise<AssetObjectInfo | null>;
}
```

`head()` earns its place: it is what makes Track D's fsck cheap. A
verification pass that must download every object to check it is a pass
nobody schedules.

**Key layout.** `<box-slug>/sha256/<aa>/<bb>/<full-hex>` where `aa`/`bb`
are the first two byte-pairs of the digest.

Two decisions embedded here, both evidence-driven:

- **Content-addressed**, so a re-push is a no-op, a rename costs
  nothing (the manifest entry moves; the key doesn't), and an
  interrupted backfill resumes by diffing.
- **Per-box prefixed**, despite that forfeiting cross-box dedup —
  because we measured cross-box dedup at 1,544 unique hashes over
  9,124.6 MB against 1,650 files / 9,131.8 MB present, i.e. **~0.1%**.
  Paying a shared-namespace blast radius for 0.1% is a bad trade, and
  per-box prefixes keep a future multi-tenant story open.

**Transport.** Direct S3 API against
`<account>.r2.cloudflarestorage.com` with SigV4, not the Cloudflare
REST API — see the rate-limit finding in Prior art. Signing library is
an open question (below); the interface is transport-agnostic either
way, which is the point of having it.

**Credentials.** `config/connectors/r2-assets.secret.json` in the box,
matching the established convention
(`src/connectors/telegram-helpers.ts:51`) and already covered by the
box `.gitignore`'s `config/connectors/*.secret.*`. Absent credentials
mean "asset backup not configured" — push no-ops with a *logged*
notice, never a silent skip (#4).

> Creating the bucket and minting the scoped token are boxholder
> actions. This plan does not assume, create, or modify credentials.

**First implementation chunk.** `src/services/asset-store.ts` with the
interface, `createFakeAssetStore()`, and a doctest exercising
has/list/get/put/head against the fake. The real adapter lands in the
same chunk but is marked UNVERIFIED in its header, following the
`publish-remote-store.ts:12` precedent, until the live pass.

### Track C — `bbx attachments push` / `pull`

**What.** Walk the box's manifests, diff against the remote, upload
what's missing. `pull` is the inverse, for restore.

**Why this needs to change.** This is the actual deliverable — the 38
single-copy files, and every future capture.

**Direction.**

The remote **is** the location log. This is the single largest
simplification over git-annex and it falls out of having exactly one
remote plus content-addressed keys: `head(key)` answers "does a copy
exist" authoritatively, so there is nothing to keep in sync and nothing
to reconcile. git-annex needs a location-tracking branch because it has
N remotes and partial replicas; we have neither.

A local key-set cache in `.beebox/` (gitignored) is a pure
optimization to avoid re-listing on every push, with the remote as the
authority whenever they disagree.

```
bbx attachments push [--dry-run]
  1. scanBoxAttachments(boxRoot, { dryRun: true })  → every manifest entry
  2. hard error on any ScanError (`asset-manifest-scan.ts:56`) — never
     push from an inventory known to be inconsistent
  3. list(<box-slug>/sha256/) → remote key set
  4. for each entry not present remotely: re-hash the local file,
     verify it still matches the manifest, then put()
  5. report: uploaded N (X MB), already-present M, skipped-with-reason K
```

Step 4's re-hash is deliberate. Uploading bytes because the manifest
*says* their hash is H, without checking, would let a corrupted local
file be stored under a key asserting content it doesn't have — poisoning
the content-addressed invariant permanently. Cost is one local read per
*new* object only.

`pull` takes a path or `--all`, fetches by manifest hash, verifies the
downloaded bytes hash to the expected digest before writing, and
refuses to overwrite an existing file whose hash differs (that's a
conflict, not a restore).

**Where it runs.** `bbx wakeup` already ends by pushing to the box's git
remote (`CLAUDE.md:96`). Asset push belongs in the same place, so the
two halves of a box's durability move together.

**First implementation chunk.** `push` with `--dry-run`, plus a
filesystem doctest using `makeTmpBox()` and the fake store covering:
empty box, all-present, partial upload, and a hash-mismatch refusal.

### Track D — `bbx attachments fsck`

**What.** Periodic re-verification that remote copies still exist and
still match.

**Why this needs to change.** An upload that returned 200 is evidence
about the past, not the present. Without this, "backed up" degrades
into "was backed up once, probably," which is the assumption this whole
plan exists to eliminate (#4).

**Direction.** `head()` each key and compare size against the manifest
entry. Full-download hash verification is `--deep`, sampled — a
rotating slice (default 5% per run) so a full cycle completes over
weeks without ever being a job someone dreads running. Report:
verified, size-mismatched, **missing-from-remote** (the alarming one).

`--deep` is where the numcopies invariant becomes real: this is the
only check that distinguishes "the remote has an object at that key"
from "the remote has the right bytes."

Runs from `src/core/housekeeping.ts` — deterministic, no agent needed
(`housekeeping.ts:4`: *"deterministic cleanup operations that don't
require an agent"*).

**First implementation chunk.** `fsck` shallow mode + doctest against a
fake store seeded with a missing key and a size-mismatched key.

## Subplans

None. Each track is a decision this plan settles, not a design question
needing its own step. The one candidate — local GC / drop-when-backed-up
— is deferred rather than subplanned, for the reason given in NOT in
scope: it is gated on a read-path audit that is genuinely separate work,
and per the skill's rule a subplan would have to ship with this plan,
which would badly overscope it.

## Failure modes

> **Critical gap: none remaining.** The one this plan started with —
> unmanifested assets silently absent from the inventory *and* from any
> backup — is Track A, and it is sequenced first for that reason.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Credentials absent / bucket unreachable | Yes (fake returns null config) | Push no-ops with a logged notice | Clear — logged, and `fsck` still reports 0 verified |
| Upload succeeds, object later deleted at the remote | Yes (fake seeded with missing key) | Track D fsck reports `missing-from-remote` | Clear |
| Local file corrupts after being claimed | Yes (hash-mismatch doctest) | Pre-existing: scan blocks with `hash-mismatch` (`asset-manifest-scan.ts:42`) | Clear — blocks the commit |
| Local file corrupts *before* first claim | No — undetectable in principle | None possible | Silent, and accepted: nothing can distinguish this from correct content on first sight |
| Push interrupted mid-run | Yes | Content-addressed keys make it resumable; next push diffs and continues | Clear |
| Manifest entry with no file on disk | Yes (pre-existing) | Pre-existing `missing-file` error (`asset-manifest-scan.ts:35`) blocks push at step 2 | Clear |
| R2 rate limit / 5xx during a large backfill | Yes (fake can be told to fail) | Bounded retry with backoff; partial success reported, non-zero exit | Clear |
| Two boxes pushing concurrently | Yes | Per-box prefix + content-addressed keys — no shared mutable state to race on | Clear |
| Same box, two concurrent pushes | Yes | Existing `src/lib/file-lock.ts` per-box lock | Clear |
| Downloaded bytes don't match expected hash on `pull` | Yes | Verify before write; refuse and report | Clear |
| Remote holds an object whose bytes don't match its key | Yes (fake seeded) | Only `fsck --deep` detects it; shallow fsck cannot | Clear *when deep runs* — flagged in the open questions |
| Box `.gitignore` doesn't cover a new asset extension | Yes (pre-existing) | Pre-existing batch-local `.gitignore` pattern (`docs/asset-manifests.md:193-213`) | Clear |

The fourth row is the honest one: pre-claim corruption is
unfalsifiable, and per #4's *"never resilient to the impossible"* the
right response is to name it, not to build machinery that pretends to
catch it.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — **N/A.** This plan adds no card syntax,
  schema field, or Markdoc tag. Nothing for an agent to pick wrongly.
- **Stale ref** — **ADDRESSED.** A card's `<filename ref="attach/...">`
  resolves through the existing attach-scope path logic; this plan
  never changes where a file lives. A moved asset is handled by the
  existing hash-stable rename detection
  (`docs/asset-manifests.md:148-155`), and because keys are
  content-addressed, a rename requires no remote work at all.
- **Two agents touching the same card** — **ADDRESSED.** Push takes the
  existing per-box `file-lock.ts`. Manifest writes are already atomic
  (`asset-manifest.ts:125-127`, tmp + rename).
- **Hand-edit drift** — **ADDRESSED.** A hand-edited `manifest.json`
  that stops parsing raises the existing `manifest-malformed` error
  (`asset-manifest-scan.ts:49`), and push refuses at step 2 rather than
  uploading from a partially-parsed inventory.
- **Fabricated free-form value** — **N/A.** Every value in this plan is
  machine-computed (a digest, a size, a key). There is no free-form
  field for an agent to invent, which is a property worth preserving in
  any future extension.
- **Validation error UX** — **ADDRESSED.** Messages follow the existing
  house style of naming the remedy, e.g. `estate: 38 asset(s) have no
  remote copy. Run 'bbx attachments push'.` Agents are the primary
  audience (`docs/asset-manifests.md:146`).
- **Partial migration / transition state** — **ADDRESSED.** During
  rollout a box is in one of three states: no credentials (push
  no-ops), credentials but never pushed (fsck reports everything
  missing-from-remote), or pushed. All three are reportable and none is
  an error state. Boxes are migrated one at a time.

## NOT in scope

- **Deleting local assets / GC.** The largest deferral, and the reason
  is concrete: dropping content requires auditing every read path
  (webapp routes, renderers, the image pipeline, box agents) for
  absence handling. That audit is the real cost of the feature and it
  is independent of having a backup. This plan establishes the
  precondition — a *verified* remote copy — that makes a later drop
  plan safe. Deliberately, `push` never deletes.
- **git-annex adoption.** Rejected above, on fit.
- **History rewrite (`git filter-repo`) to reclaim estate's 9.9 GB
  `.git`.** Riskier, separate, and — importantly — must happen *after*
  this plan completes, since that history is currently the only real
  off-box copy of 8.88 GB.
- **Backing up the non-attach ignored files** (SQLite WALs, generated
  docs JSON, logs — 54 MB across prod). Regenerable or transient; not
  data.
- **Encryption at rest beyond R2's own.** Single-boxholder, single
  account today. Revisit if boxes are ever hosted for others.
- **Multi-device sync.** The genuine git-annex use case. Not a need we
  have; if it becomes one, that's the moment to revisit the rejection
  honestly rather than extending this design toward it.
- **Infrequent Access storage class.** Break-even is several hundred GB
  away; STANDARD_IA also has a 30-day minimum duration that penalizes
  the churn a future GC would create.

## Open design questions

1. **SigV4 signing: `aws4fetch` or `@aws-sdk/client-s3`?** Lean:
   `aws4fetch` — a few KB, no default-checksum behavior to work around,
   and the `AssetStore` interface means the choice is reversible. The
   AWS SDK is ~10 MB of dependency for an interface with five methods.
2. **fsck `--deep` sampling rate and cadence.** Lean: 5% per weekly
   run, so a full corpus cycle takes ~5 months. Wants a real read of
   what a deep pass costs on estate before committing.
3. **Should `bbx wakeup` push assets by default, or only on an explicit
   flag?** Lean: default on, because a backup nobody remembers to run
   is the failure mode this plan exists to close. Risk is a slow wakeup
   on the first run after a large capture; mitigated because subsequent
   runs upload only the diff.
4. **One bucket for all boxes, or one per box?** Lean: one bucket,
   per-box key prefix — simpler credential story, and dedup was
   measured worthless either way. A hosted-for-others future would want
   per-box buckets or scoped tokens; noting rather than pre-building.

None of these sit inside a first implementation chunk.

## Knowledge audits

This plan adds agent-facing surface: box agents will encounter `bbx
attachments push` / `fsck` output and need to know that assets are
backed up by content hash and that a `missing-from-remote` report is
actionable. Two entries for
`src/dev/knowledge-audits.yaml`, tagged `[assets]`:

- `asset-backup-command` — *"How do you make sure a box's photos have
  an off-box copy?"* — `expected_level: knows_directly`,
  `correct_contains: ["bbx attachments push"]`.
- `asset-missing-remote` — *"`bbx attachments fsck` says 3 assets are
  missing-from-remote. What does that mean and what do you do?"* —
  `expected_level: knows_directly`, watching for the agent recognizing
  the local copy is fine and the remote needs a re-push, rather than
  treating it as local data loss.

Both land **run**, not merely written: `pnpm knowledge-audit run --box
<absolute-path-to-test-box> --filter assets`, with the status comment
recorded in `knowledge-audits.yaml` before the plan completes. (Pass an
absolute box path — a bare `--box test1` resolves inside the monorepo.)

## Implementation order

1. **A1** — hook auto-claims; `bbx attachments claim`; doctest.
2. **A2** — regenerate hooks on `test1` and prod boxes; run `bbx
   attachments migrate` on the `personal-test` backlog. *Depends on A1.*
3. **B1** — `AssetStore` interface + fake + doctest.
4. **B2** — real R2 adapter (SigV4), marked UNVERIFIED. *Depends on B1.*
5. **C1** — `bbx attachments push --dry-run` + filesystem doctests.
   *Depends on A1, B1.*
6. **C2** — live push, `pull`, wakeup integration. *Depends on B2, C1.*
7. **D1** — `fsck` shallow + doctest; housekeeping hook. *Depends on
   B1, C1.*
8. **D2** — `fsck --deep` sampled. *Depends on D1.*
9. **E** — docs: fold the durable parts into
   `docs/asset-manifests.md` (its "Out of scope (for v1)" section at
   `:271-281` explicitly anticipates this: *"Backup / remote storage.
   No R2, no rsync… the manifest is the inventory that makes a future
   `bbx attachments push <target>` trivial"*); knowledge audits written
   and run.

Chunks 3–4 and 1–2 are independent and can proceed in either order.

## Rollout shape

**Test posture.** Per `docs/testing.md`, tests come first as a design
tool. Named up front:

- `test/services/asset-store.doctest.md` — pure-function tier, fake
  store, all five interface methods.
- `test/core/commands/attachments-push.doctest.md` — filesystem tier
  (`makeTmpBox()`), covering the Failure-modes rows marked "Yes":
  empty box, all-present, partial upload, hash-mismatch refusal,
  scan-error refusal, interrupted-then-resumed.
- `test/core/commands/attachments-fsck.doctest.md` — filesystem tier,
  fake store seeded with a missing key and a size-mismatched key.
- `test/core/asset-manifest-claim.doctest.md` — Track A: an unclaimed
  asset is claimed and its manifest staged.

**Done-when**, as checkable assertions: (a) those four doctests pass;
(b) `bbx attachments fsck` on prod `estate` reports zero
`missing-from-remote` across all 1,184 assets; (c) `bbx attachments
verify` on `personal-test` reports zero unclaimed.

**Migration.** No on-disk data shape changes — manifests keep their
current schema (`asset-manifest.ts:24-38`), so no `bbx migrate` step and
nothing in `docs/migrations.md`. The only state change is Track A2
writing manifest entries that should have existed all along, which is
`bbx attachments migrate` — an existing, idempotent command
(`commands/attachments.ts:118`).

**Live verification.** The real R2 adapter is untestable without
credentials, exactly as `publish-remote-store.ts:12` records for its
own. The plan does not complete on green doctests alone; it completes
when a real push to a real bucket has run and `fsck --deep` has
verified a sample. Per `docs/asset-manifests.md`'s own framing, an
unverified backup is not a backup.

## Immediate actions, independent of this plan

These need no design and shouldn't wait for it:

1. Remove the 11 GB `backups/pre-migration-20260523` and 440 MB
   `box-backups/2026-07-04` from the prod server — 93% → ~78% full.
2. Get estate's 38 single-copy files (149 MB) off the box by hand.
3. Do not run `git filter-repo` on any box until this plan completes.
