/**
 * The popup's list of enabled boxes, in two modes. Normally a row picks the
 * active box, with a separate "Open ›" button that navigates to it. In edit
 * mode (the header's Edit toggle) the row instead reorders and removes —
 * removal is irreversible and un-prompted, so it stays out of the normal list.
 */

import { useCallback } from "react";
import type { EnabledBox } from "../domain/config.js";

/** The list callbacks, grouped so rows take one handlers prop instead of four. */
interface BoxListHandlers {
  onActivate: (boxUrl: string) => void;
  onDisable: (boxUrl: string) => void;
  onMove: (move: { boxUrl: string; delta: -1 | 1 }) => void;
  onOpen: (boxUrl: string) => void;
}

interface BoxListProps {
  boxes: EnabledBox[];
  activeBoxUrl: string | null;
  editing: boolean;
  handlers: BoxListHandlers;
}

export function BoxList({ boxes, activeBoxUrl, editing, handlers }: BoxListProps) {
  return (
    <div className="space-y-2">
      {boxes.map((box, index) => (
        <BoxRow
          key={box.boxUrl}
          box={box}
          isActive={box.boxUrl === activeBoxUrl}
          editing={editing}
          position={{ index, count: boxes.length }}
          handlers={handlers}
        />
      ))}
    </div>
  );
}

interface BoxRowProps {
  box: EnabledBox;
  isActive: boolean;
  editing: boolean;
  position: { index: number; count: number };
  handlers: BoxListHandlers;
}

function BoxRow({ box, isActive, editing, position, handlers }: BoxRowProps) {
  const { onActivate, onDisable, onMove, onOpen } = handlers;
  const handleActivate = useCallback(() => {
    onActivate(box.boxUrl);
  }, [onActivate, box.boxUrl]);
  const handleDisable = useCallback(() => {
    onDisable(box.boxUrl);
  }, [onDisable, box.boxUrl]);
  const handleOpen = useCallback(() => {
    onOpen(box.boxUrl);
  }, [onOpen, box.boxUrl]);
  const handleUp = useCallback(() => {
    onMove({ boxUrl: box.boxUrl, delta: -1 });
  }, [onMove, box.boxUrl]);
  const handleDown = useCallback(() => {
    onMove({ boxUrl: box.boxUrl, delta: 1 });
  }, [onMove, box.boxUrl]);

  const border = isActive && !editing ? "border-teal-500 bg-teal-50" : "border-gray-200";

  if (editing) {
    return (
      <div className={`flex items-center gap-1 rounded border p-2 ${border}`}>
        <MoveButtons
          title={box.title}
          position={position}
          onUp={handleUp}
          onDown={handleDown}
        />
        <span className="min-w-0 flex-1">
          <BoxLabel box={box} />
        </span>
        <button
          onClick={handleDisable}
          className="shrink-0 rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
          title={`Remove ${box.title} from the list`}
        >
          Remove
        </button>
      </div>
    );
  }

  const dot = isActive ? "bg-teal-500" : "bg-gray-300";
  return (
    <div className={`flex items-stretch gap-2 rounded border p-2 ${border}`}>
      <button
        onClick={handleActivate}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        title={isActive ? `${box.title} is the active box` : `Make ${box.title} the active box`}
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
        <BoxLabel box={box} />
      </button>
      {/* Deliberately a bordered button, not a bare glyph: opening a tab is a
          different kind of act from picking the active box, and the two sit
          side by side. */}
      <button
        onClick={handleOpen}
        className="shrink-0 self-center rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-600 hover:border-teal-500 hover:text-teal-700"
        title={`Open ${box.title} in a tab`}
      >
        Open ›
      </button>
    </div>
  );
}

interface MoveButtonsProps {
  title: string;
  position: { index: number; count: number };
  onUp: () => void;
  onDown: () => void;
}

function MoveButtons({ title, position, onUp, onDown }: MoveButtonsProps) {
  const moveClass = "rounded px-1 text-xs leading-none text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-30";
  return (
    <span className="flex shrink-0 flex-col">
      <button
        onClick={onUp}
        disabled={position.index === 0}
        className={moveClass}
        title={`Move ${title} up`}
        aria-label={`Move ${title} up`}
      >
        ▲
      </button>
      <button
        onClick={onDown}
        disabled={position.index === position.count - 1}
        className={moveClass}
        title={`Move ${title} down`}
        aria-label={`Move ${title} down`}
      >
        ▼
      </button>
    </span>
  );
}

function BoxLabel({ box }: { box: EnabledBox }) {
  return (
    <span className="min-w-0">
      <span className="block truncate text-sm font-medium">{box.title}</span>
      <span className="block truncate text-xs text-gray-400">{box.boxUrl}</span>
    </span>
  );
}
