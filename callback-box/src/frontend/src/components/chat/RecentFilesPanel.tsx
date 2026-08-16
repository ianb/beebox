/**
 * "Recent files" sub-panel body for the context chip's menu — extracted from
 * the retired `RecentFilesButton` trigger (chunk 4 of
 * docs/plans/chat-header-chips.md). Derives entries from the session's
 * messages via `useRecentFiles`; peek / panel / page escalate from there.
 *
 * Empty state renders an explicit "No recent files yet" row rather than a
 * silent empty menu (code-style.md:69 — user-initiated actions, including
 * opening a menu, never silently no-op).
 */

import { useRecentFiles } from "../../hooks/useRecentFiles";
import type { SessionEntry } from "../../api";
import type { FileSummary } from "@core/file-summary";
import { FileEntry } from "../ui/FileEntry";
import { DirectoryIcon } from "../../file-types/icons";
import { useDropdownClose } from "../ui/Dropdown";

interface RecentFilesPanelProps {
  entries: SessionEntry[];
  onPanel?: (summary: FileSummary<unknown>) => void;
}

export function RecentFilesPanel({ entries, onPanel }: RecentFilesPanelProps) {
  const { files, isLoading } = useRecentFiles(entries);
  const close = useDropdownClose();
  const handlePanel = onPanel
    ? (summary: FileSummary<unknown>) => {
        close();
        onPanel(summary);
      }
    : undefined;

  if (files.length === 0) {
    return (
      <div className="px-3 py-4 text-warm-500 italic flex items-center gap-2">
        <DirectoryIcon size={16} />
        {isLoading ? "Loading…" : "No recent files yet"}
      </div>
    );
  }
  return (
    <div className="py-1">
      {files.map(({ path, summary }) => (
        <FileEntry
          key={path}
          summary={summary ?? { path, title: path }}
          onPanel={handlePanel}
        />
      ))}
    </div>
  );
}
