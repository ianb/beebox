/**
 * Comments renderer — threaded view for a `<basename>.comments.json` sidecar
 * (Google Drive collaborative comments captured by the drive connector).
 *
 * Registered above the generic `.json` renderer, so clicking a drive card's
 * `comments.ref` (or browsing straight to the file) shows the readable thread;
 * the user can toggle back to the raw JSON view via the renderer toggle.
 */

import { useQuery } from "@tanstack/react-query";
import { getApiBase } from "../api";
import { CommentsThread, parseComments } from "../components/CommentsThread";
import { Stack } from "../components/ui/Stack";
import { Text } from "../components/ui/Text";
import { RequestError } from "../lib/errors";
import { registerFileType, type RendererProps } from "./index";

function CommentsRenderer({ data }: RendererProps) {
  const url = `${getApiBase()}/files/${data.path}`;
  const basename = data.path.split("/").pop() ?? data.path;

  const { data: comments, isLoading, error } = useQuery({
    queryKey: ["comments-file", data.path],
    queryFn: async ({ signal }) => {
      const resp = await fetch(url, { signal });
      if (!resp.ok) {
        const message = `Failed to load: ${resp.status} ${resp.statusText}`;
        throw new RequestError(message);
      }
      return parseComments(await resp.json());
    },
  });

  if (isLoading) {
    return <Text as="div" tone="subtle" className="p-4" aria-busy>Loading comments…</Text>;
  }
  if (error) {
    const message = error instanceof Error ? error.message : "error";
    return <Text as="div" tone="danger" className="p-4">Couldn’t load {basename}: {message}</Text>;
  }

  return (
    <Stack gap="md" className="p-4 max-w-3xl">
      <Text as="h2" size="lg" weight="semibold">Comments</Text>
      <CommentsThread comments={comments ?? []} />
    </Stack>
  );
}

registerFileType(
  { match: (path) => path.endsWith(".comments.json") },
  { renderer: { name: "Comments", Component: CommentsRenderer, priority: 50 } },
);
