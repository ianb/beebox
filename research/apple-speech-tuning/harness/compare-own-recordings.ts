// Compares Apple configurations on your own recordings, on this Mac.
// Nothing leaves the machine unless you pass --server, which sends the audio
// to the box's HQ engines exactly as the phone's server HQ pass does today.
//
// Usage (from beebox/, after harness/build.sh):
//   pnpm exec tsx ../research/apple-speech-tuning/harness/compare-own-recordings.ts <dir> [--server <box-root>]
//
// <dir> holds audio files (wav, m4a, mp3, caf). For any file with a
// same-named .txt beside it (your corrected transcript), WER is scored.
// Writes <dir>/compare/report.md with every engine's text side by side.

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const args = process.argv.slice(2);
const dir = args[0];
const serverIndex = args.indexOf("--server");
const boxRoot = serverIndex >= 0 ? args[serverIndex + 1] : undefined;
if (!dir) {
  throw new Error("usage: compare-own-recordings.ts <dir> [--server <box-root>]");
}
const here = import.meta.dirname;
const out = path.join(dir, "compare");
fs.mkdirSync(path.join(out, "audio"), { recursive: true });

const audioFiles = fs.readdirSync(dir).filter((f) => /\.(wav|m4a|mp3|caf|aac)$/i.test(f)).sort();
const manifest = audioFiles.map((f) => {
  const id = path.parse(f).name;
  const audio = path.resolve(out, "audio", `${id}.wav`);
  if (!fs.existsSync(audio)) {
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", path.join(dir, f), "-ac", "1", "-ar", "48000", "-c:a", "pcm_f32le", audio]);
  }
  const refFile = path.join(dir, `${id}.txt`);
  const reference = fs.existsSync(refFile) ? fs.readFileSync(refFile, "utf8").trim() : "";
  const seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", audio]).toString().trim());
  return { id, audio, reference, entities: [], seconds };
});
const manifestPath = path.join(out, "manifest.jsonl");
fs.writeFileSync(manifestPath, manifest.map((m) => JSON.stringify(m)).join("\n") + "\n");

const configs = ["st.transcription", "st.alternatives", "dt.long"];
execFileSync(path.join(here, "run-apple.sh"), [manifestPath, out, ...configs], { stdio: "inherit" });
const rerank = path.join(here, ".build", "foundation-rerank");
if (fs.existsSync(rerank) && !fs.existsSync(path.join(out, "st.alternatives+fm-edit.jsonl"))) {
  execFileSync(rerank, ["edit", path.join(out, "st.alternatives.jsonl"), path.join(out, "st.alternatives+fm-edit.jsonl")], { stdio: "inherit" });
}
if (boxRoot) {
  execFileSync("pnpm", ["exec", "tsx", path.join(here, "server-transcribe.ts"), boxRoot, manifestPath, out, "whisper", "voxtral"], { stdio: "inherit" });
}

const runs = fs.readdirSync(out).filter((f) => f.endsWith(".jsonl") && f !== "manifest.jsonl").sort();
const texts = new Map<string, Map<string, string>>();
for (const run of runs) {
  for (const line of fs.readFileSync(path.join(out, run), "utf8").split("\n").filter(Boolean)) {
    const r = JSON.parse(line) as { id: string; text: string; error?: string };
    const byRun = texts.get(r.id) ?? new Map<string, string>();
    byRun.set(path.basename(run, ".jsonl"), r.error ? `(error: ${r.error})` : r.text);
    texts.set(r.id, byRun);
  }
}
const report: string[] = ["# Own-recording comparison", ""];
if (manifest.some((m) => m.reference)) {
  const scored = runs.map((r) => path.join(out, r));
  const table = execFileSync("node", [path.join(here, "score.ts"), manifestPath, ...scored.sort((a, b) => Number(!a.includes("st.transcription.jsonl")) - Number(!b.includes("st.transcription.jsonl")))]).toString();
  report.push("Scored on files that have a .txt reference:", "", table, "");
}
for (const m of manifest) {
  report.push(`## ${m.id} (${m.seconds.toFixed(0)} s)`, "");
  if (m.reference) {
    report.push(`**reference:** ${m.reference}`, "");
  }
  for (const [run, text] of texts.get(m.id) ?? []) {
    report.push(`**${run}:** ${text}`, "");
  }
}
fs.writeFileSync(path.join(out, "report.md"), report.join("\n"));
console.error(`wrote ${path.join(out, "report.md")}`);
