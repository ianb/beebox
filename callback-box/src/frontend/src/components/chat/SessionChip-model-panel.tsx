/**
 * The session chip's "Model" sub-panel — moved here from `VoiceChip-panels.tsx`
 * in the chip polish round (docs/plans/chat-header-chips.md follow-up): Model
 * selection isn't a voice I/O concern. It rode along when `ChatMenu` became
 * `SessionChip` (docs/plans/top-nav-ia.md Track C2).
 *
 * Two actions per row, because there are two levels
 * (docs/plans/model-engine-policy.md): choosing a model sets **this chat's**
 * model, and pinning one sets the **box default** every chat that has not
 * chosen follows. They are separate controls because they mean different
 * things — a pin does not touch this conversation, and choosing here does not
 * speak for the box.
 */

import { MenuItem, MenuDivider } from "../ui/dropdown-menu-item";
import { chatModelOptions, type ChatAgentEngine } from "@shared/chat-models.js";

/** A pushpin, the box-default action's face. */
function PinIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      className="w-4 h-4"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 4h6l-1 6 4 3v2H6v-2l4-3-1-6Zm3 11v5" />
    </svg>
  );
}

/** "Model" sub-panel. */
export function ModelPanel({
  onBack,
  selectedModel,
  boxDefault,
  canPin,
  agentEngine,
  onSelectModel,
  onPinModel,
}: {
  /** This chat's own choice; `null` means it follows the box default. */
  selectedModel: string | null;
  /** The box default as this engine runs it, or `null` when nothing is pinned. */
  boxDefault: string | null;
  /** Whether this viewer may change box configuration. */
  canPin: boolean;
  onBack: () => void;
  agentEngine: ChatAgentEngine;
  onSelectModel: (model: string | null) => void;
  onPinModel: (model: string | null) => void;
}) {
  const options = chatModelOptions(agentEngine);
  const defaultLabel = boxDefault === null
    ? null
    : options.find((o) => o.model === boxDefault)?.label ?? boxDefault;
  return (
    <>
      <MenuItem id="cb-session-model-back" onClick={onBack} keepOpen>
        <span className="text-warm-500">‹ Model · {agentEngine === "claude" ? "Claude" : "Codex"}</span>
      </MenuItem>
      <MenuDivider />
      {options.map((opt) => {
        // The first row (`model: null`) is "follow the box default", so it
        // names what following currently gets you rather than claiming a model
        // of its own. It is also the one row that cannot be pinned: pinning
        // "no model" is what clearing the pin means, offered below.
        const follows = opt.model === null;
        const label = follows && defaultLabel !== null ? `Default · ${defaultLabel}` : opt.label;
        const pinned = !follows && opt.model === boxDefault;
        return (
          <div key={opt.label} role="none" className="flex items-stretch">
            <MenuItem onClick={() => onSelectModel(opt.model)}>
              <span className="flex justify-between gap-2 w-full">
                <span>{selectedModel === opt.model ? "✓ " : "  "}{label}</span>
                {pinned ? <span className="text-warm-500 text-xs self-center">default</span> : null}
              </span>
            </MenuItem>
            {canPin && !follows ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => { onPinModel(opt.model); }}
                aria-label={pinned ? `${opt.label} is the box default` : `Pin ${opt.label} as the box default`}
                className="px-2 text-warm-400 hover:text-warm-700 hover:bg-warm-50 transition-colors"
              >
                <PinIcon filled={pinned} />
              </button>
            ) : null}
          </div>
        );
      })}
      {canPin && boxDefault !== null ? (
        <>
          <MenuDivider />
          <MenuItem id="cb-session-model-unpin" onClick={() => { onPinModel(null); }} keepOpen>
            <span className="text-warm-500">Clear the box default</span>
          </MenuItem>
        </>
      ) : null}
    </>
  );
}
