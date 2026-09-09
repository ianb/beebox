import type { AddSelectionInput } from "../../../lib/selection/position";
/**
 * Detail panel for the browse page — header with filename + path, optional
 * "open full view" link for cards, optional delete button for raw files,
 * then the FileView body. Mobile back button at top.
 */

import { Link } from "@tanstack/react-router";
import { cardTypeFromName } from "@shared/card-name";
import { toDisplayPath } from "@shared/display-path";
import { href, toSearch } from "../../../lib/routing";
import { viewStateSearchValue } from "../../../lib/view-url";
import { displayName } from "../../../lib/display-name";
import type { NavigateHint, ViewState, ViewTarget } from "../../../lib/view-url";
import { FileView } from "../../../components/FileView";
import { useCardViewBinding } from "../../../lib/view-bindings";
import { MobileBackButton } from "../../../components/ui/MobileBackButton";

interface BrowseDetailPanelProps {
  boxSlug?: string;
  deleteError: string | null;
  deletingPath: string | null;
  onBack: () => void;
  onDelete: (path: string) => void | Promise<void>;
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
  /** URL query params, forwarded to the renderer (view-card runtime overrides). */
  params?: Record<string, string>;
  /** Renderer override from the URL's `?view=`. */
  rendererName?: string | null;
  /** Renderer-toggle choice, written back to the URL by the page. */
  onSelectRenderer: (name: string | null) => void;
  viewState?: ViewState | null;
  onViewStateChange: (next: ViewState, method: "push" | "replace") => void;
  onAddSelection?: (selection: AddSelectionInput) => void;
  selectedCard: { relativePath: string } | null;
  selectedFilePath: string;
  selectedRawFile: string | null;
}

/** Card type from a card path (nominal or positional naming). */
function cardTypeFromPath(path: string): string | undefined {
  return cardTypeFromName(path);
}

export function BrowseDetailPanel({
  boxSlug,
  deleteError,
  deletingPath,
  onBack,
  onDelete,
  onNavigate,
  onSelectRenderer,
  onViewStateChange,
  onAddSelection,
  params,
  rendererName,
  viewState,
  selectedCard,
  selectedFilePath,
  selectedRawFile,
}: BrowseDetailPanelProps) {
  // A card type rendered by a custom box view is an app, not prose — give it
  // the wide container (like raw files) instead of the prose-readability cap,
  // so a view is consistently wide rather than squeezed to max-w-4xl. Prose
  // cards (memo, doc, recipe, …) keep the narrower readable width.
  const viewBinding = useCardViewBinding(
    selectedRawFile ? undefined : cardTypeFromPath(selectedFilePath),
  );
  const wide = selectedRawFile !== null || viewBinding !== null;
  const fileView = (
    <FileView
      path={selectedFilePath}
      mode="companion"
      onNavigate={onNavigate}
      onSelectRenderer={onSelectRenderer}
      params={params}
      rendererName={rendererName}
      viewState={viewState}
      canPushViewState
      onViewStateChange={onViewStateChange}
      onAddSelection={onAddSelection}
      onClose={onBack}
    />
  );
  // w-full: without it, mx-auto suppresses flex stretch and the panel
  // shrink-wraps to its content's intrinsic width — one wide child (a
  // fixed-size canvas, an unbreakable path) then pans the whole card
  // sideways on narrow viewports instead of the child scaling down.
  return (
    <div className={`${wide ? "max-w-7xl" : "max-w-4xl"} w-full mx-auto py-4 sm:py-8 print:max-w-none print:mx-0 print:py-0`}>
      <h2 className="sr-only md:hidden">Browse</h2>
      <MobileBackButton id="bbx-browse-back" label="Back" onClick={onBack} className="mb-4 mx-4 print:hidden" />
      {deleteError ? (
        <div className="mb-4 mx-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger-dark print:hidden">
          {deleteError}
        </div>
      ) : null}
      <div
        className={selectedCard ? "bbx-interface-browse-panel min-w-0" : "bg-white rounded-lg shadow print:bg-transparent print:rounded-none print:shadow-none"}
        data-card-content={selectedCard ? "card" : "neutral"}
      >
        <div className={`flex items-start justify-between gap-4 px-4 py-3 print:hidden ${selectedCard ? "bbx-interface-card-toolbar" : "border-b border-warm-200"}`}>
          <div className="min-w-0 flex-1">
            {selectedCard ? null : <h2 className="truncate text-lg font-bold text-warm-900" title={toDisplayPath(selectedFilePath)}>
              {displayName(selectedFilePath)}
            </h2>}
            <div className="truncate text-sm text-warm-500" title={toDisplayPath(selectedFilePath)}>
              {toDisplayPath(selectedFilePath)}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {selectedCard ? (
              <Link
                id="bbx-browse-open-card"
                to={href(`/${boxSlug}/card/${selectedCard.relativePath}`)}
                search={toSearch({
                  ...params,
                  ...(rendererName ? { view: rendererName } : {}),
                  ...(viewState ? { viewState: viewStateSearchValue(viewState) } : {}),
                })}
                className="text-primary hover:text-primary-dark text-sm"
              >
                Open full view &rarr;
              </Link>
            ) : null}
            {selectedRawFile ? (
              <button
                type="button"
                id="bbx-browse-delete-file"
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
        {selectedCard ? <div className="bbx-interface-card-desk">{fileView}</div> : fileView}
      </div>
    </div>
  );
}
