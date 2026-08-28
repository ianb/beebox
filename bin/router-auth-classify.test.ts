// Route-shape tests for the dev router's URL classifier (`classifyRouterRoute`
// in bin/router-auth.ts) — Track B, chunk 1 of
// callback-box/docs/implemented-plans/expose-dev-router.md. Classification is
// pure over method + url, so these need none of the credential fakes the
// authorization truth table in bin/router-auth.test.ts uses; they were split out
// of that file to keep both under the file-length limit.
//
// Run with:
//   node --import tsx --test bin/router-auth-classify.test.ts
// (or `pnpm test` at the repo root, which runs every bin/*.test.ts this way).

import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyRouterRoute } from "./router-auth.js";

// --- classifier ---------------------------------------------------------------

test("classifier: exhaustive route-shape mapping", () => {
  const c = (method: string, url: string) => classifyRouterRoute({ method, url });

  // unauth-allowlist
  assert.deepEqual(c("GET", "/main/auth/login"), { kind: "unauth-allowlist" });
  assert.deepEqual(c("POST", "/main/auth/login"), { kind: "unauth-allowlist" });
  assert.deepEqual(c("GET", "/main/auth/setup"), { kind: "unauth-allowlist" });
  assert.deepEqual(c("GET", "/main/auth/me"), { kind: "unauth-allowlist" });
  assert.deepEqual(c("GET", "/main/assets/index-abc.js"), { kind: "unauth-allowlist" });
  assert.deepEqual(c("GET", "/main/icons/icon.svg"), { kind: "unauth-allowlist" });
  assert.deepEqual(c("GET", "/main/manifest.webmanifest"), { kind: "unauth-allowlist" });
  assert.deepEqual(c("GET", "/main/sw.js"), { kind: "unauth-allowlist" });
  assert.deepEqual(c("GET", "/favicon.png"), { kind: "unauth-allowlist" });
  assert.deepEqual(c("POST", "/main/test1/api/pairing/redeem"), { kind: "unauth-allowlist" });
  assert.deepEqual(c("POST", "/api/pairing/redeem"), { kind: "unauth-allowlist" });

  // control (mutating)
  assert.deepEqual(c("POST", "/__router/stop/main"), { kind: "control" });
  assert.deepEqual(c("POST", "/__router/retry/main"), { kind: "control" });
  assert.deepEqual(c("GET", "/__router/dashboard/main"), { kind: "control" });

  // control-read
  assert.deepEqual(c("GET", "/__router/status"), { kind: "control-read", json: true });
  assert.deepEqual(c("GET", "/__router/status/"), { kind: "control-read", json: true });
  assert.deepEqual(c("GET", "/"), { kind: "control-read", json: false });
  // Non-read verbs on the dev space stay owner-only (the handler has no write
  // path; keeping them out of `dev-read` grants the browse key nothing extra).
  assert.deepEqual(c("POST", "/main/dev/x.html"), { kind: "control-read", json: false });
  assert.deepEqual(c("POST", "/dev/"), { kind: "control-read", json: false });

  // dev-read
  assert.deepEqual(c("GET", "/main/dev/"), { kind: "dev-read" });
  assert.deepEqual(c("GET", "/main/dev/docs/x.md"), { kind: "dev-read" });
  assert.deepEqual(c("HEAD", "/main/dev/skills.html"), { kind: "dev-read" });
  assert.deepEqual(c("GET", "/dev"), { kind: "dev-read" });
  assert.deepEqual(c("GET", "/dev/"), { kind: "dev-read" });
  assert.deepEqual(c("GET", "/main/dev"), { kind: "dev-read" });
  assert.deepEqual(c("GET", "/workstreams/"), { kind: "dev-read" });
  assert.deepEqual(c("HEAD", "/workstreams/testing/"), { kind: "dev-read" });
  assert.deepEqual(c("GET", "/workstreams/browse?file=README.md"), { kind: "dev-read" });
  assert.deepEqual(c("GET", "/workstreams/api/trpc/documents.read"), { kind: "dev-read" });
  assert.deepEqual(c("POST", "/workstreams/action/resume/seam"), { kind: "control" });

  // box
  assert.deepEqual(c("GET", "/main/test1/"), { kind: "box", targetWorktree: "main", targetBox: "test1" });
  assert.deepEqual(c("GET", "/main/test1/browse/x"), { kind: "box", targetWorktree: "main", targetBox: "test1" });
  assert.deepEqual(c("GET", "/main/api/boxes"), { kind: "worktree-box-list", targetWorktree: "main" });
  assert.deepEqual(c("GET", "/main"), { kind: "box", targetWorktree: "main", targetBox: null });
  assert.deepEqual(c("GET", "/main/"), { kind: "box", targetWorktree: "main", targetBox: null });

  // worktree-asset — Vite-served dev assets (GET), reachable by any box credential.
  assert.deepEqual(c("GET", "/main/@vite/client"), { kind: "worktree-asset", targetWorktree: "main" });
  assert.deepEqual(c("GET", "/main/@react-refresh"), { kind: "worktree-asset", targetWorktree: "main" });
  assert.deepEqual(c("GET", "/main/@fs/abs/path.ts"), { kind: "worktree-asset", targetWorktree: "main" });
  assert.deepEqual(c("GET", "/main/@id/x"), { kind: "worktree-asset", targetWorktree: "main" });
  assert.deepEqual(c("GET", "/main/src/main.tsx"), { kind: "worktree-asset", targetWorktree: "main" });
  assert.deepEqual(c("GET", "/main/node_modules/.vite/deps/x.js"), { kind: "worktree-asset", targetWorktree: "main" });
  // A non-GET to a dev-asset path is NOT a worktree-asset (falls to the box ladder).
  assert.deepEqual(c("POST", "/main/src/x"), { kind: "box", targetWorktree: "main", targetBox: "src" });

  // unknown
  assert.deepEqual(c("GET", "/__router/bogus"), { kind: "unknown" });
  assert.deepEqual(c("GET", "/workstreamsx"), { kind: "box", targetWorktree: "workstreamsx", targetBox: null });
  assert.deepEqual(c("GET", "//"), { kind: "unknown" }); // no parseable first segment

  // pairing redeem is unauth ONLY for POST — a GET to the same path is a box request.
  assert.deepEqual(c("GET", "/main/test1/api/pairing/redeem"), {
    kind: "box",
    targetWorktree: "main",
    targetBox: "test1",
  });

  // scan-upload surface — forwarded on exact shape + contract verb; the hub's
  // scan gate and the box child verify the bearer. Everything off-shape or
  // off-verb falls to the normal box wall.
  const sha = "a".repeat(64);
  assert.deepEqual(c("POST", "/main/test1/api/scan/check"), { kind: "unauth-allowlist" });
  assert.deepEqual(c("PUT", `/main/test1/api/scan/files/${sha}`), { kind: "unauth-allowlist" });
  assert.deepEqual(c("GET", "/main/test1/api/scan/check"), {
    kind: "box",
    targetWorktree: "main",
    targetBox: "test1",
  });
  assert.deepEqual(c("PUT", "/main/test1/api/scan/check"), {
    kind: "box",
    targetWorktree: "main",
    targetBox: "test1",
  });
  assert.deepEqual(c("POST", `/main/test1/api/scan/files/${sha}`), {
    kind: "box",
    targetWorktree: "main",
    targetBox: "test1",
  });
  assert.deepEqual(c("PUT", "/main/test1/api/scan/files/not-a-hash"), {
    kind: "box",
    targetWorktree: "main",
    targetBox: "test1",
  });
  assert.deepEqual(c("POST", "/main/test1/api/scan/check/extra"), {
    kind: "box",
    targetWorktree: "main",
    targetBox: "test1",
  });
  assert.deepEqual(c("POST", `/main/test1/api/scan/files/${sha.toUpperCase()}`), {
    kind: "box",
    targetWorktree: "main",
    targetBox: "test1",
  });
});

