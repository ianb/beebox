/**
 * Git commit-trailer parsing and the trailer-key vocabulary used by the
 * history browse UI.
 *
 * Leaf module: pure string parsing, no git/process dependency. The original
 * git.ts re-exports the public constants from here so callers keep importing
 * them from "cli/lib/git" unchanged.
 */

/**
 * Trailer keys that name a connector performing some action on a card.
 * For the browse UI these are treated as a single axis — selecting a
 * connector matches any of these trailers with that value.
 */
export const CONNECTOR_TRAILER_KEYS = [
  "Pulled-By",
  "Created-By",
  "Fetched-By",
  "Pushed-By",
  "Sent-By",
] as const;

/**
 * Trailer keys indicating a user-facing touchpoint (webapp, API call, voice/text input).
 */
export const TOUCHPOINT_TRAILER_KEYS = ["Source", "Endpoint", "Type"] as const;

/**
 * Trailer keys indicating feedback signal on a brief or card.
 */
export const FEEDBACK_TRAILER_KEYS = [
  "Thumbs",
  "Reactions",
  "Rating",
  "Feedback-Source",
] as const;

/**
 * Parse git trailers from a commit body (single-value).
 */
export function parseTrailers(body: string | undefined): Record<string, string> {
  const trailers: Record<string, string> = {};
  if (!body) return trailers;

  for (const line of body.split("\n")) {
    const match = line.match(/^([A-Za-z-]+):\s*(.+)$/);
    if (match) {
      trailers[match[1]!] = match[2]!;
    }
  }
  return trailers;
}

/**
 * Parse git trailers from a commit body (multi-value).
 */
export function parseTrailersMulti(body: string | undefined): Record<string, string | string[]> {
  const trailers: Record<string, string | string[]> = {};
  if (!body) return trailers;

  for (const line of body.split("\n")) {
    const match = line.match(/^([A-Za-z-]+):\s*(.+)$/);
    if (match) {
      const key = match[1]!;
      const value = match[2]!;
      const existing = trailers[key];
      if (existing === undefined) {
        trailers[key] = value;
      } else if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        trailers[key] = [existing, value];
      }
    }
  }
  return trailers;
}
