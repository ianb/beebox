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

import { type SelectionItem } from "../../../../lib/selection/serialize";
import { CloseButton } from "../../../ui/CloseButton";
import { Popover } from "../../../ui/Popover";
import { displayName } from "../../../../lib/display-name";
import { snippet } from "../../../../lib/snippet";
import { ComposerStrip, TokenTag } from "./ComposerStrip";

function docName(ref: string | null): string {
  if (ref === null) return "Chat";
  return displayName(ref);
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
    <ComposerStrip>
      {selections.map((selection) => (
        <SelectionPill key={selection.id} selection={selection} onRemove={() => onRemove(selection.id)} />
      ))}
    </ComposerStrip>
  );
}

function SelectionPill({
  selection,
  onRemove,
}: {
  selection: SelectionItem;
  onRemove: () => void;
}) {
  return (
    <div className="relative group" data-bbx-source={`selection-${selection.id}`}>
      <Popover
        label={`Selection ${String(selection.id)} from ${docName(selection.ref)}`}
        vertical="above"
        trigger={({ toggle, ariaProps }) => (
          <button
            type="button"
            onClick={toggle}
            {...ariaProps}
            className="flex items-center gap-1.5 max-w-[16rem] rounded bg-warm-200 pl-1.5 pr-2 py-1 hover:ring-2 hover:ring-accent focus:outline-none focus:ring-2 focus:ring-accent"
            title="Click to view the selected text"
          >
            <TokenTag>{`selection#${String(selection.id)}`}</TokenTag>
            <span className="text-xs text-warm-700 truncate">“{snippet(selection.text, 32)}”</span>
          </button>
        )}
      >
        <div className="text-xs font-medium text-warm-800 truncate" title={selection.ref ?? undefined}>{docName(selection.ref)}</div>
        {selection.position === "" ? null : (
          <div className="text-[0.6875rem] text-warm-700 mt-0.5 break-words">{selection.position}</div>
        )}
        <div className="mt-1 pt-1 border-t border-warm-200 text-sm text-warm-700 whitespace-pre-wrap">
          {selection.text}
        </div>
      </Popover>
      <CloseButton variant="bubble" label="Remove selection" onClick={onRemove} className="absolute -top-2 -right-2" />
    </div>
  );
}
