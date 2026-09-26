# Git-annex conversion report — 2026-08-01

> **⚠ Also superseded on the scheme itself** (full-embrace-annex, 2026-09-14).
> Beyond the runbook warning below: this report describes converting boxes
> *from* the manifest scheme, and that scheme is now deleted along with
> `bbx attachments to-annex`. No box can be in the pre-conversion state this
> report addresses. Current model: [`../assets.md`](../assets.md).

> **Historical only. Do not run this cutover procedure as a current runbook.**
> This report preserves evidence and commands recorded during the 2026-07-31
> and 2026-08-01 conversion. It has not been revalidated against the present
> production server. See [`../assets.md`](../assets.md) for the current model,
> [`../server/operations.md`](../server/operations.md) for current operations,
> and [`../server/health-checks.md`](../server/health-checks.md) for current health checks.

## Recorded outcome

Local boxes were migrated on 2026-07-31. The recorded checks found no remaining
asset manifests or Git LFS rules, `annex.thin=false`, clean `git annex fsck`
results, and clean working trees. A byte comparison of one pre-conversion
backup found no changed or absent assets; its only mismatch was runtime state
that the box rewrites.

An earlier same-day note said production had not been converted. A later
2026-08-01 server inspection superseded it: the production boxes had the
`Claim assets into manifests (pre-annex)` and `Move assets onto git-annex`
commits, `annex.version 10`, `annex.thin false`, and annex objects containing
real bytes. The recorded verification passed `bbx doctor annex --check` and
`bbx doctor annex-fsck` on each box. One `bbx attachments to-annex --dry-run`
was a no-op; another was correctly stopped by the dirty-tree guard. These are
dated observations, not newly verified production state.

A post-conversion upload anomaly was filed at the time in
[`issues/closed/bugs/2026-08-01-prod-photo-uploads-bypass-annex.md`](../../../issues/closed/bugs/2026-08-01-prod-photo-uploads-bypass-annex.md).
Small metadata
sidecars named `manifest.json` also existed and were distinct from legacy asset
manifests.

## Rehearsal evidence

The rehearsal used `rsync -a` copies in a scratch directory rather than
modifying local boxes in place:

- `bbx doctor annex --check` passed the annex checks. The copied repositories'
  `hook` check failed because a plain rsync did not run `bbx init` to install
  the pre-commit hook.
- `bbx doctor annex-fsck` reported `annex fsck: no bad content`.
- `bbx attachments to-annex --dry-run` reported
  `Would annex 0 asset(s) (0 MB). Nothing changed.` for an already-converted
  copy.
- No manifest-scheme box was available locally, so the actual
  `manifest.json` to git-annex conversion path in
  `src/core/annex/to-annex.ts` was not rehearsed there. Its test suite covered
  dirty trees, stray `.gitignore` rules, LFS-pointer content, and insufficient
  disk.

## Historical cutover procedure

This section records the account and procedure together so the commands do not
masquerade as current operations.

The proposed preflight was to inspect the server for asset manifests and annex
configuration, make a fresh scratch copy, and rehearse the real conversion on
that copy. Each live box would then be handled independently.

```bash
# Check space and require a clean worktree.
ssh beebox@$(beebox/deploy/deploy-target.sh get BBX_DEPLOY_HOST) \
  "df -h /home/beebox/boxes/<box>"
ssh beebox@$(beebox/deploy/deploy-target.sh get BBX_DEPLOY_HOST) \
  "cd /home/beebox/boxes/<box> && git status --porcelain"

# The historical system had no per-box stop command.
deploy/prod-ssh "systemctl stop beebox-hub"

# Dry-run, then convert as the service user.
deploy/prod-ssh "su - beebox -c '
  cd /home/beebox/boxes/<box> &&
  bbx attachments to-annex --dry-run
'"
deploy/prod-ssh "su - beebox -c '
  cd /home/beebox/boxes/<box> &&
  bbx attachments to-annex
'"

# Verify before restarting.
deploy/prod-ssh "su - beebox -c '
  cd /home/beebox/boxes/<box> &&
  bbx doctor annex --check &&
  bbx doctor annex-fsck &&
  git status --porcelain &&
  find . -name manifest.json -not -path "./.git/*"
'"
deploy/prod-ssh "systemctl start beebox-hub"
```

The command was designed to own the clean-tree and disk preflight, compare
manifests to disk, take over LFS content, initialize and configure annex,
renormalize staged content, compare manifests to annex keys, remove asset
manifests, and make one commit. The checklist required passing doctor and fsck,
a clean worktree, no asset-scope manifest, and a rendered-image spot check.

The recorded rollback was to stop the hub, attempt `git annex uninit`, revert
the migration commit, and restore the pre-migration backup if the reversal or
byte verification failed. Because there was no annex remote, the backup was
the end-to-end rollback path.
