/**
 * Publish the comparison to the site: transcode every take to Opus in
 * site/assets/tts-comparison/, then write the page card from
 * page-template.md and results.json.
 *
 * The page plays one take per model, clip, and variant: for a clip read
 * several times, the take closest to the median length. Only those takes are
 * published; the rest stay in results.json and the original audio.
 *
 *   node --import tsx research/tts-model-comparison/publish.ts [--prune]
 *
 * A take whose .webm is already newer than its source is not transcoded
 * again, and one whose source is missing keeps its .webm, so the page can be
 * regenerated on a machine without the original audio. --prune deletes .webm
 * files the page does not play; without it they are listed and the run fails.
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
  VARIANTS,
} from "./lib.ts";

/** Mono Opus at 32 kbit/s: clean speech at about 4 KB per second. */
const OPUS_ARGS = ["-vn", "-ac", "1", "-c:a", "libopus", "-b:a", "32k", "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact"];

/** Of several takes, the successful one closest to the median length. */
function representative(takes: readonly Render[]): Render | undefined {
  const done = takes.filter((r) => r.file !== undefined).toSorted((a, b) => (a.audioSec ?? 0) - (b.audioSec ?? 0) || a.repeat - b.repeat);
  return done[Math.floor((done.length - 1) / 2)];
}

