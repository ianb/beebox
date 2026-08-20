/**
 * Chat audio routes: speech-to-text, text-to-speech, and the realtime
 * transcription WebSocket proxy.
 *
 * POST /api/chat/transcribe-audio - narration-mode checkpoint HQ pass
 * GET  /api/chat/voice-config     - speaking voice config from personality
 * POST /api/chat/tts              - proxy TTS to OpenAI (or dev mock)
 * GET  /api/chat/transcribe-ws    - WebSocket proxy to Mistral Voxtral Realtime
 *
 * Split out of `chat.ts`; shares the box root and OpenAI audio service via
 * {@link ChatRoutesContext}.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import ky from "ky";
import { WebSocket as WsWebSocket } from "ws";
import { transcribeAudioHq } from "../../core/transcription/index.js";
import {
  findLastSpeakerLetter,
  nextSpeakerLetter,
  relabelDiarizedSpeakers,
} from "../../core/transcription/voxtral.js";
import { getOpenAiThinkingKey } from "../../core/openai-thinking-key.js";
import { getMistralApiKey } from "../../core/mistral-key.js";
import {
  VOICE_MODELS,
  CompiledSpeakingVoiceSchema,
  type CompiledSpeakingVoice,
} from "../../schemas/personality.js";
import { errnoCode } from "../../lib/error-guards.js";
import { serveMockTts } from "../tts-mock.js";
import type { ChatRoutesContext } from "./chat-context.js";
import { readSessionLogTail } from "./chat-helpers.js";

/** Voice model names as a string set, for validating an untrusted `voice` param. */
const VOICE_MODEL_SET = new Set<string>(VOICE_MODELS);

interface TtsBody {
  text: string;
  instructions?: string;
  voice?: string;
  // Dev-only mock fields (honored only when NODE_ENV !== "production");
  // see tts-mock.ts and the /dev/speech harness.
  mock?: boolean;
  fixture?: string;
  delayMs?: number;
  chunkMs?: number;
  chunkSize?: number;
  failText?: string;
}

