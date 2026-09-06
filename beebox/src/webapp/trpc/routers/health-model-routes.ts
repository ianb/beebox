/**
 * Health checks that have to ask "which route?" rather than "which key?".
 *
 * Both live here for the same reason: a service's own provider key always wins
 * and OpenRouter is the fallback (`core/openrouter.ts`), so a check that looks
 * for one named credential reports a working box as broken. `modelRoutesCheck`
 * makes the routing visible; `geminiKeyCheck` asks whether the model is
 * reachable at all.
 */

import { getGeminiApiKey } from "../../../core/gemini-key.js";
import { getOpenAiThinkingKey } from "../../../core/openai-thinking-key.js";
import { getOpenRouterKey, routeVia } from "../../../core/openrouter.js";
import { getOpenAiEmbeddingsKey } from "../../../core/search/embeddings-key.js";
import { hqRoutesThroughOpenRouter, isMaiHqService, loadTranscriptionConfig } from "../../../core/transcription/index.js";
import { loadTtsConfig } from "../../../core/tts/config.js";
import type { HealthCheck } from "./health.js";

/**
 * Which route each OpenRouter-capable service is on right now — the visible
 * half of a switch that otherwise happens silently in code
 * (`core/openrouter.ts`). Reported only when the box actually holds an
 * OpenRouter key: with no key there is nothing to disambiguate, and a line
 * saying every service is direct would be noise on every other box.
 *
 * Always `ok` — this states a fact, it does not judge one. Whether a service
 * can reach its model at all is the individual key checks' business. Returns a
 * list so the caller can splice in nothing at all on a box with no OpenRouter
 * key, where every service is direct and the line would be noise.
 */
export async function modelRoutesCheck(boxRoot: string): Promise<HealthCheck[]> {
  const openRouterKey = await getOpenRouterKey(boxRoot, { purpose: "health-check", observe: false });
  if (openRouterKey === null) return [];

  const hqService = (await loadTranscriptionConfig(boxRoot)).hqService;
  const geminiKey = await getGeminiApiKey(boxRoot, { purpose: "health-check", observe: false });

  const routes: Array<[string, string | null]> = [
    ["semantic search", await getOpenAiEmbeddingsKey(boxRoot, { observe: false })],
    ["audio questions", geminiKey],
  ];
  const lines: string[] = [];
  // Three different truths about HQ transcription, and conflating them would
  // mislead: MAI runs ONLY on OpenRouter, Voxtral runs only on Mistral, and the
  // Whisper family genuinely falls back.
  if (isMaiHqService(hqService)) {
    lines.push(`HQ transcription (${hqService}) → OpenRouter only; MAI is reachable no other way`);
  } else if (hqRoutesThroughOpenRouter(hqService)) {
    routes.push([`HQ transcription (${hqService})`, await getOpenAiThinkingKey(boxRoot, { observe: false })]);
  } else {
    lines.push(`HQ transcription (${hqService}) → Mistral only; OpenRouter cannot serve Voxtral`);
  }
  // TODO(env-migration): long-tail feature-gate var, direct read per src/lib/env.ts.
  if (process.env["BBX_SCAN_VISION"] === "gemini") routes.push(["scan vision", geminiKey]);
  // Speech is a chosen backend, not a fallback, so it reports the choice
  // rather than which key won: `gemini` reaches OpenRouter by definition.
  const ttsBackend = (await loadTtsConfig(boxRoot)).backend;
  if (ttsBackend === "gemini") {
    lines.push("speech (gemini) → OpenRouter only; chosen in the voice menu");
  } else {
    routes.push([`speech (${ttsBackend})`, await getOpenAiThinkingKey(boxRoot, { observe: false })]);
  }

  lines.unshift(...routes.map(([label, direct]) => `${label} → ${direct === null ? "OpenRouter" : "its own provider"}`));
  return [
    {
      name: "model-routes",
      ok: true,
      message: `OpenRouter key present; ${lines.join(", ")}`,
      severity: "warning",
    },
  ];
}

/**
 * Gemini reachability — the model behind audio questions (ask-about-audio) and
 * scan-import's opt-in Gemini backend (`BBX_SCAN_VISION=gemini`; scan-import
 * defaults to the Claude backend, which needs no extra key).
 *
 * This asks whether the model is REACHABLE, not whether one particular
 * credential exists, because the callers do the same: with no `gemini` key they
 * fall through to OpenRouter (`core/openrouter.ts`). Reporting "audio questions
 * will not work" on a box that answers them perfectly well would be a check
 * that lies. `model-routes` says which way it is reached.
 */
export async function geminiKeyCheck(boxRoot: string): Promise<HealthCheck> {
  const route = await routeVia({
    boxRoot,
    purpose: "health-check",
    directKey: await getGeminiApiKey(boxRoot, { purpose: "health-check", observe: false }),
    observe: false,
  });
  // TODO(env-migration): long-tail feature-gate var, direct read per src/lib/env.ts.
  const geminiSelected = process.env["BBX_SCAN_VISION"] === "gemini";
  const message =
    route !== null
      ? route.via === "direct"
        ? "Gemini API key configured"
        : "No Gemini key — audio questions and the Gemini scan backend go through OpenRouter"
      : geminiSelected
        ? 'BBX_SCAN_VISION=gemini but no key reaches the model — scan-import will fail. Grant the "gemini" or "openrouter" secret to this box'
        : 'No key reaches Gemini (optional) — audio questions will not work; scan-import uses the Claude backend by default. Grant the "gemini" or "openrouter" secret to change that';
  return {
    name: "gemini-api-key",
    ok: route !== null || !geminiSelected,
    message,
    severity: "warning",
  };
}
