/** Resolve which native harness owns a session used by diagnostic CLI commands. */

import type { AgentEngine } from "../../core/box/config.js";
import { loadHistoryEntries } from "../../core/chat/session/history.js";

class InvalidDiagnosticEngineError extends Error {
  constructor(value: string) {
    super(`Unknown session engine "${value}". Expected claude or codex.`);
    this.name = "InvalidDiagnosticEngineError";
  }
}

class UnsupportedCodexSessionModeError extends Error {
  constructor() {
    super(
      "Codex sessions support readable dialogue only; --raw, --tool-report, and --full require native rollout detail that app-server does not expose.",
    );
    this.name = "UnsupportedCodexSessionModeError";
  }
}

export function parseDiagnosticEngine(value: string): AgentEngine {
  if (value === "claude" || value === "codex") return value;
  throw new InvalidDiagnosticEngineError(value);
}

export function validateCodexSessionMode(options: {
  raw: boolean;
  toolReport: boolean;
  full: boolean;
}): void {
  if (options.raw || options.toolReport || options.full) {
    throw new UnsupportedCodexSessionModeError();
  }
}

/**
 * Explicit selection wins. The current Codex identity comes next, followed by
 * the engine pinned to a Callback Box web chat. Unknown IDs retain the legacy
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
