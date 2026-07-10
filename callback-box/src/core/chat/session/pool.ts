/**
 * ChatSessionPool — Manages persistent per-thread Claude sessions.
 *
 * One active process at a time. When a message arrives for a different thread,
 * the current session is parked and the target session is activated/resumed.
 *
 * Session IDs are persisted to `.callback-box/chat-thread-sessions.json`
 * so sessions can be resumed after server restarts.
 */

import { makeLog } from "./log.js";
import { getPublicUrl } from "../../../lib/public-url.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { ChatThreadSession } from "./thread.js";
import {
  ChatScheduleManager,
  parseScheduleTags,
  parseCancelScheduleTags,
} from "../schedules.js";
import { isRecord } from "../../card-io.js";

function getBoxSlug(boxRoot: string): string {
  return path.basename(boxRoot);
}

const SESSIONS_FILE = ".callback-box/chat-thread-sessions.json";

/** Max messages before rotating to a fresh session */
const MAX_MESSAGES = 50;
/** Max age in ms before rotating (24 hours) */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Max time to wait for a busy session (ms) */
const BUSY_TIMEOUT_MS = 60_000;

const SessionRecordSchema = z.object({
  sessionId: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string(),
  messageCount: z.number(),
});

type SessionRecord = z.infer<typeof SessionRecordSchema>;

type SessionStore = Record<string, SessionRecord>;

const log = makeLog("ChatSessionPool");

/** Callback to deliver a response to the external channel (e.g., Telegram). Stored per-thread for schedule fires. */
type DeliverResponse = (text: string) => void | Promise<void>;

export interface SendOptions {
  /** Thread file relative path (key for session lookup) */
  threadRef: string;
  /** Message text to send to the agent */
  message: string;
  /** Human-readable chat description (e.g., "Jane Doe") */
  chatDescription: string;
  /** Called immediately when each <chat-response> is intercepted from the stream */
  onResponse?: DeliverResponse | undefined;
  /** Persistent delivery callback — stored per-thread for schedule-fired responses */
  deliverResponse?: DeliverResponse | undefined;
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
  private scheduleManagers: Map<string, ChatScheduleManager> = new Map();
  private deliveryCallbacks: Map<string, DeliverResponse> = new Map();
  /** chatDescription per thread, needed when schedule fires without a user message */
  private threadDescriptions: Map<string, string> = new Map();

  constructor(boxRoot: string) {
    this.boxRoot = boxRoot;
  }

  /**
   * Send a message to a thread's session. Parks/activates sessions as needed.
   * Returns the collected <chat-response> texts.
   */
  async send(opts: SendOptions): Promise<SendResult> {
    const { threadRef, message, chatDescription, onResponse, deliverResponse } = opts;
    const store = await this.loadStore();

    // Store delivery callback and description for schedule fires
    if (deliverResponse) {
      this.deliveryCallbacks.set(threadRef, deliverResponse);
    }
    this.threadDescriptions.set(threadRef, chatDescription);

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
      // Deliver immediately — don't wait for the turn to complete. Delivery
      // can be async (DeliverResponse allows a Promise); a rejection here is
      // genuine fire-and-forget (the turn already succeeded), but log it so
      // a broken delivery path doesn't disappear silently.
      const delivery = onResponse?.(text);
      if (delivery) {
        void delivery.catch((err: unknown) => {
          console.error("[chat-session-pool] onResponse delivery failed:", err);
        });
      }
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
        // Clear schedules for expired session
        const manager = this.scheduleManagers.get(threadRef);
        if (manager) {
          manager.stopAll();
          this.scheduleManagers.delete(threadRef);
        }
      }
    }

    const publicUrl = getPublicUrl("");
    const boxSlug = getBoxSlug(this.boxRoot);
    const sessionViewBaseUrl = publicUrl ? `${publicUrl}/${boxSlug}/chat` : undefined;

    const session = new ChatThreadSession({
      boxRoot: this.boxRoot,
      threadRef,
      chatDescription,
      sessionId,
      sessionViewBaseUrl,
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

    // Parse schedule tags from each turn's full text
    session.on("turn-text", (text: string) => {
      const newSchedules = parseScheduleTags(text);
      if (newSchedules.length > 0) {
        const manager = this.getOrCreateScheduleManager(threadRef);
        for (const s of newSchedules) {
          manager.addSchedule(s);
        }
      }

      const cancels = parseCancelScheduleTags(text);
      if (cancels.length > 0) {
        const manager = this.scheduleManagers.get(threadRef);
        if (manager) {
          for (const label of cancels) {
            manager.cancelByLabel(label);
          }
        }
      }
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
   * Get or create a ChatScheduleManager for a thread.
   */
  private getOrCreateScheduleManager(threadRef: string): ChatScheduleManager {
    let manager = this.scheduleManagers.get(threadRef);
    if (manager) return manager;

    // Derive a safe filename from threadRef
    const safeKey = threadRef.replace(/[/\\]/g, "_").replace(/\.card$/, "");
    const schedulesFile = `.callback-box/thread-schedules/${safeKey}.json`;

    manager = new ChatScheduleManager(this.boxRoot, {
      schedulesFile,
      onFire: ({ schedule }) => {
        this.handleScheduleFire(threadRef, schedule).catch((err) => {
          log("schedule-error", `Failed to fire schedule for ${threadRef}: ${err}`);
        });
      },
    });
    this.scheduleManagers.set(threadRef, manager);
    return manager;
  }

  /**
   * Handle a schedule firing: send the fired message to the thread session,
   * deliver responses via the stored delivery callback.
   */
  private async handleScheduleFire(
    threadRef: string,
    schedule: { label: string; content: string; createdAt: string },
  ): Promise<void> {
    const firedAt = new Date().toISOString();
    const firedMessage = [
      `<schedule-fired label="${schedule.label}" scheduled-at="${schedule.createdAt}" fired-at="${firedAt}">`,
      schedule.content,
      "",
      `A scheduled timer "${schedule.label}" has fired. Respond via <chat-response>.`,
      "</schedule-fired>",
    ].join("\n");

    const chatDescription = this.threadDescriptions.get(threadRef) || "chat";
    const deliverResponse = this.deliveryCallbacks.get(threadRef);

    log("schedule-fire", `Firing "${schedule.label}" for ${threadRef}`);

    await this.send({
      threadRef,
      message: firedMessage,
      chatDescription,
      onResponse: deliverResponse,
      deliverResponse,
    });
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
    const entry = store[threadRef];
    if (sessionId && entry) {
      entry.sessionId = sessionId;
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
      const parsedRaw: unknown = JSON.parse(data);
      const store: SessionStore = {};
      if (isRecord(parsedRaw)) {
        for (const [key, value] of Object.entries(parsedRaw)) {
          const result = SessionRecordSchema.safeParse(value);
          if (result.success) {
            store[key] = result.data;
          } else {
            log("loadStore", `Dropping malformed session record for thread ${key}: ${result.error.message}`);
          }
        }
      }
      this.store = store;
    } catch (err) {
      log("loadStore", `Could not load session store from ${filePath}, starting empty: ${err}`);
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
   * Stop all sessions, schedules, and clear state.
   */
  stop(): void {
    if (this.active) {
      this.active.stop();
      this.active = null;
    }
    for (const manager of this.scheduleManagers.values()) {
      manager.stopAll();
    }
    this.scheduleManagers.clear();
  }
}
