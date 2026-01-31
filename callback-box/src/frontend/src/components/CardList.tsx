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
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-gray-900">{item.name}</div>
              <div className="text-sm text-gray-500">{item.relativePath}</div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">{item.type}</span>
              {item.status && (
                <span className={`status-badge status-${item.status}`}>
                  {item.status}
                </span>
              )}
            </div>
          </div>
          {item.prompt && (
            <div className="mt-1 text-sm text-gray-600 truncate">
              {item.prompt}
            </div>
          )}
        </button>
      ))}
    </div>
  );
}
