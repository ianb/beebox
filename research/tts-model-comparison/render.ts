/**
 * Render every clip and variant for one or more models and replace those
 * models' rows in results.json.
 *
 *   node --import tsx research/tts-model-comparison/render.ts --model <id> [--model <id> …] [--dry-run]
 *   node --import tsx research/tts-model-comparison/render.ts --all [--dry-run]
 *
 * Each model's adapter turns a variant into one request, or into none when
 * the model has no channel for that variant's direction (recorded as a row
 * with channel "none available" and no file). A model's rows are written only
 * when every one of its requests succeeded, so a failed run never replaces
 * good takes; rerun the failed model alone. Models on different providers run
 * side by side; requests to one provider go one at a time.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { interactionAudioChunks } from "../../beebox/src/core/tts/interaction-stream.ts";
import { collectAudio, createTtsService } from "../../beebox/src/services/tts.ts";
import {
  audioDir,
  type Clip,
  type Direction,
  loadResults,
  type Model,
  NO_CHANNEL,
  type Render,
  saveResults,
  secret,
  takeKey,
  transcriptCheck,
  type Variant,
  variantText,
} from "./lib.ts";

/** One request, built without sending it. */
export interface Built {
  /** How direction reached the model, shown on the page; "none" for a text variant. */
  channel: string;
  /** The direction-bearing request fields as the page shows them, " | " between fields. */
  sent?: string;
  /** The endpoint, or the box service that sends it. */
  url: string;
  /** The request body (for the box service: its text and instructions). */
  body: Record<string, unknown>;
  /** Characters sent, for a cost at list price. */
  chars: number;
}

interface Sent {
  audio: Buffer;
  ttfbMs?: number;
  generationId?: string;
  usage?: Record<string, number>;
}

/** A request that answered an HTTP error. The body is never kept: it may echo the request. */
class RequestFailed extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
    this.name = "RequestFailed";
  }
}

export interface Adapter {
  /** Requests to one lane go one at a time. */
  lane: string;
  extension: "mp3" | "wav";
  /** The request for a variant, or undefined when the model has no channel for its direction. */
  request(variant: Variant, clip: Clip): Built | undefined;
  send(built: Built): Promise<Sent>;
  /** USD for a take; `estimated` when it is list price, not a billed amount. */
  cost(built: Built, take: { seconds: number; usage?: Record<string, number>; generationId?: string }): Promise<{ usd: number; estimated: boolean } | undefined>;
}

/** The variant's words with a direction form in their place, or the plain words for a text variant. */
type Form = (direction: Direction) => { channel: string; input: string; extra?: Record<string, unknown>; sent: string } | undefined;

/** Build a request for a variant: the plain text, or a direction form, or nothing. */
function build(variant: Variant, clip: Clip, form: Form | undefined, make: (input: string, extra: Record<string, unknown>) => { url: string; body: Record<string, unknown>; chars?: number }): Built | undefined {
  const text = variantText(clip, variant);
  if (variant.direction === undefined) {
    const { url, body, chars } = make(text, {});
    return { channel: "none", url, body, chars: chars ?? text.length };
  }
  const directed = form?.(variant.direction);
  if (directed === undefined) return undefined;
  const { url, body, chars } = make(directed.input, directed.extra ?? {});
  return { channel: directed.channel, sent: directed.sent, url, body, chars: chars ?? directed.input.length };
}

/** Gemini 3.1's channel: the prose in front of the text, and bracket tags in it when the direction has them. */
function prefixChannel(direction: Direction): string {
  return direction.tagged === undefined ? "prose prefix" : "prose prefix + inline [tags]";
}

/** `<prose>: "<tagged or text>"`, the old run's form; a final period of the prose gives way to the colon. */
function prefix(direction: Direction, text: string): string {
  return `${direction.prose.replace(/\.$/, "")}: "${direction.tagged ?? text}"`;
}

const inText = (channel: string, field: string, pick: (d: Direction) => string | undefined): Form => (d) => {
  const input = pick(d);
  return input === undefined ? undefined : { channel, input, sent: `${field}: ${input}` };
};

// ─── Sending ───────────────────────────────────────────────────────────────

const TIMEOUT_MS = 180_000;

