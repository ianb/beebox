/**
 * The Jev wire: the model and provider pins, the typed error, and the one POST
 * to OpenRouter's Decisions API that `decide` and `judge` share (`jev.ts`).
 */

/** `jev-latest` is not served by OpenRouter (trial, 2026-09-26). */
export const JEV_MODEL = "typesafe/jev-1.13";

export const JEV_PROVIDER = {
  only: ["TypeSafe"],
  allow_fallbacks: false,
  data_collection: "deny",
} as const;

/** Longer request bodies are refused before sending. */
export const JEV_MAX_REQUEST_CHARS = 80_000;

const TIMEOUT_MS = 30_000;

export class JevError extends Error {
  constructor(
    detail: string,
    public readonly code: "request" | "response",
  ) {
    super(`Jev ${code} error: ${detail}`);
    this.name = "JevError";
  }
}

/** A malformed or incomplete answer. */
export function responseError(detail: string): JevError {
  return new JevError(detail, "response");
}

export function probability(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

/** POST one serialized request; the parsed JSON body, or a JevError. */
export async function postDecisions(apiKey: string, requestBody: string): Promise<unknown> {
  if (requestBody.length > JEV_MAX_REQUEST_CHARS) {
    const detail = `request exceeded ${String(JEV_MAX_REQUEST_CHARS)} characters (${String(requestBody.length)})`;
    throw new JevError(detail, "request");
  }
  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/alpha/decisions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: requestBody,
    });
  } catch (_error) {
    // Never retain fetch errors: they may contain headers or captured text.
    const detail = `request failed within the ${String(TIMEOUT_MS)}ms timeout`;
    throw new JevError(detail, "request");
  }
  if (!response.ok) {
    const detail = `HTTP ${String(response.status)}`;
    throw new JevError(detail, "request");
  }
  try {
    return await response.json();
  } catch (_error) {
    // The body is withheld for the same reason as fetch errors.
    const detail = `HTTP ${String(response.status)} response was not JSON`;
    throw new JevError(detail, "response");
  }
}
