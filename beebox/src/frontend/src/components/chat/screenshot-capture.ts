/**
 * One-shot capture of the pixels the user currently sees, via getDisplayMedia
 * with the current-tab hints (the Sentry-feedback approach): open a display
 * stream, pipe it into a detached <video>, wait for a decoded non-zero frame,
 * draw that frame to a canvas, and read it back as a PNG blob. The stream is
 * always torn down immediately — this is a still, not a recording, and we must
 * not leave the "sharing this tab" indicator up.
 *
 * The blob feeds the same attachment pipeline pasted images use
 * (`processImageBlob` → `editor.addImage`), which downscales to 1920px — this
 * module adds no resizing of its own. Track A (the composer "Send screenshot…"
 * item) is the first consumer; Track B's `bbx chat screenshot` consent popup is
 * the intended second — hence the enumerable {@link CaptureOutcome}.
 */

/** The outcome of a capture attempt — every degraded path is named, never a silent blank. */
export type CaptureOutcome =
  | { kind: "image"; blob: Blob; viewport: { cssWidth: number; cssHeight: number; dpr: number } }
  | { kind: "declined" } // user dismissed the picker (NotAllowedError)
  | { kind: "unsupported" } // no getDisplayMedia (mobile Safari, insecure context)
  | { kind: "error"; message: string };

/** A capture step failed after the stream was granted (never-decoding frame, canvas readback, etc.). */
class ScreenshotCaptureError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "ScreenshotCaptureError";
  }
}

// Fixed failure details, named so they're passed as identifiers — a bare string
// literal is disallowed as an Error constructor's first argument (matches the
// IMG_ERR convention in lib/image-paste.ts).
const CAPTURE_ERR = {
  zeroFrame: "video produced a zero-sized frame",
  canvasContext: "canvas 2D context unavailable",
  toBlobNull: "canvas.toBlob returned null",
  frameTimeout: "timed out waiting for a decoded video frame",
} as const;

/**
 * getDisplayMedia's current-tab hints (`preferCurrentTab`, `selfBrowserSurface`)
 * are shipping in Chromium but not yet in the standard TS DOM lib. Extending
 * the standard options type with the optional extras — rather than casting the
 * argument — keeps the call fully typed and needs no `as`.
 */
interface DisplayMediaHints extends DisplayMediaStreamOptions {
  preferCurrentTab?: boolean;
  selfBrowserSurface?: "include" | "exclude";
}

const DISPLAY_MEDIA_HINTS: DisplayMediaHints = {
  video: true,
  preferCurrentTab: true,
  selfBrowserSurface: "include",
};

/** Overall budget from grant to a decoded frame — a stream that never decodes resolves `error`, not a hang. */
const CAPTURE_TIMEOUT_MS = 10_000;

/** Feature-detect for the menu: hide the item where a capture would be `unsupported`. */
export function isScreenshotSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "mediaDevices" in navigator &&
    "getDisplayMedia" in navigator.mediaDevices
  );
}

/**
 * Map a getDisplayMedia rejection to an outcome. A dismissed picker / denied
 * permission rejects with NotAllowedError → `declined` (the user's deliberate
 * "no", handled silently by callers). Anything else is a real `error`.
 * Exported for the outcome-mapping unit test.
 */
export function classifyGetDisplayMediaError(error: unknown): CaptureOutcome {
  if (error instanceof Error && error.name === "NotAllowedError") {
    return { kind: "declined" };
  }
  return { kind: "error", message: error instanceof Error ? error.message : String(error) };
}

/** Stop every track so the capture indicator drops immediately (success and failure alike). */
function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

/**
 * Whether the video has a decoded frame with real dimensions — the pure
 * frame-readiness predicate. Exported for the unit test; a zero-sized or
 * undecoded first frame is NOT ready (it would draw a blank PNG).
 */
export function isFrameDecoded(
  video: Pick<HTMLVideoElement, "readyState" | "videoWidth" | "videoHeight" | "HAVE_CURRENT_DATA">,
): boolean {
  return video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0;
}

