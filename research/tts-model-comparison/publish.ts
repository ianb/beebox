/**
 * Publish the comparison to the site: check the run is complete, transcode
 * every take to Opus in site/assets/tts-comparison/, then write the page card
 * from page-template.md and results.json.
 *
 *   node --import tsx research/tts-model-comparison/publish.ts [--fresh | --prune]
 *
 * The run is complete when every model × clip × variant has one row, a row
 * without a file is one the model had no channel for, and every file is in
 * audioDir(). An incomplete run fails with the list of gaps and changes
 * nothing.
 *
 * --fresh empties site/assets/tts-comparison/ and transcodes every take from
 * its source, so no file from an earlier run stands in for a new take.
 * Without it, a take whose .webm is newer than its source is kept, and .webm
 * files no take names are listed and the run fails; --prune deletes them.
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
  NO_CHANNEL,
  publishedName,
  reference,
  type Render,
  REPO_ROOT,
  type Results,
  SITE_AUDIO_DIR,
  takeKey,
  TEMPLATE_PATH,
  type Variant,
  variantText,
} from "./lib.ts";

/** Mono Opus at 32 kbit/s: clean speech at about 4 KB per second. */
const OPUS_ARGS = ["-vn", "-ac", "1", "-c:a", "libopus", "-b:a", "32k", "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact"];

/** Every gap that keeps the run from publishing, or none. */
function gaps(results: Results): string[] {
  const rows = new Map(results.renders.map((r) => [takeKey(r), r]));
  const out: string[] = [];
  for (const model of results.models) {
    for (const clip of results.clips) {
      for (const variant of clip.variants) {
        const key = takeKey({ model: model.id, clip: clip.id, variant: variant.id });
        const r = rows.get(key);
        if (r === undefined) out.push(`${key}: no row`);
        else if (r.file === undefined && r.channel !== NO_CHANNEL) out.push(`${key}: no file (${r.error ?? `status ${r.status ?? "none"}`})`);
        else if (r.file !== undefined && !existsSync(join(audioDir(), r.file))) out.push(`${key}: ${r.file} is not in ${audioDir()}`);
      }
    }
  }
  return out;
}

function transcode(takes: readonly Render[], fresh: boolean): { made: number; kept: number } {
  mkdirSync(SITE_AUDIO_DIR, { recursive: true });
  let made = 0;
  let kept = 0;
  for (const r of takes) {
    if (r.file === undefined) continue;
    const source = join(audioDir(), r.file);
    const target = join(SITE_AUDIO_DIR, publishedName(r.file));
    if (!fresh && existsSync(target) && statSync(target).mtimeMs >= statSync(source).mtimeMs) {
      kept += 1;
      continue;
    }
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", source, ...OPUS_ARGS, target]);
    made += 1;
  }
  return { made, kept };
}

function orphans(takes: readonly Render[]): string[] {
  const named = new Set(takes.flatMap((r) => (r.file === undefined ? [] : [publishedName(r.file)])));
  return readdirSync(SITE_AUDIO_DIR).filter((f) => !named.has(f));
}

function cents(usd: number): string {
  return `${(usd * 100).toFixed(1)}¢`;
}

/** Cost per minute of speech over the model's takes, billed or at list price. */
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

const quoteWords = (words: readonly string[]): string => words.map((w) => `“${w}”`).join(", ");

/** What the transcript shows was read aloud: direction or Markdown. */
function readAloud(r: Render): string {
  const parts: string[] = [];
  if (r.leakedWords?.length) parts.push(`**Read direction aloud:** ${quoteWords(r.leakedWords)}.`);
  if (r.formattingWords?.length) parts.push(`**Read Markdown aloud:** ${quoteWords(r.formattingWords)}.`);
  return parts.join(" ");
}

