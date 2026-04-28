/**
 * Binary renderer — fallback for non-text files that don't have a specialized
 * viewer (image, pdf, audio, etc.). Shows filename, size, content-type and a
 * download link instead of trying to render the bytes.
 */

import { useQuery } from "@tanstack/react-query";
import { getApiBase } from "../api";
import { isBinaryPath } from "../lib/binary-files";
import { registerFileRenderer, type RendererProps } from "./index";
import { Stack } from "../components/ui/Stack";
import { Text } from "../components/ui/Text";
import { ExternalLink } from "../components/ui/ExternalLink";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

function BinaryRenderer({ data }: RendererProps) {
  const apiBase = getApiBase();
  const url = `${apiBase}/files/${data.path}`;
  const basename = data.path.split("/").pop() || data.path;

  const { data: meta, isLoading } = useQuery({
    queryKey: ["file-meta", data.path],
    queryFn: async () => {
      const resp = await fetch(url, { method: "HEAD" });
      if (!resp.ok) throw new Error(`HEAD ${data.path}: ${resp.status}`);
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

registerFileRenderer(
  (path) => isBinaryPath(path),
  { name: "Download", Component: BinaryRenderer, priority: 2 },
);
