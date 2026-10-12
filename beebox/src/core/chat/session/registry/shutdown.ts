/** Bounded graceful-close boundary for registry-owned chat sessions. */

import { startAwakeTimeout } from "../../../../shared/awake-timeout.js";

const CHAT_SHUTDOWN_GRACE_MS = 10_000;

export interface ShutdownChatSession {
  getSessionId(): string | null;
  isRunning(): boolean;
  /** Settles when a run start in flight has finished or failed; at once when none is. */
  whenStarted(): Promise<unknown>;
  once(event: "close", listener: () => void): unknown;
  stop(): void;
}

/**
 * Stop every session and wait for each to close, all within one time limit.
 * A session still starting is not yet running: its start (the bootstrap docs
 * commit, then the backend spawn) would finish after the caller tore the box
 * down. So starts settle first, and a run they opened is stopped like any other.
 */
export async function stopChatSessionsAndWait(
  sessions: ShutdownChatSession[],
  options?: { timeoutMs?: number; periodMs?: number },
): Promise<string[]> {
  let timeout!: ReturnType<typeof startAwakeTimeout>;
  const expired = new Promise<"timeout">((resolve) => {
    timeout = startAwakeTimeout({
      timeoutMs: options?.timeoutMs ?? CHAT_SHUTDOWN_GRACE_MS,
      ...(options?.periodMs === undefined ? {} : { periodMs: options.periodMs }),
      onTimeout: () => { resolve("timeout"); },
    });
  });
  const label = (session: ShutdownChatSession): string => session.getSessionId() ?? `<pending-${String(sessions.indexOf(session) + 1)}>`;
  try {
    const unstarted = new Set(sessions);
    const started = sessions.map((session) => session.whenStarted().then(() => { unstarted.delete(session); }));
    if ((await Promise.race([Promise.all(started), expired])) === "timeout") return [...unstarted].map(label);

    const closing = new Set<ShutdownChatSession>();
    const waits = sessions.filter((session) => session.isRunning()).map((session) => {
      closing.add(session);
      const closed = new Promise<void>((resolve) => {
        session.once("close", () => { closing.delete(session); resolve(); });
      });
      session.stop();
      return closed;
    });
    if (waits.length === 0) return [];
    await Promise.race([Promise.all(waits), expired]);
    return [...closing].map(label);
  } finally {
    timeout.stop();
  }
}
