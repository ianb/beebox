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
 * Live runs stop at once. A session still opening a turn is not running yet,
 * but its start (the bootstrap docs commit, then the backend spawn) would
 * finish after the caller tore the box down; so openings settle next, and a
 * run they opened is stopped too. Stopping clears a session's queue, so a
 * stopped run does not drain into a new send. Last, every session is stopped
 * once more, running or not: a queue held without a run (a failed start, a
 * maintenance pause) or filled during the shutdown wait is lost with the
 * process, and `stop()` is what records those messages as undelivered.
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
  const stopped = new Set<ShutdownChatSession>();
  const unfinished = new Set<ShutdownChatSession>();
  const closes: Promise<void>[] = [];
  const stopRunning = (): void => {
    for (const session of sessions) {
      if (stopped.has(session) || !session.isRunning()) continue;
      stopped.add(session);
      unfinished.add(session);
      closes.push(new Promise<void>((resolve) => {
        session.once("close", () => { unfinished.delete(session); resolve(); });
      }));
      session.stop();
    }
  };
  try {
    stopRunning();
    const opening = new Set(sessions);
    const started = sessions.map((session) => session.whenStarted().then(() => { opening.delete(session); }));
    if ((await Promise.race([Promise.all(started), expired])) === "timeout") {
      return [...new Set([...unfinished, ...opening])].map(label);
    }
    stopRunning();
    if (closes.length === 0) return [];
    await Promise.race([Promise.all(closes), expired]);
    return [...unfinished].map(label);
  } finally {
    timeout.stop();
    for (const session of sessions) session.stop();
  }
}
