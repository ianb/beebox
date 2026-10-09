/**
 * `bakeoff run`: send the corpus to models and record raw answers, latency, and cost.
 *
 * Model specs: `<gemini-id>` (Gemini API, blind groups), `openrouter:<id>`
 * (OpenRouter pinned to Google AI Studio, blind groups), `transcribe:<gemini-id>`
 * (one clip per call with no questions, like the Whisper baseline).
 *
 * Re-running with the same --out resumes: completed calls are kept and only
 * missing or failed ones are made.
 */

import { existsSync } from "node:fs";
import { buildAudioQuestionPrompt } from "../../beebox/src/core/audio-question.ts";
import { openRouterProvider } from "../../beebox/src/core/openrouter.ts";
import {
  type CallRecord,
  type Corpus,
  PRICES,
  type RawRun,
  type Sample,
  callKey,
  corpusDigest,
  loadCorpus,
  normalizedWav,
  pool,
  readJson,
  requireEnv,
  sampleById,
  servedAs,
  writeJson,
} from "./lib.ts";

/** Bump when a prompt or the call shape changes; results across versions are not comparable. */
const HARNESS_VERSION = 1;

const PROMPTS = {
  blind: `You will hear one or more short audio recordings, labeled only by letter. Listen carefully to the audio itself. For each recording report:

- transcript: a literal transcript. Keep fillers (uh, um, mm), false starts, self-corrections, and informal reductions exactly as spoken. Mark non-speech events, pauses, and changes in voice quality in square brackets, e.g. [sigh], [laugh], [pause ~2s], [whispering]. If there are no words, give an empty transcript.
- language: the language or languages spoken.
- emotionIntent: the speaker's emotional tone and communicative intent, and the acoustic evidence for it.
- pronunciation: specific pronunciation observations, including any unusual or non-native sounds and exactly where they occur.
- timingEmphasis: pacing, pauses (with estimated durations), and which words carry stress or emphasis.
- nonSpeech: every non-speech sound, what it is, and how many times it occurs.

When there is more than one recording, also give "comparison": the concrete differences between the recordings in words, delivery, pronunciation, timing, emphasis, and sounds. Say so plainly when they do not differ.

Respond with JSON only: {"recordings": [{"label": "A", "transcript": "...", "language": "...", "emotionIntent": "...", "pronunciation": "...", "timingEmphasis": "...", "nonSpeech": "..."}], "comparison": "..."}`,
  extended: `Produce a single extended transcript of this recording: the literal words exactly as spoken (keep fillers, false starts, self-corrections, and informal reductions), interleaved in order with bracketed stage directions for everything else you hear — breaths, sighs, laughs, coughs, other sounds, pauses with estimated durations, and every change in voice quality (for example whispering, then returning to normal voice). Respond with JSON only: {"extendedTranscript": "..."}`,
};

interface Spec {
  model: string;
  route: "gemini" | "openrouter";
  mode: "blind" | "transcribe";
}

interface Task {
  task: string;
  prompt: string;
  /** Labeled recordings and a JSON answer; false for the product prompt, which gets plain prose. */
  structured: boolean;
  samples: Sample[];
}

const LETTERS = "ABCDEFGHIJKL";

export function parseSpec(raw: string): Spec {
  if (raw.startsWith("openrouter:")) return { model: raw.slice("openrouter:".length), route: "openrouter", mode: "blind" };
  if (raw.startsWith("transcribe:")) return { model: raw.slice("transcribe:".length), route: "gemini", mode: "transcribe" };
  return { model: raw, route: "gemini", mode: "blind" };
}

function tasksFor(corpus: Corpus, mode: Spec["mode"]): Task[] {
  if (mode === "transcribe") return corpus.samples.map((s) => ({ task: s.id, prompt: "", structured: false, samples: [s] }));
  return corpus.groups.map((g) => ({
    task: g.id,
    prompt: g.prompt === "product" ? buildAudioQuestionPrompt({ question: g.question ?? "" }) : PROMPTS[g.prompt ?? "blind"],
    structured: g.prompt !== "product",
    samples: g.samples.map((id) => sampleById(corpus, id)),
  }));
}

