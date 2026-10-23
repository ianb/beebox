// Writes a copy of a manifest whose audio went through one ffmpeg filter
// chain, to test whether preprocessing the recording helps the recognizer.
//
// Usage: node derive-audio.ts <manifest.jsonl> <variant> <out-dir>

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

/** Each variant: an ffmpeg filter chain and output sample format/rate. */
const VARIANTS: Record<string, { filter: string; rate: number; codec: string }> = {
  // Loudness normalization to -16 LUFS: a stand-in for gain control.
  loudnorm: { filter: "loudnorm=I=-16:TP=-1.5:LRA=11", rate: 48000, codec: "pcm_f32le" },
  // Rumble cut plus loudness normalization.
  "highpass-loudnorm": { filter: "highpass=f=80,loudnorm=I=-16:TP=-1.5:LRA=11", rate: 48000, codec: "pcm_f32le" },
  // FFT noise reduction, moderate.
  denoise: { filter: "afftdn=nr=12:nf=-40:tn=1", rate: 48000, codec: "pcm_f32le" },
  // Resampled ahead of time to the model's own format (16 kHz Int16) with a long filter.
  "pre-16k": { filter: "aresample=filter_size=64:phase_shift=14:cutoff=0.97", rate: 16000, codec: "pcm_s16le" },
  // Stress cases, not candidate fixes: a quiet recording, and Bluetooth HFP narrowband.
  quiet: { filter: "volume=-24dB", rate: 48000, codec: "pcm_f32le" },
  "narrowband-8k": { filter: "lowpass=f=3400,aresample=8000", rate: 48000, codec: "pcm_f32le" },
};

const [manifestPath, variant, outDir] = process.argv.slice(2);
const spec = VARIANTS[variant ?? ""];
if (!manifestPath || !spec || !outDir) {
  throw new Error(`usage: derive-audio.ts <manifest.jsonl> <${Object.keys(VARIANTS).join("|")}> <out-dir>`);
}
fs.mkdirSync(path.join(outDir, "audio"), { recursive: true });
const lines = fs.readFileSync(manifestPath, "utf8").split("\n").filter(Boolean).map((line) => {
  const item = JSON.parse(line) as { id: string; audio: string };
  const audio = path.resolve(outDir, "audio", `${item.id}.wav`);
  if (!fs.existsSync(audio)) {
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", item.audio, "-af", spec.filter, "-ac", "1", "-ar", String(spec.rate), "-c:a", spec.codec, audio]);
  }
  return JSON.stringify({ ...item, audio });
});
fs.writeFileSync(path.join(outDir, "manifest.jsonl"), lines.join("\n") + "\n");
console.error(`${variant}: ${lines.length} files`);
