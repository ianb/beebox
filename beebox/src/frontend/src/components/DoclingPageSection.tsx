/**
 * One page's worth of a DoclingDocument, rendered as structure rather than JSON.
 *
 * Presentational: the container (`DoclingView`) has already parsed the document
 * and resolved which sibling renders exist, so this component only decides how
 * a text item, a table, and a picture look. Splitting it out keeps both files
 * inside the size cap and makes the item rendering readable on its own.
 */

import { cn } from "../lib/cn";
import type { DoclingItem, DoclingTableCell } from "../lib/docling";
import { Badge } from "./ui/Badge";
import { Image } from "./ui/Image";
import { Row } from "./ui/Row";
import { Stack } from "./ui/Stack";
import { Text } from "./ui/Text";

/** Sibling renders this page section can link to, resolved by the container. */
export interface PageSectionAssets {
  /** Image URL of `page-NNN.avif` for this page, or null when absent. */
  pageRender: string | null;
  /** Image URL of `figure-NNN.avif` by 0-based picture index, for the ones present. */
  figures: Map<number, string>;
}

function Cell({ cell }: { cell: DoclingTableCell }) {
  const props = {
    colSpan: cell.colSpan === 1 ? undefined : cell.colSpan,
    rowSpan: cell.rowSpan === 1 ? undefined : cell.rowSpan,
    className: "border border-warm-200 px-2 py-1 align-top text-sm",
  };
  return cell.header
    ? <th scope="col" {...props} className={cn(props.className, "bg-warm-100 font-medium text-left")}>{cell.text}</th>
    : <td {...props}>{cell.text}</td>;
}

function TableItem({ rows, caption }: { rows: DoclingTableCell[][]; caption: string | null }) {
  if (rows.length === 0) {
    return (
      <Text as="p" size="sm" tone="muted">
        A table is here, but this docling version recorded no cell data for it.
      </Text>
    );
  }
  return (
    // Wide tables scroll inside their own box rather than widening the page.
    <div className="overflow-x-auto">
      <table className="border-collapse">
        {caption === null ? null : <caption className="text-left text-sm text-warm-600 pb-1">{caption}</caption>}
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
      </table>
    </div>
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
        <Text as="p" size="sm" tone="muted">
          No extracted render for this picture in the attach scope.
        </Text>
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
        <Text as="h3" size="sm" weight="bold">
          {page === null ? "No page recorded" : `Page ${String(page)}`}
        </Text>
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
              <TableItem key={item.ref} rows={item.rows} caption={item.caption} />
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
