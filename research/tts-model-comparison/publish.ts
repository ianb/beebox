/**
 * Publish the comparison to the site: transcode every take to Opus in
 * site/assets/tts-comparison/, then write the page card from
 * page-template.md and results.json.
 *
 *   node --import tsx research/tts-model-comparison/publish.ts [--prune]
 *
 * A take whose .webm is already newer than its source is not transcoded
 * again, and one whose source is missing keeps its .webm, so the page can be
 * regenerated on a machine without the original audio. --prune deletes .webm
 * files no render names; without it they are listed and the run fails.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import {
  audioDir,
  CARD_PATH,
  type Clip,
  loadResults,
  type Model,
  publishedName,
  type Render,
  REPO_ROOT,
  type Results,
  SITE_AUDIO_DIR,
  TEMPLATE_PATH,
} from "./lib.ts";

/** Mono Opus at 32 kbit/s: clean speech at about 4 KB per second. */
const OPUS_ARGS = ["-vn", "-ac", "1", "-c:a", "libopus", "-b:a", "32k", "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact"];

function transcode(results: Results): { made: number; kept: number } {
  mkdirSync(SITE_AUDIO_DIR, { recursive: true });
  let made = 0;
  let kept = 0;
  for (const r of results.renders) {
    if (r.file === undefined) continue;
    const source = join(audioDir(), r.file);
    const target = join(SITE_AUDIO_DIR, publishedName(r.file));
    const sourceExists = existsSync(source);
    if (existsSync(target) && (!sourceExists || statSync(target).mtimeMs >= statSync(source).mtimeMs)) {
      kept += 1;
      continue;
    }
    if (!sourceExists) throw new Error(`neither ${source} nor ${relative(REPO_ROOT, target)} exists; set TTS_AUDIO_DIR`);
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", source, ...OPUS_ARGS, target]);
    made += 1;
  }
  return { made, kept };
}

function orphans(results: Results): string[] {
  const named = new Set(results.renders.flatMap((r) => (r.file === undefined ? [] : [publishedName(r.file)])));
  return readdirSync(SITE_AUDIO_DIR).filter((f) => !named.has(f));
}

function cents(usd: number): string {
  return `${(usd * 100).toFixed(1)}¢`;
}

/** Cost per minute of speech over the model's successful takes, billed or at list price. */
function costPerMinute(renders: readonly Render[]): string | undefined {
  const priced = renders.filter((r) => r.file !== undefined && r.costUsd !== undefined && r.audioSec !== undefined);
  const usd = priced.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
  const sec = priced.reduce((sum, r) => sum + (r.audioSec ?? 0), 0);
  if (sec === 0) return undefined;
  const basis = priced.some((r) => r.costEstimated === true) ? "at list price" : "as billed by OpenRouter";
  return `about ${cents((usd / sec) * 60)} per minute of speech in this run, ${basis}`;
}

function pill(model: Model): string {
  return `{% model name="${model.name}" vendor="${model.vendor}" /%}`;
}

function modelsSection(results: Results): string {
  return results.models
    .map((m) => {
      const cost = costPerMinute(results.renders.filter((r) => r.model === m.id));
      const parts = [
        `${pill(m)} \`${m.apiModel}\`, ${m.route}, voice ${m.voice}. Rendered ${m.rendered}.`,
        `List price: ${m.listPrice}${cost === undefined ? "." : `; ${cost}.`}`,
      ];
      if (m.note !== undefined) parts.push(m.note);
      return `- ${parts.join(" ")}`;
    })
    .join("\n");
}

function check(r: Render): string {
  if (r.file === undefined) return `The request failed (${r.error ?? `status ${r.status}`}).`;
  if (r.transcript === undefined) return "Not transcribed.";
  const parts: string[] = [];
  const quote = (ws: readonly string[]) => ws.map((w) => `“${w}”`).join(", ");
  if (r.leakedWords?.length) parts.push(`Direction words in the transcript: ${quote(r.leakedWords)}.`);
  const extra = (r.extraWords ?? []).filter((w) => !(r.leakedWords ?? []).includes(w));
  if (r.missingWords?.length) parts.push(`Missing from the transcript: ${quote(r.missingWords)}.`);
  if (extra.length) parts.push(`In the transcript, not the text: ${quote(extra)}.`);
  return parts.length === 0 ? "The transcript matches the text." : parts.join(" ");
}

