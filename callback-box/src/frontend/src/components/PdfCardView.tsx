/**
 * The reading view of a pdf card (`src/schemas/pdf.ts`).
 *
 * What the card holds: provenance for an original file kept in its attach
 * scope, the extracted markdown as the body, page renders (`page-001.avif`, …)
 * and figures beside it. Before this view existed the card fell through to the
 * generic frontmatter renderer, which showed a `filename:` table and a wall of
 * text with no way to see the pages or the original.
 *
 * Layout: header (title/author/pages/format/provenance) → a status notice when
 * extraction failed or produced nothing → the page strip → the extracted text →
 * a pointer at the original. The "Original" view itself is a second renderer
 * (renderers/pdf-card.tsx), toggled in FileView's chrome.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { attachDirFor } from "@shared/attach-path";
import { trpc } from "../lib/trpc";
import { displayName } from "../lib/display-name";
import { apiImageUrl, resolveRelativePath } from "../lib/view-url";
import { useDoclingDocument } from "../hooks/useDoclingDocument";
import {
  BODY_BLOCK_SELECTOR,
  matchBlocksToPages,
  pageBoundaries,
  pagedTexts,
} from "../lib/docling-match";
import {
  missingPageRenders,
  ORIGINAL_RENDERER_NAME,
  pageRendersFrom,
  readExtractedFields,
  requestedPage,
  type DocumentPage,
  type ExtractedDocumentFields,
} from "../lib/pdf-card";
import type { RendererProps } from "../renderers/index";
import { PdfPageStrip } from "./PdfPageStrip";
import { PdfPageMarkers, type PageMarker } from "./PdfPageMarkers";
import { PdfStatusNotice } from "./PdfStatusNotice";
import { makeEmbedComponents } from "./FigureEmbed";
import { Markdown } from "./Markdown";
import { AttachedComments } from "./AttachedComments";
import { Row } from "./ui/Row";
import { Stack } from "./ui/Stack";
import { Text } from "./ui/Text";
import { FriendlyDate } from "./ui/FriendlyDate";
import { Button } from "./ui/Button";

function MetaItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Text size="xs" tone="muted">
      <span className="uppercase tracking-wide">{label}</span>{" "}
      <span className="text-warm-700">{children}</span>
    </Text>
  );
}

function DocumentHeader({ fields, fallbackName }: { fields: ExtractedDocumentFields; fallbackName: string }) {
  const { title, author, pages, format, captured, source, description, originalName } = fields;
  return (
    <Stack gap="sm">
      <Text as="h2" size="lg" weight="bold">{title ?? fallbackName}</Text>
      <Row gap="md" wrap>
        {author !== null ? <MetaItem label="Author">{author}</MetaItem> : null}
        {pages !== null ? <MetaItem label="Pages">{pages}</MetaItem> : null}
        {format !== null ? <MetaItem label="Format">{format}</MetaItem> : null}
        {captured !== null ? (
          <MetaItem label="Captured"><FriendlyDate iso={captured} /></MetaItem>
        ) : null}
        {source !== null ? <MetaItem label="Source">{source}</MetaItem> : null}
        {originalName !== null ? <MetaItem label="File">{originalName}</MetaItem> : null}
      </Row>
      {description !== null ? (
        <Text as="p" size="sm" tone="subtle">{description}</Text>
      ) : null}
    </Stack>
  );
}

/** Page strip data, plus the load state of the attach-scope listing. */
function usePageRenders(cardPath: string, boxSlug: string | undefined) {
  const attachDir = attachDirFor(cardPath);
  const { data, isLoading, error } = trpc.status.browse.useQuery({ path: attachDir });
  const pages = useMemo<DocumentPage[]>(
    () => pageRendersFrom(data?.files ?? [], (relativePath) => apiImageUrl(boxSlug ?? "", relativePath)),
    [data, boxSlug],
  );
  return { pages, isLoading, error };
}

/**
 * Page-boundary markers for the rendered body, and the ref that finds it.
 *
 * The card body has no page breaks; the mapping is in the card's
 * `attach/docling.json.gz`. This loads that lazily (after the body has
 * rendered — the query is the only thing that can block, and nothing waits on
 * it), walks the rendered blocks, and measures where each page starts. Every
 * failure arm is silent to the reader and warns once to the console: the text
 * is readable without markers, and a missing extraction is an ordinary state
 * for a card written before docling ran.
 */
