/**
 * List of cards with status badges, grouped by subdirectory.
 */

import { useMemo } from "react";
import type { CardInfo } from "../api";
import { StatusBadge } from "./ui/StatusBadge";

interface CardListProps {
  items: CardInfo[];
  onSelect: (card: CardInfo) => void;
  selectedPath?: string;
  emptyMessage?: string;
}

interface GroupedItems {
  subdir: string | undefined;
  items: CardInfo[];
}

export function CardList({
  items,
  onSelect,
  selectedPath,
  emptyMessage = "No items",
}: CardListProps) {
  // Group items by subdirectory
  const grouped = useMemo(() => {
    const groups = new Map<string | undefined, CardInfo[]>();

    for (const item of items) {
      const key = item.subdir;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(item);
    }

    // Convert to array and sort: root items first, then alphabetically by subdir
    const result: GroupedItems[] = [];

    // Root items first (no subdir)
    const noSubdir = undefined as string | undefined;
    if (groups.has(noSubdir)) {
      result.push({ subdir: noSubdir, items: groups.get(noSubdir)! });
      groups.delete(noSubdir);
    }

    // Then subdirectories alphabetically
    const subdirs = Array.from(groups.keys()).toSorted();
    for (const subdir of subdirs) {
      result.push({ subdir, items: groups.get(subdir)! });
    }

    return result;
  }, [items]);

  if (items.length === 0) {
    return (
      <div className="text-warm-600 text-center py-8">{emptyMessage}</div>
    );
  }

  return (
    <div>
      {grouped.map((group) => (
        <div key={group.subdir ?? "__root__"}>
          {/* Show header for subdirectories */}
          {group.subdir ? <div className="px-4 py-2 bg-warm-100 text-xs font-semibold text-warm-700 uppercase tracking-wider sticky top-0">
              {group.subdir}
            </div> : null}
          <div className="divide-y">
            {group.items.map((item) => (
              <button
                key={item.path}
                onClick={() => onSelect(item)}
                className={`w-full text-left px-4 py-3 hover:bg-warm-50 transition-colors ${
                  selectedPath === item.path ? "bg-info-50" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-warm-900 truncate">{item.name}</div>
                    {item.prompt ? <div className="text-sm text-warm-700 truncate">{item.prompt}</div> : null}
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className="text-xs text-warm-500">{item.type}</span>
                    {item.status ? <StatusBadge status={item.status} size="sm" /> : null}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
