import { useEffect } from "react";
import type { Emission } from "../../input/emission";
import type { Receipt } from "../../input/targets/receipts";
import {
  captureAndStore,
  isGeolocationAvailable,
  loadLocationShareState,
  saveLocationShareState,
  type LocationShareState,
} from "../../lib/location-share";
import { parseNativeEmissionDetail } from "./native-emission";
import { nativeSpeechCommandFromDetail } from "./native-speech-command";
import { createNativeDispatchRegistry, resolveNativeDispatch } from "./native-emission-redelivery";
import type { NativeShellChannel, NativeShellWindow } from "./native-post";
import { postNativeMessage } from "./native-post";

declare global {
  interface Window {
    callbackboxNativeQueue?: unknown[];
    callbackboxNativeLocationQueue?: unknown[];
    callbackboxNativePost?: (channel: string, payload: string) => void;
    webkit?: {
      messageHandlers?: Partial<
        Record<NativeShellChannel, { postMessage: (message: unknown) => void }>
      >;
    };
  }
}

function useNativeEmissionBridge(opts: {
  enabled: boolean;
  dispatchEmission: (emission: Emission) => Promise<Receipt>;
}) {
  const { enabled, dispatchEmission } = opts;
  useEffect(() => {
    if (!enabled) return;
    for (const detail of drainNativeEmissionQueue()) {
      void handleNativeEmission(detail, dispatchEmission);
    }
    const listener = () => {
      for (const detail of drainNativeEmissionQueue()) {
        void handleNativeEmission(detail, dispatchEmission);
      }
    };
    window.addEventListener("callbackbox:native-emission", listener);
    return () => window.removeEventListener("callbackbox:native-emission", listener);
  }, [enabled, dispatchEmission]);
}

function useNativeLocationBridge(opts: { enabled: boolean; boxSlug: string | undefined }) {
  const { enabled, boxSlug } = opts;
  useEffect(() => {
    if (!enabled) return;
    postNativeLocationState(loadLocationShareState(boxSlug).enabled, window);
    for (const detail of drainNativeLocationQueue()) {
      void handleNativeLocationRequest(detail, { boxSlug });
    }
    const listener = () => {
      for (const detail of drainNativeLocationQueue()) {
        void handleNativeLocationRequest(detail, { boxSlug });
      }
    };
    window.addEventListener("callbackbox:native-share-location", listener);
    return () => window.removeEventListener("callbackbox:native-share-location", listener);
  }, [enabled, boxSlug]);
}

function useNativeNarrationBridge(opts: { enabled: boolean; narrationEnabled: boolean }) {
  const { enabled, narrationEnabled } = opts;
  useEffect(() => {
    if (!enabled) return;
    postNativeNarrationState(narrationEnabled, window);
  }, [enabled, narrationEnabled]);
}

function useNativeHqDictationBridge(opts: { enabled: boolean; hqDictationEnabled: boolean; sessionId: string | null }) {
  const { enabled, hqDictationEnabled, sessionId } = opts;
  useEffect(() => {
    if (!enabled) return;
    postNativeHqDictationState(hqDictationEnabled, window);
  }, [enabled, hqDictationEnabled, sessionId]);
}

function useNativeSpeechPlaybackBridge(opts: { enabled: boolean; playing: boolean }) {
  const { enabled, playing } = opts;
  useEffect(() => {
    if (!enabled) return;
    postNativeSpeechPlaybackState(playing, window);
  }, [enabled, playing]);
}

/**
 * Native barge-in (contract §4.9). The native record button opens its mic at
 * once and asks this page to stop talking; the page is the speaker, so only it
 * can. Deliberately `STOP_SPEECH` and not `START_DICTATION` — the web event
 * would also `beginTurn` and `startMic`, opening the *web* microphone inside a
 * native shell and leaving web turn-taking to reopen it after the next speech.
 * The turn belongs to native.
 */
function useNativeSpeechCommandBridge(opts: { enabled: boolean; stopSpeech: () => void }) {
  const { enabled, stopSpeech } = opts;
  useEffect(() => {
    if (!enabled) return;
    const run = () => {
      for (const detail of drainNativeSpeechCommandQueue()) {
        if (nativeSpeechCommandFromDetail(detail) !== null) stopSpeech();
      }
    };
    run();
    window.addEventListener("callbackbox:native-speech-command", run);
    return () => window.removeEventListener("callbackbox:native-speech-command", run);
  }, [enabled, stopSpeech]);
}

function useNativeResponseBridge(opts: { enabled: boolean; active: boolean }) {
  const { enabled, active } = opts;
  useEffect(() => {
    if (!enabled) return;
    postNativeResponseState(active, window);
  }, [enabled, active]);
}

/**
 * All six native-shell bridges in one call — InteractiveChat's root has no
 * per-bridge logic of its own, so grouping them here keeps that function
 * under the max-lines-per-function budget the same way ChatModeOverlays does
 * for the composer overlays.
 */
export function useNativeBridges(opts: {
  enabled: boolean;
  dispatchEmission: (emission: Emission) => Promise<Receipt>;
  boxSlug: string | undefined;
  sessionId: string | null;
  narrationEnabled: boolean;
  hqDictationEnabled: boolean;
  responseActive: boolean;
  speechPlaying: boolean;
  stopSpeech: () => void;
}) {
  const { enabled, dispatchEmission, boxSlug, sessionId, narrationEnabled, hqDictationEnabled, responseActive, speechPlaying, stopSpeech } = opts;
  useNativeEmissionBridge({ enabled, dispatchEmission });
  useNativeLocationBridge({ enabled, boxSlug });
  useNativeNarrationBridge({ enabled, narrationEnabled });
  useNativeHqDictationBridge({ enabled, hqDictationEnabled, sessionId });
  useNativeResponseBridge({ enabled, active: responseActive });
  useNativeSpeechPlaybackBridge({ enabled, playing: speechPlaying });
  useNativeSpeechCommandBridge({ enabled, stopSpeech });
}

