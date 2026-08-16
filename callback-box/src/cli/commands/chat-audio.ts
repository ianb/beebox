/**
 * cb chat — audio subcommands.
 *
 * - `cb chat get-last-audio` fetches the original recording of the user's
 *   most recent voice message from the connected browser tab and writes it
 *   to a temp file (the browser caches the last segment's WAV; the server
 *   relays the request over the event bus — see chat-last-audio-routes.ts).
 * - `cb chat ask-about-audio "<question>"` goes one step further: fetch the
 *   recording (or take `--file`) and put the question to an audio-capable
 *   model (Claude cannot listen to audio; Gemini can — see
 *   core/audio-question.ts), printing its answer.
 * - `cb chat retranscribe` re-runs the recording through the HQ
 *   transcription pass (Whisper/Voxtral) — for when narration mode was off,
 *   so the message committed with the realtime transcript, and that
 *   transcript looks wrong.
 *
 * Registered on the `cb chat` command in chat.ts.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Command } from "commander";
import { resolveAgentToken } from "../../core/agent/token.js";
import { askAudioQuestion, resolveGeminiKey } from "../../core/audio-question.js";
import {
  transcribeAudioHq,
  HQ_TRANSCRIPTION_SERVICES,
  type HqTranscriptionService,
} from "../../core/transcription/index.js";
import { findBoxRoot } from "../../lib/paths.js";

const HQ_SERVICE_SET = new Set<string>(HQ_TRANSCRIPTION_SERVICES);
/** Type guard for the `--service` option against the known HQ services. */
function isHqTranscriptionService(value: string): value is HqTranscriptionService {
  return HQ_SERVICE_SET.has(value);
}

/**
 * Request headers for loopback calls to the live server: JSON content type
 * plus the per-box agent bearer when available (required to pass the auth
 * wall in production; harmless when auth is disabled in dev).
 */
export function loopbackHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = resolveAgentToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

/** File extension for the audio Content-Type the browser sent. */
function audioExtension(contentType: string): string {
  if (contentType.includes("wav")) return "wav";
  if (contentType.includes("webm")) return "webm";
  if (contentType.includes("ogg")) return "ogg";
  if (contentType.includes("mpeg")) return "mp3";
  if (contentType.includes("mp4")) return "m4a";
  return "bin";
}

/** Audio MIME type for a file path's extension, or null when unrecognized. */
export function audioMimeType(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    ".wav": "audio/wav",
    ".webm": "audio/webm",
    ".ogg": "audio/ogg",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".mp4": "audio/mp4",
    ".flac": "audio/flac",
    ".aac": "audio/aac",
  };
  return types[ext] ?? null;
}

interface LastAudioFetch {
  audio: Buffer;
  contentType: string;
  recordedAt: string | null;
  /** Transcript snippet of the message the recording belongs to. */
  text: string | null;
  /**
   * The emission id the recording is retained under, or null when the
   * answering tab didn't send one (old tab, or no session context yet).
   * Not surfaced to stdout yet — Tracks 1b/2 consume it.
   */
  messageId: string | null;
  /** The answering tab's chat session id, or null under the same conditions. */
  sessionId: string | null;
}

/**
 * Long-poll the server for the last voice message's recording. Prints a
 * user-facing error and exits the process on any failure — callers only see
 * the success path.
 */
