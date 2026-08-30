// The real transcription call (`docs/plans/document-comments.md`, Track 4).
//
// TWO STEPS, NOT ONE. This returns text and nothing else; the client puts it in
// the composer, where it can be edited, and submits it through the ordinary
// `comments.add`. Better on three counts: the transcript is reviewable before
// anything is stored (Whisper mishears names and jargon), the audio only has to
// survive until the transcript returns rather than until the store write is
// acknowledged, and it matches `POST /api/chat/transcribe-audio`, which is
// already stateless upload-audio-get-text.
//
// IT CALLS OPENAI DIRECTLY rather than through beebox's
// `transcribeAudioHq`, and that is a boundary worth keeping: this app imports
// NOTHING outside its own package, and beebox does not export
// transcription (its public specifiers are `cards`, `schema`, `view-widgets` —
// "box code imports only the public specifiers, never engine internals").
// Making the dev-tooling app depend on the main system, and widening that
// system's public surface for a non-box consumer, is a larger change than one
// multipart POST.
//
// The key is `BBX_OPENAI_API_KEY` by boxholder decision (2026-08-22): it
// also names the embeddings key, and the box side keeps `openai` and
// `openai-thinking` separate on purpose, but a dev-surface key on the
// developer's own machine did not earn a third name. Recorded in
// `beebox/docs/secrets.md` so a later reader does not read this as the
// box-side distinction having eroded.

import { z } from "zod";

import type { TranscribeService } from "./services.js";
import {
  TranscriptionNotConfiguredError,
  TranscriptionRefusedError,
  TranscriptionShapeError,
} from "./transcribe-contract.js";

/** What the transcription endpoint returns. Parsed, not assumed. */
const transcriptionResponseSchema = z.object({ text: z.string() });

function extensionFor(mimeType: string): string {
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
}

export function createTranscribeService(): TranscribeService {
  return {
    async transcribe({ audio, mimeType }): Promise<{ text: string }> {
      const apiKey = process.env.BBX_OPENAI_API_KEY;
      if (apiKey === undefined || apiKey === "") throw new TranscriptionNotConfiguredError();

      const form = new FormData();
      const bytes = new Uint8Array(audio);
      form.append("file", new Blob([bytes], { type: mimeType }), `comment.${extensionFor(mimeType)}`);
      form.append("model", "whisper-1");
      form.append("response_format", "json");

      const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
      if (!response.ok) {
        // The recording is still in the page, so the message has to say what to
        // do next rather than only what went wrong.
        const detail = await response.text().catch(() => "");
        throw new TranscriptionRefusedError(response.status, detail.slice(0, 200));
      }
      const parsed = transcriptionResponseSchema.safeParse(await response.json());
      if (!parsed.success) throw new TranscriptionShapeError();
      return { text: parsed.data.text.trim() };
    },
  };
}

/** Canned text, for tests and for a machine with no key. */
export function createFakeTranscribeService(text: string): TranscribeService {
  return { transcribe: () => Promise.resolve({ text }) };
}
