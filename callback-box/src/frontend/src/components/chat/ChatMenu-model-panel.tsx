/**
 * `ChatMenu`'s "Model" sub-panel — moved here from `VoiceChip-panels.tsx` in
 * the chip polish round (docs/plans/chat-header-chips.md follow-up): Model
 * selection isn't a voice I/O concern, so it lives in the "..." menu now.
 */

import { MenuItem, MenuDivider } from "../ui/dropdown-menu-item";
import { MODEL_OPTIONS } from "./InteractiveChat-helpers";

/** "Model" sub-panel. */
export function ModelPanel({
  onBack,
  selectedModel,
  onSelectModel,
}: {
  onBack: () => void;
  selectedModel: string | null;
  onSelectModel: (model: string | null) => void;
}) {
  return (
    <>
      <MenuItem onClick={onBack} keepOpen>
        <span className="text-warm-500">‹ Model</span>
      </MenuItem>
      <MenuDivider />
      {MODEL_OPTIONS.map((opt) => (
        <MenuItem key={opt.label} onClick={() => onSelectModel(opt.model)}>
          {selectedModel === opt.model ? "✓ " : "  "}{opt.label}
        </MenuItem>
      ))}
    </>
  );
}
