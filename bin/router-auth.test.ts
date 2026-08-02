// Truth-table tests for the dev router's pure authorization core
// (bin/router-auth.ts) — Track B, chunk 1 of
// callback-box/docs/implemented-plans/expose-dev-router.md. Every "planned" row of the
// plan's Failure-modes table that maps to the pure gate is a non-vacuous
// assertion here, driven by injected fakes (no I/O, no server).
//
// Run with:
//   node --import tsx --test bin/router-auth.test.ts
// (or `pnpm test` at the repo root, which runs every bin/*.test.ts this way).
//
// NON-VACUITY: each allow test would flip to a deny if the matching guard were
// neutered, and vice versa — the fakes are set to the exact credential state the
// row names, never a blanket allow-all.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  authorizeRouterRequest,
  classifyRouterRoute,
  type RouterAuthDeps,
  type RouterAuthInput,
  type RouterHeaders,
  type BoxTarget,
} from "./router-auth.js";

// --- fake deps ----------------------------------------------------------------
// Default: deny everything (no owner, no box resolvable, no mobile/agent/csrf).
// Each test overrides only the seam the scenario exercises.

interface FakeConfig {
  owner: { email: string } | null;
  /** slug→root map; a missing/duplicate key resolves null (fail closed). */
  boxRoots: Record<string, string | null>;
  /** boxRoot → whether a valid box-access session is present. */
  boxAccess: Record<string, { email: string } | null>;
  /** boxRoot → whether valid per-box mobile auth is present. */
  mobile: Record<string, boolean>;
  agentBearer: boolean;
  csrfSafe: boolean;
  /** worktree → whether any valid box credential (session/mobile) is present. */
  worktreeAsset: Record<string, boolean>;
}

function makeDeps(overrides: Partial<FakeConfig>): RouterAuthDeps {
  const cfg: FakeConfig = {
    owner: null,
    boxRoots: {},
    boxAccess: {},
    mobile: {},
    agentBearer: false,
    csrfSafe: false,
    worktreeAsset: {},
    ...overrides,
  };
  const keyFor = (target: BoxTarget): string => `${target.targetWorktree}/${target.targetBox ?? "<root>"}`;
  return {
    resolveOwnerSession: () => cfg.owner,
    resolveTargetBoxRoot: (target) => {
      const k = keyFor(target);
      return k in cfg.boxRoots ? cfg.boxRoots[k]! : null;
    },
    resolveBoxAccessSession: (_headers, boxRoot) => cfg.boxAccess[boxRoot] ?? null,
    resolveMobileForBox: (_headers, boxRoot) => cfg.mobile[boxRoot] ?? false,
    isAgentBearer: () => cfg.agentBearer,
    isCsrfSafe: () => cfg.csrfSafe,
    resolveWorktreeAsset: (_headers, worktree) => cfg.worktreeAsset[worktree] ?? false,
  };
}

const HTML: RouterHeaders = { accept: "text/html,application/xhtml+xml" };
const JSON_ACCEPT: RouterHeaders = { accept: "application/json" };

function req(partial: Partial<RouterAuthInput>): RouterAuthInput {
  return { trustedLocal: false, method: "GET", url: "/", headers: {}, ...partial };
}

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
  assert.deepEqual(c("GET", "/main/dev/"), { kind: "control-read", json: false });
  assert.deepEqual(c("GET", "/main/dev/docs/x.md"), { kind: "control-read", json: false });
  assert.deepEqual(c("GET", "/dev/"), { kind: "control-read", json: false });

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

// --- UDS: trusted-local allows everything ------------------------------------

test("UDS trusted-local: allows every route class, including unknown and control", async () => {
  const deps = makeDeps({}); // all-deny fakes; trustedLocal must bypass them
  for (const url of ["/__router/stop/main", "/main/test1/", "/", "/__router/bogus", "/main/api/boxes"]) {
    const method = url.includes("stop") ? "POST" : "GET";
    const d = await authorizeRouterRequest(req({ trustedLocal: true, method, url }), deps);
    assert.equal(d.allow, true, `UDS should allow ${url}`);
  }
});

