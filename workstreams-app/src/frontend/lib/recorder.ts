// Recording a spoken comment (`docs/plans/document-comments.md`, Track 4).
//
// THE CONTROL STATES ITS OWN AVAILABILITY. `navigator.mediaDevices` is
// `undefined` outside a secure context, so on a bare-IP HTTP origin the mic is
// simply not there — and a control that silently vanishes teaches the developer
// that the feature is broken rather than that the origin is insecure. Localhost
// and `tailscale serve` (HTTPS) are both secure; `http://<ip>:3210` is not.
//
// CAPPED IN BYTES, NOT SECONDS. A duration cap is not a byte guarantee, and the
// app inherits Fastify's 1 MiB body limit. Recording stops at the cap with the
// audio KEPT and submittable, rather than failing at upload with the recording
// already made.

export interface RecorderUnavailable {
  available: false;
  reason: string;
}

export interface RecorderReady {
  available: true;
}

export function recorderAvailability(): RecorderUnavailable | RecorderReady {
  if (typeof window === "undefined") return { available: false, reason: "no browser" };
  if (!window.isSecureContext) {
    return {
      available: false,
      reason: "microphone needs https or localhost — this origin is not a secure context",
    };
  }
  // `in` rather than a cast: the DOM lib types mediaDevices as always present,
  // but it is genuinely absent outside a secure context — which is the whole
  // case this function exists to report.
  if (!("mediaDevices" in navigator)) {
    return { available: false, reason: "this browser exposes no microphone API" };
  }
  if (typeof MediaRecorder === "undefined") {
    return { available: false, reason: "this browser has no MediaRecorder" };
  }
  return { available: true };
}

class RecordingUnreadableError extends Error {
  constructor() {
    super("The recording could not be read back from the browser.");
    this.name = "RecordingUnreadableError";
  }
}

export interface Recording {
  base64: string;
  mimeType: string;
  bytes: number;
  /** True when the cap stopped it early — the audio is still usable. */
  truncated: boolean;
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => { reject(new RecordingUnreadableError()); };
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * A recording session. `stop()` resolves with the audio; the track is released
 * either way, because a microphone left open is the kind of bug people notice
 * by the indicator light rather than by an error.
 */
export async function startRecording(maxBytes: number): Promise<{
  stop: () => Promise<Recording>;
  cancel: () => void;
}> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  // Low bitrate on purpose: speech does not need more, and the byte cap is
  // what decides how long a comment can be.
  const recorder = new MediaRecorder(stream, { audioBitsPerSecond: 24_000 });
  const chunks: Blob[] = [];
  let bytes = 0;
  let truncated = false;

  recorder.ondataavailable = (event) => {
    if (event.data.size === 0) return;
    chunks.push(event.data);
    bytes += event.data.size;
    // Base64 inflates by about a third, so stop well before the wire limit.
    if (bytes * 1.4 >= maxBytes && recorder.state === "recording") {
      truncated = true;
      recorder.stop();
    }
  };
  recorder.start(1000);

  function release(): void {
    for (const track of stream.getTracks()) track.stop();
  }

  return {
    cancel: () => {
      if (recorder.state !== "inactive") recorder.stop();
      release();
    },
    stop: () =>
      new Promise<Recording>((resolve, reject) => {
        recorder.onstop = () => {
          release();
          const mimeType = recorder.mimeType === "" ? "audio/webm" : recorder.mimeType;
          const blob = new Blob(chunks, { type: mimeType });
          toBase64(blob).then(
            (base64) => { resolve({ base64, mimeType, bytes: blob.size, truncated }); },
            reject,
          );
        };
        // A recorder that already stopped (the byte cap fired mid-chunk) will
        // not emit another `stop`, so finish from here instead of waiting.
        if (recorder.state === "inactive") recorder.onstop(new Event("stop"));
        else recorder.stop();
      }),
  };
}