async function fetchLastAudio(opts: {
  commandLabel: string;
  timeoutSeconds: number;
}): Promise<LastAudioFetch> {
  const { commandLabel, timeoutSeconds } = opts;
  const serverUrl = process.env.CB_SERVER_URL;
  const boxName = process.env.CB_BOX_NAME;
  if (!serverUrl || !boxName) {
    console.error(`${commandLabel}: CB_SERVER_URL and CB_BOX_NAME must be set`);
    process.exit(1);
  }
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    console.error(`${commandLabel}: invalid --timeout ${timeoutSeconds}`);
    process.exit(1);
  }

  const url = `${serverUrl.replace(/\/+$/, "")}/${boxName}/api/chat/last-audio/request`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: loopbackHeaders(),
      body: JSON.stringify({ timeoutMs: Math.round(timeoutSeconds * 1000) }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${commandLabel}: request failed: ${msg}`);
    process.exit(1);
  }

  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed !== null && typeof parsed === "object" && "message" in parsed && typeof parsed.message === "string") {
        message = parsed.message;
      }
    } catch (_e) {
      // Not JSON — report the raw body.
    }
    console.error(`${commandLabel}: ${message} (HTTP ${res.status})`);
    process.exit(1);
  }

  const encodedText = res.headers.get("x-message-text");
  const encodedMessageId = res.headers.get("x-message-id");
  const encodedSessionId = res.headers.get("x-session-id");
  return {
    audio: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get("content-type") ?? "",
    recordedAt: res.headers.get("x-recorded-at"),
    text: encodedText !== null ? decodeURIComponent(encodedText) : null,
    messageId: encodedMessageId !== null ? decodeURIComponent(encodedMessageId) : null,
    sessionId: encodedSessionId !== null ? decodeURIComponent(encodedSessionId) : null,
  };
}

interface GetLastAudioOptions {
  out?: string;
  timeout?: string;
}

export const getLastAudioCommand = new Command("get-last-audio")
  .description("Fetch the recording of the user's most recent voice message from the connected chat tab")
  .option("--out <path>", "Write the audio to this path (default: a fresh temp file)")
  .option("--timeout <seconds>", "How long to wait for a browser tab to answer (default 10)")
  .action(async (options: GetLastAudioOptions) => {
    const fetched = await fetchLastAudio({
      commandLabel: "cb chat get-last-audio",
      timeoutSeconds: options.timeout !== undefined ? Number(options.timeout) : 10,
    });

    let outPath: string;
    if (options.out !== undefined) {
      outPath = path.resolve(options.out);
    } else {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cb-last-audio-"));
      outPath = path.join(dir, `last-message.${audioExtension(fetched.contentType)}`);
    }
    await fs.writeFile(outPath, fetched.audio);

    // Path first so callers can take line 1; metadata lines identify which
    // message the recording belongs to.
    console.log(outPath);
    if (fetched.recordedAt !== null) console.log(`recorded-at: ${fetched.recordedAt}`);
    if (fetched.text !== null) console.log(`text: ${fetched.text}`);
  });

interface AskAboutAudioOptions {
  file?: string;
  timeout?: string;
  context?: string;
  transcript?: string;
}

export const askAboutAudioCommand = new Command("ask-about-audio")
  .description("Ask an audio-capable model a question about the user's most recent voice message (or --file)")
  .argument("<question>", "Question to answer about the audio (e.g. pronunciation critique, what's said, background sounds)")
  .option("--file <path>", "Ask about this audio file instead of fetching the last voice message")
  .option("--context <text>", "Conversational context for the model — what the recording is in response to, what the user is working on")
  .option("--transcript <text>", "Known transcription of the recording, for the model to verify against the audio (defaults to the system's own transcript when fetching the last voice message)")
  .option("--timeout <seconds>", "How long to wait for a browser tab to answer (default 10)")
  .action(async (question: string, options: AskAboutAudioOptions) => {
    const label = "cb chat ask-about-audio";
    if (!question.trim()) {
      console.error(`${label}: question is empty`);
      process.exit(1);
    }
    // Fail before bothering the browser when the model isn't reachable anyway.
    const apiKey = resolveGeminiKey();
    if (!apiKey) {
      console.error(`${label}: GEMINI_KEY is not set — the audio model is not configured`);
      process.exit(1);
    }

    let audio: Buffer;
    let mimeType: string;
    let recordedAt: string | null = null;
    let transcript: string | null = options.transcript ?? null;
    if (options.file !== undefined) {
      const filePath = path.resolve(options.file);
      const mime = audioMimeType(filePath);
      if (mime === null) {
        console.error(`${label}: unrecognized audio extension on ${filePath}`);
        process.exit(1);
      }
      mimeType = mime;
      try {
        audio = await fs.readFile(filePath);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`${label}: cannot read ${filePath}: ${msg}`);
        process.exit(1);
      }
    } else {
      const fetched = await fetchLastAudio({
        commandLabel: label,
        timeoutSeconds: options.timeout !== undefined ? Number(options.timeout) : 10,
      });
      audio = fetched.audio;
      mimeType = fetched.contentType || "audio/wav";
      recordedAt = fetched.recordedAt;
      // The system's own transcript rides along automatically so the model
      // can flag transcription flaws; an explicit --transcript wins.
      transcript = transcript ?? fetched.text;
    }

    try {
      const { answer, model } = await askAudioQuestion(apiKey, {
        audio,
        mimeType,
        question,
        context: options.context,
        transcript: transcript ?? undefined,
      });
      console.log(answer.trim());
      // Footer identifies which recording was analyzed and by what.
      console.log("--");
      if (recordedAt !== null) console.log(`recorded-at: ${recordedAt}`);
      if (transcript !== null) console.log(`transcript: ${transcript}`);
      console.log(`model: ${model}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`${label}: audio model request failed: ${msg}`);
      process.exit(1);
    }
  });

