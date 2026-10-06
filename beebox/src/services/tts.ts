/**
 * Text-to-speech — the service the chat voice speaks through, as one interface
 * with a real implementation per backend and a fake.
 *
 * **This interface existed before this file did, and nothing called it.**
 * `createOpenAIAudioService` was declared, used by tests, and never constructed
 * in `src/`; the live path was an inline `ky.post` in the TTS route's fallback
 * branch. Adding a second backend to that branch would have made two dead
 * abstractions and one live if-ladder, so the seam was made real first
 * (`docs/plans/tts-backend-selection.md`, Track 1).
 *
 * A backend is chosen by the box (`core/tts/config.ts`), not by a key: granting
 * an OpenRouter key must never change what the box sounds like.
 */

import ky, { HTTPError, type RetryOptions } from "ky";
import { interactionAudioChunks } from "../core/tts/interaction-stream.js";
import { pcmToMp3 } from "../core/tts/mp3-encoder.js";
import { deliverStyle } from "../core/tts/style.js";
import { resolveVoice } from "../core/tts/voices.js";
import { toError } from "../shared/error-guards.js";
import { DEFAULT_TTS_INSTRUCTIONS, type TtsBackend } from "../shared/tts-backends.js";

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Speech on its way from the provider, handed over once its head has arrived
 * (`docs/plans/tts-streamed-playback.md`). Always MP3: the browser's streaming
 * player takes MP3, and Gemini's PCM is encoded on the way.
 */
export interface TtsAudioStream {
  contentType: "audio/mpeg";
  /**
   * The audio already received: at least `MIN_PLAUSIBLE_AUDIO_BYTES`, or the
   * whole clip when it was shorter. Proves the provider is sending audio before
   * anything reaches the browser.
   */
  head: Buffer;
  /** The rest of the clip. Can still fail: a mid-stream failure. */
  rest: AsyncIterable<Buffer>;
  /** Stop the clip: aborts the provider request and any encoder. */
  cancel(): void;
}

/**
 * Below this, a "successful" response is not audio. Gemini has been observed
 * answering HTTP 200 with a zero-length body; a clip that short reaches the
 * browser as silence the boxholder blames on their speakers, so it is an error
 * here rather than a result (principle 4, never silent). About 64 ms of
 * 64 kbit/s MP3, so waiting for it does not delay the start.
 */
const MIN_PLAUSIBLE_AUDIO_BYTES = 512;

/** A backend returned a 200 that cannot be audio. */
export class EmptyTtsResponseError extends Error {
  constructor({ backend, bytes }: { backend: TtsBackend; bytes: number }) {
    super(`TTS backend "${backend}" returned ${String(bytes)} bytes — too short to be speech`);
    this.name = "EmptyTtsResponseError";
  }
}

/** The clip was stopped by its consumer — the browser left. Nobody hears it. */
export class SpeechCancelledError extends Error {
  constructor() {
    super("Speech cancelled: the listener went away");
    this.name = "SpeechCancelledError";
  }
}

/** The whole clip did not arrive within `SPEECH_DEADLINE_MS`. */
export class TtsStreamTimeoutError extends Error {
  constructor({ backend, seconds }: { backend: TtsBackend; seconds: number }, options?: ErrorOptions) {
    super(`TTS backend "${backend}" did not finish the clip within ${String(seconds)}s`, options);
    this.name = "TtsStreamTimeoutError";
  }
}

