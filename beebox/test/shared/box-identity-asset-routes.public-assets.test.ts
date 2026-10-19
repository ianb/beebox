// # Frontend public assets survive dev-router prefixes
//
// The Vite development proxy must leave the shared `icons/` directory to Vite.
// It must not interpret `icons` as a box slug merely because the filename looks
// like a per-box identity asset.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { isBoxIdentityAssetPath, perBoxIdentityAssetPattern } from "../../src/shared/box-identity-asset-routes.js";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const pattern = perBoxIdentityAssetPattern("");
const matchingProxy = (url: string) => url.match(pattern) ? pattern : undefined;

void test("line 16", async (t) => {
  // doctest:L17
  t.check(matchingProxy("/icons/icon-192.png") ?? "vite-static", "vite-static");

  // doctest:L20
  t.check(matchingProxy("/test1/icon-192.png"), "^/(?!icons/)[^/]+/(icon-\\d+\\.png|manifest\\.webmanifest)$");
});

// The dev router uses the same identity matcher as Vite's proxy. This keeps a
// direct static filename from bypassing box auth when it is an identity route.
void test("The dev router uses the same identity matcher as Vite's proxy.", async (t) => {
  // doctest:L28
  const prefixedProxy = perBoxIdentityAssetPattern("/main");
  t.check(
    ["/assets/icon-192.png", "/assets/manifest.webmanifest", "/icons/icon-192.png", "/assets/index-ab12.js"].map((path) => ({
      path,
      routerIdentity: isBoxIdentityAssetPath(path),
      viteIdentity: `/main${path}`.match(prefixedProxy) !== null,
    })),
    [
    {
      path: "/assets/icon-192.png",
      routerIdentity: true,
      viteIdentity: true,
    },
    {
      path: "/assets/manifest.webmanifest",
      routerIdentity: true,
      viteIdentity: true,
    },
    {
      path: "/icons/icon-192.png",
      routerIdentity: false,
      viteIdentity: false,
    },
    {
      path: "/assets/index-ab12.js",
      routerIdentity: false,
      viteIdentity: false,
    },
  ],
  );
});

// The service worker needs push events, but no fetch listener: an empty fetch
// listener makes every navigation pass through the worker and modern Chromium
// warns about the needless overhead. Notification fallback icons resolve against
// the worker scope so a worktree-prefixed worker uses `/main/icons/...` while the
// production worker continues to use `/icons/...`.
void test("The service worker needs push events, but no fetch listener:", async (t) => {
  // doctest:L49
  const source = await readFile(new URL("../../src/frontend/public/sw.js", import.meta.url), "utf8");
  interface ShownOptions { body?: string; data?: { url: string }; tag?: string | undefined; icon?: string; badge?: string; silent?: boolean }
  interface PushEventLike { data: { json: () => unknown }; waitUntil: (promise: Promise<unknown>) => Promise<unknown> }
  const listeners = new Map<string, (event: PushEventLike) => unknown>();
  const notifications: { title: string; options: ShownOptions }[] = [];
  const scope = "http://localhost:3210/main/";
  const self = {
    addEventListener(type: string, listener: (event: PushEventLike) => unknown) { listeners.set(type, listener); },
    skipWaiting() {},
    clients: { claim() {}, matchAll: async () => [], openWindow() {} },
    registration: {
      scope,
      showNotification: async (title: string, options: ShownOptions) => { notifications.push({ title, options }); },
    },
  };
  vm.runInNewContext(source, { self, URL, fetch });

  // doctest:L65
  t.check([...listeners.keys()], [
    "install",
    "activate",
    "push",
    "notificationclick",
    "pushsubscriptionchange",
  ]);

  // doctest:L68
  listeners.get("push")?.({
    data: { json: () => ({ title: "Hello", body: "world", url: "/main/test1/" }) },
    waitUntil: (promise: Promise<unknown>) => promise,
  });
  await new Promise((resolve) => setImmediate(resolve));
  t.check(notifications, [
    {
      title: "Hello",
      options: {
        body: "world",
        data: {
          url: "/main/test1/",
        },
        tag: undefined,
        icon: "http://localhost:3210/main/icons/icon-192.png",
        badge: "http://localhost:3210/main/icons/icon-192.png",
        silent: false,
      },
    },
  ]);
});
