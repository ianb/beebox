/**
 * Collect the audio from a streamed Gemini Interactions API response.
 *
 * The direct Gemini speech route asks for a stream and buffers it whole, even
 * though the browser still receives one finished WAV. Measured 2026-10-04 on
 * `gemini-3.8-flash-lite-tts`: the streamed request finished in 1.9 / 3.2 /
 * 6.2 s where the unary one took 2.7 / 4.3 / 9.0 s for 3, 10 and 27 seconds of
 * speech (medians of five). Playing chunks as they arrive (about 1.0 s to the
 * first) needs a PCM player in the client and is not done here.
 *
 * The stream is server-sent events. Audio arrives as `step.delta` events whose
 * `delta` holds base64 16-bit PCM; everything else (`interaction.created`,
 * status updates, `step.start`/`step.stop`, the closing usage) is skipped. An
 * error event is the provider's failure, raised as one.
 */

import { z } from "zod";

/**
 * The stream failed after its HTTP 200: the provider sent an error event, an
 * event was not JSON, or the whole answer missed its deadline.
 */
export class InteractionStreamError extends Error {
  constructor(
    failure:
      | { kind: "error-event"; providerMessage: string | undefined }
      | { kind: "unparseable"; parseMessage: string }
      | { kind: "deadline"; seconds: number },
    options?: ErrorOptions,
  ) {
    const detail = failure.kind === "error-event"
      ? failure.providerMessage ?? "error event with no message"
      : failure.kind === "unparseable"
        ? `unparseable event: ${failure.parseMessage}`
        : `no complete answer within ${String(failure.seconds)}s`;
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

/** All PCM carried by the stream, concatenated in order. */
export async function collectInteractionAudio(body: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let pending = "";
  const take = (event: string): void => {
    const data = eventData(event);
    const audio = data === null ? null : audioFrom(data);
    if (audio !== null) chunks.push(audio);
  };
  // An explicit reader rather than `for await`: the frontend's DOM typings,
  // which typecheck this file through the router types, lack async iteration.
  const reader = body.getReader();
  const decoder = new TextDecoder();
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    pending = (pending + decoder.decode(read.value, { stream: true })).replaceAll("\r\n", "\n");
    let end = pending.indexOf("\n\n");
    while (end >= 0) {
      take(pending.slice(0, end));
      pending = pending.slice(end + 2);
      end = pending.indexOf("\n\n");
    }
  }
  pending += decoder.decode();
  if (pending.trim() !== "") take(pending);
  return Buffer.concat(chunks);
}
