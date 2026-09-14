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

  /**
   * Whether this id has a registry entry at all — "might someone be in this
   * conversation right now", asked conservatively.
   *
   * `archiveChatSession` is the caller, and it wants exactly this looseness: a
   * chat is open from the moment its id is assigned, which is before the engine
   * has written a byte, and archiving it then would file away a conversation
   * the boxholder is sitting in. A false positive costs a refused archive; a
   * false negative files away a live chat.
   *
   * NOT the question a resume asks — see {@link hasLiveRun}. The two were one
   * predicate until an id that had only been *materialized* proved to be enough
   * to vouch for a resume.
   */
  hasAssignedSession(sessionId: string): boolean {
    if (this.isBlocked(sessionId)) return false;
    return this.host.find(sessionId) !== null || this.host.findPending(sessionId) !== null;
  }

  /**
   * Whether a run is actually live for this id — "is this a real conversation",
   * asked strictly. `resolveSessionAvailability` is the caller, and it uses this
   * to answer `resumable` for a chat that is mid-turn with no transcript on disk
   * yet.
   *
   * Registry presence is not evidence here, because `getOrCreate` builds an
   * entry for any id anything asks about: a control mutation on an id the box
   * had no record of registered it, and the resume gate then vouched for it
   * ahead of every check that would have caught the ghost — so a stale tab could
   * toggle a setting and send into a conversation that never existed, on a
   * guessed engine. A session object that has never run is not a conversation.
   * Once a turn has run there is a transcript, and the checks past the gate
   * answer from that; a coined chat is covered by the reservation gate beside it.
   */
  hasLiveRun(sessionId: string): boolean {
    if (this.isBlocked(sessionId)) return false;
    const session = this.host.find(sessionId) ?? this.host.findPending(sessionId);
    if (session === null) return false;
    return session.isRunning() || session.isBusy();
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
