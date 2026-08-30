export class SessionDeletingError extends Error {
  readonly sessionId: string;
  constructor(sessionId: string) {
    super("Chat session is being deleted or has been deleted");
    this.name = "SessionDeletingError";
    this.sessionId = sessionId;
  }
}

/** In-process tombstones protecting one SDK id from concurrent resume. */
export class SessionDeletionState {
  private readonly states = new Map<string, "deleting" | "deleted">();

  isBlocked(sessionId: string): boolean {
    return this.states.has(sessionId);
  }

  assertResumable(sessionId: string): void {
    if (this.isBlocked(sessionId)) throw new SessionDeletingError(sessionId);
  }

  begin(sessionId: string): void {
    if (this.states.get(sessionId) === "deleting") throw new SessionDeletingError(sessionId);
    this.states.set(sessionId, "deleting");
  }

  cancel(sessionId: string): void {
    if (this.states.get(sessionId) === "deleting") this.states.delete(sessionId);
  }

  finish(sessionId: string): void {
    this.states.set(sessionId, "deleted");
  }
}
