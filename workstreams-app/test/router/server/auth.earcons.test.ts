import assert from "node:assert/strict";
import { test } from "node:test";
import { authorizeRouterRequest, type RouterAuthDeps } from "../../../src/router/server/auth.js";

test("TCP shared earcons need no credentials while box audio remains protected", async () => {
  // Box slugs resolve, including a hypothetical box named earcons, but the
  // caller has no credential. Only direct shared media may bypass the gate.
  const deps: RouterAuthDeps = {
    resolveOwnerSession: () => null,
    resolveTargetBoxRoot: ({ targetBox }) => `/boxes/${targetBox ?? "picker"}`,
    resolveBoxAccessSession: () => null,
    resolveMobileForBox: () => false,
    isAgentBearer: () => false,
    isCsrfSafe: () => false,
    resolveWorktreeAsset: () => false,
    hasBrowseKey: () => false,
  };
  const input = { trustedLocal: false, method: "GET", headers: {} };
  const earcon = await authorizeRouterRequest({ ...input, url: "/main/earcons/silence.mp3" }, deps);
  assert.equal(earcon.allow, true);

  for (const { method, url } of [
    { method: "GET", url: "/main/test1/earcons/silence.mp3" },
    { method: "GET", url: "/main/test1/api/files/private.mp3" },
    { method: "POST", url: "/main/earcons/silence.mp3" },
    { method: "GET", url: "/main/earcons/api/files/private.mp3" },
    { method: "GET", url: "/main/earcons/auth/me" },
    { method: "GET", url: "/main/earcons/api%2Ffiles%2Fprivate.mp3" },
  ]) {
    const decision = await authorizeRouterRequest({ ...input, method, url }, deps);
    assert.equal(decision.allow, false, url);
    if (!decision.allow) assert.equal(decision.status, 401, url);
  }
});