interface RetranscribeOptions {
  service?: string;
  file?: string;
  timeout?: string;
  diarize?: boolean;
  timestamps?: boolean;
}

export const retranscribeCommand = new Command("retranscribe")
  .description("Re-run the user's most recent voice message (or --file) through high-quality transcription")
  .option("--service <name>", `HQ service to use: ${HQ_TRANSCRIPTION_SERVICES.join(", ")} (default: the box's hqService config)`)
  .option("--diarize", "Label speakers in the output (uses Voxtral — the only HQ service with diarization)")
  .option("--file <path>", "Transcribe this audio file instead of fetching the last voice message")
  .option("--timeout <seconds>", "How long to wait for a browser tab to answer (default 10)")
  .option("--timestamps", "Request word-level timing and write it to a `<audio>.words.json` sidecar (voxtral/whisper/deepgram only)")
  .action(async (options: RetranscribeOptions) => {
    const label = "cb chat retranscribe";
    let service: HqTranscriptionService | undefined;
    if (options.service !== undefined) {
      if (!isHqTranscriptionService(options.service)) {
        console.error(`${label}: unknown --service ${options.service} (expected one of: ${HQ_TRANSCRIPTION_SERVICES.join(", ")})`);
        process.exit(1);
      }
      service = options.service;
    }
    if (options.diarize === true) {
      // --diarize asks for the capability; only Voxtral has it.
      if (service !== undefined && service !== "voxtral" && service !== "voxtral-diarized") {
        console.error(`${label}: --service ${service} does not support diarization (only voxtral does)`);
        process.exit(1);
      }
      service = "voxtral-diarized";
    }

    let audio: Buffer;
    let filename: string;
    // Where the audio lives on disk; the word-timestamp sidecar is written
    // alongside it. For a fetched last-message there's no source file, so we
    // anchor the sidecar in the cwd under the synthesized filename.
    let audioPath: string;
    let recordedAt: string | null = null;
    let realtimeTranscript: string | null = null;
    if (options.file !== undefined) {
      const filePath = path.resolve(options.file);
      try {
        audio = await fs.readFile(filePath);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`${label}: cannot read ${filePath}: ${msg}`);
        process.exit(1);
      }
      filename = path.basename(filePath);
      audioPath = filePath;
    } else {
      const fetched = await fetchLastAudio({
        commandLabel: label,
        timeoutSeconds: options.timeout !== undefined ? Number(options.timeout) : 10,
      });
      audio = fetched.audio;
      filename = `last-message.${audioExtension(fetched.contentType)}`;
      audioPath = path.resolve(filename);
      recordedAt = fetched.recordedAt;
      realtimeTranscript = fetched.text;
    }

    const boxRoot = await findBoxRoot(process.cwd());
    try {
      const result = await transcribeAudioHq(
        {
          audioBuffer: audio,
          filename,
          ...(boxRoot !== null ? { boxRoot } : {}),
          ...(options.timestamps === true ? { options: { wordTimestamps: true } } : {}),
        },
        { service },
      );
      console.log(result.text.trim());

      // When asked, write word-level timing to a sidecar next to the audio
      // rather than inlining it into the transcript body.
      let sidecarPath: string | null = null;
      if (options.timestamps === true) {
        if ("words" in result && result.words.length > 0) {
          sidecarPath = `${audioPath}.words.json`;
          await fs.writeFile(sidecarPath, JSON.stringify(result.words, null, 2) + "\n");
        } else {
          console.error(`${label}: --timestamps requested but service ${service ?? "(box default)"} returned no word timing`);
        }
      }

      // Footer: what produced this, and the realtime transcript it replaces
      // so the caller can see what the live pass got wrong.
      console.log("--");
      console.log(`service: ${service ?? "(box default)"}`);
      if (result.diarized === true) console.log("diarized: true");
      if (sidecarPath !== null) console.log(`word-timestamps: ${sidecarPath}`);
      if (recordedAt !== null) console.log(`recorded-at: ${recordedAt}`);
      if (realtimeTranscript !== null) console.log(`realtime-transcript: ${realtimeTranscript}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`${label}: transcription failed: ${msg}`);
      process.exit(1);
    }
  });