// --- unauth allowlist over TCP -----------------------------------------------

test("TCP unauth-allowlist: login page and pairing-redeem allowed with no credentials", async () => {
  const deps = makeDeps({});
  const login = await authorizeRouterRequest(
    req({ method: "GET", url: "/main/auth/login", headers: HTML }),
    deps,
  );
  assert.equal(login.allow, true, "login page is reachable unauthenticated");

  const redeem = await authorizeRouterRequest(
    req({ method: "POST", url: "/main/test1/api/pairing/redeem", headers: JSON_ACCEPT }),
    deps,
  );
  assert.equal(redeem.allow, true, "pairing-redeem POST is the pre-auth bootstrap");
});

// --- control (mutating) ------------------------------------------------------

test("TCP control mutating: owner + CSRF-ok → allow", async () => {
  const deps = makeDeps({ owner: { email: "boxholder@example.com" }, csrfSafe: true });
  const d = await authorizeRouterRequest(req({ method: "POST", url: "/__router/stop/main" }), deps);
  assert.equal(d.allow, true);
});

test("TCP control mutating: owner but CSRF-fail → 403, no redirect", async () => {
  const deps = makeDeps({ owner: { email: "boxholder@example.com" }, csrfSafe: false });
  const d = await authorizeRouterRequest(req({ method: "POST", url: "/__router/stop/main" }), deps);
  assert.equal(d.allow, false);
  assert.equal(d.allow === false && d.status, 403);
  assert.equal(d.allow === false && d.reason, "csrf-check-failed");
  assert.equal(d.allow === false && d.redirectToLogin, false);
});

test("TCP control mutating: non-owner / no session → 401 (CSRF never consulted)", async () => {
  let csrfConsulted = false;
  const deps: RouterAuthDeps = {
    ...makeDeps({ owner: null, csrfSafe: true }),
    isCsrfSafe: () => {
      csrfConsulted = true;
      return true;
    },
  };
  const d = await authorizeRouterRequest(req({ method: "POST", url: "/__router/stop/main" }), deps);
  assert.equal(d.allow, false);
  assert.equal(d.allow === false && d.status, 401);
  assert.equal(d.allow === false && d.reason, "owner-session-required");
  assert.equal(csrfConsulted, false, "owner is checked before (and short-circuits) CSRF");
});

test("TCP control mutating: revoked session (resolveOwnerSession → null) → 401", async () => {
  // The gen-aware resolver returns null for a revoked/stale session; the gate
  // treats that identically to no session.
  const deps = makeDeps({ owner: null, csrfSafe: true });
  const d = await authorizeRouterRequest(req({ method: "POST", url: "/__router/retry/main" }), deps);
  assert.equal(d.allow === false && d.status, 401);
});

// --- control-read ------------------------------------------------------------

test("TCP control-read: owner → allow (status JSON and dev browser)", async () => {
  const deps = makeDeps({ owner: { email: "boxholder@example.com" } });
  const status = await authorizeRouterRequest(req({ method: "GET", url: "/__router/status" }), deps);
  assert.equal(status.allow, true);
  const dev = await authorizeRouterRequest(req({ method: "GET", url: "/main/dev/", headers: HTML }), deps);
  assert.equal(dev.allow, true);
});

test("TCP control-read status: no owner → 401 JSON, NO redirect even for a browser navigation", async () => {
  const deps = makeDeps({ owner: null });
  const d = await authorizeRouterRequest(req({ method: "GET", url: "/__router/status", headers: HTML }), deps);
  assert.equal(d.allow, false);
  assert.equal(d.allow === false && d.status, 401);
  assert.equal(d.allow === false && d.redirectToLogin, false, "the machine endpoint never redirects");
});

