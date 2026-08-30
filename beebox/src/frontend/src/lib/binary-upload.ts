/**
 * Raw-body upload over `XMLHttpRequest`, with upload progress and a *stall*
 * deadline instead of a wall-clock one.
 *
 * Two reasons this isn't `fetch`:
 *
 * 1. **Stall detection.** A fixed `AbortSignal.timeout` cannot tell "slow but
 *    healthy" from "stuck". A 10 MB photo on a weak uplink legitimately takes
 *    minutes; killing it at 30s guarantees it never completes, and the retry
 *    re-sends from byte zero. Here the deadline resets on every byte that
 *    moves, so only a genuinely dead transfer is aborted.
 * 2. **Progress.** `fetch` reports no upload progress, so a slow upload is
 *    indistinguishable from a hung one in the UI. `xhr.upload.onprogress`
 *    gives real bytes-sent.
 *
 * The body goes up as `application/octet-stream` (the `raw-body-v1` encoding
 * the capture and bulk routes advertise), not multipart — one less framing
 * layer, and the server buffers it directly.
 */

/** Bytes moved so far for one upload. `total` is 0 when the length is unknown. */
export interface UploadProgressEvent {
  loaded: number;
  total: number;
}

/** The caller aborted via its `signal`. Never retryable — it was deliberate. */
export class UploadAbortedError extends Error {
  constructor() {
    super("Upload aborted");
    this.name = "UploadAbortedError";
  }
}

/** No bytes moved for the stall window — the transfer is stuck, not just slow. */
export class UploadStalledError extends Error {
  constructor(stallMs: number) {
    super(`Upload stalled (no progress for ${String(Math.round(stallMs / 1000))}s)`);
    this.name = "UploadStalledError";
  }
}

/** Transport-level failure (offline, DNS, TLS, connection reset). */
export class UploadNetworkError extends Error {
  constructor() {
    super("Upload failed (network error)");
    this.name = "UploadNetworkError";
  }
}

/** The server answered, but not with a success status. */
export class UploadResponseError extends Error {
  readonly status: number;
  readonly detail: string;
  constructor(opts: { status: number; detail: string }) {
    super(`Upload failed (${String(opts.status)}): ${opts.detail}`);
    this.name = "UploadResponseError";
    this.status = opts.status;
    this.detail = opts.detail;
  }
}

/**
 * How often the watchdog compares now against the last progress event. Finer
 * than the stall window itself so the abort lands promptly once it trips.
 */
const STALL_CHECK_INTERVAL_MS = 2_000;

export interface BinaryUploadOptions {
  url: string;
  body: Blob;
  /** Request headers. `Content-Type` is set for you. */
  headers: Record<string, string>;
  /** Abort once no byte has moved for this long. */
  stallTimeoutMs: number;
  signal?: AbortSignal | undefined;
  onProgress?: ((event: UploadProgressEvent) => void) | undefined;
}

export function uploadBinary(options: BinaryUploadOptions): Promise<void> {
  const { url, body, headers, stallTimeoutMs, signal, onProgress } = options;

  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new UploadAbortedError());
      return;
    }

    const xhr = new XMLHttpRequest();
    const teardown: Array<() => void> = [];
    let lastProgressAt = Date.now();
    let settled = false;

    const settle = (outcome: () => void): void => {
      if (settled) return;
      settled = true;
      for (const off of teardown) off();
      outcome();
    };

    // The watchdog measures *stalled* time, and a backgrounded tab isn't
    // stalled — mobile browsers suspend timers and throttle transfers when the
    // page is hidden, so counting that as a stall would abort healthy uploads
    // the moment the user glances at another app. Hidden time is forgiven by
    // restamping when the page comes back.
    const watchdog = window.setInterval(() => {
      if (document.visibilityState === "hidden") {
        lastProgressAt = Date.now();
        return;
      }
      if (Date.now() - lastProgressAt < stallTimeoutMs) return;
      settle(() => {
        xhr.abort();
        reject(new UploadStalledError(stallTimeoutMs));
      });
    }, STALL_CHECK_INTERVAL_MS);
    teardown.push(() => window.clearInterval(watchdog));

    const handleVisibility = (): void => {
      if (document.visibilityState === "visible") lastProgressAt = Date.now();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    teardown.push(() => document.removeEventListener("visibilitychange", handleVisibility));

    if (signal) {
      const handleAbort = (): void => {
        settle(() => {
          xhr.abort();
          reject(new UploadAbortedError());
        });
      };
      signal.addEventListener("abort", handleAbort);
      teardown.push(() => signal.removeEventListener("abort", handleAbort));
    }

    xhr.upload.onprogress = (event: ProgressEvent): void => {
      lastProgressAt = Date.now();
      onProgress?.({ loaded: event.loaded, total: event.lengthComputable ? event.total : 0 });
    };

    xhr.onload = (): void => {
      settle(() => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
          return;
        }
        reject(new UploadResponseError({ status: xhr.status, detail: responseDetail(xhr) }));
      });
    };

    // `onerror` covers transport faults only; an HTTP error status arrives via
    // `onload`. `onabort` fires for our own aborts too, but `settle` has
    // already run by then, so it is a no-op in that case.
    xhr.onerror = (): void => settle(() => reject(new UploadNetworkError()));
    xhr.onabort = (): void => settle(() => reject(new UploadAbortedError()));

    xhr.open("POST", url);
    // Same-origin path-based API, so cookie auth rides along by default; this
    // keeps it explicit for the bearer-token (paired mobile) case too.
    xhr.withCredentials = true;
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.send(body);
  });
}

/** The server's `{ error }` message when it sent one, else the status line. */
function responseDetail(xhr: XMLHttpRequest): string {
  const raw = typeof xhr.responseText === "string" ? xhr.responseText : "";
  if (raw.length > 0) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed !== null && typeof parsed === "object" && "error" in parsed) {
        const { error } = parsed;
        if (typeof error === "string") return error;
      }
    } catch (_e) {
      /* ignore: non-JSON body — fall through to the raw text */
    }
    return raw;
  }
  return xhr.statusText.length > 0 ? xhr.statusText : `HTTP ${String(xhr.status)}`;
}
