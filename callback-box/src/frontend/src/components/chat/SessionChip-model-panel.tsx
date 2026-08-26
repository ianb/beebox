/**
 * The session chip's "Model" sub-panel — moved here from `VoiceChip-panels.tsx`
 * in the chip polish round (docs/plans/chat-header-chips.md follow-up): Model
 * selection isn't a voice I/O concern. It rode along when `ChatMenu` became
 * `SessionChip` (docs/plans/top-nav-ia.md Track C2).
 *
 * Three things are chosen here, at different times
 * (docs/plans/model-engine-policy.md):
 *
 * - **This chat's model** — any time. Selecting a row sets it.
 * - **This chat's engine** — only before the first message. A chat's engine is
 *   fixed at birth: transcripts live in different stores per engine and models
 *   are engine-scoped, so a mid-chat switch would silently change two things at
 *   once. Picking a model under another engine's heading is how you choose it.
 * - **The box default** — the pin beside a row, owner only. A pin is a
 *   statement about the box, not an instruction to this conversation.
 */

import { MenuItem, MenuDivider } from "../ui/dropdown-menu-item";
import { chatModelOptions, type ChatAgentEngine } from "@shared/chat-models.js";

const ENGINE_NAMES: Record<ChatAgentEngine, string> = { claude: "Claude", codex: "Codex" };

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

export interface ModelPanelProps {
  onBack: () => void;
  /** This chat's own choice; `null` means it follows the box default. */
  selectedModel: string | null;
  /** The box default as this chat's engine runs it, or `null` when unpinned. */
  boxDefault: string | null;
  /** Whether this viewer may change box configuration. */
  canPin: boolean;
  /** This chat's engine, fixed at its birth. */
  agentEngine: ChatAgentEngine;
  /** Engines this box may offer, and the one it defaults to. */
  enabledEngines: ChatAgentEngine[];
  boxEngine: ChatAgentEngine;
  /** Whether this chat can still choose its engine — true until its first message. */
  canChooseEngine: boolean;
  /** Set this chat's model, within its own engine. */
  onSelectModel: (model: string | null) => void;
  /** Start this chat on another engine (and model). Pre-first-message only. */
  onChooseStart: (choice: { engine: ChatAgentEngine; model: string }) => void;
  /** Set the box default. */
  onPinModel: (model: string | null) => void;
}

/** One engine's heading plus its models, or the reason it has none to show. */
function EngineSection(props: ModelPanelProps & { engine: ChatAgentEngine }) {
  const { engine, agentEngine, boxEngine, enabledEngines, canChooseEngine, boxDefault, canPin, selectedModel } = props;
  const isOwn = engine === agentEngine;
  const enabled = enabledEngines.includes(engine);
  const heading = (
    <div role="none" className="px-3 pt-2 pb-1 flex justify-between gap-2">
      <span className="text-xs uppercase tracking-wide text-warm-500">{ENGINE_NAMES[engine]}</span>
      {engine === boxEngine ? <span className="text-xs text-warm-400">default</span> : null}
    </div>
  );

  // Not enabled, or this chat is past the point of choosing: the heading stays
  // and says why. Listing models nobody can pick would be noise, and dropping
  // the heading would leave the absence unexplained.
  if (!enabled || (!isOwn && !canChooseEngine)) {
    return (
      <>
        {heading}
        <div role="none" className="px-3 pb-2 text-xs text-warm-400">
          {enabled ? "fixed when this chat started" : "not enabled for this box"}
        </div>
      </>
    );
  }

  return (
    <>
      {heading}
      {chatModelOptions(engine).map((opt) => {
        const model = opt.model;
        if (model === null) return null;
        // Pinning is confined to the box's own engine: the pin writes one
        // box-wide model that other engines resolve by tier, so pinning
        // another engine's model would quietly mean something else here.
        const pinned = isOwn && model === boxDefault;
        const showPin = canPin && engine === boxEngine;
        return (
          <div key={opt.label} role="none" className="flex items-stretch">
            <div role="none" className="flex-1 min-w-0">
              <MenuItem
                onClick={() => {
                  if (isOwn) props.onSelectModel(model);
                  else props.onChooseStart({ engine, model });
                }}
              >
                <span className="flex justify-between gap-2 w-full">
                  <span>{isOwn && selectedModel === model ? "✓ " : "  "}{opt.label}</span>
                  {pinned ? <span className="text-warm-500 text-xs self-center">default</span> : null}
                </span>
              </MenuItem>
            </div>
            {showPin ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => { props.onPinModel(model); }}
                aria-label={pinned ? `${opt.label} is the box default` : `Pin ${opt.label} as the box default`}
                className="px-2 text-warm-400 hover:text-warm-700 hover:bg-warm-50 transition-colors"
              >
                <PinIcon filled={pinned} />
              </button>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

/** "Model" sub-panel. */
export function ModelPanel(props: ModelPanelProps) {
  const { onBack, selectedModel, boxDefault, canPin, agentEngine, enabledEngines, boxEngine } = props;
  const defaultLabel = boxDefault === null
    ? null
    : chatModelOptions(agentEngine).find((o) => o.model === boxDefault)?.label ?? boxDefault;
  // This chat's own engine leads — it is the section the chat can always act
  // on — then the box's default, then anything else.
  const order = [...new Set<ChatAgentEngine>([agentEngine, boxEngine, ...enabledEngines, "claude", "codex"])];
  return (
    <>
      <MenuItem id="cb-session-model-back" onClick={onBack} keepOpen>
        <span className="text-warm-500">‹ Model</span>
      </MenuItem>
      <MenuDivider />
      <MenuItem onClick={() => props.onSelectModel(null)}>
        <span>{selectedModel === null ? "✓ " : "  "}{defaultLabel === null ? "Default" : `Default · ${defaultLabel}`}</span>
      </MenuItem>
      {order.map((engine) => <EngineSection key={engine} {...props} engine={engine} />)}
      {canPin && boxDefault !== null ? (
        <>
          <MenuDivider />
          <MenuItem id="cb-session-model-unpin" onClick={() => { props.onPinModel(null); }} keepOpen>
            <span className="text-warm-500">Clear the box default</span>
          </MenuItem>
        </>
      ) : null}
    </>
  );
}
