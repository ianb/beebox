/**
 * Ask a question about an audio recording using a model that can actually
 * listen — Claude has no audio input modality, so anything beyond
 * transcription (pronunciation critique, tone, language identification,
 * "what's that sound?") goes through Gemini, which the box already uses
 * for image analysis (`cb describe-images`).
 *
 * Consumed by `cb chat ask-about-audio`, which pairs this with the
 * last-audio browser loopback (chat-last-audio-routes.ts).
 */

import { GoogleGenAI } from "@google/genai";

const AUDIO_QUESTION_MODEL = "gemini-2.5-flash";

export class AudioQuestionError extends Error {
  constructor(details: { finishReason?: string | undefined; blockReason?: string | undefined }) {
    const parts = ["audio model returned no answer"];
    if (details.finishReason) parts.push(`finishReason=${details.finishReason}`);
    if (details.blockReason) parts.push(`blockReason=${details.blockReason}`);
    super(parts.join(" "));
    this.name = "AudioQuestionError";
  }
}

/**
 * The user-role prompt wrapped around the caller's question. Exported for
 * tests; the framing keeps the model answering about the audio rather than
 * chatting with its speaker.
 */
export function buildAudioQuestionPrompt(question: string): string {
  return [
    "Listen to the attached audio recording (a voice message from the user of a personal-assistant system) and answer the question below about it.",
    "Answer the question directly and concretely, addressing the person who asked — do not address the speaker in the recording. Quote or transcribe the relevant moments of the audio when that supports the answer.",
    "",
    `Question: ${question}`,
  ].join("\n");
}

/** Resolve the Gemini API key from env (same vars `cb describe-images` uses). */
export function resolveGeminiKey(): string | null {
  return process.env["GEMINI_KEY"] || process.env["SKE_GEMINI_API_KEY"] || null;
}

export async function askAudioQuestion(
  apiKey: string,
  { audio, mimeType, question }: { audio: Buffer; mimeType: string; question: string }
): Promise<{ answer: string; model: string }> {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: AUDIO_QUESTION_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { text: buildAudioQuestionPrompt(question) },
          { inlineData: { mimeType, data: audio.toString("base64") } },
        ],
      },
    ],
  });

  const answer = (response.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text)
    .filter((text): text is string => typeof text === "string" && text.length > 0)
    .join("");
  if (!answer) {
    throw new AudioQuestionError({
      finishReason: response.candidates?.[0]?.finishReason,
      blockReason: response.promptFeedback?.blockReason,
    });
  }
  return { answer, model: AUDIO_QUESTION_MODEL };
}
