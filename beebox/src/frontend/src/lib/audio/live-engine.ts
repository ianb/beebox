/**
 * The per-device choice of live transcription engine
 * (research/browser-live-stt/). Voice settings → While you speak writes it:
 * "This device" stores `localStorage["bbx:live-engine"] = "browser"`, and
 * picking a box service clears it. With no value, dictation uses the box's
 * streaming service. The box's own setting is box-wide; this one is not.
 */

import { useSyncExternalStore } from "react";
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

export type LiveEngine = "browser" | "service";

export function liveEngine(): LiveEngine {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "browser" ? "browser" : "service";
  } catch (e) {
    console.warn("[realtime-transcription] Cannot read the live engine flag:", e);
    return "service";
  }
}

const listeners = new Set<() => void>();

/** Save this device's choice. False when the browser refuses storage. */
export function setLiveEngine(engine: LiveEngine): boolean {
  try {
    if (engine === "browser") window.localStorage.setItem(STORAGE_KEY, "browser");
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn("[realtime-transcription] Cannot save the live engine choice:", e);
    return false;
  }
  for (const listener of listeners) listener();
  return true;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab on this origin changed the choice.
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useLiveEngine(): LiveEngine {
  return useSyncExternalStore(subscribe, liveEngine);
}
