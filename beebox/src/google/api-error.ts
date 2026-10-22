/**
 * Google's structured API error body, read off a failed ky request.
 *
 * Google REST APIs answer a failure with
 * `{error: {code, message, status, details: [{"@type": ".../google.rpc.ErrorInfo", reason, metadata}]}}`.
 * The HTTP status alone does not say what went wrong: a 403 can be a missing
 * OAuth scope (`ACCESS_TOKEN_SCOPE_INSUFFICIENT`) or an API that was never
 * enabled on the Cloud project (`SERVICE_DISABLED`), and the fix for one does
 * nothing for the other. This reads the body so a caller can tell them apart.
 */

import { isHTTPError } from "ky";
import { z } from "zod";

const ERROR_INFO_TYPE = "type.googleapis.com/google.rpc.ErrorInfo";

const googleErrorBodySchema = z.object({
  error: z.object({
    code: z.number().optional(),
    message: z.string().optional(),
    status: z.string().optional(),
    details: z.array(z.record(z.string(), z.unknown())).optional(),
  }),
});

const errorInfoSchema = z.object({
  "@type": z.literal(ERROR_INFO_TYPE),
  reason: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/** What a Google API failure said about itself. Every field may be missing. */
export interface GoogleApiError {
  /** HTTP status of the response. */
  httpStatus: number;
  /** Google's canonical status, e.g. `PERMISSION_DENIED`. */
  status: string | null;
  /** Google's human-readable message. */
  message: string | null;
  /** The `ErrorInfo` reason, e.g. `SERVICE_DISABLED`. */
  reason: string | null;
  /** The `ErrorInfo` metadata, e.g. `activationUrl`, `consumer`. */
  metadata: Record<string, string>;
}

/**
 * Parse a Google error response body. A body that is not Google's shape still
 * yields the HTTP status, so the caller can report something true.
 */
export function parseGoogleApiError(httpStatus: number, bodyText: string): GoogleApiError {
  const result: GoogleApiError = { httpStatus, status: null, message: null, reason: null, metadata: {} };
  let json: unknown;
  try {
    json = JSON.parse(bodyText);
  } catch (_e) {
    // Not JSON (an HTML error page, an empty body): only the status is known.
    return result;
  }
  const parsed = googleErrorBodySchema.safeParse(json);
  if (!parsed.success) return result;
  const { error } = parsed.data;
  result.status = error.status ?? null;
  result.message = error.message ?? null;
  for (const detail of error.details ?? []) {
    const info = errorInfoSchema.safeParse(detail);
    if (!info.success) continue;
    result.reason = info.data.reason ?? null;
    for (const [key, value] of Object.entries(info.data.metadata ?? {})) {
      if (typeof value === "string") result.metadata[key] = value;
    }
    break;
  }
  return result;
}

/**
 * Read Google's error out of a thrown value, or null when it is not an HTTP
 * failure (a network error, a schema mismatch on a 200).
 */
export async function readGoogleApiError(error: unknown): Promise<GoogleApiError | null> {
  if (!isHTTPError(error)) return null;
  let bodyText = "";
  try {
    bodyText = await error.response.clone().text();
  } catch (_e) {
    // Body already consumed or the stream failed: the status is still known.
  }
  return parseGoogleApiError(error.response.status, bodyText);
}

/**
 * Whether the failure is a token missing a required OAuth scope — the one
 * case where re-running the Google authorization flow helps.
 */
export function isScopeInsufficient(error: GoogleApiError): boolean {
  if (error.reason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT") return true;
  return error.status === "PERMISSION_DENIED"
    && /insufficient authentication scopes/i.test(error.message ?? "");
}
