/**
 * PublishRemoteStore — the R2 object surface the publish-submissions connector
 * pulls from (Track F of `docs/plans/publish-pages.md`).
 *
 * The connector never talks to R2 directly; it goes through this narrow
 * interface so the pull logic is fully unit-testable against
 * {@link createFakePublishStore} with no network. The real implementation
 * ({@link createR2PublishStore}) signs S3-compatible requests to Cloudflare R2
 * with `aws4fetch`.
 *
 * ⚠️ UNVERIFIED: the real R2 adapter cannot be exercised without live Cloudflare
 * credentials, so it is NOT covered by any doctest. The connector *logic* is
 * fully tested through the fake; the adapter is the thin, best-effort seam.
 * Treat its request shaping / XML parsing as unproven until a manual
 * end-to-end run against a real bucket (the plan's step-7 verification).
 *
 * Credentials come from machine-level env (NOT the box repo — same posture as
 * the Google OAuth creds, plan Track E):
 *   - `CLOUDFLARE_R2_ENDPOINT`          e.g. https://<accountid>.r2.cloudflarestorage.com
 *   - `CLOUDFLARE_R2_BUCKET`            the publications bucket name
 *   - `CLOUDFLARE_R2_ACCESS_KEY_ID`     R2 access key id
 *   - `CLOUDFLARE_R2_SECRET_ACCESS_KEY` R2 secret access key
 * When any is absent the connector treats publishing as unconfigured and its
 * sync is a silent no-op.
 */

import { AwsClient } from "aws4fetch";

/** R2 key prefixes the connector pulls from (plan Track A/F key layout). */
export const SUBMISSIONS_PREFIX = "submissions/";
export const ACCESS_LOG_PREFIX = "access-log/";

/** An R2 request (list/get/delete) returned a non-success HTTP status. */
export class R2RequestError extends Error {
  readonly op: string;
  readonly key: string;
  readonly status: number;
  constructor(args: { op: string; key: string; status: number; statusText: string }) {
    super(`R2 ${args.op} failed for '${args.key}': ${args.status} ${args.statusText}`);
    this.name = "R2RequestError";
    this.op = args.op;
    this.key = args.key;
    this.status = args.status;
  }
}

/** A requested object key does not exist in the store. */
export class RemoteObjectNotFoundError extends Error {
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
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/**
 * Read R2 config from machine-level env. Returns `null` when any credential is
 * missing — the connector reads that as "publishing not configured" and no-ops.
 */
export function r2ConfigFromEnv(env?: NodeJS.ProcessEnv): R2PublishStoreConfig | null {
  const source = env ?? process.env;
  const endpoint = source["CLOUDFLARE_R2_ENDPOINT"];
  const bucket = source["CLOUDFLARE_R2_BUCKET"];
  const accessKeyId = source["CLOUDFLARE_R2_ACCESS_KEY_ID"];
  const secretAccessKey = source["CLOUDFLARE_R2_SECRET_ACCESS_KEY"];
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { endpoint, bucket, accessKeyId, secretAccessKey };
}

/** Extract `<Key>…</Key>` values from a ListObjectsV2 XML body. */
function parseListedKeys(xml: string): string[] {
  const keys: string[] = [];
  const re = /<Key>([^<]+)<\/Key>/g;
  for (let m = re.exec(xml); m !== null; m = re.exec(xml)) {
    const raw = m[1];
    if (raw !== undefined) keys.push(decodeXmlEntities(raw));
  }
  return keys;
}

/** Minimal XML entity decode for the handful of chars S3 escapes in keys. */
function decodeXmlEntities(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

/**
 * ⚠️ UNVERIFIED (no live-CF test). Real R2 adapter over the S3-compatible API,
 * path-style addressing (`<endpoint>/<bucket>/<key>`), signed by `aws4fetch`
 * with `region: "auto"`, `service: "s3"`.
 */
export function createR2PublishStore(config: R2PublishStoreConfig): PublishRemoteStore {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: "auto",
    service: "s3",
  });
  const base = `${config.endpoint.replace(/\/$/, "")}/${config.bucket}`;

  async function listPrefix(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const url = new URL(base);
      url.searchParams.set("list-type", "2");
      url.searchParams.set("prefix", prefix);
      if (continuationToken !== undefined) url.searchParams.set("continuation-token", continuationToken);
      const res = await client.fetch(url.toString(), { method: "GET" });
      if (!res.ok) throw new R2RequestError({ op: "list", key: prefix, status: res.status, statusText: res.statusText });
      const xml = await res.text();
      keys.push(...parseListedKeys(xml));
      const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
      const tokenMatch = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml);
      continuationToken = truncated && tokenMatch?.[1] !== undefined ? decodeXmlEntities(tokenMatch[1]) : undefined;
    } while (continuationToken !== undefined);
    return keys;
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
      const res = await client.fetch(`${base}/${encodeR2Key(key)}`, { method: "GET" });
      if (!res.ok) throw new R2RequestError({ op: "get", key, status: res.status, statusText: res.statusText });
      return new Uint8Array(await res.arrayBuffer());
    },
    async put(key: string, opts: PublishPutOptions): Promise<void> {
      const headers: Record<string, string> = {};
      if (opts.contentType !== undefined) headers["content-type"] = opts.contentType;
      const res = await client.fetch(`${base}/${encodeR2Key(key)}`, { method: "PUT", body: opts.body, headers });
      if (!res.ok) throw new R2RequestError({ op: "put", key, status: res.status, statusText: res.statusText });
    },
    async delete(key: string): Promise<void> {
      const res = await client.fetch(`${base}/${encodeR2Key(key)}`, { method: "DELETE" });
      // 204 (deleted) and 404 (already gone) are both success from our view.
      if (!res.ok && res.status !== 404) {
        throw new R2RequestError({ op: "delete", key, status: res.status, statusText: res.statusText });
      }
    },
  };
}

/** Percent-encode a key for the request path, preserving `/` separators. */
function encodeR2Key(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
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
