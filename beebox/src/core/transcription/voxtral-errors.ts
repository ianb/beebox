/**
 * Error types and error-response parsing for the Voxtral transcription
 * client. Each error implements the shared `TranscriptionError` shape
 * (`permanent` + `code`) so callers can decide whether to retry.
 */

import { z } from "zod";
import type { TranscriptionError } from "./index.js";
import { truncateUpstreamBody } from "./upstream-body.js";

const voxtralErrorBodySchema = z.object({
  error: z.object({ message: z.string().optional(), code: z.string().optional() }).optional(),
  message: z.string().optional(),
});

export class MissingMistralKeyError extends Error implements TranscriptionError {
  readonly permanent = true;
  readonly code = "missing_api_key";
  constructor() {
    super(
      'Mistral API key not found — ask the boxholder to grant the "mistral" secret to this box'
    );
    this.name = "MissingMistralKeyError";
  }
}

export class VoxtralNetworkError extends Error implements TranscriptionError {
  readonly permanent = false;
  readonly code = "network_error";
  constructor(cause: string) {
    super(`Network error: ${cause}`);
    this.name = "VoxtralNetworkError";
  }
}

class VoxtralApiError extends Error implements TranscriptionError {
  readonly permanent: boolean;
  readonly code: string;
  readonly status: number;
  readonly body: string;
  constructor(
    { status, statusText, details }: { status: number; statusText: string; details: string },
    { permanent, code }: { permanent: boolean; code: string }
  ) {
    super(`Voxtral API error: ${status} ${statusText} - ${details}`);
    this.name = "VoxtralApiError";
    this.permanent = permanent;
    this.code = code;
    this.status = status;
    this.body = truncateUpstreamBody(details);
  }
}

export async function parseErrorResponse(
  response: Response
): Promise<VoxtralApiError> {
  let errorDetails: string;
  let errorCode: string | undefined;

  try {
    const raw: unknown = await response.json();
    const errorJson = voxtralErrorBodySchema.safeParse(raw).data;
    errorDetails =
      errorJson?.error?.message ?? errorJson?.message ?? JSON.stringify(raw);
    errorCode = errorJson?.error?.code;
  } catch (e) {
    console.warn("Voxtral error response was not JSON, falling back to text body:", e);
    errorDetails = await response.text();
  }

  const permanent = isPermanentError(response.status, errorCode);

  return new VoxtralApiError(
    { status: response.status, statusText: response.statusText, details: errorDetails },
    { permanent, code: errorCode ?? `http_${response.status}` }
  );
}

function isPermanentError(
  status: number,
  code: string | undefined
): boolean {
  if (status >= 400 && status < 500 && status !== 429) {
    return true;
  }

  const permanentCodes = [
    "invalid_api_key",
    "invalid_request_error",
    "invalid_file_format",
  ];

  if (code && permanentCodes.includes(code)) {
    return true;
  }

  return false;
}

export function isTranscriptionError(
  error: unknown
): error is Error & TranscriptionError {
  return (
    error instanceof Error &&
    "permanent" in error
  );
}
