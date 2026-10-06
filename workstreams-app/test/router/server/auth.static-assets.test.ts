import assert from "node:assert/strict";
import { test } from "node:test";
import { authorizeRouterRequest, classifyRouterRoute, type RouterAuthDeps } from "../../../src/router/server/auth.js";

function syntheticBoxDeps(authenticated: boolean): RouterAuthDeps {
  return {
    resolveOwnerSession: () => null,
    resolveTargetBoxRoot: ({ targetBox }) => `/synthetic/${targetBox ?? "picker"}`,
    resolveBoxAccessSession: () => null,
    resolveMobileForBox: () => authenticated,
    isAgentBearer: () => false,
    isCsrfSafe: () => false,
    resolveWorktreeAsset: () => false,
    hasBrowseKey: () => false,
  };
}

const protectedPaths = [
  "/main/assets",
  "/main/icons",
  "/main/assets/api/status",
  "/main/icons/api/status",
  "/main/assets/auth/me",
  "/main/icons/auth/me",
  "/main/assets/icon-192.png",
  "/main/assets/icon-0192.png?cache=1",
  "/main/assets/manifest.webmanifest",
  "/main/assets/api/files/fixture.js",
  "/main/assets/../icons/auth/me",
  "/main/assets/%2e%2e/icons/auth/me",
  "/main/assets/api%2fstatus",
  "/main/assets/api%252fstatus",
  "/main/assets/..\\icons\\auth\\me",
  "/main/assets/.",
  "/main/assets/..",
  "/main/assets/.hidden",
  "/main/assets/index.js/../../icons/auth/me",
  "/main/assets//api/status",
  "/main/assets-private/api/status",
  "/main/icons-private/auth/me",
  "/main/assetsx/index.js",
  "/main/iconsx/icon-192.png",
  "/main/assets/../api/boxes",
  "/main/icons/%2E%2E/test1/api/status",
  "/main/assets/%5c..%5cicons%5cauth%5cme",
  "/main/assets/index.js%2f..%2f..%2ficons%2fauth%2fme",
  "/main/test1/api/files/fixture.js",
  "/main/test1/icons/icon-192.png",
];

test("public static leaves never admit hypothetical assets/icons box routes", async () => {
  const deps = syntheticBoxDeps(false);
  for (const url of protectedPaths) {
    assert.equal(classifyRouterRoute({ method: "GET", url }).kind, "box", url);
    const decision = await authorizeRouterRequest({ trustedLocal: false, method: "GET", url, headers: {} }, deps);
    assert.equal(decision.allow, false, url);
    if (!decision.allow) assert.equal(decision.status, 401, url);
  }
});

test("direct static filenames load without credentials across asset formats", async () => {
  const deps = syntheticBoxDeps(false);
  for (const url of [
    "/main/assets/index-Ab_C12-3.js",
    "/main/assets/theme-Ab12.css?version=1",
    "/main/assets/source-Ab12.js.map",
    "/main/assets/font-Ab12.woff2",
    "/main/assets/image-Ab12.svg",
    "/main/assets/image-Ab12.png",
    "/main/assets/module-Ab12.wasm",
    "/main/assets/new-format-Ab12.bin",
    "/main/icons/icon-192.png",
    "/main/icons/icon-512.png",
    "/main/icons/apple-touch-icon.png",
    "/main/icons/icon.svg",
    "/main/earcons/silence.mp3",
    "/main/manifest.webmanifest",
    "/main/sw.js",
  ]) {
    const decision = await authorizeRouterRequest({ trustedLocal: false, method: "GET", url, headers: {} }, deps);
    assert.deepEqual(decision, { allow: true, route: { kind: "unauth-allowlist" } }, url);
  }
});

test("static public access stays GET-only and colliding boxes retain credential access", async () => {
  for (const method of ["HEAD", "POST", "PUT", "DELETE", "OPTIONS"]) {
    const decision = await authorizeRouterRequest({ trustedLocal: false, method, url: "/main/assets/index-Ab12.js", headers: {} }, syntheticBoxDeps(false));
    assert.equal(decision.allow, false, method);
  }
  for (const url of ["/main/assets/api/status", "/main/icons/auth/me", "/main/assets/icon-192.png"]) {
    const decision = await authorizeRouterRequest({ trustedLocal: false, method: "GET", url, headers: {} }, syntheticBoxDeps(true));
    assert.equal(decision.allow, true, url);
    assert.equal(decision.route.kind, "box", url);
  }
});