interface CallResult {
  text: string;
  modelVersion?: string | undefined;
  usage: unknown;
  costUsd?: number | undefined;
}

interface GeminiUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  promptTokensDetails?: { modality?: string; tokenCount?: number }[];
}

function geminiCost(model: string, usage: GeminiUsage | undefined): number | undefined {
  const price = PRICES[model];
  if (!price || !usage) return undefined;
  const audioTokens = usage.promptTokensDetails?.find((d) => d.modality === "AUDIO")?.tokenCount ?? 0;
  const textTokens = (usage.promptTokenCount ?? 0) - audioTokens;
  const outputTokens = (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0);
  return (audioTokens * price.audio + textTokens * price.text + outputTokens * price.output) / 1e6;
}

async function callGemini(spec: Spec, task: Task, audio: Buffer[]): Promise<CallResult> {
  const parts: unknown[] = [];
  if (task.prompt) parts.push({ text: task.prompt });
  audio.forEach((wav, i) => {
    if (task.structured) parts.push({ text: `Recording ${LETTERS[i]}:` });
    parts.push({ inlineData: { mimeType: "audio/wav", data: wav.toString("base64") } });
  });
  const body: Record<string, unknown> = { contents: [{ role: "user", parts }] };
  if (task.structured) body["generationConfig"] = { responseMimeType: "application/json" };
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${spec.model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": requireEnv("GEMINI_API_KEY") },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300_000),
  });
  const json = (await res.json()) as {
    error?: { message?: string };
    modelVersion?: string;
    usageMetadata?: GeminiUsage;
    candidates?: {
      content?: { parts?: { text?: string; thought?: boolean; audioTranscription?: { text?: string } }[] };
      finishReason?: string;
    }[];
  };
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${json.error?.message ?? "no message"}`);
  const candidate = json.candidates?.[0];
  const text = (candidate?.content?.parts ?? [])
    .filter((p) => !p.thought)
    // Transcription models (gemini-3.5-transcribe) answer in `audioTranscription`.
    .map((p) => p.text ?? p.audioTranscription?.text ?? "")
    .join("");
  if (spec.mode === "blind" && !text) throw new Error(`empty answer, finishReason=${candidate?.finishReason ?? "none"}`);
  return { text, modelVersion: json.modelVersion, usage: json.usageMetadata, costUsd: geminiCost(spec.model, json.usageMetadata) };
}

async function callOpenRouter(spec: Spec, task: Task, audio: Buffer[]): Promise<CallResult> {
  const content: unknown[] = [{ type: "text", text: task.prompt }];
  audio.forEach((wav, i) => {
    if (task.structured) content.push({ type: "text", text: `Recording ${LETTERS[i]}:` });
    content.push({ type: "input_audio", input_audio: { data: wav.toString("base64"), format: "wav" } });
  });
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${requireEnv("BBX_OPENROUTER_API_KEY")}` },
    body: JSON.stringify({
      model: spec.model,
      // The product's own pin and data policy (beebox/src/core/audio-question.ts).
      provider: openRouterProvider("google-ai-studio"),
      ...(task.structured ? { response_format: { type: "json_object" } } : {}),
      messages: [{ role: "user", content }],
    }),
    signal: AbortSignal.timeout(300_000),
  });
  const json = (await res.json()) as {
    error?: { message?: string };
    model?: string;
    usage?: { cost?: number };
    choices?: { message?: { content?: string }; finish_reason?: string }[];
  };
  if (!res.ok || json.error) throw new Error(`HTTP ${res.status}: ${json.error?.message ?? "no message"}`);
  const text = json.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error(`empty answer, finish_reason=${json.choices?.[0]?.finish_reason ?? "none"}`);
  return { text, modelVersion: json.model, usage: json.usage, costUsd: json.usage?.cost };
}

