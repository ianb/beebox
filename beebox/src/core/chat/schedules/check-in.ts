/**
 * Limits on a chat check-in (a `ChatSchedule`): how long one may be, and the
 * errors `ChatScheduleManager.addSchedule` throws instead of setting one.
 */

/**
 * The longest check-in. A check-in keeps one conversation going (a timer, a
 * "back in an hour"); anything longer is a reminder card that reaches the
 * person wherever they are (`bbx remind --in`).
 */
export const CHECK_IN_MAX_MS = 12 * 60 * 60 * 1000;

/** Node turns a longer `setTimeout` delay into 1 ms (`TimeoutOverflowWarning`). */
export const MAX_TIMEOUT_MS = 2 ** 31 - 1;

export class CheckInTooLongError extends Error {
  constructor(durationMs: number) {
    super(`A check-in can be at most 12h (asked for ${Math.round(durationMs / 60_000)}m); for longer, set a reminder with bbx remind --in or --at`);
    this.name = "CheckInTooLongError";
  }
}

export class CheckInNotSavedError extends Error {
  constructor(cause: unknown) {
    super("The check-in could not be saved, so it was not set", { cause });
    this.name = "CheckInNotSavedError";
  }
}

export class ScheduleForDeletingSessionError extends Error {
  readonly sessionId: string;
  constructor(sessionId: string) {
    super("Cannot schedule work for a conversation being deleted");
    this.name = "ScheduleForDeletingSessionError";
    this.sessionId = sessionId;
  }
}
