/**
 * Render candidate texts for the next comparison run on a few models, and
 * write a listening page, so texts can be chosen before the full run.
 *
 *   node --import tsx research/tts-model-comparison/candidates.ts --out <dir>
 *
 * Writes <dir>/<ref>.mp3 per take and <dir>/index.html. A take whose file
 * exists is kept, so a rerun only fills in what failed. The box's two
 * backends go through its own service (beebox/src/services/tts.ts), so a take
 * is what the box would send; "plain" passes no instructions at all.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { collectAudio, createTtsService } from "../../beebox/src/services/tts.ts";
import { secret } from "./lib.ts";

interface Variant {
  id: string;
  label: string;
  text: string;
  /** Prose direction for models with an instruction field; a variant with one is skipped elsewhere. */
  instructions?: string;
}

interface Candidate {
  id: string;
  title: string;
  listenFor: string;
  variants: Variant[];
}

const LIST_ITEMS = ["the charger", "the blue folder with the lease", "two forms of ID, one with a photo", "the spare key for the side door"];
const STRESS = "I didn't say she stole the money.";
const MATH = "If x is three, then two x plus one is seven, not six: you double first, then add the one.";
const DIALOG = '"Did you lock the door?" she asked.\n\n"I think so."\n\n"You think so?" He was already reaching for his keys.';

const CANDIDATES: Candidate[] = [
  {
    id: "L",
    title: "A list",
    listenFor: "A pause between items, and the comma inside \"two forms of ID, one with a photo\" not heard as a new item. In the Markdown versions, whether the bullets or numbers are read aloud.",
    variants: [
      { id: "inline", label: "In a sentence", text: `Before you leave, pack ${LIST_ITEMS.slice(0, -1).join(", ")}, and ${LIST_ITEMS.at(-1) ?? ""}.` },
      { id: "bullets", label: "Markdown bullets", text: `Before you leave, pack:\n\n${LIST_ITEMS.map((i) => `- ${i}`).join("\n")}` },
      { id: "numbered", label: "Markdown numbered", text: `Before you leave, pack:\n\n${LIST_ITEMS.map((i, n) => `${n + 1}. ${i}`).join("\n")}` },
    ],
  },
  {
    id: "C",
    title: "Code-switching on look-alike words",
    listenFor: "\"son las once\" as Spanish (once = OHN-seh, \"eleven\"), and \"also gut\" as German (AHL-zo goot, \"well, fine\"), though both are spelled like English words.",
    variants: [
      { id: "plain", label: "Plain", text: 'When I asked about the train, she said "son las once," so we\'d missed it. My uncle just shrugged: "also gut."' },
      {
        id: "directed",
        label: "Directed",
        text: 'When I asked about the train, she said "son las once," so we\'d missed it. My uncle just shrugged: "also gut."',
        instructions: "Speak in natural American English, but say the quoted Spanish and German phrases in those languages.",
      },
    ],
  },
  {
    id: "M",
    title: "A mood with a twist",
    listenFor: "Plain should sound warm. Directed should still sound glad, with a wistful edge you can hear.",
    variants: [
      { id: "plain", label: "Plain", text: "Congratulations on the promotion. You really earned it." },
      { id: "directed", label: "Directed", text: "Congratulations on the promotion. You really earned it.", instructions: "Genuinely glad for them, but a little wistful: you wanted it too." },
    ],
  },
  {
    id: "D",
    title: "Dialog",
    listenFor: "The quoted lines set apart from the narration, the question rising, and \"You think so?\" as a skeptical repeat.",
    variants: [
      { id: "plain", label: "Plain", text: DIALOG },
      { id: "directed", label: "Directed", text: DIALOG, instructions: "Read it like an audiobook narrator: give the quoted lines a little life, and leave a short pause between lines of dialog." },
    ],
  },
  {
    id: "E",
    title: "A worked explanation",
    listenFor: "\"not six\" said as a correction, and stress on the second \"then\": double first, then add.",
    variants: [
      { id: "plain", label: "Plain", text: MATH },
      { id: "italic", label: "Markdown _then_", text: MATH.replace("then add", "_then_ add") },
      { id: "directed", label: "Directed", text: MATH, instructions: "Explain it like a patient teacher. Stress the second 'then', in 'then add the one'." },
    ],
  },
  {
    id: "S",
    title: "Which word is stressed",
    listenFor: "The marked word stressed, and only that one. Plain is the baseline.",
    variants: [
      { id: "plain", label: "Plain", text: STRESS },
      ...["she", "money"].flatMap((word): Variant[] => [
        { id: `${word}-directed`, label: `“${word}”, directed`, text: STRESS, instructions: `Stress the word '${word}'; it carries the meaning of the sentence.` },
        { id: `${word}-italic`, label: `“${word}”, Markdown *italic*`, text: STRESS.replace(word, `*${word}*`) },
        { id: `${word}-caps`, label: `“${word}”, CAPS`, text: STRESS.replace(word, word.toUpperCase()) },
      ]),
    ],
  },
];

interface Speaker {
  id: string;
  name: string;
  takesInstructions: boolean;
  speak(text: string, instructions: string | undefined): Promise<Buffer>;
}

function boxBackend(backend: "openai" | "gemini", name: string, key: string): Speaker {
  return {
    id: backend,
    name,
    takesInstructions: true,
    async speak(text, instructions) {
      const service = createTtsService({ backend, apiKey: secret(key) });
      // "" is no direction: the service would otherwise add the box's default.
      return collectAudio(await service.streamSpeech(text, { instructions: instructions ?? "" }));
    },
  };
}

