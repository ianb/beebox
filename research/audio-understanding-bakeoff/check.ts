/**
 * `bakeoff check`: validate corpus.json and confirm every recording is present
 * and decodable. Run it after adding material and before spending on a run.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { audioDir, checksFor, loadCorpus } from "./lib.ts";

export function checkCommand(): boolean {
  const corpus = loadCorpus();
  const problems: string[] = [];
  const dir = audioDir();
  const sampleIds = new Set<string>();
  for (const s of corpus.samples) {
    if (sampleIds.has(s.id)) problems.push(`duplicate sample id ${s.id}`);
    sampleIds.add(s.id);
    if (Boolean(s.capture) === Boolean(s.synthetic)) problems.push(`${s.id}: needs exactly one of capture or synthetic`);
    if (s.capture) {
      const file = join(dir, s.capture);
      if (!existsSync(file)) problems.push(`${s.id}: recording missing at ${file}`);
      else {
        try {
          execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
        } catch {
          problems.push(`${s.id}: ffprobe cannot read ${file}`);
        }
      }
      if (s.words === undefined || !s.direction) problems.push(`${s.id}: a recording needs words (may be empty) and direction for the judge`);
    }
  }
  const used = new Set<string>();
  const groupIds = new Set<string>();
  for (const g of corpus.groups) {
    if (groupIds.has(g.id)) problems.push(`duplicate group id ${g.id}`);
    groupIds.add(g.id);
    if (g.prompt === "product" && (g.samples.length !== 1 || !g.question)) problems.push(`group ${g.id}: a product group needs one sample and a question`);
  }
  for (const g of corpus.groups) {
    for (const id of g.samples) {
      if (!sampleIds.has(id)) problems.push(`group ${g.id}: unknown sample ${id}`);
      used.add(id);
    }
    if (g.checksFrom && !groupIds.has(g.checksFrom)) problems.push(`group ${g.id}: checksFrom unknown group ${g.checksFrom}`);
    if (Boolean(g.checks) === Boolean(g.checksFrom)) problems.push(`group ${g.id}: needs exactly one of checks or checksFrom`);
    const checks = groupIds.has(g.checksFrom ?? g.id) ? checksFor(corpus, g.id) : [];
    const checkIds = new Set<string>();
    for (const c of checks) {
      if (checkIds.has(c.id)) problems.push(`group ${g.id}: duplicate check ${c.id}`);
      checkIds.add(c.id);
      if (!corpus.capabilities.includes(c.capability)) problems.push(`group ${g.id}/${c.id}: unknown capability ${c.capability}`);
    }
  }
  for (const id of sampleIds) if (!used.has(id)) problems.push(`sample ${id} is in no group`);

  const recordings = corpus.samples.filter((s) => s.capture).length;
  const checks = corpus.groups.reduce((n, g) => n + checksFor(corpus, g.id).length, 0);
  console.log(`corpus v${corpus.version}: ${recordings} recordings, ${corpus.samples.length - recordings} synthetic, ${corpus.groups.length} groups, ${checks} checks; audio in ${dir}`);
  for (const p of problems) console.log(`problem: ${p}`);
  return problems.length === 0;
}
