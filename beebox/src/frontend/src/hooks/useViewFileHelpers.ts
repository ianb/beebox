/**
 * File access helpers passed to agent-generated views: read (with byte
 * ranges), write/append (conflict-safe via etag preconditions), commit,
 * and raw URLs.
 *
 * The symmetry: a ViewFile is an identity + version (etag = mtime+size).
 * Reads hand you ViewFiles; a conflict-safe write asserts the version it
 * read ({expect: file} → If-Match) and returns the NEW ViewFile; a
 * mismatch throws ViewFileConflictError carrying the current state so the
 * view can refresh instead of clobbering.
 */

import { useMemo } from "react";
import { z } from "zod";
import { encodePathForUrl } from "../lib/view-url";

/**
 * File metadata from the views API; content is fetched on demand. The zod
 * schema is the parse boundary for every write/commit response below (the
 * server hands back untyped JSON); {@link ViewFile} is derived from it.
 */
const viewFileSchema = z.object({
  path: z.string(),
  size: z.number(),
  mtimeMs: z.number(),
  // Version token — echo back via {expect} for conflict-safe writes.
  etag: z.string(),
  gitStatus: z.enum(["dirty", "untracked"]).optional(),
});

export type ViewFile = z.infer<typeof viewFileSchema>;

/** Response bodies of the write/commit routes (see routes/api-files-write.ts). */
const writeOkBodySchema = z.object({ file: viewFileSchema });
const conflictBodySchema = z.object({ current: viewFileSchema.nullable().optional() });
const commitResultSchema = z.object({ committed: z.boolean(), hash: z.string().optional() });
const errorBodySchema = z.object({ error: z.string().optional() });

/** readFile() failure — carries the path and HTTP status for view code to inspect. */
class ViewFileFetchError extends Error {
  readonly path: string;
  readonly status: number;
  constructor(path: string, { status }: { status: number }) {
    super(`readFile(${path}): HTTP ${String(status)}`);
    this.name = "ViewFileFetchError";
    this.path = path;
    this.status = status;
  }
}

/** Generic write/commit failure (4xx/5xx other than a version conflict). */
class ViewFileWriteError extends Error {
  readonly path: string;
  readonly status: number;
  constructor(path: string, { status, detail }: { status: number; detail: string }) {
    super(`write ${path}: HTTP ${String(status)}${detail === "" ? "" : ` — ${detail}`}`);
    this.name = "ViewFileWriteError";
    this.path = path;
    this.status = status;
  }
}

/**
 * The write's version assertion failed: someone changed (or created, or
 * deleted) the file since it was read. `current` is the file's state now
 * (null = it no longer exists) — refresh from it rather than retrying
 * blind.
 */
class ViewFileConflictError extends Error {
  readonly path: string;
  readonly current: ViewFile | null;
  constructor(path: string, { current }: { current: ViewFile | null }) {
    super(`conflict on ${path}: file ${current === null ? "no longer exists" : "changed since it was read"}`);
    this.name = "ViewFileConflictError";
    this.path = path;
    this.current = current;
  }
}

export interface WriteOpts {
  content: string;
  /** The ViewFile this write is based on, or "absent" for create-only. */
  expect?: ViewFile | "absent";
}

export interface ViewFileHelpers {
  /**
   * Call an external provider API through the box's authenticated adapter
   * (server injects the key; the browser never sees it). `pathOrUrl` may
   * be an upstream absolute URL (e.g. a Replicate polling URL) — the
   * origin is stripped and the path routed through the adapter.
   */
  adapterFetch: (adapter: string, opts: { path: string } & RequestInit) => Promise<Response>;
  readFile: (path: string, opts?: { start?: number; end?: number }) => Promise<string>;
  fileUrl: (path: string) => string;
  writeFile: (path: string, opts: WriteOpts) => Promise<ViewFile>;
  appendFile: (path: string, opts: WriteOpts) => Promise<ViewFile>;
  commitFile: (path: string, message: string) => Promise<{ committed: boolean; hash?: string }>;
}

