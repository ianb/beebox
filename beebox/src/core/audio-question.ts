/**
 * Ask a question about an audio recording using a model that can actually
 * listen — Claude has no audio input modality, so anything beyond
 * transcription (pronunciation critique, tone, language identification,
 * "what's that sound?") goes through Gemini, which the box already uses
 * for image analysis (`bbx scan-import`'s Gemini pass, and the chat agent's
 * own image-analysis subagents on captures).
 *
 * Consumed by `bbx chat ask-about-audio`, which pairs this with the
 * last-audio browser loopback (chat-last-audio-routes.ts).
 */

import ky from "ky";
import { isRecord } from "../lib/is-record.js";
import { OPENROUTER_BASE_URL, openRouterProvider, type ModelRoute } from "./openrouter.js";

export const AUDIO_QUESTION_MODEL = "gemini-3.7-flash";
/** The same model, under OpenRouter's `<author>/<model>` naming. */
const OPENROUTER_AUDIO_QUESTION_MODEL = `google/${AUDIO_QUESTION_MODEL}`;

class AudioQuestionError extends Error {
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
 *
 * `context` is conversational background supplied by the asking agent (what
 * the message responds to, what the user is working on). `transcript` is the
 * box's own automated transcription of the recording — framed as fallible so
 * the model listens to the audio rather than anchoring on the text, and
 * flags discrepancies, which is often the whole point of the question.
 */
export function buildAudioQuestionPrompt(opts: {
  question: string;
  context?: string | undefined;
  transcript?: string | undefined;
}): string {
  const lines = [
    "Listen to the attached audio recording (a voice message from the user of a personal-assistant system) and answer the question below about it.",
    "Answer the question directly and concretely, addressing the person who asked — do not address the speaker in the recording. Quote or transcribe the relevant moments of the audio when that supports the answer.",
  ];
  if (opts.context) {
    lines.push("", "Context from the conversation, provided by the assistant asking the question:", opts.context);
  }
  if (opts.transcript) {
    lines.push(
      "",
      "For reference, the system's automated transcription of this recording. It may contain errors — trust the audio over the transcript, and point out meaningful discrepancies when they bear on the question:",
      opts.transcript,
    );
  }
  lines.push("", `Question: ${opts.question}`);
  return lines.join("\n");
}

export interface AudioQuestionInput {
  audio: Buffer;
  mimeType: string;
  question: string;
  context?: string | undefined;
  transcript?: string | undefined;
}

/**
 * Ask the question over whichever route the box has
 * (`core/openrouter.ts`): Gemini directly when it holds a `gemini` key,
 * OpenRouter otherwise. Same model either way — OpenRouter's request is pinned
 * to Google, so the audio reaches the same place it always did.
 */
export async function askAudioQuestion(
  route: ModelRoute,
  input: AudioQuestionInput,
): Promise<{ answer: string; model: string }> {
  return route.via === "openrouter" ? askViaOpenRouter(route.apiKey, input) : askViaGemini(route.apiKey, input);
}

async function askViaGemini(
  apiKey: string,
  { audio, mimeType, question, context, transcript }: AudioQuestionInput,
): Promise<{ answer: string; model: string }> {
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: AUDIO_QUESTION_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { text: buildAudioQuestionPrompt({ question, context, transcript }) },
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

/**
 * OpenRouter speaks OpenAI's chat shape, where audio is an `input_audio`
 * content part carrying bare base64 and a bare format token — not a MIME type
 * and not a data URI, which is why the extension is pulled back out of the
 * MIME string here.
 */
async function askViaOpenRouter(
  apiKey: string,
  { audio, mimeType, question, context, transcript }: AudioQuestionInput,
): Promise<{ answer: string; model: string }> {
  const body = await ky
    .post("chat/completions", {
      prefixUrl: OPENROUTER_BASE_URL,
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 120_000,
      json: {
        model: OPENROUTER_AUDIO_QUESTION_MODEL,
        provider: openRouterProvider("google-ai-studio"),
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: buildAudioQuestionPrompt({ question, context, transcript }) },
              {
                type: "input_audio",
                input_audio: { data: audio.toString("base64"), format: audioFormatToken(mimeType) },
              },
            ],
          },
        ],
      },
    })
    .json<unknown>();

  const choice = isRecord(body) && Array.isArray(body["choices"]) ? body["choices"][0] : undefined;
  const message = isRecord(choice) ? choice["message"] : undefined;
  const answer = isRecord(message) && typeof message["content"] === "string" ? message["content"] : "";
  if (!answer) {
    const finishReason = isRecord(choice) && typeof choice["finish_reason"] === "string" ? choice["finish_reason"] : undefined;
    throw new AudioQuestionError({ finishReason });
  }
  return { answer, model: OPENROUTER_AUDIO_QUESTION_MODEL };
}

/** `audio/mpeg` → `mp3`, `audio/wav` → `wav`, and so on. */
function audioFormatToken(mimeType: string): string {
  const subtype = mimeType.split("/")[1]?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (subtype === "mpeg" || subtype === "mpga") return "mp3";
  if (subtype === "x-wav" || subtype === "wave") return "wav";
  if (subtype === "x-m4a") return "m4a";
  return subtype === "" ? "wav" : subtype;
}
