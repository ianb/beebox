// Tests for the REAL RouterAuthDeps (bin/router-auth-deps.ts) — Track B, chunk
// 2a of beebox/docs/implemented-plans/expose-dev-router.md. These exercise the wiring
// the pure gate (bin/router-auth.ts, covered by bin/router-auth.test.ts) can't:
// the single slug→box source of truth (duplicate ⇒ fail closed; a non-box
// segment ⇒ the worktree-root/session sentinel, NOT a deny), the per-box mobile
// keying, the owner-session (gen-aware) check, and the CSRF rule.
//
// Isolation: an empty temp BBX_AUTH_FILE so the resolver's cookie path finds no
// local record (a gen-less owner cookie then authenticates); BBX_OWNER_EMAIL and
// BBX_SESSION_SECRET are pinned; BBX_HUB_SECRET is cleared so the resolver never
// takes the hub path. Set BEFORE importing the auth module (secret is cached).
//
// Run with:
//   node --import tsx --test bin/router-auth-deps.test.ts

import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import type { ResolvedBoxEntry } from "./box-entry.js";
import type { RouterHeaders } from "./router-auth.js";

const OWNER = "owner@example.com";
process.env.BBX_OWNER_EMAIL = OWNER;
process.env.BBX_SESSION_SECRET = "router-auth-deps-test-secret";
delete process.env.BBX_HUB_SECRET;

let authFileDir: string;
before(async () => {
  authFileDir = await fs.mkdtemp(path.join(os.tmpdir(), "router-auth-deps-"));
  process.env.BBX_AUTH_FILE = path.join(authFileDir, "auth.json"); // absent ⇒ empty store
});
after(async () => {
  await fs.rm(authFileDir, { recursive: true, force: true });
});

const { createRouterAuthDeps } = await import("./router-auth-deps.js");
const { signSession } = await import("../beebox/src/webapp/auth.js");
const { signMobileSession, MOBILE_SESSION_TTL_MS } = await import(
  "../beebox/src/core/mobile/mobile-session.js"
);

/** A fake worktree/box map: worktree name → its box entries (or null = unknown). */
function fakeConfig(map: Record<string, ResolvedBoxEntry[] | null>): {
  resolveWorktree(name: string): Promise<{ boxes: string[] } | null>;
  resolveBoxEntries(entries: string[]): Promise<ResolvedBoxEntry[]>;
} {
  return {
    resolveWorktree: (name) => Promise.resolve(map[name] === null || map[name] === undefined ? null : { boxes: [name] }),
    resolveBoxEntries: (entries) => Promise.resolve(map[entries[0]!] ?? []),
  };
}

const entry = (slug: string, contentDir: string): ResolvedBoxEntry => ({ slug, contentDir });

function ownerCookie(): RouterHeaders {
  return { cookie: `bbx_session=${signSession({ email: OWNER, name: "Owner" })}` };
}

// --- resolveTargetBoxRoot: the single slug→box source of truth ---------------

test("resolveTargetBoxRoot: known single slug → that box's content dir", async () => {
  const deps = createRouterAuthDeps(fakeConfig({ main: [entry("test1", "/boxes/test1")] }));
  assert.equal(await deps.resolveTargetBoxRoot({ targetWorktree: "main", targetBox: "test1" }), "/boxes/test1");
});

test("resolveTargetBoxRoot: unknown worktree → null (fail closed)", async () => {
  const deps = createRouterAuthDeps(fakeConfig({ main: [entry("test1", "/boxes/test1")] }));
  assert.equal(await deps.resolveTargetBoxRoot({ targetWorktree: "ghost", targetBox: "test1" }), null);
});

test("resolveTargetBoxRoot: duplicate slug → null (never auth against the wrong box)", async () => {
  const deps = createRouterAuthDeps(
    fakeConfig({ main: [entry("dup", "/boxes/a"), entry("dup", "/boxes/b")] }),
  );
  assert.equal(await deps.resolveTargetBoxRoot({ targetWorktree: "main", targetBox: "dup" }), null);
});

