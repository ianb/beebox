/**
 * PublishRemoteStore — the R2 object surface server-managed publications read
 * and write: site manifests, release objects, slug pointers, and shared-route
 * markers.
 *
 * Callers go through this narrow interface so publication logic is fully
 * unit-testable against {@link createFakePublishStore} with no network. The
 * real implementation ({@link createR2PublishStore}) calls Cloudflare's REST API
 * (`api.cloudflare.com/client/v4/accounts/<id>/r2/buckets/<bucket>/objects/...`)
 * through the injected bearer provider — no S3-style request signing.
 *
 * ⚠️ UNVERIFIED: the real R2 adapter cannot be exercised without live Cloudflare
 * credentials, so it is NOT covered by any doctest. The publication logic is
 * fully tested through the fake; the adapter is the thin, best-effort seam.
 *
 * Credentials: the box server resolves the bucket and API token from the
 * machine-custody publishing connection (`core/secrets/cloudflare-publish.ts`)
 * granted to the box.
 */

import { z } from "zod";

import type { BearerProvider } from "./cloudflare-bearer.js";

/** One entry of a Cloudflare API JSON error body's `errors` array. */
export interface CloudflareApiErrorDetail {
  code: number;
  message: string;
}

/** An R2 request (list/get/put/delete) returned a non-success HTTP status. */
class R2RequestError extends Error {
  readonly op: string;
  readonly key: string;
  readonly status: number;
  readonly cfErrors: CloudflareApiErrorDetail[];
  constructor(args: {
    op: string;
    key: string;
    status: number;
    statusText: string;
    cfErrors?: CloudflareApiErrorDetail[] | undefined;
  }) {
    const detail = args.cfErrors?.length ? `: ${args.cfErrors.map((e) => `[${e.code}] ${e.message}`).join(", ")}` : "";
    super(`R2 ${args.op} failed for '${args.key}': ${args.status} ${args.statusText}${detail}`);
    this.name = "R2RequestError";
    this.op = args.op;
    this.key = args.key;
    this.status = args.status;
    this.cfErrors = args.cfErrors ?? [];
  }
}

/** A requested object key does not exist in the store. */
class RemoteObjectNotFoundError extends Error {
  readonly key: string;
  constructor(key: string) {
    super(`no such object: ${key}`);
    this.name = "RemoteObjectNotFoundError";
    this.key = key;
  }
}

/** The body + metadata for a {@link PublishRemoteStore.put}. */
export interface PublishPutOptions {
  /** The object bytes (or a string, encoded UTF-8). */
  body: Uint8Array | string;
  /** `Content-Type` metadata for the stored object (release files set it by extension). */
  contentType?: string | undefined;
}

/**
 * The R2 surface server-managed publications use: list under a prefix, fetch,
 * write, delete. Minimal: no metadata, no multipart.
 */
export interface PublishRemoteStore {
  /** Object keys under a prefix (e.g. `pubs/<id>/releases/`). Sorted. */
  list(prefix: string): Promise<string[]>;
  /** Fetch an object's raw bytes. Rejects if the key is absent. */
  get(key: string): Promise<Uint8Array>;
  /** Write (create or overwrite) an object. Idempotent — a re-put is a no-op change. */
  put(key: string, opts: PublishPutOptions): Promise<void>;
  /** Delete an object. Idempotent from the caller's view. */
  delete(key: string): Promise<void>;
}

export interface R2PublishStoreConfig {
  accountId: string;
  bucket: string;
  /** The bearer seam: the stored publishing-connection token. */
  bearer: BearerProvider;
}

/** The subset of `fetch` the real adapter calls — injectable so a unit test can exercise URL/error mapping without a network. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Zod shape of a Cloudflare API JSON error body's `errors` array — the untrusted-response parse boundary. */
const cloudflareApiErrorSchema = z.object({ code: z.number(), message: z.string() });

/** Zod shape of a Cloudflare API JSON response envelope (list) — the untrusted-response parse boundary. */
const cloudflareListResponseSchema = z.object({
  success: z.boolean(),
  errors: z.array(cloudflareApiErrorSchema).optional(),
  result: z.array(z.object({ key: z.string() })).optional(),
  result_info: z
    .object({
      cursor: z.string().optional(),
      is_truncated: z.boolean().optional(),
    })
    .optional(),
});

/** Best-effort extraction of a Cloudflare JSON error body's `errors` array (absent for non-JSON or unexpected bodies). */
async function tryReadCfErrors(res: Response): Promise<CloudflareApiErrorDetail[] | undefined> {
  try {
    const body: unknown = await res.clone().json();
    const parsed = z.object({ errors: z.array(cloudflareApiErrorSchema).optional() }).safeParse(body);
    return parsed.success ? parsed.data.errors : undefined;
  } catch (_e) {
    // Non-JSON error body (e.g. a plain-text gateway error) — no CF detail available.
    return undefined;
  }
}

