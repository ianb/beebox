/**
 * Fixed-position context menu for the browse page. Currently only has a
 * single Delete action; rendered at a specific screen coordinate.
 */

interface BrowseContextMenuProps {
  x: number;
  y: number;
  path: string;
  deletingPath: string | null;
  onDelete: (path: string) => void | Promise<void>;
}

export function BrowseContextMenu({ x, y, path, deletingPath, onDelete }: BrowseContextMenuProps) {
  return (
    <div
      className="fixed z-50 min-w-40 rounded-lg border border-warm-200 bg-white py-1 shadow-lg"
      style={{ left: x, top: y }}
    >
      <button
        type="button"
        id="bbx-browse-context-delete"
        onClick={() => void onDelete(path)}
        disabled={deletingPath !== null}
        className="block w-full px-3 py-2 text-left text-sm text-danger hover:bg-danger/10 disabled:text-warm-400 disabled:hover:bg-transparent"
      >
        {deletingPath === path ? "Deleting..." : "Delete"}
      </button>
    </div>
  );
}
