# Assets on git-annex

**Status:** proposed — design complete, nothing implemented. Supersedes
`asset-offbox-storage.md` (see "How this plan changed").

Move box assets (photos, scans, audio, video — the binary subset of
attachments) from the hand-rolled manifest system onto git-annex, with
content stored locally and verified. This iteration adds **no remote**:
it replaces the storage and integrity layer, and leaves the box in a
state where adding an R2 special remote later is configuration, not
design.

## Why git-annex, and why not the manifest design

`docs/asset-manifests.md` describes a system we built in May: assets
gitignored, a committed per-directory `manifest.json` holding size +
sha256, and a pre-commit scan. It works, but it is a partial
re-implementation of git-annex, and measurement showed the parts we
skipped are the parts that matter:

- **The inventory has holes.** `personal-test` holds 3,016 assets
  (271 MB) with zero manifest entries, because the shipped hook never
  claims. `docs/asset-manifests.md:137` promises *"**File on disk, not
  in manifest** → hash, add entry"*; the generated hook says the
  opposite (`src/core/install-validation-hooks.ts:225`: *"read-only
  scan, no auto-claim"*) and `cb attachments verify` reports unclaimed
  files as a non-blocking note
  (`src/core/commands/attachments.ts:107`). git-annex has no
  equivalent hole: `annex.largefiles` routes matching files into the
  annex on plain `git add`, so an asset cannot be silently untracked.
- **No location tracking, no copy-count invariant, no verification.**
  These are `whereis`, `numcopies`, and `fsck` — the three things we'd
  have had to build, and the three things git-annex is *for*.
- **Assets are invisible to git.** `docs/asset-manifests.md:31` already
  named this as the reason plain `.gitignore` was rejected: *"the
  assets become invisible to git. No audit trail… Feels too casual for
  data that matters."* The manifest was an attempt to get the audit
  trail back without git's help.

The earlier plan (`asset-offbox-storage.md`) proposed keeping manifests
and adding an R2 sync. It was rejected once prototyping showed the
adoption cost of git-annex is much lower than assumed — see
"Prototype findings". That plan's cost analysis of R2 remains valid and
is the input to the *next* iteration, not this one.

## Scope of this iteration

**In:** git-annex as the asset store, locally, with `annex.thin=false`
so content is verifiable. Retire the manifest system. Handle absent
content. A health check that a box is correctly annexed.

**Out:** any remote. `numcopies` stays 1 because there is nowhere to
copy to. This iteration does not improve durability — it improves
integrity and sets up durability. That distinction is stated plainly
because it would be easy to mistake "on git-annex" for "backed up."

The 38 single-copy files in estate remain single-copy until the remote
iteration. The interim mitigation is in "Prerequisites".

## Stated preferences this plan trades against

- `docs/engineering-principles.md` **#4** (resilient AND never silent),
  **#8** (one way to do each thing — this plan deletes a parallel
  mechanism rather than adding a third), **#10** (testability is
  architectural), **#12** (the maintainer is usually an agent — hence
  the pointer-file health check).
- `callback-box/CLAUDE.md:106`: *"Read before writing. Don't guess file
  formats, XML structures, or API shapes."* Every behavioral claim below
  was executed, not inferred; see Prototype findings.
- `callback-box/code-style.md` — no `any`, max 2 positional params,
  `Result<T,E>` only where callers branch on why.
- The boxholder's standing preference to consolidate rather than
  preserve parallel mechanisms out of blast-radius fear: this plan
  deletes ~490 lines of manifest code rather than keeping it alongside.

The central trade is **#8 vs. churn**: two asset-tracking systems is
worse than one, even though collapsing them touches four boxes and a
committed on-disk format.

## Prototype findings

Executed against git-annex 10.20260717 (Homebrew; Ubuntu 24.04 ships
10.20240129) in a scratch repo. These settle what the docs left
ambiguous and several of them changed the design.

**1. Our automated commit flow needs no changes.** With
`annex.largefiles=include=*.attach/*`, a plain `git add -A && git
commit` puts assets in the annex and cards in git. The reactor's
existing commit path is untouched, and no code has to learn `git annex
add`.

