import { spawn } from "node:child_process";
import readline from "node:readline";

import {
  codexRateLimitResult,
  isRecord,
  type ClaudeUsageResult,
  type CodexRateLimitResult,
} from "./quota-parse.js";

class QuotaRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuotaRequestError";
  }
}

function requestError(message: string): QuotaRequestError {
  return new QuotaRequestError(message);
}

export async function requestClaudeUsage(timeoutMs: number): Promise<ClaudeUsageResult> {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const abortController = new AbortController();
  async function* idleInput(): AsyncGenerator<never, void> {
    const empty: never[] = [];
    yield* empty;
    await new Promise<void>((resolve) => {
      abortController.signal.addEventListener("abort", () => resolve(), { once: true });
    });
  }
  const session = query({ prompt: idleInput(), options: { abortController, cwd: process.cwd(), settingSources: [] } });
  if (typeof session.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET !== "function") {
    abortController.abort();
    session.close();
    throw requestError("Installed Claude Agent SDK does not expose quota usage.");
  }
  const timeoutFailure = requestError("Claude quota request timed out");
  const timeout = setTimeout(() => {
    abortController.abort(timeoutFailure);
    session.close();
  }, timeoutMs);
  try {
    await session.initializationResult();
    return await session.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET();
  } catch (error) {
    if (abortController.signal.reason === timeoutFailure) throw timeoutFailure;
    throw error;
  } finally {
    clearTimeout(timeout);
    abortController.abort();
    session.close();
  }
}

export async function requestCodexRateLimits(
  timeoutMs: number,
  command: string,
): Promise<CodexRateLimitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ["app-server"], { stdio: ["pipe", "pipe", "pipe"] });
    const lines = readline.createInterface({ input: child.stdout });
    let stderr = "";
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;
    const finish = (error?: Error, value?: CodexRateLimitResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      lines.close();
      child.stdin.destroy();
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 1_000);
      killTimer.unref();
      if (error) reject(error);
      else resolve(value ?? {});
    };
    const send = (message: object): void => {
      try {
        child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
          if (error) finish(error);
        });
      } catch (error) {
        finish(error instanceof Error ? error : requestError(String(error)));
      }
    };
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.stdin.on("error", (error) => finish(error));
    child.on("error", (error) => finish(error));
    child.on("exit", (code) => {
      if (killTimer) clearTimeout(killTimer);
      if (!settled) finish(requestError(stderr.trim() || `Codex app server exited ${String(code)}`));
    });
    lines.on("line", (line) => {
      let message: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(line);
        if (!isRecord(parsed)) return;
        message = parsed;
      } catch (_error) {
        return;
      }
      if (message.id === 0) {
        if (isRecord(message.error)) {
          finish(requestError(typeof message.error.message === "string" ? message.error.message : "Codex initialization failed"));
        } else {
          send({ method: "initialized", params: {} });
          send({ method: "account/rateLimits/read", id: 1, params: {} });
        }
      } else if (message.id === 1) {
        if (isRecord(message.error)) {
          finish(requestError(typeof message.error.message === "string" ? message.error.message : "Codex quota request failed"));
        } else {
          finish(undefined, codexRateLimitResult(message.result));
        }
      }
    });
    const timer = setTimeout(() => finish(requestError("Codex quota request timed out")), timeoutMs);
    send({
      method: "initialize", id: 0,
      params: { clientInfo: { name: "callback_box_workstreams", title: "Callback Box Workstreams", version: "1" } },
    });
  });
}
