/**
 * Data access for the browser-task view: the card hook gives frontmatter and
 * body; everything under the card's attach scope (the record schema, the
 * inbox and processed batches) is fetched here over the raw-file and browse
 * routes. Pure fetch functions plus a small summary type; no React.
 */

import { z } from "zod";
import { apiRawFileUrl, getApiBase, withBase } from "../../api";
import { withMobileAuth } from "../../lib/mobile-auth";
import { attachDirFor } from "@shared/attach-path";
import { COVERAGE_REASONS } from "@shared/browser-task-batch";

export const SCHEMA_FILE = "schema.json";
export const INBOX_DIR = "inbox";
export const PROCESSED_DIR = "processed";

const coverageSchema = z.object({
  scanned: z.number(),
  stoppedAt: z.string(),
  reason: z.enum(COVERAGE_REASONS),
});

const recordsFileSchema = z.object({
  coverage: coverageSchema,
  records: z.array(z.unknown()),
});

const filedSchema = z.array(z.number());

const browseSchema = z.object({ dirs: z.array(z.string()) });

export interface BatchSummary {
  id: string;
  /** Box-relative path of the batch directory. */
  dir: string;
  /** Null when `records.json` is missing or unreadable. */
  records: number | null;
  coverage: z.infer<typeof coverageSchema> | null;
  /** Indices the drain has filed so far; empty when no drain has started. */
  filed: number[];
}

/** GET a box file as text; null on 404. Throws on other failures. */
export async function fetchBoxText(path: string): Promise<string | null> {
  const res = await fetch(apiRawFileUrl(getApiBase(), path), withMobileAuth({ cache: "no-store" }));
  if (res.status === 404) return null;
  if (!res.ok) throw new BrowserTaskFetchError(path, res.status);
  return res.text();
}

/** List the subdirectories one level under a box directory; [] when it does not exist. */
export async function fetchSubdirs(path: string): Promise<string[]> {
  const res = await fetch(withBase(`/api/browse/${path}`), withMobileAuth({ cache: "no-store" }));
  if (res.status === 404) return [];
  if (!res.ok) throw new BrowserTaskFetchError(path, res.status);
  const parsed = browseSchema.safeParse(await res.json());
  return parsed.success ? parsed.data.dirs : [];
}

async function fetchJson(path: string): Promise<unknown | null> {
  const text = await fetchBoxText(path);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch (_e) {
    // A half-written or hand-mangled file reads as absent; the summary shows null.
    return null;
  }
}

export async function loadBatch(dir: string, id: string): Promise<BatchSummary> {
  const [recordsRaw, filedRaw] = await Promise.all([fetchJson(`${dir}/records.json`), fetchJson(`${dir}/filed.json`)]);
  const records = recordsFileSchema.safeParse(recordsRaw);
  const filed = filedSchema.safeParse(filedRaw);
  return {
    id,
    dir,
    records: records.success ? records.data.records.length : null,
    coverage: records.success ? records.data.coverage : null,
    filed: filed.success ? filed.data : [],
  };
}

export async function loadBatches(cardPath: string, sub: string): Promise<BatchSummary[]> {
  const base = `${attachDirFor(cardPath)}/${sub}`;
  const ids = await fetchSubdirs(base);
  const batches = await Promise.all(ids.map((id) => loadBatch(`${base}/${id}`, id)));
  return batches.toSorted((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

export function schemaPath(cardPath: string): string {
  return `${attachDirFor(cardPath)}/${SCHEMA_FILE}`;
}

export class BrowserTaskFetchError extends Error {
  constructor(path: string, status: number) {
    super(`Could not load ${path} (HTTP ${String(status)})`);
    this.name = "BrowserTaskFetchError";
  }
}
