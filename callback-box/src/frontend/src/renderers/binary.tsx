/**
 * Binary renderer — fallback for non-text files that don't have a specialized
 * viewer (image, pdf, audio, etc.). Shows filename, size, content-type and a
 * download link instead of trying to render the bytes.
 */

import { useQuery } from "@tanstack/react-query";
import { getApiBase } from "../api";
import { isBinaryPath } from "../lib/binary-files";
import { formatBytes } from "../lib/format-bytes";
import { Stack } from "../components/ui/Stack";
import { Text } from "../components/ui/Text";
import { ExternalLink } from "../components/ui/ExternalLink";
import { RequestError } from "../lib/errors";
import { registerFileType, type RendererProps } from "./index";

function BinaryRenderer({ data }: RendererProps) {
  const apiBase = getApiBase();
  const url = `${apiBase}/files/${data.path}`;
  const basename = data.path.split("/").pop() || data.path;

  const { data: meta, isLoading } = useQuery({
    queryKey: ["file-meta", data.path],
    queryFn: async () => {
      const resp = await fetch(url, { method: "HEAD" });
      if (!resp.ok) {
        const message = `HEAD ${data.path}: ${resp.status}`;
        throw new RequestError(message);
      }
      return {
        size: Number(resp.headers.get("content-length") ?? "0"),
        contentType: resp.headers.get("content-type") ?? "application/octet-stream",
      };
    },
  });

  return (
    <Stack gap="sm" className="p-6">
      <Text as="div" size="lg" weight="bold">{basename}</Text>
      <Text as="div" tone="subtle" size="sm" mono breakAll>{data.path}</Text>
      {isLoading ? (
        <Text as="div" tone="subtle" size="sm">Loading file info…</Text>
      ) : meta ? (
        <Stack gap="xs">
          <Text as="div" size="sm"><Text tone="subtle">Size:</Text> {formatBytes(meta.size)}</Text>
          <Text as="div" size="sm"><Text tone="subtle">Type:</Text> {meta.contentType}</Text>
        </Stack>
      ) : null}
      <ExternalLink href={url} variant="button" download={basename} className="self-start mt-2">
        Download
      </ExternalLink>
    </Stack>
  );
}

registerFileType(
  { match: (path) => isBinaryPath(path) },
  { renderer: { name: "Download", Component: BinaryRenderer, priority: 2 } },
);
