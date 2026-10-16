# Frontend public assets survive dev-router prefixes

The Vite development proxy must leave the shared `icons/` directory to Vite.
It must not interpret `icons` as a box slug merely because the filename looks
like a per-box identity asset.

```ts setup
import { isBoxIdentityAssetPath, perBoxIdentityAssetPattern } from "../../src/shared/box-identity-asset-routes.js";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const pattern = perBoxIdentityAssetPattern("");
const matchingProxy = (url: string) => new RegExp(pattern).test(url) ? pattern : undefined;
```

```ts
matchingProxy("/icons/icon-192.png") ?? "vite-static"
=> vite-static

matchingProxy("/test1/icon-192.png")
=> ^/(?!icons/)[^/]+/(icon-\d+\.png|manifest\.webmanifest)$
```

The dev router uses the same identity matcher as Vite's proxy. This keeps a
direct static filename from bypassing box auth when it is an identity route.

```ts
const prefixedProxy = new RegExp(perBoxIdentityAssetPattern("/main"));
["/assets/icon-192.png", "/assets/manifest.webmanifest", "/icons/icon-192.png", "/assets/index-ab12.js"].map((path) => ({
  path,
  routerIdentity: isBoxIdentityAssetPath(path),
  viteIdentity: prefixedProxy.test(`/main${path}`),
}))
=> [
  { path: "/assets/icon-192.png", routerIdentity: true, viteIdentity: true },
  { path: "/assets/manifest.webmanifest", routerIdentity: true, viteIdentity: true },
  { path: "/icons/icon-192.png", routerIdentity: false, viteIdentity: false },
  { path: "/assets/index-ab12.js", routerIdentity: false, viteIdentity: false }
]
```

The service worker needs push events, but no fetch listener: an empty fetch
listener makes every navigation pass through the worker and modern Chromium
warns about the needless overhead. Notification fallback icons resolve against
the worker scope so a worktree-prefixed worker uses `/main/icons/...` while the
production worker continues to use `/icons/...`.

```ts
const source = await readFile(new URL("../../src/frontend/public/sw.js", import.meta.url), "utf8");
interface PushEventLike { data: { json: () => unknown }; waitUntil: (promise: Promise<unknown>) => Promise<unknown> }
const listeners = new Map<string, (event: PushEventLike) => unknown>();
const notifications: { title: string; options: { icon?: string; badge?: string } }[] = [];
const scope = "http://localhost:3210/main/";
const self = {
  addEventListener(type: string, listener: (event: PushEventLike) => unknown) { listeners.set(type, listener); },
  skipWaiting() {},
  clients: { claim() {}, matchAll: async () => [], openWindow() {} },
  registration: {
    scope,
    showNotification: async (title: string, options: { icon?: string; badge?: string }) => { notifications.push({ title, options }); },
  },
};
vm.runInNewContext(source, { self, URL, fetch });

listeners.has("fetch")
=> false

listeners.get("push")?.({
  data: { json: () => ({ title: "Hello", body: "world", url: "/main/test1/" }) },
  waitUntil: (promise: Promise<unknown>) => promise,
});
await new Promise((resolve) => setImmediate(resolve));
JSON.stringify([notifications[0]?.options.icon, notifications[0]?.options.badge])
=> ["http://localhost:3210/main/icons/icon-192.png","http://localhost:3210/main/icons/icon-192.png"]
```
