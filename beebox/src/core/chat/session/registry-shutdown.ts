/** Bounded graceful-close boundary for registry-owned chat sessions. */

import { startAwakeTimeout } from "../../../lib/awake-timeout.js";

const CHAT_SHUTDOWN_GRACE_MS = 10_000;

export interface ShutdownChatSession {
  getSessionId(): string | null;
  isRunning(): boolean;
  once(event: "close", listener: () => void): unknown;
  stop(): void;
}

export async function stopChatSessionsAndWait(
  sessions: ShutdownChatSession[],
  options?: { timeoutMs?: number; periodMs?: number },
): Promise<string[]> {
  const closing = new Set<string>();
  const waits = sessions.filter((session) => session.isRunning()).map((session, index) => {
    const id = session.getSessionId() ?? `<pending-${String(index + 1)}>`;
    closing.add(id);
    const closed = new Promise<void>((resolve) => {
      session.once("close", () => { closing.delete(id); resolve(); });
    });
    session.stop();
    return closed;
  });
  if (waits.length === 0) return [];
  let timeout!: ReturnType<typeof startAwakeTimeout>;
  const expired = new Promise<"timeout">((resolve) => {
    timeout = startAwakeTimeout({
      timeoutMs: options?.timeoutMs ?? CHAT_SHUTDOWN_GRACE_MS,
      ...(options?.periodMs === undefined ? {} : { periodMs: options.periodMs }),
      onTimeout: () => { resolve("timeout"); },
    });
  });
  await Promise.race([Promise.all(waits), expired]);
  timeout.stop();
  return [...closing];
}
