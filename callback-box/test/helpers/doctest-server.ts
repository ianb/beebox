/**
 * Shared helpers for route-based doctests.
 *
 * Wraps createTestServer with a doctest-friendly API where
 * inject() returns a plain string ("statusCode\njsonBody")
 * so check() works directly without custom serializers.
 */

/* eslint-disable security/detect-non-literal-fs-filename */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { execSync } from "node:child_process";
import { createTestServer, TEST_SLUG } from "./test-server.js";

export { TEST_SLUG } from "./test-server.js";

interface InjectOpts {
  method: string;
  url: string;
  payload?: unknown;
}

export interface InjectResult {
  statusCode: number;
  body: unknown;
}

export interface TestServer {
  /** Absolute path to the temp box root. */
  boxRoot: string;
  /** Inject an HTTP request and return "statusCode\njsonBody" for check(). */
  inject(opts: InjectOpts): Promise<string>;
  /** Inject and return { statusCode, body } for programmatic access. */
  request(opts: InjectOpts): Promise<InjectResult>;
  /** Write a card file into the test box. */
  seed(relativePath: string, content: string): Promise<void>;
  /** Read a file from the test box. */
  read(relativePath: string): Promise<string>;
  /** Stage all and commit. */
  commitAll(message: string): void;
  /** Close the server and remove the temp directory. */
  cleanup(): Promise<void>;
}

export async function makeTestServer(): Promise<TestServer> {
  const ctx = await createTestServer();
  const BASE = `/${TEST_SLUG}`;

  return {
    boxRoot: ctx.boxRoot,
    async inject(opts: InjectOpts) {
      const res = await this.request(opts);
      return `${res.statusCode}\n${JSON.stringify(res.body, null, 2)}`;
    },
    async request(opts: InjectOpts) {
      const reqOpts: { method: string; url: string; payload?: unknown } = {
        method: opts.method,
        url: `${BASE}${opts.url}`,
      };
      if (opts.payload !== undefined) {
        reqOpts.payload = opts.payload;
      }
      const res = await ctx.server.inject(reqOpts);
      return { statusCode: res.statusCode, body: res.json() };
    },
    async seed(relativePath: string, content: string) {
      const fullPath = join(ctx.boxRoot, relativePath);
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
