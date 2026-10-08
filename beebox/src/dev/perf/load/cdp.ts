/**
 * A minimal Chrome DevTools Protocol client over Node's built-in WebSocket.
 *
 * The page-load harness drives one browser through CDP (new isolated browser
 * context per run, network/CPU throttling, network events, tracing). Results
 * and events arrive untyped; callers validate the fields they read with zod.
 */
import { z } from "zod";

const messageSchema = z.object({
  id: z.number().optional(),
  method: z.string().optional(),
  params: z.unknown().optional(),
  sessionId: z.string().optional(),
  result: z.unknown().optional(),
  error: z.object({ message: z.string() }).passthrough().optional(),
});

export interface CdpEvent {
  method: string;
  params: unknown;
  sessionId: string | undefined;
}

class CdpError extends Error {
  constructor(method: string, message: string) {
    super(`CDP ${method} failed: ${message}`);
    this.name = "CdpError";
  }
}

class CdpConnectError extends Error {
  constructor(wsUrl: string) {
    super(`CDP: cannot open ${wsUrl}`);
    this.name = "CdpConnectError";
  }
}

class PageEvaluateError extends Error {
  constructor(text: string) {
    super(`page evaluation threw: ${text}`);
    this.name = "PageEvaluateError";
  }
}

interface Pending {
  method: string;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

export class CdpConnection {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Set<(event: CdpEvent) => void>();

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (ev) => this.onMessage(ev));
    socket.addEventListener("close", () => {
      for (const p of this.pending.values()) p.reject(new CdpError(p.method, "connection closed"));
      this.pending.clear();
    });
  }

  static async connect(wsUrl: string): Promise<CdpConnection> {
    const socket = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new CdpConnectError(wsUrl)), { once: true });
    });
    return new CdpConnection(socket);
  }

  /** Sends one command; `sessionId` targets an attached page (flattened sessions). */
  send(method: string, options?: { params?: object; sessionId?: string }): Promise<unknown> {
    const id = this.nextId++;
    const message = { id, method, params: options?.params ?? {}, ...(options?.sessionId === undefined ? {} : { sessionId: options.sessionId }) };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject });
      this.socket.send(JSON.stringify(message));
    });
  }

  /** Subscribes to every event; returns the unsubscribe function. */
  onEvent(listener: (event: CdpEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.socket.close();
  }

  private onMessage(ev: MessageEvent): void {
    const parsed = messageSchema.safeParse(JSON.parse(String(ev.data)));
    if (!parsed.success) {
      console.warn("cdp: ignoring malformed message", parsed.error.message);
      return;
    }
    const msg = parsed.data;
    if (msg.id !== undefined) {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      if (msg.error) pending.reject(new CdpError(pending.method, msg.error.message));
      else pending.resolve(msg.result);
      return;
    }
    if (msg.method === undefined) return;
    const event: CdpEvent = { method: msg.method, params: msg.params, sessionId: msg.sessionId };
    for (const listener of this.listeners) listener(event);
  }
}

/** An attached page target: commands default to its session. */
export class CdpPage {
  constructor(readonly cdp: CdpConnection, readonly sessionId: string) {}

  send(method: string, params?: object): Promise<unknown> {
    return this.cdp.send(method, { params: params ?? {}, sessionId: this.sessionId });
  }

  /** Evaluates an expression in the page and validates its JSON value. */
  async evaluate<T>(expression: string, schema: z.ZodType<T>): Promise<T> {
    const result = z.object({
      result: z.object({ value: z.unknown().optional() }),
      exceptionDetails: z.object({ text: z.string() }).passthrough().optional(),
    }).parse(await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }));
    if (result.exceptionDetails) throw new PageEvaluateError(result.exceptionDetails.text);
    return schema.parse(result.result.value);
  }
}
