/**
 * Built-in file renderers: raw source view for frontmatter cards.
 */

import { useQuery } from "@tanstack/react-query";
import { getApiBase } from "../api";
import { Pre } from "../components/ui/Pre";
import { Text } from "../components/ui/Text";
import { RequestError } from "../lib/errors";
import type { RendererProps } from "./index";
import { registerFileRenderer } from "./index";

/**
 * Raw source view for frontmatter cards. Fetches the verbatim file text on
 * demand from /api/files (card.get returns only the parsed form), so the bytes
 * ride along only when the user opens this tab.
 */
function SourceRenderer({ data }: RendererProps) {
  const { data: text, isLoading, error } = useQuery({
    queryKey: ["card-source", data.path],
    queryFn: async ({ signal }) => {
      const resp = await fetch(`${getApiBase()}/files/${data.path}`, { signal });
      if (!resp.ok) {
        const message = `Failed to load source: ${resp.status} ${resp.statusText}`;
        throw new RequestError(message);
      }
      return resp.text();
    },
  });
  if (isLoading) {
    return <Text as="div" tone="subtle" className="p-4">Loading source…</Text>;
  }
  if (error || text === undefined) {
    const message = error instanceof Error ? error.message : "No content";
    return <Text as="div" tone="danger" className="p-4">{message}</Text>;
  }
  return (
    <div className="p-4">
      <Pre boxed>{text}</Pre>
    </div>
  );
}

registerFileRenderer(
  (_path, data) => data.kind === "frontmatter",
  { name: "Source", Component: SourceRenderer, priority: 10 },
);
