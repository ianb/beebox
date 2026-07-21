// The router injects the trusted `x-cb-base-prefix` header on requests it
// proxies to a worktree, and strips any client-supplied copy first (a client
// must never set it). This exercises the pure helper the router calls
// (callback-box/src/webapp/base-prefix.ts) over a plain IncomingHttpHeaders bag
// — no server spawn. Run with:
//   node --import tsx --test bin/base-prefix-injection.test.ts
// (or `pnpm test` at the repo root, which runs every bin/*.test.ts this way).

import assert from "node:assert/strict";
import { test } from "node:test";
import type { IncomingHttpHeaders } from "node:http";
import {
  injectBasePrefix,
  readBasePrefix,
  BASE_PREFIX_HEADER,
} from "../callback-box/src/webapp/base-prefix.js";

test("router injects the worktree prefix as the base-prefix header", () => {
  const headers: IncomingHttpHeaders = { host: "localhost:3210" };
  injectBasePrefix(headers, "/my-worktree");
  assert.equal(headers[BASE_PREFIX_HEADER], "/my-worktree");
  assert.equal(readBasePrefix(headers), "/my-worktree");
});

test("injection strips a client-supplied copy before setting the trusted value", () => {
  // A client tries to smuggle its own prefix; the router must overwrite it, not
  // append a second value the backend might read.
  const headers: IncomingHttpHeaders = { [BASE_PREFIX_HEADER]: "/evil" };
  injectBasePrefix(headers, "/main");
  assert.equal(headers[BASE_PREFIX_HEADER], "/main");
  assert.equal(readBasePrefix(headers), "/main");
});

test("injection strips a client copy under any header casing", () => {
  // Node lowercases incoming header keys, but guard the case-insensitive strip
  // directly so a mixed-case smuggled copy can never survive alongside ours.
  const headers: IncomingHttpHeaders = {};
  headers["X-CB-Base-Prefix"] = "/evil";
  injectBasePrefix(headers, "/main");
  // Only the trusted lowercase key remains; the smuggled mixed-case one is gone.
  assert.equal(headers[BASE_PREFIX_HEADER], "/main");
  assert.equal(headers["X-CB-Base-Prefix"], undefined);
  assert.equal(readBasePrefix(headers), "/main");
});