/** The takes the page plays, by group of model, clip, and variant. */
function shown(results: Results): Render[] {
  const groups = new Map<string, Render[]>();
  for (const r of results.renders) {
    const key = `${r.model}__${r.clip}__${r.variant}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()].flatMap((takes) => {
    const take = representative(takes);
    return take === undefined ? [] : [take];
  });
}

function transcode(takes: readonly Render[]): { made: number; kept: number } {
  mkdirSync(SITE_AUDIO_DIR, { recursive: true });
  let made = 0;
  let kept = 0;
  for (const r of takes) {
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

function orphans(takes: readonly Render[]): string[] {
  const named = new Set(takes.flatMap((r) => (r.file === undefined ? [] : [publishedName(r.file)])));
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

function failure(r: Render): string {
  if (r.error?.startsWith("TimeoutError") === true) return "timed out";
  return r.error ?? `status ${r.status}`;
}

/** Direction the transcript shows was read aloud, or nothing. */
function leak(r: Render): string {
  if (!r.leakedWords?.length) return "";
  return ` **Read direction aloud:** ${r.leakedWords.map((w) => `“${w}”`).join(", ")}.`;
}

/** Backslash-escape text so Markdoc shows it literally. */
function literal(text: string): string {
  return text.replace(/[\\`*_[\]{}<>#|]/g, "\\$&");
}

/** The sent request fields as a blockquote, one field per line. */
function sentQuote(sent: string): string {
  return sent
    .split(" | ")
    .map((field) => {
      const colon = field.indexOf(": ");
      return colon === -1 ? `> ${literal(field)}` : `> **${literal(field.slice(0, colon))}:** ${literal(field.slice(colon + 2))}`;
    })
    .join("\n>\n");
}

function player(r: Render): string {
  return r.file === undefined ? "" : `{% audio src="/assets/tts-comparison/${publishedName(r.file)}" /%}`;
}

const VARIANT_LABEL = { plain: "Plain", directed: "Directed", markup: "Markup" } as const;

/** How several takes of one text varied, and which one plays. */
function takesNote(takes: readonly Render[]): string {
  const done = takes.filter((r) => r.file !== undefined);
  const failed = takes.filter((r) => r.file === undefined);
  const parts: string[] = [];
  if (done.length > 1) {
    const secs = done.map((r) => r.audioSec ?? 0);
    parts.push(`Middle-length take of ${done.length}; they ran ${Math.min(...secs).toFixed(1)}–${Math.max(...secs).toFixed(1)} s.`);
  }
  if (failed.length > 0) parts.push(`${failed.length} of ${takes.length} takes failed (${[...new Set(failed.map(failure))].join("; ")}).`);
  return parts.join(" ");
}

/** One take, or why there is none. */
function take(takes: readonly Render[]): { note: string; render?: Render } {
  const r = representative(takes);
  if (r === undefined) return { note: `The request failed (${[...new Set(takes.map(failure))].join("; ")}).` };
  const note = [takes.length > 1 ? takesNote(takes) : "", leak(r).trim()].filter(Boolean).join(" ");
  return { note, render: r };
}

/** One list item: a model's takes of one clip. */
function modelTakes(model: Model, renders: readonly Render[]): string {
  const blocks: string[] = [];
  for (const variant of VARIANTS) {
    const takes = renders.filter((r) => r.variant === variant);
    if (takes.length === 0) continue;
    const { note, render } = take(takes);
    const lead = blocks.length === 0 ? `${pill(model)} ` : "";
    const channel = variant === "plain" ? "" : `, ${takes[0]?.channel ?? ""}`;
    blocks.push(`${lead}${variant === "plain" ? "**Plain.**" : `**${VARIANT_LABEL[variant]}**${channel}.`}${note === "" ? "" : ` ${note}`}`);
    const sent = (render ?? takes[0])?.sent;
    if (sent !== undefined) blocks.push(sentQuote(sent));
    if (render !== undefined) blocks.push(player(render));
  }
  return `- ${indent(blocks.filter((b) => b !== "").join("\n\n"))}`;
}

function clipSection(results: Results, clip: Clip): string {
  const number = clip.id.split("-")[0] ?? clip.id;
  const spec = [`**Text:** ${clip.text}`, `**Listen for:** ${clip.listenFor}`];
  if (clip.pronounce !== undefined) spec.push(`**Roughly how it sounds:** ${clip.pronounce}`);
  spec.push(clip.direction === undefined ? "**Direction:** none; every model read it plain." : `**Direction, as prose:** ${clip.direction.prose}.`);
  const lines = [`### ${clip.title}`, "", `{% sample title="Clip ${number} · ${clip.title}" %}`, spec.join("\n\n"), "{% /sample %}", ""];
  for (const model of results.models) {
    const renders = results.renders.filter((r) => r.model === model.id && r.clip === clip.id);
    if (renders.length > 0) lines.push(modelTakes(model, renders), "");
  }
  return lines.join("\n").trimEnd();
}

/** Every take in which the transcript shows direction read aloud. */
function leaksSection(results: Results): string {
  const leaked = results.renders.filter((r) => r.leakedWords?.length);
  const models = new Map(results.models.map((m) => [m.id, m]));
  const clips = new Map(results.clips.map((c) => [c.id, c]));
  return leaked
    .map((r) => {
      const model = models.get(r.model);
      const clip = clips.get(r.clip);
      if (model === undefined || clip === undefined) throw new Error(`render of ${r.model} ${r.clip} has no model or clip`);
      const head = `${pill(model)} [${clip.title}](#${slug(clip.title)}), **${VARIANT_LABEL[r.variant]}**, ${r.channel}.${leak(r)}`;
      const blocks = [head, ...(r.sent === undefined ? [] : [sentQuote(r.sent)]), player(r)].filter((b) => b !== "");
      return `- ${indent(blocks.join("\n\n"))}`;
    })
    .join("\n");
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
  const { values } = parseArgs({ options: { prune: { type: "boolean", default: false } } });
  const results = loadResults();
  const takes = shown(results);
  const { made, kept } = transcode(takes);
  const extra = orphans(takes);
  if (extra.length > 0 && !values.prune) {
    throw new Error(`files no render names (rerun with --prune to delete):\n  ${extra.join("\n  ")}`);
  }
  for (const f of extra) unlinkSync(join(SITE_AUDIO_DIR, f));
  const template = readFileSync(TEMPLATE_PATH, "utf8");
  const sections = {
    models: modelsSection(results),
    leaks: leaksSection(results),
    clips: results.clips.map((c) => clipSection(results, c)).join("\n\n"),
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