const SPEAKERS: Speaker[] = [
  boxBackend("openai", "gpt-4o-mini-tts (the box's default)", "openai-thinking"),
  boxBackend("gemini", "Gemini 3.8 Flash-Lite TTS (the box's styled voice)", "gemini"),
  {
    id: "voxtral",
    name: "Voxtral TTS 3",
    takesInstructions: false,
    async speak(text) {
      const response = await fetch("https://api.mistral.ai/v1/audio/speech", {
        method: "POST",
        headers: { Authorization: `Bearer ${secret("mistral")}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "voxtral-mini-tts-3-0", input: text, voice_id: "voice_478", response_format: "mp3" }),
      });
      // The body of a failed request is never printed: it may echo the request.
      if (!response.ok) throw new Error(`Voxtral answered ${response.status}`);
      const json = (await response.json()) as { audio_data?: unknown };
      if (typeof json.audio_data !== "string") throw new Error("Voxtral answered without audio");
      return Buffer.from(json.audio_data, "base64");
    },
  },
];

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

interface Take {
  ref: string;
  candidate: Candidate;
  variant: Variant;
  speaker: Speaker;
  error?: string;
}

function page(takes: readonly Take[]): string {
  const sections = CANDIDATES.map((c) => {
    const variants = c.variants.map((v) => {
      const rows = takes
        .filter((t) => t.candidate === c && t.variant === v)
        .map((t) => `<tr><td><code>${t.ref}</code></td><td>${escapeHtml(t.speaker.name)}</td><td>${t.error === undefined ? `<audio controls preload="none" src="${t.ref}.mp3"></audio>` : escapeHtml(t.error)}</td></tr>`)
        .join("\n");
      const direction = v.instructions === undefined ? "" : `<p class="dir"><b>Instructions:</b> ${escapeHtml(v.instructions)}</p>`;
      return `<h3 id="${c.id}-${v.id}">${c.id}-${v.id} · ${escapeHtml(v.label)}</h3>\n<pre>${escapeHtml(v.text)}</pre>\n${direction}\n<table>${rows}</table>`;
    });
    return `<section><h2 id="${c.id}">${c.id} · ${escapeHtml(c.title)}</h2>\n<p><b>Listen for:</b> ${escapeHtml(c.listenFor)}</p>\n${variants.join("\n")}</section>`;
  });
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>TTS candidate texts</title>
<style>
:root { color-scheme: light dark; --bg: #fbfaf7; --fg: #1d1c1a; --muted: #6b6760; --box: #f0ede6; }
@media (prefers-color-scheme: dark) { :root { --bg: #1a1a1c; --fg: #e9e7e2; --muted: #a29d94; --box: #26262a; } }
body { background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, sans-serif; max-width: 52rem; margin: 0 auto; padding: 1rem 16px 4rem; }
pre { background: var(--box); padding: .6rem .8rem; white-space: pre-wrap; border-radius: 4px; }
.dir { color: var(--muted); }
table { border-collapse: collapse; width: 100%; }
td { padding: .2rem .5rem .2rem 0; vertical-align: middle; }
td:first-child { white-space: nowrap; }
audio { height: 2rem; max-width: 100%; }
h2 { margin-top: 2.5rem; border-bottom: 1px solid var(--muted); }
</style></head><body>
<h1>TTS candidate texts</h1>
<p>Draft texts for the next comparison run, on three models. Each take has a reference such as <code>S-she-caps-openai</code>: text, variant, model. Plain takes have no instructions. Voxtral has no instruction field, so it reads only the variants without instructions. Starting one player pauses the others.</p>
<p>${CANDIDATES.map((c) => `<a href="#${c.id}">${c.id} · ${escapeHtml(c.title)}</a>`).join(" &nbsp; ")}</p>
${sections.join("\n")}
<script>document.addEventListener('play', e => { for (const a of document.querySelectorAll('audio')) if (a !== e.target) a.pause(); }, true);</script>
</body></html>
`;
}

/** Render one take, waiting out a rate limit (HTTP 429) up to four times. */
async function attempt(job: Take, file: string): Promise<Take> {
  for (let tries = 1; ; tries += 1) {
    try {
      writeFileSync(file, await job.speaker.speak(job.variant.text, job.variant.instructions));
      return job;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("429") || tries === 4) return { ...job, error: message };
      await new Promise((resolve) => setTimeout(resolve, 20_000 * tries));
    }
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { out: { type: "string" } } });
  if (values.out === undefined) throw new Error("--out <dir> is required");
  const out = values.out;
  mkdirSync(out, { recursive: true });
  const jobs: Take[] = CANDIDATES.flatMap((candidate) =>
    candidate.variants.flatMap((variant) =>
      SPEAKERS.filter((s) => variant.instructions === undefined || s.takesInstructions).map((speaker) => ({
        ref: `${candidate.id}-${variant.id}-${speaker.id}`,
        candidate,
        variant,
        speaker,
      })),
    ),
  );
  // One request at a time per provider, the providers side by side.
  const bySpeaker = await Promise.all(
    SPEAKERS.map(async (speaker) => {
      const done: Take[] = [];
      for (const job of jobs.filter((j) => j.speaker === speaker)) {
        const file = join(out, `${job.ref}.mp3`);
        if (existsSync(file)) {
          done.push(job);
          continue;
        }
        done.push(await attempt(job, file));
      }
      return done;
    }),
  );
  const takes = bySpeaker.flat();
  writeFileSync(join(out, "index.html"), page(takes));
  const failed = takes.filter((t) => t.error !== undefined);
  console.log(`candidates: ${takes.length - failed.length} of ${takes.length} takes written to ${out}`);
  for (const t of failed) console.log(`  ${t.ref}: ${t.error ?? ""}`);
}

await main();
