import { useEffect } from "react";
import type { Emission } from "../../input/emission";
import type { Receipt } from "../../input/targets/receipts";
import { captureAndStore, isGeolocationAvailable } from "../../lib/location-share";
import { nativeEmissionFromDetail } from "./native-emission";

declare global {
  interface Window {
    callbackboxNativeQueue?: unknown[];
    callbackboxNativeLocationQueue?: unknown[];
    webkit?: {
      messageHandlers?: {
        callbackboxEmissionReceipt?: { postMessage: (message: unknown) => void };
        callbackboxLocationResult?: { postMessage: (message: unknown) => void };
      };
    };
  }
}

export function useNativeEmissionBridge(opts: {
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

export function useNativeLocationBridge(opts: { enabled: boolean; boxSlug: string | undefined }) {
  const { enabled, boxSlug } = opts;
  useEffect(() => {
    if (!enabled) return;
    for (const detail of drainNativeLocationQueue()) {
      void handleNativeLocationRequest(detail, boxSlug);
    }
    const listener = () => {
      for (const detail of drainNativeLocationQueue()) {
        void handleNativeLocationRequest(detail, boxSlug);
      }
    };
    window.addEventListener("callbackbox:native-share-location", listener);
    return () => window.removeEventListener("callbackbox:native-share-location", listener);
  }, [enabled, boxSlug]);
}

async function handleNativeEmission(
  detail: unknown,
  dispatchEmission: (emission: Emission) => Promise<Receipt>
): Promise<void> {
  const emission = nativeEmissionFromDetail(detail);
  if (emission === null) {
    const emissionId = nativeRequestId(detail);
    if (emissionId !== null) {
      postNativeReceipt({ disposition: "rejected", emissionId, reason: "Invalid native message" });
    }
    return;
  }
  try {
    postNativeReceipt(await dispatchEmission(emission));
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Native message dispatch failed";
    postNativeReceipt({ disposition: "rejected", emissionId: emission.id, reason });
  }
}

async function handleNativeLocationRequest(detail: unknown, boxSlug: string | undefined): Promise<void> {
  const requestId = nativeRequestId(detail);
  if (requestId === null) return;
  if (!isGeolocationAvailable()) {
    postNativeLocationResult({ id: requestId, success: false, message: "Location is unavailable." });
    return;
  }
  try {
    await captureAndStore(boxSlug, Date.now());
    postNativeLocationResult({ id: requestId, success: true, message: "Location shared." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Location sharing failed.";
    postNativeLocationResult({ id: requestId, success: false, message });
  }
}

function nativeRequestId(detail: unknown): string | null {
  if (typeof detail !== "object" || detail === null || !("id" in detail)) return null;
  return typeof detail.id === "string" && detail.id.trim() !== "" ? detail.id : null;
}

function postNativeReceipt(receipt: Receipt): void {
  // eslint-disable-next-line unicorn/require-post-message-target-origin -- WKScriptMessageHandler accepts only the payload.
  window.webkit?.messageHandlers?.callbackboxEmissionReceipt?.postMessage(receipt);
}

function postNativeLocationResult(result: { id: string; success: boolean; message: string }): void {
  // eslint-disable-next-line unicorn/require-post-message-target-origin -- WKScriptMessageHandler accepts only the payload.
  window.webkit?.messageHandlers?.callbackboxLocationResult?.postMessage(result);
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
