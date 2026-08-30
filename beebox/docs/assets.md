# Assets

How photos, scans, audio, and video stay tracked by git without their bytes
living in git's object database.

**Status: implemented; all local boxes converted, production not yet.**

Twelve boxes under `~/src/boxes/` were migrated on 2026-07-31 — roughly 6,350
assets / 9.3 GB annexed, 3,655 manifests removed, 738 Git LFS files taken over.
Every one verifies clean: no manifests, no LFS, `annex.thin=false`,
`git annex fsck` clean, working tree clean. `estate` was additionally checked
byte-for-byte against its pre-conversion backup — 1,218 of 1,219 gitignored
files identical, the one difference being runtime state the box rewrites
itself, and zero changed or absent assets.

**No production box has been converted.** The previous system — per-directory
`manifest.json` files alongside gitignored bytes — is described in
[`implemented-plans/asset-manifests.md`](implemented-plans/asset-manifests.md)
and is still what the prod boxes are running.

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
listed. The pre-commit hook checks the *staged blobs* (inside `bbx validate
--pre-commit`), so it fires at exactly the commit that would embed the bytes and
also catches an allowlisted extension staged raw through a broken annex filter;
`bbx attachments check-unlisted` walks the whole box for the same problem on
demand.

Two deliberate exceptions:

- **Capture staging** (`tmp-capture/`) stays gitignored. A capture is pre-triage
  and gets renamed, re-encoded, and EXIF-rotated before it is filed, so
  annexing on arrival would mint immutable objects for versions nothing
  references. It joins the annex when an agent files it with `bbx mv`. A
  `bbx health` warning fires if anything sits there longer than 7 days — that
  window is the one place box content has no second record.
- **Bulk upload batches** carry a batch-local `.gitattributes` setting
  `annex.largefiles=anything`, because a batch really does hold arbitrary
  types. Control files are exempted. That file needs a partner: `largefiles` is
  consulted only for paths the filter-process sees, so `.git/info/attributes`
  carries one non-extension line (`**/*.upload-batch.attach/**`) putting batch
  scopes on the filter's path. Without it the batch-local setting is inert for
  exactly the extensions it exists to cover — that was the state between
  2026-08-04 and 2026-08-18, when a batch's `.zip` committed as raw bytes while
  its photos annexed.

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
| `.git/info/attributes` | rendered from `ASSET_EXTENSIONS` + the bulk-batch scope | repository file | **no** |

`.git/info/attributes` is which paths git hands to the git-annex
filter-process. `git annex init` writes `* filter=annex` there — the whole
repository — so a commit of two text cards pays the filter's startup cost for
nothing (measured: 15 `git add` + `git commit` pairs of one-line cards took
3.7s unscoped and 1.4s scoped). Since `annex.largefiles` is purely
extension-based, the filter is narrowed to the same extensions and text-only
commits skip it entirely.

The narrowing is only safe while every already-annexed path has an extension on
the list: one that does not keeps its pointer in git but loses the smudge
filter, so the next checkout writes `/annex/objects/…` text where the bytes
were. `bbx doctor annex` checks that (`annexed-coverage`) before it writes the
scoped file, and refuses to scope while any path is uncovered. The attribute
lines use case-insensitive character classes (`*.[hH][eE][iI][cC]`), and so
does the `annex.largefiles` expression — the two are rendered from one function
so neither can match a path the other misses. Getting that wrong is not
symmetric but both directions are real: a path largefiles annexes that the
filter never sees commits as raw bytes, and a path the annex holds that the
filter no longer covers strands a pointer.

`git annex init` reinstates its unscoped default, including in every fresh
clone, so this drift recurs; `bbx doctor annex` (and therefore `bbx init`)
repairs it.

`annex.thin=false` is load-bearing. With thin mode the working-tree file is a
hardlink to its annex object, so an in-place edit silently corrupts the object
*and `fsck` does not detect it*. Non-thin costs a second copy on disk and buys
back the integrity check.

`annex.thin` is plain git config, so it does **not** propagate — every fresh
clone silently inherits git-annex's default. `bbx doctor annex` repairs it, and
repairing takes both `git config annex.thin false` **and** `git annex fix`
(the config alone leaves existing files hardlinked).

## Commands

| command | what |
|---|---|
| `bbx doctor annex` | Check and repair the box's annex configuration. Most checks self-heal. `--check` for read-only. |
| `bbx doctor annex-fsck` | Verify content against keys, incrementally. Read-only; run from a schedule. |
| `bbx attachments to-annex` | One-way migration from the manifest model. Verifies before and after. |
| `bbx attachments check-unlisted` | Block unlisted large binaries, box-wide. (The pre-commit hook runs the staged-blob equivalent inside `bbx validate --pre-commit`.) |
| `bbx attachments largefiles-expr` | Print the `annex.largefiles` expression. |
| `bbx attachments annex-attributes` | Print the scoped `.git/info/attributes` contents. |

`bbx init` runs the doctor's repair pass, so an ordinary init brings a box up to
spec rather than leaving it to a command someone must remember.

`bbx init` also rewrites the box's `.gitignore` and `.gitattributes` on every
run. It **detects the annex conversion** (from `.git/annex/`) so `.gitignore`
gets the annex form — assets un-ignored — instead of the manifest-scheme one.
Until 2026-08 it did not: a single `bbx init` silently de-annexed a converted
box, re-ignoring every asset while `.git/annex/` sat there looking healthy, and
nothing reported it until a later commit or asset write failed.

`.gitattributes` no longer varies by scheme: as of 2026-08-04 the template
carries no `filter=lfs` rules at all, so every box gets the same LFS-free file.
A pre-annex box gitignores its asset bytes, so an LFS filter could never fire on
it either — the rules were dead config whose only live effect was the risk of
re-LFS-ifying a converted box's new media. Anything that writes asset bytes now gates on that shape via
`isAnnexBox()` (`src/core/annex/is-annex-box.ts`) — the scan-upload routes
refuse with a 503 rather than accept a file they cannot import.

## Migrating a box

```bash
bbx attachments to-annex --dry-run   # report what would happen; changes nothing
bbx attachments to-annex
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
| `bbx health` reports `annex-content-present` failing | Bytes are gone and there is no remote to fetch from | Restore from backup |
| `fsck` quarantines to `.git/annex/bad/` | Content no longer matches its key | Restore from backup |

## Not yet

**There is no remote.** `numcopies` is 1 because there is nowhere to copy to.
This iteration buys integrity, not durability — a box's assets still live on
exactly one disk, and "on git-annex" does not mean "backed up". The R2 remote
is the next iteration; its cost and API analysis is in
[`plans/asset-offbox-storage.md`](plans/asset-offbox-storage.md).

Dropping local content (`git annex drop`) also waits for that, since there is
nothing to drop *to*.
