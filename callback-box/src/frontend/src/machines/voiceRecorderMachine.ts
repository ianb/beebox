/**
 * XState machine for voice recording.
 *
 * States: idle → requestingMic → recording → uploading → idle
 *
 * Non-serializable resources (MediaRecorder, MediaStream, Blob chunks)
 * are owned by callback actors, not stored in context. Context stays
 * serializable for persistence, devtools, and event replay.
 */

import { setup, assign, fromCallback, fromPromise } from "xstate";

export interface VoiceRecordingResult {
  blob: Blob;
  mimeType: string;
  duration: number;
}

interface VoiceRecorderContext {
  error: string | null;
  duration: number;
  startTime: number;
  onComplete: (result: VoiceRecordingResult) => Promise<void>;
}

type VoiceRecorderEvent =
  | { type: "START" }
  | { type: "STOP" }
  | { type: "TICK" }
  | { type: "RECORDER_STOPPED"; blob: Blob; mimeType: string }
  | { type: "RECORDER_ERROR"; message: string };

function getMimeType(): string {
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
    return "audio/webm;codecs=opus";
  }
  if (MediaRecorder.isTypeSupported("audio/webm")) {
    return "audio/webm";
  }
  return "";
}

/**
 * Callback actor that owns the MediaRecorder and MediaStream.
 * Receives STOP commands from parent, sends back the final blob.
 */
interface RecorderInput { stream: MediaStream }
type RecorderParentEvent = VoiceRecorderEvent;

const mediaRecorderActor = fromCallback<
  { type: "STOP" },
  RecorderInput,
  RecorderParentEvent
>(({ sendBack, receive, input }) => {
  const { stream } = input;
  const mimeType = getMimeType();
  const mediaRecorder = new MediaRecorder(
    stream,
    mimeType ? { mimeType } : undefined
  );
  const chunks: Blob[] = [];

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
      chunks.push(e.data);
    }
  };

  mediaRecorder.onstop = () => {
    const blob = new Blob(chunks, {
      type: mediaRecorder.mimeType || "audio/webm",
    });
    sendBack({
      type: "RECORDER_STOPPED",
      blob,
      mimeType: mediaRecorder.mimeType || "audio/webm",
    });
  };

  mediaRecorder.onerror = () => {
    sendBack({ type: "RECORDER_ERROR", message: "Recording failed" });
  };

  mediaRecorder.start(1000);

  receive((event) => {
    if (event.type === "STOP") {
      if (mediaRecorder.state === "recording") {
        mediaRecorder.stop();
      }
    }
  });

  return () => {
    // Cleanup: stop recorder if still active, release mic
    if (mediaRecorder.state === "recording") {
      mediaRecorder.stop();
    }
    for (const track of stream.getTracks()) {
      track.stop();
    }
  };
});

export const voiceRecorderMachine = setup({
  types: {
    context: {} as VoiceRecorderContext,
    events: {} as VoiceRecorderEvent,
    input: {} as { onComplete: (result: VoiceRecordingResult) => Promise<void> },
  },
  actors: {
    requestMic: fromPromise(async () => {
      return await navigator.mediaDevices.getUserMedia({ audio: true });
    }),
    durationTicker: fromCallback<VoiceRecorderEvent>(({ sendBack }) => {
      const id = window.setInterval(() => {
        sendBack({ type: "TICK" });
      }, 100);
      return () => clearInterval(id);
    }),
    mediaRecorderActor,
    uploadRecording: fromPromise(
      async ({
        input,
      }: {
        input: {
          blob: Blob;
          mimeType: string;
          duration: number;
          onComplete: (result: VoiceRecordingResult) => Promise<void>;
        };
      }) => {
        await input.onComplete({
          blob: input.blob,
          mimeType: input.mimeType,
          duration: input.duration,
        });
      }
    ),
  },
}).createMachine({
  id: "voiceRecorder",
  initial: "idle",
  context: ({ input }) => ({
    error: null,
    duration: 0,
    startTime: 0,
    onComplete: input.onComplete,
  }),
  states: {
    idle: {
      on: {
        START: {
          target: "requestingMic",
          actions: assign({ error: null }),
        },
      },
    },
    requestingMic: {
      invoke: {
        src: "requestMic",
        onDone: {
          target: "recording",
          actions: assign({
            startTime: () => Date.now(),
            duration: 0,
          }),
        },
        onError: {
          target: "idle",
          actions: assign(({ event }) => {
            const message = (event.error as Error).message;
            if (
              message.includes("Permission denied") ||
              message.includes("NotAllowedError")
            ) {
              return {
                error:
                  "Microphone permission denied. Please allow microphone access.",
              };
            }
            return { error: `Failed to start recording: ${message}` };
          }),
        },
      },
    },
    recording: {
      invoke: [
        {
          src: "durationTicker",
        },
        {
          id: "recorder",
          src: "mediaRecorderActor",
          input: ({ event }) => {
            // The event here is the onDone from requestMic — its output is the MediaStream
            const doneEvent = event as { type: string; output: MediaStream };
            return { stream: doneEvent.output };
          },
        },
      ],
      on: {
        TICK: {
          actions: assign(({ context }) => ({
            duration: Math.floor((Date.now() - context.startTime) / 1000),
          })),
        },
        STOP: {
          // Send stop to the recorder actor, wait for RECORDER_STOPPED
          actions: ({ system }) => {
            const recorder = system.get("recorder");
            if (recorder) {
              recorder.send({ type: "STOP" });
            }
          },
        },
        RECORDER_STOPPED: {
          target: "uploading",
        },
        RECORDER_ERROR: {
          target: "idle",
          actions: assign(({ event }) => ({
            error: event.message,
          })),
        },
      },
    },
    uploading: {
      invoke: {
        src: "uploadRecording",
        input: ({ context, event }) => {
          const stoppedEvent = event as {
            type: "RECORDER_STOPPED";
            blob: Blob;
            mimeType: string;
          };
          return {
            blob: stoppedEvent.blob,
            mimeType: stoppedEvent.mimeType,
            duration: Math.floor((Date.now() - context.startTime) / 1000),
            onComplete: context.onComplete,
          };
        },
        onDone: {
          target: "idle",
          actions: assign({ duration: 0 }),
        },
        onError: {
          target: "idle",
          actions: assign(({ event }) => ({
            error: (event.error as Error).message,
          })),
        },
      },
    },
  },
});