export function useViewFileHelpers(apiBase: string): ViewFileHelpers {
  return useMemo(() => makeHelpers(apiBase), [apiBase]);
}

function makeHelpers(apiBase: string): ViewFileHelpers {
  const fileUrl = (filePath: string): string => `${apiBase}/files/${encodePathForUrl(filePath)}`;

  const adapterFetch = (
    adapter: string,
    { path: pathOrUrl, ...init }: { path: string } & RequestInit
  ): Promise<Response> => {
    const upstreamPath = pathOrUrl.startsWith("http")
      ? new URL(pathOrUrl).pathname + new URL(pathOrUrl).search
      : pathOrUrl;
    const joined = upstreamPath.startsWith("/") ? upstreamPath : `/${upstreamPath}`;
    return fetch(`${apiBase}/adapters/${adapter}${joined}`, init);
  };

  const readFile = async (
    filePath: string,
    opts?: { start?: number; end?: number }
  ): Promise<string> => {
    const headers: Record<string, string> = {};
    if (opts !== undefined && (opts.start !== undefined || opts.end !== undefined)) {
      const start = opts.start ?? 0;
      headers["Range"] = start < 0
        ? `bytes=${start}` // suffix form: last |start| bytes
        : `bytes=${start}-${opts.end !== undefined ? opts.end : ""}`;
    }
    const resp = await fetch(fileUrl(filePath), { headers });
    if (!resp.ok) {
      throw new ViewFileFetchError(filePath, { status: resp.status });
    }
    return resp.text();
  };

  const write = async (
    filePath: string,
    { content, method, expect }: { content: string; method: "PUT" | "POST"; expect?: ViewFile | "absent" }
  ): Promise<ViewFile> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (expect === "absent") headers["If-None-Match"] = "*";
    else if (expect !== undefined) headers["If-Match"] = expect.etag;
    const resp = await fetch(fileUrl(filePath), {
      method,
      headers,
      body: JSON.stringify({ content }),
    });
    if (resp.status === 412) {
      // A malformed conflict body still means the write lost the version race;
      // treat an unparseable `current` as "gone" and refresh from null.
      const parsed = conflictBodySchema.safeParse(await resp.json());
      const current = parsed.success ? parsed.data.current ?? null : null;
      throw new ViewFileConflictError(filePath, { current });
    }
    if (!resp.ok) {
      throw new ViewFileWriteError(filePath, { status: resp.status, detail: await errorDetail(resp) });
    }
    const parsed = writeOkBodySchema.safeParse(await resp.json());
    if (!parsed.success) {
      throw new ViewFileWriteError(filePath, { status: resp.status, detail: `malformed write response: ${parsed.error.message}` });
    }
    return parsed.data.file;
  };

  const commitFile = async (
    filePath: string,
    message: string
  ): Promise<{ committed: boolean; hash?: string }> => {
    const resp = await fetch(`${apiBase}/files-commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: filePath, message }),
    });
    if (!resp.ok) {
      throw new ViewFileWriteError(filePath, { status: resp.status, detail: await errorDetail(resp) });
    }
    const parsed = commitResultSchema.safeParse(await resp.json());
    if (!parsed.success) {
      throw new ViewFileWriteError(filePath, { status: resp.status, detail: `malformed commit response: ${parsed.error.message}` });
    }
    return parsed.data;
  };

  return {
    adapterFetch,
    readFile,
    fileUrl,
    writeFile: (filePath, opts) =>
      write(filePath, { content: opts.content, method: "PUT", ...(opts.expect !== undefined && { expect: opts.expect }) }),
    appendFile: (filePath, opts) =>
      write(filePath, { content: opts.content, method: "POST", ...(opts.expect !== undefined && { expect: opts.expect }) }),
    commitFile,
  };
}

async function errorDetail(resp: Response): Promise<string> {
  try {
    const parsed = errorBodySchema.safeParse(await resp.json());
    return parsed.success && parsed.data.error !== undefined ? parsed.data.error : "";
  } catch (_e) {
    return "";
  }
}
