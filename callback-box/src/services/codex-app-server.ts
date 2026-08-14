/**
 * Small JSON-RPC client for the Codex app-server subprocess.
 *
 * Codex owns its agent loop, tools, auth, sandbox, sessions, and transcripts.
 * This client only transports typed requests and notifications across stdio.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import * as readline from "node:readline";
import { z } from "zod";

const rpcResponseSchema = z.looseObject({
  id: z.number(),
  result: z.unknown().optional(),
  error: z.looseObject({
    code: z.number(),
    message: z.string(),
    data: z.unknown().optional(),
  }).optional(),
});

const rpcMessageSchema = z.looseObject({
  id: z.number().optional(),
  method: z.string().optional(),
  params: z.unknown().optional(),
});

export interface CodexNotification {
  method: string;
  params: unknown;
}

export class CodexRpcError extends Error {
  readonly method: string;
  readonly rpcMessage: string;

  constructor(options: { method: string; rpcMessage: string; cause?: unknown }) {
    super("Codex app-server request failed", { cause: options.cause });
    this.name = "CodexRpcError";
    this.method = options.method;
    this.rpcMessage = options.rpcMessage;
  }
}

export class CodexAppServerExitError extends Error {
  readonly detail: string;

  constructor(detail: string) {
    super("Codex app-server exited unexpectedly");
    this.name = "CodexAppServerExitError";
    this.detail = detail;
  }
}

export class CodexAppServerTimeoutError extends Error {
  readonly operation: string;

  constructor(operation: string) {
    super("Codex app-server operation timed out");
    this.name = "CodexAppServerTimeoutError";
    this.operation = operation;
  }
}

class CodexAppServerClosedError extends Error {
  constructor() {
    super("Codex app-server was closed by callback-box");
    this.name = "CodexAppServerClosedError";
  }
}

interface PendingRequest {
  method: string;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

export interface CodexAppServerOptions {
  cwd: string;
  binary?: string;
  env?: NodeJS.ProcessEnv;
}

export interface CodexRequestOptions {
  method: string;
  params?: Record<string, unknown>;
  timeoutMs?: number;
}

/** One owned Codex app-server subprocess. */
export class CodexAppServer {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly events = new EventEmitter();
  private nextId = 1;
  private stderr = "";
  private closing = false;

  constructor(options: CodexAppServerOptions) {
    this.child = spawn(
      options.binary ?? process.env.CB_CODEX_BINARY ?? "codex",
      ["app-server", "--listen", "stdio://"],
      {
        cwd: options.cwd,
        env: options.env,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderr += chunk.toString();
    });
    readline.createInterface({ input: this.child.stdout }).on("line", (line) => {
      this.handleLine(line);
    });
    this.child.on("error", (error) => {
      this.failPending(new CodexAppServerExitError(error.message));
    });
    this.child.on("exit", (code, signal) => {
      if (this.closing) return;
      const detail = `code=${String(code)} signal=${String(signal)} stderr=${this.stderr.trim()}`;
      const error = new CodexAppServerExitError(detail);
      this.failPending(error);
      this.events.emit("exit", error);
    });
  }

  async initialize(): Promise<void> {
    await this.request({
      method: "initialize",
      params: {
        clientInfo: {
          name: "callback-box",
          title: "Callback Box",
          version: "1",
        },
        capabilities: { experimentalApi: true },
      },
    });
    this.notify("initialized");
  }

  request(options: CodexRequestOptions): Promise<unknown> {
    const id = this.nextId;
    this.nextId += 1;
    const timeoutMs = options.timeoutMs ?? 180_000;
    const payload = options.params === undefined
      ? { id, method: options.method }
      : { id, method: options.method, params: options.params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CodexAppServerTimeoutError(options.method));
      }, timeoutMs);
      this.pending.set(id, {
        method: options.method,
        resolve,
        reject,
        timer,
      });
      this.child.stdin.write(`${JSON.stringify(payload)}\n`);
    });
  }

  notify(method: string, params?: Record<string, unknown>): void {
    const payload = params === undefined ? { method } : { method, params };
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  onNotification(listener: (notification: CodexNotification) => void): () => void {
    this.events.on("notification", listener);
    return () => this.events.off("notification", listener);
  }

  onExit(listener: (error: CodexAppServerExitError) => void): () => void {
    this.events.on("exit", listener);
    return () => this.events.off("exit", listener);
  }

  close(): void {
    if (this.closing) return;
    this.closing = true;
    this.child.kill("SIGTERM");
    this.failPending(new CodexAppServerClosedError());
  }

  private handleLine(line: string): void {
    if (line.trim() === "") return;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (error) {
      console.error("[codex-app-server] invalid JSON from subprocess:", error);
      return;
    }
    const message = rpcMessageSchema.safeParse(raw);
    if (!message.success) {
      console.error("[codex-app-server] invalid protocol message:", message.error);
      return;
    }
    const { id, method } = message.data;
    if (id !== undefined && method === undefined) {
      this.handleResponse(raw);
      return;
    }
    if (id !== undefined && method !== undefined) {
      this.answerServerRequest(id, method);
      return;
    }
    if (method !== undefined) {
      this.events.emit("notification", {
        method,
        params: message.data.params,
      } satisfies CodexNotification);
    }
  }

  private handleResponse(raw: unknown): void {
    const parsed = rpcResponseSchema.safeParse(raw);
    if (!parsed.success) {
      console.error("[codex-app-server] invalid response:", parsed.error);
      return;
    }
    const pending = this.pending.get(parsed.data.id);
    if (pending === undefined) return;
    this.pending.delete(parsed.data.id);
    clearTimeout(pending.timer);
    if (parsed.data.error !== undefined) {
      pending.reject(new CodexRpcError({
        method: pending.method,
        rpcMessage: parsed.data.error.message,
      }));
      return;
    }
    pending.resolve(parsed.data.result);
  }

  private answerServerRequest(id: number, method: string): void {
    if (method.endsWith("/requestApproval")) {
      this.child.stdin.write(`${JSON.stringify({ id, result: { decision: "decline" } })}\n`);
      return;
    }
    console.warn(`[codex-app-server] unsupported server request: ${method}`);
    this.child.stdin.write(`${JSON.stringify({
      id,
      error: { code: -32601, message: `Callback Box does not implement ${method}` },
    })}\n`);
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
