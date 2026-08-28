import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";

import { createRouterServer } from "./router.js";
import type { RouterAuthDeps } from "./router-auth.js";
import type { RouterCore } from "./router-core.js";
import type { WorkstreamsAppSupervisor } from "./workstreams-app-supervisor.js";

const unusedAuthDeps: RouterAuthDeps = {
  resolveOwnerSession: () => null,
  resolveTargetBoxRoot: () => null,
  resolveBoxAccessSession: () => null,
  resolveMobileForBox: () => false,
  isAgentBearer: () => false,
  isCsrfSafe: () => false,
  resolveWorktreeAsset: () => false,
  hasBrowseKey: () => false,
};

/** Thrown if the retry route reaches the worktree lifecycle core, which it must not. */
class UnexpectedRouterCoreCallError extends Error {
  constructor(readonly method: string) {
    super(`the workstreams retry route unexpectedly called RouterCore.${method}`);
    this.name = "UnexpectedRouterCoreCallError";
  }
}

/** A RouterCore member that fails the test loudly if the route ever calls it. */
function tripwire(method: string): () => never {
  return () => {
    throw new UnexpectedRouterCoreCallError(method);
  };
}

// This route does not consult the worktree lifecycle core, so every member is a
// tripwire rather than a stub with behavior.
const unusedCore: RouterCore = {
  ensureRunning: tripwire("ensureRunning"),
  stopWorktree: tripwire("stopWorktree"),
  touch: tripwire("touch"),
  getHandle: tripwire("getHandle"),
  entries: tripwire("entries"),
  clearFailed: tripwire("clearFailed"),
  stopAllChildren: tripwire("stopAllChildren"),
};

test("workstreams retry redirects only after startup finishes", async () => {
  let finishRetry: (() => void) | undefined;
  const retryFinished = new Promise<void>((resolve) => { finishRetry = resolve; });
  let markRetryStarted: (() => void) | undefined;
  const retryStarted = new Promise<void>((resolve) => { markRetryStarted = resolve; });
  const supervisor: WorkstreamsAppSupervisor = {
    start: async () => {},
    retry: async () => { markRetryStarted?.(); await retryFinished; },
    requestRestart: () => {},
    state: () => ({ phase: "failed", changedAt: 0, message: "fixture failure" }),
    targetFor: () => null,
    shutdown: async () => {},
  };
  const server = createRouterServer(unusedCore, {
    authDeps: unusedAuthDeps,
    trustedLocal: true,
    workstreamsApp: { supervisor, displayLogPath: "fixture.log" },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");

  const response = new Promise<http.IncomingMessage>((resolve, reject) => {
    const request = http.request({
      host: "127.0.0.1",
      port: address.port,
      path: "/__router/retry/workstreams-app",
      method: "POST",
    }, resolve);
    request.on("error", reject);
    request.end();
  });

  try {
    await retryStarted;
    const early = await Promise.race([
      response.then(() => "response" as const),
      new Promise<"waiting">((resolve) => setTimeout(() => resolve("waiting"), 100)),
    ]);
    assert.equal(early, "waiting");
    finishRetry?.();
    const result = await response;
    assert.equal(result.statusCode, 303);
    assert.equal(result.headers.location, "/workstreams/");
  } finally {
    finishRetry?.();
    await response;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
