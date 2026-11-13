/**
 * One page's worth of a DoclingDocument, rendered as structure rather than JSON.
 *
 * Presentational: the container (`DoclingView`) has already parsed the document
 * and resolved which sibling renders exist, so this component only decides how
 * a text item, a table, and a picture look. Splitting it out keeps both files
 * inside the size cap and makes the item rendering readable on its own.
 */

import type { DoclingItem, DoclingTableCell } from "../../lib/docling/parse";
import { Badge } from "../ui/Badge";
import { Image } from "../ui/Image/view";
import { Row } from "../ui/Row";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { Hint } from "../ui/Hint";
import { Heading } from "../ui/Heading";
import { Table, Td, Th } from "../ui/Table";

/** Sibling renders this page section can link to, resolved by the container. */
export interface PageSectionAssets {
  /** Image URL of a `page-NNN.webp` or existing `.avif` render, or null when absent. */
  pageRender: string | null;
  /** Image URL of a `figure-NNN.webp` or existing `.avif` by 0-based picture index. */
  figures: Map<number, string>;
}

function Cell({ cell }: { cell: DoclingTableCell }) {
  const props = {
    colSpan: cell.colSpan === 1 ? undefined : cell.colSpan,
    rowSpan: cell.rowSpan === 1 ? undefined : cell.rowSpan,
  };
  return cell.header
    ? <Th scope="col" {...props}>{cell.text}</Th>
    : <Td {...props}>{cell.text}</Td>;
}

/** The table's name: docling's caption, or its page when docling recorded none. */
function tableName(caption: string | null, page: number | null): { caption: string; captionHidden: boolean } {
  if (caption !== null && caption.trim() !== "") return { caption, captionHidden: false };
  return { caption: page === null ? "Table with no page recorded" : `Table on page ${String(page)}`, captionHidden: true };
}

function TableItem({ rows, caption, page }: { rows: DoclingTableCell[][]; caption: string | null; page: number | null }) {
  if (rows.length === 0) {
    return (
      <Text as="p" size="sm" tone="muted">
        A table is here, but this docling version recorded no cell data for it.
      </Text>
    );
  }
  return (
    // Wide tables scroll inside the Table's own box rather than widening the page.
    <Table variant="grid" {...tableName(caption, page)} className="text-sm">
      <tbody>
        {rows.map((cells, rowIndex) => (
          // Row/cell order IS the identity here: docling gives cells offsets, not ids.
          <tr key={rowIndex}>
            {cells.map((cell, cellIndex) => (
              <Cell key={cellIndex} cell={cell} />
            ))}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/** A text item: its docling label, then the text itself. */
function TextItem({ label, text, level }: { label: string; text: string; level: number | null }) {
  const isHeading = label === "section_header" || label === "title";
  return (
    <Stack gap="none">
      <Text as="div" size="xs" tone="muted" uppercase>
        {label}{level === null ? "" : ` · level ${String(level)}`}
      </Text>
      <Text as="p" size={isHeading ? "base" : "sm"} weight={isHeading ? "bold" : "normal"}>
        {text}
      </Text>
    </Stack>
  );
}

function PictureItem({ src, caption }: { src: string | null; caption: string | null }) {
  return (
    <Stack gap="xs">
      <Text as="div" size="xs" tone="muted" uppercase>picture</Text>
      {src === null ? (
        <Hint>
          No extracted render for this picture in the attach scope.
        </Hint>
      ) : (
        <Image src={src} lightboxSrc={src} alt={caption ?? "Extracted figure"} size="sm" bordered lightbox loading="lazy" />
      )}
      {caption === null ? null : <Text as="p" size="sm" tone="subtle">{caption}</Text>}
    </Stack>
  );
}

export interface DoclingPageSectionProps {
  /** 1-based page, or null for items docling placed on no page. */
  page: number | null;
  items: DoclingItem[];
  assets: PageSectionAssets;
}

export function DoclingPageSection({ page, items, assets }: DoclingPageSectionProps) {
  return (
    <section aria-label={page === null ? "Items with no page" : `Page ${String(page)}`}>
      <Row gap="sm" align="center" className="pb-2">
        <Heading level={3}>
          {page === null ? "No page recorded" : `Page ${String(page)}`}
        </Heading>
        <Badge tone="neutral" size="sm">{items.length} item{items.length === 1 ? "" : "s"}</Badge>
      </Row>
      <Row gap="md" align="start" wrap>
        {assets.pageRender === null ? null : (
          <Image
            src={assets.pageRender}
            lightboxSrc={assets.pageRender}
            alt={page === null ? "Page render" : `Render of page ${String(page)}`}
            size="sm"
            bordered
            lightbox
            loading="lazy"
          />
        )}
        <Stack gap="sm" className="flex-1 min-w-64">
          {items.map((item) =>
            item.kind === "text" ? (
              <TextItem key={item.ref} label={item.label} text={item.text} level={item.level} />
            ) : item.kind === "table" ? (
              <TableItem key={item.ref} rows={item.rows} caption={item.caption} page={page} />
            ) : (
              <PictureItem
                key={item.ref}
                src={assets.figures.get(item.index) ?? null}
                caption={item.caption}
              />
            ),
          )}
        </Stack>
      </Row>
    </section>
  );
}
