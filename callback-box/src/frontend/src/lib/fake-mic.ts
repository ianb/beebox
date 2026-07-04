/**
 * Test-only mic seam (docs/plans/input-extraction.md, chunk 5) for
 * behaviors a real device can't reliably reproduce on demand: a slow
 * permission grant, an outright denial, and the OS yanking the mic
 * mid-recording (track `ended`, e.g. a phone call, another app grabbing
 * the device, or an unplug).
 *
 * Dead code in production: with no `fakemic` flag set, `getMicStream()` is
 * exactly `navigator.mediaDevices.getUserMedia({ audio: true })` — same
 * call, same behavior, no added branching cost.
 *
 * Enable with `?fakemic=<script>` in the URL (cached into
 * `localStorage["fakemic"]` on first read so it survives a same-tab
 * reload/navigation during a debug session — drop the param and clear the
 * key, or set the key to an empty string, to go back to the real device).
 * Scripts:
 *   - `delay:<ms>` — the permission dialog is "up" for `ms`, then a silent
 *     fake stream resolves (mic enables slowly).
 *   - `deny`       — rejects immediately, like a real permission denial.
 *   - `end`        — resolves immediately with a fake stream, then the
 *     track fires `ended` shortly after (device unplug / OS mic-grab
 *     mid-use).
 */

const STORAGE_KEY = "fakemic";
/** How long the `end` script waits before ending the track. */
const END_AFTER_MS = 1500;

class FakeMicDeniedError extends Error {
  override readonly name = "FakeMicDeniedError";
  constructor() {
    super("fakemic=deny (simulated NotAllowedError)");
  }
}

function readScript(): string | null {
  const fromUrl = new URLSearchParams(window.location.search).get(STORAGE_KEY);
  if (fromUrl) {
    try {
      window.localStorage.setItem(STORAGE_KEY, fromUrl);
    } catch (e) {
      console.warn(`[fake-mic] couldn't persist ?fakemic to localStorage: ${e instanceof Error ? e.message : String(e)}`);
    }
    return fromUrl;
  }
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch (_e) {
    return null;
  }
}

/** A silent MediaStream (AudioContext → zero-gain → destination), standing in for a real mic capture. */
function fakeSilentStream(): MediaStream {
  const ctx = new AudioContext();
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  gain.gain.value = 0;
  const destination = ctx.createMediaStreamDestination();
  oscillator.connect(gain).connect(destination);
  oscillator.start();
  return destination.stream;
}

/** Fire a real `ended` event on every track after `delayMs` — `track.stop()` doesn't. */
function endStreamAfter(stream: MediaStream, delayMs: number): void {
  setTimeout(() => {
    for (const track of stream.getTracks()) track.dispatchEvent(new Event("ended"));
  }, delayMs);
}

async function runScript(script: string): Promise<MediaStream> {
  if (script === "deny") throw new FakeMicDeniedError();
  if (script === "end") {
    const stream = fakeSilentStream();
    endStreamAfter(stream, END_AFTER_MS);
    return stream;
  }
  if (script.startsWith("delay:")) {
    const ms = Number(script.slice("delay:".length));
    await new Promise((resolve) => setTimeout(resolve, Number.isFinite(ms) ? ms : 0));
    return fakeSilentStream();
  }
  console.warn(`[fake-mic] unknown fakemic script "${script}" — using the real device`);
  return navigator.mediaDevices.getUserMedia({ audio: true });
}

/**
 * Drop-in replacement for `navigator.mediaDevices.getUserMedia({ audio:
 * true })` at the transcription mic's capture/reacquire call sites
 * (`machines/transcription-mic.ts`). Scripted only when `fakemic` is set;
 * otherwise this is the real call, unmodified.
 */
export async function getMicStream(): Promise<MediaStream> {
  const script = readScript();
  if (!script) return navigator.mediaDevices.getUserMedia({ audio: true });
  return runScript(script);
}
