// Fetches long single-speaker utterances from the AMI meeting corpus
// (edinburghcstr/ami on Hugging Face, config "ihm": individual headset
// microphones; CC BY 4.0) and writes a manifest. AMI is spontaneous,
// disfluent meeting speech, many speakers non-native, on close-talk mics.
//
// Usage: node prep-ami.ts <out-dir> [count]

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

interface Row { row: { audio_id: string; meeting_id: string; text: string; begin_time: number; end_time: number; audio: { src: string }[] } }

const [outDir, countArg] = process.argv.slice(2);
if (!outDir) {
  throw new Error("usage: prep-ami.ts <out-dir> [count]");
}
const want = Number(countArg ?? "80");
const MIN_SECONDS = 8;
const PER_MEETING = 12;
fs.mkdirSync(path.join(outDir, "audio"), { recursive: true });

/** The datasets server answers 429 under load; back off and retry. */
async function fetchWithBackoff(url: string): Promise<Response> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const response = await fetch(url);
    if (response.ok) {
      return response;
    }
    if (response.status !== 429 && response.status < 500) {
      throw new Error(`${url}: ${response.status}`);
    }
    await new Promise((r) => setTimeout(r, 3000 * 2 ** attempt));
  }
  throw new Error(`${url}: gave up after retries`);
}

const picked: Row["row"][] = [];
const perMeeting = new Map<string, number>();
for (let offset = 0; picked.length < want && offset < 13000; offset += 100) {
  const url = `https://datasets-server.huggingface.co/rows?dataset=edinburghcstr/ami&config=ihm&split=test&offset=${offset}&length=100`;
  const response = await fetchWithBackoff(url);
  const { rows } = (await response.json()) as { rows: Row[] };
  for (const { row } of rows) {
    const seconds = row.end_time - row.begin_time;
    const n = perMeeting.get(row.meeting_id) ?? 0;
    if (seconds >= MIN_SECONDS && n < PER_MEETING && picked.length < want) {
      picked.push(row);
      perMeeting.set(row.meeting_id, n + 1);
    }
  }
}

const lines: string[] = [];
for (const row of picked) {
  const raw = path.join(outDir, "audio", `${row.audio_id}.src.wav`);
  const audio = path.resolve(outDir, "audio", `${row.audio_id}.wav`);
  if (!fs.existsSync(audio)) {
    const response = await fetchWithBackoff(row.audio[0]?.src ?? "");
    fs.writeFileSync(raw, Buffer.from(await response.arrayBuffer()));
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", raw, "-af", "apad=pad_dur=0.3", "-ac", "1", "-ar", "48000", "-c:a", "pcm_f32le", audio]);
    fs.rmSync(raw);
  }
  // AMI references are upper case without punctuation; the scorer lowercases.
  lines.push(JSON.stringify({ id: `ami-${row.audio_id}`, audio, group: row.meeting_id, reference: row.text, entities: [], seconds: row.end_time - row.begin_time }));
}
fs.writeFileSync(path.join(outDir, "manifest.jsonl"), lines.join("\n") + "\n");
console.error(`${picked.length} utterances from ${perMeeting.size} meetings, ${(picked.reduce((s, r) => s + r.end_time - r.begin_time, 0) / 60).toFixed(1)} min`);
