/**
 * Shared helpers for route-based tests.
 *
 * Wraps createTestServer with a test-friendly API where
 * inject() returns a plain string ("statusCode\njsonBody")
 * so check() works directly without custom serializers.
 */


import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { execSync } from "node:child_process";
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from "fastify";
import type { EventBus } from "../../src/core/event-bus/core.js";
import { createTestServer, TEST_SLUG, type TestServerOptions } from "./test-server.js";

export { TEST_SLUG } from "./test-server.js";

interface InjectOpts {
  method: NonNullable<InjectOptions["method"]>;
  url: string;
  payload?: InjectOptions["payload"];
  headers?: Record<string, string>;
}

/** Fastify inject options for a request at `url`, leaving unset fields absent. */
function injectOptions(opts: InjectOpts, url: string): InjectOptions {
  return {
    method: opts.method,
    url,
    ...(opts.payload === undefined ? {} : { payload: opts.payload }),
    ...(opts.headers === undefined ? {} : { headers: opts.headers }),
  };
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

/**
 * A whole HTTP response as one value for `t.check`: status, headers, and
 * body. The body is parsed JSON when the response says JSON, else the text.
 */
export interface ObservedResponse<B = unknown> {
  status: number;
  headers: Record<string, string>;
  body: B;
}

/** Options for `TestServer.response`. */
export interface ResponseOptions {
  /** Request the URL as given, without the box slug prefix. */
  root?: boolean;
}

function observe(res: LightMyRequestResponse): ObservedResponse {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(res.headers)) {
    if (value === undefined) continue;
    headers[key] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  const isJson = (headers["content-type"] ?? "").includes("json");
  const body: unknown = isJson && res.payload !== "" ? res.json() : res.payload;
  return { status: res.statusCode, headers, body };
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
  /**
   * Inject and return the whole response, `{ status, headers, body }`, for
   * `t.check`. The body is untyped: route handlers declare no response types.
   */
  response(opts: InjectOpts, options?: ResponseOptions): Promise<ObservedResponse>;
  /** Write a card file into the test box. */
  seed(relativePath: string, content: string): Promise<void>;
  /**
   * Write a view `.tsx` into the box's code directory (`<boxRoot>/src/views/`,
   * where `resolveViewsDir`/`boxCodePaths` look). Tests use this instead of
   * a hand-joined path so they don't hardcode a layout.
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

  const server: TestServer = {
    boxRoot: ctx.boxRoot,
    server: ctx.server,
    eventBus: ctx.eventBus,
    async inject(opts: InjectOpts) {
      const res = await this.request(opts);
      return `${res.statusCode}\n${JSON.stringify(res.body, null, 2)}`;
    },
    async request(opts: InjectOpts) {
      const res = await ctx.server.inject(injectOptions(opts, `${BASE}${opts.url}`));
      return { statusCode: res.statusCode, body: res.json() };
    },
    async rawRequest(opts: InjectOpts) {
      const res = await ctx.server.inject(injectOptions(opts, `${BASE}${opts.url}`));
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
    async response(opts: InjectOpts, responseOptions?: ResponseOptions) {
      const url = responseOptions?.root === true ? opts.url : `${BASE}${opts.url}`;
      return observe(await ctx.server.inject(injectOptions(opts, url)));
    },
    async rootRequest(opts: InjectOpts) {
      const res = await ctx.server.inject(injectOptions(opts, opts.url));
      return { statusCode: res.statusCode, body: res.json() };
    },
    async seed(relativePath: string, content: string) {
      const fullPath = join(ctx.boxRoot, relativePath);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content);
    },
    async seedView(relativePath: string, content: string) {
      const fullPath = join(ctx.boxRoot, "src/views", relativePath);
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
  return server;
}
