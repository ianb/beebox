/**
 * The one component that draws a card's symbol.
 *
 * Before this there were four near-duplicate landmark symbol renderers, at four
 * sizes, disagreeing about the fallback — and separately a type-keyed icon
 * table. A mark is one idea and gets one renderer (engineering principle 8).
 *
 * Three things it will not do:
 *  - **Truncate a glyph.** An emoji is often several code points, and cutting
 *    one at its first grapheme produces a stranger. A long glyph is refused by
 *    lint and clipped by the fixed box below; it is never silently shortened.
 *  - **Invent a fallback.** The caller supplies it, because what stands in for a
 *    missing mark differs by surface: 📍 on a landmark tile, the file-type icon
 *    in a listing, the title's initials on a tab.
 *  - **Trust a colour.** Only the six accepted forms reach the DOM
 *    (`shared/css-colour.ts`), and only as `color`/`backgroundColor` — never the
 *    `background` shorthand, which would accept a `url()`.
 */

import type { ReactNode } from "react";
import { apiFileUrl } from "../../lib/view-url";
import { cn } from "../../lib/cn";
import { isCssColour } from "@shared/css-colour";
import type { CardSymbolData } from "@shared/card-symbol";

export type CardMarkSize = "xs" | "sm" | "md" | "lg";

/** Box size and text size per step. The box is fixed so a long glyph cannot move a layout. */
const SIZE_CLASSES: Record<CardMarkSize, string> = {
  xs: "w-4 h-4 text-[11px]",
  sm: "w-5 h-5 text-sm",
  md: "w-9 h-9 text-2xl",
  lg: "w-14 h-14 text-4xl",
};

function colour(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return isCssColour(value) ? value : undefined;
}

export function CardMark({ symbol, size, boxSlug, fallback, className }: {
  symbol: CardSymbolData | null | undefined;
  size?: CardMarkSize;
  boxSlug: string | undefined;
  /** What to draw when the card has no usable mark. */
  fallback?: ReactNode;
  /** Outer-layout classes (margin, flex item, position). */
  className?: string;
}) {
  size = size ?? "sm";
  const src = symbol?.src;
  const glyph = symbol?.glyph?.trim();
  const box = cn("inline-flex items-center justify-center flex-shrink-0 overflow-hidden", SIZE_CLASSES[size], className);

  // An image is the more specific intent, so it wins when a card carries both
  // (which lint warns about).
  if (src !== undefined && src !== "" && boxSlug !== undefined) {
    return <img src={apiFileUrl(boxSlug, src)} alt="" className={cn(box, "rounded-full object-cover")} />;
  }
  if (glyph === undefined || glyph === "") {
    return fallback === undefined ? null : <span className={box}>{fallback}</span>;
  }

  const background = colour(symbol?.background);
  const foreground = colour(symbol?.foreground);
  return (
    <span
      className={cn(box, background === undefined ? "" : "rounded-full")}
      style={{
        ...(background === undefined ? {} : { backgroundColor: background }),
        ...(foreground === undefined ? {} : { color: foreground }),
      }}
    >
      {glyph}
    </span>
  );
}