test("TCP control-read infra pages: no owner → 401, redirect a navigation to login", async () => {
  const deps = makeDeps({ owner: null });
  const nav = await authorizeRouterRequest(req({ method: "GET", url: "/", headers: HTML }), deps);
  assert.equal(nav.allow === false && nav.status, 401);
  assert.equal(nav.allow === false && nav.redirectToLogin, true, "a browser navigation redirects to login");

  const api = await authorizeRouterRequest(req({ method: "GET", url: "/", headers: JSON_ACCEPT }), deps);
  assert.equal(api.allow === false && api.redirectToLogin, false, "a non-HTML client does not redirect");
});

// --- box routes --------------------------------------------------------------

const ROOT = "/box-worktrees/main/test1";
const OTHER = "/box-worktrees/main/other";

function boxDeps(overrides: Partial<FakeConfig>): RouterAuthDeps {
  return makeDeps({ boxRoots: { "main/test1": ROOT, "main/other": OTHER }, ...overrides });
}

test("TCP box: valid per-box mobile for the target box → allow", async () => {
  const deps = boxDeps({ mobile: { [ROOT]: true } });
  const d = await authorizeRouterRequest(
    req({ method: "GET", url: "/main/test1/", headers: { authorization: "Bearer devtoken" } }),
    deps,
  );
  assert.equal(d.allow, true);
});

test("TCP box: mobile token valid for OTHER box only, no session → 401", async () => {
  // Token authenticates against /other, but the request targets /test1.
  const deps = boxDeps({ mobile: { [OTHER]: true } });
  const d = await authorizeRouterRequest(
    req({ method: "GET", url: "/main/test1/api/status", headers: JSON_ACCEPT }),
    deps,
  );
  assert.equal(d.allow, false);
  assert.equal(d.allow === false && d.status, 401);
  assert.equal(d.allow === false && d.reason, "box-auth-required");
});

test("TCP box: box-access session for the target box → allow", async () => {
  const deps = boxDeps({ boxAccess: { [ROOT]: { email: "member@example.com" } } });
  const d = await authorizeRouterRequest(req({ method: "GET", url: "/main/test1/", headers: HTML }), deps);
  assert.equal(d.allow, true);
});

test("TCP box: agent bearer → allow (first rung of the ladder, no box lookups)", async () => {
  let mobileConsulted = false;
  const base = boxDeps({ agentBearer: true });
  const deps: RouterAuthDeps = {
    ...base,
    resolveMobileForBox: () => {
      mobileConsulted = true;
      return false;
    },
  };
  const d = await authorizeRouterRequest(req({ method: "GET", url: "/main/test1/api/x" }), deps);
  assert.equal(d.allow, true);
  assert.equal(mobileConsulted, false, "agent bearer short-circuits the rest of the ladder");
});

test("TCP box: neither mobile nor session → 401 (redirect a navigation)", async () => {
  const deps = boxDeps({});
  const nav = await authorizeRouterRequest(req({ method: "GET", url: "/main/test1/", headers: HTML }), deps);
  assert.equal(nav.allow === false && nav.status, 401);
  assert.equal(nav.allow === false && nav.redirectToLogin, true);

  const api = await authorizeRouterRequest(
    req({ method: "GET", url: "/main/test1/api/status", headers: JSON_ACCEPT }),
    deps,
  );
  assert.equal(api.allow === false && api.redirectToLogin, false, "an API deny does not redirect");
});

test("TCP box: unresolvable/duplicate slug fails closed → 401, no per-box auth attempted", async () => {
  // The slug→box map returns null (unknown or ambiguous). Even a would-be-valid
  // mobile/session must not save it — we never auth against a guessed box.
  let boxAuthAttempted = false;
  const deps: RouterAuthDeps = {
    ...makeDeps({ boxRoots: {} }), // "main/ghost" absent ⇒ resolveTargetBoxRoot → null
    resolveMobileForBox: () => {
      boxAuthAttempted = true;
      return true;
    },
    resolveBoxAccessSession: () => {
      boxAuthAttempted = true;
      return { email: "x@example.com" };
    },
  };
  const d = await authorizeRouterRequest(req({ method: "GET", url: "/main/ghost/", headers: HTML }), deps);
  assert.equal(d.allow, false);
  assert.equal(d.allow === false && d.status, 401);
  assert.equal(d.allow === false && d.reason, "target-box-unresolved");
  assert.equal(boxAuthAttempted, false, "no box-auth runs once the target is unresolvable");
});

