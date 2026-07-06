/**
 * Per-service WebSocket connection helpers for the realtime transcription
 * machine. Each `start*Connection` opens a socket to its service, wires up
 * onmessage parsing into the shared {@link ServiceCallbacks}, and returns a
 * {@link ConnectionHandle} the actor uses to push PCM and end the stream.
 *
 * See `realtimeTranscriptionMachine.ts` for the service-branching docs.
 */

import { getApiBase } from "../api";
import { deepgramKeyManager } from "../lib/audio/deepgram-key";
import { openaiRealtimeKeyManager } from "../lib/audio/openai-realtime-key";

export interface ConnectionHandle {
  ws: WebSocket;
  /** Send a chunk of 16-bit PCM (16kHz mono) to the service. */
  sendPcm: (samples: ArrayBuffer) => void;
  /** Tell the service we're done sending audio. */
  endStream: () => void;
}

export interface ServiceCallbacks {
  onTextUpdate: (finalText: string, interimText: string) => void;
  onDone: (text?: string) => void;
  onServerError: (message: string) => void;
}

/**
 * How often to send Deepgram a KeepAlive text frame. Deepgram closes an idle
 * socket (no audio *or* KeepAlive) after 10s with 1011/NET-0001, so 5s leaves a
 * comfortable margin. During active recording the continuous PCM frames already
 * reset the timer; KeepAlive is the belt-and-suspenders that covers any pause
 * in audio (e.g. a silent gap between turns) without dropping the connection.
 */
const DEEPGRAM_KEEPALIVE_INTERVAL_MS = 5000;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary);
}

export function startVoxtralConnection(callbacks: ServiceCallbacks): ConnectionHandle {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}${getApiBase()}/chat/transcribe-ws`;
  const ws = new WebSocket(wsUrl);
  let accumulated = "";

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "transcription.text.delta") {
        const delta = msg.delta ?? msg.text ?? "";
        if (delta) {
          accumulated += delta;
          callbacks.onTextUpdate(accumulated, "");
        }
      } else if (msg.type === "transcription.done") {
        const text = typeof msg.text === "string" && msg.text ? msg.text : accumulated;
        callbacks.onDone(text);
      } else if (msg.type === "error") {
        const errMsg = typeof msg.error === "object"
          ? (msg.error as { message?: string })?.message || JSON.stringify(msg.error)
          : msg.error || "Transcription error";
        callbacks.onServerError(String(errMsg));
      }
      // session.created, session.updated, transcription.segment,
      // transcription.language — log only / ignore
    } catch (_e) {
      // Non-JSON message, ignore
    }
  };

  return {
    ws,
    sendPcm: (samples) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({
        type: "input_audio.append",
        audio: arrayBufferToBase64(samples),
      }));
    },
    endStream: () => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "input_audio.end" }));
    },
  };
}

export async function startDeepgramConnection(callbacks: ServiceCallbacks): Promise<ConnectionHandle> {
  const tempKey = await deepgramKeyManager.getKey();
  const params = new URLSearchParams({
    model: "nova-3",
    encoding: "linear16",
    sample_rate: "16000",
    channels: "1",
    interim_results: "true",
    smart_format: "true",
    punctuate: "true",
    no_delay: "true",
    endpointing: "1500",
    utterance_end_ms: "1500",
    mip_opt_out: "true",
    language: "en-US",
  });
  const wsUrl = `wss://api.deepgram.com/v1/listen?${params.toString()}`;
  const ws = new WebSocket(wsUrl, ["token", tempKey]);
  let accumulatedFinal = "";

  // Keep the socket alive across silent gaps; self-clears once the socket is
  // closing/closed so a discarded (reconnect) or finished socket leaves no
  // dangling timer. Must be a text frame per Deepgram's spec.
  const keepAliveId = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "KeepAlive" }));
    } else if (ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) {
      clearInterval(keepAliveId);
    }
  }, DEEPGRAM_KEEPALIVE_INTERVAL_MS);

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "Results") {
        const transcript: string = msg.channel?.alternatives?.[0]?.transcript ?? "";
        const isFinal: boolean = !!msg.is_final;
        if (isFinal) {
          if (transcript.trim()) {
            accumulatedFinal = (accumulatedFinal + " " + transcript).trim();
          }
          callbacks.onTextUpdate(accumulatedFinal, "");
        } else {
          callbacks.onTextUpdate(accumulatedFinal, transcript);
        }
      } else if (msg.type === "UtteranceEnd") {
        // Drop any stray interim
        callbacks.onTextUpdate(accumulatedFinal, "");
      } else if (msg.type === "Metadata") {
        // Sent at session end — ignore here, onclose drives done
      } else if (msg.type === "Error" || msg.type === "error") {
        const errMsg = msg.description || msg.message || JSON.stringify(msg);
        callbacks.onServerError(String(errMsg));
      }
    } catch (_e) {
      // Non-JSON message, ignore
    }
  };

  // The done signal is delivered when Deepgram closes the socket after
  // CloseStream — wire it via the actor's onclose handler below by stashing
  // the accumulated text on the handle.
  (ws as WebSocket & { __dgFinal?: () => string }).__dgFinal = () => accumulatedFinal;

  return {
    ws,
    sendPcm: (samples) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(samples);
    },
    endStream: () => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "CloseStream" }));
    },
  };
}

