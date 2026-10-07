import { isRecord } from "@shared/is-record";

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

/**
 * A failed `/chat/tts` response, with a message a person can read: the
 * server's own `error` text when it sent one, which names the provider's reason
 * (a rate limit, a missing key), else the status and the start of the body.
 * The playback machine shows this message on the failed speech segment.
 */
class TtsRequestError extends Error {
  readonly status: number;

  constructor({ status, serverError, body }: { status: number; serverError: string | null; body: string }) {
    super(serverError ?? `HTTP ${String(status)}${body === "" ? "" : `: ${body.slice(0, 200)}`}`);
    this.name = "TtsRequestError";
    this.status = status;
  }
}

/** Read a failed response into a `TtsRequestError`. */
export async function ttsRequestError(response: Response): Promise<TtsRequestError> {
  const body = await response.text();
  let serverError: string | null = null;
  try {
    const parsed: unknown = JSON.parse(body);
    if (isRecord(parsed) && typeof parsed["error"] === "string" && parsed["error"] !== "") serverError = parsed["error"];
  } catch (_e) {
    /* ignore: a non-JSON body is reported as text */
  }
  return new TtsRequestError({ status: response.status, serverError, body });
}
