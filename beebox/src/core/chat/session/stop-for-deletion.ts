const STOP_POLL_MS = 25;

class ChatSessionStopTimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super("Timed out waiting for chat session to stop");
    this.name = "ChatSessionStopTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/** Request shutdown and poll until the session's close handler releases its lock. */
export async function awaitDeletionStop(options: { requestStop: () => void; isIdle: () => boolean; timeoutMs: number }): Promise<void> {
  options.requestStop();
  const deadline = Date.now() + options.timeoutMs;
  while (!options.isIdle()) {
    if (Date.now() >= deadline) throw new ChatSessionStopTimeoutError(options.timeoutMs);
    await new Promise<void>((resolve) => setTimeout(resolve, STOP_POLL_MS));
  }
}
