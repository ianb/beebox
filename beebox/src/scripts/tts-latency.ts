/**
 * Where the time goes before a chat reply starts speaking, per TTS backend.
 *
 * Runs the deployed path in-process against a test box: `resolveTtsService`
 * (config + secret resolution) and the real service, whose HTTP calls pass
 * through a timing `fetch` (the service's test seam). For each call it records
 * key resolution, provider response headers, first audio bytes, total, retries
 * (any second fetch is a ky retry, e.g. a 429), and payload size. A last
 * scenario sends a reply's three segments at once, as the chat client's
 * prefetch does.
 *
 * Synthetic text only. Spends real API calls on the box's granted keys, and
 * switches the box's TTS backend while running (restored at the end), so point
 * it at a throwaway test box — a worktree's `~/src/box-worktrees/<name>/test1`.
 *
 *   pnpm tsx src/scripts/tts-latency.ts --box <path> [--runs 5] [--json out.json]
 *     [--gemini-key-env VAR]
 *
 * `--gemini-key-env` sends the Gemini calls with the key in that environment
 * variable instead of the box's own (resolution is still timed against the
 * box). A free-tier key allows 10 requests a day, which this script exceeds.
 */

import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { getGeminiApiKey } from "../core/gemini-key.js";
import { getOpenAiThinkingKey } from "../core/openai-thinking-key.js";
import { loadTtsConfig, updateTtsConfig } from "../core/tts/config.js";
import { resolveTtsService } from "../core/tts/resolve.js";
import { createTtsService } from "../services/tts.js";
import { invariant } from "../shared/invariant.js";
import type { TtsBackend } from "../shared/tts-backends.js";

/** Segment lengths seen in real chat replies: one short line up to a paragraph. */
const TEXTS: Record<string, string> = {
  short: "Done. I moved the dentist appointment to Thursday at three.",
  medium: "I found three receipts from the hardware store last month. The largest was for the new porch light, "
    + "about forty-two dollars.",
  long: "Here is the plan for tomorrow. The plumber comes between eight and ten, so someone needs to be home. "
    + "After that, the library books are due, and the school wants the permission slip signed by noon.",
};
const INSTRUCTIONS = "Fast and concise, but with a friendly lilting tone.";
const VOICE = "marin";

/** Gemini's direct key allows 10 requests a minute on Tier 1; stay under it. */
const GEMINI_PACING_MS = 6_500;

interface CallTiming {
  backend: TtsBackend;
  text: string;
  resolveMs: number;
  headersMs: number;
  firstAudioMs: number;
  totalMs: number;
  fetches: number;
  bytes: number;
}

/**
 * A `fetch` that notes when headers and the first audio bytes arrive. For the
 * Gemini stream, the first chunks are lifecycle events; audio starts with the
 * first `step.delta`.
 */
function timingFetch(t0: number, audioMarker: string | null): {
  fetch: typeof fetch;
  marks: { headersMs: number; firstAudioMs: number; fetches: number };
} {
  const marks = { headersMs: -1, firstAudioMs: -1, fetches: 0 };
  const decoder = new TextDecoder();
  const timed: typeof fetch = async (input, init) => {
    marks.fetches += 1;
    const res = await fetch(input, init);
    marks.headersMs = performance.now() - t0;
    if (res.body === null) return res;
    const reader = res.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const read = await reader.read();
        if (read.done) {
          controller.close();
          return;
        }
        if (marks.firstAudioMs < 0 && (audioMarker === null || decoder.decode(read.value).includes(audioMarker))) {
          marks.firstAudioMs = performance.now() - t0;
        }
        controller.enqueue(read.value);
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    });
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  };
  return { fetch: timed, marks };
}

async function timeCall(
  boxRoot: string,
  { backend, textId, geminiKey }: { backend: TtsBackend; textId: string; geminiKey: string | undefined },
): Promise<CallTiming> {
  const t0 = performance.now();
  // The deployed resolution: config read, secret read (observed, as in production).
  const resolved = await resolveTtsService(boxRoot);
  const resolveMs = performance.now() - t0;
  const apiKey = backend === "gemini" && geminiKey !== undefined ? geminiKey : await keyOf(resolved, boxRoot);
  const { fetch: timed, marks } = timingFetch(t0, backend === "gemini" ? "step.delta" : null);
  const service = createTtsService({ backend, apiKey, fetch: timed });
  const out = await service.textToSpeech(TEXTS[textId] ?? "", { voice: VOICE, instructions: INSTRUCTIONS });
  return {
    backend,
    text: textId,
    resolveMs,
    headersMs: marks.headersMs,
    firstAudioMs: marks.firstAudioMs,
    totalMs: performance.now() - t0,
    fetches: marks.fetches,
    bytes: out.audio.length,
  };
}

