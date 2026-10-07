import { attachDirFor } from "@shared/attach-path";
import { useDirectoryListing } from "../../../directory-listing";
import type { RouterOutput } from "../../../lib/trpc/client";
import type { NavigateHint, ViewTarget } from "../../../lib/view-url";
import { PropertyLink, PropertyProblem, useRefetchOnFileChange } from "./property-section";

type Listing = RouterOutput["status"]["browse"];

/**
 * Everything in a card's attach scope, as one list of box-relative paths:
 * subdirectories, then cards, then other files, each labelled by its path
 * inside the scope (a subdirectory with a trailing "/").
 */
export function attachmentEntries(scope: string, listing: Pick<Listing, "dirs" | "cards" | "files">): { path: string; label: string }[] {
  const inside = (path: string) => (path.startsWith(`${scope}/`) ? path.slice(scope.length + 1) : path);
  return [
    ...listing.dirs.map((dir) => ({ path: `${scope}/${dir.name}`, label: `${dir.name}/` })),
    ...listing.cards.map((card) => ({ path: card.relativePath, label: inside(card.relativePath) })),
    ...listing.files.map((file) => ({ path: file.relativePath, label: inside(file.relativePath) })),
  ];
}

/**
 * The card's `<basename>.attach/` contents. Mounted only while Properties is
 * open. A missing scope directory lists as empty (`status.browse` on ENOENT),
 * which is the "No attachments" state.
 */
export function CardAttachments({ path, onNavigate }: { path: string; onNavigate: (target: ViewTarget, hint?: NavigateHint) => void }) {
  const scope = attachDirFor(path);
  const query = useDirectoryListing(scope);
  useRefetchOnFileChange(query.refetch);
  const entries = query.data ? attachmentEntries(scope, query.data) : null;
  return <section className="mt-6" aria-label="Attachments" data-card-section="attachments">
    <h3 className="text-sm font-semibold mb-2">{entries !== null && entries.length > 0 ? `Attachments (${String(entries.length)})` : "Attachments"}</h3>
    {query.isLoading ? <p className="text-sm" role="status">Checking attachments…</p> : null}
    {query.error ? <PropertyProblem message={`Could not list attachments: ${query.error.message}`} onRetry={() => { void query.refetch(); }} /> : null}
    {entries?.length === 0 && !query.error ? <p className="text-sm">No attachments</p> : null}
    {entries !== null && entries.length > 0 ? <ul className="space-y-2 text-sm">
      {entries.map((entry) => <li key={entry.path}>
        <PropertyLink target={{ path: entry.path, viewer: null, params: {}, viewState: null }} onNavigate={onNavigate}>{entry.label}</PropertyLink>
      </li>)}
    </ul> : null}
  </section>;
}
