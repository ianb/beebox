/** Resolve which native harness owns a session used by diagnostic CLI commands. */

import { AGENT_ENGINES, isAgentEngine, type AgentEngine } from "../../shared/agent-models.js";
import { loadHistoryEntries } from "../../core/chat/session/history.js";

class InvalidDiagnosticEngineError extends Error {
  constructor(value: string) {
    super(`Unknown session engine "${value}". Expected ${AGENT_ENGINES.join(", ")}.`);
    this.name = "InvalidDiagnosticEngineError";
  }
}

const NATIVE_DETAIL_GAP: Record<"codex" | "pi", string> = {
  codex: "Codex sessions support readable dialogue only; --raw, --tool-report, and --full require native rollout detail that app-server does not expose.",
  pi: "pi sessions support readable dialogue only; --raw, --tool-report, and --full read Claude Code transcript detail, which pi does not write.",
};

class UnsupportedNativeSessionModeError extends Error {
  constructor(engine: "codex" | "pi") {
    super(NATIVE_DETAIL_GAP[engine]);
    this.name = "UnsupportedNativeSessionModeError";
  }
}

export function parseDiagnosticEngine(value: string): AgentEngine {
  if (isAgentEngine(value)) return value;
  throw new InvalidDiagnosticEngineError(value);
}

export function validateNativeSessionMode(engine: "codex" | "pi", options: {
  raw: boolean;
  toolReport: boolean;
  full: boolean;
}): void {
  if (options.raw || options.toolReport || options.full) {
    throw new UnsupportedNativeSessionModeError(engine);
  }
}

/**
 * Explicit selection wins. The current Codex identity comes next, followed by
 * the engine pinned to a Bee Box web chat. Unknown IDs retain the legacy
 * Claude interpretation.
 */
export async function resolveDiagnosticEngine(options: {
  boxRoot: string;
  sessionId: string;
  requestedEngine: AgentEngine | undefined;
  codexThreadId: string | undefined;
}): Promise<AgentEngine> {
  if (options.requestedEngine !== undefined) return options.requestedEngine;
  if (options.codexThreadId === options.sessionId) return "codex";
  const history = await loadHistoryEntries(options.boxRoot);
  return history.find((entry) => entry.id === options.sessionId)?.engine ?? "claude";
}
