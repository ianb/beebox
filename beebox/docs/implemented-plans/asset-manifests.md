---
title: "Asset Manifests"
status: implemented
workstream: unknown
issues: []
---
# Asset Manifests

**Status: SUPERSEDED by git-annex — see [`../assets.md`](../assets.md).**

This describes the system built in May 2026 and still on disk in every box that
has not run `bbx attachments to-annex`. It is kept because it accurately records
what those boxes are doing, and because the migration reads the manifests it
describes. Once every box is converted this becomes history only.

The replacement's reasoning is in
[`../plans/asset-annex.md`](../plans/asset-annex.md); the short version is that
this design was a partial re-implementation of git-annex, and the parts it
skipped — location tracking, a copy-count invariant, and periodic verification —
are the parts that matter.

**Originally: Implemented.** The manifest format, the auto-claim/verify scan,
the pre-commit hook, and the `bbx attachments` CLI have all shipped. The
manifest tracks only each scope's *current* state — there is no asset
version history (the only history is git's, which is exactly what these
assets stay out of).

How assets (the binary subset of attachments — photos, scanned PDFs,
audio) stay tracked by git without their bytes living in git history.

**Terminology.** Inside a `.attach/` scope, an *attachment* is any file
(committed sidecars, notes, etc.); an *asset* is the subset whose bytes
live on disk only and are tracked via this manifest. The `.attach/`
directory and the `<filename ref="attach/...">` virtual prefix are about
the directory metaphor, not the file noun, so they keep the "attach"
name. So does the `bbx attachments` CLI command, which operates on the
whole `.attach/` scope even though its job is the asset subset.

## Problem

Cards reference assets via `<filename ref="attach/foo.jpg">` into the
card's attach scope. Committing those bytes directly is making the repo
grow uncomfortably fast — a single photo batch is hundreds of MB, and
git history never shrinks. We need the bytes to live on disk but not in
the git object database, while still being something the system treats
as first-class data (not "stuff that happens to be in the directory").

Rejected alternatives:

- **Plain `.gitignore`** — works, but the assets become invisible to
  git. No audit trail, no detection of in-place modification, no clear
  story for "is this asset still here?" Feels too casual for data
  that matters.
- **Git LFS** — the standard solution. Heavy: needs an LFS server, every
  clone has to configure the filter driver or `git checkout` overwrites
  assets with pointer text. More moving parts than warranted.
- **Per-asset sidecar `<file>.sha`** — works, doubles the file count in
  attach scopes. Not chosen but a fine fallback if per-dir manifests
  become awkward.
- **Git notes / custom refs** — bad UX, not fetched/pushed by default.

## Approach

**Manifest in git, blobs out of git.** Each `.attach/` directory contains
a `manifest.json` that records every asset in it. The manifest commits;
the assets are gitignored. A pre-commit hook keeps the manifest
synchronized with the directory contents.

The system splits operations into two classes:

- **Additive** (can't lose data) → handled automatically by the
  pre-commit hook. Writers (scan-import, capture endpoint, agents) drop
  files in attach scopes and trust the hook to claim them.
- **Destructive** (in-place modification, deletion) → explicit `bbx`
  commands. Bare `rm`/edit leaves the manifest out of sync, which the
  hook surfaces as a hard error.

## Manifest shape

One `manifest.json` per `.attach/` directory, listing direct asset
children only (nested attach scopes have their own manifests).

```json
{
  "files": {
    "photo-001.jpg": {
      "size": 660285,
      "mtime": "2026-05-04T18:34:59.000Z",
      "sha256": "ab12..."
    },
    "photo-001-back.jpg": {
      "size": 482193,
      "mtime": "2026-05-04T18:35:01.000Z",
      "sha256": "cd34..."
    }
  }
}
```

`mtime` is a speed hint, not load-bearing: the hook skips rehashing when
size+mtime match the manifest. If someone backdates files to lie, the
hash will catch them on the next rehash event.

## Commands

The asset-specific operations live under `bbx attachments`. Adding assets is
normally automatic (the pre-commit hook auto-claims), so the only routine
explicit command is `overwrite`.

### `bbx attachments overwrite <path>` (reads stdin or `-`)

Replace the contents of an existing tracked asset. Sequence:

1. Verify `<path>` lives in an attach scope and has a manifest entry.
   Refuse if not (use `bbx attachments add` for new files).
2. `chmod +w <path>`.
3. Write stdin to a temp file in the same directory.
4. Atomic rename over `<path>`.
5. `chmod 444 <path>`.
6. Recompute sha256; update manifest entry (size, mtime, sha256).

### `bbx attachments add <path>`

Explicitly claim an on-disk file into its manifest (sha256 + size +
mtime). Rarely needed — the pre-commit hook auto-claims new files in any
attach scope — but useful when scripting or when the hook is bypassed.
No-ops if the file is already tracked with a matching hash.

### Moves and deletes — no dedicated asset command

Renaming or moving an asset needs no manifest call: the pre-commit scan
detects a hash that relocated (an orphaned manifest entry plus a new
unclaimed file with the same hash) and moves the entry automatically — see
[Rename detection](#rename-detection). Moving a whole card with `bbx mv`
carries its `<base>.attach/` scope (manifest included) along untouched,
since entries are scope-relative.

Deletion is the one destructive op without a manifest-aware command:
removing an asset leaves an orphaned manifest entry that the scan reports
as a `missing-file` error. Resolve it by restoring the file or by deleting
the entry from the scope's `manifest.json` by hand.

## Pre-commit hook

Runs on every commit attempt. Walks every `.attach/` directory in the
box. For each:

1. **File on disk, in manifest, (size, mtime) match** → skip.
2. **File on disk, in manifest, (size, mtime) differ** → rehash.
   - Hash matches stored → update mtime in manifest entry. (Touch
     without content change; harmless.)
   - Hash differs → **block commit** with: `<path> modified out of band.
     Run bbx attachments overwrite to accept the new content, or restore
     from backup.`
3. **File on disk, not in manifest** → hash, add entry, log
   `Auto-claimed <path>`. Stage the updated manifest.
4. **Manifest entry, no file on disk** → **block commit** with: `<path>
   listed in manifest but not on disk. Restore the file, or remove its
   entry from manifest.json by hand.`

After the walk, modified manifests are staged via `git add` so they
become part of the commit being prepared.

Output is verbose and structured — agents are the primary audience and
can react to specific phrases.

### Rename detection

If a hash appears in two places — manifest entry for `foo.jpg` (file
missing) and a new unclaimed `bar.jpg` (same hash) in the same dir —
the hook treats it as a rename: removes the `foo.jpg` entry, adds a
`bar.jpg` entry, logs `Renamed foo.jpg → bar.jpg`. Across-dir moves are
the same logic.

This means agents can `mv attach/foo.jpg attach/bar.jpg` freely without
calling `bbx mv`, as long as the new location is also an attach scope.

### `--no-verify` escape hatch

Skipping the hook with `git commit --no-verify` is allowed. The next
non-skipped commit picks up everything missed (the hook is a full walk,
not just changed files), so no work is lost.

## Gitignore

Per-box `.gitignore` rule:

```
**/*.attach/**/*.jpg
**/*.attach/**/*.jpeg
**/*.attach/**/*.png
**/*.attach/**/*.webp
**/*.attach/**/*.avif
**/*.attach/**/*.heic
**/*.attach/**/*.tif
**/*.attach/**/*.tiff
**/*.attach/**/*.gif
**/*.attach/**/*.webm
**/*.attach/**/*.mp3
**/*.attach/**/*.m4a
**/*.attach/**/*.wav
**/*.attach/**/*.pdf
**/*.attach/**/*.mp4
**/*.attach/**/*.mov
```

Scoped to `**/*.attach/**` only. Binaries outside attach scopes commit
normally (they aren't assets — they're just files); the user gets an
advisory on commit if they stage a >1MB binary outside an attach scope
("consider moving it into an attach scope or `git rm`-ing it").

### Arbitrary-extension attach scopes (batch-local `.gitignore`)

The extension list above covers the media capture ever lands, but a bulk
file-upload batch lands **arbitrary** extensions (`.zip`, `.csv`, `.pptx`,
extensionless files). Those blobs wouldn't match the box `.gitignore`, so they'd
show as untracked forever and a stray `git add -A` could commit them — exactly
what the manifest model prevents. So the bulk-upload prepare step
(`src/core/bulk-upload/prepare.ts`) writes a **batch-local `.gitignore`** inside
each batch's `.attach/` scope that ignores everything in the scope except its own
`manifest.json` and the `.gitignore` itself, regardless of extension:

```
*
!.gitignore
!manifest.json
```

The `.gitignore` is a committed control file (tracked alongside the card +
manifest); the blobs stay out of git. This is the sanctioned pattern for an
attach scope whose asset extensions aren't known up front — reach for it rather
than growing the box-wide extension list for one-off types.

## Failure cases

| Case | Hook behavior | Recovery |
|------|---|---|
| Accidental `rm` | Manifest entry survives → block commit | Restore from backup (post-v1) |
| In-place edit (vi, etc.) | Size/mtime differ → rehash → mismatch → block | `bbx attachments overwrite` if intentional, else restore |
| `mv` within attach dir | Hash match in same dir → rename in manifest, log | (no action) |
| Cross-attach `mv` | Hash match across dirs → entry relocates, log | (no action) |
| Stray `cp` into attach scope | Auto-claimed, logged | If unintended, `git checkout` to undo |
| Mid-hook crash | Atomic manifest write (tmp + rename) → no half-state | Re-run commit |
| Concurrent writers | Per-box lock (existing `.bbx-lock`) | n/a |
| Hand-edited manifest broken JSON | Parse error → block | Fix or revert |
| `git checkout` of old commit | Manifest reflects that commit; disk may be newer | `bbx attachments verify` reports drift |

## Migration runbook (existing boxes)

Goal: stop committing new asset bytes while keeping every existing
asset on disk and recoverable. Pre-existing history retains the blobs;
we accept that.

Do this per box, in the box's working tree:

```bash
# 1. Sanity check: working tree is clean.
git status

# 2. Write a manifest.json for every asset already committed.
#    No content changes; just inventory.
bbx attachments migrate

# 3. Commit the manifests. Assets are still tracked at this point.
git add -A
git commit -m "Migrate: add asset manifests"

# 4. Add the asset patterns to the box's .gitignore. Idempotent
#    (detected via a marker line), so re-running is safe.
bbx attachments init-gitignore

# 5. Untrack the assets that the new .gitignore would now ignore.
#    Working-tree files are preserved; the git index drops them.
#    Refuses to run if any asset is not covered by a manifest.
bbx attachments untrack-assets

# 6. Commit the untracking. Future commits no longer include the assets.
git add .gitignore
git commit -m "Untrack assets"

# 7. Verify.
bbx attachments verify
```

After this, `du -sh .git` doesn't shrink (history still carries the
blobs), but `git status` and `git log --stat` no longer surface
assets, and new commits stay small. To actually reclaim history-side
space, run `git filter-repo` later — separate, riskier operation.

## Out of scope (for v1)

- **Backup / remote storage.** No R2, no rsync. Assets live on the
  server's local disk only. Backup is a separate problem — the manifest
  is the inventory that makes a future `bbx attachments push <target>`
  trivial.
- **History rewrite of existing committed blobs.** Pre-existing bloat
  stays in history. Future commits get smaller; `git clone --depth=N`
  is the workaround if clone size matters. Revisit only if it bites.
- **Cross-machine sync.** Single-server assumption. Multi-device with
  conflict resolution requires R2 or similar.

## Future review points

- **Attach-scope-only enforcement.** Right now the hook and gitignore
  scope are both `**/*.attach/**`. If agents start putting big binaries
  outside attach scopes routinely (despite the advisory), revisit.
  Noted in [issues/code-quality/2026-05-27-review-asset-manifest-scope.md](../../../issues/closed/code-quality/2026-05-27-review-asset-manifest-scope.md).
- **Manifest format.** JSON per-dir was chosen over per-asset sidecar
  and over a session-level recursive manifest. Worth revisiting if
  per-dir produces noisy diffs in practice.
- **`--no-verify` blast radius.** A determined commit with `--no-verify`
  can leave the manifest out of sync indefinitely. The next non-skipped
  commit catches up, but if every commit skips, drift accumulates. Not
  a real concern given agent behavior, but worth watching.
