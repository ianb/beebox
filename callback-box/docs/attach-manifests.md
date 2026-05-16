# Attach Manifests

**Status: Design. Not yet implemented.**

How binary attachments (photos, scanned PDFs, audio) stay tracked by git
without their bytes living in git history.

## Problem

Cards reference binary attachments via `<filename ref="attach/foo.jpg">`
into the card's attach scope. Committing those binaries directly is making
the repo grow uncomfortably fast — a single photo batch is hundreds of MB,
and git history never shrinks. We need the binaries to live on disk but
not in the git object database, while still being something the system
treats as first-class data (not "stuff that happens to be in the
directory").

Rejected alternatives:

- **Plain `.gitignore`** — works, but the binaries become invisible to
  git. No audit trail, no detection of in-place modification, no clear
  story for "is this attachment still here?" Feels too casual for data
  that matters.
- **Git LFS** — the standard solution. Heavy: needs an LFS server, every
  clone has to configure the filter driver or `git checkout` overwrites
  binaries with pointer text. More moving parts than warranted.
- **Per-binary sidecar `<file>.sha`** — works, doubles the file count in
  attach scopes. Not chosen but a fine fallback if per-dir manifests
  become awkward.
- **Git notes / custom refs** — bad UX, not fetched/pushed by default.

## Approach

**Manifest in git, blobs out of git.** Each `.attach/` directory contains
a `manifest.json` that records every binary in it. The manifest commits;
the binaries are gitignored. A pre-commit hook keeps the manifest
synchronized with the directory contents.

The system splits operations into two classes:

- **Additive** (can't lose data) → handled automatically by the
  pre-commit hook. Writers (scan-import, capture endpoint, agents) drop
  files in attach scopes and trust the hook to claim them.
- **Destructive** (in-place modification, deletion) → explicit `cb`
  commands. Bare `rm`/edit leaves the manifest out of sync, which the
  hook surfaces as a hard error.

## Manifest shape

One `manifest.json` per `.attach/` directory, listing direct binary
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

### `cb overwrite <path>` (reads stdin or `-`)

Replace the contents of an existing tracked attachment. Sequence:

1. Verify `<path>` lives in an attach scope and has a manifest entry.
   Refuse if not (use the auto-claim path for new files).
2. `chmod +w <path>`.
3. Write stdin to a temp file in the same directory; fsync.
4. Atomic rename over `<path>`.
5. `chmod 444 <path>`.
6. Recompute sha256; update manifest entry (size, mtime, sha256).
7. If new content matches old hash, no-op (no manifest churn).

### `cb mv <old> <new>`

Rename or move an attachment. Updates the source manifest (entry
removed) and destination manifest (entry added with same hash). Cross-
attach-scope moves are supported; the hash is unchanged so the entry
"relocates" rather than re-computing.

If `<old>` isn't tracked (e.g., regular file outside an attach scope),
falls through to existing `cb mv` behavior.

### `cb rm <path>`

`chmod +w`, unlink, drop manifest entry. Extends the existing `cb rm`;
attach-scope targets get the manifest-aware path, others get the
existing behavior.

## Pre-commit hook

Runs on every commit attempt. Walks every `.attach/` directory in the
box. For each:

1. **File on disk, in manifest, (size, mtime) match** → skip.
2. **File on disk, in manifest, (size, mtime) differ** → rehash.
   - Hash matches stored → update mtime in manifest entry. (Touch
     without content change; harmless.)
   - Hash differs → **block commit** with: `<path> modified out of band.
     Run cb overwrite to accept the new content, or restore from
     backup.`
3. **File on disk, not in manifest** → hash, add entry, log
   `Auto-claimed <path>`. Stage the updated manifest.
4. **Manifest entry, no file on disk** → **block commit** with: `<path>
   listed in manifest but not on disk. Run cb rm to remove the entry,
   or restore the file.`

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
calling `cb mv`, as long as the new location is also an attach scope.

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
normally; the user gets an advisory on commit if they stage a >1MB
binary outside an attach scope ("consider moving it into an attach
scope or `git rm`-ing it").

## Failure cases

| Case | Hook behavior | Recovery |
|------|---|---|
| Accidental `rm` | Manifest entry survives → block commit | Restore from backup (post-v1) |
| In-place edit (vi, etc.) | Size/mtime differ → rehash → mismatch → block | `cb overwrite` if intentional, else restore |
| `mv` within attach dir | Hash match in same dir → rename in manifest, log | (no action) |
| Cross-attach `mv` | Hash match across dirs → entry relocates, log | (no action) |
| Stray `cp` into attach scope | Auto-claimed, logged | If unintended, `git checkout` to undo |
| Mid-hook crash | Atomic manifest write (tmp + rename) → no half-state | Re-run commit |
| Concurrent writers | Per-box lock (existing `.cb-lock`) | n/a |
| Hand-edited manifest broken JSON | Parse error → block | Fix or revert |
| `git checkout` of old commit | Manifest reflects that commit; disk may be newer | `cb attachments verify` reports drift |

## Migration runbook (existing boxes)

Goal: stop committing new attachment binaries while keeping every existing
binary on disk and recoverable. Pre-existing history retains the blobs; we
accept that.

Do this per box, in the box's working tree:

```bash
# 1. Sanity check: working tree is clean.
git status

# 2. Write a manifest.json for every binary already committed.
#    No content changes; just inventory.
cb attachments migrate

# 3. Commit the manifests. Binaries are still tracked at this point.
git add -A
git commit -m "Migrate: add attach manifests"

# 4. Add the attach-binary patterns to the box's .gitignore.
#    (cb init also writes this template, but init clobbers the whole
#    file — we append instead to preserve any box-local additions.)
cat >> .gitignore <<'EOF'

# Binary attachments (managed via per-dir manifest.json — see
# docs/attach-manifests.md)
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
EOF

# 5. Untrack the binaries that the new .gitignore would now ignore.
#    Working-tree files are preserved; the git index drops them.
#    Refuses to run if any of those binaries are not covered by a manifest.
cb attachments untrack-binaries

# 6. Commit the untracking. Future commits no longer include the binaries.
git add .gitignore
git commit -m "Untrack attach binaries"

# 7. Verify.
cb attachments verify
```

After this, `du -sh .git` doesn't shrink (history still carries the
blobs), but `git status` and `git log --stat` no longer surface
binaries, and new commits stay small. To actually reclaim history-side
space, run `git filter-repo` later — separate, riskier operation.

## Out of scope (for v1)

- **Backup / remote storage.** No R2, no rsync. Binaries live on the
  server's local disk only. Backup is a separate problem — the manifest
  is the inventory that makes a future `cb attachments push <target>`
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
  Noted in `docs/ideas.md`.
- **Manifest format.** JSON per-dir was chosen over per-binary sidecar
  and over a session-level recursive manifest. Worth revisiting if
  per-dir produces noisy diffs in practice.
- **`--no-verify` blast radius.** A determined commit with `--no-verify`
  can leave the manifest out of sync indefinitely. The next non-skipped
  commit catches up, but if every commit skips, drift accumulates. Not
  a real concern given agent behavior, but worth watching.
