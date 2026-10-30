// Cuts Earnings-21 calls into speaker-turn segments and writes a manifest.
//
// Earnings-21 (Rev, CC BY-SA 4.0) references carry no word timings. The
// RTTM files give speaker-turn timings; a call whose RTTM turn count equals
// the reference's speaker-run count is mapped turn for turn. Other calls are
// skipped. Turns of 10–60 s are kept: mostly Q&A, which is spontaneous.
//
// Usage: node prep-earnings21.ts <earnings21-dir> <out-dir>
//   <earnings21-dir> holds media/<id>.mp3, rttm/<id>.rttm,
//   nlp/<id>.nlp and nlp/<id>.wer_tags.json from revdotcom/speech-datasets.

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const PROPER = new Set(["PERSON", "ORG", "GPE", "LOC", "PRODUCT", "FAC", "EVENT", "WORK_OF_ART", "LAW", "NORP"]);
const MIN_SECONDS = 10;
const MAX_SECONDS = 60;
const PER_CALL = 20;

const [dataDir, outDir] = process.argv.slice(2);
if (!dataDir || !outDir) {
  throw new Error("usage: prep-earnings21.ts <earnings21-dir> <out-dir>");
}
fs.mkdirSync(path.join(outDir, "audio"), { recursive: true });

interface Token { token: string; speaker: string; punctuation: string; ids: string[] }
interface Turn { start: number; end: number; tokens: Token[] }

function parseNlp(file: string): Token[] {
  const lines = fs.readFileSync(file, "utf8").split("\n").slice(1).filter(Boolean);
  return lines.map((line) => {
    const [token = "", speaker = "", , , punctuation = "", , , werTags = "[]"] = line.split("|");
    const ids = [...werTags.matchAll(/'(\d+)'/g)].map((m) => m[1] ?? "");
    return { token, speaker, punctuation, ids };
  });
}

function parseRttm(file: string): { start: number; end: number }[] {
  const turns: { start: number; end: number; speaker: string }[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n").filter(Boolean)) {
    const f = line.split(/\s+/);
    const start = Number(f[3]);
    const end = start + Number(f[4]);
    const speaker = f[7] ?? "";
    const last = turns.at(-1);
    if (last && last.speaker === speaker) {
      last.end = end;
    } else {
      turns.push({ start, end, speaker });
    }
  }
  return turns;
}

function runs(tokens: Token[]): Token[][] {
  const out: Token[][] = [];
  for (const t of tokens) {
    const last = out.at(-1);
    if (last && last[0]?.speaker === t.speaker) {
      last.push(t);
    } else {
      out.push([t]);
    }
  }
  return out;
}

/** Proper-noun entities in token order, by entity id; a leading "the" is dropped. */
function entities(tokens: Token[], types: Record<string, { entity_type: string }>): string[] {
  const byId = new Map<string, string[]>();
  for (const t of tokens) {
    for (const id of t.ids) {
      if (PROPER.has(types[id]?.entity_type ?? "")) {
        byId.set(id, [...(byId.get(id) ?? []), t.token]);
      }
    }
  }
  return [...byId.values()]
    .map((words) => (words[0]?.toLowerCase() === "the" ? words.slice(1) : words).join(" "))
    .filter((s) => s.length > 1);
}

const manifest: string[] = [];
const allCallVocab = new Map<string, string[]>();
const selected: { id: string; call: string; turn: Turn; ents: string[] }[] = [];

for (const file of fs.readdirSync(path.join(dataDir, "rttm")).sort()) {
  const call = path.basename(file, ".rttm");
  const rttm = parseRttm(path.join(dataDir, "rttm", file));
  const nlpFile = path.join(dataDir, "nlp", `${call}.nlp`);
  const tagFile = path.join(dataDir, "nlp", `${call}.wer_tags.json`);
  if (!fs.existsSync(nlpFile) || !fs.existsSync(tagFile)) {
    continue;
  }
  const tokens = parseNlp(nlpFile);
  const speakerRuns = runs(tokens);
  if (speakerRuns.length !== rttm.length) {
    console.error(`skip ${call}: ${rttm.length} RTTM turns vs ${speakerRuns.length} reference runs`);
    continue;
  }
  const types = JSON.parse(fs.readFileSync(tagFile, "utf8")) as Record<string, { entity_type: string }>;
  allCallVocab.set(call, [...new Set(entities(tokens, types))]);
  const turns: Turn[] = rttm.map((r, i) => ({ ...r, tokens: speakerRuns[i] ?? [] }));
  const candidates = turns
    .map((turn, i) => ({ turn, i, ents: entities(turn.tokens, types) }))
    .filter(({ turn }) => turn.end - turn.start >= MIN_SECONDS && turn.end - turn.start <= MAX_SECONDS)
    // Turns with names first, then the rest, each in call order.
    .sort((a, b) => Number(b.ents.length > 0) - Number(a.ents.length > 0) || a.i - b.i)
    .slice(0, PER_CALL)
    .sort((a, b) => a.i - b.i);
  for (const c of candidates) {
    selected.push({ id: `e21-${call}-${String(c.i).padStart(3, "0")}`, call, turn: c.turn, ents: c.ents });
  }
}

// The "box" list: this call's names plus every other call's names and the
// dataset's distractor list, so most entries are irrelevant to the segment.
const distractorFile = path.join(dataDir, "distractor_list.txt");
const distractors = fs.existsSync(distractorFile)
  ? fs.readFileSync(distractorFile, "utf8").split("\n").map((s) => s.trim()).filter((s) => s.length > 3)
  : [];

for (const s of selected) {
  const audio = path.resolve(outDir, "audio", `${s.id}.wav`);
  if (!fs.existsSync(audio)) {
    // The app records mono Float32 at the input node's rate (48 kHz).
    execFileSync("ffmpeg", [
      "-v", "error", "-y", "-ss", String(Math.max(0, s.turn.start - 0.25)), "-to", String(s.turn.end + 0.25),
      "-i", path.join(dataDir, "media", `${s.call}.mp3`), "-ac", "1", "-ar", "48000", "-c:a", "pcm_f32le", audio,
    ]);
  }
  const reference = s.turn.tokens.map((t) => t.token + t.punctuation).join(" ");
  const callVocab = allCallVocab.get(s.call) ?? [];
  const others = [...allCallVocab.entries()].filter(([c]) => c !== s.call).flatMap(([, v]) => v);
  const box = [...new Set([...callVocab, ...others, ...distractors.slice(0, 300)])];
  manifest.push(JSON.stringify({
    id: s.id,
    audio,
    group: s.call,
    reference,
    entities: s.ents,
    seconds: s.turn.end - s.turn.start,
    vocab: { segment: [...new Set(s.ents)], call: callVocab.slice(0, 100), box },
  }));
}

fs.writeFileSync(path.join(outDir, "manifest.jsonl"), manifest.join("\n") + "\n");
const seconds = selected.reduce((sum, s) => sum + s.turn.end - s.turn.start, 0);
const withEnts = selected.filter((s) => s.ents.length > 0).length;
console.error(`${selected.length} segments, ${(seconds / 60).toFixed(1)} min, ${withEnts} with proper nouns`);
