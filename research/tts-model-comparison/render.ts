/**
 * Render every clip for one model and replace that model's rows in
 * results.json.
 *
 *   node --import tsx research/tts-model-comparison/render.ts --model <id> [--dry-run]
 *
 * Only models with an adapter in PROVIDERS can be rendered. The September
 * renders were made by a generator that was not kept; add an adapter here to
 * render one of those models again. Results are written only when every
 * request succeeded, so a failed run never replaces good takes.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { audioDir, type Clip, loadResults, type Model, type Render, saveResults, secret, transcriptCheck } from "./lib.ts";

/** Takes of the pacing clip; other clips get one per variant. */
const PACING_REPEATS = 5;

interface Direction {
  /** How direction reaches the model, shown on the page. */
  channel: string;
  /** Text sent in place of the clip's text. */
  input?: string;
  /** Request fields other than the text. */
  options?: Record<string, unknown>;
}

interface Provider {
  model: Omit<Model, "rendered">;
  /** USD per 1,000 characters sent, for an estimated cost. */
  usdPer1kChars: number;
  /** Directed variant per clip id; a clip without one is rendered plain only. */
  directed: Record<string, Direction>;
  extension: "wav" | "mp3";
  synthesize(input: string, options: Record<string, unknown>): Promise<{ ok: true; audio: Buffer; seconds: number } | { ok: false; status: number }>;
}

/** Seconds of audio in a WAV file, from its fmt and data chunks. */
function wavSeconds(wav: Buffer): number {
  const byteRate = wav.readUInt32LE(28);
  let p = 12;
  while (p < wav.length - 8) {
    const id = wav.toString("ascii", p, p + 4);
    let size = wav.readUInt32LE(p + 4);
    if (id === "data") {
      // A streamed WAV may carry a placeholder size; use what is there.
      if (size === 0xffffffff || p + 8 + size > wav.length) size = wav.length - p - 8;
      return size / byteRate;
    }
    p += 8 + size;
  }
  throw new Error("WAV has no data chunk");
}

const voxtral: Provider = {
  model: {
    id: "voxtral-mini-tts-3",
    name: "Voxtral TTS 3",
    vendor: "mistral",
    apiModel: "voxtral-mini-tts-3-0",
    route: "Mistral direct",
    voice: "Sarah (voice_478)",
    listPrice: "$13 per million characters, tags included",
    note: "Inline [emotion=…] (34 values) and [pace=…] tags only; no instruction field (style instructions not available at launch). Pronunciation fixes go in a request-level phoneme_hints map of IPA phones, not in the text.",
  },
  usdPer1kChars: 0.013,
  extension: "wav",
  directed: {
    "2b-foreign-words": {
      channel: "request phoneme_hints (IPA), no inline tag",
      options: { phoneme_hints: { Schnapsidee: ["ʃ", "n", "a", "p", "s", "i", "d", "e"], Stammtisch: ["ʃ", "t", "a", "m", "t", "ɪ", "ʃ"] } },
    },
    "3-sarcasm": { channel: "inline [emotion=…] tags", input: "[emotion=sarcastic]Thanks for updating the spreadsheet. I can tell you put a lot of care into it." },
    "4-relief": { channel: "inline [emotion=…] tags", input: "[emotion=happy]It worked! [emotion=excited]After three weeks of broken builds, the whole thing ran start to finish, every single test green." },
    "5-anger": { channel: "inline [emotion=…]/[pace=…] tags", input: "[emotion=tense][pace=slow]I asked for the report on Monday. [emotion=critical]It's Thursday. [emotion=tense]I'm going to need it by the end of today." },
    "6-exhaustion": { channel: "inline [emotion=…]/[pace=…] tags", input: "[emotion=tired][pace=slow]I finished the last of the boxes. [sigh] I think I'll sit down for a minute before we start on the kitchen." },
  },
  async synthesize(input, options) {
    const response = await fetch("https://api.mistral.ai/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret("mistral")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "voxtral-mini-tts-3-0", input, voice_id: "voice_478", response_format: "wav", ...options }),
    });
    // The body of a failed request is never printed or stored: it may echo the request.
    if (!response.ok) return { ok: false, status: response.status };
    const json = (await response.json()) as { audio_data?: unknown };
    if (typeof json.audio_data !== "string") return { ok: false, status: response.status };
    const audio = Buffer.from(json.audio_data, "base64");
    return { ok: true, audio, seconds: wavSeconds(audio) };
  },
};

const PROVIDERS: Record<string, Provider> = { [voxtral.model.id]: voxtral };

