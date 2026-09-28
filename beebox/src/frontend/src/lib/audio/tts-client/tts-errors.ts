/** Thrown when playback is stopped before or while a queued utterance plays. */
export class PlaybackStoppedError extends Error {
  constructor() {
    super("Playback stopped");
    this.name = "PlaybackStoppedError";
  }
}

/** Wraps a non-Error value thrown during playback so callers always get an Error. */
export class PlaybackError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "PlaybackError";
  }
}
