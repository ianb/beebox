/**
 * JSON renderer — pretty tree view for `.json` files.
 *
 * The shell (FileView) defers JSON content to this renderer instead of
 * prefetching it, so we can gate on size first: small files load and render
 * automatically; files over LARGE_THRESHOLD show their metadata plus a button,
 * so a multi-megabyte body is never pulled into the browser (and JSON.parsed)
 * unless the user asks for it.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getApiBase } from "../api";
import { formatBytes } from "../lib/format-bytes";
import { JsonView } from "../components/ui/JsonView";
import { Stack } from "../components/ui/Stack";
import { Row } from "../components/ui/Row";
import { Text } from "../components/ui/Text";
import { Button } from "../components/ui/Button";
import { ExternalLink } from "../components/ui/ExternalLink";
import { Pre } from "../components/ui/Pre";
import { RequestError } from "../lib/errors";
import { errorMessage } from "../lib/error-guards";
import { registerFileType, type RendererProps } from "./index";

/** Above this size we don't auto-download/parse — show info + a load button. */
const LARGE_THRESHOLD = 1024 * 1024; // 1 MiB

interface FileMeta {
  size: number;
  contentType: string;
}

function JsonRenderer({ data }: RendererProps) {
  const apiBase = getApiBase();
  const url = `${apiBase}/files/${data.path}`;
  const basename = data.path.split("/").pop() ?? data.path;
  const [loadRequested, setLoadRequested] = useState(false);

  // Size/type first, via HEAD — cheap, and lets us decide whether to auto-load.
  const { data: meta, isLoading: metaLoading, error: metaError } = useQuery<FileMeta>({
    queryKey: ["file-meta", data.path],
    queryFn: async () => {
      const resp = await fetch(url, { method: "HEAD" });
      if (!resp.ok) {
        const message = `HEAD ${data.path}: ${resp.status}`;
        throw new RequestError(message);
      }
      return {
        size: Number(resp.headers.get("content-length") ?? "0"),
        contentType: resp.headers.get("content-type") ?? "application/json",
      };
    },
  });

  const isLarge = meta !== undefined && meta.size > LARGE_THRESHOLD;
  // Auto-load small files; large files wait for an explicit request.
  const shouldLoad = meta !== undefined && (!isLarge || loadRequested);

  const { data: text, isLoading: bodyLoading, error: bodyError } = useQuery({
    queryKey: ["json-text", data.path],
    enabled: shouldLoad,
    queryFn: async ({ signal }) => {
      const resp = await fetch(url, { signal });
      if (!resp.ok) {
        const message = `Failed to load: ${resp.status} ${resp.statusText}`;
        throw new RequestError(message);
      }
      return resp.text();
    },
  });

  const parsed = useMemo<{ ok: true; value: unknown } | { ok: false; error: string } | null>(() => {
    if (text === undefined) return null;
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch (e) {
      return { ok: false, error: errorMessage(e) };
    }
  }, [text]);

  if (metaLoading) {
    return <Text as="div" tone="subtle" className="p-4">Loading file info…</Text>;
  }
  if (metaError || meta === undefined) {
    const message = metaError instanceof Error ? metaError.message : "unknown error";
    return <Text as="div" tone="danger" className="p-4">Couldn’t read {basename}: {message}</Text>;
  }

  // Large + not yet requested: show metadata and let the user opt in.
  if (isLarge && !loadRequested) {
    return (
      <Stack gap="sm" className="p-6">
        <Text as="div" size="lg" weight="bold">{basename}</Text>
        <Text as="div" tone="subtle" size="sm" mono breakAll>{data.path}</Text>
        <Stack gap="xs">
          <Text as="div" size="sm"><Text tone="subtle">Size:</Text> {formatBytes(meta.size)}</Text>
          <Text as="div" size="sm"><Text tone="subtle">Type:</Text> {meta.contentType}</Text>
        </Stack>
        <Text as="div" tone="subtle" size="sm">This file is large and isn’t loaded automatically.</Text>
        <Row gap="sm" className="mt-2">
          <Button intent="primary" size="sm" onClick={() => setLoadRequested(true)}>
            Load JSON ({formatBytes(meta.size)})
          </Button>
          <ExternalLink href={url} variant="button" download={basename}>Download</ExternalLink>
        </Row>
      </Stack>
    );
  }

  if (bodyLoading || parsed === null) {
    return <Text as="div" tone="subtle" className="p-4">Loading JSON…</Text>;
  }
  if (bodyError) {
    const message = bodyError instanceof Error ? bodyError.message : "error";
    return <Text as="div" tone="danger" className="p-4">Failed to load {basename}: {message}</Text>;
  }
  if (!parsed.ok) {
    // Not valid JSON — show the parse error and the raw text so it's still useful.
    return (
      <Stack gap="sm" className="p-4">
        <Text as="div" tone="danger" size="sm">Not valid JSON: {parsed.error}</Text>
        <Pre size="xs">{text}</Pre>
      </Stack>
    );
  }

  return (
    <div className="p-4">
      <Row justify="between" align="center" gap="sm" className="mb-2">
        <Text size="xs" tone="subtle">{formatBytes(meta.size)}</Text>
        <ExternalLink href={url} download={basename}>Download</ExternalLink>
      </Row>
      <JsonView value={parsed.value} />
    </div>
  );
}

registerFileType(
  { match: (path) => path.endsWith(".json") },
  { renderer: { name: "JSON", Component: JsonRenderer, priority: 40 } },
);
