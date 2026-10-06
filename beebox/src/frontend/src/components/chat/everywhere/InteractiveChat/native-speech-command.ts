/**
 * Native → web speech control (contract §4.9).
 *
 * The native composer owns its own voice turn, but the speech it would talk
 * over is played by this page. When the user presses record while the box is
 * speaking, native barges in: it opens its microphone immediately and sends
 * this command so the page stops talking. There is no acknowledgement channel —
 * the speech-playback state the page already posts (§4.5) reports the stop, and
 * native does not wait for it.
 */
export interface NativeSpeechCommand {
  version: 1;
  action: "stop";
}

declare global {
  interface Window {
    beeboxNativeSpeechCommandQueue?: unknown[];
  }
}

export function nativeSpeechCommandFromDetail(detail: unknown): NativeSpeechCommand | null {
  if (
    typeof detail !== "object"
    || detail === null
    || Array.isArray(detail)
    || !("version" in detail)
    || detail.version !== 1
    || !("action" in detail)
    || detail.action !== "stop"
  ) {
    return null;
  }
  return { version: 1, action: "stop" };
}
