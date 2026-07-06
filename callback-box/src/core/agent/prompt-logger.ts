/**
 * Optional claude-code-logger proxy that captures full API traffic.
 *
 * When `CB_LOG_PROMPTS=1`, the agent run points `ANTHROPIC_BASE_URL` at this
 * local proxy so every request/response (including system prompts and
 * CLAUDE.md content) is written to `.callback-box/logs/`.
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { createWriteStream, type WriteStream } from "node:fs";

export interface PromptLogger {
  proxy: ChildProcess;
  port: number;
  logStream: WriteStream;
}

/**
 * Start a claude-code-logger proxy for capturing full API traffic.
 * Returns the proxy process, port, and log file stream, or null if it
 * failed to come up within the timeout.
 */
export async function startPromptLogger(
  boxRoot: string,
  filenameHint: string,
): Promise<PromptLogger | null> {
  const logsDir = path.join(boxRoot, ".callback-box", "logs");
  await fs.mkdir(logsDir, { recursive: true });

  const logPath = path.join(logsDir, `${filenameHint}.log`);
  const logStream = createWriteStream(logPath, { flags: "a" });

  const header = `\n${"=".repeat(60)}\nLog: ${filenameHint}\nStarted: ${new Date().toISOString()}\n${"=".repeat(60)}\n\n`;
  logStream.write(header);

  const port = 30000 + Math.floor(Math.random() * 20000);

  const proxy = spawn("npx", [
    "claude-code-logger", "start",
    "--port", String(port),
    "--verbose",
    "--log-body",
    "--merge-sse",
  ], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  proxy.stdout?.on("data", (data) => logStream.write(data));
  proxy.stderr?.on("data", (data) => logStream.write(data));

  const ready = await new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => resolve(false), 10000);
    let buffer = "";
    const onData = (data: Buffer) => {
      buffer += data.toString();
      if (buffer.includes("Proxy server started")) {
        clearTimeout(timeout);
        resolve(true);
      }
    };
    proxy.stdout?.on("data", onData);
    proxy.stderr?.on("data", onData);
    proxy.on("error", () => {
      clearTimeout(timeout);
      resolve(false);
    });
    proxy.on("close", () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });

  if (!ready) {
    proxy.kill();
    logStream.write("Failed to start prompt logger proxy\n");
    logStream.end();
    return null;
  }

  return { proxy, port, logStream };
}

export function stopPromptLogger(logger: { proxy: ChildProcess; logStream: WriteStream }): void {
  logger.proxy.kill();
  const footer = `\n${"=".repeat(60)}\nEnded: ${new Date().toISOString()}\n${"=".repeat(60)}\n`;
  logger.logStream.write(footer);
  logger.logStream.end();
}
