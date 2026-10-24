/**
 * Render candidate texts for the next comparison run on a few models, and
 * write a listening page, so texts can be chosen before the full run.
 *
 *   node --import tsx research/tts-model-comparison/candidates.ts --out <dir>
 *
 * Writes <dir>/<ref>.mp3 (or .wav) per take and <dir>/index.html. A take whose file
 * exists is kept, so a rerun only fills in what failed. The box's two
 * backends go through its own service (beebox/src/services/tts.ts), so a take
 * is what the box would send; "plain" passes no instructions at all.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
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
  /** Render only on models with an instruction field: the test is the direction. */
  directableOnly?: boolean;
  variants: Variant[];
}

const LIST_ITEMS = ["the charger", "the blue folder with the lease", "two forms of ID, one with a photo", "the spare key for the side door"];
const MATH = "If x is three, then two x plus one is seven, not eight: you double first, then add the one.";
const WATER = "Water boils at 100 °C at sea level, but at 3,000 m (about twice the height of Denver) it boils at about 90, which is why pasta takes longer up there.";

/**
 * Round 2. Round 1 (sarcasm aside: code-switching on look-alike words, a
 * wistful twist, dialog, the first worked explanation, and word stress) is in
 * git history; the boxholder's verdicts on it are in the README.
 */
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
    id: "E",
    title: "A worked explanation",
    listenFor: "\"not eight\" said as a correction, and stress on the second \"then\": double first, then add.",
    variants: [
      { id: "plain", label: "Plain", text: MATH },
      { id: "italic", label: "Markdown _then_", text: MATH.replace("then add", "_then_ add") },
    ],
  },
  {
    id: "W",
    title: "A dense explanation",
    listenFor: "The units read as words (degrees Celsius, meters), the aside in parentheses set off, and the contrast between sea level and altitude.",
    variants: [
      { id: "plain", label: "Plain", text: WATER },
      { id: "directed", label: "Directed", text: WATER, instructions: "Explain it like a patient teacher, so the contrast between sea level and altitude is clear." },
    ],
  },
  {
    id: "M1",
    title: "A mood with a twist: staying late",
    directableOnly: true,
    listenFor: "Plain should sound willing. Directed should still agree, but you should hear that the speaker would rather not.",
    variants: [
      { id: "plain", label: "Plain", text: "Sure, I can stay late tonight." },
      { id: "directed", label: "Directed", text: "Sure, I can stay late tonight.", instructions: "Agreeing, but tired and a little put-upon: you'll do it, and you'd rather not." },
    ],
  },
  {
    id: "M2",
    title: "A mood with a twist: test results",
    directableOnly: true,
    listenFor: "Plain should sound like plain news. Directed should sound relieved, as if the speaker had been bracing for bad news.",
    variants: [
      { id: "plain", label: "Plain", text: "The test results came back, and everything looks normal." },
      { id: "directed", label: "Directed", text: "The test results came back, and everything looks normal.", instructions: "Relieved, almost laughing: you had been bracing for bad news." },
    ],
  },
];

interface Speaker {
  id: string;
  name: string;
  takesInstructions: boolean;
  ext: "mp3" | "wav";
  speak(text: string, instructions: string | undefined): Promise<Buffer>;
}

function boxBackend(backend: "openai" | "gemini", name: string, key: string): Speaker {
  return {
    id: backend,
    name,
    takesInstructions: true,
    ext: "mp3",
    async speak(text, instructions) {
      const service = createTtsService({ backend, apiKey: secret(key) });
      // "" is no direction: the service would otherwise add the box's default.
      return collectAudio(await service.streamSpeech(text, { instructions: instructions ?? "" }));
    },
  };
}

