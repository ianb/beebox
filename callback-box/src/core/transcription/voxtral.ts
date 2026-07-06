/**
 * Audio transcription using Mistral Voxtral API.
 */

import ky, { type HTTPError } from "ky";
import type {
  TranscribeAudioParams,
  TranscriptionResult,
  DetailedTranscriptionResult,
} from "./index.js";
import { getMistralApiKey } from "../mistral-key.js";
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
  const apiKey = await getMistralApiKey(boxRoot);
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
    const httpErr = error as HTTPError;
    if (httpErr.response) {
      const parsed = await parseErrorResponse(httpErr.response);
      throw parsed;
    }

    throw new VoxtralNetworkError((error as Error).message);
  }
}
