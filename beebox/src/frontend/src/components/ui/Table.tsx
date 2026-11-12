import { createContext, useContext, useId, type ReactNode } from "react";
import { invariant } from "@shared/invariant";
import { cn } from "../../lib/cn";
import { useMaterial } from "./material";

export type TableVariant = "data" | "grid";
export type TableScroll = "x" | "both";

/**
 * The table's name, required: a `caption` (shown, or `captionHidden` for
 * screen readers only), or `labelledBy` the id of a visible heading. A
 * content renderer with no caption of its own writes a fallback at the call
 * site (`Table on page 3`).
 */
export type TableName =
  | { caption: string; captionHidden?: boolean; labelledBy?: never }
  | { labelledBy: string; caption?: never; captionHidden?: never };

export type TableProps = TableName & {
  /** `thead`, `tbody` and `tfoot` with raw `tr` rows of `Th` and `Td`. */
  children: ReactNode;
  /**
   * `data` (default): an app-authored table, rules under the header, between
   * body rows and over the footer. `grid`: rendered document content (a PDF table, a sheet),
   * every cell ruled.
   */
  variant?: TableVariant;
  /**
   * The wrapper is the table's only scroll container: `x` (default) scrolls
   * sideways, `both` also vertically once the caller caps its height. Do not
   * wrap a Table in another scroller; sticky cells stick to this one.
   */
  scroll?: TableScroll;
  /** Outer-layout classes for the scroll wrapper; inside components/, also the table's text size and font. */
  className?: string;
};

const VariantContext = createContext<TableVariant>("data");

const SCROLL_CLASSES: Record<TableScroll, string> = {
  x: "overflow-x-auto",
  both: "overflow-auto",
};

const TABLE_CLASSES: Record<TableVariant, string> = {
  data: "[&>thead]:border-b [&>thead]:border-warm-300 [&>tbody]:divide-y [&>tbody]:divide-warm-200 [&>tfoot]:border-t [&>tfoot]:border-warm-300",
  grid: "",
};

/**
 * A table and its one scroll container. The wrapper is a named, focusable
 * region so a keyboard can scroll it (axe `scrollable-region-focusable`).
 */
export function Table({ children, variant, scroll, className, caption, captionHidden, labelledBy }: TableProps) {
  const captionId = useId();
  variant = variant ?? "data";
  if (caption !== undefined) invariant(caption.trim() !== "", "Table caption must not be empty");
  const nameId = labelledBy ?? captionId;
  // On a card's material the caption takes the card's soft ink.
  const soft = useMaterial(undefined) ? "text-card-soft" : "text-warm-700";
  return (
    <div
      role="region"
      aria-labelledby={nameId}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scroll container needs a tab stop for keyboard scrolling (axe scrollable-region-focusable).
      tabIndex={0}
      className={cn(
        SCROLL_CLASSES[scroll ?? "x"],
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
        className,
      )}
    >
      <table
        aria-labelledby={labelledBy}
        className={cn("w-full border-collapse", TABLE_CLASSES[variant])}
      >
        {caption === undefined ? null : (
          <caption id={captionId} className={captionHidden === true ? "sr-only" : cn("pb-1 text-left text-sm", soft)}>
            {caption}
          </caption>
        )}
        <VariantContext.Provider value={variant}>{children}</VariantContext.Provider>
      </table>
    </div>
  );
}

interface CellProps {
  children?: ReactNode;
  colSpan?: number;
  rowSpan?: number;
  headers?: string;
  id?: string;
  title?: string;
  /** Right-aligned with tabular figures. */
  numeric?: boolean;
  [data: `data-${string}`]: string | undefined;
  /** Inside components/: the cell's own appearance on top of the variant's (a sticky column). */
  className?: string;
}

export interface ThProps extends CellProps {
  /** A column header (`col`) or a row header (`row`). */
  scope: "col" | "row";
}

const CELL_CLASSES: Record<TableVariant, string> = {
  data: "py-2 pr-3 last:pr-0 align-top",
  grid: "border border-warm-300 px-2 py-1 align-top",
};

const GRID_TH = "border border-warm-300 px-2 py-1 align-top bg-warm-100 font-medium text-warm-700";
const TH_CLASSES: Record<TableVariant, Record<ThProps["scope"], string>> = {
  data: {
    col: "pb-2 pr-3 last:pr-0 align-bottom font-medium",
    row: "py-2 pr-3 align-top font-medium",
  },
  grid: { col: GRID_TH, row: GRID_TH },
};

function alignClass(numeric: boolean | undefined): string {
  return numeric === true ? "text-right tabular-nums" : "text-left";
}

/** A header cell. `scope` is required. */
export function Th({ children, scope, numeric, className, ...rest }: ThProps) {
  const variant = useContext(VariantContext);
  // A data column header sits on the page or the card's paper; a grid header paints its own tint.
  const soft = useMaterial(undefined) ? "text-card-soft" : "text-warm-700";
  return (
    <th scope={scope} className={cn(TH_CLASSES[variant][scope], variant === "data" && scope === "col" ? soft : null, alignClass(numeric), className)} {...rest}>
      {children}
    </th>
  );
}

/** A body or footer cell. */
export function Td({ children, numeric, className, ...rest }: CellProps) {
  const variant = useContext(VariantContext);
  return (
    <td className={cn(CELL_CLASSES[variant], alignClass(numeric), className)} {...rest}>
      {children}
    </td>
  );
}