async function post(url: string, init: { headers: Record<string, string>; body: unknown }): Promise<{ response: Response; ttfbMs: number }> {
  const started = performance.now();
  const response = await fetch(url, {
    method: "POST",
    headers: { ...init.headers, "Content-Type": "application/json" },
    body: JSON.stringify(init.body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const ttfbMs = Math.round(performance.now() - started);
  if (!response.ok) {
    await response.body?.cancel();
    throw new RequestFailed(response.status);
  }
  return { response, ttfbMs };
}

async function audioPost(url: string, init: { headers: Record<string, string>; body: unknown }): Promise<Sent> {
  const { response, ttfbMs } = await post(url, init);
  return { audio: Buffer.from(await response.arrayBuffer()), ttfbMs };
}

/** A 16-bit mono WAV header around raw PCM. */
function wav(pcm: Buffer, rate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * A key from the main checkout's beebox/.env (BBX_ENV_FILE overrides), for
 * providers the secret store does not hold. Never printed.
 */
function envKey(name: string): string {
  const file = process.env["BBX_ENV_FILE"] ?? join(homedir(), "src/beebox/beebox/.env");
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^([A-Z_][\dA-Z_]*)=(.*)$/.exec(line);
    if (match?.[1] === name && match[2] !== undefined) return match[2].replace(/^["']|["']$/g, "");
  }
  throw new Error(`${name} is not in ${file}`);
}

const round = (n: number, places: number): number => Math.round(n * 10 ** places) / 10 ** places;

/** List price × characters sent. */
const perChars = (usdPer1kChars: number): Adapter["cost"] => async (built) => ({ usd: round((built.chars / 1000) * usdPer1kChars, 6), estimated: true });

// ─── Adapters ──────────────────────────────────────────────────────────────

/** The box's own service (beebox/src/services/tts.ts), so a take is what the box sends. "" is no direction. */
function boxService(backend: "openai" | "gemini", cost: Adapter["cost"]): Adapter {
  const channel = backend === "openai" ? "instructions field" : "speech_metadata.style field";
  const field = backend === "openai" ? "instructions" : "speech_metadata.style";
  return {
    lane: backend === "openai" ? "openai" : "google",
    extension: "mp3",
    request: (variant, clip) =>
      build(variant, clip, (d) => ({ channel, input: variantText(clip, variant), extra: { instructions: d.prose }, sent: `${field}: ${d.prose}` }), (input, extra) => ({
        url: `box service (${backend})`,
        body: { text: input, instructions: extra["instructions"] ?? "" },
        chars: input.length + String(extra["instructions"] ?? "").length,
      })),
    async send(built) {
      const service = createTtsService({ backend, apiKey: secret(backend === "openai" ? "openai-thinking" : "gemini") });
      const started = performance.now();
      const stream = await service.streamSpeech(String(built.body["text"]), { instructions: String(built.body["instructions"]) });
      const ttfbMs = Math.round(performance.now() - started);
      return { audio: await collectAudio(stream), ttfbMs };
    },
    cost,
  };
}

/** OpenAI's speech endpoint for a model the box does not ship. */
function openAi(apiModel: string, voice: string, instructions: boolean, usdPer1kChars: number): Adapter {
  return {
    lane: "openai",
    extension: "mp3",
    request: (variant, clip) =>
      build(variant, clip, instructions ? (d) => ({ channel: "instructions field", input: variantText(clip, variant), extra: { instructions: d.prose }, sent: `instructions: ${d.prose}` }) : undefined, (input, extra) => ({
        url: "https://api.openai.com/v1/audio/speech",
        body: { model: apiModel, input, voice, response_format: "mp3", ...extra },
        chars: input.length + String(extra["instructions"] ?? "").length,
      })),
    send: (built) => audioPost(built.url, { headers: { Authorization: `Bearer ${secret("openai-thinking")}` }, body: built.body }),
    cost: perChars(usdPer1kChars),
  };
}

/** Gemini list prices per million tokens (ai.google.dev/gemini-api/docs/pricing). */
interface GeminiRates {
  text: number;
  audio: number;
}

/** Gemini audio is 32 tokens per second; text about 4 characters per token. For takes with no reported usage. */
function geminiCost(rates: GeminiRates): Adapter["cost"] {
  return async (built, take) => {
    const text = take.usage?.["textInTokens"] ?? built.chars / 4;
    const audio = take.usage?.["audioOutTokens"] ?? take.seconds * 32;
    return { usd: round((text * rates.text + audio * rates.audio) / 1e6, 7), estimated: true };
  };
}

/** The closing usage of a Gemini Interactions stream, if it carries one. */
function streamUsage(sse: string): Record<string, number> | undefined {
  for (const event of sse.split("\n\n")) {
    const data = event.split("\n").find((line) => line.startsWith("data:"))?.slice(5).trim();
    if (data === undefined || !data.includes("\"usage\"")) continue;
    const json = JSON.parse(data) as { interaction?: { usage?: { total_input_tokens?: number; output_tokens_by_modality?: { modality: string; tokens: number }[] } } };
    const usage = json.interaction?.usage;
    if (usage === undefined) continue;
    const audio = usage.output_tokens_by_modality?.find((m) => m.modality === "audio")?.tokens;
    if (usage.total_input_tokens === undefined || audio === undefined) continue;
    return { textInTokens: usage.total_input_tokens, audioOutTokens: audio };
  }
  return undefined;
}

/**
 * Gemini on Google's Interactions API, the box service's request with the
 * model swapped. 3.8 reads direction from a speech_metadata annotation; 3.1
 * answers 400 to one ("Speech metadata is not supported for this model"), so
 * it gets the prose in front of the text.
 */
function geminiDirect(apiModel: string, mode: "metadata" | "prefix", rates: GeminiRates): Adapter {
  return {
    lane: "google",
    extension: "wav",
    request: (variant, clip) =>
      build(
        variant,
        clip,
        mode === "metadata"
          ? (d) => ({ channel: "speech_metadata.style field", input: variantText(clip, variant), extra: { style: d.prose }, sent: `speech_metadata.style: ${d.prose}` })
          : (d) => {
              const input = prefix(d, variantText(clip, variant));
              return { channel: prefixChannel(d), input, sent: `text: ${input}` };
            },
        (input, extra) => ({
          url: "https://generativelanguage.googleapis.com/v1beta/interactions",
          body: {
            model: apiModel,
            stream: true,
            store: false,
            input: [{ type: "user_input", content: [{ type: "text", text: input, ...(extra["style"] === undefined ? {} : { annotations: [{ type: "speech_metadata", style: extra["style"] }] }) }] }],
            generation_config: { speech_config: [{ voice: "Zephyr" }] },
          },
          chars: input.length + String(extra["style"] ?? "").length,
        }),
      ),
    async send(built) {
      const { response, ttfbMs } = await post(built.url, { headers: { "x-goog-api-key": secret("gemini") }, body: built.body });
      if (response.body === null) throw new RequestFailed(response.status);
      const [audioBody, usageBody] = response.body.tee();
      const usageText = new Response(usageBody).text();
      const chunks: Buffer[] = [];
      for await (const chunk of interactionAudioChunks(audioBody)) chunks.push(chunk);
      const usage = streamUsage(await usageText);
      return { audio: wav(Buffer.concat(chunks), 24_000), ttfbMs, ...(usage === undefined ? {} : { usage }) };
    },
    cost: geminiCost(rates),
  };
}

/** OpenRouter's billed amount for a request; the lookup can lag the answer by a few seconds. */
async function openRouterCost(generationId: string | undefined): Promise<{ usd: number; estimated: boolean } | undefined> {
  if (generationId === undefined) return undefined;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const response = await fetch(`https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(generationId)}`, { headers: { Authorization: `Bearer ${secret("openrouter")}` } });
    if (response.ok) {
      const json = (await response.json()) as { data?: { total_cost?: unknown } };
      if (typeof json.data?.total_cost === "number") return { usd: json.data.total_cost, estimated: false };
    } else {
      await response.body?.cancel();
    }
    await new Promise((resolve) => setTimeout(resolve, 3000 * attempt));
  }
  console.warn(`openrouter: no billed amount for ${generationId}; the take has no cost`);
  return undefined;
}

interface OpenRouterSpec {
  apiModel: string;
  voice: string;
  format: "mp3" | "pcm";
  form?: (clip: Clip, variant: Variant) => Form;
  /** Request fields every request carries. */
  extra?: Record<string, unknown>;
}

/** OpenRouter's speech endpoint. Gemini answers 24 kHz 16-bit mono PCM only. */
function openRouter(spec: OpenRouterSpec): Adapter {
  return {
    lane: `openrouter ${spec.apiModel}`,
    extension: spec.format === "pcm" ? "wav" : "mp3",
    request: (variant, clip) =>
      build(variant, clip, spec.form?.(clip, variant), (input, extra) => ({
        url: "https://openrouter.ai/api/v1/audio/speech",
        body: { model: spec.apiModel, input, voice: spec.voice, response_format: spec.format, ...spec.extra, ...extra },
      })),
    async send(built) {
      const { response, ttfbMs } = await post(built.url, { headers: { Authorization: `Bearer ${secret("openrouter")}` }, body: built.body });
      const audio = Buffer.from(await response.arrayBuffer());
      const generationId = response.headers.get("x-generation-id") ?? undefined;
      return { audio: spec.format === "pcm" ? wav(audio, 24_000) : audio, ttfbMs, ...(generationId === undefined ? {} : { generationId }) };
    },
    cost: (_built, take) => openRouterCost(take.generationId),
  };
}

const providerOption = (provider: string, channel: (value: string) => string, pick: (d: Direction) => Record<string, unknown> | undefined): ((clip: Clip, variant: Variant) => Form) => (clip, variant) => (d) => {
  const options = pick(d);
  if (options === undefined) return undefined;
  const fields = Object.entries(options).map(([k, v]) => `${k}=${String(v)}`).join(", ");
  return { channel: channel(fields), input: variantText(clip, variant), extra: { provider: { options: { [provider]: options } } }, sent: `provider.options.${provider}: ${fields}` };
};

function elevenLabs(apiModel: string, tags: boolean, usdPer1kChars: number): Adapter {
  return {
    lane: "elevenlabs",
    extension: "mp3",
    request: (variant, clip) =>
      build(variant, clip, tags ? inText("inline [audio tags]", "text", (d) => d.tagged) : undefined, (input) => ({
        url: "https://api.elevenlabs.io/v1/text-to-speech/iP95p4xoKVk53GoZ742B?output_format=mp3_44100_128",
        body: { text: input, model_id: apiModel },
      })),
    send: (built) => audioPost(built.url, { headers: { "xi-api-key": envKey("ELEVENLABS_API_KEY") }, body: built.body }),
    cost: perChars(usdPer1kChars),
  };
}

function cartesia(apiModel: string, usdPer1kChars: number): Adapter {
  return {
    lane: "cartesia",
    extension: "mp3",
    request: (variant, clip) =>
      build(
        variant,
        clip,
        (d) => {
          if (d.cartesia === undefined) return undefined;
          const config = d.cartesia;
          const fields = Object.entries(config).map(([k, v]) => `${k}=${String(v)}`).join(", ");
          return { channel: `generation_config.emotion=${config.emotion}`, input: variantText(clip, variant), extra: { generation_config: config }, sent: `generation_config: ${fields}` };
        },
        (input, extra) => ({
          url: "https://api.cartesia.ai/tts/bytes",
          body: {
            model_id: apiModel,
            transcript: input,
            voice: { mode: "id", id: "6ccbfb76-1fc6-48f7-b71d-91ac6298247b" },
            language: "en",
            output_format: { container: "mp3", sample_rate: 44_100, bit_rate: 128_000 },
            ...extra,
          },
        }),
      ),
    send: (built) => audioPost(built.url, { headers: { "X-API-Key": envKey("CARTESIA_API_KEY"), "Cartesia-Version": "2025-04-16" }, body: built.body }),
    cost: perChars(usdPer1kChars),
  };
}

/** Deepgram: Aura models on /v1/speak, Flux on /v2/speak. Neither takes direction. */
function deepgram(apiModel: string, version: "v1" | "v2", usdPer1kChars: number): Adapter {
  return {
    lane: "deepgram",
    extension: "mp3",
    request: (variant, clip) => build(variant, clip, undefined, (input) => ({ url: `https://api.deepgram.com/${version}/speak?model=${apiModel}&encoding=mp3`, body: { text: input } })),
    send: (built) => audioPost(built.url, { headers: { Authorization: `Token ${envKey("DEEPGRAM_API_KEY")}` }, body: built.body }),
    cost: perChars(usdPer1kChars),
  };
}

const voxtral: Adapter = {
  lane: "mistral",
  extension: "wav",
  request: (variant, clip) =>
    build(variant, clip, inText("inline [emotion=…]/[pace=…] tags", "input", (d) => d.voxtral), (input) => ({
      url: "https://api.mistral.ai/v1/audio/speech",
      body: { model: "voxtral-mini-tts-3-0", input, voice_id: "voice_478", response_format: "wav" },
    })),
  async send(built) {
    const { response, ttfbMs } = await post(built.url, { headers: { Authorization: `Bearer ${secret("mistral")}` }, body: built.body });
    const json = (await response.json()) as { audio_data?: unknown };
    if (typeof json.audio_data !== "string") throw new RequestFailed(response.status);
    return { audio: Buffer.from(json.audio_data, "base64"), ttfbMs };
  },
  cost: perChars(0.013),
};

const GEMINI_31_PREFIX = (clip: Clip, variant: Variant): Form => (d) => {
  const input = prefix(d, variantText(clip, variant));
  return { channel: prefixChannel(d), input, sent: `input: ${input}` };
};

/** Every model in results.json, by id. */
export const ADAPTERS: Record<string, Adapter> = {
  "gpt-4o-mini-tts-2025-03-20": boxService("openai", perChars(0.0167)),
  "gpt-4o-mini-tts-2025-12-15": openAi("gpt-4o-mini-tts-2025-12-15", "marin", true, 0.0167),
  "tts-1-hd": openAi("tts-1-hd", "nova", false, 0.03),
  "gemini-3.1-flash-tts": openRouter({ apiModel: "google/gemini-3.1-flash-tts-preview", voice: "Zephyr", format: "pcm", form: GEMINI_31_PREFIX }),
  "gemini-3.8-flash-tts-direct": geminiDirect("gemini-3.8-flash-tts", "metadata", { text: 0.5, audio: 9 }),
  "gemini-3.8-flash-lite-tts-direct": boxService("gemini", geminiCost({ text: 0.5, audio: 6 })),
  "gemini-3.1-flash-tts-preview-direct": geminiDirect("gemini-3.1-flash-tts-preview", "prefix", { text: 1, audio: 20 }),
  "mai-voice-2": openRouter({
    apiModel: "microsoft/mai-voice-2",
    voice: "en-US-Harper:MAI-Voice-2",
    format: "mp3",
    form: providerOption("azure", (f) => `azure ${f}`, (d) => (d.azure === undefined ? undefined : { style: d.azure, styledegree: 1.5 })),
  }),
  "mai-voice-2-flash": openRouter({
    apiModel: "microsoft/mai-voice-2-flash",
    voice: "en-US-Harper:MAI-Voice-2",
    format: "mp3",
    form: providerOption("azure", (f) => `azure ${f}`, (d) => (d.azure === undefined ? undefined : { style: d.azure, styledegree: 1.5 })),
  }),
  "fish-s2.1-pro": openRouter({
    apiModel: "fish-audio/s2.1-pro",
    voice: "9a9cf47702da476aa4629e2506d4a857",
    format: "mp3",
    form: () => (d) =>
      d.tagged === undefined
        ? undefined
        : { channel: "inline [tags], normalize=false", input: d.tagged, extra: { provider: { options: { "fish-audio": { normalize: false } } } }, sent: `input: ${d.tagged} | provider.options["fish-audio"]: normalize=false` },
  }),
  "minimax-2.8-turbo": openRouter({
    apiModel: "minimax/speech-2.8-turbo",
    voice: "English_expressive_narrator",
    format: "mp3",
    form: providerOption("minimax", (f) => `${f} (provider option, not confirmed)`, (d) => (d.minimax === undefined ? undefined : { emotion: d.minimax })),
  }),
  eleven_v3: elevenLabs("eleven_v3", true, 0.1),
  eleven_flash_v2_5: elevenLabs("eleven_flash_v2_5", false, 0.05),
  "sonic-3.6": cartesia("sonic-3.6", 0.049),
  "sonic-turbo": cartesia("sonic-turbo", 0.049),
  "aura-2-thalia-en": deepgram("aura-2-thalia-en", "v1", 0.03),
  "flux-hannah-en": deepgram("flux-hannah-en", "v2", 0.045),
  "grok-voice-tts": openRouter({ apiModel: "x-ai/grok-voice-tts-1.0", voice: "eve", format: "mp3", form: () => inText("inline <span>/[event] tags", "input", (d) => d.grok) }),
  "voxtral-mini-tts-3": voxtral,
};

// ─── Running ───────────────────────────────────────────────────────────────

async function transcribe(audio: Buffer, extension: string): Promise<string> {
  const form = new FormData();
  form.append("model", "gpt-4o-transcribe");
  form.append("file", new Blob([new Uint8Array(audio)]), `take.${extension}`);
  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret("openai-thinking")}` },
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`transcription failed with status ${response.status}`);
  }
  const json = (await response.json()) as { text?: unknown };
  if (typeof json.text !== "string") throw new Error("transcription response has no text");
  return json.text;
}

/** Seconds of audio in any format ffmpeg reads, from its decoded length. */
function seconds(audio: Buffer): number {
  const pcm = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-f", "s16le", "-ac", "1", "-ar", "16000", "pipe:1"], { input: audio, maxBuffer: 256 * 1024 * 1024 });
  return pcm.length / 32_000;
}

export interface Job {
  clip: Clip;
  variant: Variant;
  built?: Built;
}

export function jobs(adapter: Adapter, clips: readonly Clip[]): Job[] {
  return clips.flatMap((clip) =>
    clip.variants.map((variant) => {
      const built = adapter.request(variant, clip);
      return built === undefined ? { clip, variant } : { clip, variant, built };
    }),
  );
}

/** Send, waiting out a rate limit (HTTP 429) on Google's API: 20 s × attempt, up to four tries. */
async function sendWithBackoff(adapter: Adapter, built: Built): Promise<Sent> {
  for (let tries = 1; ; tries += 1) {
    try {
      return await adapter.send(built);
    } catch (error) {
      const status = statusOf(error);
      if (status !== 429 || tries === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20_000 * tries));
    }
  }
}

/** The HTTP status of a failed request: ours, or the box service's ky HTTPError. */
function statusOf(error: unknown): number {
  if (error instanceof RequestFailed) return error.status;
  if (error instanceof Error && "response" in error && error.response instanceof Response) return error.response.status;
  return 0;
}

/** A failure as stored and printed: a status or an error class, never a response body. */
function failure(error: unknown): string {
  const status = statusOf(error);
  if (status !== 0) return `HTTP ${status}`;
  return error instanceof Error ? error.name : "unknown error";
}

async function renderJob(model: Model, adapter: Adapter, job: Job): Promise<{ render: Render; audio?: Buffer }> {
  const head = { model: model.id, clip: job.clip.id, variant: job.variant.id };
  if (job.built === undefined) return { render: { ...head, channel: NO_CHANNEL } };
  const built = job.built;
  const render: Render = { ...head, channel: built.channel, ...(built.sent === undefined ? {} : { sent: built.sent }), status: 0 };
  const started = performance.now();
  let sent: Sent;
  try {
    sent = await sendWithBackoff(adapter, built);
  } catch (error) {
    return { render: { ...render, status: statusOf(error), error: failure(error), totalMs: Math.round(performance.now() - started) } };
  }
  const totalMs = Math.round(performance.now() - started);
  const audioSec = seconds(sent.audio);
  if (audioSec < 0.3) return { render: { ...render, status: 200, error: "too little audio", totalMs } };
  const transcript = await transcribe(sent.audio, adapter.extension);
  const cost = await adapter.cost(built, { seconds: audioSec, ...(sent.usage === undefined ? {} : { usage: sent.usage }), ...(sent.generationId === undefined ? {} : { generationId: sent.generationId }) });
  const check = transcriptCheck({ text: variantText(job.clip, job.variant), transcript, ...(built.sent === undefined ? {} : { sent: built.sent }), ...(job.variant.formatting === undefined ? {} : { formatting: job.variant.formatting }) });
  return {
    render: {
      ...render,
      status: 200,
      ...(sent.ttfbMs === undefined ? {} : { ttfbMs: sent.ttfbMs }),
      totalMs,
      ...(sent.generationId === undefined ? {} : { generationId: sent.generationId }),
      ...(sent.usage === undefined ? {} : { usage: sent.usage }),
      file: `${takeKey(head)}.${adapter.extension}`,
      audioSec: round(audioSec, 2),
      rtf: round(totalMs / 1000 / audioSec, 2),
      ...(cost === undefined ? {} : { costUsd: cost.usd, costEstimated: cost.estimated }),
      transcript,
      ...check,
    },
    audio: sent.audio,
  };
}

/** Render one model; write its audio and rows only when every request succeeded. */
async function renderModel(model: Model, adapter: Adapter, clips: readonly Clip[]): Promise<boolean> {
  const done: { render: Render; audio?: Buffer }[] = [];
  for (const job of jobs(adapter, clips)) {
    const out = await renderJob(model, adapter, job);
    console.log(`${model.id} ${job.clip.code}-${job.variant.id}: ${out.render.channel === NO_CHANNEL ? NO_CHANNEL : `${out.render.status ?? ""}${out.render.error === undefined ? "" : ` ${out.render.error}`} in ${out.render.totalMs ?? 0} ms`}`);
    done.push(out);
  }
  const failed = done.filter((d) => d.render.channel !== NO_CHANNEL && d.audio === undefined);
  if (failed.length > 0) {
    console.error(`${model.id}: ${failed.length} of ${done.length} takes failed (${failed.map((d) => `${d.render.clip} ${d.render.variant}: ${d.render.error ?? ""}`).join("; ")}); results.json unchanged for this model`);
    return false;
  }
  for (const { render, audio } of done) {
    if (render.file !== undefined && audio !== undefined) writeFileSync(join(audioDir(), render.file), audio);
  }
  // Synchronous read-modify-write: models finishing side by side cannot interleave it.
  const results = loadResults();
  results.models = results.models.map((m) => (m.id === model.id ? { ...m, rendered: new Date().toISOString().slice(0, 10) } : m));
  results.renders = [...results.renders.filter((r) => r.model !== model.id), ...done.map((d) => d.render)];
  results.generatedAt = new Date().toISOString();
  saveResults(results);
  console.log(`${model.id}: ${done.length} rows written`);
  return true;
}

export function adapterFor(id: string): Adapter {
  const adapter = ADAPTERS[id];
  if (adapter === undefined) throw new Error(`model ${id} has no adapter in render.ts`);
  return adapter;
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { model: { type: "string", multiple: true }, all: { type: "boolean", default: false }, "dry-run": { type: "boolean", default: false } } });
  const results = loadResults();
  for (const m of results.models) adapterFor(m.id);
  const ids = values.all ? results.models.map((m) => m.id) : (values.model ?? []);
  if (ids.length === 0) throw new Error(`--all or --model <id> is required; models: ${results.models.map((m) => m.id).join(", ")}`);
  const models = ids.map((id) => {
    const model = results.models.find((m) => m.id === id);
    if (model === undefined) throw new Error(`unknown model ${id}`);
    return model;
  });
  if (values["dry-run"]) {
    for (const model of models) {
      for (const job of jobs(adapterFor(model.id), results.clips)) {
        console.log(`${model.id} ${job.clip.code}-${job.variant.id}: ${job.built === undefined ? NO_CHANNEL : job.built.channel}`);
      }
    }
    return;
  }
  const lanes = new Map<string, Model[]>();
  for (const model of models) {
    const lane = adapterFor(model.id).lane;
    lanes.set(lane, [...(lanes.get(lane) ?? []), model]);
  }
  const outcomes = await Promise.all(
    [...lanes.values()].map(async (laneModels) => {
      const ok: boolean[] = [];
      for (const model of laneModels) {
        ok.push(await renderModel(model, adapterFor(model.id), results.clips));
      }
      return laneModels.filter((_, n) => ok[n] !== true).map((m) => m.id);
    }),
  );
  const failed = outcomes.flat();
  if (failed.length > 0) throw new Error(`not written: ${failed.join(", ")}; rerun with --model for each`);
  console.log("render: done; run publish.ts next");
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
