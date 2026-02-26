/**
 * System info — compact footer with box metadata.
 */

import type { StatusResponse } from "../../api";

interface SystemInfoProps {
  status: StatusResponse | null;
}

export function SystemInfo({ status }: SystemInfoProps) {
  if (!status) return null;

  return (
    <div className="px-3 sm:px-4 py-2 sm:py-3 text-xs text-warm-600 flex flex-wrap items-center gap-x-4 gap-y-1 border-t bg-warm-50">
      <span>v{status.boxVersion}</span>
      <span>Created: {new Date(status.created).toLocaleDateString()}</span>
      <span>
        Git: {status.git.clean ? (
          <span className="text-green-600">clean</span>
        ) : (
          <span className="text-yellow-600">
            {status.git.modified.length} modified, {status.git.untracked.length} untracked
          </span>
        )}
      </span>
    </div>
  );
}