async function runOne(spec: Spec, task: Task, repeat: number): Promise<CallRecord> {
  const labels = Object.fromEntries(task.samples.map((s, i) => [LETTERS[i] ?? String(i), s.id]));
  const audio = task.samples.map(normalizedWav);
  const base = { model: spec.model, route: spec.route, mode: spec.mode, task: task.task, repeat, labels, startedAt: new Date().toISOString() };
  // latencyMs is the final attempt only: rate-limit waits are the provider's quota, not the model's speed.
  for (let attempt = 1; ; attempt++) {
    const t0 = performance.now();
    try {
      const result = await (spec.route === "openrouter" ? callOpenRouter : callGemini)(spec, task, audio);
      return { ...base, latencyMs: Math.round(performance.now() - t0), ...result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const retryable = /HTTP (429|5\d\d)|empty answer|timeout|fetch failed/i.test(message);
      if (!retryable || attempt >= 5) return { ...base, latencyMs: Math.round(performance.now() - t0), error: message };
      // Per-model quotas can be low (gemini-3.5-transcribe: 10/min); honor the server's hint.
      const hinted = /retry in ([\d.]+)s/i.exec(message)?.[1];
      await new Promise((r) => setTimeout(r, hinted ? Number(hinted) * 1000 + 1000 : 5000 * attempt));
    }
  }
}

export async function runCommand(opts: {
  models: string[];
  repeats: number;
  out: string;
  tasks?: string[] | undefined;
  concurrency: number;
}): Promise<boolean> {
  const corpus = loadCorpus();
  const specs = opts.models.map(parseSpec);
  const unpriced = specs.filter((s) => s.route === "gemini" && !PRICES[s.model]).map((s) => s.model);
  if (unpriced.length) throw new Error(`add list prices to PRICES in lib.ts first: ${unpriced.join(", ")}`);
  const run: RawRun = existsSync(opts.out)
    ? readJson<RawRun>(opts.out)
    : { date: new Date().toISOString().slice(0, 10), harnessVersion: HARNESS_VERSION, corpusVersion: corpus.version, corpusDigest: corpusDigest(corpus), calls: [] };
  if (run.harnessVersion !== HARNESS_VERSION) throw new Error(`${opts.out} was made by harness v${run.harnessVersion}; start a new run`);
  if (run.corpusDigest !== corpusDigest(corpus)) {
    throw new Error(`${opts.out} was made against a different corpus (v${run.corpusVersion}); bump corpus.json's version and start a new run directory`);
  }
  // Failed calls stay on record (so an unselected failure still fails the run) until a retry replaces them.
  const done = new Set(run.calls.filter((c) => !c.error).map(callKey));

  const jobs: { spec: Spec; task: Task; repeat: number }[] = [];
  for (const spec of specs) {
    for (let repeat = 1; repeat <= opts.repeats; repeat++) {
      for (const task of tasksFor(corpus, spec.mode)) {
        if (opts.tasks && !opts.tasks.includes(task.task)) continue;
        if (!done.has(callKey({ ...spec, task: task.task, repeat }))) jobs.push({ spec, task, repeat });
      }
    }
  }
  console.log(`${jobs.length} calls to make (${done.size} already done)`);
  await pool(jobs, opts.concurrency, async ({ spec, task, repeat }) => {
    const record = await runOne(spec, task, repeat);
    run.calls = run.calls.filter((c) => callKey(c) !== callKey(record));
    run.calls.push(record);
    const served = servedAs(record);
    console.log(`${record.error ? "FAIL" : "ok  "} ${callKey(record)} ${record.latencyMs}ms${served ? ` SERVED AS ${served}` : ""}${record.error ? ` ${record.error}` : ""}`);
    run.calls.sort((a, b) => callKey(a).localeCompare(callKey(b)));
    writeJson(opts.out, run);
  });
  const failed = run.calls.filter((c) => c.error).length;
  console.log(`done: ${run.calls.length} calls, ${failed} failed`);
  return failed === 0;
}
