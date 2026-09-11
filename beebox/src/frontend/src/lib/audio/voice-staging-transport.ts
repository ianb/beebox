/**
 * HTTP transport for the voice-staging queue's ops
 * (`docs/plans/resilient-voice-recording.md`, Track 2) — the raw capture
 * routes (`webapp/routes/capture*.ts`), called the same way `capture-api.ts`
 * calls them, but returning an `OpOutcome` for `nextDrainStep` instead of
 * throwing.
 */

import { assertNever } from "@shared/invariant";
import { isRecord } from "@shared/is-record";
import { withMobileAuth, mobileAuthHeaders } from "../mobile-auth";
import { fetchFromBox, isBoxUnreachable } from "../trpc/transient";
import { uploadBinary, UploadStalledError, UploadNetworkError, UploadResponseError } from "../binary-upload";
import type { StoredVoiceOp } from "./voice-staging-storage";
import type { OpOutcome, VoiceCreateOp, VoiceChunkOp, VoiceFinalizeOp } from "./voice-staging-queue-core";

/** No wall-clock deadline — a slow phone upload is legitimate; only a stall aborts it. */
const CHUNK_STALL_TIMEOUT_MS = 20_000;

/**
 * `pcm-000001.raw`, … — mirrors the server's `pcmChunkFilename`
 * (`core/capture/audio-format.ts`), which the finalize contiguity check
 * rebuilds from `chunkCount`. Kept in sync by hand: a frontend module can't
 * import backend `core/`.
 */
function pcmChunkFilename(oneIndexedChunkNumber: number): string {
  return `pcm-${String(oneIndexedChunkNumber).padStart(6, "0")}.raw`;
}

/** The response body's `{ error }` message when it sent one, else the status line. */
async function responseErrorDetail(response: Response): Promise<string> {
  try {
    const body: unknown = await response.clone().json();
    if (isRecord(body) && typeof body["error"] === "string") return body["error"];
  } catch (_e) {
    /* ignore: non-JSON body — fall through to the status line */
  }
  return response.statusText.length > 0 ? response.statusText : `HTTP ${String(response.status)}`;
}

/** A capture route answered with a non-2xx status; `detail` is its `{ error }` message. */
class VoiceStagingResponseError extends Error {
  readonly status: number;
  constructor(opts: { status: number; detail: string }) {
    super(`HTTP ${String(opts.status)}: ${opts.detail}`);
    this.name = "VoiceStagingResponseError";
    this.status = opts.status;
  }
}

async function classifyResponse(response: Response): Promise<OpOutcome> {
  if (response.ok) return { kind: "success" };
  const detail = await responseErrorDetail(response);
  return { kind: "terminal", error: new VoiceStagingResponseError({ status: response.status, detail }) };
}

/** The same 502/503/504 set `transient.ts`'s `fetchFromBox` treats as an outage. */
const GATEWAY_STATUSES = new Set([502, 503, 504]);

/**
 * A thrown error, classified the way the plan specifies: `isBoxUnreachable`
 * covers `fetchFromBox`'s gateway/network failures, and the two `XHR`-specific
 * classes cover `uploadBinary`'s stall/network failures. `uploadBinary` uses
 * `XMLHttpRequest`, not `fetch`, so a deploy-restart 502 on a chunk upload
 * never reaches `fetchFromBox`'s classification at all — it resolves as an
 * `UploadResponseError` instead, which is why that one status range gets its
 * own check here rather than being terminal like every other response status
 * (classified by `classifyResponse`, for `create`/`finalize`/`discard`).
 */
function classifyThrown(error: unknown): OpOutcome {
  if (isBoxUnreachable(error) || error instanceof UploadStalledError || error instanceof UploadNetworkError) {
    return { kind: "transient", error };
  }
  if (error instanceof UploadResponseError && GATEWAY_STATUSES.has(error.status)) {
    return { kind: "transient", error };
  }
  return { kind: "terminal", error };
}

async function sendCreate(op: StoredVoiceOp, payload: VoiceCreateOp): Promise<OpOutcome> {
  try {
    const response = await fetchFromBox(
      `${op.apiBase}/capture/sessions`,
      withMobileAuth({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: op.recordingId, kind: "voice", targetSessionId: payload.targetSessionId }),
      }),
    );
    return await classifyResponse(response);
  } catch (e) {
    return classifyThrown(e);
  }
}

async function sendChunk(op: StoredVoiceOp, payload: VoiceChunkOp): Promise<OpOutcome> {
  try {
    await uploadBinary({
      url: `${op.apiBase}/capture/sessions/${op.recordingId}/upload`,
      body: new Blob([payload.bytes]),
      headers: {
        ...mobileAuthHeaders(),
        "X-Capture-Filename": pcmChunkFilename(payload.chunkIndex),
        "X-Capture-Kind": "audio",
        "X-Capture-Segment-Id": op.recordingId,
        "X-Capture-Audio-Format": "pcm-s16le-16k",
      },
      stallTimeoutMs: CHUNK_STALL_TIMEOUT_MS,
    });
    return { kind: "success" };
  } catch (e) {
    return classifyThrown(e);
  }
}

async function sendFinalize(op: StoredVoiceOp, payload: VoiceFinalizeOp): Promise<OpOutcome> {
  try {
    const response = await fetchFromBox(
      `${op.apiBase}/capture/sessions/${op.recordingId}/finalize`,
      withMobileAuth({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chunkCount: payload.chunkCount, hq: payload.hq }),
      }),
    );
    return await classifyResponse(response);
  } catch (e) {
    return classifyThrown(e);
  }
}

/** A 404 means the session is already gone — that is what a discard wants, so it counts as success. */
async function sendDiscard(op: StoredVoiceOp): Promise<OpOutcome> {
  try {
    const response = await fetchFromBox(`${op.apiBase}/capture/sessions/${op.recordingId}`, withMobileAuth({ method: "DELETE" }));
    if (response.status === 404) return { kind: "success" };
    return await classifyResponse(response);
  } catch (e) {
    return classifyThrown(e);
  }
}

export async function sendVoiceOp(op: StoredVoiceOp): Promise<OpOutcome> {
  const { payload } = op;
  switch (payload.kind) {
    case "create":
      return sendCreate(op, payload);
    case "chunk":
      return sendChunk(op, payload);
    case "finalize":
      return sendFinalize(op, payload);
    case "discard":
      return sendDiscard(op);
    default:
      return assertNever(payload);
  }
}
