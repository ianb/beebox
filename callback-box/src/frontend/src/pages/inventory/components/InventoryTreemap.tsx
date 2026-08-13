import { hierarchy, treemap } from "d3";
import { useState, type MouseEvent } from "react";
import type { RouterOutput } from "../../../lib/trpc";
import { formatBytes } from "../../../lib/format-bytes";

type Summary = RouterOutput["inventory"]["summary"]["direct"][number];
interface TreemapDatum {
  item?: Summary;
  children?: TreemapDatum[];
}

const TILE_COLORS = [
  "bg-primary text-white",
  "bg-info text-white",
  "bg-accent-dark text-white",
  "bg-success-dark text-white",
  "bg-warning-light text-warm-900",
  "bg-warm-600 text-white",
] as const;

export function InventoryTreemap({ items, metric }: { items: Summary[]; metric: "count" | "bytes" }) {
  const [hover, setHover] = useState<{ item: Summary; x: number; y: number } | null>(null);
  const sortedItems = items.toSorted((a, b) => metric === "count" ? b.count - a.count : b.bytes - a.bytes);
  const root = hierarchy<TreemapDatum>({ children: sortedItems.map((item) => ({ item })) })
    .sum((node) => metric === "count" ? node.item?.count ?? 0 : node.item?.bytes ?? 0);
  const layout = treemap<TreemapDatum>().size([100, 64]).paddingInner(0.5)(root);
  const leaves = layout.leaves();

  return (
    <figure>
      <div className="relative h-80 overflow-hidden rounded bg-warm-100" role="img" aria-label={`File types sized by ${metric === "count" ? "file count" : "bytes"}`} onMouseLeave={() => setHover(null)}>
        {leaves.map((leaf, index) => {
          const item = leaf.data.item;
          if (item === undefined) return null;
          const width = leaf.x1 - leaf.x0;
          const height = leaf.y1 - leaf.y0;
          const showLabel = width >= 12 && height >= 9;
          return (
            <div
              key={item.type}
              className={`absolute overflow-hidden p-1.5 ${TILE_COLORS[index % TILE_COLORS.length] ?? TILE_COLORS[0]}`}
              style={{ left: `${String(leaf.x0)}%`, top: `${String(leaf.y0 / 0.64)}%`, width: `${String(width)}%`, height: `${String(height / 0.64)}%` }}
              onMouseMove={(event) => setHoverForEvent({ event, item, setHover })}
            >
              {showLabel ? <><span className="block truncate text-xs font-semibold">{item.type}</span><span className="block truncate text-xs opacity-90">{metric === "count" ? item.count.toLocaleString() : formatBytes(item.bytes)}</span></> : null}
            </div>
          );
        })}
        {hover === null ? null : (
          <div
            className="pointer-events-none absolute z-10 min-w-36 max-w-48 -translate-x-1/2 -translate-y-full rounded bg-warm-900 px-2 py-1.5 text-xs text-white shadow-lg"
            style={{ left: hover.x, top: hover.y }}
          >
            <span className="block font-semibold">{hover.item.type}</span>
            <span className="block">{hover.item.count.toLocaleString()} files · {formatBytes(hover.item.bytes)}</span>
          </div>
        )}
      </div>
      <figcaption className="mt-2 text-xs text-warm-600">
        Tiny types may be unlabeled in the map; the table below always contains every value.
      </figcaption>
    </figure>
  );
}

function setHoverForEvent(input: {
  event: MouseEvent<HTMLDivElement>;
  item: Summary;
  setHover: (hover: { item: Summary; x: number; y: number }) => void;
}): void {
  const bounds = input.event.currentTarget.parentElement?.getBoundingClientRect();
  if (bounds === undefined) return;
  const x = Math.min(Math.max(input.event.clientX - bounds.left, 96), bounds.width - 96);
  const y = Math.min(Math.max(input.event.clientY - bounds.top - 8, 48), bounds.height - 8);
  input.setHover({ item: input.item, x, y });
}
