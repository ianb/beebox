/**
 * Reactor — orchestrates the sync → process jobs → finalize cycle.
 *
 * See DESIGN.md in this directory for the full flow and rationale.
 */

export { runReactor } from "./engine.js";
export type { ReactorOptions, ReactorResult } from "./engine.js";
export { buildReactorSystemPrompt, buildReactorUserPrompt } from "./prompts.js";