/** Percent-encode a key for the request path, preserving `/` separators. */
function encodeR2Key(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

/**
 * ⚠️ UNVERIFIED (no live-CF test). Real R2 adapter over Cloudflare's REST API
 * (`api.cloudflare.com/client/v4/accounts/<id>/r2/buckets/<bucket>/objects/...`),
 * authenticated per request through the injected bearer provider — no
 * S3-style request signing.
 */
export function createR2PublishStore(config: R2PublishStoreConfig, deps?: { fetch?: FetchLike | undefined }): PublishRemoteStore {
  const doFetch = deps?.fetch ?? fetch;
  const base = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/r2/buckets/${config.bucket}`;

  /**
   * Fetch with the current bearer; on a 401, refresh through the provider and
   * retry ONCE — every store op is idempotent. A second 401 propagates.
   */
  async function authedFetch(url: string, init: { method: string; headers?: Record<string, string>; body?: Uint8Array | string }): Promise<Response> {
    const attempt = async (bearer: string): Promise<Response> => {
      const body = typeof init.body === "string" || init.body === undefined
        ? init.body
        : new Uint8Array(init.body);
      return doFetch(url, { method: init.method, headers: { ...init.headers, authorization: `Bearer ${bearer}` }, ...(body === undefined ? {} : { body }) });
    };
    const res = await attempt(await config.bearer.get());
    if (res.status !== 401) return res;
    return attempt(await config.bearer.refresh());
  }

  async function listPrefix(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor: string | undefined;
    do {
      const url = new URL(`${base}/objects`);
      url.searchParams.set("prefix", prefix);
      url.searchParams.set("per_page", "1000");
      if (cursor !== undefined) url.searchParams.set("cursor", cursor);
      const res = await authedFetch(url.toString(), { method: "GET" });
      if (!res.ok) {
        throw new R2RequestError({ op: "list", key: prefix, status: res.status, statusText: res.statusText, cfErrors: await tryReadCfErrors(res) });
      }
      const parsed = cloudflareListResponseSchema.safeParse(await res.json());
      if (!parsed.success) {
        throw new R2RequestError({ op: "list", key: prefix, status: res.status, statusText: `malformed response body: ${parsed.error.message}` });
      }
      const body = parsed.data;
      for (const obj of body.result ?? []) keys.push(obj.key);
      cursor = body.result_info?.is_truncated ? body.result_info.cursor : undefined;
    } while (cursor !== undefined);
    return keys.toSorted();
  }

  return {
    list(prefix: string): Promise<string[]> {
      return listPrefix(prefix);
    },
    async get(key: string): Promise<Uint8Array> {
      const res = await authedFetch(`${base}/objects/${encodeR2Key(key)}`, { method: "GET" });
      if (res.status === 404) throw new RemoteObjectNotFoundError(key);
      if (!res.ok) {
        throw new R2RequestError({ op: "get", key, status: res.status, statusText: res.statusText, cfErrors: await tryReadCfErrors(res) });
      }
      return new Uint8Array(await res.arrayBuffer());
    },
    async put(key: string, opts: PublishPutOptions): Promise<void> {
      const headers: Record<string, string> = {};
      if (opts.contentType !== undefined) headers["content-type"] = opts.contentType;
      const res = await authedFetch(`${base}/objects/${encodeR2Key(key)}`, { method: "PUT", body: opts.body, headers });
      if (!res.ok) {
        throw new R2RequestError({ op: "put", key, status: res.status, statusText: res.statusText, cfErrors: await tryReadCfErrors(res) });
      }
    },
    async delete(key: string): Promise<void> {
      const res = await authedFetch(`${base}/objects/${encodeR2Key(key)}`, { method: "DELETE" });
      // 404 (already gone) is success from our view — delete is idempotent.
      if (!res.ok && res.status !== 404) {
        throw new R2RequestError({ op: "delete", key, status: res.status, statusText: res.statusText, cfErrors: await tryReadCfErrors(res) });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Fake — in-memory, for publication doctests. No network.
// ---------------------------------------------------------------------------

export interface FakePublishStore extends PublishRemoteStore {
  /** Live object map (full R2 key → bytes). Mutated by `put`/`delete`. */
  objects: Map<string, Uint8Array>;
  /** Keys written so far, in call order — tests assert release-before-manifest upload order. */
  puts: string[];
  /** Keys deleted so far, in call order — tests assert land-then-delete. */
  deleted: string[];
  /** Every mutating op in call order (`put:<key>` / `delete:<key>`) — for cross-op ordering assertions. */
  ops: string[];
  /** Stable, human-readable snapshot for doctest assertions. */
  describe(): string;
}

export interface FakePublishStoreOptions {
  /** Seed objects keyed by full R2 key (`pubs/…`, `slugs/…`). */
  objects?: Record<string, string | Uint8Array>;
}

const encoder = new TextEncoder();

/** Build a network-free {@link PublishRemoteStore} backed by an in-memory map. */
export function createFakePublishStore(options?: FakePublishStoreOptions): FakePublishStore {
  const objects = new Map<string, Uint8Array>();
  for (const [key, value] of Object.entries(options?.objects ?? {})) {
    objects.set(key, typeof value === "string" ? encoder.encode(value) : value);
  }
  const puts: string[] = [];
  const deleted: string[] = [];
  const ops: string[] = [];

  const listPrefix = (prefix: string): Promise<string[]> =>
    Promise.resolve([...objects.keys()].filter((k) => k.startsWith(prefix)).toSorted());

  return {
    objects,
    puts,
    deleted,
    ops,
    list: (prefix: string) => listPrefix(prefix),
    get(key: string): Promise<Uint8Array> {
      const bytes = objects.get(key);
      if (bytes === undefined) return Promise.reject(new RemoteObjectNotFoundError(key));
      return Promise.resolve(bytes);
    },
    put(key: string, opts: PublishPutOptions): Promise<void> {
      objects.set(key, typeof opts.body === "string" ? encoder.encode(opts.body) : opts.body);
      puts.push(key);
      ops.push(`put:${key}`);
      return Promise.resolve();
    },
    delete(key: string): Promise<void> {
      objects.delete(key);
      deleted.push(key);
      ops.push(`delete:${key}`);
      return Promise.resolve();
    },
    describe(): string {
      const remaining = [...objects.keys()].toSorted();
      return [`objects: ${remaining.length}`, ...remaining.map((k) => `  ${k}`), `deleted: ${deleted.join(", ")}`].join("\n");
    },
  };
}