test("resolveTargetBoxRoot: non-box segment (Vite asset) → worktree-root sentinel, not a box path", async () => {
  const deps = createRouterAuthDeps(fakeConfig({ main: [entry("test1", "/boxes/test1")] }));
  const root = await deps.resolveTargetBoxRoot({ targetWorktree: "main", targetBox: "@vite" });
  assert.notEqual(root, null, "an unknown segment under a real worktree is not a hard deny");
  assert.ok(!root!.startsWith("/"), "sentinel is not an absolute box path");
  // A mobile token must never satisfy the sentinel (it's the cross-box picker).
  assert.equal(await deps.resolveMobileForBox({ authorization: "Bearer x" }, root!), false);
});

test("resolveTargetBoxRoot: root-worktree (null box) → worktree-root sentinel", async () => {
  const deps = createRouterAuthDeps(fakeConfig({ main: [entry("test1", "/boxes/test1")] }));
  const root = await deps.resolveTargetBoxRoot({ targetWorktree: "main", targetBox: null });
  assert.ok(root !== null && !root.startsWith("/"), "the picker resolves to the sentinel, not a default box");
  assert.equal(await deps.resolveMobileForBox({ authorization: "Bearer x" }, root!), false);
});

// --- resolveOwnerSession: gen-aware owner check ------------------------------

test("resolveOwnerSession: valid owner cookie → owner; no cookie / wrong email → null", async () => {
  const deps = createRouterAuthDeps(fakeConfig({}));
  assert.deepEqual(await deps.resolveOwnerSession(ownerCookie()), { email: OWNER });
  assert.equal(await deps.resolveOwnerSession({}), null, "no cookie → no owner");
  const stranger = { cookie: `bbx_session=${signSession({ email: "stranger@example.com", name: "S" })}` };
  assert.equal(await deps.resolveOwnerSession(stranger), null, "a non-owner session is not the owner");
});

test("resolveOwnerSession: a tampered/garbage cookie → null (HMAC rejects it)", async () => {
  const deps = createRouterAuthDeps(fakeConfig({}));
  assert.equal(await deps.resolveOwnerSession({ cookie: "bbx_session=not.a.valid.cookie" }), null);
});

test("resolveBoxAccessSession: owner session reaches any box and the worktree-root sentinel", async () => {
  const deps = createRouterAuthDeps(fakeConfig({ main: [entry("test1", "/boxes/test1")] }));
  assert.deepEqual(await deps.resolveBoxAccessSession(ownerCookie(), "/boxes/test1"), { email: OWNER });
  const sentinel = await deps.resolveTargetBoxRoot({ targetWorktree: "main", targetBox: null });
  assert.deepEqual(await deps.resolveBoxAccessSession(ownerCookie(), sentinel!), { email: OWNER });
  assert.equal(await deps.resolveBoxAccessSession({}, "/boxes/test1"), null, "no session → no access");
});

// --- isCsrfSafe: same-origin assertion for mutating control ------------------

test("isCsrfSafe: Sec-Fetch-Site same-origin / none → safe; cross-site / same-site → unsafe", () => {
  const deps = createRouterAuthDeps(fakeConfig({}));
  assert.equal(deps.isCsrfSafe({ "sec-fetch-site": "same-origin" }), true);
  assert.equal(deps.isCsrfSafe({ "sec-fetch-site": "none" }), true, "top-level nav (typed URL) is safe");
  assert.equal(deps.isCsrfSafe({ "sec-fetch-site": "cross-site" }), false);
  assert.equal(deps.isCsrfSafe({ "sec-fetch-site": "same-site" }), false, "same-site is not same-origin");
});

test("isCsrfSafe: no Sec-Fetch-Site falls back to Origin vs Host", () => {
  const deps = createRouterAuthDeps(fakeConfig({}));
  // No Sec-Fetch-Site AND no Origin = no provenance at all ⇒ fail closed
  // (finding 3.2). Legitimate local tooling uses the UDS (trustedLocal, which
  // bypasses CSRF); a real browser always sends Sec-Fetch-Site; a same-origin
  // nav to the control routes carries Sec-Fetch-Site: same-origin/none. So a
  // provenance-less request is exactly the CSRF-shaped case we must reject.
  assert.equal(deps.isCsrfSafe({}), false, "no provenance at all ⇒ unsafe (was permissive; 3.2)");
  assert.equal(
    deps.isCsrfSafe({ origin: "https://box.example.ts.net", host: "box.example.ts.net" }),
    true,
    "same-origin form POST",
  );
  assert.equal(
    deps.isCsrfSafe({ origin: "https://evil.example.com", host: "box.example.ts.net" }),
    false,
    "a foreign Origin is a cross-origin POST",
  );
  assert.equal(deps.isCsrfSafe({ origin: "://malformed", host: "box.example.ts.net" }), false);
});

