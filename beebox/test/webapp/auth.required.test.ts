// # Always-on auth gate: the `openAccess` instance flag and the wall's edges
//
// Authentication is the structurally always-on default. There is no operator
// opt-out anymore: the only unauthenticated servers that can exist are
// test-constructed ones, via the `openAccess` construction option (decorated onto
// the fastify instance and consulted by `resolveRequestIdentity` — `src/webapp/auth.ts`).
// No CLI path sets it. This test covers the gate's semantics (a server without
// `openAccess` requires auth; `openAccess: true` resolves to `source: "open"`), the
// diagnostic-bypass batch-URL fix, and the two root-route edges (`/auth/me` open
// shape, `/api/push/resubscribe` behind the wall).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { anything, containing } from "@ianbicking/tap-check/check";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveRequestIdentity, isDiagnosticBypassRequest, type DiagRequest } from "../../src/webapp/auth.js";
import { assertOpenAccessNotListening, startServer } from "../../src/webapp/server/app.js";
import { makeTestServer } from "../helpers/test-route-server.js";

const ORIGINAL_DIAG_KEY = process.env.BBX_DIAG_API_KEY;
const ORIGINAL_HUB_SECRET = process.env.BBX_HUB_SECRET;
// The resolver's cookie path (not hub mode) is what these gate cases exercise.
delete process.env.BBX_HUB_SECRET;

const NOT_AUTHENTICATED = { statusCode: 401, body: { error: "Not authenticated" } };

/** The secret panel's refusal of a browse key on the machine-level store. */
const SECRETS_NEED_OWNER_SESSION = {
  statusCode: 403,
  body: {
    error: {
      message:
        "secrets management requires an authenticated owner session — open-access does not qualify (the store is machine-level, spanning every box on this host)",
      code: -32003,
      data: { code: "FORBIDDEN", httpStatus: 403, path: "secrets.formatHints", recovery: null },
    },
  },
};

/** The request fields the diagnostic-bypass check reads. */
function fakeRequest({ method, url, headers }: { method?: string; url: string; headers?: Record<string, string> }): DiagRequest {
  return { method: method ?? "GET", url, headers: headers ?? {} };
}

// ## A server without `openAccess` requires auth; `openAccess: true` resolves to `source: "open"`
//
// Outside hub mode, a cookieless request is unauthenticated (`source: null`) when
// the server was constructed auth-on, and `source: "open"` when it was constructed
// with `openAccess: true` — the single place standalone openness is decided, which
// the openness-recomputing call sites read as `identity.source` rather than
// re-derive.
void test("Outside hub mode, a cookieless request is unauthenticated (source:", async (t) => {
  const cookieless = { headers: {}, cookies: {} };

  t.check(resolveRequestIdentity(cookieless, { openAccess: false }), {
    email: null,
    name: null,
    source: null,
  });

  t.check(resolveRequestIdentity(cookieless, { openAccess: true }), {
    email: null,
    name: null,
    source: "open",
  });
});

// ## Diagnostic bypass: EVERY batched tRPC procedure must be whitelisted
//
// A single whitelisted procedure passes; a tRPC **batch** URL that also carries a
// non-whitelisted procedure (e.g. `history.list`) does NOT — the fix for the old
// substring match that let a diag-key holder read past the two allowed endpoints.
void test("A single whitelisted procedure passes; a tRPC batch URL that also carries a n...", async (t) => {
  process.env.BBX_DIAG_API_KEY = "diag-key-for-auth-required-test";
  const bearer = { authorization: "Bearer diag-key-for-auth-required-test" };

  t.check(isDiagnosticBypassRequest(fakeRequest({ url: "/test/api/trpc/health.check", headers: bearer })), true);

  t.check(isDiagnosticBypassRequest(fakeRequest({ url: "/test/api/trpc/debugLog.get?batch=1", headers: bearer })), true);

  t.check(
    // The batch-URL privilege-widening, now closed:
    isDiagnosticBypassRequest(fakeRequest({ url: "/test/api/trpc/health.check,history.list?batch=1", headers: bearer })),
    false,
  );

  t.check(
    // A whitelisted procedure but the wrong (or missing) key never bypasses:
    isDiagnosticBypassRequest(fakeRequest({ url: "/test/api/trpc/health.check", headers: { authorization: "Bearer wrong" } })),
    false,
  );

  t.check(
    // A POST is never a bypass, even for a whitelisted read procedure:
    isDiagnosticBypassRequest(fakeRequest({ method: "POST", url: "/test/api/trpc/health.check", headers: bearer })),
    false,
  );
});

