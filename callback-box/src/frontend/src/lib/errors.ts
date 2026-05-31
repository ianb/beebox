/**
 * Shared, reusable frontend error classes.
 *
 * Most errors are best expressed as a local, purpose-named class right where
 * they're thrown. This module is only for shapes that genuinely recur — add a
 * class here only when it describes the same failure across many call sites.
 *
 * Note on construction: the `error/*` lint rules forbid a string/template
 * *literal* as the first argument of an Error constructor. Passing a dynamic
 * expression (e.g. `body.error || "Request failed"`) or a value computed into a
 * variable first is fine — only a bare literal at the call site is flagged.
 */

/**
 * A network/API request failed. Carries a human-readable detail — usually the
 * server's error message or an HTTP status line — for the caller to surface.
 * The detail is passed in (not hardcoded) because it describes the specific
 * failed request.
 */
export class RequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestError";
  }
}
