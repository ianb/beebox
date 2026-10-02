/**
 * Binary renderer — fallback for non-text files that don't have a specialized
 * viewer (image, pdf, audio, etc.). Shows filename, size, content-type and a
 * download link instead of trying to render the bytes.
 */

import { useQuery } from "@tanstack/react-query";
import { apiRawFileUrl, getApiBase } from "../api";
import { isBinaryPath } from "../lib/binary-files";
import { formatBytes } from "../lib/format-bytes";
import { Stack } from "../components/ui/Stack";
import { Text } from "../components/ui/Text";
import { ExternalLink } from "../components/ui/ExternalLink";
import { fetchFileMeta } from "../lib/file-meta";
import type { RendererEntry, RendererProps } from "../file-type-registry";

function BinaryRenderer({ data }: RendererProps) {
  const apiBase = getApiBase();
  const url = apiRawFileUrl(apiBase, data.path);
  const basename = data.path.split("/").pop() || data.path;

  // Annexed-but-absent is distinguished from a real failure so the UI can say
  // "not fetched" rather than "broken" — a very different thing to a reader
  // deciding whether their data is gone.
  const { data: meta, isLoading } = useQuery({
    queryKey: ["file-meta", data.path],
    queryFn: ({ signal }) => fetchFileMeta(url, signal),
  });

  return (
    <Stack gap="sm" className="p-6">
      <Text as="div" size="lg" weight="bold">{basename}</Text>
      <Text as="div" tone="subtle" size="sm" mono breakAll>{data.path}</Text>
      {isLoading ? (
        <Text as="div" tone="subtle" size="sm">Loading file info…</Text>
      ) : meta?.absent === true ? (
        <Text as="div" tone="subtle" size="sm">
          Content is not stored on this machine. Fetch it with{" "}
          <Text mono>git annex get {data.path}</Text>.
        </Text>
      ) : meta ? (
        <Stack gap="xs">
          {meta.size === null ? null : <Text as="div" size="sm"><Text tone="subtle">Size:</Text> {formatBytes(meta.size)}</Text>}
          {meta.contentType === null ? null : <Text as="div" size="sm"><Text tone="subtle">Type:</Text> {meta.contentType}</Text>}
        </Stack>
      ) : null}
      {meta?.absent === true ? null : (
        <ExternalLink href={url} variant="button" download={basename} className="self-start">
          Download
        </ExternalLink>
      )}
    </Stack>
  );
}

export const binaryRenderer: RendererEntry = {
  selector: { match: (path) => isBinaryPath(path) },
  renderer: { name: "Download", Component: BinaryRenderer, priority: 2 },
};
