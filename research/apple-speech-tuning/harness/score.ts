// Scores transcription results against a manifest's references.
//
// Usage: node score.ts <manifest.jsonl> <baseline.jsonl> [<other.jsonl> …]
//
// Each results file holds JSON lines {id, config, vocabKey?, text, elapsedSeconds,
// alternatives?}. Prints one markdown row per file: corpus WER, proper-noun
// recall, median elapsed time, and the WER change against the first file
// with a paired-bootstrap 95% interval. `--oracle-alternatives` adds a row per
// file that picks, for each result segment, the alternative closest to the
// reference: the ceiling for any reranker of Apple's alternatives.

import * as fs from "node:fs";
import * as path from "node:path";

interface Item { id: string; reference: string; entities: string[]; seconds: number }
interface Result { id: string; config: string; vocabKey?: string | null; text: string; elapsedSeconds: number; alternatives?: string[][]; error?: string; label?: string }

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const ORDINALS: Record<string, string> = {
  first: "1st", second: "2nd", third: "3rd", fourth: "4th", fifth: "5th", sixth: "6th", seventh: "7th", eighth: "8th", ninth: "9th", tenth: "10th",
};
const FILLERS = new Set(["um", "uh", "er", "ah", "hmm", "mm", "erm", "mhm", "uhm"]);
const SPELLING: Record<string, string> = { ok: "okay", percent: "percent", "%": "percent", cannot: "can not" };

/** Collapses runs of number words below a million into digits. */
function numbers(words: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < words.length) {
    let value = 0;
    let current = 0;
    let used = 0;
    let j = i;
    while (j < words.length) {
      const w = words[j] ?? "";
      if (w in ONES) { current += ONES[w] ?? 0; } else if (w in TENS) { current += TENS[w] ?? 0; } else if (w === "hundred" && used > 0) { current *= 100; } else if (w === "thousand" && used > 0) { value += current * 1000; current = 0; } else if (w === "and" && used > 0 && (words[j + 1] ?? "") in ONES) { j++; continue; } else { break; }
      used++;
      j++;
    }
    if (used === 0) {
      out.push(words[i] ?? "");
      i++;
    } else {
      out.push(String(value + current));
      i = j;
    }
  }
  return out;
}

export function normalize(text: string): string[] {
  let t = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  // Partial words in verbatim references ("a- a- apply", "serv-") are dropped.
  t = t.replace(/(^|\s)[a-z']+-(?=[\s,.…?!]|$)/g, "$1");
  t = t.replace(/[’‘]/g, "'").replace(/\*/g, " star ").replace(/%/g, " percent ").replace(/\$/g, " ").replace(/&/g, " and ");
  t = t.replace(/(\d),(\d{3})/g, "$1$2").replace(/(\d),(\d{3})/g, "$1$2");
  t = t.replace(/(\d)\.(\d)/g, "$1point$2");
  t = t.replace(/[-–—/]/g, " ");
  t = t.replace(/[^a-z0-9' ]/g, " ").replace(/(^| )'|'( |$)/g, " ");
  const words = t.split(/\s+/).filter(Boolean)
    .map((w) => SPELLING[w] ?? ORDINALS[w] ?? w)
    .flatMap((w) => w.split(" "))
    .filter((w) => !FILLERS.has(w) && w !== "dollar" && w !== "dollars");
  return numbers(words).map((w) => w.replace(/point/g, "."));
}

function editDistance(a: string[], b: string[]): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length] ?? 0;
}

function entityHit(entity: string, hyp: string[]): boolean {
  const e = normalize(entity).join(" ");
  return e.length > 0 && ` ${hyp.join(" ")} `.includes(` ${e} `);
}

/** For each result segment, the alternative with the fewest errors against the reference. */
function oracleText(r: Result, ref: string[]): string {
  if (!r.alternatives) {
    return r.text;
  }
  let chosen: string[] = [];
  for (const alts of r.alternatives) {
    let best = alts[0] ?? "";
    let bestScore = Number.POSITIVE_INFINITY;
    for (const alt of alts) {
      // Greedy left to right: compare against the stretch of the reference
      // the text so far could cover.
      const candidate = normalize([...chosen, alt].join(" "));
      const score = editDistance(ref.slice(0, candidate.length + 2), candidate);
      if (score < bestScore) {
        bestScore = score;
        best = alt;
      }
    }
    chosen = [...chosen, best];
  }
  return chosen.join(" ");
}

interface PerItem { id: string; errors: number; words: number; plainErrors: number; plainWords: number; entities: number; hits: number; elapsed: number; seconds: number }

function scoreFile(items: Map<string, Item>, results: Result[], useOracle: boolean): PerItem[] {
  return results.filter((r) => items.has(r.id) && !r.error).map((r) => {
    const item = items.get(r.id) as Item;
    const ref = normalize(item.reference);
    const hyp = normalize(useOracle ? oracleText(r, ref) : r.text);
    const hits = item.entities.filter((e) => entityHit(e, hyp)).length;
    // "Plain" WER leaves out every word that belongs to a proper noun, in
    // both texts, to separate general accuracy from name accuracy.
    const nameWords = new Set(item.entities.flatMap((e) => normalize(e)));
    const plainRef = ref.filter((w) => !nameWords.has(w));
    const plainHyp = hyp.filter((w) => !nameWords.has(w));
    return { id: r.id, errors: editDistance(ref, hyp), words: ref.length, plainErrors: editDistance(plainRef, plainHyp), plainWords: plainRef.length, entities: item.entities.length, hits, elapsed: r.elapsedSeconds, seconds: item.seconds };
  });
}

function plainWer(rows: PerItem[]): number {
  return rows.reduce((s, r) => s + r.plainErrors, 0) / Math.max(1, rows.reduce((s, r) => s + r.plainWords, 0));
}

function wer(rows: PerItem[]): number {
  return rows.reduce((s, r) => s + r.errors, 0) / Math.max(1, rows.reduce((s, r) => s + r.words, 0));
}

function recall(rows: PerItem[]): number {
  return rows.reduce((s, r) => s + r.hits, 0) / Math.max(1, rows.reduce((s, r) => s + r.entities, 0));
}

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)] ?? 0;
}

