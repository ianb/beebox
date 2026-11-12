/**
 * Dashboard header strip — box name, connection status, inline action buttons.
 */

import { useBoxName } from "../../hooks/useBoxName";
import type { RouterOutput } from "../../lib/trpc/client";
import { List } from "../ui/List";
import { Popover } from "../ui/Popover";

type StatusResponse = RouterOutput["status"]["status"];

interface HeaderStripProps {
  status: StatusResponse | null;
  connected: boolean;
}

/**
 * The file lists. The popover is the one scroll container, so a keyboard open
 * (which focuses the text-only panel) scrolls it with the arrow keys.
 */
function GitStatusDetails({ git }: { git: StatusResponse["git"] }) {
  const { staged, modified, untracked } = git;
  const sections: Array<{ label: string; files: string[]; color: string }> = [];
  if (staged.length > 0) sections.push({ label: "Staged", files: staged, color: "text-success-dark" });
  if (modified.length > 0) sections.push({ label: "Modified", files: modified, color: "text-warning-dark" });
  if (untracked.length > 0) sections.push({ label: "Untracked", files: untracked, color: "text-warm-700" });

  return (
    <div className="text-xs">
      {git.clean ? (
        <p className="text-success">Working tree clean</p>
      ) : (
        <div className="space-y-2">
          {sections.map((s) => (
            <div key={s.label}>
              <div className={`font-semibold ${s.color} mb-0.5`}>
                {s.label} ({s.files.length})
              </div>
              <List gap="xs" className="font-mono text-warm-700 break-all">
                {s.files.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </List>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function HeaderStrip({ status, connected }: HeaderStripProps) {
  const boxRoot = status?.boxRoot;
  // NOT the last segment of boxRoot — since the operational root moved to <box>/content that is
  // the literal word "content" on every box, so the largest text on the dashboard named no box.
  const { boxName } = useBoxName();

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-4 py-2 sm:py-3 bg-white border-b">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <div className="min-w-0">
          {/* The box root stays reachable on hover; the machine's directory layout is not
              dashboard content, and printing it under the heading crowded out the box's name. */}
          <h2
            className="text-base sm:text-lg font-semibold text-warm-900 truncate"
            title={boxRoot === undefined ? undefined : boxRoot}
          >
            {boxName}
          </h2>
        </div>
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 ${connected ? "bg-success" : "bg-danger-light"}`}
          title={connected ? "Connected" : "Disconnected"}
        />
        {status ? (
          <Popover
            label="Git status"
            width="lg"
            trigger={({ toggle, ariaProps }) => (
              <button type="button"
                id="bbx-dashboard-git-status"
                data-bbx-does="opens the box's git status — which files are modified or untracked"
                onClick={toggle}
                {...ariaProps}
                className={`text-sm px-2 py-0.5 rounded hover:bg-warm-100 whitespace-nowrap ${
                  status.git.clean ? "text-success" : "text-warning"
                }`}
              >
                {status.git.clean ? "clean" : `dirty (${status.git.modified.length + status.git.untracked.length} files)`}
              </button>
            )}
          >
            <GitStatusDetails git={status.git} />
          </Popover>
        ) : null}
      </div>
    </div>
  );
}
