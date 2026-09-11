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
import type { FastifyReply } from "fastify";
import { WebSocket as WsWebSocket } from "ws";
import { transcribeAudioHq } from "../../core/transcription/index.js";
import { isTranscriptionError } from "../../core/transcription/voxtral-errors.js";
import {
  findLastSpeakerLetter,
  nextSpeakerLetter,
  relabelDiarizedSpeakers,
} from "../../core/transcription/voxtral.js";
import { getMistralApiKey } from "../../core/mistral-key.js";
import {
  VOICE_MODELS,
  CompiledSpeakingVoiceSchema,
  type CompiledSpeakingVoice,
} from "../../schemas/personality.js";
import { errnoCode } from "../../lib/error-guards.js";
import { HTTPError } from "ky";
import { serveMockTts } from "../tts-mock.js";
import { resolveTtsService, TtsNotConfiguredError } from "../../core/tts/resolve.js";
import { loadTtsConfig } from "../../core/tts/config.js";
import { EmptyTtsResponseError, type TtsService } from "../../services/tts.js";
import { DEFAULT_VOICE, type TtsBackend } from "../../shared/tts-backends.js";
import type { ChatRoutesContext } from "./chat-context.js";
import { readSessionLogTail } from "../../core/chat/session/session-log-tail.js";

/** Voice model names as a string set, for validating an untrusted `voice` param. */
const VOICE_MODEL_SET = new Set<string>(VOICE_MODELS);

interface TtsBody {
  text: string;
  instructions?: string;
  voice?: string;
  // Dev-only mock fields (honored only with explicit development surfaces);
  // see tts-mock.ts and the /dev/speech harness.
  mock?: boolean;
  fixture?: string;
  delayMs?: number;
  chunkMs?: number;
  chunkSize?: number;
  failText?: string;
}

function handleMockTts(options: {
  reply: FastifyReply;
  body: TtsBody;
  devSurfaces: boolean;
}): FastifyReply | undefined {
  const { reply, body, devSurfaces } = options;
  if (body.mock !== true) return undefined;
  if (!devSurfaces) {
    console.warn("[chat-tts] rejected mock request because development surfaces are disabled");
    return reply.status(400).send({ error: "mock TTS requires development surfaces" });
  }
  const { text, fixture, delayMs, chunkMs, chunkSize, failText } = body;
  return serveMockTts(reply, { text, fixture, delayMs, chunkMs, chunkSize, failText });
}

/**
 * A speech backend's failure in one line, or null when the error is not the
 * backend's (a bug here should still be a 500). ky's `HTTPError` carries the
 * provider's status; a `TypeError` from `fetch` means no response at all, with
 * the network reason in `cause`.
 */
function describeBackendFailure(e: unknown): string | null {
  if (e instanceof HTTPError) return `TTS backend answered ${String(e.response.status)} ${e.response.statusText}`.trim();
  if (e instanceof TypeError) {
    const reason = e.cause instanceof Error ? e.cause.message : e.message;
    return `TTS backend unreachable: ${reason}`;
  }
  return null;
}

export function registerChatAudioRoutes(ctx: ChatRoutesContext): void {
  const { server, boxRoot, openaiAudio, devSurfaces } = ctx;

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
        return { text: result.text, diarized: false, service: result.service };
      }
      // Diarized: tag this recording's speakers with a per-session letter
      // so the agent can tell "Speaker 1A" (recording 1) and "Speaker 1B"
      // (recording 2) are different people. Letter advances on every
      // diarized call by scanning prior log content for the highest
      // letter used so far.
      const priorText = sessionId !== null ? await readSessionLogTail(boxRoot, sessionId) : "";
      const letter = nextSpeakerLetter(findLastSpeakerLetter(priorText));
      const relabeled = relabelDiarizedSpeakers(result.text, letter);
      return { text: relabeled, diarized: true, service: result.service };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[transcribe-audio] HQ transcription failed:", msg);
      // A transcription error already knows whether retrying could help
      // (`permanent`) and carries a stable `code`. Both go to the client, so a
      // misconfiguration — no key for the configured service — can be shown
      // once and named, instead of being indistinguishable from a bad network
      // moment that the realtime fallback rightly absorbs.
      const detail = isTranscriptionError(e) ? { code: e.code, permanent: e.permanent } : { permanent: false };
      return reply.status(500).send({ error: msg, ...detail });
    }
  });

  // GET /api/chat/voice-config — the personality's speaking voice, plus which
  // engine will speak it. The backend rides along because the client keys its
  // audio cache on it: the same text in the same voice sounds like a different
  // person on a different backend.
  server.get("/api/chat/voice-config", async (_request, _reply): Promise<CompiledSpeakingVoice & { backend: TtsBackend }> => {
    const { backend } = await loadTtsConfig(boxRoot);
    try {
      const voicePath = path.join(boxRoot, "_content/docs/generated/speaking-voice.json");
      const content = await fs.readFile(voicePath, "utf-8");
      const parsed = CompiledSpeakingVoiceSchema.safeParse(JSON.parse(content));
      if (parsed.success) {
        return { model: parsed.data.model, instructions: parsed.data.instructions, backend };
      }
      console.warn("[chat] speaking-voice.json failed validation:", parsed.error.message);
      return { model: undefined, instructions: [], backend };
    } catch (e) {
      if (errnoCode(e) !== "ENOENT") {
        console.warn("[chat] failed to read speaking-voice.json:", e);
      }
      return { model: undefined, instructions: [], backend };
    }
  });

  // POST /api/chat/tts - Proxy TTS requests to OpenAI
  server.post<{ Body: TtsBody }>("/api/chat/tts", async (request, reply) => {
    // Serve slow fixture audio instead of calling OpenAI, for the speech
    // browser test. A missing dev opt-in rejects rather than falling through
    // to a paid provider call.
    const mockReply = handleMockTts({ reply, body: request.body, devSurfaces });
    if (mockReply !== undefined) return mockReply;

    const { text, instructions, voice } = request.body;
    const resolvedVoice = voice && VOICE_MODEL_SET.has(voice) ? voice : DEFAULT_VOICE;

    // The injected service is the test seam; production resolves one from the
    // box's configured backend. There is no third path — the inline provider
    // call this route used to carry is what let the service interface sit
    // unused (docs/plans/tts-backend-selection.md, Track 1).
    let service: TtsService;
    try {
      service = openaiAudio ?? await resolveTtsService(boxRoot);
    } catch (e) {
      if (e instanceof TtsNotConfiguredError) return reply.status(500).send({ error: e.message });
      throw e;
    }

    const ttsOpts: { voice?: string; instructions?: string } = { voice: resolvedVoice };
    if (instructions) ttsOpts.instructions = instructions;
    try {
      const result = await service.textToSpeech(text, ttsOpts);
      reply.header("Content-Type", result.contentType);
      return reply.send(result.audio);
    } catch (e) {
      if (e instanceof EmptyTtsResponseError) {
        // Loud rather than silent: a zero-length body played as success is
        // indistinguishable from broken speakers (principle 4).
        console.error(`[chat-tts] ${e.message}`);
        return reply.status(502).send({ error: e.message });
      }
      // The backend answered with an error, or never answered at all. Both
      // are the backend's failure, not ours: a 502 that names it, not a bare
      // 500 "Internal server error" with the reason lost (2026-09-08: a
      // "fetch failed" on this route reached the boxholder as exactly that).
      const failure = describeBackendFailure(e);
      if (failure !== null) {
        console.error(`[chat-tts] ${failure}`);
        return reply.status(502).send({ error: failure });
      }
      throw e;
    }
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
