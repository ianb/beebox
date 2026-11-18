/**
 * Upstream error-body reading and truncation, shared by every HQ arm.
 *
 * A leaf module on purpose: the arms (`whisper`, `openrouter`,
 * `voxtral-errors`) need this at construction time, and importing it from the
 * `index.js` barrel — which imports the arms — made the one *value* cycle in
 * this directory. The remaining barrel back-edges are `import type`, which
 * erases.
 */

/** `≤500` chars — enough to see the provider's reason without logging megabytes. */
const UPSTREAM_BODY_MAX_CHARS = 500;

/** Truncate an upstream error body to the length the manifest/job are willing to carry. */
export function truncateUpstreamBody(body: string): string {
  return body.length > UPSTREAM_BODY_MAX_CHARS ? body.slice(0, UPSTREAM_BODY_MAX_CHARS) : body;
}

/**
 * An upstream error response's body, read once. `json` is the parsed value, or
 * `undefined` when the body is not JSON (a proxy's plain-text 413, say).
 *
 * A `Response` body can be read only once. The parsers used to call `json()`
 * and fall back to `text()` on the same body, and that second read throws: the
 * HTTP status was lost with it, so the HQ job saw a status-less error and
 * retried a too-long piece instead of halving it
 * (`plan:transcription-length-limits`).
 */
export async function readUpstreamErrorBody(response: Response): Promise<{ text: string; json: unknown }> {
  const text = await response.text();
  try {
    const json: unknown = JSON.parse(text);
    return { text, json };
  } catch (_e) {
    // ignore: a non-JSON error body is an expected shape; the caller keeps `text`.
    return { text, json: undefined };
  }
}
