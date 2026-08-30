/**
 * Shared helpers for route-based doctests.
 *
 * Wraps createTestServer with a doctest-friendly API where
 * inject() returns a plain string ("statusCode\njsonBody")
 * so check() works directly without custom serializers.
 */


import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { execSync } from "node:child_process";
import type { FastifyInstance } from "fastify";
import type { EventBus } from "../../src/core/event-bus.js";
import { createTestServer, TEST_SLUG, type TestServerOptions } from "./test-server.js";

export { TEST_SLUG } from "./test-server.js";

interface InjectOpts {
  method: string;
  url: string;
  payload?: unknown;
  headers?: Record<string, string>;
}

export interface InjectResult {
  statusCode: number;
  body: unknown;
}

export interface RawInjectResult {
  statusCode: number;
  payload: string;
  headers: Record<string, string>;
}

export interface TestServer {
  /** Absolute path to the temp box root. */
  boxRoot: string;
  /**
   * The underlying Fastify instance — for tests that need a REAL listening
   * socket (e.g. exercising a genuine client abort, which `inject` can't model).
   */
  server: FastifyInstance;
  /**
   * The box's event bus — the SAME instance the routes emit on. Subscribe to
   * read a server-minted request id (screenshot / last-audio) the way a real
   * browser tab learns it, instead of correlating on a caller-supplied id.
   */
  eventBus: EventBus;
  /** Inject an HTTP request and return "statusCode\njsonBody" for check(). */
  inject(opts: InjectOpts): Promise<string>;
  /** Inject and return { statusCode, body } for programmatic access. */
  request(opts: InjectOpts): Promise<InjectResult>;
  /** Like request() but without the box slug prefix — for root-level routes. */
  rootRequest(opts: InjectOpts): Promise<InjectResult>;
  /** Inject and return raw { statusCode, payload, headers } — for non-JSON responses. */
  rawRequest(opts: InjectOpts): Promise<RawInjectResult>;
  /** Write a card file into the test box. */
  seed(relativePath: string, content: string): Promise<void>;
  /**
   * Write a view `.tsx` into the box's code directory. For a v2 (package) box
   * that's `<packageRoot>/src/views/`, one level up from the operational box
   * root — where `resolveViewsDir`/`boxCodePaths` look. Doctests use this
   * instead of writing to `boxRoot/views/` so they don't hardcode a layout.
   */
  seedView(relativePath: string, content: string): Promise<void>;
  /** Read a file from the test box. */
  read(relativePath: string): Promise<string>;
  /** Stage all and commit. */
  commitAll(message: string): void;
  /** Close the server and remove the temp directory. */
  cleanup(): Promise<void>;
}

export async function makeTestServer(options?: TestServerOptions): Promise<TestServer> {
  const ctx = await createTestServer(options);
  const BASE = `/${TEST_SLUG}`;

  return {
    boxRoot: ctx.boxRoot,
    server: ctx.server,
    eventBus: ctx.eventBus,
    async inject(opts: InjectOpts) {
      const res = await this.request(opts);
      return `${res.statusCode}\n${JSON.stringify(res.body, null, 2)}`;
    },
    async request(opts: InjectOpts) {
      const reqOpts: {
        method: string;
        url: string;
        payload?: unknown;
        headers?: Record<string, string>;
      } = {
        method: opts.method,
        url: `${BASE}${opts.url}`,
      };
      if (opts.payload !== undefined) {
        reqOpts.payload = opts.payload;
      }
      if (opts.headers !== undefined) {
        reqOpts.headers = opts.headers;
      }
      const res = await ctx.server.inject(reqOpts);
      return { statusCode: res.statusCode, body: res.json() };
    },
    async rawRequest(opts: InjectOpts) {
      const reqOpts: {
        method: string;
        url: string;
        payload?: unknown;
        headers?: Record<string, string>;
      } = {
        method: opts.method,
        url: `${BASE}${opts.url}`,
      };
      if (opts.payload !== undefined) {
        reqOpts.payload = opts.payload;
      }
      if (opts.headers !== undefined) {
        reqOpts.headers = opts.headers;
      }
      const res = await ctx.server.inject(reqOpts);
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(res.headers)) {
        if (value === undefined) continue;
        headers[key] = Array.isArray(value) ? value.join(", ") : String(value);
      }
      return {
        statusCode: res.statusCode,
        payload: res.payload,
        headers,
      };
    },
    async rootRequest(opts: InjectOpts) {
      const reqOpts: {
        method: string;
        url: string;
        payload?: unknown;
        headers?: Record<string, string>;
      } = {
        method: opts.method,
        url: opts.url,
      };
      if (opts.payload !== undefined) {
        reqOpts.payload = opts.payload;
      }
      if (opts.headers !== undefined) {
        reqOpts.headers = opts.headers;
      }
      const res = await ctx.server.inject(reqOpts);
      return { statusCode: res.statusCode, body: res.json() };
    },
    async seed(relativePath: string, content: string) {
      const fullPath = join(ctx.boxRoot, relativePath);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content);
    },
    async seedView(relativePath: string, content: string) {
      const fullPath = join(dirname(ctx.boxRoot), "src/views", relativePath);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content);
    },
    async read(relativePath: string) {
      return readFile(join(ctx.boxRoot, relativePath), "utf-8");
    },
    commitAll(message: string) {
      execSync("git add -A && git commit --allow-empty -m " + JSON.stringify(message), {
        cwd: ctx.boxRoot,
        stdio: "pipe",
      });
    },
    async cleanup() {
      await ctx.cleanup();
    },
  };
}
