/** The "Show earlier messages" button above a long transcript; the theme studio renders it too. */
export function LoadOlderHeader({ hasOlder, loadingOlder, onLoadOlder }: {
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
}) {
  if (!hasOlder) return null;
  return (
    <div className="text-center py-2">
      <button
        id="bbx-chat-load-older"
        onClick={onLoadOlder}
        disabled={loadingOlder}
        className="bbx-chat-meta-material text-sm text-card-pen hover:text-card-ink disabled:text-warm-400"
      >
        {loadingOlder ? "Loading..." : "Show earlier messages"}
      </button>
    </div>
  );
}
