/**
 * Presentational sub-view for {@link GmailFiltersSection}: the label chip
 * list and add-label control. Split out to keep the parent under the
 * per-file line budget.
 */

import { TextField } from "../ui/fields";
import { Button } from "../ui/Button";

interface GmailLabelListProps {
  labels: string[];
  newLabel: string;
  busy: boolean;
  onNewLabelChange: (value: string) => void;
  onAdd: () => void;
  onRemove: (label: string) => void;
}

export function GmailLabelList({
  labels,
  newLabel,
  busy,
  onNewLabelChange,
  onAdd,
  onRemove,
}: GmailLabelListProps) {
  return (
      <div className="mb-4">
      {/* Heading for the label-chips group below, not a control label — the
          actual input ("Add label") carries its own associated label. */}
      <p className="block text-sm font-medium text-warm-700 mb-2">
        Labels (OR-joined when no query is set)
      </p>
      {labels.length > 0 ? (
        <div className="mb-2 space-y-2">
          {labels.map((label) => (
            <div
              key={label}
              className="flex items-center gap-2 p-2 bg-warm-50 border border-warm-200 rounded text-sm"
            >
              <span className="flex-1 text-warm-800">{label}</span>
              <button
                onClick={() => onRemove(label)}
                disabled={busy}
                className="text-warm-500 hover:text-danger-dark text-xs px-2"
              >
                remove
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="mb-2 p-3 bg-warm-50 border border-warm-200 rounded text-sm text-warm-600">
          No labels configured.
        </div>
      )}
      <div className="flex gap-2 items-start">
        <TextField
          id="bbx-admin-gmail-new-label"
          label="Add label"
          hideLabel
          value={newLabel}
          onChange={onNewLabelChange}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onAdd();
            }
          }}
          placeholder="inbox"
          className="flex-1"
        />
        <Button
          id="bbx-admin-gmail-add-label"
          intent="secondary"
          onClick={onAdd}
          disabled={!newLabel.trim()}
        >
          Add
        </Button>
      </div>
    </div>
  );
}
