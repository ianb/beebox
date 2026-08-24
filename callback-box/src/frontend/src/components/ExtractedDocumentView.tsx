/**
 * The reading view of an extracted document card (`src/schemas/document.ts`).
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
 * (renderers/extracted-document.tsx), toggled in FileView's chrome.
 */

import { useMemo } from "react";
import { useParams } from "@tanstack/react-router";
import { attachDirFor } from "@shared/attach-path";
import { trpc } from "../lib/trpc";
import { displayName } from "../lib/display-name";
import { apiImageUrl } from "../lib/view-url";
import {
  ORIGINAL_RENDERER_NAME,
  pageRendersFrom,
  readExtractedFields,
  requestedPage,
  type DocumentPage,
  type ExtractedDocumentFields,
} from "../lib/extracted-document";
import type { RendererProps } from "../renderers/index";
import { DocumentPageStrip } from "./DocumentPageStrip";
import { DocumentStatusNotice } from "./DocumentStatusNotice";
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

export function ExtractedDocumentView({ data, onNavigate, params }: RendererProps) {
  const { boxSlug } = useParams({ strict: false });
  const fields = readExtractedFields(data.frontmatter);
  const body = data.body ?? "";
  const hasBody = body.trim() !== "";
  const activePage = requestedPage(params);
  const { pages, isLoading: pagesLoading, error: pagesError } = usePageRenders(data.path, boxSlug);

  const components = useMemo(
    () => makeEmbedComponents({ onNavigate, basePath: data.path, boxSlug, onJumpToQuote: undefined }),
    [onNavigate, data.path, boxSlug],
  );

  const showOriginal = () => {
    onNavigate({ path: data.path, viewer: ORIGINAL_RENDERER_NAME, params: {} });
  };

  return (
    <div className="p-4 max-w-3xl">
      <Stack gap="md">
        <DocumentHeader fields={fields} fallbackName={displayName(data.path)} />

        <DocumentStatusNotice
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
        <DocumentPageStrip pages={pages} activePage={activePage} />

        {hasBody ? (
          <div data-card-section="body">
            <Markdown prose="block" onNavigate={onNavigate} basePath={data.path} components={components}>
              {body}
            </Markdown>
          </div>
        ) : null}

        {fields.originalRef !== null ? (
          <Row gap="sm" className="pt-2 border-t border-warm-200">
            <Text size="sm" tone="muted">Extracted text — the original file is attached.</Text>
            <Button intent="secondary" size="sm" onClick={showOriginal}>
              View original
            </Button>
          </Row>
        ) : null}
      </Stack>
    </div>
  );
}
