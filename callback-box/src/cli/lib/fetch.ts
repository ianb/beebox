/**
 * Stubbable fetch wrapper for scenario testing.
 *
 * When stubs are loaded (via scenario runner), URL requests are matched
 * against stub patterns and served from local files. When no stubs are
 * loaded, all requests pass through to real fetch().
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

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

/**
 * Load fetch stubs for a scenario run.
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
