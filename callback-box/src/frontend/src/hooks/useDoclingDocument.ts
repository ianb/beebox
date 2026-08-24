/**
 * Load a `docling.json.gz` out of a box and hand back the parsed document.
 *
 * Shared by the two consumers of the canonical extraction: the docling viewer
 * (which shows it) and the pdf card view (which uses it to label page
 * boundaries in the extracted text). One place fetches, gunzips, and parses;
 * `lib/docling.ts` owns everything pure.
 *
 * The raw-file route serves the `.gz` bytes verbatim — no `Content-Encoding` —
 * so the gunzip is ours. Failure is never fatal to the caller: the query
 * settles with an error and each surface degrades on its own terms (the viewer
 * shows it, the card view silently drops the markers).
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { getApiBase } from "../api";
import { RequestError } from "../lib/errors";
import { gunzipToText, parseDoclingJson, type DoclingDocumentSummary } from "../lib/docling";

/** A loaded docling document, plus the raw JSON text the "Raw" view prints. */
export interface LoadedDocling {
  document: DoclingDocumentSummary;
  text: string;
}

/** JSON that isn't a DoclingDocument at all — reported, not rendered as blank. */
class DoclingParseError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "DoclingParseError";
  }
}

/**
 * The query ran with no path. Unreachable in practice (`enabled` gates on the
 * same value); it exists so the query function narrows without a cast.
 */
class DoclingPathMissingError extends Error {
  constructor() {
    super("No docling file to load");
    this.name = "DoclingPathMissingError";
  }
}

/**
 * Fetch + gunzip + parse the gzipped DoclingDocument at `path` (box-relative).
 * `enabled: false` (the default when `path` is null) keeps the whole cost off
 * surfaces that don't need it.
 *
 * No retry: a 404 or a non-gzip body will not become a different answer on the
 * second attempt, and this runs behind a document the user is already reading.
 */
export function useDoclingDocument(path: string | null): UseQueryResult<LoadedDocling, Error> {
  return useQuery<LoadedDocling, Error>({
    queryKey: ["docling", path],
    enabled: path !== null,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async ({ signal }) => {
      if (path === null) throw new DoclingPathMissingError();
      const response = await fetch(`${getApiBase()}/files/${path}`, { signal });
      if (!response.ok) {
        const message = `Could not load ${path}: ${String(response.status)} ${response.statusText}`;
        throw new RequestError(message);
      }
      const text = await gunzipToText(await response.arrayBuffer());
      const parsed = parseDoclingJson(text);
      if (!parsed.ok) throw new DoclingParseError(parsed.error);
      return { document: parsed.document, text };
    },
  });
}