function usePageMarkers({ cardPath, doclingRef, enabled, body }: {
  cardPath: string;
  doclingRef: string | null;
  /** False on the small surfaces (chat, embed), where a gutter has no room. */
  enabled: boolean;
  /** The markdown source; a live edit re-renders the blocks under us. */
  body: string;
}): { bodyRef: React.RefObject<HTMLDivElement>; markers: PageMarker[] } {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [markers, setMarkers] = useState<PageMarker[]>([]);
  // A ref that escapes the box root resolves to null, which reads here as "no
  // extraction" — the same visible outcome as a card that never had one.
  const doclingPath =
    !enabled || doclingRef === null ? null : resolveRelativePath(cardPath, doclingRef);
  const { data: loaded, error } = useDoclingDocument(doclingPath);

  useEffect(() => {
    if (error === null) return;
    console.warn(`Page markers unavailable for ${cardPath}: ${error.message}`);
  }, [error, cardPath]);

  useEffect(() => {
    const root = bodyRef.current;
    if (root === null || loaded === undefined) {
      setMarkers([]);
      return;
    }
    const blocks = [...root.querySelectorAll(BODY_BLOCK_SELECTOR)].filter(
      (element): element is HTMLElement => element instanceof HTMLElement,
    );
    const matched = matchBlocksToPages(blocks.map((el) => el.textContent), pagedTexts(loaded.document));
    const boundaries = pageBoundaries(matched);
    // Offsets are measured, not derived, so they follow reflow (a resized
    // pane, a late-loading figure) rather than pinning to first layout.
    const measure = () => {
      setMarkers(boundaries.flatMap(({ block, page }) => {
        const element = blocks[block];
        return element === undefined ? [] : [{ page, top: element.offsetTop }];
      }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => { observer.disconnect(); };
  }, [loaded, body]);

  return { bodyRef, markers };
}

export function PdfCardView({ data, onNavigate, params, mode }: RendererProps) {
  const { boxSlug } = useParams({ strict: false });
  const fields = readExtractedFields(data.frontmatter);
  const body = data.body ?? "";
  const hasBody = body.trim() !== "";
  // A gutter marker selects a page locally; `?page=` still sets the initial
  // one, so a deep link and a click land on the same highlighted thumbnail.
  const [pickedPage, setPickedPage] = useState<number | null>(null);
  const linkedPage = requestedPage(params);
  useEffect(() => { setPickedPage(null); }, [linkedPage]);
  const activePage = pickedPage ?? linkedPage;
  const { bodyRef, markers } = usePageMarkers({
    cardPath: data.path,
    doclingRef: fields.doclingRef,
    // Chat and embed surfaces are narrow and non-primary: no gutter, and no
    // reason to spend a fetch + gunzip on a card the reader is glancing at.
    enabled: mode === undefined || mode === "page" || mode === "companion",
    body,
  });
  const { pages, isLoading: pagesLoading, error: pagesError } = usePageRenders(data.path, boxSlug);
  const showMissingPageRendersNotice = missingPageRenders({
    fields,
    pages,
    pagesLoading,
    pagesErrored: pagesError !== null,
  });

  const components = useMemo(
    () => makeEmbedComponents({ onNavigate, basePath: data.path, boxSlug, onJumpToQuote: undefined }),
    [onNavigate, data.path, boxSlug],
  );

  const showOriginal = () => {
    onNavigate({ path: data.path, viewer: ORIGINAL_RENDERER_NAME, params: {} });
  };

  // The canonical extraction is a file in the attach scope, not a view of this
  // card, so it opens as itself — `renderers/docling.tsx` renders it.
  const doclingPath =
    fields.doclingRef === null ? null : resolveRelativePath(data.path, fields.doclingRef);
  const showExtraction = () => {
    if (doclingPath !== null) onNavigate({ path: doclingPath, viewer: null, params: {} });
  };

  return (
    <div className="p-4 max-w-3xl">
      <Stack gap="md">
        <DocumentHeader fields={fields} fallbackName={displayName(data.path)} />

        <PdfStatusNotice
          status={fields.status}
          error={fields.error}
          hasBody={hasBody}
          cardPath={data.path}
        />

        <AttachedComments cardPath={data.path} frontmatter={data.frontmatter} />

        {pagesLoading ? (
          <div className="h-24 bg-warm-100 rounded animate-pulse" aria-busy="true" aria-label="Loading page renders" />
        ) : null}
        {pagesError ? (
          <Text size="sm" tone="danger">Could not list page renders: {pagesError.message}</Text>
        ) : null}
        <PdfPageStrip pages={pages} activePage={activePage} />
        {showMissingPageRendersNotice ? (
          <Text size="sm" tone="muted">
            {fields.pages} page{fields.pages === 1 ? "" : "s"} expected but not found in the attach scope.
          </Text>
        ) : null}

        {hasBody ? (
          // `relative` positions the marker overlay; the left padding is the
          // gutter it lives in, and is only spent when there are markers.
          <div
            ref={bodyRef}
            data-card-section="body"
            className={markers.length > 0 ? "relative pl-12" : "relative"}
          >
            <Markdown prose="block" onNavigate={onNavigate} basePath={data.path} components={components}>
              {body}
            </Markdown>
            <PdfPageMarkers markers={markers} activePage={activePage} onSelect={setPickedPage} />
          </div>
        ) : null}

        {fields.originalRef !== null ? (
          <Row gap="sm" className="pt-2 border-t border-warm-200">
            <Text size="sm" tone="muted">Extracted text — the original file is attached.</Text>
            <Button intent="secondary" size="sm" onClick={showOriginal}>
              View original
            </Button>
            {doclingPath === null ? null : (
              <Button intent="ghost" size="sm" onClick={showExtraction}>
                View extraction
              </Button>
            )}
          </Row>
        ) : null}
      </Stack>
    </div>
  );
}
