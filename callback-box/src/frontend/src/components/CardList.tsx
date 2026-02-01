/**
 * List of cards with status badges, grouped by subdirectory.
 */

import { useMemo } from "react";
import type { CardInfo } from "../api";

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
    if (groups.has(undefined)) {
      result.push({ subdir: undefined, items: groups.get(undefined)! });
      groups.delete(undefined);
    }

    // Then subdirectories alphabetically
    const subdirs = Array.from(groups.keys()).sort();
    for (const subdir of subdirs) {
      result.push({ subdir, items: groups.get(subdir)! });
    }

    return result;
  }, [items]);

  if (items.length === 0) {
    return (
      <div className="text-gray-500 text-center py-8">{emptyMessage}</div>
    );
  }

  return (
    <div>
      {grouped.map((group) => (
        <div key={group.subdir ?? "__root__"}>
          {/* Show header for subdirectories */}
          {group.subdir && (
            <div className="px-4 py-2 bg-gray-100 text-xs font-semibold text-gray-600 uppercase tracking-wider sticky top-0">
              {group.subdir}
            </div>
          )}
          <div className="divide-y">
            {group.items.map((item) => (
              <button
                key={item.path}
                onClick={() => onSelect(item)}
                className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${
                  selectedPath === item.path ? "bg-blue-50" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-gray-900 truncate">{item.name}</div>
                    {item.prompt && (
                      <div className="text-sm text-gray-600 truncate">{item.prompt}</div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className="text-xs text-gray-400">{item.type}</span>
                    {item.status && (
                      <span className={`status-badge status-${item.status}`}>
                        {item.status}
                      </span>
                    )}
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
