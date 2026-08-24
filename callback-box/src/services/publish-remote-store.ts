/**
 * PublishRemoteStore — the R2 object surface the publish-submissions connector
 * pulls from (Track F of `docs/plans/publish-pages.md`).
 *
 * The connector never talks to R2 directly; it goes through this narrow
 * interface so the pull logic is fully unit-testable against
 * {@link createFakePublishStore} with no network. The real implementation
 * ({@link createR2PublishStore}) calls Cloudflare's REST API
 * (`api.cloudflare.com/client/v4/accounts/<id>/r2/buckets/<bucket>/objects/...`)
 * through the injected bearer provider — no S3-style request signing.
 *
 * ⚠️ UNVERIFIED: the real R2 adapter cannot be exercised without live Cloudflare
 * credentials, so it is NOT covered by any doctest. The connector *logic* is
 * fully tested through the fake; the adapter is the thin, best-effort seam.
 * Treat its request shaping / error mapping as unproven until a manual
 * end-to-end run against a real bucket (the plan's step-7 verification).
 *
 * Credentials (`docs/implemented-plans/pub-setup-wrangler.md` credential model): the
 * connector reads its ingestion-bucket-scoped token from the per-box secret
 * file `config/connectors/publish.secret.json`; the laptop CLI rides the
 * wrangler-OAuth login. The `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`/
 * `CLOUDFLARE_R2_BUCKET` env triple stays as an explicit override
 * ({@link r2ConfigFromEnv}). No credential resolves ⇒ unconfigured, no-op.
 */

import { z } from "zod";

import { type BearerProvider, staticBearer } from "./cloudflare-bearer.js";

/** R2 key prefixes the connector pulls from (plan Track A/F key layout). */
const SUBMISSIONS_PREFIX = "submissions/";
const ACCESS_LOG_PREFIX = "access-log/";

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
  /** `Content-Type` metadata for the stored object (bundle assets set it by extension). */
  contentType?: string | undefined;
}

/**
 * The R2 surface the publish flow uses. The connector (Track F) only ever pulls
 * — list under a prefix, fetch bytes, delete — but the CLI publish-lifecycle
 * commands (Track E: `cb pub go`/`revoke`) additionally *write* the edge
 * manifest, bundle objects, and slug pointer, so `put` and a generic `list`
 * round out the interface. Still minimal: no metadata, no multipart.
 */
export interface PublishRemoteStore {
  /** Object keys under `submissions/` (each a stored submission JSON). */
  listSubmissions(): Promise<string[]>;
  /** Object keys under `access-log/` (each a stored `{ts,pubId,email}` JSON). */
  listAccessLogs(): Promise<string[]>;
  /** Object keys under an arbitrary prefix (e.g. `pubs/<id>/bundle/`). Sorted. */
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
  /** The bearer seam: a stored static token (connector) or the wrangler-OAuth provider (laptop CLI). */
  bearer: BearerProvider;
}

/**
 * Read R2 config from env — the explicit escape hatch that overrides the
 * wrangler-OAuth path (mirrors wrangler's own `CLOUDFLARE_API_TOKEN`
 * precedence). Returns `null` when any of the three vars is missing.
 */
export function r2ConfigFromEnv(env?: NodeJS.ProcessEnv): R2PublishStoreConfig | null {
  const source = env ?? process.env;
  const apiToken = source["CLOUDFLARE_API_TOKEN"];
  const accountId = source["CLOUDFLARE_ACCOUNT_ID"];
  const bucket = source["CLOUDFLARE_R2_BUCKET"];
  if (!apiToken || !accountId || !bucket) return null;
  return { accountId, bucket, bearer: staticBearer(apiToken) };
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
   * Fetch with the current bearer; a 401 may just be an expired OAuth access
   * token (a long `cb pub go` outlives one), so refresh through the provider
   * and retry ONCE — every store op is idempotent. A second 401 propagates.
   */
  async function authedFetch(url: string, init: { method: string; headers?: Record<string, string>; body?: Uint8Array | string }): Promise<Response> {
    const attempt = async (bearer: string): Promise<Response> =>
      doFetch(url, { method: init.method, headers: { ...init.headers, authorization: `Bearer ${bearer}` }, ...(init.body === undefined ? {} : { body: init.body }) });
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
    listSubmissions(): Promise<string[]> {
      return listPrefix(SUBMISSIONS_PREFIX);
    },
    listAccessLogs(): Promise<string[]> {
      return listPrefix(ACCESS_LOG_PREFIX);
    },
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
// Fake — in-memory, for connector doctests. No network.
// ---------------------------------------------------------------------------

export interface FakePublishStore extends PublishRemoteStore {
  /** Live object map (full R2 key → bytes). Mutated by `put`/`delete`. */
  objects: Map<string, Uint8Array>;
  /** Keys written so far, in call order — tests assert bundle-before-manifest upload order. */
  puts: string[];
  /** Keys deleted so far, in call order — tests assert land-then-delete. */
  deleted: string[];
  /** Every mutating op in call order (`put:<key>` / `delete:<key>`) — for cross-op ordering assertions. */
  ops: string[];
  /** Stable, human-readable snapshot for doctest assertions. */
  describe(): string;
}

export interface FakePublishStoreOptions {
  /** Seed objects keyed by full R2 key (`submissions/…`, `access-log/…`). */
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
    listSubmissions: () => listPrefix(SUBMISSIONS_PREFIX),
    listAccessLogs: () => listPrefix(ACCESS_LOG_PREFIX),
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