/** Deterministic PRNG so reruns print the same intervals. */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function pairedDelta(base: PerItem[], other: PerItem[], metric: (r: PerItem[]) => number): [number, number, number] {
  const byId = new Map(base.map((r) => [r.id, r]));
  const pairs = other.filter((r) => byId.has(r.id)).map((r) => [byId.get(r.id) as PerItem, r] as const);
  const point = metric(pairs.map((p) => p[1])) - metric(pairs.map((p) => p[0]));
  const rand = rng(42);
  const deltas: number[] = [];
  for (let k = 0; k < 2000; k++) {
    const sample = pairs.map(() => pairs[Math.floor(rand() * pairs.length)] as (typeof pairs)[number]);
    deltas.push(metric(sample.map((p) => p[1])) - metric(sample.map((p) => p[0])));
  }
  deltas.sort((a, b) => a - b);
  return [point, deltas[Math.floor(deltas.length * 0.025)] ?? 0, deltas[Math.floor(deltas.length * 0.975)] ?? 0];
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function signed(x: number): string {
  return `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}`;
}

function main(): void {
  const args = process.argv.slice(2);
  const useOracle = args.includes("--oracle-alternatives");
  const [manifestPath, ...files] = args.filter((a) => !a.startsWith("--"));
  if (!manifestPath || files.length === 0) {
    throw new Error("usage: score.ts <manifest.jsonl> <baseline.jsonl> [<other.jsonl> …]");
  }
  const items = new Map<string, Item>();
  for (const line of fs.readFileSync(manifestPath, "utf8").split("\n").filter(Boolean)) {
    const item = JSON.parse(line) as Item;
    if (item.reference.trim()) {
      items.set(item.id, item);
    }
  }
  const load = (file: string): Result[] => fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Result);
  const loaded = files.map((f) => ({ file: f, results: load(f) }));
  // Score every file on the items all files transcribed, so rows compare.
  const ok = loaded.map(({ results }) => new Set(results.filter((r) => !r.error).map((r) => r.id)));
  const common = new Map([...items].filter(([id]) => ok.every((s) => s.has(id))));
  const base = scoreFile(common, loaded[0]?.results ?? [], false);
  console.log(`items scored: ${common.size} of ${items.size}; ${[...common.values()].reduce((s, i) => s + i.entities.length, 0)} proper-noun mentions; ${(([...common.values()].reduce((s, i) => s + i.seconds, 0)) / 60).toFixed(1)} min\n`);
  console.log("| run | WER | Δ WER vs first (95% CI) | WER without names | proper-noun recall | Δ recall (95% CI) | median s per file | errors |");
  console.log("|---|---|---|---|---|---|---|---|");
  for (const { file, results } of loaded) {
    for (const oracle of useOracle && results.some((r) => r.alternatives?.some((a) => a.length > 1)) ? [false, true] : [false]) {
      const rows = scoreFile(common, results, oracle);
      const [d, lo, hi] = pairedDelta(base, rows, wer);
      const [rd, rlo, rhi] = pairedDelta(base, rows, recall);
      const label = path.basename(file, ".jsonl") + (oracle ? " (oracle pick of alternatives)" : "");
      const failures = results.filter((r) => r.error).length;
      console.log(`| ${label} | ${pct(wer(rows))} | ${signed(d)} (${signed(lo)}, ${signed(hi)}) | ${pct(plainWer(rows))} | ${pct(recall(rows))} | ${signed(rd)} (${signed(rlo)}, ${signed(rhi)}) | ${median(rows.map((r) => r.elapsed)).toFixed(2)} | ${failures} |`);
    }
  }
}

main();