export function registerChatAudioRoutes(ctx: ChatRoutesContext): void {
  const { server, boxRoot, openaiAudio } = ctx;

  // POST /api/chat/transcribe-audio — narration-mode checkpoint HQ pass.
  // Accepts a single audio file upload; dispatches to the configured HQ
  // service (whisper or voxtral) and returns the transcribed text.
  server.post("/api/chat/transcribe-audio", async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.status(400).send({ error: "No audio uploaded" });
    const buffer = await data.toBuffer();
    const filename = data.filename || "segment.webm";
    // Session id arrives as a multipart text field alongside the audio.
    // Optional — without it we can't look up prior speaker letters, so
    // diarized output starts at "A".
    const sessionField = data.fields["session"];
    const sessionId = sessionField && "value" in sessionField && typeof sessionField.value === "string"
      ? sessionField.value
      : null;
    try {
      const result = await transcribeAudioHq({
        audioBuffer: buffer,
        filename,
        boxRoot,
      });
      if (result.diarized !== true) {
        return { text: result.text, diarized: false };
      }
      // Diarized: tag this recording's speakers with a per-session letter
      // so the agent can tell "Speaker 1A" (recording 1) and "Speaker 1B"
      // (recording 2) are different people. Letter advances on every
      // diarized call by scanning prior log content for the highest
      // letter used so far.
      const priorText = sessionId !== null ? await readSessionLogTail(boxRoot, sessionId) : "";
      const letter = nextSpeakerLetter(findLastSpeakerLetter(priorText));
      const relabeled = relabelDiarizedSpeakers(result.text, letter);
      return { text: relabeled, diarized: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[transcribe-audio] HQ transcription failed:", msg);
      return reply.status(500).send({ error: msg });
    }
  });

  // GET /api/chat/voice-config - Return speaking voice config from personality
  server.get("/api/chat/voice-config", async (_request, _reply): Promise<CompiledSpeakingVoice> => {
    try {
      const voicePath = path.join(boxRoot, "docs/generated/speaking-voice.json");
      const content = await fs.readFile(voicePath, "utf-8");
      const parsed = CompiledSpeakingVoiceSchema.safeParse(JSON.parse(content));
      if (parsed.success) {
        return { model: parsed.data.model, instructions: parsed.data.instructions };
      }
      console.warn("[chat] speaking-voice.json failed validation:", parsed.error.message);
      return { model: undefined, instructions: [] };
    } catch (e) {
      if (errnoCode(e) !== "ENOENT") {
        console.warn("[chat] failed to read speaking-voice.json:", e);
      }
      return { model: undefined, instructions: [] };
    }
  });

  // POST /api/chat/tts - Proxy TTS requests to OpenAI
  server.post<{ Body: TtsBody }>("/api/chat/tts", async (request, reply) => {
    const { text, instructions, voice, mock, fixture } = request.body;
    const { delayMs, chunkMs, chunkSize, failText } = request.body;

    // Serve slow fixture audio instead of calling OpenAI, for the speech
    // browser test. Never reachable in production.
    if (mock && process.env.NODE_ENV !== "production") {
      return serveMockTts(reply, { text, fixture, delayMs, chunkMs, chunkSize, failText });
    }

    const resolvedVoice = voice && VOICE_MODEL_SET.has(voice) ? voice : "marin";

    if (openaiAudio) {
      const ttsOpts: { voice?: string; instructions?: string } = { voice: resolvedVoice };
      if (instructions) ttsOpts.instructions = instructions;
      const result = await openaiAudio.textToSpeech(text, ttsOpts);
      reply.header("Content-Type", result.contentType);
      return reply.send(result.audio);
    }

    const apiKey = await getOpenAiThinkingKey(boxRoot, { observe: true });
    if (!apiKey) {
      return reply.status(500).send({ error: "TTS API key not configured" });
    }
    const response = await ky.post("https://api.openai.com/v1/audio/speech", {
      json: {
        model: "gpt-4o-mini-tts-2025-03-20",
        input: text,
        voice: resolvedVoice,
        response_format: "mp3",
        instructions:
          instructions ||
          "Fast and concise, but with a friendly lilting tone.",
      },
      headers: { Authorization: `Bearer ${apiKey}` },
      retry: 2,
      timeout: 30_000,
    });
    reply.header("Content-Type", "audio/mpeg");
    return reply.send(response.body);
  });

  // GET /api/chat/transcribe-ws - WebSocket proxy to Mistral Voxtral Realtime
  server.get("/api/chat/transcribe-ws", { websocket: true }, async (socket) => {
    const apiKey = await getMistralApiKey(boxRoot, { observe: true });
    if (!apiKey) {
      console.error("[transcribe-ws] Mistral API key not found");
      socket.send(JSON.stringify({ type: "error", error: "Mistral API key not configured" }));
      socket.close(1008, "API key not configured");
      return;
    }

    const mistralModel = "voxtral-mini-transcribe-realtime-2602";
    const mistralUrl = `wss://api.mistral.ai/v1/audio/transcriptions/realtime?model=${encodeURIComponent(mistralModel)}`;
    const queued: string[] = [];
    let mistralReady = false;

    console.log(`[transcribe-ws] Session started (key: ${apiKey.slice(0, 8)}..., model: ${mistralModel})`);

    const mistral = new WsWebSocket(mistralUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    mistral.on("open", () => {
      mistralReady = true;
      for (const msg of queued) {
        mistral.send(msg);
      }
      queued.length = 0;
    });

    mistral.on("message", (data) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(data.toString());
      }
    });

    mistral.on("error", (err) => {
      console.error(`[transcribe-ws] Mistral error: ${err.message}`);
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ type: "error", error: `Transcription failed: ${err.message}` }));
        socket.close(1011, "Mistral error");
      }
    });

    mistral.on("close", (code, reason) => {
      const reasonStr = reason.toString() || "(no reason)";
      console.log(`[transcribe-ws] Mistral closed: code=${code} reason=${reasonStr}`);
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ type: "error", error: `Transcription connection closed (code ${code})` }));
        socket.close(1000, "Mistral closed");
      }
    });

    socket.on("message", (data) => {
      const text = data.toString();
      if (mistralReady && mistral.readyState === WsWebSocket.OPEN) {
        mistral.send(text);
      } else {
        queued.push(text);
      }
    });

    socket.on("close", () => {
      console.log("[transcribe-ws] Browser disconnected");
      if (mistral.readyState === WsWebSocket.OPEN || mistral.readyState === WsWebSocket.CONNECTING) {
        mistral.close();
      }
    });

    socket.on("error", (err) => {
      console.error("[transcribe-ws] Browser socket error:", err.message);
      if (mistral.readyState === WsWebSocket.OPEN) {
        mistral.close();
      }
    });
  });
}