// ## An `openAccess` server is non-listenable
//
// Open access bypasses the auth wall, so it must never bind a listening socket —
// it exists only as a `.inject()`-based test seam. `startServer` fails closed
// before any side effect when handed `openAccess: true` (which no typed caller can
// pass — it's absent from the public `ServerOptions` — but a runtime caller could
// smuggle in). A normal listen path (no `openAccess`) passes the guard. Injected
// open-access servers are unaffected: `.inject()` never goes through listen (the
// `{ open: true }` server above answered fine).
void test("Open access bypasses the auth wall, so it must never bind a listening socket...", async (t) => {
  await t.checkThrows(async () => (assertOpenAccessNotListening({ openAccess: true })), "OpenAccessListenError");

  t.check(
    // The guard is a no-op for the production shape (no openAccess) and for an
    // explicit false; nothing throws so these return undefined.
    assertOpenAccessNotListening({}),
    undefined,
  );

  t.check(assertOpenAccessNotListening({ openAccess: false }), undefined);
});

// The public entry point fails closed too, before touching disk or the network.
// `startServer` is async, so read the rejection's error name.
void test("The public entry point fails closed too, before touching disk or the network.", async (t) => {
  const listenName = await startServer({ openAccess: true }).then(() => "did not throw", (e) => e.name);
  t.check(listenName, "OpenAccessListenError");
});

// ## `/auth/me` advertises open access; `/api/push/resubscribe` sits behind the wall
//
// An `openAccess: true` server advertises `{ open: true }` on `/auth/me` (the
// open-mode signal read by `/healthz` and `/api/build-info`) and passes
// `/api/push/resubscribe` through the wall (then 400s on the empty body — proof it
// reached the handler rather than being blanket-blocked).
void test("An openAccess:", async (t) => {
  delete process.env.BBX_DIAG_API_KEY;
  const openServer = await makeTestServer({ openAccess: true });

  const meOpen = await openServer.rootRequest({ method: "GET", url: "/auth/me" });
  t.check(meOpen, {
    statusCode: 200,
    body: {
      open: true,
    },
  });

  const resubOpen = await openServer.rootRequest({ method: "POST", url: "/api/push/resubscribe", payload: {} });
  t.check(resubOpen, { statusCode: 400, body: { error: "missing subscription" } });

  await openServer.cleanup();
});

// An auth-on server (`openAccess: false`, the production default) 401s both.
void test("An auth-on server (openAccess:", async (t) => {
  const authServer = await makeTestServer({ openAccess: false });

  const meRequired = await authServer.rootRequest({ method: "GET", url: "/auth/me" });
  t.check(meRequired, NOT_AUTHENTICATED);

  const resubRequired = await authServer.rootRequest({ method: "POST", url: "/api/push/resubscribe", payload: {} });
  t.check(resubRequired, NOT_AUTHENTICATED);

  // `files.kind` is a `publicProcedure`: the transport wall, not the procedure, is its auth.
  const kindUrl = `/api/trpc/files.kind?input=${encodeURIComponent(JSON.stringify({ path: "_content" }))}`;
  const kindRequired = await authServer.request({ method: "GET", url: kindUrl });
  t.check(kindRequired, NOT_AUTHENTICATED);

  await authServer.cleanup();
});