**2. `git annex init` does not clobber our hook.** With `cb init`'s
`.git/hooks/pre-commit` already present it prints *"pre-commit hook
(.git/hooks/pre-commit) already exists, not configuring"* and proceeds,
installing only `post-checkout`, `post-merge`, `post-receive`.
Consequence: **our hook must invoke `git annex pre-commit` itself**, or
annex's commit-time work silently never runs. Track E.

**3. Working-tree files are ordinary files, not symlinks.** Because
content arrives through `git add`'s clean filter, files are *unlocked*
— readable and writable in place by agents, the capture endpoint, and
the webapp with no adjusted branch and no `git annex unlock`.

**4. The pointer file is self-describing.** A clone without content
holds a 101-byte file:
```
/annex/objects/SHA256E-s300000--2ee2c7d4…f92.jpg
```
Expected size and sha256 are both in it. This is what makes Track C's
health check and Track D's absence handling cheap and exact — a reader
can report *"content not present (300,000 bytes, sha256 2ee2c7…)"*
rather than guessing.

**5. A missing git-annex install and absent content look identical.**
Both produce that same 101-byte pointer. One detector covers both,
which is why Track C and Track D share a predicate.

**6. `annex.thin` is an either/or, and thin loses integrity checking.**
Measured both ways:

| | working tree | corruption detected by `fsck`? |
|---|---|---|
| `annex.thin=true` | hardlink (link count 2), no disk penalty | **No.** Corrupting a file in place left its object hashing to `9c74e3…` under a key claiming `2ee2c7…`; `fsck` reported only the copy-count shortfall |
| `annex.thin=false` | separate copy (link count 1), 2× disk | **Yes** — *"Bad file content; moved to .git/annex/bad/SHA256E-s200000--34ca…"*, quarantined |

Thin would be a **regression** against today's manifest system, which
does catch in-place modification (`asset-manifest-scan.ts:42`
`hash-mismatch`; `docs/asset-manifests.md:220`). Hence `annex.thin=false`,
and hence the disk prerequisite.

**7. Gitignored files never reach the annex.** With the box's existing
`**/*.attach/**/*.jpg` rule still present, `git add -A` left the asset
ignored and unannexed. **Removing the asset patterns from the box
`.gitignore` is a mandatory migration step**, not a tidy-up. Track B.

**8. `git annex get` in a fresh clone fails until the location log is
synced.** A clone of a box whose journal hadn't been flushed reported
*"0 copies"* and *"No other repository is known to contain the file."*
`git annex merge` in the source (flushing its journal to the
`git-annex` branch) plus `git fetch && git annex merge` in the clone
fixed it. Consequence: the worktree hook must sync, not just `get`, and
the health check should verify the branch is current. Track F.

**9. `numcopies` and `fsck` behave as advertised.** `drop` under
`numcopies 2` with one copy refuses: *"(Use --force to override this
check, or adjust numcopies.)"* Not exercised this iteration — recorded
because it is the mechanism the remote iteration depends on.

## What already exists

- **`src/core/asset-manifest.ts`** (142 lines) and
  **`src/core/asset-manifest-scan.ts`** (348 lines) — the manifest
  format, hashing, and directory walk. **Retired**, not reused.
  git-annex's key (`SHA256E-s<size>--<hash>`) carries the same
  information git-annex itself maintains, so keeping both is exactly
  the duplication #8 forbids.
- **`src/core/commands/attachments.ts`** — `verify` / `migrate` / `add`
  / `overwrite` (`:75` dispatch). **Mostly retired.** `overwrite` loses
  its purpose entirely: under annex, writing a file in place and
  committing is the supported path.
- **`src/core/commands/attachments-gitignore.ts`** — `init-gitignore`,
  which *adds* the asset patterns. **Inverted** into the migration that
  removes them (finding 7).
- **`src/core/install-validation-hooks.ts:222-253`** — the generated
  pre-commit hook. **Extended** with `git annex pre-commit` (finding 2)
  and with the health check; its `cb attachments verify` call
  (`:252`) is removed.
- **`.claude/hooks/worktree-create.sh:137-146`** — copies every
  gitignored attach file from the source box, because *"a clone gets
  the cards and the manifests but none of the bytes"*
  (`worktree-create.sh:128-129`). **Replaced** by `git annex sync` +
  `git annex get` (finding 8), which also works when there is no local
  source box to copy from.
- **`src/core/housekeeping.ts`** — deterministic non-agent work during
  sync (`:4`). **Reused** as the hook point for scheduled `fsck`.
