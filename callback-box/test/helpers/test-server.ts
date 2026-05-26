/**
 * Shared test helper for API route tests.
 *
 * Creates a temporary box with git initialized, boots a Fastify server
 * via createServer(), and returns { server, boxRoot, cleanup }.
 *
 * Usage:
 *   const ctx = await createTestServer();
 *   try {
 *     const res = await ctx.server.inject({ method: "GET", url: "/test/api/status" });
 *     t.equal(res.statusCode, 200);
 *   } finally {
 *     await ctx.cleanup();
 *   }
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import type { FastifyInstance } from "fastify";
import { initBox } from "../../src/core/box.js";
import { createServer } from "../../src/webapp/server.js";
import type { Services } from "../../src/services/index.js";

export const TEST_SLUG = "test";

export interface TestServerContext {
  server: FastifyInstance;
  boxRoot: string;
  cleanup: () => Promise<void>;
}

export interface TestServerOptions {
  services?: Services;
}

export async function createTestServer(opts?: TestServerOptions): Promise<TestServerContext> {
  const tmpDir = await mkdtemp(join(tmpdir(), "cb-route-test-"));

  // Initialize box with git
  await initBox(tmpDir);

  // Create an initial commit so the box has history (matches makeTmpBox behavior)
  execSync("git add -A && git commit --allow-empty -m init -q", {
    cwd: tmpDir,
    stdio: "pipe",
  });

  // Create server pointing at this temp box
  const server = await createServer({
    boxes: [{ slug: TEST_SLUG, boxRoot: tmpDir }],
    services: opts?.services,
  });

  return {
    server,
    boxRoot: tmpDir,
    cleanup: async () => {
      await server.close();
      await rm(tmpDir, { recursive: true, force: true });
    },
  };
}

/**
 * Write a card file into the test box at the given relative path.
 * Creates parent directories as needed.
 */
export async function seedCard(opts: { boxRoot: string; relativePath: string; content: string }): Promise<void> {
  const fullPath = join(opts.boxRoot, opts.relativePath);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await mkdir(dirname(fullPath), { recursive: true });
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await writeFile(fullPath, opts.content);
}

/**
 * Stage all and commit in the test box.
 */
export async function commitAll(boxRoot: string, message: string): Promise<void> {
  execSync("git add -A && git commit --allow-empty -m " + JSON.stringify(message), {
    cwd: boxRoot,
    stdio: "pipe",
  });
}
