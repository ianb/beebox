/**
 * "Can this box actually use service X right now" — the question the
 * HQ-transcription and TTS pickers need answered so they can mark an option
 * unavailable instead of offering a choice whose only outcome is a failed
 * pass (`docs/plans/secret-entry-guidance.md`, Track 5).
 *
 * **The truth table below MIRRORS the dispatchers and MUST change with
 * them.** It is not derived by calling into `transcription/index.ts` or
 * `tts/resolve.ts` — those modules also try to spend the credential, and a
 * capability probe should never do that — so the same key-per-service facts
 * are restated here by hand:
 *
 * - `transcription/index.ts`'s `dispatchHqTranscription`: the Whisper family
 *   (`whisper`, `whisper-llm`, `whisper-llm-mini`) routes through
 *   `routeVia`, which prefers `openai-thinking` and falls back to
 *   `openrouter` — so either key makes those three usable. `voxtral` /
 *   `voxtral-diarized` never route through OpenRouter
 *   (`hqRoutesThroughOpenRouter`) and need `mistral` alone. `mai` /
 *   `mai-diarized` (`isMaiHqService`) have no direct arm at all and need
 *   `openrouter` alone.
 * - `tts/resolve.ts`'s `credentialFor`: `openai` needs `openai-thinking`
 *   alone (no OpenRouter fallback — no OpenAI speech model exists there);
 *   `gemini` needs `openrouter` alone.
 *
 * Each underlying key is resolved at most once and reused across every
 * service it backs. Every resolve passes `observe: false` — this is a status
 * probe, not a use (see `resolveSecret`'s `observe` option doc): it must not
 * move `lastUsed`/`purposes` store metadata the way a real transcription or
 * TTS call does.
 */

import { getMistralApiKey } from "./mistral-key.js";
import { getOpenAiThinkingKey } from "./openai-thinking-key.js";
import { getOpenRouterKey } from "./openrouter.js";
import type { HqTranscriptionService } from "../shared/transcription-services.js";
import type { TtsBackend } from "../shared/tts-backends.js";

/** Short label for the access log — this module never spends a key, only checks it. */
const CAPABILITY_PROBE_PURPOSE = "capability-check";

export interface ServiceCapability {
  usable: boolean;
  /** Secret names that would make this service usable if granted. */
  needs: string[];
}

export interface ServiceCapabilities {
  hq: Record<HqTranscriptionService, ServiceCapability>;
  tts: Record<TtsBackend, ServiceCapability>;
}

function capability(usable: boolean, needs: string[]): ServiceCapability {
  return { usable, needs };
}

/**
 * For every HQ transcription service and every TTS backend, whether the box
 * currently holds a credential that reaches it, and which secret(s) would
 * make it usable otherwise.
 */
export async function serviceCapabilities(boxRoot: string): Promise<ServiceCapabilities> {
  const [openAiThinkingKey, mistralKey, openRouterKey] = await Promise.all([
    getOpenAiThinkingKey(boxRoot, { observe: false }),
    getMistralApiKey(boxRoot, { observe: false }),
    getOpenRouterKey(boxRoot, { purpose: CAPABILITY_PROBE_PURPOSE, observe: false }),
  ]);
  const hasOpenAiThinking = openAiThinkingKey !== null;
  const hasMistral = mistralKey !== null;
  const hasOpenRouter = openRouterKey !== null;

  const whisperFamily = capability(hasOpenAiThinking || hasOpenRouter, ["openai-thinking", "openrouter"]);
  const voxtralFamily = capability(hasMistral, ["mistral"]);
  const maiFamily = capability(hasOpenRouter, ["openrouter"]);

  const hq: Record<HqTranscriptionService, ServiceCapability> = {
    whisper: whisperFamily,
    "whisper-llm": whisperFamily,
    "whisper-llm-mini": whisperFamily,
    voxtral: voxtralFamily,
    "voxtral-diarized": voxtralFamily,
    mai: maiFamily,
    "mai-diarized": maiFamily,
  };
  // `Record<HqTranscriptionService, ServiceCapability>` above already forces
  // every member of HQ_TRANSCRIPTION_SERVICES to have an entry at compile
  // time — a service added to the shared vocabulary without a matching line
  // here fails typechecking, not just this comment.

  const tts: Record<TtsBackend, ServiceCapability> = {
    openai: capability(hasOpenAiThinking, ["openai-thinking"]),
    gemini: capability(hasOpenRouter, ["openrouter"]),
  };

  return { hq, tts };
}

/**
 * The line a set-mutation returns when the boxholder chose a service the box
 * cannot reach yet. Null when it can. Saving is still allowed — a key may be
 * granted later — but the client must show this, so the choice is never
 * silently impossible (the issue's floor: a warning the boxholder sees).
 */
export function unusableWarning(service: string, state: ServiceCapability): string | null {
  if (state.usable) return null;
  const which = state.needs.length === 1 ? state.needs[0] : state.needs.join(" or ");
  return `This box has no key for ${service} yet; grant ${which} in Admin → Secrets or it will fail on every pass.`;
}
