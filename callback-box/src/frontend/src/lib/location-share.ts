/**
 * Opt-in location sharing for the web chat. The boxholder enables it from the
 * composer's Add menu; on enable (and opportunistically before a send when the
 * last fix is stale) the browser's Geolocation API is read and the coordinate
 * is posted to the backend via `location.capture`, which caches it for
 * `cb location get`. Nothing is captured unless the user has opted in AND
 * granted the browser permission — consent is the gate.
 *
 * This module owns the storage-key shape, the parse boundary, the
 * Geolocation wrapper, and the send-path refresh. The hook
 * (`useLocationShare`) owns React state + the enable/disable UX. The pure
 * functions here (key, parse, serialize, shouldRefresh) are testable without a
 * DOM; the browser-API touchers (`isGeolocationAvailable`,
 * `captureCurrentPosition`, `refreshLocationIfStale`) read `navigator`/`window`
 * only when called, so importing the module in Node stays safe.
 */

import { trpcClient } from "./trpc";
// Raw relative (not `@shared/…`): loaded outside Vite by the tap/tsx doctest
// runner (root tsconfig, no @shared resolution) — see OUTSIDE_VITE_SHARED_RAW.
import { isRecord } from "../../../shared/is-record.js";

const KEY_PREFIX = "cb-location-share";

/** Re-capture before a send only if the cached fix is older than this. */
export const LOCATION_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
/** getCurrentPosition's default timeout is Infinity — bound it so enable can't hang. */
const CAPTURE_TIMEOUT_MS = 10_000;
/** Accept a recent cached browser fix rather than forcing a fresh GPS read. */
const CAPTURE_MAX_AGE_MS = 60_000;

export interface LocationShareState {
  /** The user has opted in (and, when this was last written, held permission). */
  enabled: boolean;
  /** Epoch ms of the last successful capture, or null if none yet. */
  lastCapturedAt: number | null;
}

export interface Coordinates {
  lat: number;
  lng: number;
  accuracy: number;
}

/** A failed geolocation read, carrying a user-facing message for the UI. */
export class LocationCaptureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocationCaptureError";
  }
}

function geoErrorMessage(err: GeolocationPositionError): string {
  if (err.code === err.PERMISSION_DENIED) return "Location permission denied";
  if (err.code === err.TIMEOUT) return "Location request timed out";
  return "Location unavailable";
}

const DISABLED: LocationShareState = { enabled: false, lastCapturedAt: null };

/** localStorage key, scoped by box so two boxes in different tabs don't collide. */
export function locationShareKey(boxSlug: string | undefined): string {
  return `${KEY_PREFIX}:${boxSlug ?? "default"}`;
}

/**
 * Parse stored sharing state, defaulting to disabled for absent, malformed, or
 * invalid values. The only place untrusted localStorage JSON enters, so it
 * validates the full shape rather than trusting a cast.
 */
export function parseLocationShareState(raw: string | null): LocationShareState {
  if (raw === null || raw === "") return DISABLED;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (e) {
    console.warn(`[location-share] discarding unparseable state: ${e instanceof Error ? e.message : String(e)}`);
    return DISABLED;
  }
  // Parse boundary: localStorage JSON arrives untyped; every field is validated.
  if (!isRecord(value)) return DISABLED;
  const { enabled, lastCapturedAt } = value;
  if (typeof enabled !== "boolean") return DISABLED;
  if (lastCapturedAt !== null && (typeof lastCapturedAt !== "number" || !Number.isFinite(lastCapturedAt))) return DISABLED;
  return { enabled, lastCapturedAt: lastCapturedAt ?? null };
}

export function serializeLocationShareState(state: LocationShareState): string {
  return JSON.stringify(state);
}

/** Whether a fresh capture is warranted now: opted in, and no recent fix. */
export function shouldRefresh(state: LocationShareState, now: number): boolean {
  if (!state.enabled) return false;
  if (state.lastCapturedAt === null) return true;
  return now - state.lastCapturedAt > LOCATION_REFRESH_INTERVAL_MS;
}

export function loadLocationShareState(boxSlug: string | undefined): LocationShareState {
  return parseLocationShareState(localStorage.getItem(locationShareKey(boxSlug)));
}

/**
 * Persist sharing state — best-effort. localStorage can throw (quota, a
 * private-mode SecurityError); persistence is only a cross-reload convenience,
 * so a failure is logged, not propagated. Crucially this means a `setItem`
 * throw after a successful capture can't be mistaken for an enable failure and
 * flip the UI to "off" while a consented fix sits in the backend.
 */
export function saveLocationShareState(boxSlug: string | undefined, state: LocationShareState): void {
  try {
    localStorage.setItem(locationShareKey(boxSlug), serializeLocationShareState(state));
  } catch (e) {
    console.warn(`[location-share] could not persist sharing state: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Geolocation is usable only in a secure context with the API present. */
export function isGeolocationAvailable(): boolean {
  return typeof navigator !== "undefined" && "geolocation" in navigator && window.isSecureContext;
}

/**
 * Promisified getCurrentPosition with a finite timeout (the default is
 * Infinity, which would leave an enable click pending forever). Rejects on
 * denial, timeout, or position-unavailable — the caller treats all the same.
 */
export function captureCurrentPosition(): Promise<Coordinates> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => reject(new LocationCaptureError(geoErrorMessage(err))),
      { enableHighAccuracy: false, timeout: CAPTURE_TIMEOUT_MS, maximumAge: CAPTURE_MAX_AGE_MS },
    );
  });
}

/**
 * Capture + post a fix, then persist lastCapturedAt (best-effort). Throws only
 * on capture or post failure — a successful mutate is authoritative (the
 * backend now holds a consented fix), so persistence never gates "enabled".
 */
export async function captureAndStore(boxSlug: string | undefined, now: number): Promise<void> {
  const coords = await captureCurrentPosition();
  await trpcClient.location.capture.mutate(coords);
  saveLocationShareState(boxSlug, { enabled: true, lastCapturedAt: now });
}

/**
 * Best-effort refresh tied to a send: if sharing is on and the fix is stale,
 * capture quietly (no reprompt — permission is already granted) and post.
 * Fire-and-forget; any failure is swallowed so it never blocks or surfaces on
 * the send (the existing cached fix simply stays).
 */
export async function refreshLocationIfStale(boxSlug: string | undefined): Promise<void> {
  if (!isGeolocationAvailable()) return;
  const state = loadLocationShareState(boxSlug);
  if (!shouldRefresh(state, Date.now())) return;
  try {
    await captureAndStore(boxSlug, Date.now());
  } catch (e) {
    console.warn(`[location-share] background refresh failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
