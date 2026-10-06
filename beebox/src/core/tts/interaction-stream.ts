/**
 * The audio in a streamed Gemini Interactions API response, chunk by chunk.
 *
 * Gemini speech is always requested as a stream. Each audio chunk goes on to
 * the MP3 encoder as it arrives, so the browser starts playing at the
 * provider's first audio, about 0.7 s, rather than at the end of the clip
 * (`docs/plans/tts-streamed-playback.md`).
 *
 * The stream is server-sent events. Audio arrives as `step.delta` events whose
 * `delta` holds base64 16-bit PCM; everything else (`interaction.created`,
 * status updates, `step.start`/`step.stop`, the closing usage) is skipped. An
 * error event is the provider's failure, raised as one.
 */

import { z } from "zod";

/**
 * The stream failed after its HTTP 200: the provider sent an error event, or an
 * event was not JSON.
 */
export class InteractionStreamError extends Error {
  constructor(
    failure:
      | { kind: "error-event"; providerMessage: string | undefined }
      | { kind: "unparseable"; parseMessage: string },
    options?: ErrorOptions,
  ) {
    const detail = failure.kind === "error-event"
      ? failure.providerMessage ?? "error event with no message"
      : `unparseable event: ${failure.parseMessage}`;
    super(`Gemini stream failed: ${detail}`, options);
    this.name = "InteractionStreamError";
  }
}

const eventSchema = z.object({
  event_type: z.string(),
  delta: z.object({ type: z.string(), data: z.string().optional() }).optional(),
  error: z.object({ message: z.string().optional() }).optional(),
});

/** One SSE event's `data:` payload, or null for an event that has none. */
function eventData(event: string): string | null {
  const lines = event.split("\n").filter((line) => line.startsWith("data:"));
  if (lines.length === 0) return null;
  return lines.map((line) => line.slice("data:".length).trimStart()).join("\n");
}

function audioFrom(data: string): Buffer | null {
  if (data === "[DONE]") return null;
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch (e) {
    throw new InteractionStreamError({ kind: "unparseable", parseMessage: e instanceof Error ? e.message : String(e) });
  }
  const parsed = eventSchema.safeParse(json);
  // A shape we do not know is skipped, not fatal: an absent audio stream
  // still surfaces, as too few bytes to be speech (`services/tts.ts`).
  if (!parsed.success) return null;
  const event = parsed.data;
  if (event.event_type === "error" || event.error !== undefined) {
    throw new InteractionStreamError({ kind: "error-event", providerMessage: event.error?.message });
  }
  if (event.event_type !== "step.delta" || event.delta?.type !== "audio" || event.delta.data === undefined) return null;
  return Buffer.from(event.delta.data, "base64");
}

/**
 * The PCM carried by the stream, one chunk per audio event, as each arrives.
 * Stopping early (a consumer that returns, or throws) cancels the body, which
 * aborts the provider's response.
 */
export async function* interactionAudioChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<Buffer> {
  let pending = "";
  // An explicit reader rather than `for await`: the frontend's DOM typings,
  // which typecheck this file through the router types, lack async iteration.
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let finished = false;
  try {
    for (let read = await reader.read(); !read.done; read = await reader.read()) {
      pending = (pending + decoder.decode(read.value, { stream: true })).replaceAll("\r\n", "\n");
      let end = pending.indexOf("\n\n");
      while (end >= 0) {
        const audio = eventAudio(pending.slice(0, end));
        pending = pending.slice(end + 2);
        if (audio !== null) yield audio;
        end = pending.indexOf("\n\n");
      }
    }
    pending += decoder.decode();
    const last = pending.trim() === "" ? null : eventAudio(pending);
    if (last !== null) yield last;
    finished = true;
  } finally {
    if (!finished) await reader.cancel().catch((e: unknown) => {
      // The body may already be errored; the cancel only releases it.
      console.debug("[tts] interaction stream cancel after early stop:", e);
    });
  }
}

/** One SSE event's audio, if it carries any. */
function eventAudio(event: string): Buffer | null {
  const data = eventData(event);
  return data === null ? null : audioFrom(data);
}