// ## The browse key in the tRPC context: an owner on an opted-in box, `authed` elsewhere
//
// `createContext` (`server-box-scope.ts`) resolves identity through
// `resolveBoxIdentity`, so on a box that declares `agentBrowsing: "owner"` the
// machine-wide browse key arrives as a `user` and clears `ownerProcedure`. The one
// owner surface it must NOT clear **on the shared store** is the secret panel:
// the machine-level store holds every box's real keys, so one test box's opt-in
// cannot unlock them (`docs/implemented-plans/secret-custody.md`) —
// `authenticatedOwnerProcedure` excludes `source: "browse"` there. Earlier
// sections gave themselves a tmp store, so this block explicitly clears the
// override to stand on the default, shared path — and puts it back after.
void test("createContext (server-box-scope.ts) resolves identity through resolveBoxIdent...", async (t) => {
  t.teardown(async () => {
    try {
      await optedIn.cleanup();
      await plain.cleanup();
      await rm(authDir, { recursive: true, force: true });
      delete process.env.BBX_BROWSE_API_KEY;
      delete process.env.BBX_AUTH_FILE;
      if (ORIGINAL_OWNER === undefined) delete process.env.BBX_OWNER_EMAIL;
      else process.env.BBX_OWNER_EMAIL = ORIGINAL_OWNER;
    } catch (error) {
      t.error(error);
    }
  });
  t.teardown(async () => {
    try {
      if (ORIGINAL_DIAG_KEY === undefined) delete process.env.BBX_DIAG_API_KEY;
      else process.env.BBX_DIAG_API_KEY = ORIGINAL_DIAG_KEY;
      if (ORIGINAL_HUB_SECRET === undefined) delete process.env.BBX_HUB_SECRET;
      else process.env.BBX_HUB_SECRET = ORIGINAL_HUB_SECRET;
    } catch (error) {
      t.error(error);
    }
  });
  const BROWSE_KEY = "browse-key-for-auth-required-test";
  const ORIGINAL_OWNER = process.env.BBX_OWNER_EMAIL;
  process.env.BBX_BROWSE_API_KEY = BROWSE_KEY;
  process.env.BBX_OWNER_EMAIL = "owner@example.com";
  // Keep the owner's display-name lookup off the machine's real ~/.bbx-auth.json.
  const authDir = await mkdtemp(join(tmpdir(), "bbx-auth-required-browse-"));
  process.env.BBX_AUTH_FILE = join(authDir, "no-such-auth.json");
  const browseHeaders = { authorization: `Bearer ${BROWSE_KEY}` };
  const PRIOR_STORE = process.env.BBX_SECRETS_FILE;
  delete process.env.BBX_SECRETS_FILE;

  const optedIn = await makeTestServer({ openAccess: false });
  await optedIn.seed("_config/box.json", JSON.stringify({ agentBrowsing: "owner" }));

  const asOwner = await optedIn.request({ method: "GET", url: "/api/trpc/scanTokens.list", headers: browseHeaders });
  const atSecrets = await optedIn.request({ method: "GET", url: "/api/trpc/secrets.formatHints", headers: browseHeaders });

  if (PRIOR_STORE !== undefined) process.env.BBX_SECRETS_FILE = PRIOR_STORE;
  t.check(asOwner, { statusCode: 200, body: { result: { data: [] } } });
  t.check(atSecrets, SECRETS_NEED_OWNER_SESSION);

  // On an ISOLATED store — what every worktree box under the dev router runs on —
  // there is nothing of the boxholder's to protect, and refusing browse there only
  // made the Secrets panel the one owner surface an agent could never exercise.
  // Isolation is asserted, not inferred: an override path alone (which `main`
  // inherits from any shell or `.env`) still refuses; the router's
  // `BBX_SECRETS_STORE_ISOLATED=1` beside a non-default path opens the panel.

  const isolatedStore = await mkdtemp(join(tmpdir(), "bbx-isolated-secrets-"));
  process.env.BBX_SECRETS_FILE = join(isolatedStore, "secrets.json");
  const overrideOnly = await optedIn.request({ method: "GET", url: "/api/trpc/secrets.formatHints", headers: browseHeaders });
  process.env.BBX_SECRETS_STORE_ISOLATED = "1";
  const atIsolatedSecrets = await optedIn.request({ method: "GET", url: "/api/trpc/secrets.formatHints", headers: browseHeaders });
  delete process.env.BBX_SECRETS_STORE_ISOLATED;
  if (PRIOR_STORE === undefined) delete process.env.BBX_SECRETS_FILE; else process.env.BBX_SECRETS_FILE = PRIOR_STORE;
  t.check(overrideOnly, SECRETS_NEED_OWNER_SESSION);
  // The hint list is generated from the secret registry, so only its presence is pinned.
  t.check(atIsolatedSecrets, { statusCode: 200, body: { result: { data: containing([anything()]) } } });

  // On a box that never opted in, the key means what it always did: it clears the
  // wall and reaches an authenticated procedure, and nothing owner-gated.

  const plain = await makeTestServer({ openAccess: false });

  const authedCall = await plain.request({ method: "GET", url: "/api/trpc/inventory.summary", headers: browseHeaders });
  const kindCall = await plain.request({
    method: "GET",
    url: `/api/trpc/files.kind?input=${encodeURIComponent(JSON.stringify({ path: "_content" }))}`,
    headers: browseHeaders,
  });
  const ownerCall = await plain.request({ method: "GET", url: "/api/trpc/voice.capabilities", headers: browseHeaders });

  // The inventory summary is a large generated report; the status shows the call reached the procedure.
  t.check(authedCall.statusCode, 200);
  t.check(kindCall, { statusCode: 200, body: { result: { data: { kind: "directory" } } } });
  t.check(ownerCall, {
    statusCode: 403,
    body: {
      error: {
        message: "Owner access required",
        code: -32003,
        data: { code: "FORBIDDEN", httpStatus: 403, path: "voice.capabilities", recovery: null },
      },
    },
  });
});
