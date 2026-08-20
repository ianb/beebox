// The typed client an exhibit page uses to persist state.
//
// Every call goes to the exhibits origin's own API, scoped by this page's
// exhibit: documents at data/<key>.json, appends to events.jsonl, raw bytes
// under captures/. What a page writes is what a later agent session reads off
// disk, so the shapes here are the contract on both sides.
//
// Honest limit: the type parameter is compile-time only. The server stores
// schema-agnostic JSON, so pass a schema when a page needs a runtime guarantee:
//
//   const storage = new Storage("thresholds", { schema: thresholdsSchema });

const BOOT_KEY = "__EXHIBIT__";

export interface ExhibitApiFailure {
  status: number;
  url: string;
  /** The API's own message, when it sent one. */
  detail?: string | undefined;
}

export class ExhibitApiError extends Error {
  readonly status: number;
  readonly detail: string | undefined;

  constructor(failure: ExhibitApiFailure) {
    const suffix = failure.detail === undefined || failure.detail === "" ? "" : `: ${failure.detail}`;
    super(`exhibit API ${failure.url} failed with HTTP ${String(failure.status)}${suffix}`);
    this.name = "ExhibitApiError";
    this.status = failure.status;
    this.detail = failure.detail;
  }
}

/** The API refuses in JSON with a readable message; surface it, never a bare code. */
async function refusal(response: Response, url: string): Promise<ExhibitApiError> {
  try {
    const body: unknown = await response.json();
    const detail =
      typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
        ? body.error
        : undefined;
    return new ExhibitApiError({ status: response.status, url, detail });
  } catch (_error) {
    return new ExhibitApiError({ status: response.status, url });
  }
}

export class MissingExhibitScopeError extends Error {
  constructor() {
    super("This page was not served by the exhibits container, so it has no exhibit scope.");
    this.name = "MissingExhibitScopeError";
  }
}

interface BootWindow {
  [BOOT_KEY]?: { scope?: string };
}

/** `<workstream>/<exhibit>` or `apps/<name>` — every API path is scoped by it. */
export function exhibitScope(): string {
  // eslint-disable-next-line no-restricted-syntax -- window is the boot boundary: the container injects __EXHIBIT__ as untyped JSON.
  const scope = (window as unknown as BootWindow)[BOOT_KEY]?.scope;
  if (scope === undefined || scope === "") throw new MissingExhibitScopeError();
  return scope;
}

function apiUrl(suffix: string): string {
  return `/api/${exhibitScope()}/${suffix}`;
}

export interface StorageOptions<T> {
  /** Any parser with Zod's shape; runtime validation is the page's choice. */
  schema?: { parse(value: unknown): T };
}

/** A whole JSON document, replaced atomically on save. */
export class Storage<T> {
  readonly #key: string;
  readonly #schema: { parse(value: unknown): T } | undefined;

  constructor(key: string, options?: StorageOptions<T>) {
    this.#key = key;
    this.#schema = options?.schema;
  }

  async load(): Promise<T | null> {
    const url = apiUrl(`data/${encodeURIComponent(this.#key)}`);
    const response = await fetch(url);
    if (response.status === 404) return null;
    if (!response.ok) throw await refusal(response, url);
    const value: unknown = await response.json();
    if (this.#schema) return this.#schema.parse(value);
    // eslint-disable-next-line no-restricted-syntax -- the documented compile-time-only guarantee: the server stores schema-agnostic JSON.
    return value as T;
  }

  async save(value: T): Promise<void> {
    // Validate before the write when a schema was supplied: a bad document is
    // the page's bug, and it should not reach disk for the next agent to read.
    const checked = this.#schema ? this.#schema.parse(value) : value;
    const url = apiUrl(`data/${encodeURIComponent(this.#key)}`);
    const response = await fetch(url, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(checked),
    });
    if (!response.ok) throw await refusal(response, url);
  }
}

/** Append-only JSONL; the server adds a timestamp to every line. */
export class EventLog<T> {
  readonly #log: string;

  constructor(log: string) {
    this.#log = log;
  }

  async append(event: T): Promise<void> {
    const url = apiUrl("events");
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ log: this.#log, data: event }),
    });
    if (!response.ok) throw await refusal(response, url);
  }
}

/** Raw bytes (audio, images) captured while the developer uses an instrument. */
export async function postCapture(name: string, blob: Blob): Promise<void> {
  const url = apiUrl(`captures/${encodeURIComponent(name)}`);
  const response = await fetch(url, { method: "POST", body: blob });
  if (!response.ok) throw await refusal(response, url);
}
