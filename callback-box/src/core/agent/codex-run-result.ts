import type { AgentResult, AgentResultBase } from "./types.js";
import {
  CodexAppServerTimeoutError,
  CodexRpcError,
} from "../../services/codex-app-server.js";

export function codexRunErrorText(error: unknown): string {
  if (error instanceof CodexRpcError) {
    return `${error.message}: ${error.method}: ${error.rpcMessage}`;
  }
  if (error instanceof CodexAppServerTimeoutError) {
    return `${error.message}: ${error.operation}`;
  }
  return error instanceof Error ? error.message : String(error);
}

export function resultFromCodexTurn(options: {
  threadId: string;
  output: string;
  resultText: string;
  status: "completed" | "interrupted" | "failed";
  structuredOutput?: unknown;
}): AgentResult {
  const base: AgentResultBase = {
    output: options.output,
    resultText: options.resultText,
    exitCode: options.status === "completed" ? 0 : 1,
    sessionId: options.threadId,
    structuredOutput: options.structuredOutput,
  };
  if (options.status === "completed") return { ...base, success: true };
  return {
    ...base,
    success: false,
    error: options.status === "interrupted" ? "Codex turn was interrupted" : "Codex turn failed",
  };
}
