import type { ChatSession } from "./index.js";
import { SessionDeletionState } from "./deletion-state.js";
import { awaitDeletionStop } from "./stop-for-deletion.js";

const DELETE_STOP_TIMEOUT_MS = 15_000;

interface RegistryDeletionHost {
  find: (sessionId: string) => ChatSession | null;
  findPending: (sessionId: string) => ChatSession | null;
  remove: (sessionId: string, session: ChatSession) => void;
}

/** Tombstone state plus destructive shutdown operations for a registry. */
export class RegistryDeletionCoordinator extends SessionDeletionState {
  private readonly host: RegistryDeletionHost;

  constructor(host: RegistryDeletionHost) {
    super();
    this.host = host;
  }

  hasAssignedSession(sessionId: string): boolean {
    if (this.isBlocked(sessionId)) return false;
    return this.host.find(sessionId) !== null || this.host.findPending(sessionId) !== null;
  }

  async stopAndRemove(sessionId: string): Promise<void> {
    const session = this.host.find(sessionId) ?? this.host.findPending(sessionId);
    if (session === null) return;
    await awaitDeletionStop({
      timeoutMs: DELETE_STOP_TIMEOUT_MS,
      requestStop: () => session.stop(),
      isIdle: () => {
        session.stop();
        return !session.isRunning() && !session.isBusy();
      },
    });
    this.host.remove(sessionId, session);
  }
}
