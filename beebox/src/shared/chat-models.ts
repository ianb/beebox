import { MODEL_ID } from "./model-ids.js";
import type { AgentEngine } from "./agent-models.js";

export type ChatAgentEngine = AgentEngine;

export interface ChatModelOption {
  label: string;
  model: string | null;
}

/**
 * An OpenRouter model the box owner added in admin (`openrouterModels` in box
 * config). These bill per use, so they exist only by that act: the static
 * menu below never lists one, and a key alone offers nothing
 * (`docs/plans/openrouter-chat-models.md`).
 */
export interface AddedModel {
  /** OpenRouter's own id, sent to it verbatim — `author/slug[:variant]`. */
  id: string;
  /** What the picker shows. Display only; never sent. */
  label: string;
}

/** Longest label admin accepts — a picker row, not a description. */
export const ADDED_MODEL_LABEL_MAX = 60;

const OPENROUTER_ID = /^[\d._a-z-]+\/[\d._a-z-]+(?::[\d._a-z-]+)?$/;

/**
 * True for an id shaped like an OpenRouter model. No first-party, Codex, or
 * GLM id contains a slash, so the slash alone identifies the provider;
 * `providerOf` applies the same rule, and this stricter form validates input.
 */
export function isOpenRouterModelId(model: string): boolean {
  return OPENROUTER_ID.test(model);
}

/** Validate an engine value crossing a runtime/API boundary. */
export function parseChatAgentEngine(value: unknown): ChatAgentEngine | null {
  return value === "claude" || value === "codex" ? value : null;
}

const OPTIONS: Record<ChatAgentEngine, readonly ChatModelOption[]> = {
  // Strongest first, under the default — the same order the codex list already
  // used. The claude list used to run weakest-first, so the two engines' menus
  // disagreed and Haiku sat at the top of one of them.
  claude: [
    { label: "Default (Opus)", model: null },
    { label: "Fable 5.1", model: MODEL_ID.fable },
    { label: "Opus 5", model: MODEL_ID.opus },
    // GLM rides the claude engine via Z.ai's Anthropic-compatible endpoint;
    // a box without a granted `glm` key fails the turn with the setup refusal.
    { label: "GLM 5.3", model: MODEL_ID.glm },
    { label: "GLM 5.3 Flash", model: MODEL_ID.glmFlash },
    { label: "Sonnet 5", model: MODEL_ID.sonnet },
    { label: "Haiku 4.5", model: MODEL_ID.haiku },
  ],
  codex: [
    { label: "Default (Codex)", model: null },
    { label: "Astra", model: MODEL_ID.astra },
    { label: "Sol", model: MODEL_ID.sol },
    { label: "Terra", model: MODEL_ID.terra },
    { label: "Luna", model: MODEL_ID.luna },
  ],
};

/**
 * The models a chat on this engine may pick: the static menu, then the box's
 * added OpenRouter models (claude engine only — they ride its Anthropic-shaped
 * transport). `added` is required so no caller can forget the box's list and
 * silently refuse a model the owner added.
 */
export function chatModelOptions(engine: ChatAgentEngine, added: readonly AddedModel[]): readonly ChatModelOption[] {
  if (engine !== "claude" || added.length === 0) return OPTIONS[engine];
  return [...OPTIONS.claude, ...added.map((m) => ({ label: m.label, model: m.id }))];
}

export function isChatModelAllowed(
  engine: ChatAgentEngine,
  { model, added }: { model: string | null; added: readonly AddedModel[] },
): boolean {
  return chatModelOptions(engine, added).some((option) => option.model === model);
}

/**
 * The picker label for a model, or null when this engine does not offer it.
 * An OpenRouter pick the owner has since removed still gets a name — the chat
 * keeps it (see {@link chatModelForEngine}), so the chip must say what it is
 * rather than "Unavailable".
 */
export function chatModelLabel(
  engine: ChatAgentEngine,
  { model, added }: { model: string | null; added: readonly AddedModel[] },
): string | null {
  const label = chatModelOptions(engine, added).find((o) => o.model === model)?.label;
  if (label !== undefined) return label;
  if (model !== null && engine === "claude" && isOpenRouterModelId(model)) return `${model} (removed in admin)`;
  return null;
}

/**
 * Ignore a persisted model that belongs to a different native harness.
 *
 * An OpenRouter pick on a claude chat is kept even when the owner has since
 * removed it from admin: the chat asked for that model, and quietly following
 * the box default instead would change who answers. The spawn refuses it with
 * a message naming the fix (`core/provider-env.ts`).
 */
export function chatModelForEngine(engine: ChatAgentEngine, model: string | null): string | null {
  if (model !== null && engine === "claude" && isOpenRouterModelId(model)) return model;
  return isChatModelAllowed(engine, { model, added: [] }) ? model : null;
}
