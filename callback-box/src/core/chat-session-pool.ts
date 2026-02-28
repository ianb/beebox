/**
 * ChatSessionPool — Manages persistent per-thread Claude sessions.
 *
 * One active process at a time. When a message arrives for a different thread,
 * the current session is parked and the target session is activated/resumed.
 *
 * Session IDs are persisted to `.callback-box/chat-thread-sessions.json`
 * so sessions can be resumed after server restarts.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ChatThreadSession } from "./chat-thread-session.js";

const SESSIONS_FILE = ".callback-box/chat-thread-sessions.json";

/** Max messages before rotating to a fresh session */
const MAX_MESSAGES = 50;
/** Max age in ms before rotating (24 hours) */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Max time to wait for a busy session (ms) */
const BUSY_TIMEOUT_MS = 60_000;

interface SessionRecord {
  sessionId: string;
  createdAt: string;
  lastUsedAt: string;
  messageCount: number;
}

type SessionStore = Record<string, SessionRecord>;

function log(context: string, ...args: unknown[]): void {
  console.log(`[ChatSessionPool:${context}]`, ...args);
}

export interface SendOptions {
  /** Thread file relative path (key for session lookup) */
  threadRef: string;
  /** Message text to send to the agent */
  message: string;
  /** Human-readable chat description (e.g., "Ian Bicking") */
  chatDescription: string;
  /** Called immediately when each <chat-response> is intercepted from the stream */
  onResponse?: ((text: string) => void | Promise<void>) | undefined;
}

export interface SendResult {
  /** Response texts extracted from <chat-response> tags */
  responses: string[];
  /** Whether the agent turn completed successfully */
  success: boolean;
}

export class ChatSessionPool {
  private boxRoot: string;
  private store: SessionStore | null = null;
  private active: ChatThreadSession | null = null;

  constructor(boxRoot: string) {
    this.boxRoot = boxRoot;
  }

  /**
   * Send a message to a thread's session. Parks/activates sessions as needed.
   * Returns the collected <chat-response> texts.
   */
  async send(opts: SendOptions): Promise<SendResult> {
    const { threadRef, message, chatDescription, onResponse } = opts;
    const store = await this.loadStore();

    // If there's an active session for a different thread, park it
    if (this.active && this.active.getThreadRef() !== threadRef) {
      await this.parkActive(store);
    }

    // If active session is for this thread but busy, wait for it
    if (this.active && this.active.getThreadRef() === threadRef && this.active.isBusy()) {
      log("send", `Session busy for ${threadRef}, waiting...`);
      await this.waitForIdle(this.active);
    }

    // Activate session for this thread if not already active
    if (!this.active || this.active.getThreadRef() !== threadRef) {
      this.active = this.createSession(store, { threadRef, chatDescription });
    }

    const session = this.active;
    const responses: string[] = [];

    const handleResponse = (text: string) => {
      responses.push(text);
      // Deliver immediately — don't wait for the turn to complete
      onResponse?.(text);
    };
    session.on("chat-response", handleResponse);

    try {
      await session.send(message);

      // Update store after successful turn
      const record = store[threadRef];
      if (record) {
        record.lastUsedAt = new Date().toISOString();
        record.messageCount++;
      }
      await this.saveStore(store);

      return { responses, success: true };
    } catch (err) {
      log("error", `Send failed for ${threadRef}: ${err}`);
      // Reset session on failure — next message starts fresh
      this.active.stop();
      this.active = null;
      delete store[threadRef];
      await this.saveStore(store);
      return { responses, success: false };
    } finally {
      session.off("chat-response", handleResponse);
    }
  }

  /**
   * Create or resume a ChatThreadSession for the given thread.
   */
  private createSession(
    store: SessionStore,
    opts: { threadRef: string; chatDescription: string },
  ): ChatThreadSession {
    const { threadRef, chatDescription } = opts;
    const record = store[threadRef];
    let sessionId: string | undefined;

    if (record) {
      const age = Date.now() - new Date(record.lastUsedAt).getTime();
      if (record.messageCount < MAX_MESSAGES && age < MAX_AGE_MS) {
        sessionId = record.sessionId;
        log("activate", `Resuming session ${sessionId} for ${threadRef} (${record.messageCount} msgs)`);
      } else {
        log("activate", `Session expired for ${threadRef}, starting fresh`);
        delete store[threadRef];
      }
    }

    const session = new ChatThreadSession({
      boxRoot: this.boxRoot,
      threadRef,
      chatDescription,
      sessionId,
    });

    // Capture session ID when assigned (for new sessions)
    session.on("session", (id: string) => {
      store[threadRef] = {
        sessionId: id,
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
        messageCount: 0,
      };
      this.saveStore(store).catch((err) => {
        log("error", `Failed to save store after session creation: ${err}`);
      });
    });

    // Handle unexpected close
    session.on("close", () => {
      if (this.active === session) {
        this.active = null;
      }
    });

    return session;
  }

  /**
   * Park the active session: kill process, save session ID.
   */
  private async parkActive(store: SessionStore): Promise<void> {
    if (!this.active) return;
    const threadRef = this.active.getThreadRef();

    // Wait for busy session before parking
    if (this.active.isBusy()) {
      log("park", `Waiting for busy session ${threadRef} before parking`);
      await this.waitForIdle(this.active);
    }

    const sessionId = this.active.park();
    log("park", `Parked ${threadRef} (session ${sessionId})`);
    this.active = null;

    // Ensure the parked session ID is saved
    if (sessionId && store[threadRef]) {
      store[threadRef]!.sessionId = sessionId;
      await this.saveStore(store);
    }
  }

  /**
   * Wait for a busy session to become idle.
   */
  private waitForIdle(session: ChatThreadSession): Promise<void> {
    if (!session.isBusy()) return Promise.resolve();

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        log("timeout", "Timed out waiting for session to become idle");
        resolve();
      }, BUSY_TIMEOUT_MS);

      const onDone = () => {
        clearTimeout(timeout);
        session.off("done", onDone);
        session.off("close", onDone);
        resolve();
      };

      session.on("done", onDone);
      session.on("close", onDone);
    });
  }

  private async loadStore(): Promise<SessionStore> {
    if (this.store) return this.store;
    const filePath = path.join(this.boxRoot, SESSIONS_FILE);
    try {
      const data = await fs.readFile(filePath, "utf-8");
      this.store = JSON.parse(data) as SessionStore;
    } catch {
      this.store = {};
    }
    return this.store;
  }

  private async saveStore(store: SessionStore): Promise<void> {
    this.store = store;
    const filePath = path.join(this.boxRoot, SESSIONS_FILE);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(store, null, 2));
  }

  /**
   * Stop all sessions and clear state.
   */
  stop(): void {
    if (this.active) {
      this.active.stop();
      this.active = null;
    }
  }
}
