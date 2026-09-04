/**
 * Backup section: what of this box exists anywhere but the machine serving it.
 *
 * The point of the section is one distinction that is otherwise invisible: a
 * box's history and its assets travel separately. `git push` carries cards and
 * text; asset BYTES only move to a remote git-annex knows about. A box can be
 * perfectly "in sync" with GitHub and still hold the only copy of every photo
 * in it — which is why the asset line is stated in files and bytes rather than
 * a tick, and why the warning names which of the two failure modes applies.
 *
 * Read-only. Nothing here fetches or pushes, so opening Admin cannot change
 * what it reports.
 */

import { trpc } from "../../lib/trpc";

/** Bytes as a short human string. Binary units, matching git's own `-H` output. */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  // One decimal below 10 (9.4 GB reads better than 9 GB); none above, where
  // the extra digit is noise.
  return `${value < 10 ? value.toFixed(1) : Math.round(value).toString()} ${units[exponent]}`;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-sm py-1">
      <span className="text-warm-600 w-32 shrink-0">{label}</span>
      <span className="text-warm-800">{children}</span>
    </div>
  );
}

export function BackupSection() {
  const query = trpc.admin.backupStatus.useQuery();
  const status = query.data?.repo;

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold text-warm-800 mb-2">Backup</h2>
      <p className="text-sm text-warm-700 mb-4">
        Where copies of this box exist besides this machine. Its history and its
        attachments travel separately, so they are reported separately.
      </p>

      {query.isLoading ? <p className="text-sm text-warm-600">Checking…</p> : null}

      {query.error != null ? (
        <p className="text-sm text-danger">Could not read backup status: {query.error.message}</p>
      ) : null}

      {query.data != null && status == null ? (
        <p className="text-sm text-warm-700">
          This box is not a git repository, so nothing about it is versioned or backed up.
        </p>
      ) : null}

      {status != null ? (
        <div>
          <Row label="Git remote">
            {status.remote === null ? (
              <span className="text-danger">none configured — this box is nowhere else</span>
            ) : (
              <>
                <span className="font-mono text-xs">{status.remote.url}</span>
                {status.upstream.state === "none" ? (
                  <span className="text-warm-600"> · no tracking branch</span>
                ) : status.upstream.state === "stale" ? (
                  // Configured but its remote-tracking ref is gone — a deleted
                  // remote branch or a clone that has never fetched. Saying "no
                  // tracking branch" here would hide a state worth acting on.
                  <span className="text-warning"> · upstream configured but never fetched</span>
                ) : status.upstream.ahead === 0 ? (
                  <span className="text-warm-600"> · in sync</span>
                ) : (
                  <span className="text-warning">
                    {" "}
                    · {status.upstream.ahead} commit{status.upstream.ahead === 1 ? "" : "s"} not pushed
                  </span>
                )}
                {/* A sibling clone on this same disk is a second copy, not a
                    backup — say so rather than letting "in sync" imply safety. */}
                {status.remote.offsite ? null : (
                  <span className="text-warning"> · on this machine, not elsewhere</span>
                )}
              </>
            )}
          </Row>

          <Row label="Repository">{formatBytes(status.repoBytes)}</Row>

          <Row label="Attachments">
            {status.annex === null
              ? "not tracked by git-annex"
              : `${status.annex.fileCount} file${status.annex.fileCount === 1 ? "" : "s"} · ${formatBytes(status.annex.bytes)}`}
          </Row>

          {status.assetRisk !== null ? (
            <div className="mt-3 text-sm text-warning-dark bg-warning-50 rounded p-3">
              <p className="font-semibold mb-1">
                {status.assetRisk.fileCount} file
                {status.assetRisk.fileCount === 1 ? "" : "s"} ({formatBytes(status.assetRisk.bytes)}) exist only on
                this machine.
              </p>
              {status.assetRisk.reason === "no-annex-remote" ? (
                <p>
                  Their names and history travel with the repository, but no remote can hold the
                  file contents themselves — git-annex needs a remote of its own, which a plain
                  GitHub repository is not. Pushing will never move them.
                </p>
              ) : (
                <p>
                  This box does not use git-annex, so git ignores the files themselves; only
                  whatever metadata the box happens to track travels with a push. The bytes
                  need a backup that is not this repository.
                </p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
