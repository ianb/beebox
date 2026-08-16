---
title: "Assets on git-annex"
status: active
workstream: unknown
issues: []
---
# Assets on git-annex

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
`annex.largefiles` set, a plain `git add -A && git commit` routes
matching files into the annex and everything else into git. The
reactor's existing commit path is untouched, and no code has to learn
`git annex add`.

> **Caveat, and the plan's worst near-miss.** This was first run with
> `include=*.attach/*` and a card *beside* an attach scope, and read as
> "cards stay in git." Re-run with a card *inside* a scope — the shape
> every real box actually has — that selector annexes the card. See
> finding 10 and Track B's classifier section.

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
does catch in-place modification (`asset-manifest-scan.ts:43`
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

**10. The extension-allowlist classifier is correct against the real
box shape.** Re-run with
`include=*.attach/*.jpg or include=*.attach/*.png or include=*.attach/*.frozen`
against a fixture mirroring estate:

| file | result |
|---|---|
| `photos.attach/photo-001.attach/photo-001.jpg` (nested child scope) | **annexed** |
| `photos.attach/attachments/inline.png` (plain subdir) | **annexed** |
| `photos.attach/photo-001.image.card` (card *inside* the scope) | in git |
| `photos.attach/manifest.json` | in git |
| `photos.attach/msg-001.body.txt` | in git |
| `note.memo.card` (outside any scope) | in git |

Also establishes that git-annex globs let `*` cross `/`, so a
mid-pattern `.attach/` anchors the scope and no `**` is needed.

## What already exists

- **`src/core/asset-manifest.ts`** (141 lines) and
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

**The classifier — an extension allowlist, not a path glob.**

An earlier draft used `annex.largefiles=include=*.attach/*`, on the
reasoning that everything in an attach scope is an asset. **That is
wrong and would have been destructive.** Attach scopes legitimately
hold committed non-assets: on prod estate, **1,844 tracked files live
inside `.attach/` scopes** — 1,206 `.card`, 397 `.json`, 145 `.md`, 81
`.txt`, 8 `.xlsx`, 6 `.csv`. Capture writes child cards *into* the
parent scope (`src/core/capture/write-cards.ts`), and the existing scan
excludes them explicitly — `src/core/asset-manifest-scan.ts:116`:
`if (d.name.endsWith(".card")) continue;`. A path glob would have
turned 1,206 committed cards into annex pointers on the first
conversion, handing pointer text to every card parser.

The correct source of truth already exists:
`ASSET_GITIGNORE_EXTENSIONS` (`src/core/commands/attachments-gitignore.ts:57-76`)
— **the** list, already rendered into two places, and already including
`frozen`. This plan renders it into a third form and deletes one:

```
include=*.attach/*.jpg or include=*.attach/*.jpeg or … or include=*.attach/*.frozen
```

Verified against the real box shape: with this expression, an asset
nested in a child scope (`photos.attach/photo-001.attach/photo-001.jpg`)
and one in a plain subdirectory (`photos.attach/attachments/inline.png`)
both annex, while `photos.attach/photo-001.image.card`,
`photos.attach/manifest.json`, and `photos.attach/msg-001.body.txt` all
stay ordinary git files. (git-annex globs let `*` cross `/`, so the
mid-pattern `.attach/` anchors the scope without needing `**`.)

**The `.frozen` lesson is load-bearing.** That same file's comment
(`attachments-gitignore.ts:51-55`) records why an allowlist is
dangerous: *"an omission here means the bytes get committed directly —
which is how frozen web pages (`page.frozen`, up to 41MB apiece) ended
up in box history before 2026-07-19."* Under annex the same omission
has the same consequence, so the allowlist ships **with** a guard: a
file in an attach scope over 1 MB whose extension is not in the list is
a **commit-blocking error**, not today's advisory. That converts the
class of bug that has already bitten once into something that cannot
recur silently. It is also why the plan does not adopt a
`largerthan=`-only rule: size alone would annex a large `.md` or a big
`manifest.json`.

**Direction.** Per box, in order of increasing size (`personal-test`
first as the rehearsal, `estate` last and gated — see Track B3):

```bash
git annex init "<box-slug>"
git annex config --set annex.largefiles "$(cb attachments largefiles-expr)"
git config annex.thin false            # local, per clone — see below
cb attachments migrate --verify-only   # every asset claimed + hash-clean (see below)
cb attachments unignore                # removes the asset patterns (finding 7)
git add -A                             # largefiles routes assets into the annex
cb attachments verify-annex-keys       # every manifest sha256 == its annex key
git rm --cached <manifests>            # only manifests cb itself resolved
git commit -m "Move assets onto git-annex"   # ONE commit: pointers + removals
git annex fsck                         # verify every object
```

**Two verification steps flank the conversion, and both are required.**
`git annex fsck` proves an object matches the key git-annex derived
from it *at migration time* — it cannot detect that the bytes were
already corrupt before conversion. Only the manifest holds an
independent, earlier claim about what those bytes should be
(`asset-manifest-scan.ts` reports `hash-mismatch` and `missing-file`
for exactly this). So: verify the manifests are clean *before*
converting, compare every manifest sha256 against the resulting annex
key *after*, and only then delete the manifests. Deleting the
independent record before checking it against the new one would bless
whatever corruption already existed.

**Configuration lock-ins**, and where each lives:

| setting | value | scope | propagates to clones? |
|---|---|---|---|
| `annex.largefiles` | rendered from `ASSET_GITIGNORE_EXTENSIONS` | `git annex config` | **yes** (git-annex branch) |
| `annex.thin` | `false` | `git config` | **no** — per clone |
| `numcopies` | 1 | `git annex numcopies` | yes |

`annex.thin` not propagating is a trap: a clone silently gets
git-annex's default. Track C repairs it per repository on every `cb
serve` / `cb init`, which is a case where a per-clone setting genuinely
cannot be made declarative and enforcement has to substitute (#11,
"enforcement beats convention").

`cb attachments unignore` removes the asset extension block from the
box `.gitignore`, but **keeps two things**: the capture staging rule
(Track G) and — for bulk-upload batch scopes — swaps the batch-local
`.gitignore` for a batch-local `.gitattributes` (Track G).

**The migration is a script, not a runbook.** The commands above are
the shape; the implementation is `cb attachments to-annex`, which:
requires a clean working tree; resolves manifests it wrote rather than
globbing `manifest.json` (boxes contain unrelated manifests —
`src/publish/manifest.ts`, `src/core/search/manifest.ts`,
`src/frontend/public/manifest.webmanifest`); preflights free bytes
against the box's asset total before touching anything; and lands
pointers *and* manifest removals in a single commit so there is no
committed intermediate state where both records exist. On ENOSPC it
aborts with the phase recorded, and `git annex uninit` plus a hard
reset returns the box to its pre-migration state.

**Assets already in git history stay there.** estate's `.git` is 9.9 GB
of pre-migration blobs. Annexing adds pointer commits; it does not
remove history. Reclaiming that is `git filter-repo`, still out of
scope — and now *more* firmly so, because until the remote iteration
that history remains the only off-box copy of 8.88 GB.

**First implementation chunk.** `cb attachments largefiles-expr`
(rendering `ASSET_GITIGNORE_EXTENSIONS`) plus `cb attachments
unignore`, with a filesystem doctest built on **the estate shape, not a
synthetic one**: a `makeTmpBox()` fixture holding a child `.card`
inside a scope, a nested child scope, a plain `attachments/`
subdirectory, a `manifest.json`, and a `.txt` body — asserting exactly
which become pointers. The earlier draft's classifier passed a
synthetic test because the test never nested a card inside a scope;
this fixture is the regression guard.

### Track C — `cb doctor annex`, the health check

**What.** A check that a box is correctly and completely annexed. The
boxholder asked for this explicitly, and findings 4–7 make it exact.

**Why this needs to change.** Under annex, four distinct
misconfigurations produce a working tree that *looks* fine, and one of
them (a pointer file served as an image) is silent data-shaped garbage
— a #4 violation if undetected.

**Direction.** Seven checks. Most of them describe a state the box can
simply *put right*, so the command's default is **repair, not report** —
`cb doctor annex` fixes what it can, logs each repair, and reports only
what it cannot fix. `--check` is the read-only mode for scripts.

| # | check | self-heal | cost |
|---|---|---|---|
| 1 | `git-annex` on PATH | **no** — needs a software install | — |
| 2 | repo initialized | `git annex init "<slug>"` | cheap |
| 3 | `annex.thin` is false | `git config` **+ `git annex fix`** | O(repo) once |
| 4 | `annex.largefiles` set | `git annex config --set` | cheap |
| 5 | no pointer masquerading as content | **no** — see below | — |
| 6 | `git-annex` branch journal flushed | `git annex merge` | cheap |
| 7 | this repo's pre-commit hook actually invokes `git annex pre-commit` | rewrite if we own the hook; **no** if it's foreign | cheap |

Check 7 exists because the installer deliberately leaves a
non-managed pre-commit hook untouched
(`src/core/install-validation-hooks.ts:438`), so hook integration
cannot be assumed from the fact that `cb init` ran.

Check 3's repair is the one to get right: **`git config annex.thin
false` alone is cosmetic.** Measured — after flipping the config, an
existing file still showed link count 2 (hardlinked to its object, so
in-place edits still silently corrupt it); `git annex fix` brought it
to 1. The repair is both commands or it isn't a repair. `git annex fix`
is cheap when there is nothing to fix, so running it every startup is
fine; only the first, genuinely-drifted run pays.

The two that can't self-heal:

- **1 (no binary)** — nothing the box can do. But it also isn't silent:
  Track D returns 409 on any asset read, and Track E's hook makes every
  commit fail. Both failure paths are loud at the point of use.
- **5 (pointer, no content)** — in this iteration there is nowhere to
  fetch from: `numcopies=1` and the box *is* the authoritative copy. A
  pointer with no content here means the bytes are gone. That is an
  alarm, not a repair. (Next iteration, with a remote, this one becomes
  self-healing too — `git annex get`.)

**These are configuration checks only.** Every one asks "is git-annex
set up correctly in this repository." Nothing about box *content*
belongs here — a condition that varies with how much work is pending is
operational, and goes through `runHealthChecks` instead (Track G).

Detail on the individual checks: **1** also flags a binary older than
the repo format (Ubuntu ships 10.20240129, Homebrew 10.20260717).
**3** is the one that will actually fire in practice, because
`annex.thin` doesn't propagate to clones (Track B's table). **5**
reports a count plus, for each file, the expected size and hash parsed
out of the pointer (finding 4).

Check 5 is shared with Track D — one predicate, `isAnnexPointer(bytes)`,
used by both the doctor and the read paths (#8).

**Where it runs, and why it does not block startup.** `cb serve` runs
the repair pass on startup and then serves regardless. It does **not**
gate.

An earlier draft gated startup on the full list. That was wrong once
the checks were classified: four of the six are things the box can put
right by itself, so refusing to serve over them is refusing to do work
it could have just done. And the two it can't fix are the two where
blocking helps least — a missing binary already fails loudly at every
read (Track D's 409) and every commit (Track E's hook), and a
pointer-with-no-content is data already lost, where taking the box
offline adds an outage to a loss.

So:

- **`cb serve` startup** — run repairs, log each one (`console.warn`,
  per `code-style.md`'s "recovered but unexpected" tier), serve.
- **`cb init`** — same repair pass; this is where a fresh or freshly
  cloned box gets configured.
- **`runHealthChecks`** — checks 1 and 5 register at `error` severity,
  so they surface on the dashboard and fail `cb health` (exit 1) for
  the deploy runbooks (`docs/health-checks.md`) without touching
  serving.

This is a strictly better answer to the plan's original critical gap
(`annex.thin` drift on a clone): a drifted clone now *repairs itself*
at startup instead of being detected and reported to someone.

**First implementation chunk.** `src/lib/annex-pointer.ts` with
`isAnnexPointer()` / `parseAnnexPointer()` and a pure-function doctest
covering a real pointer, a real JPEG, an empty file, and a text file
that merely starts with a slash. No open questions.

### Track D — absence is a normal state

**What.** Teach the read paths that an asset's content may not be
present locally, and surface that distinctly.

**Why this needs to change.** Today a manifest entry without its file
is a hard error (`asset-manifest-scan.ts:36`, `missing-file`). Under
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

**The audit is not bounded, and an earlier draft was wrong to claim it
was.** That draft said every read funnels through
`src/shared/attach-path.ts` — but that module is a *pure string
helper*, not an I/O boundary, so "callers of it" is not the set of
readers. The real read sites are independent:

| site | what it does with bytes |
|---|---|
| `src/webapp/routes/api-files.ts` | `/api/files/*` takes any box path — stat, HEAD/304, range, full body |
| `/api/image` | image serving/derivation |
| `src/core/capture/transcribe-clips.ts` | reads resolved audio, ships it to transcription |
| `src/publish/render-docs.ts` | reads image bytes when rendering published docs |
| `src/webapp/routes/figure.ts` | compiles figure source out of attach scopes |
| box agents | plain filesystem reads — **no application boundary at all** |

So the design is a **shared content-open helper** that every one of
those goes through — `openAssetContent(absPath)` returning either bytes
or a typed `ContentNotPresent` carrying the parsed key, size, and hash.
One predicate, one error type, six call sites (#8). A per-route fix
would leave transcription silently shipping 101 bytes of pointer text
to a speech API and publishing embedding it as an image.

The agent row has no code fix. It gets a `docs/assets.md` sentence and
a knowledge audit (Track H) — an agent that reads a pointer should
recognize it, which is exactly what the `asset-content-absent` audit
tests.

**First implementation chunk.** `openAssetContent()` plus the
`api-files.ts` boundary (all four of stat/HEAD/range/body — a pointer
must not produce a 200 with a plausible `content-length` on any of
them), with a route doctest asserting 409-with-key for a pointer and
200 for real content. Remaining call sites follow in the same track.

### Track E — hook and housekeeping integration

**What.** Make the generated pre-commit hook annex-aware; schedule
`fsck`.

**Why this needs to change.** Finding 2: annex declined to install its
pre-commit hook because ours exists, so its commit-time work never
runs unless we call it. And `fsck` is the entire integrity story now
that manifests are gone — unscheduled, it is a command nobody runs.

**Direction.** In `install-validation-hooks.ts`, replace the
`cb attachments verify` line with `git annex pre-commit`. Two
placement details that an earlier draft got wrong, both of which would
have left the guard silently inert:

- **The annex call must come before the `cb`-not-found fallback.** The
  generated hook currently `exit 0`s when `cb` is neither at its
  absolute path nor on `PATH` (`install-validation-hooks.ts:230-238`).
  Appending annex work below that means the whole guard vanishes on any
  machine where `cb` isn't resolvable — precisely the
  under-provisioned machine most likely to lack git-annex too. So the
  plan's claim that "a missing binary makes every commit fail" is only
  true once the annex line runs unconditionally, ahead of that exit.
- **The installer leaves a foreign pre-commit hook alone**
  (`install-validation-hooks.ts:438`), so a box whose hook we don't own
  gets no annex integration at all. Track C therefore gains a check —
  *is annex pre-commit integration actually present in this repo's
  hook* — rather than assuming the managed hook owns every repository.

`fsck` **does not run from `housekeeping.ts`**, and the earlier draft's
locking claim was wrong: `runHousekeeping` is called inside an
otherwise unlocked wakeup flow (`src/cli/commands/wakeup.ts`), and
housekeeping takes no lock, so "hold `file-lock.ts`" would have
excluded only other holders of that same lock — i.e. nothing.

Instead `fsck` is an **independently scheduled, read-only** operation
with explicit overlap semantics: `git annex fsck
--incremental-schedule=30d`, run from the scheduler (`cb tick`,
`docs/scheduler.md`) rather than inline in wakeup. Read-only means
concurrent wakeup writes are safe by construction — a file added mid-run
is simply fscked next cycle — which is a better property than a lock
that would serialize a 9 GB pass against the box's main work loop.

**First implementation chunk.** Hook generation change plus its
doctest, asserting the annex line precedes the `cb` fallback and that a
repo missing annex integration is reported by `cb doctor annex`.

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
exclusion is needed** — the gitignore rule is the whole mechanism.

The rule's path needs care in two ways an earlier draft got wrong:

- **No `content/` prefix.** The managed `.gitignore` is written at the
  box root, and for a v2 box the box root *is* `content/`
  (`src/core/box/index.ts` writes it to `resolvedRoot`). A
  `content/tmp-capture/…` rule resolves to `content/content/…` and
  matches nothing.
- **`tmp-capture` is not only at the root.** Delivery targets
  `<contextDir>/tmp-capture/` (`src/core/capture/deliver.ts:55`), and
  the context directory varies by chat, so an anchored rule misses real
  captures and annexes them on arrival — the exact outcome this track
  exists to prevent.

So the rule is unanchored:

```gitignore
# Capture staging — assets here are pre-triage and deliberately
# un-annexed. They join the annex when the agent files them.
**/tmp-capture/**/*.attach/**
```

`cb mv` into a final destination moves the bytes out of the ignored
path; the next `git add -A` annexes them via the extension allowlist.
No new code on the move path.

Two consequences that must be handled rather than assumed:

1. **A staged asset is in neither git nor the annex.** That is true
   today too, but under this plan it becomes the *only* unprotected
   window, so it needs to be visible instead of implicit.

   This is an **operational** condition, not a configuration one — it
   varies with how far behind triage is, and it has no one-time fix. So
   it goes in `runHealthChecks`
   (`src/webapp/trpc/routers/health.ts:24-29`), which already carries
   the `"error" | "warning"` severity split, feeds both `cb health` and
   the dashboard's warnings, and exits non-zero only on `error`. Not in
   `cb doctor annex` (Track C), and emphatically not in the `cb serve`
   configuration doctor, which is about setup rather than pending work.

   ```typescript
   {
     name: "unfiled captures",
     ok: oldestUnfiledDays < UNFILED_CAPTURE_WARN_DAYS,
     severity: "warning",
     message: `${count} capture(s) unfiled for over ${UNFILED_CAPTURE_WARN_DAYS} days
       (oldest ${oldestUnfiledDays}d). Their bytes are in neither git nor the annex —
       file them with cb mv.`,
   }
   ```

   Threshold: **7 days** (boxholder decision, 2026-07-30). estate has 2
   such files right now, both from 2026-07-29 and both among the 38
   with no second copy anywhere — so this is a live condition, not a
   hypothetical.

   **Reuse the existing sweep, don't add a second traversal.**
   `src/core/capture/sweep.ts` already walks capture sessions and
   already carries an age threshold; the health check reads from it
   rather than re-walking the tree with its own notion of "unfiled"
   (#8, one way to do each thing).

   And a loss to state plainly rather than gloss: today a staged
   capture is *not* wholly unrecorded — `capture/write-cards.ts` writes
   a manifest with size + sha256 alongside it. Retiring manifests trades
   that per-file record for a time-based warning, which is weaker. It is
   accepted because the window is meant to be hours and the warning
   makes a long window visible; it is not equivalent, and the remote
   iteration should revisit whether staged captures deserve a copy.

2. **Bulk upload needs two fixes, not one.** The batch-local
   `.gitignore` (`docs/asset-manifests.md:193-213`, written by
   `src/core/bulk-upload/prepare.ts`) ignores everything in a batch
   scope, so under annex those blobs would never be annexed — finding
   7's trap, one layer down. But removing it is **not sufficient**:
   `prepare.ts:127-131` stages an explicit path list —
   `paths: [cardRelPath, manifestRelPath, gitignoreRelPath]` — which
   never included the blobs. A path-scoped `git add` cannot annex a
   file it was never given, and `git annex pre-commit` cannot rescue
   it. The batch would commit a card describing content that exists
   nowhere in git, and the staging copy is cleaned up after delivery.

   So: replace the batch-local `.gitignore` with a batch-local
   **`.gitattributes`** carrying `* annex.largefiles=anything` (with
   `.card`, `manifest.json`, and `.gitattributes` itself excluded) —
   the sanctioned per-path mechanism, and the one place where
   extension-blind matching *is* correct, because a bulk batch really
   does hold arbitrary types. And change `prepare.ts` to stage the
   blob paths.

**First implementation chunk.** The gitignore rule plus the
`unfiled captures` health check (reading `capture/sweep.ts`), with a
filesystem doctest: an asset in `tmp-capture/` is not annexed and is
reported once past 7 days; the same asset after `cb mv` to a store path
is annexed on the next commit and drops off the check. The bulk-upload
fix is its own chunk, and extends that pipeline's existing end-to-end
doctest to assert the blob paths are annexed — not merely that the
commit succeeded, which is what it asserts today and is exactly why
this was invisible.

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

> **Critical gap: none remaining.** The plan's original one —
> `annex.thin` drift on a clone, which doesn't propagate (Track B's
> table) and silently costs `fsck`'s corruption detection (finding 6) —
> is now *repaired* rather than detected: Track C's startup pass runs
> `git config annex.thin false` **and** `git annex fix` on every `cb
> serve` and `cb init`. Verified that both commands are required; the
> config alone leaves files hardlinked.

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
| Bulk-upload batch `.gitignore` survives migration, so its blobs never annex | Yes (doctest on a batch scope) | Track G — batch-local `.gitattributes` replaces it | Clear |
| Bulk upload commits a card whose blobs were never staged | Yes (extend the pipeline's e2e doctest to assert blobs annexed) | Track G — `prepare.ts` stages blob paths | **Was silent**: the existing doctest asserts the commit succeeded, which it does |
| A committed card/manifest/text file inside an attach scope gets annexed | Yes (Track B's estate-shaped fixture) | Extension allowlist, not a path glob | Clear |
| A new large binary type lands in a scope with no allowlist entry | Yes | Commit-blocking error over 1 MB (the `.frozen` class) | Clear — was an advisory before |
| Pointer bytes shipped to transcription or embedded by publish | Yes | Track D's shared `openAssetContent()` | Clear — per-route fixes would have left these silent |
| Annex line placed below the hook's `cb`-not-found `exit 0` | Yes (hook-generation doctest asserts ordering) | Track E places it above | **Would have been silent** |
| Box has a foreign pre-commit hook, so annex integration never installs | Yes | Track C check 7 | Clear |
| Capture sits in `tmp-capture/` unannexed and un-backed-up | Yes | Track G — `unfiled captures` warning in `runHealthChecks` past 7 days | Clear — **and live today**: 2 estate files since 2026-07-29 |
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
  (`docs/asset-manifests.md:148-155` — which overstates the shipped
  behavior anyway: `scanAttachScope` reconciles each scope
  independently, with no cross-scope hash table, so the documented
  across-directory move detection does not exist), all of which is
  deleted.
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
  matches today's ignore scope (`docs/asset-manifests.md:188` — note
  that lines 12–18 of the same doc distinguish *attachments* from the
  *asset* subset, which is why the classifier is an extension
  allowlist and not a path glob; see Track B). The
  advisory for large binaries committed outside a scope stays as-is.
- **The git-annex assistant / webapp daemon.** Homebrew's formula offers
  it; we want deterministic, commanded behavior, not a watcher.
- **Encryption of annexed content.** Local-only; nothing leaves the
  disk this iteration.
- **Migrating boxes off git-annex.** No reverse migration is written.
  If this proves wrong, `git annex uninit` restores plain files, and
  that is the escape hatch rather than a maintained path.

## Git LFS — discovered during implementation, now RESOLVED

**Every box already uses Git LFS as well**, and the plan never accounted for
it. Measured 2026-07-31:

| box | `filter=lfs` rules | LFS-tracked files | attach manifests |
|---|---|---|---|
| estate | 10 | 154 | 250 |
| personal | 10 | 11 | 12 |
| box-family | 10 | 8 | 81 |
| test1 (dev) | 10 | 9 | **0** |

So there are three asset mechanisms in play, not two:

1. **Git LFS** — `content/.gitattributes` filters `*.jpg *.jpeg *.png *.heic
   *.m4a *.webm *.wav *.mp3 *.ogg *.frozen`, **unscoped** (any path, not just
   `.attach/`). On estate this holds 154 files, all under
   `box/inbox/capture-*/` — pre-`.attach` legacy captures.
2. **Asset manifests** — `.attach/` assets, gitignored.
3. **git-annex** — what this plan adds.

**Resolution (boxholder, 2026-07-31): git-annex replaces LFS.** Not coexistence
— one mechanism.

**Precedence, settled by experiment.** With LFS genuinely engaged (proved by a
control file that became an LFS pointer), a path matching *both* `filter=lfs`
and `annex.largefiles` goes to **annex**. So the migration was never at risk of
silently producing LFS pointers. An earlier attempt to test this was
inconclusive because LFS had not actually engaged; that result was discarded
rather than reported.

**`annex.largefiles` is now unscoped**, matching LFS's existing scope rather
than the `.attach/`-anchored form inherited from the manifest model. That is
what lets annex take over the 154 legacy-capture files under `box/inbox/`,
which no `.attach/`-scoped rule would ever have reached. Behavior for those
paths is unchanged — they were already kept out of git's object database, just
by a tool that does not verify content.

**`to-annex` retires LFS**, in three parts, each of which failed at least once
in testing:

1. Refuse if any LFS file is still an unmaterialized pointer locally
   (`LfsContentMissingError`) — converting then would commit pointer text as
   the file's content.
2. Strip `filter=lfs` lines from `.gitattributes`, preserving everything else
   (the `!text !filter` fixture rules are load-bearing).
3. `git add -A` **then** `git add --renormalize .`. The second is not a
   flourish: plain `add` trusts the stat cache and never re-examines a file
   whose mtime and size are unchanged, so every LFS-tracked file kept its LFS
   pointer in the index despite the filter being gone — the migration reported
   `lfsConverted` having converted nothing. `--renormalize` only considers
   *tracked* files, so it cannot replace the first pass either.

Verified end to end on a box shaped like production (an LFS-committed legacy
capture plus a manifest-tracked attach asset): both annexed, zero LFS files
remaining, unrelated `.gitattributes` line preserved, tree clean.

Also worth noting: **test1 has zero manifests** despite 16 asset-ignore
patterns — the same unclaimed hole found on `personal-test`. A box in that
state has nothing for `to-annex` to verify against, so the migration's
before/after hash comparison is vacuous there. `cb attachments migrate` must
run first, or the box converts with no independent record checked.

## Open design questions

1. **`git annex fsck` cadence on estate.** Lean:
   `--incremental-schedule=30d`, letting git-annex pace it. Wants a
   real measurement of what a full 9 GB pass costs before committing —
   the number is unknown and the box is shared with live wakeups.
Resolved during design, recorded so the reasoning isn't relitigated:

- **`cb doctor annex` repairs; it does not gate startup** (boxholder
  decision, 2026-07-30, reversing an earlier draft in this same plan
  that did gate). Five of the seven checks name a state the box can put
  right by itself, so blocking on them is refusing work it could just
  do. The two it can't fix are the two where blocking helps least: a
  missing binary already fails loudly at every read and every commit,
  and a pointer-with-no-content is data already lost. Repair on
  startup, log it, serve.
- **`cb doctor annex` is configuration-only** (boxholder decision,
  2026-07-30). Content-dependent conditions go to `runHealthChecks`.
  The unfiled-capture check was drafted as a seventh doctor assertion
  and moved for this reason: a condition that varies with how far
  behind triage is has no configuration remedy, so the doctor could
  neither repair it nor sensibly report it. (While the doctor still
  gated startup, it would additionally have taken the box offline over
  a triage backlog — which is what prompted the reversal above.)
- **Unfiled-capture warning threshold: 7 days** (boxholder decision,
  2026-07-30), matching the `tmp/` upload sweep's existing window
  (`src/core/capture/sweep.ts`). `warning` severity, so it reports
  without failing `cb health`.
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
5. **C2** — `cb doctor annex`: seven checks, five with repairs, `--check`
   for read-only; wired into `cb serve` startup, `cb init`, and
   `runHealthChecks`. *Depends on C1, B2.*
6. **D** — absence handling: webapp route, renderers, agent reads.
   *Depends on C1.*
7. **E** — hook generation + `fsck` in housekeeping. *Depends on B1.*
8. **F** — worktree clone hook. *Depends on B2, and on D so a
   partially-fetched worktree degrades legibly.*
9. **G** — capture-staging gitignore rule + the `unfiled captures`
   health check + doctest.
   *Depends on C2; must land before B3 so converting estate doesn't
   annex its two pending captures.*
10. **B3** — convert prod boxes, smallest first: `box-family` (8
    assets), then `personal` (6). *Depends on A, C2, D, E, G.*
11. **B4 — estate, and it is separately gated.** 1,184 assets / 9 GB.
    **Blocked until estate has a full backup** (boxholder decision,
    2026-07-30), which the 2026-07-30 backup is not: that one covers
    the 171 MB git history can't restore, deliberately, because a full
    20 GB copy fit nowhere (14 GB free locally, 5.6 GB on the server).
    So estate converts only after either the remote iteration lands, or
    somewhere with ~20 GB is found for a full mirror. Every other track
    completes without it; this is the one step that waits.
12. **H** — docs rewrite, knowledge audits written and run.

**Done-when**, as checkable assertions: (a) every doctest named below
passes; (b) `cb doctor annex` is clean on all four asset-holding boxes;
(c) `git annex fsck` on estate reports zero bad objects across all
1,184 assets; (d) a fresh worktree clone renders images after
`worktree-create.sh` runs, with no `cp` loop; (e) `grep -r asset-manifest
src/` returns nothing; (f) a box left with `annex.thin` true serves
normally after `cb serve` startup, with the setting repaired, existing
files back to link count 1, and the repair logged; (g) a
freshly-captured asset is *not* annexed until `cb mv` files it.

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
  an asset in `tmp-capture/` is unannexed and raises the `unfiled
  captures` warning past 7 days; the same asset after `cb mv` is
  annexed on the next commit and clears the warning (Track G).
- `test/core/doctor-annex.doctest.md` — filesystem tier: a box with
  `annex.thin` true is repaired (config *and* link count) and the
  repair logged; an uninitialized repo is initialized; a missing binary
  and a content-less pointer are reported, not "repaired"; `--check`
  changes nothing.

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
