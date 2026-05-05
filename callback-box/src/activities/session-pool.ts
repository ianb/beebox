/**
 * ActivityChatSessionPool — one ChatSession per `(boxRoot, activity, instance, mode)`.
 *
 * HTTP requests find an existing session or create one on demand. The pool
 * owns ChatSession lifecycle: construction via `buildActivityChatSessionOptions`,
 * teardown via `close()`, bulk shutdown via `closeAll()`.
 *
 * Threads through the `registry`, a `basePrompt` factory, and any
 * `chatOptions` overrides (used by tests to inject the fake backend or
 * skipBootstrap).
 */

import { ChatSession, CHAT_SYSTEM_PROMPT, type ChatSessionOptions } from "../core/chat-session.js";
import { buildTimezoneContext } from "../webapp/box-config.js";
import type { EventBus } from "../core/event-bus.js";
import type { ActivityRegistry } from "./registry.js";
import { buildActivityChatSessionOptions } from "./runtime.js";

export interface ActivityChatKey {
  boxRoot: string;
  activityType: string;
  instanceName: string;
  modeName: string;
}

export interface ActivityChatSessionPoolOptions {
  /** Partial ChatSessionOptions merged over buildActivityChatSessionOptions output. */
  chatOptions?: Partial<ChatSessionOptions>;
  /** Resolver for the base chat system prompt. Defaults to CHAT_SYSTEM_PROMPT + tzContext. */
  basePrompt?: (boxRoot: string) => Promise<string>;
  /**
   * If set, session-level events (message, turn-text, done) get forwarded
   * to the event bus with activity-scoped event names. Clients consume
   * them via the existing `/api/events` SSE endpoint.
   */
  eventBus?: EventBus;
}

/** Shape of event bus payloads for activity-chat events. */
export interface ActivityChatEvent {
  activityType: string;
  instanceName: string;
  modeName: string;
}

function keyFor(k: ActivityChatKey): string {
  return `${k.boxRoot}::${k.activityType}::${k.instanceName}::${k.modeName}`;
}

export class ActivityChatSessionPool {
  private readonly sessions = new Map<string, ChatSession>();
  private readonly detachers = new WeakMap<ChatSession, () => void>();
  private readonly registry: ActivityRegistry;
  private readonly options: ActivityChatSessionPoolOptions;

  constructor(registry: ActivityRegistry, options: ActivityChatSessionPoolOptions = {}) {
    this.registry = registry;
    this.options = options;
  }

  /** Get the existing session for `key`, or create one. */
  async getOrCreate(key: ActivityChatKey): Promise<ChatSession> {
    const k = keyFor(key);
    const existing = this.sessions.get(k);
    if (existing !== undefined) return existing;

    const activity = this.registry.getOrThrow(key.activityType);
    const instanceRoot = activity.instanceRoot(key.boxRoot, key.instanceName);
    const instance = activity.getInstance(instanceRoot);
    const basePrompt = await this.resolveBasePrompt(key.boxRoot);
    const built = await buildActivityChatSessionOptions({
      activity,
      modeName: key.modeName,
      instance,
      boxRoot: key.boxRoot,
      basePrompt,
    });

    // Fold built options into ChatSessionOptions; apply any pool-level overrides last.
    const resolvedPrompt = built.systemPrompt;
    const sessionOpts: ChatSessionOptions = {
      systemPrompt: () => Promise.resolve(resolvedPrompt),
      mcpConfig: built.mcpConfig,
      sessionFile: built.sessionFile,
      extraEnv: built.extraEnv,
      onSessionIdAssigned: built.onSessionIdAssigned,
      ...this.options.chatOptions,
    };

    const session = new ChatSession(key.boxRoot, sessionOpts);
    if (this.options.eventBus !== undefined) {
      this.attachEventBus({ session, key, eventBus: this.options.eventBus });
    }
    this.sessions.set(k, session);
    return session;
  }

  private attachEventBus({
    session,
    key,
    eventBus,
  }: {
    session: ChatSession;
    key: ActivityChatKey;
    eventBus: EventBus;
  }): void {
    const scope: ActivityChatEvent = {
      activityType: key.activityType,
      instanceName: key.instanceName,
      modeName: key.modeName,
    };
    let detached = false;
    const onMessage = (msg: unknown) => {
      if (detached) return;
      eventBus.emitTransient("activity-chat-message", { ...scope, msg });
    };
    const onTurnText = (text: string) => {
      if (detached) return;
      eventBus.emitTransient("activity-chat-turn-text", { ...scope, text });
    };
    const onDone = (result: unknown) => {
      if (detached) return;
      eventBus.emit("activity-chat-done", { ...scope, result });
    };
    const onClose = (code: number | null) => {
      if (detached) return;
      eventBus.emit("activity-chat-close", { ...scope, code });
      detach();
    };
    const detach = () => {
      if (detached) return;
      detached = true;
      session.off("message", onMessage);
      session.off("turn-text", onTurnText);
      session.off("done", onDone);
      session.off("close", onClose);
    };
    session.on("message", onMessage);
    session.on("turn-text", onTurnText);
    session.on("done", onDone);
    session.on("close", onClose);
    this.detachers.set(session, detach);
  }

  /** Get without creating. Returns null if no session exists. */
  get(key: ActivityChatKey): ChatSession | null {
    return this.sessions.get(keyFor(key)) ?? null;
  }

  /** Stop and remove a specific session. No-op if no session exists. */
  close(key: ActivityChatKey): void {
    const k = keyFor(key);
    const session = this.sessions.get(k);
    if (session === undefined) return;
    const detach = this.detachers.get(session);
    if (detach !== undefined) detach();
    session.stop();
    this.sessions.delete(k);
  }

  /** Stop and remove every session in the pool. */
  closeAll(): void {
    for (const session of this.sessions.values()) {
      const detach = this.detachers.get(session);
    if (detach !== undefined) detach();
      session.stop();
    }
    this.sessions.clear();
  }

  /** Number of sessions currently in the pool. Useful for tests. */
  size(): number {
    return this.sessions.size;
  }

  private async resolveBasePrompt(boxRoot: string): Promise<string> {
    if (this.options.basePrompt !== undefined) {
      return this.options.basePrompt(boxRoot);
    }
    const tz = await buildTimezoneContext(boxRoot);
    return CHAT_SYSTEM_PROMPT + tz;
  }
}
