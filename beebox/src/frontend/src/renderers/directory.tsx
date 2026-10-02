/**
 * Directory renderer — listing of subdirectories, cards, and other files.
 *
 * Matches any path with no file extension. Fetches via tRPC status.browse.
 * Cards expand inline as accordions via the card renderer registry.
 */

import { useParams } from "@tanstack/react-router";
import { Text } from "../components/ui/Text";
import { ErrorText } from "../components/ui/ErrorText";
import { DirectoryListing, useDirectoryListing } from "../directory-listing";
import type { RendererEntry, RendererProps } from "../file-type-registry";

function DirectoryRenderer({ data, onNavigate }: RendererProps) {
  const dirPath = data.path.replace(/\/$/, "");
  const { boxSlug } = useParams({ strict: false });
  const { data: browse, isLoading, error } = useDirectoryListing(dirPath);

  if (isLoading) return <div className="p-4"><Text tone="subtle">Loading...</Text></div>;
  if (error) return <div className="p-4"><ErrorText>Error: {error.message}</ErrorText></div>;
  if (!browse) return <div className="p-4"><Text tone="subtle">Not found: {dirPath || "/"}</Text></div>;

  return (
    <div className="p-4">
      <Text as="div" size="sm" mono tone="muted" className="mb-2">{dirPath || ""}/</Text>
      <DirectoryListing
        browse={browse}
        dirPath={dirPath}
        boxSlug={boxSlug}
        onNavigate={onNavigate}
      />
    </div>
  );
}

export const directoryRenderer: RendererEntry = {
  selector: {
    match: (path) => {
      // Directories: no file extension on the last segment, or trailing slash.
      if (path.endsWith("/")) return true;
      const base = path.split("/").pop();
      if (!base) return true; // empty path = box root
      return !base.includes(".");
    },
  },
  renderer: { name: "Directory", Component: DirectoryRenderer, priority: 60 },
};