/** The whole clip as one buffer — for scripts and tests that want a file. */
export async function collectAudio(audio: TtsAudioStream): Promise<Buffer> {
  const chunks = [audio.head];
  for await (const chunk of audio.rest) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// ─── Service interface ───────────────────────────────────────────────────────

export interface TtsService {
  readonly backend: TtsBackend;
  /**
   * Whether this backend can act on style direction at all. False means the
   * boxholder's `instructions` reach nothing — the UI says so rather than
   * letting a personality card carry a setting with no effect.
   */
  readonly stylable: boolean;
  /**
   * Start speaking `text`. Resolves once the head has arrived; rejects before
   * that with the provider's error, `EmptyTtsResponseError`, or
   * `TtsStreamTimeoutError`.
   */
  streamSpeech(text: string, opts?: {
    voice?: string;
    instructions?: string;
  }): Promise<TtsAudioStream>;
}

// ─── Real implementations ────────────────────────────────────────────────────

/**
 * Pick the voice this backend can serve. A `mapped` result is silent on
 * purpose — it is the boxholder's own chosen equivalent, not a degradation —
 * while a `substituted` one names what was lost, because nobody asked for it.
 */
function voiceFor(backend: TtsBackend, requested: string | undefined): string {
  const choice = resolveVoice({ backend, requested });
  if (choice.kind === "substituted") {
    console.warn(
      `[tts] backend "${backend}" has no voice "${choice.requested}" and no mapping for it — speaking as `
        + `"${choice.voice}". Add a mapping in core/tts/voices.ts, or pick a voice this backend offers.`,
    );
  }
  return choice.voice;
}

/**
 * Read `chunks` until the head is in hand, then hand the rest over. A clip that
 * ends shorter than the head is `EmptyTtsResponseError`. Any failure before
 * the head cancels the clip and rejects; after it, failures come out of `rest`.
 */
async function takeHead(
  chunks: AsyncIterator<Buffer>,
  { backend, cancel }: { backend: TtsBackend; cancel: () => void },
): Promise<TtsAudioStream> {
  const received: Buffer[] = [];
  let bytes = 0;
  let ended = false;
  try {
    while (bytes < MIN_PLAUSIBLE_AUDIO_BYTES) {
      const next = await chunks.next();
      if (next.done === true) {
        ended = true;
        break;
      }
      received.push(next.value);
      bytes += next.value.length;
    }
  } catch (e) {
    cancel();
    throw e;
  }
  if (bytes < MIN_PLAUSIBLE_AUDIO_BYTES) {
    cancel();
    throw new EmptyTtsResponseError({ backend, bytes });
  }
  async function* rest(): AsyncGenerator<Buffer> {
    if (ended) return;
    let finished = false;
    try {
      for (let next = await chunks.next(); next.done !== true; next = await chunks.next()) yield next.value;
      finished = true;
    } finally {
      // A consumer that stops early (the browser left) ends the clip.
      if (!finished) cancel();
    }
  }
  return { contentType: "audio/mpeg", head: Buffer.concat(received), rest: rest(), cancel };
}

/** A fetch body as Buffers; none for a response without a body. Stopping early cancels the body. */
async function* bodyChunks(body: ReadableStream<Uint8Array> | null): AsyncGenerator<Buffer> {
  if (body === null) return;
  const reader = body.getReader();
  let finished = false;
  try {
    for (let read = await reader.read(); !read.done; read = await reader.read()) yield Buffer.from(read.value);
    finished = true;
  } finally {
    if (!finished) await reader.cancel().catch((e: unknown) => {
      // The body may already be errored; the cancel only releases it.
      console.debug("[tts] response body cancel after early stop:", e);
    });
  }
}

/**
 * The whole-clip budget, from request to last byte. ky's `timeout` covers only
 * the wait for response headers, so a stream that stalls after them would
 * otherwise hold the reply open forever. Three attempts' worth, matching what
 * ky's retries can take before the head.
 */
const SPEECH_DEADLINE_MS = 90_000;

/**
 * One clip's abort plumbing: `signal` stops the provider request (and an
 * encoder), on `cancel()` or at the deadline, and `failure` turns the
 * deadline's abort into a `TtsStreamTimeoutError` wherever it surfaces.
 */
function clipControl(backend: TtsBackend): {
  signal: AbortSignal;
  cancel: () => void;
  failure: (e: unknown) => unknown;
} {
  const deadline = AbortSignal.timeout(SPEECH_DEADLINE_MS);
  const cancelled = new AbortController();
  return {
    signal: AbortSignal.any([deadline, cancelled.signal]),
    cancel: () => { cancelled.abort(new SpeechCancelledError()); },
    failure: (e) => deadline.aborted
      ? new TtsStreamTimeoutError({ backend, seconds: SPEECH_DEADLINE_MS / 1000 }, { cause: e })
      : e,
  };
}

/** `chunks`, with the deadline's abort reported as a timeout. */
async function* withDeadline(chunks: AsyncIterable<Buffer>, failure: (e: unknown) => unknown): AsyncGenerator<Buffer, void> {
  try {
    yield* chunks;
  } catch (e) {
    throw toError(failure(e));
  }
}

/** Start a clip: request, then read until the head, mapping the deadline. */
async function startClip(
  backend: TtsBackend,
  request: (signal: AbortSignal) => Promise<AsyncIterable<Buffer>>,
): Promise<TtsAudioStream> {
  const control = clipControl(backend);
  let chunks: AsyncIterable<Buffer>;
  try {
    chunks = await request(control.signal);
  } catch (e) {
    throw toError(control.failure(e));
  }
  const iterator = withDeadline(chunks, control.failure);
  // Abort the request and also close the iterator: the abort tears down a live
  // fetch, and closing the iterator releases the body reader even when nothing
  // is reading it at the time.
  const cancel = (): void => {
    control.cancel();
    void iterator.return().catch((e: unknown) => {
      console.debug("[tts] closing a cancelled clip's stream:", e);
    });
  };
  return takeHead(iterator, { backend, cancel });
}

/**
 * Per-attempt budget, and a retry policy that actually applies to these calls.
 *
 * `retry: 2` did nothing here: ky excludes POST from `retry.methods` by default
 * and sets `retryOnTimeout: false`, so both of the failures these endpoints
 * actually produce — a provider 502 and a stalled request — were single
 * attempts. OpenRouter documents 502/503/524/529 as transient and tells callers
 * to retry them, so the shorter per-attempt budget buys three chances inside
 * roughly the wall-clock one 60s attempt used to take.
 */
const TTS_ATTEMPT_MS = 30_000;
const TTS_RETRY = {
  limit: 2,
  methods: ["post"],
  // ky's defaults plus OpenRouter's own transient codes (524 infrastructure
  // timeout, 529 provider overloaded), which it does not know about.
  statusCodes: [408, 429, 500, 502, 503, 504, 524, 529],
  retryOnTimeout: true,
  shouldRetry: ({ error }) => (isLongRateLimit(error) ? false : undefined),
} satisfies RetryOptions;

/**
 * The longest `Retry-After` worth waiting for. A clip is useless once the reply
 * has moved on, and ky honors the header in full: a free-tier Gemini key over
 * its daily quota answered 429 with "retry in 26m12s", and every clip then sat
 * silent until the 90 s stream deadline (2026-10-05). Past this, the 429 fails
 * at once, carrying the provider's message to the chat.
 */
const MAX_RETRY_AFTER_MS = 2_000;

/** A 429 asking for a longer wait than `MAX_RETRY_AFTER_MS`. */
function isLongRateLimit(error: Error): boolean {
  if (!(error instanceof HTTPError) || error.response.status !== 429) return false;
  const header = error.response.headers.get("Retry-After");
  if (header === null) return false;
  const seconds = Number(header);
  const waitMs = Number.isNaN(seconds) ? Date.parse(header) - Date.now() : seconds * 1000;
  // An unparseable header is no reason to wait an unknown time.
  return Number.isNaN(waitMs) || waitMs > MAX_RETRY_AFTER_MS;
}

/** OpenAI's speech endpoint, which takes style direction in its own `instructions` field. Answers MP3. */
function createOpenAiTts(apiKey: string, fetchImpl: typeof fetch | undefined): TtsService {
  const api = ky.create({
    prefixUrl: "https://api.openai.com/v1",
    headers: { Authorization: `Bearer ${apiKey}` },
    retry: TTS_RETRY,
    timeout: TTS_ATTEMPT_MS,
    ...(fetchImpl !== undefined && { fetch: fetchImpl }),
  });

  return {
    backend: "openai",
    stylable: true,
    streamSpeech(text, opts) {
      const style = deliverStyle({ backend: "openai", instructions: opts?.instructions ?? DEFAULT_TTS_INSTRUCTIONS });
      return startClip("openai", async (signal) => {
        const res = await api.post("audio/speech", {
          signal,
          json: {
            model: "gpt-4o-mini-tts-2025-03-20",
            input: text,
            voice: voiceFor("openai", opts?.voice),
            response_format: "mp3",
            ...(style.kind === "field" && { instructions: style.instructions }),
          },
        });
        return bodyChunks(res.body);
      });
    },
  };
}

/**
 * The Gemini speech model. Flash-Lite rather than Flash: same voices and style
 * handling at two-thirds the audio price, and the 2026-10-04 benchmark
 * (`docs/plans/tts-backend-selection.md`) heard no reason to pay more for chat
 * replies.
 */
const GEMINI_TTS_MODEL = "gemini-3.8-flash-lite-tts";
const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Gemini on Google's own Interactions API, with the box's `gemini` key — the
 * only route. OpenRouter also serves this model, but cannot carry style
 * direction to it, and 3.8 reads direction placed in the text aloud, so that
 * route lost the boxholder's speaking style without a sound to show for it
 * (`core/tts/resolve.ts`).
 *
 * Style rides in a `speech_metadata` annotation, the field 3.8 reads it from.
 * `store: false` because the API otherwise keeps every request server-side
 * (55 days on the paid tier) to support follow-up turns speech never makes.
 * The answer is a stream of raw 24 kHz PCM events, encoded to MP3 as they
 * arrive (`core/tts/mp3-encoder.ts`).
 */
function createGeminiTts(apiKey: string, fetchImpl: typeof fetch | undefined): TtsService {
  return {
    backend: "gemini",
    stylable: true,
    streamSpeech(text, opts) {
      const style = deliverStyle({ backend: "gemini", instructions: opts?.instructions ?? DEFAULT_TTS_INSTRUCTIONS });
      return startClip("gemini", async (signal) => {
        const res = await ky.post("interactions", {
          prefixUrl: GEMINI_API_BASE_URL,
          headers: { "x-goog-api-key": apiKey },
          retry: TTS_RETRY,
          timeout: TTS_ATTEMPT_MS,
          signal,
          ...(fetchImpl !== undefined && { fetch: fetchImpl }),
          json: {
            model: GEMINI_TTS_MODEL,
            stream: true,
            store: false,
            input: [{
              type: "user_input",
              content: [{
                type: "text",
                text,
                ...(style.kind === "field" && {
                  annotations: [{ type: "speech_metadata", style: style.instructions }],
                }),
              }],
            }],
            generation_config: { speech_config: [{ voice: voiceFor("gemini", opts?.voice) }] },
          },
        });
        return res.body === null ? bodyChunks(null) : pcmToMp3(interactionAudioChunks(res.body), { signal });
      });
    },
  };
}

/**
 * Build the service for a chosen backend and its credential. There is no route
 * to choose: each backend lives at exactly one host, and `core/tts/resolve.ts`
 * records why passing a `ModelRoute` here was actively wrong. `fetch` is the
 * test seam for the HTTP calls.
 */
export function createTtsService(
  { backend, apiKey, fetch: fetchImpl }: { backend: TtsBackend; apiKey: string; fetch?: typeof fetch },
): TtsService {
  switch (backend) {
    case "openai":
      return createOpenAiTts(apiKey, fetchImpl);
    case "gemini":
      return createGeminiTts(apiKey, fetchImpl);
  }
}

// ─── Fake implementation ─────────────────────────────────────────────────────

export interface FakeTtsService extends TtsService {
  /** TTS calls recorded */
  speeches: Array<{ text: string; voice?: string; instructions?: string }>;
  /** How many clips were cancelled (the route cancels when the browser leaves). */
  readonly cancels: number;
}

/**
 * `emptyResponse` makes the fake produce a genuinely zero-length clip rather
 * than a flag meaning "pretend it was empty" — a mock written by the bug's
 * author encodes the bug, so the guard is asserted against the real shape.
 * The clip goes through the same `takeHead` as the real backends.
 */
export function createFakeTts(opts?: {
  backend?: TtsBackend;
  stylable?: boolean;
  emptyResponse?: boolean;
  /** Chunks after the first; the default is two more plausible chunks. */
  restChunks?: Buffer[];
  /** Thrown after the chunks above: a mid-stream failure. */
  failAfterHead?: Error;
  /** Waited on before each chunk after the head, so a test can hold the stream open. */
  beforeEachRestChunk?: () => Promise<void>;
}): FakeTtsService {
  const speeches: Array<{ text: string; voice?: string; instructions?: string }> = [];
  const backend = opts?.backend ?? "openai";
  let cancels = 0;
  // A minimal MP3 frame header, padded — enough to be a plausible chunk.
  const frame = (): Buffer => Buffer.concat([Buffer.from([0xFF, 0xFB, 0x90, 0x00]), Buffer.alloc(MIN_PLAUSIBLE_AUDIO_BYTES)]);
  async function* chunks(): AsyncGenerator<Buffer> {
    if (opts?.emptyResponse === true) return;
    yield frame();
    for (const chunk of opts?.restChunks ?? [frame(), frame()]) {
      await opts?.beforeEachRestChunk?.();
      yield chunk;
    }
    if (opts?.failAfterHead !== undefined) throw opts.failAfterHead;
  }
  return {
    backend,
    stylable: opts?.stylable ?? true,
    speeches,
    get cancels() { return cancels; },
    streamSpeech(text, callOpts) {
      speeches.push({
        text,
        ...(callOpts?.voice !== undefined && { voice: callOpts.voice }),
        ...(callOpts?.instructions !== undefined && { instructions: callOpts.instructions }),
      });
      return takeHead(chunks(), { backend, cancel: () => { cancels += 1; } });
    },
  };
}
