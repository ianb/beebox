// Speaks dictation-notes.json with OpenAI TTS and writes two manifests:
// clean (48 kHz mono Float32, the app's recording format) and phone-noisy
// (the same audio with room reverb, a 100 Hz–7 kHz band limit, and café
// noise at about 12 dB SNR).
//
// Usage (from beebox/):
//   pnpm exec tsx ../research/apple-speech-tuning/harness/synth-dictation.ts <box-root> <out-dir>

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { getOpenAiThinkingKey } from "../../../beebox/src/core/openai-thinking-key.js";

interface Note { id: string; terms: string[]; text: string }

const VOICES = ["alloy", "ash", "coral", "echo", "sage", "verse", "nova", "onyx", "ballad", "shimmer"];
const INSTRUCTIONS = "You are dictating a quick personal note into your phone while walking. Speak casually at a natural, slightly fast pace, with the small hesitations of someone thinking aloud. Pronounce names the way a local would.";

const [boxRoot, outDir] = process.argv.slice(2);
if (!boxRoot || !outDir) {
  throw new Error("usage: synth-dictation.ts <box-root> <out-dir>");
}
const key = await getOpenAiThinkingKey(boxRoot, { observe: true });
if (!key) {
  throw new Error("the box has no openai-thinking grant");
}
const notes = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "dictation-notes.json"), "utf8")) as Note[];
const allTerms = [...new Set(notes.flatMap((n) => n.terms))];
for (const variant of ["clean", "noisy"]) {
  fs.mkdirSync(path.join(outDir, variant, "audio"), { recursive: true });
}
const raw = path.join(outDir, "raw");
fs.mkdirSync(raw, { recursive: true });

// Café-like noise: brown noise with a slow tremolo, rendered once.
const noise = path.join(raw, "noise.wav");
if (!fs.existsSync(noise)) {
  execFileSync("sox", ["-n", "-r", "48000", "-c", "1", noise, "synth", "60", "brownnoise", "tremolo", "0.3", "40", "gain", "-3"]);
}

const manifests: Record<string, string[]> = { clean: [], noisy: [] };
for (const [i, note] of notes.entries()) {
  const mp3 = path.join(raw, `${note.id}.wav`);
  if (!fs.existsSync(mp3)) {
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: VOICES[i % VOICES.length], input: note.text, instructions: INSTRUCTIONS, response_format: "wav" }),
    });
    if (!response.ok) {
      throw new Error(`TTS ${note.id}: ${response.status} ${await response.text()}`);
    }
    fs.writeFileSync(mp3, Buffer.from(await response.arrayBuffer()));
  }
  const clean = path.resolve(outDir, "clean", "audio", `${note.id}.wav`);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", mp3, "-af", "apad=pad_dur=0.5", "-ac", "1", "-ar", "48000", "-c:a", "pcm_f32le", clean]);
  const noisy = path.resolve(outDir, "noisy", "audio", `${note.id}.wav`);
  execFileSync("ffmpeg", [
    "-v", "error", "-y", "-i", clean, "-i", noise, "-filter_complex",
    "[0:a]aecho=0.8:0.6:40|70:0.25|0.15,highpass=f=100,lowpass=f=7000,volume=1.0[s];[1:a]volume=0.25[n];[s][n]amix=inputs=2:duration=first:normalize=0",
    "-ac", "1", "-ar", "48000", "-c:a", "pcm_f32le", noisy,
  ]);
  const seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", clean]).toString().trim());
  for (const [variant, audio] of [["clean", clean], ["noisy", noisy]] as const) {
    manifests[variant]?.push(JSON.stringify({
      id: `${variant}-${note.id}`, audio, group: "notes", reference: note.text, entities: note.terms, seconds,
      vocab: { segment: note.terms, box: allTerms },
    }));
  }
  console.error(`${note.id} ${seconds.toFixed(1)}s`);
}
for (const [variant, lines] of Object.entries(manifests)) {
  fs.writeFileSync(path.join(outDir, variant, "manifest.jsonl"), lines.join("\n") + "\n");
}