test("TCP box: other root-worktree API (/<w>/api, targetBox null) resolves to picker and authorizes", async () => {
  const deps = makeDeps({ boxRoots: { "main/<root>": ROOT }, boxAccess: { [ROOT]: { email: "u@example.com" } } });
  const d = await authorizeRouterRequest(
    req({ method: "GET", url: "/main/api/build-info", headers: JSON_ACCEPT }),
    deps,
  );
  assert.equal(d.allow, true);
});

// --- worktree-asset (dev SPA shell, any box credential) ----------------------

test("TCP worktree-asset: any box credential in the worktree → allow", async () => {
  const deps = makeDeps({ worktreeAsset: { main: true } });
  const d = await authorizeRouterRequest(
    req({ method: "GET", url: "/main/@vite/client", headers: { authorization: "Bearer box-a-token" } }),
    deps,
  );
  assert.equal(d.allow, true, "a box mobile token reaches the dev SPA shell");
});

test("TCP worktree-asset: no credential → 401 (redirect a navigation)", async () => {
  const deps = makeDeps({ worktreeAsset: {} });
  const api = await authorizeRouterRequest(
    req({ method: "GET", url: "/main/@vite/client", headers: JSON_ACCEPT }),
    deps,
  );
  assert.equal(api.allow === false && api.status, 401);
  assert.equal(api.allow === false && api.reason, "worktree-asset-auth-required");
  assert.equal(api.allow === false && api.redirectToLogin, false);

  const nav = await authorizeRouterRequest(req({ method: "GET", url: "/main/src/main.tsx", headers: HTML }), deps);
  assert.equal(nav.allow === false && nav.redirectToLogin, true);
});

test("TCP worktree-asset: a credential for another worktree does NOT reach these assets", async () => {
  // Only `other` has a credential; the request targets `main`'s assets.
  const deps = makeDeps({ worktreeAsset: { other: true } });
  const d = await authorizeRouterRequest(
    req({ method: "GET", url: "/main/@vite/client", headers: { authorization: "Bearer other-token" } }),
    deps,
  );
  assert.equal(d.allow, false, "a token scoped to another worktree is not accepted here");
});

test("TCP box list: a mobile credential for any box in the worktree reaches /<w>/api/boxes", async () => {
  // The hub filters this response back to the box authorized by the credential;
  // the router must let the request reach that filtering boundary.
  const deps = makeDeps({ worktreeAsset: { main: true } });
  const d = await authorizeRouterRequest(req({ method: "GET", url: "/main/api/boxes", headers: JSON_ACCEPT }), deps);
  assert.equal(d.allow, true);
});

test("TCP box list: no credential in the worktree → 401", async () => {
  const deps = makeDeps({ worktreeAsset: {} });
  const d = await authorizeRouterRequest(req({ method: "GET", url: "/main/api/boxes", headers: JSON_ACCEPT }), deps);
  assert.equal(d.allow, false);
  assert.equal(d.allow === false && d.reason, "worktree-box-list-auth-required");
});

// --- unknown -----------------------------------------------------------------

test("TCP unknown: deny 404, never redirect", async () => {
  const deps = makeDeps({ owner: { email: "boxholder@example.com" } }); // even an owner cannot reach it
  const d = await authorizeRouterRequest(req({ method: "GET", url: "/__router/bogus", headers: HTML }), deps);
  assert.equal(d.allow, false);
  assert.equal(d.allow === false && d.status, 404);
  assert.equal(d.allow === false && d.reason, "unknown-route");
  assert.equal(d.allow === false && d.redirectToLogin, false);
});