async function transcribe(audio: Buffer, extension: string): Promise<string> {
  const form = new FormData();
  form.append("model", "gpt-4o-transcribe");
  form.append("file", new Blob([new Uint8Array(audio)]), `take.${extension}`);
  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret("openai-thinking")}` },
    body: form,
  });
  if (!response.ok) throw new Error(`transcription failed with status ${response.status}`);
  const json = (await response.json()) as { text?: unknown };
  if (typeof json.text !== "string") throw new Error("transcription response has no text");
  return json.text;
}

interface Job {
  clip: Clip;
  variant: "plain" | "directed";
  repeat: number;
  direction?: Direction;
}

function jobs(provider: Provider, clips: readonly Clip[]): Job[] {
  return clips.flatMap((clip) => {
    const repeats = clip.id === "1-pacing" ? PACING_REPEATS : 1;
    const plain = Array.from({ length: repeats }, (_, repeat): Job => ({ clip, variant: "plain", repeat }));
    const direction = provider.directed[clip.id];
    return direction === undefined ? plain : [...plain, { clip, variant: "directed", repeat: 0, direction }];
  });
}

/** The request fields that carry direction, as the page shows them. */
function sentText(clip: Clip, direction: Direction): string {
  const options = direction.options === undefined ? [] : Object.entries(direction.options).map(([k, v]) => ` | ${k}: ${JSON.stringify(v)}`);
  return `input: ${direction.input ?? clip.text}${options.join("")}`;
}

async function renderJob(provider: Provider, job: Job): Promise<{ render: Render; audio?: Buffer }> {
  const input = job.direction?.input ?? job.clip.text;
  const key = `${provider.model.id}__${job.clip.id}__${job.variant}__${job.repeat}`;
  const started = performance.now();
  const result = await provider.synthesize(input, job.direction?.options ?? {});
  const totalMs = Math.round(performance.now() - started);
  const render: Render = {
    model: provider.model.id,
    clip: job.clip.id,
    variant: job.variant,
    repeat: job.repeat,
    channel: job.direction?.channel ?? "none",
    ...(job.direction === undefined ? {} : { sent: sentText(job.clip, job.direction) }),
    status: result.ok ? 200 : result.status,
    totalMs,
  };
  if (!result.ok) return { render: { ...render, error: `HTTP ${result.status}` } };
  render.file = `${key}.${provider.extension}`;
  render.audioSec = Math.round(result.seconds * 100) / 100;
  render.rtf = Math.round((totalMs / 1000 / result.seconds) * 100) / 100;
  render.costUsd = Math.round((input.length / 1000) * provider.usdPer1kChars * 1e6) / 1e6;
  render.costEstimated = true;
  if (job.repeat === 0) {
    const transcript = await transcribe(result.audio, provider.extension);
    Object.assign(render, { transcript }, transcriptCheck({ text: job.clip.text, transcript, sent: input }));
  }
  return { render, audio: result.audio };
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { model: { type: "string" }, "dry-run": { type: "boolean", default: false } } });
  const provider = values.model === undefined ? undefined : PROVIDERS[values.model];
  if (provider === undefined) throw new Error(`--model must be one of: ${Object.keys(PROVIDERS).join(", ")}`);
  const results = loadResults();
  const planned = jobs(provider, results.clips);
  if (values["dry-run"]) {
    for (const job of planned) console.log(`${job.clip.id} ${job.variant} ${job.repeat}${job.direction ? ` (${job.direction.channel})` : ""}`);
    return;
  }
  const done: { render: Render; audio?: Buffer }[] = [];
  for (const job of planned) {
    const out = await renderJob(provider, job);
    console.log(`${job.clip.id} ${job.variant} ${job.repeat}: ${out.render.status} in ${out.render.totalMs} ms`);
    done.push(out);
  }
  const failed = done.filter((d) => d.audio === undefined);
  if (failed.length > 0) {
    throw new Error(`${failed.length} of ${done.length} requests failed; results.json unchanged`);
  }
  for (const { render, audio } of done) {
    if (render.file !== undefined && audio !== undefined) writeFileSync(join(audioDir(), render.file), audio);
  }
  const model: Model = { ...provider.model, rendered: new Date().toISOString().slice(0, 10) };
  results.models = results.models.some((m) => m.id === model.id)
    ? results.models.map((m) => (m.id === model.id ? model : m))
    : [...results.models, model];
  results.renders = [...results.renders.filter((r) => r.model !== model.id), ...done.map((d) => d.render)];
  results.listPrices[model.id] = { usdPer1kChars: provider.usdPer1kChars, basis: `published list price: ${model.listPrice}` };
  results.generatedAt = new Date().toISOString();
  saveResults(results);
  console.log(`render: ${done.length} takes of ${model.id} written; run publish.ts next`);
}

await main();