/**
 * The resolved service does not expose its key, so the timing `fetch` cannot be
 * wrapped around it; re-read the key the resolver just used, unobserved.
 * `resolveTtsService` has already refused a box without one.
 */
async function keyOf(service: { backend: TtsBackend }, boxRoot: string): Promise<string> {
  const key = service.backend === "openai"
    ? await getOpenAiThinkingKey(boxRoot, { observe: false })
    : await getGeminiApiKey(boxRoot, { purpose: "speech", observe: false });
  invariant(key !== null, "resolveTtsService succeeded, so the key it read exists");
  return key;
}

const median = (xs: number[]): number => {
  const s = xs.toSorted((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
};
const sec = (ms: number): string => (ms / 1000).toFixed(2);
const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      box: { type: "string" },
      runs: { type: "string", default: "5" },
      json: { type: "string" },
      "gemini-key-env": { type: "string" },
    },
  });
  const boxRoot = values.box;
  if (boxRoot === undefined) {
    console.error("--box <path> is required: a throwaway test box, such as ~/src/box-worktrees/<name>/test1");
    process.exit(1);
  }
  const runs = Number(values.runs);
  const geminiKeyEnv = values["gemini-key-env"];
  const geminiKey = geminiKeyEnv === undefined ? undefined : process.env[geminiKeyEnv];
  if (geminiKeyEnv !== undefined && (geminiKey === undefined || geminiKey === "")) {
    console.error(`--gemini-key-env ${geminiKeyEnv}: that variable is not set`);
    process.exit(1);
  }
  const original = (await loadTtsConfig(boxRoot)).backend;
  const calls: CallTiming[] = [];
  const bursts: Array<{ backend: TtsBackend; readyMs: number[] }> = [];
  try {
    for (const backend of ["openai", "gemini"] as const) {
      await updateTtsConfig(boxRoot, { backend });
      for (let run = 0; run < runs; run++) {
        for (const textId of Object.keys(TEXTS)) {
          const timing = await timeCall(boxRoot, { backend, textId, geminiKey });
          calls.push(timing);
          console.error(`${backend} ${textId} #${String(run)} first=${sec(timing.firstAudioMs)} total=${sec(timing.totalMs)} fetches=${String(timing.fetches)}`);
          if (backend === "gemini") await sleep(GEMINI_PACING_MS);
        }
      }
      // A three-segment reply, fetched at once as the client's prefetch does.
      for (let run = 0; run < Math.min(runs, 3); run++) {
        const t0 = performance.now();
        const ready = await Promise.all(Object.keys(TEXTS).map(async (textId) => {
          await timeCall(boxRoot, { backend, textId, geminiKey });
          return performance.now() - t0;
        }));
        bursts.push({ backend, readyMs: ready });
        if (backend === "gemini") await sleep(GEMINI_PACING_MS * 3);
      }
    }
  } finally {
    await updateTtsConfig(boxRoot, { backend: original });
  }

  console.log("| backend | segment | resolve | headers | first audio | total | retries | bytes |");
  console.log("|---|---|---|---|---|---|---|---|");
  for (const backend of ["openai", "gemini"] as const) {
    for (const textId of Object.keys(TEXTS)) {
      const rows = calls.filter((c) => c.backend === backend && c.text === textId);
      const pick = (f: (c: CallTiming) => number): string => sec(median(rows.map(f)));
      const retries = rows.reduce((n, c) => n + c.fetches - 1, 0);
      console.log(`| ${backend} | ${textId} | ${pick((c) => c.resolveMs)} | ${pick((c) => c.headersMs)} | ${pick((c) => c.firstAudioMs)} | ${pick((c) => c.totalMs)} | ${String(retries)} | ${String(median(rows.map((c) => c.bytes)))} |`);
    }
  }
  for (const backend of ["openai", "gemini"] as const) {
    const b = bursts.filter((x) => x.backend === backend);
    const perSegment = Object.keys(TEXTS).map((_, i) => sec(median(b.map((x) => x.readyMs[i] ?? 0))));
    console.log(`burst ${backend}: segments ready at ${perSegment.join(" / ")} s (median of ${String(b.length)})`);
  }
  if (values.json !== undefined) writeFileSync(values.json, JSON.stringify({ calls, bursts }, null, 1));
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
