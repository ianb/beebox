/**
 * The session chip's "Model" sub-panel — moved here from `VoiceChip-panels.tsx`
 * in the chip polish round (docs/plans/chat-header-chips.md follow-up): Model
 * selection isn't a voice I/O concern. It rode along when `ChatMenu` became
 * `SessionChip` (docs/plans/top-nav-ia.md Track C2).
 */

import { MenuItem, MenuDivider } from "../ui/dropdown-menu-item";
import { chatModelOptions, type ChatAgentEngine } from "@shared/chat-models.js";

/** "Model" sub-panel. */
export function ModelPanel({
  onBack,
  selectedModel,
  agentEngine,
  onSelectModel,
}: {
  onBack: () => void;
  selectedModel: string | null;
  agentEngine: ChatAgentEngine;
  onSelectModel: (model: string | null) => void;
}) {
  return (
    <>
      <MenuItem onClick={onBack} keepOpen>
        <span className="text-warm-500">‹ Model · {agentEngine === "claude" ? "Claude" : "Codex"}</span>
      </MenuItem>
      <MenuDivider />
      {chatModelOptions(agentEngine).map((opt) => (
        <MenuItem key={opt.label} onClick={() => onSelectModel(opt.model)}>
          {selectedModel === opt.model ? "✓ " : "  "}{opt.label}
        </MenuItem>
      ))}
    </>
  );
}
