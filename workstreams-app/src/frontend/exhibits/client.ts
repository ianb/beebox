// The typed client an exhibit page uses to persist state.
//
// TRACK C NOTE: the server side of these URLs is not built yet. Every call
// here already speaks the Track C shapes, so pages written now keep working
// when the routes land; until then a call resolves to a 404 and throws
// ExhibitApiError.
//
// Honest limit: the type parameter is compile-time only. The server stores
// schema-agnostic JSON, so pass a schema when a page needs a runtime guarantee:
//
//   const storage = new Storage("thresholds", { schema: thresholdsSchema });

const BOOT_KEY = "__EXHIBIT__";

export class ExhibitApiError extends Error {
  constructor(public readonly status: number, url: string) {
    super(`exhibit API ${url} failed with HTTP ${String(status)}`);
    this.name = "ExhibitApiError";
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
    if (!response.ok) throw new ExhibitApiError(response.status, url);
    const value: unknown = await response.json();
    if (this.#schema) return this.#schema.parse(value);
    // eslint-disable-next-line no-restricted-syntax -- the documented compile-time-only guarantee: the server stores schema-agnostic JSON.
    return value as T;
  }

  async save(value: T): Promise<void> {
    const url = apiUrl(`data/${encodeURIComponent(this.#key)}`);
    const response = await fetch(url, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(value),
    });
    if (!response.ok) throw new ExhibitApiError(response.status, url);
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
    if (!response.ok) throw new ExhibitApiError(response.status, url);
  }
}

/** Raw bytes (audio, images) captured while the developer uses an instrument. */
export async function postCapture(name: string, blob: Blob): Promise<void> {
  const url = apiUrl(`captures/${encodeURIComponent(name)}`);
  const response = await fetch(url, { method: "POST", body: blob });
  if (!response.ok) throw new ExhibitApiError(response.status, url);
}
