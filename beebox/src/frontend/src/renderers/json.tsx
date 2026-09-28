/**
 * JSON renderer — pretty-printed text for `.json` files.
 *
 * The shell (FileView) defers JSON content to this renderer instead of
 * prefetching it, so we can gate on size first: small files load and render
 * automatically; files over LARGE_THRESHOLD show their metadata plus a button,
 * so a multi-megabyte body is never pulled into the browser (and JSON.parsed)
 * unless the user asks for it.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRawFileUrl, getApiBase } from "../api";
import { formatBytes } from "../lib/format-bytes";
import { Stack } from "../components/ui/Stack";
import { Row } from "../components/ui/Row";
import { Text } from "../components/ui/Text";
import { StatusMessage } from "../components/ui/StatusMessage";
import { ErrorText } from "../components/ui/ErrorText";
import { Button } from "../components/ui/Button";
import { ExternalLink } from "../components/ui/ExternalLink";
import { Pre } from "../components/ui/Pre";
import { RequestError } from "../lib/errors";
import { fetchFileMeta, type FileMeta } from "../lib/file-meta";
import { errorMessage } from "@shared/error-guards";
import type { RendererEntry, RendererProps } from "../file-type-registry";

/** Above this size we don't auto-download/parse — show info + a load button. */
const LARGE_THRESHOLD = 1024 * 1024; // 1 MiB

interface LargeFilePromptProps {
  path: string;
  url: string;
  size: number | null;
  contentType: string | null;
  onLoad: () => void;
}

function LargeFilePrompt({ path, url, size, contentType, onLoad }: LargeFilePromptProps) {
  const basename = path.split("/").pop() ?? path;
  return (
    <Stack gap="sm" className="p-6">
      <Text as="div" size="lg" weight="bold">{basename}</Text>
      <Text as="div" tone="subtle" size="sm" mono breakAll>{path}</Text>
      <Stack gap="xs">
        {size === null ? null : <Text as="div" size="sm"><Text tone="subtle">Size:</Text> {formatBytes(size)}</Text>}
        {contentType === null ? null : <Text as="div" size="sm"><Text tone="subtle">Type:</Text> {contentType}</Text>}
      </Stack>
      <Text as="div" tone="subtle" size="sm">
        {size === null ? "This file’s size is unknown, so it isn’t loaded automatically." : "This file is large and isn’t loaded automatically."}
      </Text>
      <Row gap="sm">
        <Button intent="primary" size="sm" onClick={onLoad}>
          {size === null ? "Load JSON" : `Load JSON (${formatBytes(size)})`}
        </Button>
        <ExternalLink href={url} variant="button" download={basename}>Download</ExternalLink>
      </Row>
    </Stack>
  );
}

function JsonRenderer({ data }: RendererProps) {
  const apiBase = getApiBase();
  const url = apiRawFileUrl(apiBase, data.path);
  const basename = data.path.split("/").pop() ?? data.path;
  const [loadRequested, setLoadRequested] = useState(false);

  // Size/type first — cheap, and lets us decide whether to auto-load.
  const { data: meta, isLoading: metaLoading, error: metaError } = useQuery<FileMeta>({
    queryKey: ["file-meta", data.path],
    queryFn: ({ signal }) => fetchFileMeta(url, signal),
  });

  // An unknown size is treated as large: never pull an unbounded body unasked.
  const size = meta === undefined || meta.absent ? null : meta.size;
  const isLarge = meta !== undefined && (size === null || size > LARGE_THRESHOLD);
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

  const parsed = useMemo<{ ok: true; pretty: string } | { ok: false; error: string } | null>(() => {
    if (text === undefined) return null;
    try {
      return { ok: true, pretty: JSON.stringify(JSON.parse(text), null, 2) };
    } catch (e) {
      return { ok: false, error: errorMessage(e) };
    }
  }, [text]);

  if (metaLoading) {
    return <StatusMessage className="p-4">Loading file info…</StatusMessage>;
  }
  if (meta?.absent === true) {
    return (
      <StatusMessage className="p-4">
        Content is not stored on this machine. Fetch it with <Text mono>git annex get {data.path}</Text>.
      </StatusMessage>
    );
  }
  if (metaError || meta === undefined) {
    const message = metaError instanceof Error ? metaError.message : "unknown error";
    return <ErrorText className="p-4">Couldn’t read {basename}: {message}</ErrorText>;
  }

  // Large + not yet requested: show metadata and let the user opt in.
  if (isLarge && !loadRequested) {
    return (
      <LargeFilePrompt
        path={data.path}
        url={url}
        size={size}
        contentType={meta.contentType}
        onLoad={() => setLoadRequested(true)}
      />
    );
  }

  if (bodyError) {
    const message = bodyError instanceof Error ? bodyError.message : "error";
    return <ErrorText className="p-4">Failed to load {basename}: {message}</ErrorText>;
  }
  if (bodyLoading || parsed === null) {
    return <StatusMessage className="p-4">Loading JSON…</StatusMessage>;
  }
  if (!parsed.ok) {
    // Not valid JSON — show the parse error and the raw text so it's still useful.
    return (
      <Stack gap="sm" className="p-4">
        <ErrorText>Not valid JSON: {parsed.error}</ErrorText>
        <Pre size="xs">{text}</Pre>
      </Stack>
    );
  }

  return (
    <div className="p-4">
      <Row justify="between" align="center" gap="sm" className="mb-2">
        <Text size="xs" tone="subtle">{size === null ? null : formatBytes(size)}</Text>
        <ExternalLink href={url} download={basename}>Download</ExternalLink>
      </Row>
      <Pre>{parsed.pretty}</Pre>
    </div>
  );
}

export const jsonRenderer: RendererEntry = {
  selector: { match: (path) => path.endsWith(".json") },
  renderer: { name: "JSON", Component: JsonRenderer, priority: 40 },
};
