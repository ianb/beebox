/**
 * Callback actor for the realtime transcription machine: owns the WebSocket,
 * AudioContext, MediaStream, and AudioWorklet for one recording segment.
 *
 * It queries the configured transcription service, opens the matching
 * connection (see `transcription-connections.ts`), pumps PCM frames from the
 * worklet to the service, and translates service callbacks + socket lifecycle
 * into machine events. Captured PCM is WAV-wrapped on done for narration's HQ
 * pass.
 */

import { fromCallback } from "xstate";
import pcmProcessorUrl from "../audio/pcm-processor.worklet.js?url";
import { trpcClient } from "../lib/trpc";
import { encodePcmChunksAsWav } from "../lib/wav-encode";
import {
  type ConnectionHandle,
  type ServiceCallbacks,
  startDeepgramConnection,
  startOpenAIRealtimeConnection,
  startVoxtralConnection,
} from "./transcription-connections";
import type { TranscriptionEvent } from "./transcription-events";

interface TranscriptionActorInput {
  dummy?: never;
}

export const transcriptionActor = fromCallback<
  { type: "STOP" } | { type: "CANCEL" },
  TranscriptionActorInput,
  TranscriptionEvent
>(({ sendBack, receive }) => {
  let connection: ConnectionHandle | null = null;
  let audioContext: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let workletNode: AudioWorkletNode | null = null;
  let disposed = false;
  let connectedFired = false;
  /**
   * PCM s16le chunks captured for this segment. Concatenated and WAV-wrapped
   * on TRANSCRIPTION_DONE so narration mode can re-send to the HQ pass.
   */
  const audioChunks: ArrayBuffer[] = [];

  function takeAudioBlob(): Blob | undefined {
    if (audioChunks.length === 0) return undefined;
    const blob = encodePcmChunksAsWav(audioChunks);
    audioChunks.length = 0;
    return blob;
  }

  function cleanup() {
    disposed = true;
    if (workletNode) {
      workletNode.disconnect();
      workletNode = null;
    }
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      stream = null;
    }
    if (audioContext) {
      audioContext.close().catch(() => {});
      audioContext = null;
    }
    if (connection) {
      const ws = connection.ws;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      connection = null;
    }
  }

  (async () => {
    try {
      const config = await trpcClient.transcription.config.query();
      if (disposed) { cleanup(); return; }
      const service = config.service;

      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (disposed) { cleanup(); return; }

      audioContext = new AudioContext();
      await audioContext.audioWorklet.addModule(pcmProcessorUrl);
      if (disposed) { cleanup(); return; }

      const source = audioContext.createMediaStreamSource(stream);
      workletNode = new AudioWorkletNode(audioContext, "pcm-processor");
      source.connect(workletNode);

      const callbacks: ServiceCallbacks = {
        onTextUpdate: (finalText, interimText) => {
          if (disposed) return;
          sendBack({ type: "TEXT_UPDATE", finalText, interimText });
        },
        onDone: (text) => {
          if (disposed) return;
          const audioBlob = takeAudioBlob();
          sendBack({ type: "TRANSCRIPTION_DONE", text, audioBlob });
        },
        onServerError: (message) => {
          if (disposed) return;
          sendBack({ type: "SERVER_ERROR", message });
        },
      };

      if (service === "deepgram") {
        connection = await startDeepgramConnection(callbacks);
      } else if (service === "openai-realtime") {
        connection = await startOpenAIRealtimeConnection(callbacks);
      } else {
        // Default: voxtral (whisper has no realtime path; treat like voxtral)
        connection = startVoxtralConnection(callbacks);
      }
      if (disposed) { cleanup(); return; }

      const ws = connection.ws;
      ws.onopen = () => {
        if (disposed || connectedFired) return;
        connectedFired = true;
        sendBack({ type: "WS_CONNECTED" });
      };
      ws.onerror = () => {
        if (disposed) return;
        console.error("[realtime-transcription] WebSocket error");
        sendBack({ type: "WS_ERROR", message: "WebSocket connection error" });
      };
      ws.onclose = () => {
        if (disposed) return;
        // For Deepgram and OpenAI realtime, the final transcript lives on
        // the handle — emit a TRANSCRIPTION_DONE so the machine can leave
        // finalizing.
        const handle = ws as WebSocket & {
          __dgFinal?: () => string;
          __openaiFinal?: () => string;
        };
        const finalFn = handle.__dgFinal ?? handle.__openaiFinal;
        if (finalFn) {
          const audioBlob = takeAudioBlob();
          sendBack({ type: "TRANSCRIPTION_DONE", text: finalFn(), audioBlob });
        } else {
          sendBack({ type: "WS_CLOSED" });
        }
      };

      workletNode.port.onmessage = (event) => {
        if (event.data.type === "pcm") {
          // Also keep a copy for the HQ pass (narration mode). Clone before
          // forwarding because the worklet transfers ownership of the
          // ArrayBuffer to the main thread.
          audioChunks.push(event.data.samples.slice(0));
          if (connection) connection.sendPcm(event.data.samples);
        }
      };
    } catch (err) {
      if (!disposed) {
        const msg = err instanceof Error ? err.message : "Failed to start recording";
        console.error("[realtime-transcription] Start error:", msg);
        sendBack({ type: "SETUP_ERROR", message: msg });
      }
      cleanup();
    }
  })();

  receive((event) => {
    if (event.type === "STOP") {
      // Stop capturing audio; tell the service we're done.
      if (stream) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
      }
      if (workletNode) {
        workletNode.disconnect();
        workletNode = null;
      }
      if (connection) {
        connection.endStream();
      }
      // Finalize the segment immediately rather than waiting on the WS to
      // send transcription.done — that often takes seconds or never arrives
      // (FINALIZE_TIMEOUT fallback). The realtime transcript in machine
      // context is what we have; if a better text arrives later from the WS,
      // the machine is already in idle and the event is ignored. The audio
      // blob is the thing we actually need for narration's HQ pass.
      const audioBlob = takeAudioBlob();
      sendBack({ type: "TRANSCRIPTION_DONE", audioBlob });
    } else if (event.type === "CANCEL") {
      cleanup();
    }
  });

  return cleanup;
});
