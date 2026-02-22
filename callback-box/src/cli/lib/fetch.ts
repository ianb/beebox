/**
 * Stubbable fetch wrapper for scenario testing.
 *
 * Stubs can be loaded two ways:
 * 1. In-process via loadFetchStubs() (used by scenario runner parent)
 * 2. Via CB_STUBS_FILE env var pointing to a stubs.yaml file (used by
 *    child processes spawned during scenario runs)
 *
 * Strict mode (CB_STRICT_FETCH=1): monkey-patches globalThis.fetch so that
 * ALL fetch calls must match a stub or an allow-listed URL, otherwise they
 * throw an error. This catches connectors that use raw fetch() instead of
 * boxFetch().
 */

import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { parseDuration } from "../../schemas/scheduled-script.js";

export interface FetchStub {
  /** URL pattern — exact match, or prefix match if ends with * */
  pattern: string;
  /** Path to response file, relative to scenario directory */
  responseFile: string;
  /** HTTP status code (default 200) */
  status?: number | undefined;
  /** Content-Type header (inferred from extension if omitted) */
  contentType?: string | undefined;
  /** Duration from scenario start time after which this stub becomes active */
  after?: string | undefined;
}

let stubs: FetchStub[] | null = null;
let scenarioDir: string | null = null;
let envStubsLoaded = false;
let originalFetch: typeof globalThis.fetch | null = null;

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
 * Restore the original globalThis.fetch if it was patched.
 */
export function uninstallStrictFetch(): void {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
    originalFetch = null;
  }
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
    const parsed = parseYaml(content) as { http?: Array<{ pattern: string; response_file: string; status?: number; content_type?: string; after?: string }> };
    if (parsed?.http && parsed.http.length > 0) {
      scenarioDir = path.dirname(stubsFile);
      stubs = parsed.http.map((h) => ({
        pattern: h.pattern,
        responseFile: h.response_file,
        ...(h.status != null && { status: h.status }),
        ...(h.content_type && { contentType: h.content_type }),
        ...(h.after && { after: h.after }),
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

/** URLs that are always allowed without a stub in strict mode */
function isAllowListed(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

/**
 * Check if a stub's `after` constraint is satisfied.
 * Returns true if there is no `after`, or if enough time has elapsed.
 */
function isAfterSatisfied(stub: FetchStub): boolean {
  if (!stub.after) return true;

  const startTimeStr = process.env.CB_SCENARIO_START_TIME;
  const currentTimeStr = process.env.CB_TIME;
  if (!startTimeStr || !currentTimeStr) return true;

  const startTime = new Date(startTimeStr).getTime();
  const currentTime = new Date(currentTimeStr).getTime();
  const afterMs = parseDuration(stub.after);

  return currentTime >= startTime + afterMs;
}

/**
 * Find the matching stub for a URL, respecting time-gated `after` constraints.
 *
 * When multiple stubs match the same URL, the last one whose `after` constraint
 * is satisfied wins. This means later stubs override earlier ones when their
 * time arrives.
 */
function findMatchingStub(url: string): FetchStub | null {
  if (!stubs) return null;

  let bestMatch: FetchStub | null = null;
  for (const stub of stubs) {
    if (matchesPattern(url, stub.pattern) && isAfterSatisfied(stub)) {
      bestMatch = stub;
    }
  }
  return bestMatch;
}

/**
 * Build a Response from a matched stub.
 */
async function buildStubResponse(stub: FetchStub): Promise<Response> {
  const filePath = path.resolve(scenarioDir!, stub.responseFile);
  const body = await fs.readFile(filePath);
  const contentType = stub.contentType ?? inferContentType(filePath);
  const status = stub.status ?? 200;

  return new Response(body, {
    status,
    headers: { "Content-Type": contentType },
  });
}

/**
 * Install strict fetch mode — monkey-patches globalThis.fetch so all
 * fetch calls must match a stub or be allow-listed.
 *
 * Call this early in CLI bootstrap when CB_STRICT_FETCH is set.
 */
export function installStrictFetch(): void {
  if (originalFetch) return; // Already installed

  originalFetch = globalThis.fetch;

  globalThis.fetch = async function strictFetch(
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    ensureEnvStubs();

    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (stubs && scenarioDir) {
      const stub = findMatchingStub(url);
      if (stub) {
        return buildStubResponse(stub);
      }
    }

    // Allow-listed URLs pass through to real fetch
    if (isAllowListed(url)) {
      return originalFetch!(input, init);
    }

    // Strict mode: no stub matched and not allow-listed
    throw new Error(`Unstubbed fetch in scenario: ${url}`);
  };
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

  const stub = findMatchingStub(url);
  if (stub) {
    return buildStubResponse(stub);
  }

  // No stub matched — fall through to real fetch
  return fetch(input, init);
}
