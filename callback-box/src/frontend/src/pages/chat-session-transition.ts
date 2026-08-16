/**
 * Classify a URL transition away from the fresh-chat sentinel.
 *
 * A fresh chat's machine must survive when the backend assigns that same
 * conversation its durable id. Any other `new` -> id transition is explicit
 * navigation to an existing chat and must remount the machine so its history
 * loads.
 */
/**
 * The one-shot announcement channel between InteractiveChat (which learns the
 * backend-assigned id and rewrites the URL) and ChatPage (which classifies
 * that URL change). An external store read via `useSyncExternalStore`, NOT
 * React state: the URL rewrite reaches ChatPage through the router store,
 * which re-renders at sync priority BEFORE a same-tick setState is applied.
 * When the announcement was ChatPage state, the search-change render still
 * saw it as null, classified the assignment as explicit navigation, and
 * remounted the machine — losing the optimistic first message and the live
 * turn stream for the whole first-turn window
 * (issues/bugs/2026-08-08-new-chat-first-message-blank-until-agent-works.md).
 * A store snapshot is read live during every render, so the navigation's own
 * render sees an announcement made in the same tick.
 */
export interface SessionAssignmentLatch {
  /** Record an assignment immediately before the URL rewrite. */
  announce(sessionId: string): void;
  /** Consume the announcement once the guarded key transition has committed. */
  clear(): void;
  subscribe(onChange: () => void): () => void;
  get(): string | null;
}

export function createSessionAssignmentLatch(): SessionAssignmentLatch {
  let value: string | null = null;
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of listeners) listener();
  };
  return {
    announce(sessionId: string): void {
      value = sessionId;
      notify();
    },
    clear(): void {
      if (value === null) return;
      value = null;
      notify();
    },
    subscribe(onChange: () => void): () => void {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
    get: (): string | null => value,
  };
}

export function carriesFreshChatMachine({
  previousSessionInput,
  nextSessionInput,
  announcedAssignment,
}: {
  previousSessionInput: string | null;
  nextSessionInput: string;
  announcedAssignment: string | null;
}): boolean {
  return previousSessionInput === "new"
    && nextSessionInput !== "new"
    && nextSessionInput === announcedAssignment;
}
