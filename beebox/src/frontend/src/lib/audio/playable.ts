/**
 * Choose between streaming and buffered playback from the server's own
 * `Content-Type`.
 *
 * The TTS backends disagree about container: OpenAI returns `audio/mpeg`,
 * while Gemini asks OpenRouter for `pcm` and wraps it as `audio/wav`
 * (`services/tts.ts`). MediaSource plays the first and supports no WAV type at
 * all — and appending WAV to a source buffer opened as `audio/mpeg` does not
 * fail at `addSourceBuffer`. The element errors later with
 * MEDIA_ERR_SRC_NOT_SUPPORTED, so the utterance is simply lost.
 *
 * A blob plays either one, so anything unstreamable is buffered whole instead.
 */
import { playAudioBlob, playAudioStream } from "./context";

/** The media type from a `Content-Type` header, keeping only the `codecs`
 *  parameter — the one `MediaSource.isTypeSupported` accepts. */
export function mediaTypeOf(header: string | null): string | null {
  if (header === null) return null;
  const parts = header.split(";").map((part) => part.trim()).filter((part) => part !== "");
  const essence = parts[0];
  if (essence === undefined) return null;
  const codecs = parts.slice(1).find((part) => part.toLowerCase().startsWith("codecs="));
  return codecs === undefined ? essence : `${essence}; ${codecs}`;
}

export interface AudioPlayback {
  stop: () => void;
  finished: Promise<void>;
  /** The complete audio, or `null` when the download did not finish. */
  buffer: Promise<ArrayBuffer | null>;
}

/** Play a response body, streaming when its type allows and buffering when not. */
export function playAudioResponse(
  body: ReadableStream<Uint8Array>,
  opts: { contentType: string | null; label: string; onPlaying?: (() => void) | undefined },
): AudioPlayback {
  const { contentType, ...playOpts } = opts;
  if (contentType !== null && MediaSource.isTypeSupported(contentType)) {
    return playAudioStream(body, { ...playOpts, mimeType: contentType });
  }
  const downloaded = new Response(body).arrayBuffer();
  let stop = (): void => {};
  const finished = downloaded.then(async (full) => {
    const playing = playAudioBlob(full, {
      ...playOpts,
      ...(contentType === null ? {} : { mimeType: contentType }),
    });
    stop = playing.stop;
    await playing.finished;
  });
  return {
    stop: () => { stop(); },
    finished,
    buffer: downloaded.then((full) => full, () => null),
  };
}
