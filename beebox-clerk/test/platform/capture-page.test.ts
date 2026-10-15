import { test } from "tap";
import { CAPTURE_RESULT, takeCaptureRequestId } from "../../src/domain/capture-messages.js";
import { capturePage } from "../../src/platform/capture-page.js";

type Listener = (message: unknown, sender: { tab?: { id: number } }) => void;

interface Injection {
  target: { tabId: number };
  files?: string[];
  func?: (key: string, id: string) => void;
  args?: [string, string];
}

const page = (title: string) => ({ title, siteName: null, byline: null, excerpt: null, markdown: title, url: "https://example.com/" });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A fake chrome whose capture script takes the request id the way the real one does. */
function installFakeChrome(onTeardown: (fn: () => void) => void) {
  const listeners = new Set<Listener>();
  const injected: string[] = [];
  const fakeChrome = {
    runtime: {
      onMessage: {
        addListener: (listener: Listener) => listeners.add(listener),
        removeListener: (listener: Listener) => listeners.delete(listener),
      },
    },
    scripting: {
      executeScript: async (injection: Injection) => {
        if (injection.func !== undefined && injection.args !== undefined) injection.func(...injection.args);
        if (injection.files !== undefined) injected.push(takeCaptureRequestId(globalThis));
        return [];
      },
    },
  };
  Object.defineProperty(globalThis, "chrome", { value: fakeChrome, configurable: true });
  onTeardown(() => {
    Reflect.deleteProperty(globalThis, "chrome");
  });
  const deliver = (params: { requestId: string; tabId: number; title: string }) => {
    const message = { type: CAPTURE_RESULT, requestId: params.requestId, capture: { page: page(params.title), frozenHtml: null } };
    for (const listener of [...listeners]) listener(message, { tab: { id: params.tabId } });
  };
  return { injected, deliver, listeners, scripting: fakeChrome.scripting };
}

test("captures in one tab run one at a time, and each takes only its own result", async (t) => {
  const fake = installFakeChrome((fn) => t.teardown(fn));
  const first = capturePage(7);
  const second = capturePage(7);
  await flush();
  t.equal(fake.injected.length, 1, "the second capture waits for the first");
  const firstId = fake.injected[0] ?? "";
  t.not(firstId, "");

  fake.deliver({ requestId: firstId, tabId: 8, title: "other tab" });
  fake.deliver({ requestId: "someone-else", tabId: 7, title: "unknown id" });
  fake.deliver({ requestId: firstId, tabId: 7, title: "A" });
  t.equal((await first)?.page.title, "A");

  await flush();
  t.equal(fake.injected.length, 2);
  const secondId = fake.injected[1] ?? "";
  t.not(secondId, firstId);
  fake.deliver({ requestId: firstId, tabId: 7, title: "late result of the first capture" });
  fake.deliver({ requestId: secondId, tabId: 7, title: "B" });
  t.equal((await second)?.page.title, "B");
  t.equal(fake.listeners.size, 0, "no listener is left behind");
});

test("a capture whose injection fails resolves null and does not block the next", async (t) => {
  const fake = installFakeChrome((fn) => t.teardown(fn));
  const original = fake.scripting.executeScript;
  const debugLogs: unknown[] = [];
  const originalDebug = console.debug;
  console.debug = (...args: unknown[]) => debugLogs.push(args);
  t.teardown(() => {
    console.debug = originalDebug;
  });
  fake.scripting.executeScript = async () => {
    throw new Error("Cannot access a chrome:// URL");
  };
  t.equal(await capturePage(9), null);
  t.equal(debugLogs.length, 1, "the failed injection is logged");
  fake.scripting.executeScript = original;
  const next = capturePage(9);
  await flush();
  fake.deliver({ requestId: fake.injected[0] ?? "", tabId: 9, title: "C" });
  t.equal((await next)?.page.title, "C");
});