test("classifier: a raw `#` in the request target is rejected, whatever it precedes", () => {
  // The gate strips a fragment; bin/router.ts's dispatch branches do not. Any
  // such disagreement is a bypass, so a `#`-bearing target is `unknown` (404)
  // for EVERY route class, not just the dev surfaces.
  const c = (method: string, url: string) => classifyRouterRoute({ method, url });
  for (const url of ["/main/dev#x", "/dev#x", "/workstreams#x", "/main/test1/#x", "/#x", "/__router/status#x"]) {
    assert.deepEqual(c("GET", url), { kind: "unknown" }, url);
  }
  // A percent-encoded `#` is a legal path byte and is NOT a fragment — neither
  // the gate nor the dispatcher decodes before matching, so it stays a box path.
  assert.deepEqual(c("GET", "/main/test1/a%23b"), { kind: "box", targetWorktree: "main", targetBox: "test1" });
});

test("classifier: query string does not change classification", () => {
  assert.deepEqual(classifyRouterRoute({ method: "GET", url: "/__router/status?x=1" }), {
    kind: "control-read",
    json: true,
  });
  assert.deepEqual(classifyRouterRoute({ method: "GET", url: "/main/test1/browse?view=foo" }), {
    kind: "box",
    targetWorktree: "main",
    targetBox: "test1",
  });
});