/**
 * Resolve once the video has a decoded frame with real dimensions. Uses
 * `requestVideoFrameCallback` (fires on the first presented frame) when the
 * browser has it, else polls readyState/dimensions on animation frames.
 *
 * Cancellable via `signal`: when the overall capture times out (or any other
 * exit aborts the controller), the pending `requestAnimationFrame` /
 * `requestVideoFrameCallback` is cancelled and the promise rejects — otherwise a
 * never-decoding stream would leave a rAF loop running every frame forever.
 */
function waitForDecodedFrame(video: HTMLVideoElement, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (isFrameDecoded(video)) {
      resolve();
      return;
    }
    let rafId: number | undefined;
    let rvfcId: number | undefined;
    const cleanup = (): void => {
      signal.removeEventListener("abort", onAbort);
      if (rafId !== undefined) cancelAnimationFrame(rafId);
      if (rvfcId !== undefined && "cancelVideoFrameCallback" in video) {
        video.cancelVideoFrameCallback(rvfcId);
      }
    };
    const onAbort = (): void => {
      cleanup();
      reject(new ScreenshotCaptureError(CAPTURE_ERR.frameTimeout));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    if ("requestVideoFrameCallback" in video) {
      rvfcId = video.requestVideoFrameCallback(() => {
        cleanup();
        resolve();
      });
      return;
    }
    const tick = (): void => {
      if (isFrameDecoded(video)) {
        cleanup();
        resolve();
        return;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  });
}

/**
 * Draw the first decoded frame of `stream` to a canvas and read it back as a PNG
 * blob. The `video` is caller-owned so the caller can detach it on every exit
 * path; `signal` cancels the frame-wait when the overall capture times out.
 */
async function grabFrame(
  video: HTMLVideoElement,
  { stream, signal }: { stream: MediaStream; signal: AbortSignal },
): Promise<{ blob: Blob; width: number; height: number }> {
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play();
  await waitForDecodedFrame(video, signal);
  const width = video.videoWidth;
  const height = video.videoHeight;
  // A zero-sized frame must fail loudly rather than produce a blank PNG.
  if (width === 0 || height === 0) throw new ScreenshotCaptureError(CAPTURE_ERR.zeroFrame);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ScreenshotCaptureError(CAPTURE_ERR.canvasContext);
  ctx.drawImage(video, 0, 0);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
  if (!blob) throw new ScreenshotCaptureError(CAPTURE_ERR.toBlobNull);
  return { blob, width, height };
}

/**
 * Capture what the user currently sees as a PNG blob. Resolves an enumerable
 * outcome — never rejects. On `image`, `viewport` reports best-effort CSS
 * dimensions (the intrinsic capture is physical pixels; CSS = physical / dpr).
 *
 * The timeout is driven by an AbortController rather than a racing promise, so
 * on timeout the frame-wait is genuinely cancelled (no orphaned rAF loop) and
 * there is no dangling losing-promise to reject unhandled. Every exit path
 * (success, error, timeout) clears the stream AND detaches the `<video>`.
 */
export async function captureTabScreenshot(): Promise<CaptureOutcome> {
  if (!isScreenshotSupported()) return { kind: "unsupported" };

  let stream: MediaStream;
  try {
    // Called synchronously inside the click handler's task so user activation
    // still gates the picker.
    stream = await navigator.mediaDevices.getDisplayMedia(DISPLAY_MEDIA_HINTS);
  } catch (e) {
    return classifyGetDisplayMediaError(e);
  }

  const video = document.createElement("video");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CAPTURE_TIMEOUT_MS);
  try {
    const { blob, width, height } = await grabFrame(video, { stream, signal: controller.signal });
    const dpr = window.devicePixelRatio || 1;
    return {
      kind: "image",
      blob,
      viewport: { cssWidth: Math.round(width / dpr), cssHeight: Math.round(height / dpr), dpr },
    };
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message : String(e) };
  } finally {
    // Every exit path: stop the timer, cancel any pending frame-wait (abort is a
    // no-op once the wait resolved), drop the stream so the capture indicator
    // never lingers, and detach the video so it releases the stream — no
    // dangling rAF/rVFC callback, no retained <video>.
    clearTimeout(timer);
    controller.abort();
    stopTracks(stream);
    video.srcObject = null;
  }
}