- **`src/lib/file-lock.ts`** — per-box cross-process lock. **Reused**
  to keep `fsck` from overlapping a wakeup.

Net: this plan deletes more code than it adds.

## Prior art (external)

- **git-annex `annex.largefiles`** — the mechanism that makes finding 1
  work; expression syntax and precedence (local config >
  `.gitattributes` > `git annex config`) at
  [tips/largefiles](https://git-annex.branchable.com/tips/largefiles/).
  We set it via `git annex config` so it propagates to clones.
- **Unlocked files and `annex.thin`** —
  [tips/unlocked_files](https://git-annex.branchable.com/tips/unlocked_files/)
  documents the 2× disk cost and says `annex.thin` *"trades safety for
  space"*. Finding 6 is that sentence measured: the safety traded away
  is exactly `fsck`'s checksum verification.
- **`git annex pre-commit`** — [the man
  page](https://www.mankier.com/1/git-annex-pre-commit) confirms `git
  annex init` normally installs a pre-commit hook, and that
  `.git/hooks/pre-commit-annex` is the sanctioned place for a
  repository's own commit-time work. An alternative to Track E's
  approach; not chosen because our hook is generated and versioned by
  `cb init` and splitting it across two files would obscure that.
- **Special remote `autoenable=true`** —
  [git-annex-initremote](https://git-annex.branchable.com/git-annex-initremote/):
  *"when git-annex is run in a new clone, it will attempt to enable the
  special remote."* Not used this iteration; recorded because it is
  what makes the remote iteration's clone story a no-op.
- **No prior art found** for driving git-annex from a Node/TypeScript
  application layer. Searches for a maintained JS wrapper turned up
  nothing current, so this plan shells out to the `git-annex` binary
  behind a service interface (Track C) rather than adopting a library.
- **Deferred, still valid:** the R2 cost and API analysis in
  `asset-offbox-storage.md` — $0/month at the current ~9.35 GB against
  a 10 GB free tier, the Cloudflare REST API's 1,200-req/5-min account
  cap, and the `@aws-sdk/client-s3` CRC32/R2 501 incompatibility. Input
  to the next iteration.

## Tracks / scope

Ordered by dependency. B cannot start before A (disk), and C/D/E/F all
depend on B having defined the on-disk shape.

### Track A — reclaim disk headroom

**What.** Remove stale backups from the prod server before any box is
converted.

**Why this needs to change.** `annex.thin=false` doubles resident asset
bytes. estate is 9,031.8 MB of assets on a disk with **5.6 GB free of
75 GB (93% used)**. Converting estate today would fail partway and
leave a half-annexed box — the worst possible state.

Available: `/home/callback/backups/pre-migration-20260523` (11 GB, from
the May migration) and `/home/callback/box-backups/2026-07-04`
(440 MB). Removing both yields ~16.6 GB free; estate's conversion
consumes ~9 GB, landing at ~7.6 GB free.

**Direction.** Verify each backup is genuinely superseded, then remove.
This is a boxholder action on live data, not something the
implementation does unattended.

**First implementation chunk.** Confirm-and-delete, then record actual
free space. Gate for everything downstream.

### Track B — migrate boxes onto git-annex

**What.** Convert each box from manifest-tracked gitignored assets to
annexed assets.

**Why this needs to change.** This is the plan.

**Direction.** Per box, in order of increasing size (`personal-test`
first as the rehearsal, `estate` last):

```bash
git annex init "<box-slug>"
git annex config --set annex.largefiles 'include=*.attach/*'
git config annex.thin false            # local, per clone — see below
cb attachments unignore                # removes the asset patterns (finding 7)
git add -A                             # largefiles routes assets into the annex
git commit -m "Move assets onto git-annex"
git rm --cached <every manifest.json> && rm <every manifest.json>
git annex fsck                         # verify every object
```

**Configuration lock-ins**, and where each lives:

| setting | value | scope | propagates to clones? |
|---|---|---|---|
| `annex.largefiles` | `include=*.attach/*` | `git annex config` | **yes** (git-annex branch) |
| `annex.thin` | `false` | `git config` | **no** — per clone |
| `numcopies` | 1 | `git annex numcopies` | yes |

`annex.thin` not propagating is a trap: a clone silently gets
git-annex's default. The health check must assert it per repository
(Track C), which is a case where a per-clone setting genuinely cannot
be made declarative and enforcement has to substitute (#11,
"enforcement beats convention").

The extension list in `docs/asset-manifests.md:169-186` is *replaced*
by one path-shaped expression. That is a real simplification: the
batch-local `.gitignore` workaround for arbitrary extensions
(`docs/asset-manifests.md:193-213`, written because bulk upload lands
`.zip`/`.csv`/extensionless files) becomes unnecessary — `include=*.attach/*`
is extension-blind by construction.

`cb attachments unignore` removes the asset extension list and the
bulk-upload batch-local files, but **keeps one rule**: the capture
staging path, which stays ignored deliberately (Track G).

**Assets already in git history stay there.** estate's `.git` is 9.9 GB
of pre-migration blobs. Annexing adds pointer commits; it does not
remove history. Reclaiming that is `git filter-repo`, still out of
scope — and now *more* firmly so, because until the remote iteration
that history remains the only off-box copy of 8.88 GB.

**First implementation chunk.** `cb attachments unignore` (the inverse
of `attachments-gitignore.ts`), plus a filesystem doctest converting a
`makeTmpBox()` fixture end to end and asserting assets are annexed,
cards are not, and manifests are gone.

### Track C — `cb doctor annex`, the health check

**What.** A check that a box is correctly and completely annexed. The
boxholder asked for this explicitly, and findings 4–7 make it exact.

**Why this needs to change.** Under annex, four distinct
misconfigurations produce a working tree that *looks* fine, and one of
them (a pointer file served as an image) is silent data-shaped garbage
— a #4 violation if undetected.

**Direction.** Seven assertions, each with a distinct message:

1. `git-annex` on PATH, and its version (Ubuntu ships 10.20240129;
   Homebrew 10.20260717 — flag a version older than the repo format).
2. The repository is initialized (`git annex info` succeeds).
3. `annex.thin` is `false` — per-clone, so this is the one that will
   actually fire (Track B's table).
4. `annex.largefiles` is set and matches `include=*.attach/*`.
5. **No pointer file is masquerading as content**: any file under a
   `.attach/` scope whose bytes begin `/annex/objects/` is either
   absent content or a broken checkout. Report the count, and for each
   the expected size and hash parsed out of the pointer (finding 4).
6. The `git-annex` branch has no unflushed journal (finding 8).
7. No asset has been sitting in `tmp-capture/` longer than N days
   (Track G) — the one window where content is in neither git nor the
   annex.

Assertion 5 is the load-bearing one and is shared with Track D — one
predicate, `isAnnexPointer(bytes)`, used by both the health check and
the read paths (#8).

Runs from `cb init`, as part of the deployed-server health checks
(`docs/health-checks.md`), and **as a gate on `cb serve` startup**: a
box that fails any assertion refuses to serve, printing the failing
assertion and its remedy. Annexing is one-time setup that belongs at
the beginning, and a box quietly serving pointer files as images is a
worse outcome than a box that won't start. `cb hub` reports the refusal
per-box rather than treating it as a crash loop.

**First implementation chunk.** `src/lib/annex-pointer.ts` with
`isAnnexPointer()` / `parseAnnexPointer()` and a pure-function doctest
covering a real pointer, a real JPEG, an empty file, and a text file
that merely starts with a slash. No open questions.

### Track D — absence is a normal state

**What.** Teach the read paths that an asset's content may not be
present locally, and surface that distinctly.

**Why this needs to change.** Today a manifest entry without its file
is a hard error (`asset-manifest-scan.ts:35`, `missing-file`). Under
annex it is routine — a fresh clone has every pointer and no content.
Without this track, every image in a fresh worktree renders as
whatever the browser makes of 101 bytes of text.

**Direction.** `parseAnnexPointer()` at each read boundary:

- **Webapp file routes** — a pointer yields HTTP 409 with a JSON body
  naming the key, expected size, and `git annex get <path>`. Not 404:
  the file exists and is tracked; its content is elsewhere. Not 200
  with pointer bytes, ever.
- **Frontend renderers** (`src/frontend/src/renderers/`) — a distinct
  "content not present locally" state, alongside the existing
  loading/error states. Shows size and the fetch command.
- **Agent-facing reads** — the same, as prose, since agents are the
  primary audience of these messages
  (`docs/asset-manifests.md:146`).

The audit is bounded: every read goes through an attach-scope path
resolution (`src/shared/attach-path.ts`), so the enumeration is
"callers of that", not "every `readFile` in the codebase."

**First implementation chunk.** The webapp route boundary plus a route
doctest (`makeTestServer()`) asserting 409-with-key for a pointer and
200 for real content.

### Track E — hook and housekeeping integration

**What.** Make the generated pre-commit hook annex-aware; schedule
`fsck`.

**Why this needs to change.** Finding 2: annex declined to install its
pre-commit hook because ours exists, so its commit-time work never
runs unless we call it. And `fsck` is the entire integrity story now
that manifests are gone — unscheduled, it is a command nobody runs.

**Direction.** In `install-validation-hooks.ts`, replace the
`cb attachments verify` line (`:252`) with `git annex pre-commit`,
guarded so a box without git-annex fails with a clear message rather
than a bare command-not-found. Add `cb doctor annex` (Track C).

`fsck` from `housekeeping.ts`. Full-repo `fsck` rehashes every object —
9 GB on estate — so it runs **incrementally**: `git annex fsck
--incremental-schedule=30d`, which git-annex itself paces. Holds the
per-box `file-lock.ts` so it cannot overlap a wakeup.

**First implementation chunk.** Hook generation change plus its
doctest; `cb init` regeneration verified on `test1`.

### Track F — worktree clone flow

**What.** Replace the asset-copy loop in `worktree-create.sh` with
annex fetching.

**Why this needs to change.** Finding 8: `git annex get` in a fresh
clone fails with *"No other repository is known to contain the file"*
until the location log is synced. A naive replacement of the cp loop
produces a worktree box with no images and a confusing error.

**Direction.** Replace `worktree-create.sh:137-146` with:

```bash
git -C "$BOX_SRC" annex merge          # flush the source's journal
git -C "$BOX_DEST" annex init "worktree-<name>"
git -C "$BOX_DEST" annex sync
git -C "$BOX_DEST" annex get .
```

The connector-secret copy immediately above (`:104-122`) stays as-is —
secrets are gitignored for a different reason and are not annexed.

**First implementation chunk.** Hook edit, exercised by creating a real
worktree and confirming images render.

### Track G — capture staging stays out of the annex

**What.** Assets arriving from mobile/web capture are *not* annexed
where they land. They become annexed when the agent moves them to a
final destination.

**Why this needs to change.** Capture lands at
`content/tmp-capture/capture-<ts>-<id>.attach/...` — the cards there are
committed (on estate: 6 tracked files across 2 sessions) while the
asset bytes are gitignored. If `annex.largefiles` simply matched
`*.attach/*`, every capture would be annexed the instant it arrived,
which is wrong in two ways:

- **It stores superseded content permanently.** Captures are triaged,
  renamed, re-encoded, and EXIF-rotated (`docs/image-orientation.md`)
  before reaching their final home. Annexing at arrival mints an
  immutable object for each intermediate version; the annex accumulates
  content nothing references.
- **It annexes things that get discarded.** A capture the agent decides
  against still leaves an object behind.

The agent filing something into its final destination is the moment the
content is settled. That is the right moment to add it.

**Direction.** Keep the capture area gitignored. Per finding 7, a
gitignored file never reaches the annex, so **no `annex.largefiles`
exclusion is needed** — the gitignore rule is the whole mechanism:

```gitignore
# Capture staging — assets here are pre-triage and deliberately
# un-annexed. They join the annex when the agent files them.
content/tmp-capture/**/*.attach/**
```

`cb mv` into a final destination moves the bytes out of the ignored
path; the next `git add -A` annexes them via `include=*.attach/*`. No
new code on the move path.

Two consequences that must be handled rather than assumed:

1. **A staged asset is in neither git nor the annex.** That is true
   today too, but under this plan it becomes the *only* unprotected
   window, so it needs to be visible instead of implicit. Track C gains
   a seventh assertion: **no asset has been sitting in `tmp-capture/`
   longer than N days.** estate has 2 such files right now, both from
   2026-07-29 and both among the 38 with no second copy anywhere — so
   this is a live condition, not a hypothetical.
2. **The bulk-upload batch-local `.gitignore`
   (`docs/asset-manifests.md:193-213`, written by
   `src/core/bulk-upload/prepare.ts`) must be removed** during
   migration. It ignores everything in a batch scope, which under annex
   means those blobs would never be annexed — finding 7's trap, one
   layer down. Bulk upload lands arbitrary extensions, which is exactly
   what `include=*.attach/*` handles without an extension list.

**First implementation chunk.** The gitignore rule plus assertion 7,
with a filesystem doctest: an asset in `tmp-capture/` is not annexed
and is reported by dwell-time; the same asset after `cb mv` to a store
path is annexed on the next commit.

### Track H — docs and knowledge audits

`docs/asset-manifests.md` is rewritten as `docs/assets.md` describing
the annex model; the manifest doc moves to `docs/implemented-plans/`
since it accurately records a system that existed. `docs/migrations.md`
gets the Track B runbook. Knowledge audits below.

## Subplans

None. The one candidate — the remote — is a *later iteration*, not a
concurrent subplan: per the skill's rule a subplan ships with its
parent, and the whole point of this scoping is that the remote does
not.

## Failure modes

> **Critical gap: `annex.thin` drift on a clone.** It does not
> propagate (Track B's table). A clone that silently gets thin mode
> loses `fsck`'s corruption detection (finding 6) with no symptom.
> Handled by Track C assertion 3 — but only if the check actually runs,
> which is why it is wired into `cb init` and the server health checks
> rather than left as a command.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Pointer file served as image content | Yes (route doctest) | Track D — 409 naming the key | Clear |
| git-annex not installed on a clone | Yes | Track C assertion 1 | Clear |
| `annex.thin` true on a clone | Yes | Track C assertion 3 | Clear — *given the check runs* (see gap above) |
| Object corrupted on disk | Yes | `fsck` quarantines to `.git/annex/bad/` (finding 6) | Clear |
| Migration interrupted mid-box | Yes | Re-runnable: `git annex init` and `largefiles` are idempotent, `git add -A` resumes | Clear |
| Disk fills during estate's conversion | Manual | Track A is a hard gate with measured headroom | Clear — fails loudly on ENOSPC |
| `git annex get` in a clone with unsynced location log | Yes | Track F syncs first | Clear |
| Asset still gitignored after migration | Yes (doctest asserts it is annexed) | Track B's `unignore` | Clear |
| Bulk-upload batch `.gitignore` survives migration, so its blobs never annex | Yes (doctest on a batch scope) | Track G — `unignore` removes batch-local files | Clear |
| Capture sits in `tmp-capture/` unannexed and un-backed-up | Yes | Track C assertion 7 reports dwell time | Clear — **and live today**: 2 estate files since 2026-07-29 |
| Our pre-commit hook shadows annex's | Yes (hook-generation doctest) | Track E calls `git annex pre-commit` | Clear |
| Agent runs `git annex drop` | No | `numcopies=1` makes drop refuse by default | Clear — refuses |
| Box committed with `--no-verify` | Yes (pre-existing) | Next non-skipped commit catches up; `largefiles` applies at `git add`, not at hook time, so assets are annexed regardless | Clear |
| Content lost with no second copy | **No — impossible to handle** | **None. This iteration adds no durability.** | Clear, and stated in Scope |

The last row is the honest one. Per #4's *"never resilient to the
impossible"*, the response is to name it in the plan's scope section
rather than let "on git-annex" read as "safe".

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — **N/A.** No card syntax, schema field,
  or Markdoc tag changes. Cards reference assets exactly as before.
- **Stale ref** — **ADDRESSED.** `<filename ref="attach/...">` resolves
  through `src/shared/attach-path.ts` unchanged. A moved asset keeps
  its annex key (content-addressed), so a rename is a pure git
  operation with no content movement — strictly simpler than the
  manifest's rename-detection heuristic
  (`docs/asset-manifests.md:148-155`), which is deleted.
- **Two agents touching the same card** — **ADDRESSED.** Unchanged for
  cards. For assets, git-annex's `git-annex` branch uses a union merge
  driver, so concurrent location-log writes merge without conflict.
- **Hand-edit drift** — **ADDRESSED, with a behavior change worth
  stating.** Today an in-place edit blocks the commit
  (`docs/asset-manifests.md:220`). Under annex it is *accepted*: the
  clean filter ingests the new content as a new key on `git add`. That
  is better — it is a version, not an error — but it is a change, and
  `docs/assets.md` must say so.
- **Fabricated free-form value** — **N/A.** Every value is
  machine-computed (a key, a size, a hash). No free-form field exists
  for an agent to invent.
- **Validation error UX** — **ADDRESSED.** Track C and D messages name
  the remedy (`git annex get <path>`), following the house style.
- **Partial migration / transition state** — **ADDRESSED.** Boxes
  convert one at a time and a box is either annexed or not; Track C
  assertion 2 distinguishes them. Mixed state *within* a box is the
  interrupted-migration row above, and is re-runnable.

## NOT in scope

- **Any remote (R2 or otherwise).** The next iteration. This plan's
  job is to make that iteration configuration rather than design.
- **Dropping content.** Requires a remote to drop *to*; `numcopies=1`
  makes it refuse anyway.
- **`git filter-repo` on estate's 9.9 GB history.** Riskier, separate,
  and gated on the remote iteration — that history is still the only
  off-box copy of 8.88 GB.
- **Annexing anything outside `.attach/` scopes.** `include=*.attach/*`
  matches today's scope exactly (`docs/asset-manifests.md:188`). The
  advisory for large binaries committed outside a scope stays as-is.
- **The git-annex assistant / webapp daemon.** Homebrew's formula offers
  it; we want deterministic, commanded behavior, not a watcher.
- **Encryption of annexed content.** Local-only; nothing leaves the
  disk this iteration.
- **Migrating boxes off git-annex.** No reverse migration is written.
  If this proves wrong, `git annex uninit` restores plain files, and
  that is the escape hatch rather than a maintained path.

## Open design questions

1. **`git annex fsck` cadence on estate.** Lean:
   `--incremental-schedule=30d`, letting git-annex pace it. Wants a
   real measurement of what a full 9 GB pass costs before committing —
   the number is unknown and the box is shared with live wakeups.
2. **The tmp-capture dwell-time threshold.** Track C assertion 7 says
   "no asset has been in `tmp-capture/` longer than N days."
   Lean: N=7, matching the `tmp/` upload sweep's existing 7-day window
   (`src/core/housekeeping.ts:18-19`). Wants one look at real triage
   latency across boxes before fixing the number.

Resolved during design, recorded so the reasoning isn't relitigated:

- **`cb doctor annex` blocks `cb serve` startup** (boxholder decision,
  2026-07-30). A box that isn't correctly annexed should not begin
  serving — the setup is one-time and belongs at the beginning, and a
  box quietly serving pointer files is worse than a box that refuses to
  start with a message naming the fix.
- **Mixed git-annex versions are fine** (Ubuntu 10.20240129 / Homebrew
  10.20260717, boxholder decision). Both handle repo version 10; no
  cross-version test gate.

None of the above sits inside a first implementation chunk.

## Knowledge audits

This plan changes agent-facing reality in two ways an agent will hit
directly, so two entries for `src/dev/knowledge-audits.yaml`, tagged
`[assets]`:

- `asset-content-absent` — *"You open a photo in a box and the file is
  101 bytes of text starting with `/annex/objects/`. What happened?"* —
  `expected_level: knows_directly`, `correct_contains: ["git annex
  get"]`. Watching for the agent recognizing absent content rather than
  concluding the file is corrupt or lost.
- `asset-add-workflow` — *"How do you add a photo to a card's attach
  scope?"* — `expected_level: knows_directly`. Watching for plain `git
  add`, **not** `git annex add` — finding 1 means the simpler answer is
  the correct one, and an agent reaching for `git annex add` has
  learned a needless special case.

Both land **run**: `pnpm knowledge-audit run --box
<absolute-path-to-test-box> --filter assets`, status comment recorded
in `knowledge-audits.yaml` before the plan completes. (Absolute path —
a bare `--box test1` resolves inside the monorepo.)

## Implementation order

1. **A** — reclaim server disk. *Gates everything.*
2. **C1** — `src/lib/annex-pointer.ts` + doctest. *No dependencies;
   can start immediately, and D and C both need it.*
3. **B1** — `cb attachments unignore` + migration doctest.
4. **B2** — convert `personal-test` (the rehearsal — 3,016 assets,
   271 MB, and its 3,018 unclaimed files stop being a problem by
   construction). *Depends on B1.*
5. **C2** — `cb doctor annex`, assertions 1–6, plus the `cb serve`
   startup gate. *Depends on C1, B2.* (Assertion 7 lands with G.)
6. **D** — absence handling: webapp route, renderers, agent reads.
   *Depends on C1.*
7. **E** — hook generation + `fsck` in housekeeping. *Depends on B1.*
8. **F** — worktree clone hook. *Depends on B2, and on D so a
   partially-fetched worktree degrades legibly.*
9. **G** — capture-staging gitignore rule + assertion 7 + doctest.
   *Depends on C2; must land before B3 so converting estate doesn't
   annex its two pending captures.*
10. **B3** — convert prod boxes, smallest first: `box-family` (8
    assets), `personal` (6), then `estate` (1,184 / 9 GB). *Depends on
    A, C2, D, E, G.*
11. **H** — docs rewrite, knowledge audits written and run.

**Done-when**, as checkable assertions: (a) every doctest named below
passes; (b) `cb doctor annex` is clean on all four asset-holding boxes;
(c) `git annex fsck` on estate reports zero bad objects across all
1,184 assets; (d) a fresh worktree clone renders images after
`worktree-create.sh` runs, with no `cp` loop; (e) `grep -r asset-manifest
src/` returns nothing; (f) `cb serve` refuses to start on a box with
`annex.thin` unset, naming the fix; (g) a freshly-captured asset is
*not* annexed until `cb mv` files it.

## Rollout shape

**Test posture.** Per `docs/testing.md`, tests come first as a design
tool. Named up front:

- `test/lib/annex-pointer.doctest.md` — pure tier: real pointer, real
  JPEG, empty file, text file starting with `/`.
- `test/core/commands/attachments-unignore.doctest.md` — filesystem
  tier (`makeTmpBox()`): asset annexed, card in git, manifest removed,
  re-run idempotent.
- `test/webapp/routes/attach-absent.doctest.md` — route tier
  (`makeTestServer()`): 409-with-key for a pointer, 200 for content.
- `test/core/install-validation-hooks.doctest.md` — extend the existing
  coverage to assert the generated hook calls `git annex pre-commit`
  and no longer calls `cb attachments verify`.
- `test/core/capture/staging-not-annexed.doctest.md` — filesystem tier:
  an asset in `tmp-capture/` is unannexed and reported by dwell-time;
  the same asset after `cb mv` is annexed on the next commit (Track G).
- `test/cli/serve-annex-gate.doctest.md` — `cb serve` refuses to start
  on a box failing any `cb doctor annex` assertion, and the message
  names the assertion and its remedy.

Deliberately untested: git-annex's own behavior. Findings 1–9 are
recorded here as the evidence; re-asserting them in doctests would
test someone else's software (`docs/testing.md` — tests are not for
coverage's own sake).

**Migration.** A real on-disk shape change across four boxes: assets
move from gitignored-with-manifest to annexed, and every `manifest.json`
is deleted. Scripted as `cb attachments unignore` plus the Track B
runbook, run per box by an agent with the boxholder present, smallest
box first. Not gradual — a box is converted in one commit, because a
half-converted box is the state Track A's disk gate exists to prevent.

Rollback within a box is `git annex uninit` plus reverting the
migration commit; rollback after other commits land on top is a restore
from the box's git remote. Worth stating because there is no reverse
migration path and that is a deliberate choice, not an oversight.

## Prerequisites and interim mitigation

Track A (reclaim 11 GB) gates the plan.

1. **estate backup — DONE (2026-07-30).** `~/src/box-backups/estate-2026-07-30/`
   holds every gitignored estate file not already recoverable from git
   history: **162 files, 171 MB**, all sha256 verified against the
   server after transfer. That is the 38 post-migration attach assets
   (149 MB) plus ~19 MB of SQLite/generated/secret state. A full 20 GB
   mirror was not taken and is not needed — 1,146 of estate's 1,184
   assets (8.88 GB) are blobs in git history with `HEAD ==
   origin/main`. It also wouldn't fit: 14 GB free locally, 5.6 GB on
   the server. See that directory's `README.md` for the restore
   command.
2. **Do not run `git filter-repo` on any box** until the remote
   iteration lands. That history is protecting 8.88 GB, and it is half
   of what makes the backup above sufficient rather than partial.
