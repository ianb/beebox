# Assets

How photos, scans, audio, and video stay tracked by git without their bytes
living in git's object database.

**Status: implemented, not yet rolled out.** The code below exists and is
tested; no box has been converted. The previous system — per-directory
`manifest.json` files alongside gitignored bytes — is described in
[`implemented-plans/asset-manifests.md`](implemented-plans/asset-manifests.md),
and remains what every box on disk is still using until it is migrated.

## The model

Assets are tracked by **git-annex**. Git stores a small pointer; git-annex
stores the bytes under `.git/annex/objects/`, keyed by their SHA-256.

```
content/trip.attach/photo-001.jpg      ← ordinary file, readable and writable
                                          (git records a pointer for it)
```

Three consequences worth holding onto:

- **Assets are visible to git.** They appear in `git status`, `git log --stat`,
  and `git ls-files`. Renames, moves, and deletions are ordinary git
  operations. The old model deliberately hid them, which is why it needed a
  manifest to get an audit trail back.
- **Content can be absent.** A fresh clone holds every pointer and no bytes.
  That is normal, not broken — see [Absent content](#absent-content).
- **Integrity is checkable.** `git annex fsck` re-verifies bytes against their
  keys and quarantines anything that has rotted.

## Adding an asset

Nothing special:

```bash
cp photo.jpg content/trip.attach/
git add -A && git commit -m "Add trip photo"
```

`annex.largefiles` decides what goes into the annex, so plain `git add` routes
assets to git-annex and everything else to git. **Do not use `git annex add`** —
it is a needless special case, and it locks files by default, which breaks
in-place editing.

## What counts as an asset

An extension allowlist: `src/lib/asset-extensions.ts` holds the list and
renders it into the `annex.largefiles` expression.

**git-annex replaces Git LFS.** Boxes previously ran LFS over this same
extension list, and the migration removes the `filter=lfs` rules. The allowlist
is therefore unscoped — it matches a binary anywhere, not only inside
`.attach/` — because LFS was unscoped and its content (legacy captures under
`box/inbox/`, 154 files on one box) would otherwise be left behind with no
mechanism at all. Where both filters were configured, annex took precedence;
that was verified rather than assumed.

It is an allowlist rather than "everything in `.attach/`" because attach scopes
hold committed non-assets too — capture writes child `.card` files into the
parent scope, email bodies land as `.txt`, and `manifest.json` used to live
there. On one production box, 1,844 tracked files sit inside `.attach/` scopes.
A path glob would have turned every one of those cards into a pointer.

**Adding a new binary type means adding its extension to that list.** An
omission means the bytes get committed to git directly, permanently. That has
happened before (41 MB `page.frozen` snapshots, 2026-07), so a commit-time
guard now blocks any file over 1 MB in an attach scope whose extension is not
listed — `cb attachments check-unlisted`, run from the pre-commit hook.

Two deliberate exceptions:

- **Capture staging** (`tmp-capture/`) stays gitignored. A capture is pre-triage
  and gets renamed, re-encoded, and EXIF-rotated before it is filed, so
  annexing on arrival would mint immutable objects for versions nothing
  references. It joins the annex when an agent files it with `cb mv`. A
  `cb health` warning fires if anything sits there longer than 7 days — that
  window is the one place box content has no second record.
- **Bulk upload batches** carry a batch-local `.gitattributes` setting
  `annex.largefiles=anything`, because a batch really does hold arbitrary
  types. Control files are exempted.

## Absent content

A file whose content is not present locally holds a ~100-byte pointer:

```
/annex/objects/SHA256E-s300000--2ee2c7d4….jpg
```

Two different situations produce that, and they are identical on disk: content
never fetched, and a checkout made without git-annex installed. Fetch it with:

```bash
git annex get content/trip.attach/photo-001.jpg
```

Every code path that reads asset bytes goes through
`src/lib/asset-content.ts`, which distinguishes "these are the bytes" from
"this is a stand-in for them". The webapp answers **409** (not 404 — the file
exists and is tracked; its content is elsewhere) with the expected size and
hash. Transcription and publishing refuse rather than shipping pointer text to
an API or embedding it in a page.

Detection is backend-independent: a `SHA512E`, `WORM`, or `URL` pointer is just
as much a stand-in as a `SHA256E` one.

## Configuration

| setting | value | where | propagates to clones? |
|---|---|---|---|
| `annex.largefiles` | rendered from `ASSET_EXTENSIONS` | `git annex config` | **yes** |
| `annex.thin` | `false` | `git config` | **no** |
| `numcopies` | 1 | `git annex numcopies` | yes |

`annex.thin=false` is load-bearing. With thin mode the working-tree file is a
hardlink to its annex object, so an in-place edit silently corrupts the object
*and `fsck` does not detect it*. Non-thin costs a second copy on disk and buys
back the integrity check.

`annex.thin` is plain git config, so it does **not** propagate — every fresh
clone silently inherits git-annex's default. `cb doctor annex` repairs it, and
repairing takes both `git config annex.thin false` **and** `git annex fix`
(the config alone leaves existing files hardlinked).

## Commands

| command | what |
|---|---|
| `cb doctor annex` | Check and repair the box's annex configuration. Five of its seven checks self-heal. `--check` for read-only. |
| `cb doctor annex-fsck` | Verify content against keys, incrementally. Read-only; run from a schedule. |
| `cb attachments to-annex` | One-way migration from the manifest model. Verifies before and after. |
| `cb attachments check-unlisted` | Block unlisted large binaries. Runs from the pre-commit hook. |
| `cb attachments largefiles-expr` | Print the `annex.largefiles` expression. |

`cb init` runs the doctor's repair pass, so an ordinary init brings a box up to
spec rather than leaving it to a command someone must remember.

## Migrating a box

```bash
cb attachments to-annex --dry-run   # report what would happen; changes nothing
cb attachments to-annex
```

The migration requires a clean working tree, verifies every manifest against
disk *before* converting, checks that nothing is still gitignored, confirms
each asset was actually annexed, compares every manifest SHA-256 against its
annex key, and only then removes the manifests — all in one commit.

That sequence is not ceremony. `git annex fsck` can only prove an object matches
the key derived from it *at migration time*; the manifests hold the earlier,
independent claim about what those bytes should be, and the migration deletes
them. Checking the new record against the old one before discarding the old one
is the only step here that cannot be redone later.

Rollback is `git annex uninit` plus reverting the migration commit. There is no
maintained reverse migration.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Image renders as alt text; file is ~100 bytes of `/annex/objects/…` text | Content not fetched, or git-annex not installed | `git annex get <path>`, or install git-annex |
| Commit fails: "git-annex is not installed" | Missing binary | `apt install git-annex` / `brew install git-annex` |
| Commit blocked on a large unlisted file | New binary type not in `ASSET_EXTENSIONS` | Add the extension, or confirm the file belongs in git |
| `cb health` reports `annex-content-present` failing | Bytes are gone and there is no remote to fetch from | Restore from backup |
| `fsck` quarantines to `.git/annex/bad/` | Content no longer matches its key | Restore from backup |

## Not yet

**There is no remote.** `numcopies` is 1 because there is nowhere to copy to.
This iteration buys integrity, not durability — a box's assets still live on
exactly one disk, and "on git-annex" does not mean "backed up". The R2 remote
is the next iteration; its cost and API analysis is in
[`plans/asset-offbox-storage.md`](plans/asset-offbox-storage.md).

Dropping local content (`git annex drop`) also waits for that, since there is
nothing to drop *to*.
