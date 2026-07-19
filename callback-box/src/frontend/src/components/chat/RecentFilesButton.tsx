/**
 * Recent-files dropdown button in the chat header.
 *
 * Trigger shows a folder icon and a count badge for the number of unique
 * files touched in the current session. Opening the dropdown lists those
 * files as FileEntry components; peek / panel / page escalate from there.
 */

import { useRecentFiles } from "../../hooks/useRecentFiles";
import type { SessionEntry } from "../../api";
import type { FileSummary } from "@core/file-summary";
import { FileEntry } from "../ui/FileEntry";
import { DirectoryIcon } from "../../file-types/icons";
import { Dropdown, useDropdownClose } from "../ui/Dropdown";

interface RecentFilesButtonProps {
  entries: SessionEntry[];
  onPanel?: (summary: FileSummary<unknown>) => void;
}

function FolderIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  );
}

export function RecentFilesButton({ entries, onPanel }: RecentFilesButtonProps) {
  const { files, isLoading } = useRecentFiles(entries);
  const count = files.length;

  return (
    <Dropdown
      align="right"
      width="w-[40rem]"
      trigger={({ toggle, ariaProps }) => (
        <button
          type="button"
          onClick={toggle}
          className="p-1.5 rounded hover:bg-white/20 text-white/80 hover:text-white"
          title={count > 0 ? `Recent files (${count})` : "Recent files"}
          {...ariaProps}
        >
          <FolderIcon />
        </button>
      )}
    >
      <RecentFilesMenu files={files} isLoading={isLoading} onPanel={onPanel} />
    </Dropdown>
  );
}

/** Menu body — rendered inside the Dropdown so it can close it on selection. */
function RecentFilesMenu({ files, isLoading, onPanel }: {
  files: ReturnType<typeof useRecentFiles>["files"];
  isLoading: boolean;
  onPanel?: (summary: FileSummary<unknown>) => void;
}) {
  const close = useDropdownClose();
  const handlePanel = onPanel
    ? (summary: FileSummary<unknown>) => {
        close();
        onPanel(summary);
      }
    : undefined;
  return (
    <>
      <div className="px-3 py-2 border-b border-warm-200 text-xs text-warm-500 font-medium uppercase tracking-wide">
        Recent files
      </div>
      {files.length === 0 ? (
        <div className="px-3 py-4 text-warm-500 italic flex items-center gap-2">
          <DirectoryIcon size={16} />
          {isLoading ? "Loading…" : "No files referenced yet"}
        </div>
      ) : (
        <div className="py-1">
          {files.map(({ path, summary }) => (
            <FileEntry
              key={path}
              summary={summary ?? { path, title: path }}
              onPanel={handlePanel}
            />
          ))}
        </div>
      )}
    </>
  );
}
