/**
 * Comments renderer — threaded view for a `<basename>.comments.json` sidecar
 * (Google Drive collaborative comments captured by the drive connector).
 *
 * Registered above the generic `.json` renderer, so clicking a drive card's
 * `comments.ref` (or browsing straight to the file) shows the readable thread;
 * the user can toggle back to the raw JSON view via the renderer toggle.
 */

import { useQuery } from "@tanstack/react-query";
import { apiRawFileUrl, getApiBase } from "../api";
import { CommentsThread, parseComments } from "../components/CommentsThread";
import { Stack } from "../components/ui/Stack";
import { StatusMessage } from "../components/ui/StatusMessage";
import { ErrorText } from "../components/ui/ErrorText";
import { Heading } from "../components/ui/Heading";
import { RequestError } from "../lib/errors";
import { registerFileType, type RendererProps } from "./index";

function CommentsRenderer({ data }: RendererProps) {
  const url = apiRawFileUrl(getApiBase(), data.path);
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
    return <StatusMessage className="p-4">Loading comments…</StatusMessage>;
  }
  if (error) {
    const message = error instanceof Error ? error.message : "error";
    return <ErrorText className="p-4">Couldn’t load {basename}: {message}</ErrorText>;
  }

  return (
    <Stack gap="md" className="p-4 max-w-3xl">
      <Heading level={2}>Comments</Heading>
      <CommentsThread comments={comments ?? []} />
    </Stack>
  );
}

registerFileType(
  { match: (path) => path.endsWith(".comments.json") },
  { renderer: { name: "Comments", Component: CommentsRenderer, priority: 50 } },
);
