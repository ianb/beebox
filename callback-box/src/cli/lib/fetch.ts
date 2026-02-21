/**
 * Stubbable fetch wrapper for scenario testing.
 *
 * Stubs can be loaded two ways:
 * 1. In-process via loadFetchStubs() (used by scenario runner parent)
 * 2. Via CB_STUBS_FILE env var pointing to a stubs.yaml file (used by
 *    child processes spawned during scenario runs)
 *
 * When no stubs are active, all requests pass through to real fetch().
 */

import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";

export interface FetchStub {
  /** URL pattern — exact match, or prefix match if ends with * */
  pattern: string;
  /** Path to response file, relative to scenario directory */
  responseFile: string;
  /** HTTP status code (default 200) */
  status?: number | undefined;
  /** Content-Type header (inferred from extension if omitted) */
  contentType?: string | undefined;
}

let stubs: FetchStub[] | null = null;
let scenarioDir: string | null = null;
let envStubsLoaded = false;

/**
 * Load fetch stubs for a scenario run (in-process).
 */
export function loadFetchStubs(dir: string, stubDefs: FetchStub[]): void {
  scenarioDir = dir;
  stubs = stubDefs;
}

/**
 * Clear all fetch stubs (restore normal fetch behavior).
 */
export function clearFetchStubs(): void {
  stubs = null;
  scenarioDir = null;
}

/**
 * Lazily load stubs from CB_STUBS_FILE env var (for child processes).
 */
function ensureEnvStubs(): void {
  if (envStubsLoaded) return;
  envStubsLoaded = true;

  const stubsFile = process.env.CB_STUBS_FILE;
  if (!stubsFile || stubs) return;

  try {
    const content = fsSync.readFileSync(stubsFile, "utf-8");
    const parsed = parseYaml(content) as { http?: Array<{ pattern: string; response_file: string; status?: number; content_type?: string }> };
    if (parsed?.http && parsed.http.length > 0) {
      scenarioDir = path.dirname(stubsFile);
      stubs = parsed.http.map((h) => ({
        pattern: h.pattern,
        responseFile: h.response_file,
        status: h.status,
        contentType: h.content_type,
      }));
    }
  } catch {
    // File doesn't exist or parse error — no stubs
  }
}

function matchesPattern(url: string, pattern: string): boolean {
  if (pattern.endsWith("*")) {
    return url.startsWith(pattern.slice(0, -1));
  }
  return url === pattern;
}

function inferContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".xml":
    case ".rss":
    case ".atom":
      return "application/xml";
    case ".json":
      return "application/json";
    case ".html":
      return "text/html";
    case ".txt":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}

/**
 * Drop-in replacement for fetch() that checks stubs first.
 *
 * When no stubs are loaded, this is a pure passthrough to global fetch().
 */
export async function boxFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  ensureEnvStubs();

  if (!stubs || !scenarioDir) {
    return fetch(input, init);
  }

  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

  for (const stub of stubs) {
    if (matchesPattern(url, stub.pattern)) {
      const filePath = path.resolve(scenarioDir, stub.responseFile);
      const body = await fs.readFile(filePath);
      const contentType = stub.contentType ?? inferContentType(filePath);
      const status = stub.status ?? 200;

      return new Response(body, {
        status,
        headers: { "Content-Type": contentType },
      });
    }
  }

  // No stub matched — fall through to real fetch
  return fetch(input, init);
}
