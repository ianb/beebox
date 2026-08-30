/** Narrow app-server compatibility client for SDK-unsupported history operations. */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import * as readline from "node:readline";
import { z } from "zod";

const rpcResponseSchema = z.looseObject({
  id: z.number(),
  result: z.unknown().optional(),
  error: z.looseObject({ code: z.number(), message: z.string() }).optional(),
});
const rpcMessageSchema = z.looseObject({ id: z.number().optional(), method: z.string().optional() });

export class CodexHistoryRpcError extends Error {
  readonly operation: string;
  readonly rpcMessage: string;

  constructor(options: { operation: string; rpcMessage: string }) {
    super("Codex history request failed");
    this.name = "CodexHistoryRpcError";
    this.operation = options.operation;
    this.rpcMessage = options.rpcMessage;
  }
}

class CodexHistoryServerExitError extends Error {
  readonly detail: string;

  constructor(options: { detail: string }) {
    super("Codex history app-server exited unexpectedly");
    this.name = "CodexHistoryServerExitError";
    this.detail = options.detail;
  }
}

class CodexHistoryServerClosedError extends Error {
  constructor() {
    super("Codex history app-server was closed by Bee Box");
    this.name = "CodexHistoryServerClosedError";
  }
}

interface PendingRequest {
  operation: string;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

/** This client deliberately cannot start or control turns. */
export class CodexHistoryServer {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly events = new EventEmitter();
  private nextId = 1;
  private stderr = "";
  private closing = false;

  constructor(cwd: string) {
    // TODO(env-migration): test/diagnostic binary override; move into the typed env boundary.
    this.child = spawn(process.env.BBX_CODEX_BINARY ?? "codex", ["app-server", "--listen", "stdio://"], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stderr.on("data", (chunk: Buffer) => { this.stderr += chunk.toString(); });
    readline.createInterface({ input: this.child.stdout }).on("line", (line) => { this.handleLine(line); });
    this.child.on("error", (error) => {
      this.failPending(new CodexHistoryServerExitError({ detail: error.message }));
    });
    this.child.on("exit", (code, signal) => {
      if (this.closing) return;
      const error = new CodexHistoryServerExitError({
        detail: `code=${String(code)} signal=${String(signal)} stderr=${this.stderr.trim()}`,
      });
      this.failPending(error);
      this.events.emit("exit", error);
    });
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      clientInfo: { name: "beebox-history", title: "Bee Box History", version: "1" },
      capabilities: { experimentalApi: true },
    });
    this.child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);
  }

  readThread(threadId: string): Promise<unknown> {
    return this.request("thread/read", { threadId, includeTurns: true });
  }

  listThreads(params: Record<string, unknown>): Promise<unknown> {
    return this.request("thread/list", params);
  }

  deleteThread(threadId: string): Promise<void> {
    return this.request("thread/delete", { threadId }).then(() => {});
  }

  onExit(listener: (error: CodexHistoryServerExitError) => void): () => void {
    this.events.on("exit", listener);
    return () => this.events.off("exit", listener);
  }

  close(): void {
    if (this.closing) return;
    this.closing = true;
    this.child.kill("SIGTERM");
    this.failPending(new CodexHistoryServerClosedError());
  }

  private request(operation: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CodexHistoryRpcError({ operation, rpcMessage: "Operation timed out" }));
      }, 180_000);
      this.pending.set(id, { operation, resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ id, method: operation, params })}\n`);
    });
  }

  private handleLine(line: string): void {
    if (line.trim() === "") return;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (error) {
      console.error("[codex-history] invalid JSON from subprocess:", error);
      return;
    }
    const message = rpcMessageSchema.safeParse(raw);
    if (!message.success) {
      console.error("[codex-history] invalid protocol message:", message.error);
      return;
    }
    if (message.data.id !== undefined && message.data.method === undefined) this.handleResponse(raw);
    else if (message.data.id !== undefined && message.data.method !== undefined) {
      this.child.stdin.write(`${JSON.stringify({
        id: message.data.id,
        error: { code: -32601, message: "Bee Box history client does not accept server requests" },
      })}\n`);
    }
  }

  private handleResponse(raw: unknown): void {
    const parsed = rpcResponseSchema.safeParse(raw);
    if (!parsed.success) {
      console.error("[codex-history] invalid response:", parsed.error);
      return;
    }
    const pending = this.pending.get(parsed.data.id);
    if (pending === undefined) return;
    this.pending.delete(parsed.data.id);
    clearTimeout(pending.timer);
    if (parsed.data.error !== undefined) {
      pending.reject(new CodexHistoryRpcError({
        operation: pending.operation,
        rpcMessage: parsed.data.error.message,
      }));
    } else {
      pending.resolve(parsed.data.result);
    }
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
