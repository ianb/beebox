/**
 * The reading view of a `docling.json.gz` — the canonical extraction a pdf card
 * keeps beside its original (`src/schemas/pdf.ts`).
 *
 * Before this view the file was unopenable in the app: a `.gz` in an attach
 * scope fell through to the binary renderer, so the one artifact that records
 * *where on the page* each piece of text came from could only be read by
 * downloading it and gunzipping it by hand.
 *
 * Container: it fetches and parses (`hooks/useDoclingDocument`), lists the
 * sibling attach scope to find the `page-NNN.avif` / `figure-NNN.avif` renders,
 * and owns the loading/empty/error states. `DoclingPageSection` draws each page.
 */

import { useParams } from "@tanstack/react-router";
import { getApiBase } from "../api";
import { trpc } from "../lib/trpc";
import { decompressionSupported, itemsByPage, type DoclingDocumentSummary } from "../lib/docling";
import { pageRenderNumber } from "../lib/pdf-card";
import { apiImageUrl } from "../lib/view-url";
import { useDoclingDocument } from "../hooks/useDoclingDocument";
import type { RendererProps } from "../renderers/index";
import { DoclingPageSection, type PageSectionAssets } from "./DoclingPageSection";
import { ExternalLink } from "./ui/ExternalLink";
import { Row } from "./ui/Row";
import { Stack } from "./ui/Stack";
import { Text } from "./ui/Text";

/** `figure-001.avif`, `figure-002.avif`, … — the renders of `pictures[]`, in order. */
const FIGURE_RENDER_RE = /^figure-(\d{3})\.avif$/;

/** The directory a box path lives in (`""` at the box root). */
function dirOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? "" : path.slice(0, cut);
}

function MetaItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Text size="xs" tone="muted">
      <span className="uppercase tracking-wide">{label}</span>{" "}
      <span className="text-warm-700">{children}</span>
    </Text>
  );
}

/**
 * Page renders and figure renders sitting beside the JSON, keyed the way the
 * document addresses them: page number for a page render, 0-based `pictures[]`
 * index for a figure (see `DoclingPictureItem.index` for why that correlation
 * holds and why it is only used when the file exists).
 */
function useSiblingRenders(jsonPath: string, boxSlug: string | undefined) {
  const { data } = trpc.status.browse.useQuery({ path: dirOf(jsonPath) });
  const pages = new Map<number, string>();
  const figures = new Map<number, string>();
  for (const file of data?.files ?? []) {
    const url = apiImageUrl(boxSlug ?? "", file.relativePath);
    const page = pageRenderNumber(file.name);
    if (page !== null) {
      pages.set(page, url);
      continue;
    }
    const figure = FIGURE_RENDER_RE.exec(file.name);
    if (figure?.[1] !== undefined) figures.set(Number(figure[1]) - 1, url);
  }
  return { pages, figures };
}

function DoclingHeader({
  document,
  pageCount,
}: {
  document: DoclingDocumentSummary;
  pageCount: number;
}) {
  return (
    <Stack gap="sm">
      <Text as="h2" size="lg" weight="bold">
        {document.originFilename ?? document.name ?? "Docling extraction"}
      </Text>
      <Row gap="md" wrap>
        {document.schemaName === null ? null : <MetaItem label="Schema">{document.schemaName}</MetaItem>}
        {document.version === null ? null : <MetaItem label="Version">{document.version}</MetaItem>}
        <MetaItem label="Pages">{pageCount}</MetaItem>
        <MetaItem label="Items">{document.items.length}</MetaItem>
        {document.originMimetype === null ? null : <MetaItem label="Type">{document.originMimetype}</MetaItem>}
      </Row>
      {document.unrecognized > 0 ? (
        <Text as="p" size="sm" tone="muted">
          {document.unrecognized} item{document.unrecognized === 1 ? "" : "s"} in this document
          use a shape this viewer doesn&rsquo;t recognize and are not shown.
        </Text>
      ) : null}
    </Stack>
  );
}

export function DoclingView({ data }: RendererProps) {
  const { boxSlug } = useParams({ strict: false });
  const { data: loaded, isLoading, error } = useDoclingDocument(data.path);
  const { pages, figures } = useSiblingRenders(data.path, boxSlug);
  const downloadUrl = `${getApiBase()}/files/${data.path}`;
  const basename = data.path.split("/").pop() ?? data.path;

  if (!decompressionSupported()) {
    return (
      <Stack gap="sm" className="p-4">
        <Text as="p" tone="subtle">
          This browser can&rsquo;t decompress <code>.gz</code> files in the page.
        </Text>
        <ExternalLink href={downloadUrl} variant="button" download={basename}>Download</ExternalLink>
      </Stack>
    );
  }
  if (isLoading) {
    return (
      <div className="p-4" aria-busy="true" aria-label="Loading extraction">
        <Stack gap="sm">
          <div className="h-6 w-64 bg-warm-100 rounded animate-pulse" />
          <div className="h-32 bg-warm-100 rounded animate-pulse" />
        </Stack>
      </div>
    );
  }
  if (error !== null || loaded === undefined) {
    return (
      <Stack gap="sm" className="p-4">
        <Text as="p" tone="danger">
          Could not read {basename}: {error?.message ?? "no content"}
        </Text>
        <ExternalLink href={downloadUrl} variant="button" download={basename}>Download the file</ExternalLink>
      </Stack>
    );
  }

  const sections = itemsByPage(loaded.document);
  const pageCount = Math.max(loaded.document.pageNumbers.length, pages.size);

  return (
    <div className="p-4 max-w-3xl">
      <Stack gap="lg">
        <DoclingHeader document={loaded.document} pageCount={pageCount} />
        {sections.length === 0 ? (
          <Text as="p" tone="subtle">
            This extraction records no text, tables, or pictures — the document
            may be image-only, or written by a docling version this viewer
            can&rsquo;t read.
          </Text>
        ) : (
          sections.map((section, index) => {
            const assets: PageSectionAssets = {
              pageRender: section.page === null ? null : pages.get(section.page) ?? null,
              figures,
            };
            return (
              <DoclingPageSection
                // Sections are positional (a page can legitimately repeat when
                // items are interleaved), so position is the identity.
                key={`${String(section.page)}-${String(index)}`}
                page={section.page}
                items={section.items}
                assets={assets}
              />
            );
          })
        )}
      </Stack>
    </div>
  );
}
