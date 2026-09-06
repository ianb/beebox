/**
 * Audio transcription using Mistral Voxtral API.
 */

import ky, { isHTTPError } from "ky";
import type {
  TranscribeAudioParams,
  TranscriptionResult,
  DetailedTranscriptionResult,
} from "./index.js";
import { getMistralApiKey, MISTRAL_SECRET_NAME } from "../mistral-key.js";
import { isAuthRejection, markSecretVerificationFailed } from "../secrets/probe-registry.js";
import {
  MissingMistralKeyError,
  VoxtralNetworkError,
  parseErrorResponse,
  isTranscriptionError,
} from "./voxtral-errors.js";
import {
  buildVoxtralRequestBody,
  warnIfDiarizationUnlabeled,
  shapeVoxtralResult,
  type VoxtralResponse,
} from "./voxtral-request.js";
import { errorMessage } from "../../lib/error-guards.js";

// Re-exported for callers (chat-audio-routes, doctests) that post-process
// Voxtral output without going through transcribeAudioVoxtral.
export {
  joinSegmentTexts,
  repairMissingSentenceSpaces,
  findLastSpeakerLetter,
  nextSpeakerLetter,
  relabelDiarizedSpeakers,
} from "./voxtral-text.js";

const VOXTRAL_ENDPOINT = "https://api.mistral.ai/v1/audio/transcriptions";

/**
 * Transcribe audio using Mistral Voxtral API.
 *
 * `opts.diarization` enables Voxtral's speaker-labeling. When on, each
 * returned segment includes a `speaker_id` and the function rewrites
 * the response text as speaker-prefixed lines ("Speaker 0: …\n
 * Speaker 1: …") so the agent sees who said what.
 */
export async function transcribeAudioVoxtral(
  params: TranscribeAudioParams,
  opts?: { diarization?: boolean },
): Promise<TranscriptionResult | DetailedTranscriptionResult> {
  opts = opts ?? {};
  const { boxRoot, options } = params;
  const diarization = opts.diarization === true;
  const apiKey = await getMistralApiKey(boxRoot, { observe: true });
  if (!apiKey) {
    throw new MissingMistralKeyError();
  }

  const { body, boundary } = buildVoxtralRequestBody(params, { diarization });

  try {
    const result = await ky
      .post(VOXTRAL_ENDPOINT, {
        body,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        retry: 2,
        timeout: 120_000,
      })
      .json<VoxtralResponse>();

    if (diarization) {
      warnIfDiarizationUnlabeled(result);
    }

    return shapeVoxtralResult(result, {
      diarization,
      wordTimestamps: options?.wordTimestamps === true,
    });
  } catch (error) {
    if (isTranscriptionError(error)) {
      throw error;
    }

    // ky HTTPError — parse the response for error details
    if (isHTTPError(error)) {
      // A real use rejected for auth is the strongest evidence there is that
      // the stored key is expired or revoked — stronger than any probe, since
      // it is the actual call the box needs. Flagging it here is what makes
      // the admin page say "this key may be expired" instead of the boxholder
      // discovering it from a failed transcription card
      // (`docs/implemented-plans/secret-custody.md`, "Guided entry + validation").
      if (isAuthRejection(error.response.status)) {
        await markSecretVerificationFailed(
          MISTRAL_SECRET_NAME,
          `a transcription request was rejected with HTTP ${error.response.status}`,
        );
      }
      const parsed = await parseErrorResponse(error.response);
      throw parsed;
    }

    throw new VoxtralNetworkError(errorMessage(error));
  }
}
