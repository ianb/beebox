/**
 * Committed-Worker introspection for `cb pub setup` / `cb pub status` (Track E
 * of `docs/plans/publish-pages.md`): read the `pub-worker/` package's
 * `wrangler.jsonc` (the single source of truth for the Worker name and R2
 * binding — nothing here duplicates it), and compute the deterministic content
 * hash of the committed Worker source that setup stamps into the deploy
 * (`--var PUB_WORKER_VERSION:<hash>`) and status compares against the deployed
 * Worker's `GET /__version` to flag drift.
 */

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { PACKAGE_ROOT } from "../lib/package-root.js";

/** Absolute path to the `pub-worker/` package (a sibling workspace dir under the callback-box package root). */
export const PUB_WORKER_DIR = path.join(PACKAGE_ROOT, "pub-worker");

/**
 * Box-side modules the Worker imports across the package boundary
 * (`pub-worker/src/*` importing `../../src/publish/<name>.ts`). They are part
 * of the deployed Worker bundle, so they belong in the version hash. Guarded by
 * a doctest that greps the Worker source for cross-package imports — add here
 * AND the import will stay covered.
 */
export const CROSS_PACKAGE_SOURCES = ["manifest-edge", "submission"] as const;

/** Strip line and block comments (outside string literals) so `JSON.parse` accepts a `.jsonc` file we author ourselves. */
export function stripJsoncComments(text: string): string {
  let out = "";
  let inString = false;
  let i = 0;
  while (i < text.length) {
    const ch = text.charAt(i);
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += text[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      const end = text.indexOf("\n", i);
      i = end === -1 ? text.length : end;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** The slice of `wrangler.jsonc` setup/status consume. Loose (non-strict) on purpose — wrangler owns the full shape. */
const wranglerConfigSchema = z.object({
  name: z.string().min(1),
  r2_buckets: z
    .array(z.object({ binding: z.string(), bucket_name: z.string() }))
    .min(1),
  preview_urls: z.boolean().optional(),
});

/** The Worker's two R2 bindings (`docs/plans/pub-setup-wrangler.md` amendment 1 — the bucket split). */
export const CONTENT_BUCKET_BINDING = "PUB_STORE";
export const INGEST_BUCKET_BINDING = "PUB_INGEST";

/** What setup/status need to know about the committed Worker deployment shape. */
export interface PubWorkerConfig {
  /** The Worker script name (`name` in wrangler.jsonc) — also the workers.dev hostname's first label. */
  workerName: string;
  /** The R2 binding name the Worker reads publication content from (`PUB_STORE`). */
  bucketBinding: string;
  /** The content bucket name the committed config binds — the default `cb pub setup` provisions. */
  bucketName: string;
  /** The ingestion bucket (`PUB_INGEST` binding): Worker-written submissions + access logs, connector-read. */
  ingestBucketName: string;
  /** Whether the committed config already disables version-preview URLs (it must — a leak surface). */
  previewUrlsDisabled: boolean;
}

/** Error shape for a `wrangler.jsonc` that doesn't parse or lacks the fields setup relies on. */
export class PubWorkerConfigError extends Error {
  readonly detail: string;
  constructor(args: { detail: string }) {
    super(`pub-worker wrangler.jsonc is unusable: ${args.detail}`);
    this.name = "PubWorkerConfigError";
    this.detail = args.detail;
  }
}

/** Read + validate `pub-worker/wrangler.jsonc`. Throws {@link PubWorkerConfigError} on a shape we can't provision from. */
export async function readPubWorkerConfig(dir?: string): Promise<PubWorkerConfig> {
  const configDir = dir ?? PUB_WORKER_DIR;
  const raw = await readFile(path.join(configDir, "wrangler.jsonc"), "utf-8");
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(stripJsoncComments(raw));
  } catch (e) {
    throw new PubWorkerConfigError({ detail: `not valid JSONC (${e instanceof Error ? e.message : String(e)})` });
  }
  const parsed = wranglerConfigSchema.safeParse(parsedJson);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new PubWorkerConfigError({ detail: `${issue?.message ?? "schema rejected"} (${issue?.path.join(".") ?? "config"})` });
  }
  const byBinding = new Map(parsed.data.r2_buckets.map((b) => [b.binding, b.bucket_name]));
  const bucketName = byBinding.get(CONTENT_BUCKET_BINDING);
  const ingestBucketName = byBinding.get(INGEST_BUCKET_BINDING);
  if (bucketName === undefined) throw new PubWorkerConfigError({ detail: `no r2_buckets entry with binding '${CONTENT_BUCKET_BINDING}'` });
  if (ingestBucketName === undefined) throw new PubWorkerConfigError({ detail: `no r2_buckets entry with binding '${INGEST_BUCKET_BINDING}'` });
  return {
    workerName: parsed.data.name,
    bucketBinding: CONTENT_BUCKET_BINDING,
    bucketName,
    ingestBucketName,
    previewUrlsDisabled: parsed.data.preview_urls === false,
  };
}

/**
 * Pure content hash over a set of source files: sha256 of each `<path>\0<content>\0`
 * in path-sorted order, hex. Deterministic for a given committed tree — the
 * Worker's version identity for the deploy stamp and the drift probe.
 */
export function computePubWorkerVersion(files: ReadonlyMap<string, string>): string {
  const hash = createHash("sha256");
  for (const [file, content] of [...files].toSorted((a, b) => a[0].localeCompare(b[0]))) {
    hash.update(file);
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

/**
 * Read every file that ships in the deployed Worker: `pub-worker/src/**` and
 * `wrangler.jsonc` (whose committed `PUB_WORKER_VERSION` placeholder stays empty,
 * keeping the hash stable), plus the {@link CROSS_PACKAGE_SOURCES} the Worker
 * imports from `src/publish/`. Keys are stable repo-relative labels.
 */
export async function readPubWorkerSourceFiles(dir?: string): Promise<Map<string, string>> {
  const workerDir = dir ?? PUB_WORKER_DIR;
  const files = new Map<string, string>();
  const srcDir = path.join(workerDir, "src");
  const entries = await readdir(srcDir, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const abs = path.join(entry.parentPath, entry.name);
    const rel = path.relative(workerDir, abs).split(path.sep).join("/");
    files.set(`pub-worker/${rel}`, await readFile(abs, "utf-8"));
  }
  files.set("pub-worker/wrangler.jsonc", await readFile(path.join(workerDir, "wrangler.jsonc"), "utf-8"));
  for (const name of CROSS_PACKAGE_SOURCES) {
    const abs = path.join(PACKAGE_ROOT, "src", "publish", `${name}.ts`);
    files.set(`src/publish/${name}.ts`, await readFile(abs, "utf-8"));
  }
  return files;
}

/** The committed Worker's version: hash of {@link readPubWorkerSourceFiles}. */
export async function localPubWorkerVersion(dir?: string): Promise<string> {
  return computePubWorkerVersion(await readPubWorkerSourceFiles(dir));
}
