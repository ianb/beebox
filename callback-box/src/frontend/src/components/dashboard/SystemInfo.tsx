/**
 * System info — compact footer with box metadata.
 */

import type { RouterOutput } from "../../lib/trpc";

type StatusResponse = RouterOutput["status"]["status"];
type VersionInfo = RouterOutput["health"]["check"]["version"];

interface SystemInfoProps {
  status: StatusResponse | null;
  version?: VersionInfo | null;
}

export function SystemInfo({ status, version }: SystemInfoProps) {
  if (!status) return null;

  // Recorded by the deploy script (deploy-info.json); absent in local dev.
  const deploy = version?.commits["callback-box"] ?? null;

  return (
    <section aria-label="System info" className="px-3 sm:px-4 py-2 sm:py-3 text-xs text-warm-600 flex flex-wrap items-center gap-x-4 gap-y-1 border-t bg-warm-50">
      <span>v{status.boxVersion}</span>
      <span>Created: {new Date(status.created).toLocaleDateString()}</span>
      <span>
        Git: {status.git.clean ? (
          <span className="text-success">clean</span>
        ) : (
          <span className="text-warning">
            {status.git.modified.length} modified, {status.git.untracked.length} untracked
          </span>
        )}
      </span>
      {deploy && version?.deployedAt ? (
        <span title={deploy.subject}>
          Deployed: <span className="font-mono">{deploy.hash}</span> · {new Date(version.deployedAt).toLocaleString()}
        </span>
      ) : null}
    </section>
  );
}
