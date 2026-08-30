/**
 * Renderers for a gzipped DoclingDocument (`attach/docling.json.gz`).
 *
 * Two views of the same file, toggled in FileView's chrome:
 *  - "Structure" (default) — pages, items, tables, figures (`DoclingView`).
 *  - "Raw JSON" — the decompressed text, pretty-printed, for when the
 *    structured view doesn't show the field you're after. The schema is
 *    upstream and versioned, so an escape hatch to the actual bytes matters
 *    more here than it would for a format we own.
 *
 * Both match on the path, not a card type: this is a plain file in an attach
 * scope, and without a match it fell through to the binary renderer.
 */

import { apiRawFileUrl, getApiBase } from "../api";
import { DoclingView } from "../components/DoclingView";
import { ExternalLink } from "../components/ui/ExternalLink";
import { Pre } from "../components/ui/Pre";
import { Stack } from "../components/ui/Stack";
import { Text } from "../components/ui/Text";
import { useDoclingDocument } from "../hooks/useDoclingDocument";
import { isDoclingPath } from "../lib/docling";
import type { RendererProps } from "./index";
import { registerFileType } from "./index";

/**
 * Characters of pretty-printed JSON we will put in the DOM. A DoclingDocument
 * carries a bbox and a charspan for every item, so even a short scan runs to
 * hundreds of kilobytes; past this the view offers the download instead of
 * asking the browser to lay out a million characters.
 */
const RAW_DISPLAY_LIMIT = 500_000;

/**
 * Cap on the *raw* fetched text before we even try to parse + pretty-print
 * it. Pretty-printing always grows the text (indentation, newlines), so
 * anything already past this is certain to blow {@link RAW_DISPLAY_LIMIT} —
 * checking the raw length first skips `JSON.parse` + `JSON.stringify` over a
 * multi-megabyte string just to throw the result away.
 */
const RAW_FETCH_LIMIT = 1_000_000;

function DoclingRawView({ data }: RendererProps) {
  const { data: loaded, isLoading, error } = useDoclingDocument(data.path);
  const basename = data.path.split("/").pop() ?? data.path;
  const downloadUrl = apiRawFileUrl(getApiBase(), data.path);

  if (isLoading) return <Text as="div" tone="subtle" className="p-4">Loading extraction…</Text>;
  if (error !== null || loaded === undefined) {
    return (
      <Stack gap="sm" className="p-4">
        <Text as="p" tone="danger">Could not read {basename}: {error?.message ?? "no content"}</Text>
        <ExternalLink href={downloadUrl} variant="button" download={basename}>Download the file</ExternalLink>
      </Stack>
    );
  }

  // Check the raw text length before parsing at all — parsing + pretty-
  // printing a multi-megabyte string only to discard it past the display cap
  // wastes real work on a large extraction.
  if (loaded.text.length > RAW_FETCH_LIMIT) {
    return (
      <Stack gap="sm" className="p-4">
        <Text as="p" tone="subtle">
          This extraction is {String(Math.round(loaded.text.length / 1024))} KB of JSON —
          too much to show at once. The Structure view reads it; the raw file downloads here.
        </Text>
        <ExternalLink href={downloadUrl} variant="button" download={basename}>Download the file</ExternalLink>
      </Stack>
    );
  }
  // Re-serialize rather than print the fetched text: the file is written by
  // Python's json.dump on one line, which is unreadable in a <pre>.
  const pretty = JSON.stringify(JSON.parse(loaded.text), null, 2);
  if (pretty.length > RAW_DISPLAY_LIMIT) {
    return (
      <Stack gap="sm" className="p-4">
        <Text as="p" tone="subtle">
          This extraction is {String(Math.round(pretty.length / 1024))} KB of JSON — too
          much to show at once. The Structure view reads it; the raw file downloads here.
        </Text>
        <ExternalLink href={downloadUrl} variant="button" download={basename}>Download the file</ExternalLink>
      </Stack>
    );
  }
  return (
    <div className="p-4">
      <Pre boxed scroll="lg" size="sm">{pretty}</Pre>
    </div>
  );
}

const selector = { match: (path: string) => isDoclingPath(path) };

registerFileType(selector, {
  renderer: { name: "Structure", Component: DoclingView, priority: 100 },
});

registerFileType(selector, {
  renderer: { name: "Raw JSON", Component: DoclingRawView, priority: 90 },
});
