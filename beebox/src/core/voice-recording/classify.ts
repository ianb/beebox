/**
 * Pure classification of one HQ transcription attempt's failure
 * (`docs/plans/resilient-voice-recording.md`, Track 1). The HQ job branches on
 * this to decide whether to retry with backoff, halve the piece and restart,
 * or give up.
 *
 * Errors reach the job as a mix of shapes: ky's `HTTPError` (a `response`
 * whose body needs an async read), the codebase's `TranscriptionError`
 * shape (`permanent`/`code`, thrown before any request when a required key is
 * missing — see `MissingOpenRouterKeyError` in `core/transcription/index.ts`),
 * and a plain `Error` for a network failure/timeout that never got a
 * response. Reading a response body is async, so classification takes an
 * already-extracted, synchronous input rather than the raw `unknown` error —
 * the job (a later chunk) is what inspects the caught error and does any
 * needed async body read before calling this.
 */

/** MAI-Transcribe-2's documented too-long-to-diarize failure body. */
const DIARIZATION_UNAVAILABLE_MARKER = "diarization_unavailable";

export interface HqErrorClassificationInput {
  /**
   * The HTTP status the provider responded with. Absent for a network
   * error/timeout that never reached a response — the "transient, no
   * response" case.
   */
  status?: number;
  /**
   * The response body, when the caller already read it (async) — inspected
   * only to tell MAI's 503 `diarization_unavailable` apart from any other
   * 503. Omit when not read.
   */
  body?: string;
  /**
   * A `TranscriptionError`'s own `permanent` flag, for an error thrown before
   * any HTTP request happened (e.g. `MissingOpenRouterKeyError`) and so
   * carries no `status` at all.
   */
  permanent?: boolean;
}

export type HqErrorClassification = "transient" | "permanent" | "piece-too-long";

/**
 * Classify one HQ attempt's failure:
 * - `piece-too-long`: 408, 413, or a 503 whose body names
 *   `diarization_unavailable` (MAI's too-long-to-diarize answer).
 * - `transient`: no status at all (network error/timeout), 429, or any other
 *   5xx except 501.
 * - `permanent`: 501, 401, 403, any other 4xx, or an explicit
 *   `permanent: true` on a status-less error (a required credential is
 *   missing, so no retry will help).
 */
export function classifyHqError(input: HqErrorClassificationInput): HqErrorClassification {
  const { status, body } = input;

  if (status === 408 || status === 413) return "piece-too-long";
  if (status === 503 && bodyNamesDiarizationUnavailable(body)) return "piece-too-long";

  if (status !== undefined) {
    if (status === 429) return "transient";
    if (status >= 500) return status === 501 ? "permanent" : "transient";
    if (status >= 400) return "permanent";
    // A non-error status reaching here would be a caller bug; fall through to
    // the explicit-fields path below rather than guessing.
  }

  return input.permanent === true ? "permanent" : "transient";
}

function bodyNamesDiarizationUnavailable(body: string | undefined): boolean {
  return body !== undefined && body.includes(DIARIZATION_UNAVAILABLE_MARKER);
}