// --- resolveWorktreeAsset: dev SPA shell reachable by any box credential ------

/** A `bbx_mobile` cookie signed with `boxRoot`'s own per-box secret (pure HMAC). */
function mobileCookie(boxRoot: string): RouterHeaders {
  const value = signMobileSession(boxRoot, { deviceId: "dev-1", createdBy: "u@example.com", ttlMs: MOBILE_SESSION_TTL_MS });
  return { cookie: `bbx_mobile=${value}` };
}

test("resolveWorktreeAsset: a per-box mobile token reaches the worktree's dev assets", async () => {
  const boxA = await fs.mkdtemp(path.join(os.tmpdir(), "router-asset-a-"));
  const boxB = await fs.mkdtemp(path.join(os.tmpdir(), "router-asset-b-"));
  try {
    const deps = createRouterAuthDeps(fakeConfig({ main: [entry("boxa", boxA), entry("boxb", boxB)] }));
    // A bbx_mobile for boxA (any box in the worktree) reaches the dev assets.
    assert.equal(await deps.resolveWorktreeAsset(mobileCookie(boxA), "main"), true);
    // The owner session reaches them too (the owner's own dev SPA).
    assert.equal(await deps.resolveWorktreeAsset(ownerCookie(), "main"), true);
    // No credential at all → denied.
    assert.equal(await deps.resolveWorktreeAsset({}, "main"), false);
  } finally {
    await fs.rm(boxA, { recursive: true, force: true });
    await fs.rm(boxB, { recursive: true, force: true });
  }
});

test("resolveWorktreeAsset: a mobile token does NOT reach a DIFFERENT worktree's assets", async () => {
  const boxA = await fs.mkdtemp(path.join(os.tmpdir(), "router-asset-a2-"));
  const stray = await fs.mkdtemp(path.join(os.tmpdir(), "router-asset-stray-"));
  try {
    // boxA belongs to `main`; `other` contains only `stray` (a different secret).
    const deps = createRouterAuthDeps(
      fakeConfig({ main: [entry("boxa", boxA)], other: [entry("stray", stray)] }),
    );
    assert.equal(await deps.resolveWorktreeAsset(mobileCookie(boxA), "other"), false);
    // And an unknown worktree fails closed regardless of credential.
    assert.equal(await deps.resolveWorktreeAsset(mobileCookie(boxA), "ghost"), false);
  } finally {
    await fs.rm(boxA, { recursive: true, force: true });
    await fs.rm(stray, { recursive: true, force: true });
  }
});

// --- hasBrowseKey: the dev-read rung -----------------------------------------

test("hasBrowseKey: absent BBX_BROWSE_API_KEY → constant false (the fail-closed default)", () => {
  const prior = process.env.BBX_BROWSE_API_KEY;
  delete process.env.BBX_BROWSE_API_KEY;
  try {
    const deps = createRouterAuthDeps(fakeConfig({ main: [] }));
    assert.equal(deps.hasBrowseKey({ cookie: "bbx_browse_key=anything" }), false);
    assert.equal(deps.hasBrowseKey({}), false);
  } finally {
    if (prior === undefined) delete process.env.BBX_BROWSE_API_KEY;
    else process.env.BBX_BROWSE_API_KEY = prior;
  }
});

test("hasBrowseKey: the configured key in the cookie → true; a wrong value → false", () => {
  const prior = process.env.BBX_BROWSE_API_KEY;
  process.env.BBX_BROWSE_API_KEY = "dev-read-test-key";
  try {
    const deps = createRouterAuthDeps(fakeConfig({ main: [] }));
    assert.equal(deps.hasBrowseKey({ cookie: "bbx_browse_key=dev-read-test-key" }), true);
    assert.equal(deps.hasBrowseKey({ cookie: "bbx_browse_key=wrong" }), false);
    assert.equal(deps.hasBrowseKey({}), false);
  } finally {
    if (prior === undefined) delete process.env.BBX_BROWSE_API_KEY;
    else process.env.BBX_BROWSE_API_KEY = prior;
  }
});