/** OpenAI's speech endpoint for a model the box does not ship. */
function openAi(model: string, voice: string, takesInstructions: boolean): Speaker {
  return {
    id: model,
    name: model,
    takesInstructions,
    ext: "mp3",
    async speak(text, instructions) {
      const response = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: { Authorization: `Bearer ${secret("openai-thinking")}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, input: text, voice, response_format: "mp3", ...(instructions === undefined ? {} : { instructions }) }),
      });
      if (!response.ok) throw new Error(`OpenAI answered ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    },
  };
}

/** A 16-bit mono WAV header around raw PCM. */
function wav(pcm: Buffer, rate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * OpenRouter's speech endpoint. Here and for ElevenLabs, Cartesia, and
 * Deepgram, direction is not sent: each takes it differently, and the full
 * run's adapters will carry it.
 */
function openRouter(id: string, name: string, model: string, voice: string | undefined, format: "mp3" | "pcm" = "mp3"): Speaker {
  return {
    id,
    name: `${name} via OpenRouter`,
    takesInstructions: false,
    ext: format === "pcm" ? "wav" : "mp3",
    async speak(text) {
      const response = await fetch("https://openrouter.ai/api/v1/audio/speech", {
        method: "POST",
        headers: { Authorization: `Bearer ${secret("openrouter")}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, input: text, ...(voice === undefined ? {} : { voice }), response_format: format }),
      });
      if (!response.ok) throw new Error(`OpenRouter answered ${response.status}`);
      const audio = Buffer.from(await response.arrayBuffer());
      // Gemini answers 24 kHz 16-bit mono PCM only.
      return format === "pcm" ? wav(audio, 24_000) : audio;
    },
  };
}

/**
 * A key from the main checkout's beebox/.env (BBX_ENV_FILE overrides), for
 * providers the secret store does not hold. Never printed.
 */
function envKey(name: string): string {
  const file = process.env["BBX_ENV_FILE"] ?? join(homedir(), "src/beebox/beebox/.env");
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
    if (match?.[1] === name && match[2] !== undefined) return match[2].replace(/^["']|["']$/g, "");
  }
  throw new Error(`${name} is not in ${file}`);
}

/** POST JSON and return the audio body, or throw with the status only. */
async function audioPost(url: string, headers: Record<string, string>, body: unknown, provider: string): Promise<Buffer> {
  const response = await fetch(url, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`${provider} answered ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function elevenLabs(model: string): Speaker {
  return {
    id: model,
    name: `ElevenLabs ${model}`,
    takesInstructions: false,
    ext: "mp3",
    speak: (text) =>
      audioPost(
        "https://api.elevenlabs.io/v1/text-to-speech/iP95p4xoKVk53GoZ742B?output_format=mp3_44100_128",
        { "xi-api-key": envKey("ELEVENLABS_API_KEY") },
        { text, model_id: model },
        "ElevenLabs",
      ),
  };
}

function cartesia(model: string): Speaker {
  return {
    id: model,
    name: `Cartesia ${model}`,
    takesInstructions: false,
    ext: "mp3",
    speak: (text) =>
      audioPost(
        "https://api.cartesia.ai/tts/bytes",
        { "X-API-Key": envKey("CARTESIA_API_KEY"), "Cartesia-Version": "2025-04-16" },
        {
          model_id: model,
          transcript: text,
          voice: { mode: "id", id: "6ccbfb76-1fc6-48f7-b71d-91ac6298247b" },
          language: "en",
          output_format: { container: "mp3", sample_rate: 44_100, bit_rate: 128_000 },
        },
        "Cartesia",
      ),
  };
}

/** Deepgram: Aura models on /v1/speak, Flux on /v2/speak. Neither takes direction. */
function deepgram(model: string, version: "v1" | "v2"): Speaker {
  return {
    id: model,
    name: `Deepgram ${model}`,
    takesInstructions: false,
    ext: "mp3",
    speak: (text) =>
      audioPost(`https://api.deepgram.com/${version}/speak?model=${model}&encoding=mp3`, { Authorization: `Token ${envKey("DEEPGRAM_API_KEY")}` }, { text }, "Deepgram"),
  };
}

const SPEAKERS: Speaker[] = [
  boxBackend("openai", "gpt-4o-mini-tts (the box's default)", "openai-thinking"),
  boxBackend("gemini", "Gemini 3.8 Flash-Lite TTS (the box's styled voice)", "gemini"),
  openAi("gpt-4o-mini-tts-2025-12-15", "marin", true),
  openAi("tts-1-hd", "nova", false),
  openRouter("gemini31", "Gemini 3.1 Flash TTS", "google/gemini-3.1-flash-tts-preview", "Zephyr", "pcm"),
  openRouter("mai2", "MAI-Voice-2", "microsoft/mai-voice-2", "en-US-Harper:MAI-Voice-2"),
  openRouter("mai2flash", "MAI-Voice-2 Flash", "microsoft/mai-voice-2-flash", "en-US-Harper:MAI-Voice-2"),
  openRouter("fish", "Fish S2.1 Pro (default voice)", "fish-audio/s2.1-pro", undefined),
  openRouter("minimax", "MiniMax 2.8 Turbo", "minimax/speech-2.8-turbo", "English_expressive_narrator"),
  openRouter("grok", "Grok Voice TTS", "x-ai/grok-voice-tts-1.0", "eve"),
  elevenLabs("eleven_v3"),
  elevenLabs("eleven_flash_v2_5"),
  cartesia("sonic-3.6"),
  cartesia("sonic-turbo"),
  deepgram("aura-2-thalia-en", "v1"),
  deepgram("flux-hannah-en", "v2"),
  {
    id: "voxtral",
    name: "Voxtral TTS 3",
    takesInstructions: false,
    ext: "mp3",
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
        .map((t) => `<tr><td><code>${t.ref}</code></td><td>${escapeHtml(t.speaker.name)}</td><td>${t.error === undefined ? `<audio controls preload="none" src="${t.ref}.${t.speaker.ext}"></audio>` : escapeHtml(t.error)}</td></tr>`)
        .join("\n");
      const direction = v.instructions === undefined ? "" : `<p class="dir"><b>Instructions:</b> ${escapeHtml(v.instructions)}</p>`;
      return `<h3 id="${c.id}-${v.id}">${c.id}-${v.id} · ${escapeHtml(v.label)}</h3>\n<pre>${escapeHtml(v.text)}</pre>\n${direction}\n<table>${rows}</table>`;
    });
    return `<section><h2 id="${c.id}">${c.id} · ${escapeHtml(c.title)}</h2>\n<p><b>Listen for:</b> ${escapeHtml(c.listenFor)}</p>\n${variants.join("\n")}</section>`;
  });
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>TTS candidate texts, round 2</title>
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
<h1>TTS candidate texts, round 2</h1>
<p>Draft texts for the next comparison run, round 2, on seventeen of the nineteen models (not Gemini 3.8 Flash or Gemini 3.1 on Google's own API). Each take has a reference such as <code>L-bullets-grok</code>: text, variant, model. Plain takes have no instructions. Only the three models with an instruction field (gpt-4o-mini-tts, both dates, and Gemini 3.8 Flash-Lite) read the directed variants and the mood texts. Starting one player pauses the others.</p>
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
      SPEAKERS.filter((s) => s.takesInstructions || (variant.instructions === undefined && candidate.directableOnly !== true)).map((speaker) => ({
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
        const file = join(out, `${job.ref}.${speaker.ext}`);
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
