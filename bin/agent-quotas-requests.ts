/**
 * The two live quota reads: Claude through the Agent SDK's experimental
 * structured usage control request, Codex through its app-server protocol.
 * Split out of `agent-quotas.ts`; parsing lives in `agent-quotas-parse.ts`,
 * caching and fan-out in `agent-quotas-collect.ts`.
 */

import { spawn } from "node:child_process";
import readline from "node:readline";

import type {
  ClaudeUsageResult,
  CodexRateLimitResult,
} from "./agent-quotas-parse.js";
import { codexRateLimitResult, isRecord } from "./agent-quotas-parse.js";

/** The installed Agent SDK predates the experimental usage control request. */
class SdkUsageUnsupportedError extends Error {
  constructor() {
    super("Installed Claude Agent SDK does not expose quota usage.");
    this.name = "SdkUsageUnsupportedError";
  }
}

/** The Claude usage request did not answer inside its timeout. */
class ClaudeQuotaTimeoutError extends Error {
  constructor() {
    super("Claude quota request timed out");
    this.name = "ClaudeQuotaTimeoutError";
  }
}

/** The Codex app server did not answer the rate-limit read inside its timeout. */
class CodexQuotaTimeoutError extends Error {
  constructor() {
    super("Codex quota request timed out");
    this.name = "CodexQuotaTimeoutError";
  }
}

export async function requestClaudeUsage(
  timeoutMsArg?: number,
): Promise<ClaudeUsageResult> {
  const timeoutMs = timeoutMsArg ?? 15_000;
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const abortController = new AbortController();
  // The prompt stream deliberately never produces a message: it exists only to
  // hold the session open (as an AsyncIterable, which is what `query` takes)
  // until the abort below ends it. There is nothing to yield.
  // eslint-disable-next-line require-yield -- the SDK requires an AsyncIterable prompt; this one is intentionally message-free, so a `yield` here would send a turn we do not want.
  async function* idleInput(): AsyncGenerator<never, void> {
    await new Promise<void>((resolve) => {
      abortController.signal.addEventListener("abort", () => resolve(), {
        once: true,
      });
    });
  }
  const session = query({
    prompt: idleInput(),
    options: {
      abortController,
      cwd: process.cwd(),
      settingSources: [],
    },
  });
  if (
    typeof session.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET !==
    "function"
  ) {
    abortController.abort();
    session.close();
    throw new SdkUsageUnsupportedError();
  }
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    abortController.abort();
    session.close();
  }, timeoutMs);
  try {
    await session.initializationResult();
    return await session.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET();
  } catch (error) {
    if (timedOut) throw new ClaudeQuotaTimeoutError();
    throw error;
  } finally {
    clearTimeout(timeout);
    abortController.abort();
    session.close();
  }
}

export async function requestCodexRateLimits(
  timeoutMsArg?: number,
  commandArg?: string,
): Promise<CodexRateLimitResult> {
  const timeoutMs = timeoutMsArg ?? 5_000;
  const command = commandArg ?? "codex";
  return await new Promise((resolve, reject) => {
    const child = spawn(command, ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines = readline.createInterface({ input: child.stdout });
    let stderr = "";
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;
    const finish = (error?: Error, value?: CodexRateLimitResult) => {
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
    const send = (message: object) => {
      try {
        child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
          if (error) finish(error);
        });
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    };
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.stdin.on("error", (error) => finish(error));
    child.on("error", (error) => finish(error));
    child.on("exit", (code) => {
      if (killTimer) clearTimeout(killTimer);
      if (!settled)
        finish(
          new Error(stderr.trim() || `Codex app server exited ${String(code)}`),
        );
    });
    lines.on("line", (line) => {
      let message: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(line);
        if (!isRecord(parsed)) return;
        message = parsed;
      } catch (_e) {
        return;
      }
      if (message.id === 0) {
        if (isRecord(message.error)) {
          finish(
            new Error(
              typeof message.error.message === "string"
                ? message.error.message
                : "Codex initialization failed",
            ),
          );
          return;
        }
        send({ method: "initialized", params: {} });
        send({ method: "account/rateLimits/read", id: 1, params: {} });
      } else if (message.id === 1) {
        if (isRecord(message.error))
          finish(
            new Error(
              typeof message.error.message === "string"
                ? message.error.message
                : "Codex quota request failed",
            ),
          );
        else finish(undefined, codexRateLimitResult(message.result));
      }
    });
    const timer = setTimeout(
      () => finish(new CodexQuotaTimeoutError()),
      timeoutMs,
    );
    send({
      method: "initialize",
      id: 0,
      params: {
        clientInfo: {
          name: "bbx_workstreams",
          title: "Bee Box Workstreams",
          version: "1",
        },
      },
    });
  });
}
