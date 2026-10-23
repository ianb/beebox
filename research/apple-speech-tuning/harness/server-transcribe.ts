// Transcribes a manifest with the box's server HQ engines, through the same
// beebox code the HQ route calls, with the test box's granted keys.
//
// Usage (from beebox/):
//   pnpm exec tsx ../research/apple-speech-tuning/harness/server-transcribe.ts \
//     <box-root> <manifest.jsonl> <out-dir> <service>[:vocab-key] …
// <service> is an HQ service name (whisper, whisper-llm, voxtral). With a
// vocabulary key, the list goes in as the engine's prompt: Whisper's `prompt`,
// Voxtral's `context_bias` (which the box splits into single words).

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { transcribeAudioHq, type HqTranscriptionService } from "../../../beebox/src/core/transcription/dispatch/core.js";

interface Item { id: string; audio: string; vocab?: Record<string, string[]> }

const [boxRoot, manifestPath, outDir, ...specs] = process.argv.slice(2);
if (!boxRoot || !manifestPath || !outDir || specs.length === 0) {
  throw new Error("usage: server-transcribe.ts <box-root> <manifest.jsonl> <out-dir> <service>[:vocab-key] …");
}
const root: string = boxRoot;
const outRoot: string = outDir;
const items = fs.readFileSync(manifestPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Item);
fs.mkdirSync(outDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "server-transcribe-"));

/** 16 kHz 16-bit mono: every engine here resamples to 16 kHz, and the upload is a sixth the size. */
function upload(item: Item): Buffer {
  const file = path.join(tmp, `${item.id}.wav`);
  if (!fs.existsSync(file)) {
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", item.audio, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", file]);
  }
  return fs.readFileSync(file);
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= 4) {
        throw error;
      }
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    }
  }
}

async function runSpec(spec: string): Promise<void> {
  const [service = "", key] = spec.split(":");
  const name = `server.${service}${key ? `+${key}` : ""}`;
  const outFile = path.join(outRoot, `${name}.jsonl`);
  if (fs.existsSync(outFile)) {
    console.error(`skip ${name}`);
    return;
  }
  const lines: string[] = new Array<string>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (let i = next++; i < items.length; i = next++) {
      const item = items[i] as Item;
      const prompt = key ? (item.vocab?.[key] ?? []).join(", ") : undefined;
      const start = Date.now();
      let record: Record<string, unknown>;
      try {
        const result = await withRetry(() => transcribeAudioHq(
          { audioBuffer: upload(item), filename: `${item.id}.wav`, boxRoot: root, ...(prompt ? { prompt } : {}) },
          { service: service as HqTranscriptionService },
        ));
        record = { id: item.id, config: name, text: result.text, elapsedSeconds: (Date.now() - start) / 1000 };
      } catch (error) {
        record = { id: item.id, config: name, text: "", elapsedSeconds: 0, error: error instanceof Error ? `${error.name}: ${error.message.slice(0, 200)}` : String(error) };
      }
      lines[i] = JSON.stringify(record);
      console.error(`${name} [${i + 1}/${items.length}] ${item.id}${record.error ? ` ERROR ${String(record.error)}` : ""}`);
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  fs.writeFileSync(outFile, lines.join("\n") + "\n");
}

for (const spec of specs) {
  await runSpec(spec);
}
