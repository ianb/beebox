/**
 * Experimental per-device switch for the live transcription engine
 * (research/browser-live-stt/). Off by default: with no flag set, dictation
 * uses the box's streaming service exactly as before. Setting
 * `localStorage["bbx:live-engine"] = "browser"` turns on the browser's
 * on-device recognizer for this device.
 */

import { z } from "zod";

const STORAGE_KEY = "bbx:live-engine";

/** The recognizer options the browser engine always uses: on-device, never the vendor's server. */
function localOptions(lang: string): { langs: string[]; processLocally: true } {
  return { langs: [lang], processLocally: true };
}

const availabilitySchema = z.enum(["unavailable", "downloadable", "downloading", "available"]);
export type BrowserSpeechAvailability = z.infer<typeof availabilitySchema>;

/** The parts of Chrome's SpeechRecognition this engine uses; not in lib.dom. */
export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error: string; message: string }) => void) | null;
  onend: (() => void) | null;
  start: (track: MediaStreamTrack) => void;
  stop: () => void;
  abort: () => void;
}

export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

interface SpeechRecognitionStatics {
  available: (options: { langs: string[]; processLocally: true }) => Promise<string>;
  install: (options: { langs: string[]; processLocally: true }) => Promise<boolean>;
}

type LocalRecognizerCtor = SpeechRecognitionCtor & SpeechRecognitionStatics;

/**
 * The on-device-capable constructor. Requires the `available` static and the
 * `processLocally` member: Safari's `webkitSpeechRecognition` has neither, so
 * it cannot promise audio stays on the device and does not qualify.
 */
function isLocalRecognizer(ctor: unknown): ctor is LocalRecognizerCtor {
  if (typeof ctor !== "function") return false;
  const prototype: unknown = Reflect.get(ctor, "prototype");
  return typeof Reflect.get(ctor, "available") === "function" && typeof prototype === "object" && prototype !== null && "processLocally" in prototype;
}

function localRecognizer(): LocalRecognizerCtor | null {
  const ctor: unknown = Reflect.get(window, "SpeechRecognition");
  return isLocalRecognizer(ctor) ? ctor : null;
}

export function speechRecognitionCtor(): SpeechRecognitionCtor | null {
  return localRecognizer();
}

export function browserSpeechLang(): string {
  return navigator.language || "en-US";
}

export async function browserSpeechAvailability(lang: string): Promise<BrowserSpeechAvailability> {
  const ctor = localRecognizer();
  if (ctor === null) return "unavailable";
  return availabilitySchema.parse(await ctor.available(localOptions(lang)));
}

/** Download the language pack (about 220 MB on first use). Needs a user gesture. */
export async function installBrowserSpeech(lang: string): Promise<boolean> {
  const ctor = localRecognizer();
  if (ctor === null) return false;
  return ctor.install(localOptions(lang));
}

export function liveEngine(): "browser" | "service" {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "browser" ? "browser" : "service";
  } catch (e) {
    console.warn("[realtime-transcription] Cannot read the live engine flag:", e);
    return "service";
  }
}