function player(r: Render): string {
  return r.file === undefined ? "" : `{% audio src="/assets/tts-comparison/${publishedName(r.file)}" /%}`;
}

const VARIANT_LABEL = { plain: "Plain", directed: "Directed", markup: "Markup" } as const;

/** One list item: a model's takes of one clip. */
function modelTakes(model: Model, renders: readonly Render[]): string {
  const blocks: string[] = [];
  const plain = renders.filter((r) => r.variant === "plain");
  if (plain.length > 1) {
    blocks.push(`${pill(model)} **Plain**, ${plain.length} takes.`);
    for (const r of plain) blocks.push(`Take ${r.repeat + 1}. ${check(r)}\n${player(r)}`);
  } else if (plain[0] !== undefined) {
    blocks.push(`${pill(model)} **Plain.** ${check(plain[0])}\n${player(plain[0])}`);
  }
  for (const r of renders.filter((x) => x.variant !== "plain")) {
    const lead = blocks.length === 0 ? `${pill(model)} ` : "";
    blocks.push(`${lead}**${VARIANT_LABEL[r.variant]}**, ${r.channel}. ${check(r)}`);
    if (r.sent !== undefined) blocks.push(`\`\`\`\n${r.sent}\n\`\`\``);
    blocks.push(player(r));
  }
  return `- ${blocks.filter((b) => b !== "").join("\n\n").replace(/\n/g, "\n  ").replace(/\n {2}\n/g, "\n\n")}`;
}

function clipSection(results: Results, clip: Clip): string {
  const number = clip.id.split("-")[0] ?? clip.id;
  const spec = [`**Text:** ${clip.text}`, `**Listen for:** ${clip.listenFor}`];
  if (clip.direction !== undefined) spec.push(`**Direction, as prose:** ${clip.direction.prose}.`);
  const lines = [`### ${clip.title}`, "", `{% sample title="Clip ${number} · ${clip.title}" %}`, spec.join("\n\n"), "{% /sample %}", ""];
  for (const model of results.models) {
    const renders = results.renders.filter((r) => r.model === model.id && r.clip === clip.id);
    if (renders.length > 0) lines.push(modelTakes(model, renders), "");
  }
  return lines.join("\n").trimEnd();
}

function fillTemplate(template: string, sections: Record<string, string>): string {
  let out = template;
  for (const [name, text] of Object.entries(sections)) {
    const marker = `<!-- ${name} -->`;
    if (out.split(marker).length !== 2) throw new Error(`${relative(REPO_ROOT, TEMPLATE_PATH)} must contain ${marker} exactly once`);
    out = out.replace(marker, () => text);
  }
  const leftover = /<!-- [a-z]+ -->/.exec(out);
  if (leftover) throw new Error(`${relative(REPO_ROOT, TEMPLATE_PATH)} has an unknown marker ${leftover[0]}`);
  return out;
}

function main(): void {
  const { values } = parseArgs({ options: { prune: { type: "boolean", default: false } } });
  const results = loadResults();
  const { made, kept } = transcode(results);
  const extra = orphans(results);
  if (extra.length > 0 && !values.prune) {
    throw new Error(`files no render names (rerun with --prune to delete):\n  ${extra.join("\n  ")}`);
  }
  for (const f of extra) unlinkSync(join(SITE_AUDIO_DIR, f));
  const card = fillTemplate(readFileSync(TEMPLATE_PATH, "utf8"), {
    models: modelsSection(results),
    clips: results.clips.map((c) => clipSection(results, c)).join("\n\n"),
  });
  writeFileSync(CARD_PATH, card);
  const bytes = readdirSync(SITE_AUDIO_DIR).reduce((sum, f) => sum + statSync(join(SITE_AUDIO_DIR, f)).size, 0);
  console.log(
    `publish: ${made} transcoded, ${kept} up to date, ${extra.length} pruned; ${(bytes / 1e6).toFixed(1)} MB in ${relative(REPO_ROOT, SITE_AUDIO_DIR)}; wrote ${relative(REPO_ROOT, CARD_PATH)}`,
  );
}

main();
