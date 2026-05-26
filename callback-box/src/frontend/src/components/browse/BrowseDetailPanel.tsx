/**
 * Detail panel for the browse page — header with filename + path, optional
 * "open full view" link for cards, optional delete button for raw files,
 * then the FileView body. Mobile back button at top.
 */

import { Link } from "@tanstack/react-router";
import { href } from "../../lib/routing";
import type { NavigateHint, ViewTarget } from "../../lib/view-url";
import { FileView } from "../FileView";
import { MobileBackButton } from "../ui/MobileBackButton";

interface BrowseDetailPanelProps {
  boxSlug?: string;
  deleteError: string | null;
  deletingPath: string | null;
  onBack: () => void;
  onDelete: (path: string) => void | Promise<void>;
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
  selectedCard: { relativePath: string } | null;
  selectedFilePath: string;
  selectedRawFile: string | null;
}

function displayName(path: string): string {
  return path.split("/").pop() ?? path;
}

export function BrowseDetailPanel({
  boxSlug,
  deleteError,
  deletingPath,
  onBack,
  onDelete,
  onNavigate,
  selectedCard,
  selectedFilePath,
  selectedRawFile,
}: BrowseDetailPanelProps) {
  return (
    <div className={`${selectedRawFile ? "max-w-7xl" : "max-w-4xl"} mx-auto py-4 sm:py-8 print:max-w-none print:mx-0 print:py-0`}>
      <MobileBackButton label="Back" onClick={onBack} className="mb-4 mx-4 print:hidden" />
      {deleteError ? (
        <div className="mb-4 mx-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger-dark print:hidden">
          {deleteError}
        </div>
      ) : null}
      <div className="bg-white rounded-lg shadow print:bg-transparent print:rounded-none print:shadow-none">
        <div className="flex items-start justify-between gap-4 border-b border-warm-200 px-4 py-3 print:hidden">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-bold text-warm-900" title={selectedFilePath}>
              {displayName(selectedFilePath)}
            </h2>
            <div className="truncate text-sm text-warm-500" title={selectedFilePath}>
              {selectedFilePath}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {selectedCard ? (
              <Link
                to={href(`/${boxSlug}/card/${selectedCard.relativePath}`)}
                className="text-primary hover:text-primary-dark text-sm"
              >
                Open full view &rarr;
              </Link>
            ) : null}
            {selectedRawFile ? (
              <button
                type="button"
                onClick={() => void onDelete(selectedRawFile)}
                disabled={deletingPath !== null}
                aria-label={deletingPath === selectedRawFile ? "Deleting file" : "Delete file"}
                title={deletingPath === selectedRawFile ? "Deleting..." : "Delete file"}
                className="rounded p-2 text-danger hover:bg-danger/10 disabled:text-warm-400 disabled:hover:bg-transparent"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 7h12m-9 0V5a1 1 0 011-1h4a1 1 0 011 1v2m-7 0v11m4-11v11m5-11v12a1 1 0 01-1 1H8a1 1 0 01-1-1V7" />
                </svg>
              </button>
            ) : null}
          </div>
        </div>
        <FileView path={selectedFilePath} mode="companion" onNavigate={onNavigate} />
      </div>
    </div>
  );
}
