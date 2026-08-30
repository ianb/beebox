/**
 * Selection panel for the chat composer.
 *
 * Shows a pill per document text-selection the user attached from the
 * companion pane. Each pill references a numeric id that appears as
 * `[selectionN]` in the textarea; clicking the pill reveals the full text +
 * source + position, the trash button removes it and strips its token. The
 * row mirrors `AttachmentPanel` (images) and sits beside it above the
 * composer.
 */

import { useState } from "react";
import { type SelectionItem } from "../../lib/selection/serialize";

function docName(ref: string): string {
  const base = ref.split("/").pop();
  if (base === undefined || base === "") return ref;
  return base.endsWith(".card") ? base.slice(0, -5) : base;
}

function snippet(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > 32 ? `${collapsed.slice(0, 32)}…` : collapsed;
}

export function SelectionPanel({
  selections,
  onRemove,
}: {
  selections: SelectionItem[];
  onRemove: (id: number) => void;
}) {
  if (selections.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 px-3 py-2 border-t border-warm-300 bg-warm-100/70">
      {selections.map((selection) => (
        <SelectionPill key={selection.id} selection={selection} onRemove={() => onRemove(selection.id)} />
      ))}
    </div>
  );
}

function SelectionPill({
  selection,
  onRemove,
}: {
  selection: SelectionItem;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative group" data-bbx-source={`selection-${selection.id}`}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-1.5 max-w-[16rem] rounded bg-warm-200 pl-1.5 pr-2 py-1 hover:ring-2 hover:ring-accent focus:outline-none focus:ring-2 focus:ring-accent"
        title="Click to view the selected text"
      >
        <span className="font-mono text-[10px] bg-warm-800 text-white px-1 rounded flex-shrink-0">{`selection#${String(selection.id)}`}</span>
        <span className="text-xs text-warm-700 truncate">“{snippet(selection.text)}”</span>
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-danger text-white flex items-center justify-center shadow hover:bg-danger-dark focus:outline-none focus:ring-2 focus:ring-danger"
        title="Remove selection"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      {open ? (
        <div className="absolute bottom-full mb-1 left-0 z-50 w-72 p-2 rounded-lg border border-warm-300 bg-white shadow-lg">
          <div className="text-xs font-medium text-warm-800 truncate" title={selection.ref}>{docName(selection.ref)}</div>
          {selection.position === "" ? null : (
            <div className="text-[11px] text-warm-500 mt-0.5 break-words">{selection.position}</div>
          )}
          <div className="mt-1 pt-1 border-t border-warm-200 text-sm text-warm-700 max-h-40 overflow-auto whitespace-pre-wrap">
            {selection.text}
          </div>
        </div>
      ) : null}
    </div>
  );
}