/** Backslash-escape text so Markdoc shows it literally. */
function literal(text: string): string {
  return text.replace(/[\\`*_[\]{}<>#|]/g, "\\$&");
}

/** The sent request fields as a blockquote, one field per line; line breaks in a field shown as ↵. */
function sentQuote(sent: string): string {
  return sent
    .split(" | ")
    .map((field) => {
      const flat = field.replace(/\n+/g, " ↵ ");
      const colon = flat.indexOf(": ");
      return colon === -1 ? `> ${literal(flat)}` : `> **${literal(flat.slice(0, colon))}:** ${literal(flat.slice(colon + 2))}`;
    })
    .join("\n>\n");
}

interface Context {
  models: Map<string, Model>;
  clips: Map<string, Clip>;
}

function refOf(r: Render, ctx: Context): string {
  const model = ctx.models.get(r.model);
  const clip = ctx.clips.get(r.clip);
  if (model === undefined || clip === undefined) throw new Error(`render ${takeKey(r)} has no model or clip`);
  return reference({ clip, variant: r.variant, model });
}

function player(r: Render, ctx: Context): string {
  return r.file === undefined ? "" : `{% audio src="/assets/tts-comparison/${publishedName(r.file)}" ref="${refOf(r, ctx)}" /%}`;
}

/** One list item: a model's takes of one clip, a block per variant. */
function modelTakes(model: Model, clip: Clip, renders: readonly Render[], ctx: Context): string {
  const blocks: string[] = [];
  for (const variant of clip.variants) {
    const r = renders.find((x) => x.variant === variant.id);
    if (r === undefined) throw new Error(`no row for ${model.id} ${clip.id} ${variant.id}`);
    const lead = blocks.length === 0 ? `${pill(model)} ` : "";
    if (r.channel === NO_CHANNEL) {
      blocks.push(`${lead}**${literal(variant.label)}.** No channel for this direction.`);
      continue;
    }
    const channel = variant.direction === undefined ? "" : `, ${r.channel}`;
    const note = readAloud(r);
    blocks.push(`${lead}**${literal(variant.label)}**${channel}.${note === "" ? "" : ` ${note}`}`);
    if (r.sent !== undefined) blocks.push(sentQuote(r.sent));
    blocks.push(player(r, ctx));
  }
  return `- ${indent(blocks.filter((b) => b !== "").join("\n\n"))}`;
}

/** A text as the model got it: inline when it is one plain line, else a code block that keeps its Markdown and line breaks. */
function shownText(label: string, text: string): string {
  if (!text.includes("\n") && !/[*_]/.test(text)) return `**${label}:** ${literal(text)}`;
  if (!text.includes("\n")) return `**${label}:** \`${text}\``;
  return `**${label}:**\n\n\`\`\`text\n${text}\n\`\`\``;
}

function variantSpec(clip: Clip, variant: Variant): string[] {
  const out: string[] = [];
  if (variant.text !== undefined) out.push(shownText(literal(variant.label), variantText(clip, variant)));
  if (variant.direction !== undefined) out.push(`**${literal(variant.label)}, as prose:** ${literal(variant.direction.prose)}`);
  return out;
}

function clipHeading(clip: Clip): string {
  return `${clip.code} · ${clip.title}`;
}

function clipSection(results: Results, clip: Clip, ctx: Context): string {
  const spec = [shownText("Text", clip.text), `**Listen for:** ${literal(clip.listenFor)}`];
  if (clip.pronounce !== undefined) spec.push(`**Roughly how it sounds:** ${literal(clip.pronounce)}`);
  spec.push(...clip.variants.flatMap((v) => variantSpec(clip, v)));
  if (clip.variants.every((v) => v.direction === undefined)) spec.push("**Direction:** none; every model read it without direction.");
  const lines = [`### ${clipHeading(clip)}`, "", `{% sample title="Clip ${clipHeading(clip)}" %}`, spec.join("\n\n"), "{% /sample %}", ""];
  for (const model of results.models) {
    lines.push(modelTakes(model, clip, results.renders.filter((r) => r.model === model.id && r.clip === clip.id), ctx), "");
  }
  return lines.join("\n").trimEnd();
}

/** Every take whose transcript shows direction or Markdown read aloud, linked to its player. */
function leaksSection(results: Results, ctx: Context): string {
  const items = results.renders
    .filter((r) => readAloud(r) !== "")
    .map((r) => {
      const model = ctx.models.get(r.model);
      const clip = ctx.clips.get(r.clip);
      const variant = clip?.variants.find((v) => v.id === r.variant);
      if (model === undefined || clip === undefined || variant === undefined) throw new Error(`render ${takeKey(r)} has no model, clip, or variant`);
      const ref = refOf(r, ctx);
      const channel = variant.direction === undefined ? "" : `, ${r.channel}`;
      return `- ${pill(model)} [${clipHeading(clip)}](#${slug(clipHeading(clip))}), **${literal(variant.label)}**${channel}. ${readAloud(r)} Take [${ref}](#${ref}).`;
    });
  return items.length === 0 ? "No take in this run." : items.join("\n");
}

/** The id site/workspace-model.ts headingIds() gives a heading. */
function slug(heading: string): string {
  return heading.toLowerCase().replace(/[^\da-z]+/g, "-").replace(/^-|-$/g, "");
}

/** A contents list of the page's second- and third-level headings. */
function contents(page: string): string {
  return [...page.matchAll(/^(#{2,3}) (.+)$/gm)]
    .map(([, hashes = "", title = ""]) => `${hashes.length === 3 ? "  " : ""}- [${title}](#${slug(title)})`)
    .join("\n");
}

function indent(text: string): string {
  return text.replace(/\n/g, "\n  ").replace(/\n {2}\n/g, "\n\n");
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
  const { values } = parseArgs({ options: { prune: { type: "boolean", default: false }, fresh: { type: "boolean", default: false } } });
  const results = loadResults();
  const missing = gaps(results);
  if (missing.length > 0) throw new Error(`the run is incomplete; nothing written:\n  ${missing.join("\n  ")}`);
  const ctx: Context = { models: new Map(results.models.map((m) => [m.id, m])), clips: new Map(results.clips.map((c) => [c.id, c])) };
  const refs = results.renders.filter((r) => r.file !== undefined).map((r) => refOf(r, ctx));
  const duplicate = refs.find((ref, n) => refs.indexOf(ref) !== n);
  if (duplicate !== undefined) throw new Error(`two takes share the reference ${duplicate}`);
  if (values.fresh) {
    mkdirSync(SITE_AUDIO_DIR, { recursive: true });
    for (const f of readdirSync(SITE_AUDIO_DIR)) unlinkSync(join(SITE_AUDIO_DIR, f));
  }
  const { made, kept } = transcode(results.renders, values.fresh);
  const extra = orphans(results.renders);
  if (extra.length > 0 && !values.prune) {
    throw new Error(`files no render names (rerun with --prune to delete):\n  ${extra.join("\n  ")}`);
  }
  for (const f of extra) unlinkSync(join(SITE_AUDIO_DIR, f));
  const template = readFileSync(TEMPLATE_PATH, "utf8");
  const sections = {
    models: modelsSection(results),
    leaks: leaksSection(results, ctx),
    clips: results.clips.map((c) => clipSection(results, c, ctx)).join("\n\n"),
  };
  // The contents list is made from the headings of the filled page.
  const headings = fillTemplate(template, { ...sections, contents: "" });
  writeFileSync(CARD_PATH, fillTemplate(template, { ...sections, contents: contents(headings) }));
  const bytes = readdirSync(SITE_AUDIO_DIR).reduce((sum, f) => sum + statSync(join(SITE_AUDIO_DIR, f)).size, 0);
  console.log(
    `publish: ${made} transcoded, ${kept} up to date, ${extra.length} pruned; ${(bytes / 1e6).toFixed(1)} MB in ${relative(REPO_ROOT, SITE_AUDIO_DIR)}; wrote ${relative(REPO_ROOT, CARD_PATH)}`,
  );
}

main();
