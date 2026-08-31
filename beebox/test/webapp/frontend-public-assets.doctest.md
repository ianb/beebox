# Frontend public assets survive dev-router prefixes

The Vite development proxy must leave the shared `icons/` directory to Vite.
It must not interpret `icons` as a box slug merely because the filename looks
like a per-box identity asset.

```ts setup
import { perBoxIdentityAssetPattern } from "../../src/frontend/vite-proxy.js";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const pattern = perBoxIdentityAssetPattern("");
const matchingProxy = (url) => new RegExp(pattern).test(url) ? pattern : undefined;
```

```ts
matchingProxy("/icons/icon-192.png") ?? "vite-static"
=> vite-static

matchingProxy("/test1/icon-192.png")
=> ^/(?!icons/)[^/]+/(icon-\d+\.png|manifest\.webmanifest)$
```

The service worker needs push events, but no fetch listener: an empty fetch
listener makes every navigation pass through the worker and modern Chromium
warns about the needless overhead. Notification fallback icons resolve against
the worker scope so a worktree-prefixed worker uses `/main/icons/...` while the
production worker continues to use `/icons/...`.

```ts
const source = await readFile(new URL("../../src/frontend/public/sw.js", import.meta.url), "utf8");
const listeners = new Map();
let notification;
const scope = "http://localhost:3210/main/";
const self = {
  addEventListener(type, listener) { listeners.set(type, listener); },
  skipWaiting() {},
  clients: { claim() {}, matchAll: async () => [], openWindow() {} },
  registration: {
    scope,
    showNotification: async (title, options) => { notification = { title, options }; },
  },
};
vm.runInNewContext(source, { self, URL, fetch });

listeners.has("fetch")
=> false

listeners.get("push")({
  data: { json: () => ({ title: "Hello", body: "world", url: "/main/test1/" }) },
  waitUntil: (promise) => promise,
});
await new Promise((resolve) => setImmediate(resolve));
JSON.stringify([notification.options.icon, notification.options.badge])
=> ["http://localhost:3210/main/icons/icon-192.png","http://localhost:3210/main/icons/icon-192.png"]
```
