---
title: "A same-size overwrite of a tracked asset reads as clean, so the delete route's preservation commit does not happen"
workstream: full-embrace-annex
area: beebox
labels: [annex, git]
filed-by: agent
discovered-by: agent
discovered-in: worktree-full-embrace-annex — running the suite after assets became git-tracked
---

`pathsHaveChanges` (`src/lib/git.ts:274`) asks `git status --short -- <path>`.
For a tracked, annexed file whose new content is the **same length** as the
committed content, git reports nothing: it does not re-run the annex clean
filter, so the changed bytes never become a different pointer and the file reads
as unmodified.

Observed directly. Writing `"version 1"` to a `.webp`, committing, then writing
`"version 2"` (both 10 bytes) leaves `git status --short` empty while the file
on disk holds `version 2`. Writing `"version 2 MUCH LONGER CONTENT HERE"`
instead reports ` M` as expected. `annex.thin` is `false` and the working-tree
file is a regular file, not a symlink.

A cross-model review found a second call site with the same gate:
`src/webapp/routes/api-files-write.ts:155` uses `pathsHaveChanges` before
`/api/files-commit`, so a same-size edit can also be silently skipped on commit,
not only lost on delete.

The consequence is on the file-delete route
(`src/webapp/routes/api-files.ts:297-303`), which preserves a dirty file in its
own commit before deleting it:

```ts
if (await pathsHaveChanges(boxRoot, [relativePath])) {
  await stageFiles(boxRoot, [relativePath]);
  await commitPaths(boxRoot, { paths: [relativePath], message: `Saved before user delete: ...` });
}
```

When the check reads clean, that commit is skipped and the delete commits over
an uncommitted edit. The edit is gone, with no error.

Reachable only now. Under the manifest scheme asset bytes were gitignored, so
this path never ran `git status` against them meaningfully. Making assets
git-tracked is what brings them under the check.

Not yet established: whether the discriminator is size alone or size plus mtime
granularity. The empirical result above is reproducible; the mechanism is
assumed to be git's stat cache and was not confirmed. Establishing that is the
first step, because it decides the fix — re-running the filter on this path, an
explicit content comparison, or `git add --renormalize` before the check.

A narrow window, but the failure is silent data loss on a delete, which is the
class this seam keeps producing.

Found because `test/webapp/routes/routes-api.doctest.md` seeded two same-length
versions; that fixture now uses different lengths so it tests the preservation
rather than the stat cache.
