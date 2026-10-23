// # Push support
//
// Web Push works where the browser has a service worker, PushManager and
// Notification. iOS Safari lacks them until the page is a Home-Screen app, so
// there the answer is "needs install" rather than "unsupported".

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { detectPushSupport, isIOS } from "../../src/lib/push-support.js";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";
const DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";

function stub(userAgent: string, opts: { push: boolean; standalone: boolean }): () => void {
  const g = globalThis;
  const saved = { navigator: Reflect.get(g, "navigator"), window: Reflect.get(g, "window") };
  const nav: Record<string, unknown> = { userAgent, standalone: opts.standalone };
  if (opts.push) nav["serviceWorker"] = {};
  Object.defineProperty(g, "navigator", { value: nav, configurable: true, writable: true });
  const win: Record<string, unknown> = {
    navigator: nav,
    matchMedia: () => ({ matches: false }),
  };
  if (opts.push) {
    win["PushManager"] = {};
    win["Notification"] = {};
  }
  Object.defineProperty(g, "window", { value: win, configurable: true, writable: true });
  return () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) Reflect.deleteProperty(g, k);
      else Object.defineProperty(g, k, { value: v, configurable: true, writable: true });
    }
  };
}

void test("the verdict follows the push APIs, then iOS install state", async (t) => {
  const verdicts: Record<string, unknown> = {};
  for (const [name, ua, opts] of [
    ["push available", DESKTOP, { push: true, standalone: false }],
    ["iOS Safari tab", IPHONE, { push: false, standalone: false }],
    ["iOS Home-Screen app without push", IPHONE, { push: false, standalone: true }],
    ["desktop without push", DESKTOP, { push: false, standalone: false }],
  ] as const) {
    const restore = stub(ua, opts);
    try {
      verdicts[name] = { support: detectPushSupport().kind, ios: isIOS() };
    } finally {
      restore();
    }
  }
  t.check(verdicts, {
    "push available": { support: "supported", ios: false },
    "iOS Safari tab": { support: "needs-install", ios: true },
    "iOS Home-Screen app without push": { support: "unsupported", ios: true },
    "desktop without push": { support: "unsupported", ios: false },
  });
});
