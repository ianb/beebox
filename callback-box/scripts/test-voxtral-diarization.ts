/* eslint-disable security/detect-non-literal-fs-filename */
/**
 * Generate a two-speaker sample via OpenAI TTS, then send it to Voxtral
 * with diarization=true and dump the raw response. Used to confirm
 * whether the Mistral API actually returns `speaker_id` per segment.
 *
 * Usage:
 *   THINKING_OPENAI_API_KEY=... CALLBACK_MISTRAL_API_KEY=... \
 *     tsx scripts/test-voxtral-diarization.ts
 *
 * Caches the generated WAV at scripts/.voxtral-sample.wav so reruns don't
 * keep hitting OpenAI. Delete that file to regenerate.
 */

import { writeFile, readFile, access, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";

const OPENAI_KEY = process.env["THINKING_OPENAI_API_KEY"];
const MISTRAL_KEY = process.env["CALLBACK_MISTRAL_API_KEY"];

if (!OPENAI_KEY) {
  console.error("THINKING_OPENAI_API_KEY not set");
  process.exit(1);
}
if (!MISTRAL_KEY) {
  console.error("CALLBACK_MISTRAL_API_KEY not set");
  process.exit(1);
}

const LINES: Array<{ voice: string; text: string }> = [
  { voice: "alloy", text: "Hey Marin, did you finish the diarization tests?" },
  { voice: "marin", text: "Almost. The segments come back, but I'm not sure they're labeled." },
  { voice: "alloy", text: "Let's check the raw response together, then." },
  { voice: "marin", text: "Good plan. I'll pull up the logs." },
];

const SAMPLE_PATH = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  ".voxtral-sample.wav",
);

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function ttsToMp3(voice: string, text: string): Promise<Buffer> {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts-2025-03-20",
      input: text,
      voice,
      response_format: "mp3",
    }),
  });
  if (!res.ok) {
    throw new Error(`TTS ${voice}: ${res.status} ${await res.text()}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit" });
    p.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}`));
    });
  });
}

async function generateSample(): Promise<Buffer> {
  if (await fileExists(SAMPLE_PATH)) {
    console.log(`Reusing cached sample: ${SAMPLE_PATH}`);
    return readFile(SAMPLE_PATH);
  }
  console.log("Generating two-speaker sample via OpenAI TTS...");
  const dir = path.join(os.tmpdir(), `voxtral-test-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  const parts: string[] = [];
  for (let i = 0; i < LINES.length; i++) {
    const line = LINES[i]!;
    console.log(`  [${i}] ${line.voice}: ${line.text}`);
    const mp3 = await ttsToMp3(line.voice, line.text);
    const f = path.join(dir, `line-${i}.mp3`);
    await writeFile(f, mp3);
    parts.push(f);
  }
  // Concat via ffmpeg concat demuxer → single wav
  const listFile = path.join(dir, "list.txt");
  await writeFile(listFile, parts.map((p) => `file '${p}'`).join("\n") + "\n");
  await run("ffmpeg", [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", listFile,
    "-ar", "16000",
    "-ac", "1",
    SAMPLE_PATH,
  ]);
  console.log(`Wrote ${SAMPLE_PATH}`);
  return readFile(SAMPLE_PATH);
}

async function callVoxtral(
  audio: Buffer,
  opts: { extraFields: Record<string, string>; model?: string },
): Promise<unknown> {
  const { extraFields, model = "voxtral-mini-latest" } = opts;
  const boundary = "----FormBoundary" + Math.random().toString(36).slice(2);
  const parts: Buffer[] = [];
  parts.push(Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="sample.wav"\r\n` +
    `Content-Type: audio/wav\r\n\r\n`,
  ));
  parts.push(audio);
  parts.push(Buffer.from("\r\n"));
  parts.push(Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="model"\r\n\r\n` +
    `${model}\r\n`,
  ));
  for (const [name, value] of Object.entries(extraFields)) {
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
      `${value}\r\n`,
    ));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));

  const res = await fetch("https://api.mistral.ai/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MISTRAL_KEY}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body: Buffer.concat(parts),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Voxtral ${res.status}: ${text}`);
  }
  return JSON.parse(text);
}

async function main(): Promise<void> {
  const audio = await generateSample();
  console.log(`\nSample size: ${audio.length} bytes\n`);

  const trials: Array<{ label: string; fields: Record<string, string>; model?: string }> = [
    { label: "baseline (mini, no extras)", fields: {} },
    { label: "mini + timestamp_granularities=segment", fields: { timestamp_granularities: "segment" } },
    { label: "mini + timestamp_granularities=segment + diarization", fields: { timestamp_granularities: "segment", diarization: "true" } },
    { label: "mini + diarize=true", fields: { diarize: "true" } },
    { label: "mini + response_format=verbose_json", fields: { response_format: "verbose_json" } },
    { label: "mini + verbose_json + diarization", fields: { response_format: "verbose_json", diarization: "true" } },
    { label: "mini + diarize=true + timestamp_granularities=segment", fields: { diarize: "true", timestamp_granularities: "segment" } },
  ];

  for (const trial of trials) {
    console.log(`\n--- ${trial.label} ---`);
    try {
      const opts: { extraFields: Record<string, string>; model?: string } = {
        extraFields: trial.fields,
      };
      if (trial.model) opts.model = trial.model;
      const result = await callVoxtral(audio, opts);
      const r = result as { segments?: unknown[] };
      const segs = (r.segments ?? []) as Array<Record<string, unknown>>;
      console.log(`  segments=${segs.length}`);
      if (segs.length > 0) {
        console.log(`  first segment keys: ${JSON.stringify(Object.keys(segs[0]!))}`);
        console.log(`  first 2 segments: ${JSON.stringify(segs.slice(0, 2), null, 2)}`);
      } else {
        console.log(`  full response: ${JSON.stringify(result, null, 2).slice(0, 400)}`);
      }
    } catch (e) {
      console.log(`  ERROR: ${(e as Error).message.slice(0, 300)}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
