/**
 * List of cards with status badges.
 */

import type { CardInfo } from "../api";

interface CardListProps {
  items: CardInfo[];
  onSelect: (card: CardInfo) => void;
  selectedPath?: string;
  emptyMessage?: string;
}

export function CardList({
  items,
  onSelect,
  selectedPath,
  emptyMessage = "No items",
}: CardListProps) {
  if (items.length === 0) {
    return (
      <div className="text-gray-500 text-center py-8">{emptyMessage}</div>
    );
  }

  return (
    <div className="divide-y">
      {items.map((item) => (
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
  );
}