/**
 * Linear-interpolate 16kHz Int16 PCM up to 24kHz (3 output samples per 2
 * input samples). OpenAI's realtime audio input requires rate >= 24000;
 * the shared pcm-processor worklet emits 16kHz for Deepgram/Voxtral, so we
 * upsample on this path rather than forking the worklet.
 */
function upsamplePcm16To24(buf: ArrayBuffer): ArrayBuffer {
  const src = new Int16Array(buf);
  if (src.length === 0) return new ArrayBuffer(0);
  const outLen = Math.floor((src.length * 3) / 2);
  const out = new Int16Array(outLen);
  const lastIdx = src.length - 1;
  for (let i = 0; i < outLen; i++) {
    const pos = (i * 2) / 3;
    const i0 = Math.floor(pos);
    const i1 = i0 < lastIdx ? i0 + 1 : lastIdx;
    const frac = pos - i0;
    out[i] = Math.round(src[i0] * (1 - frac) + src[i1] * frac);
  }
  return out.buffer;
}

export async function startOpenAIRealtimeConnection(callbacks: ServiceCallbacks): Promise<ConnectionHandle> {
  const tempKey = await openaiRealtimeKeyManager.getKey();
  // Browsers can't set an Authorization header on WebSocket, so OpenAI
  // accepts the ephemeral client secret via subprotocol.
  // Transcription sessions: no `?model=` param (the server rejects it) and
  // no `?intent=transcription` (that was beta-only). The session's type and
  // transcription model are set via the session.update sent on open.
  const wsUrl = "wss://api.openai.com/v1/realtime";
  const ws = new WebSocket(wsUrl, [
    "realtime",
    `openai-insecure-api-key.${tempKey}`,
  ]);
  let accumulatedFinal = "";

  ws.addEventListener("open", () => {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: "session.update",
      session: {
        type: "transcription",
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24000 },
            transcription: { model: "gpt-realtime-whisper" },
          },
        },
      },
    }));
  });

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "conversation.item.input_audio_transcription.delta") {
        // Whisper deltas are stable (no LLM-style revisions), and without
        // turn_detection the .completed event won't fire until the user
        // stops — so keyword spotting (which runs on finalTranscript only)
        // would never see anything mid-utterance. Treat each delta as final.
        const delta: string = msg.delta ?? "";
        if (delta) {
          accumulatedFinal = accumulatedFinal + delta;
          callbacks.onTextUpdate(accumulatedFinal, "");
        }
      } else if (msg.type === "conversation.item.input_audio_transcription.completed") {
        // Deltas already streamed the full text into accumulatedFinal; the
        // completed event is just a segment marker. Nothing to append.
        callbacks.onTextUpdate(accumulatedFinal, "");
      } else if (msg.type === "conversation.item.input_audio_transcription.failed") {
        const errMsg = msg.error?.message || "Transcription failed";
        callbacks.onServerError(String(errMsg));
      } else if (msg.type === "error") {
        const errMsg = msg.error?.message || JSON.stringify(msg.error ?? msg);
        callbacks.onServerError(String(errMsg));
      }
      // session.created, session.updated, input_audio_buffer.* — ignore
    } catch (_e) {
      // Non-JSON message, ignore
    }
  };

  // Mirror the Deepgram pattern: the actor's onclose finalizes from the
  // accumulated text on the handle.
  (ws as WebSocket & { __openaiFinal?: () => string }).__openaiFinal = () => accumulatedFinal;

  return {
    ws,
    sendPcm: (samples) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const upsampled = upsamplePcm16To24(samples);
      ws.send(JSON.stringify({
        type: "input_audio_buffer.append",
        audio: arrayBufferToBase64(upsampled),
      }));
    },
    endStream: () => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    },
  };
}
