/**
 * Streaming speech playback through MediaSource: the head segment of a reply
 * starts playing after its first chunk instead of after the whole download.
 * Split from `context.ts`, which keeps the shared audio element and the
 * buffered paths.
 */

import { logSpeechEvent } from "../speech-test-log";
import {
  formatMediaElementFailure,
  formatPlaybackRejection,
  formatThrownError,
  getPlaybackAudioElement,
  type Playback,
} from "../context";

class StreamingSpeechPlaybackError extends Error {
  constructor() {
    super("Streaming speech audio failed during playback");
    this.name = "StreamingSpeechPlaybackError";
  }
}

export interface StreamPlayback extends Playback {
  /**
   * Resolves to the fully-downloaded audio bytes once the stream has been
   * read to completion, or `null` if playback was stopped / errored before
   * the download finished. A null result means the audio is incomplete and
   * must NOT be cached.
   */
  buffer: Promise<ArrayBuffer | null>;
}

class SourceBufferAppendError extends Error {
  constructor(event: "error" | "abort") {
    super(`Streaming speech audio could not be decoded (SourceBuffer ${event})`);
    this.name = "SourceBufferAppendError";
  }
}

/**
 * Append one chunk and wait for the buffer to take it. A chunk the browser
 * cannot decode fires `error` and then `updateend`; listening for `updateend`
 * alone resolved that as success, and the clip hung or failed late. Now it
 * rejects, and the segment fails at once.
 */
export function appendChunk(sourceBuffer: SourceBuffer, chunk: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    const settle = (outcome: "updateend" | "error" | "abort") => () => {
      sourceBuffer.removeEventListener("updateend", onUpdateEnd);
      sourceBuffer.removeEventListener("error", onError);
      sourceBuffer.removeEventListener("abort", onAbort);
      if (outcome === "updateend") resolve();
      else reject(new SourceBufferAppendError(outcome));
    };
    const onUpdateEnd = settle("updateend");
    const onError = settle("error");
    const onAbort = settle("abort");
    sourceBuffer.addEventListener("updateend", onUpdateEnd);
    sourceBuffer.addEventListener("error", onError);
    sourceBuffer.addEventListener("abort", onAbort);
    try {
      // eslint-disable-next-line no-restricted-syntax -- a Uint8Array is a BufferSource at runtime; the TS 5.7 ArrayBufferLike generic makes the view non-assignable to BufferSource without this bridge.
      sourceBuffer.appendBuffer(chunk as BufferSource);
    } catch (e) {
      sourceBuffer.removeEventListener("updateend", onUpdateEnd);
      sourceBuffer.removeEventListener("error", onError);
      sourceBuffer.removeEventListener("abort", onAbort);
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/**
 * Stream audio into playback as it downloads, via MediaSource. Playback can
 * begin after the first chunk is buffered rather than waiting for the whole
 * response — the key latency win for the head segment of a response.
 *
 * Reads `stream` to completion while feeding a SourceBuffer; chunks are also
 * accumulated so the full buffer can be cached once the download finishes.
 * Only call when supportsMediaSource() is true.
 */
export function playAudioStream(
  stream: ReadableStream<Uint8Array>,
  opts?: { mimeType?: string; label?: string; onPlaying?: () => void },
): StreamPlayback {
  const mimeType = opts && opts.mimeType ? opts.mimeType : "audio/mpeg";
  const label = opts ? opts.label : undefined;
  const audio = getPlaybackAudioElement();
  const mediaSource = new MediaSource();
  const url = URL.createObjectURL(mediaSource);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  let stopped = false;

  let settleFinished: () => void = () => {};
  let rejectFinished: (error: Error) => void = () => {};
  let settleBuffer: (b: ArrayBuffer | null) => void = () => {};
  const finished = new Promise<void>((resolve, reject) => {
    settleFinished = resolve;
    rejectFinished = reject;
  });
  const buffer = new Promise<ArrayBuffer | null>((resolve) => { settleBuffer = resolve; });

  function assemble(): ArrayBuffer {
    const out = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out.buffer;
  }

  function cleanup() {
    try { URL.revokeObjectURL(url); } catch (_e) { /* ignore */ }
  }

  /**
   * End a failed clip completely. Without the pause, audio already buffered
   * kept playing after the segment was marked failed, over the next segment
   * the queue moved on to.
   */
  function fail(e: unknown) {
    if (stopped) return;
    stopped = true;
    reader.cancel().catch(() => { /* already closed */ });
    try { audio.pause(); } catch (_e) { /* ignore */ }
    cleanup();
    settleBuffer(null);
    rejectFinished(e instanceof Error ? e : new Error(String(e)));
  }

  audio.onplaying = () => {
    logSpeechEvent("audio.start", { label, streaming: true });
    opts?.onPlaying?.();
  };
  audio.onended = () => {
    cleanup();
    logSpeechEvent("audio.end", { label });
    settleFinished();
  };
  audio.onerror = () => {
    console.error(formatMediaElementFailure("stream", audio));
    fail(new StreamingSpeechPlaybackError());
  };

  mediaSource.addEventListener(
    "sourceopen",
    () => {
      let sourceBuffer: SourceBuffer;
      try {
        sourceBuffer = mediaSource.addSourceBuffer(mimeType);
      } catch (e) {
        console.error(`[audio] addSourceBuffer failed ${formatThrownError(e)}`);
        fail(e);
        return;
      }

      void (async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (stopped) { settleBuffer(null); return; }
            if (done) break;
            chunks.push(value);
            totalLength += value.length;
            await appendChunk(sourceBuffer, value);
          }
          // Whole response downloaded — bytes are complete and cacheable.
          settleBuffer(assemble());
          if (mediaSource.readyState === "open") {
            try { mediaSource.endOfStream(); } catch (_e) { /* ignore */ }
          }
        } catch (e) {
          if (stopped) return;
          console.error(`[audio] playAudioStream pump error ${formatThrownError(e)}`);
          fail(e);
        }
      })();
    },
    { once: true },
  );

  audio.src = url;
  audio.volume = 1;
  audio.play().catch((e) => {
    console.warn(formatPlaybackRejection("stream", e));
    fail(e);
  });

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      reader.cancel().catch(() => { /* already closed */ });
      try { audio.pause(); } catch (_e) { /* ignore */ }
      cleanup();
      logSpeechEvent("audio.end", { label, stopped: true });
      settleBuffer(null);
      settleFinished();
    },
    finished,
    buffer,
  };
}