// Page-lifetime: the shell redelivers ids until a receipt lands; a
// redelivered id shares its original outcome instead of dispatching again
// (see native-emission-redelivery.ts).
const dispatchedNativeEmissions = createNativeDispatchRegistry();

async function handleNativeEmission(
  detail: unknown,
  dispatchEmission: (emission: Emission) => Promise<Receipt>
): Promise<void> {
  const parsed = parseNativeEmissionDetail(detail);
  if (!parsed.ok) {
    if (parsed.emissionId !== null) {
      postNativeReceipt({ disposition: "rejected", emissionId: parsed.emissionId, reason: parsed.reason });
    }
    return;
  }
  const { emission } = parsed;
  const { outcome } = resolveNativeDispatch(emission.id, {
    registry: dispatchedNativeEmissions,
    dispatch: () => dispatchEmission(emission),
  });
  try {
    postNativeReceipt(await outcome);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Native message dispatch failed";
    postNativeReceipt({ disposition: "rejected", emissionId: emission.id, reason });
  }
}

export interface NativeLocationResult {
  id: string;
  success: boolean;
  enabled: boolean;
  message: string;
}

export interface NativeLocationBridgeDependencies {
  isAvailable: () => boolean;
  loadState: (boxSlug: string | undefined) => LocationShareState;
  saveState: (boxSlug: string | undefined, state: LocationShareState) => void;
  captureAndStore: (boxSlug: string | undefined, now: number) => Promise<void>;
  now: () => number;
  postResult: (result: NativeLocationResult) => void;
}

const nativeLocationDependencies: NativeLocationBridgeDependencies = {
  isAvailable: isGeolocationAvailable,
  loadState: loadLocationShareState,
  saveState: saveLocationShareState,
  captureAndStore,
  now: Date.now,
  postResult: postNativeLocationResult,
};

export async function handleNativeLocationRequest(
  detail: unknown,
  context: { boxSlug: string | undefined; dependencies?: NativeLocationBridgeDependencies }
): Promise<void> {
  const dependencies = context.dependencies ?? nativeLocationDependencies;
  const request = nativeLocationRequest(detail);
  if (request === null) return;
  const state = dependencies.loadState(context.boxSlug);
  if (state.enabled) {
    dependencies.saveState(context.boxSlug, { enabled: false, lastCapturedAt: null });
    dependencies.postResult(locationResult({ id: request.id, success: true, enabled: false }));
    return;
  }
  if (!dependencies.isAvailable()) {
    dependencies.postResult(
      locationResult({ id: request.id, success: false, enabled: false, message: "Location is unavailable." })
    );
    return;
  }
  try {
    await dependencies.captureAndStore(context.boxSlug, dependencies.now());
    dependencies.postResult(locationResult({ id: request.id, success: true, enabled: true }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Location sharing failed.";
    dependencies.postResult(locationResult({ id: request.id, success: false, enabled: false, message }));
  }
}

function nativeLocationRequest(detail: unknown): { id: string; action: "toggle" } | null {
  if (typeof detail !== "object" || detail === null || !("id" in detail)) return null;
  if (typeof detail.id !== "string" || detail.id.trim() === "") return null;
  if (!("action" in detail)) return { id: detail.id, action: "toggle" };
  if (detail.action !== "toggle") return null;
  return { id: detail.id, action: detail.action };
}

function locationResult(opts: {
  id: string;
  success: boolean;
  enabled: boolean;
  message?: string;
}): NativeLocationResult {
  const message = opts.message ?? (opts.enabled ? "Location sharing is on." : "Location sharing is off.");
  return { id: opts.id, success: opts.success, enabled: opts.enabled, message };
}

function postNativeReceipt(receipt: Receipt): void {
  postNativeMessage(window, { channel: "callbackboxEmissionReceipt", payload: receipt });
}

function postNativeLocationResult(result: NativeLocationResult): void {
  postNativeMessage(window, { channel: "callbackboxLocationResult", payload: result });
}

export function postNativeLocationState(enabled: boolean, shell: NativeShellWindow): void {
  postNativeMessage(shell, { channel: "callbackboxLocationState", payload: { enabled } });
}

export function postNativeNarrationState(enabled: boolean, shell: NativeShellWindow): void {
  postNativeMessage(shell, { channel: "callbackboxNarrationState", payload: { enabled } });
}

export function postNativeHqDictationState(enabled: boolean, shell: NativeShellWindow): void {
  postNativeMessage(shell, { channel: "callbackboxHqDictationState", payload: { enabled } });
}

export function postNativeSpeechPlaybackState(playing: boolean, shell: NativeShellWindow): void {
  postNativeMessage(shell, { channel: "callbackboxSpeechPlaybackState", payload: { playing } });
}

export function postNativeResponseState(active: boolean, shell: NativeShellWindow): void {
  postNativeMessage(shell, { channel: "callbackboxResponseState", payload: { active } });
}

function drainNativeEmissionQueue(): unknown[] {
  const queued = window.callbackboxNativeQueue ?? [];
  window.callbackboxNativeQueue = [];
  return queued;
}

function drainNativeLocationQueue(): unknown[] {
  const queued = window.callbackboxNativeLocationQueue ?? [];
  window.callbackboxNativeLocationQueue = [];
  return queued;
}

function drainNativeSpeechCommandQueue(): unknown[] {
  const queued = window.callbackboxNativeSpeechCommandQueue ?? [];
  window.callbackboxNativeSpeechCommandQueue = [];
  return queued;
}
