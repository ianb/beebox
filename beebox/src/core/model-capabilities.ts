/**
 * "Can this box actually use service X right now" — the question the
 * HQ-transcription and TTS pickers need answered so they can mark an option
 * unavailable instead of offering a choice whose only outcome is a failed
 * pass (`docs/implemented-plans/secret-entry-guidance.md`, Track 5).
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
 * - `tts/resolve.ts`'s `resolveTtsService`: `openai` needs `openai-thinking`
 *   alone (no OpenRouter fallback — no OpenAI speech model exists there);
 *   `gemini` needs `gemini` alone (OpenRouter serves the model but cannot
 *   carry style direction to it, so it is deliberately not a fallback).
 *
 * Each underlying key is checked at most once and reused across every
 * service it backs. The check is `secretIsResolvable`: this is a status probe,
 * not a use, so it reads no value, writes no access-log line, and does not move
 * `lastUsed`/`purposes` store metadata the way a real transcription or TTS call
 * does.
 */

import { GEMINI_SECRET_NAME } from "./gemini-key.js";
import { MISTRAL_SECRET_NAME } from "./mistral-key.js";
import { OPENAI_THINKING_SECRET_NAME } from "./openai-thinking-key.js";
import { OPENROUTER_SECRET_NAME } from "./openrouter.js";
import { secretIsResolvable } from "./secrets/resolve.js";
import type { HqTranscriptionService } from "../shared/transcription-services.js";
import type { TtsBackend } from "../shared/tts-backends.js";

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
  const has = (name: string) => secretIsResolvable({ boxRoot, name, access: "server" });
  const [hasOpenAiThinking, hasMistral, hasOpenRouter, hasGemini] = await Promise.all([
    has(OPENAI_THINKING_SECRET_NAME),
    has(MISTRAL_SECRET_NAME),
    has(OPENROUTER_SECRET_NAME),
    has(GEMINI_SECRET_NAME),
  ]);

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
    gemini: capability(hasGemini, ["gemini"]),
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
