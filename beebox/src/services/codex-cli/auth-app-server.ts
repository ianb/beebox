/** Narrow JSONL client for Codex app-server's device authentication surface. */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as readline from "node:readline";
import { z } from "zod";

const rpcResponseSchema = z.looseObject({
  id: z.number(),
  result: z.unknown().optional(),
  error: z.looseObject({ message: z.string() }).optional(),
});
const rpcMessageSchema = z.looseObject({ id: z.number().optional(), method: z.string().optional(), params: z.unknown().optional() });
const loginResultSchema = z.object({
  type: z.literal("chatgptDeviceCode"),
  loginId: z.string(),
  verificationUrl: z.string().url(),
  userCode: z.string().min(1),
});
const loginCompletedSchema = z.object({ loginId: z.string(), success: z.boolean(), error: z.string().nullable() });

export type CodexLoginResult = z.infer<typeof loginResultSchema>;
export type CodexLoginCompletion = z.infer<typeof loginCompletedSchema>;

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

class CodexAuthServerExitError extends Error {
  readonly detail: string;

  constructor(options: { code: number | null; signal: NodeJS.Signals | null; stderr: string }) {
    super("Codex authentication server exited unexpectedly");
    this.name = "CodexAuthServerExitError";
    this.detail = `code=${String(options.code)} signal=${String(options.signal)} stderr=${options.stderr}`;
  }
}

class CodexAuthRequestTimeoutError extends Error {
  readonly operation: string;

  constructor(operation: string) {
    super("Codex authentication request timed out");
    this.name = "CodexAuthRequestTimeoutError";
    this.operation = operation;
  }
}

export class CodexAuthAppServer {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private stderr = "";
  private completedListener: ((result: CodexLoginCompletion) => void) | null = null;
  private exitListener: (() => void) | null = null;

  constructor(binaryPath: string) {
    this.child = spawn(binaryPath, ["app-server", "--listen", "stdio://"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stderr.on("data", (chunk: Buffer) => { this.stderr += chunk.toString(); });
    this.child.stdin.on("error", (error) => { this.failPending(error); });
    readline.createInterface({ input: this.child.stdout }).on("line", (line) => { this.handleLine(line); });
    this.child.on("error", (error) => { this.failPending(error); });
    this.child.on("exit", (code, signal) => {
      this.failPending(new CodexAuthServerExitError({ code, signal, stderr: this.stderr.trim() }));
      this.exitListener?.();
    });
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      clientInfo: { name: "beebox-auth", title: "Bee Box", version: "1" },
      capabilities: { experimentalApi: false },
    });
    this.child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);
  }

  async startLogin(): Promise<CodexLoginResult> {
    return loginResultSchema.parse(await this.request("account/login/start", { type: "chatgptDeviceCode" }));
  }

  cancel(loginId: string): Promise<void> {
    return this.request("account/login/cancel", { loginId }).then(() => {});
  }

  onCompleted(listener: (result: CodexLoginCompletion) => void): void {
    this.completedListener = listener;
  }

  onExit(listener: () => void): void {
    this.exitListener = listener;
  }

  close(): void {
    this.child.kill("SIGTERM");
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CodexAuthRequestTimeoutError(method));
      }, 15_000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  private handleLine(line: string): void {
    if (line.trim() === "") return;
    let decoded: unknown;
    try {
      decoded = JSON.parse(line);
    } catch (error) {
      console.error("[codex-auth] invalid JSON from app-server:", error);
      return;
    }
    const parsedMessage = rpcMessageSchema.safeParse(decoded);
    if (!parsedMessage.success) {
      console.error("[codex-auth] invalid app-server message:", parsedMessage.error);
      return;
    }
    const message = parsedMessage.data;
    if (message.id !== undefined && message.method === undefined) {
      this.handleResponse(decoded);
      return;
    }
    if (message.method === "account/login/completed") {
      const completed = loginCompletedSchema.safeParse(message.params);
      if (completed.success) this.completedListener?.(completed.data);
      return;
    }
    if (message.id !== undefined) {
      this.child.stdin.write(`${JSON.stringify({ id: message.id, error: { code: -32601, message: "Unsupported request" } })}\n`);
    }
  }

  private handleResponse(decoded: unknown): void {
    const parsed = rpcResponseSchema.safeParse(decoded);
    if (!parsed.success) {
      console.error("[codex-auth] invalid app-server response:", parsed.error);
      return;
    }
    const pending = this.pending.get(parsed.data.id);
    if (!pending) return;
    this.pending.delete(parsed.data.id);
    clearTimeout(pending.timer);
    if (parsed.data.error) pending.reject(new Error(parsed.data.error.message));
    else pending.resolve(parsed.data.result);
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
