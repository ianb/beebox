import { test } from "tap";
import type { StoredTabTransfer } from "../src/domain/tab-arrangement.js";
import { tabArrangementAction } from "../src/platform/tab-arrangement-executor.js";

test("an unknown live tab makes Apply stale before any mutation", async (t) => {
  const sessionId = "browser-session";
  const firstId = "20000000-0000-4000-8000-000000000000";
  const secondId = "30000000-0000-4000-8000-000000000000";
  const transfer: StoredTabTransfer = {
    version: 1,
    browserSessionId: sessionId,
    boxUrl: "https://box.example",
    openUrl: "https://box.example/chat",
    payload: {
      transferId: "00000000-0000-4000-8000-000000000000",
      scope: "current-window",
      capturedAt: "2026-08-04T12:00:00.000Z",
      source: { windows: [{
        id: "10000000-0000-4000-8000-000000000000",
        tabs: [
          { id: firstId, title: "One", url: "https://one.example", pinned: false },
          { id: secondId, title: "Two", url: "https://two.example", pinned: false },
        ],
      }] },
      proposal: { windows: [{ id: "10000000-0000-4000-8000-000000000000", tabs: [firstId, secondId] }], close: [] },
    },
    locations: {
      [firstId]: { tabId: 11, windowId: 7 },
      [secondId]: { tabId: 12, windowId: 7 },
    },
    state: "ready",
  };
  let mutations = 0;
  const fakeChrome = {
    storage: {
      local: {
        get: async () => ({ latestTabTransfer: transfer }),
        set: async () => { mutations += 1; },
        remove: async () => {},
      },
      session: {
        get: async () => ({ tabTransferBrowserSession: sessionId }),
        set: async () => {},
      },
    },
    tabs: {
      query: async () => [
        { id: 11, url: "https://one.example", pinned: false, groupId: -1 },
        { id: 12, url: "https://two.example", pinned: false, groupId: -1 },
        { id: 99, url: "https://unknown.example", pinned: false, groupId: -1 },
      ],
      update: async () => { mutations += 1; },
      move: async () => { mutations += 1; },
      remove: async () => { mutations += 1; },
      create: async () => { mutations += 1; return { id: 100, windowId: 7 }; },
    },
    windows: {
      get: async () => ({ id: 7 }),
      getAll: async () => [{ id: 7, incognito: false }],
      create: async () => { mutations += 1; return { id: 8 }; },
    },
  };
  Object.defineProperty(globalThis, "chrome", { value: fakeChrome, configurable: true });
  t.teardown(() => { Reflect.deleteProperty(globalThis, "chrome"); });

  const result = await tabArrangementAction({
    action: "apply",
    transferId: transfer.payload.transferId,
    boxUrl: transfer.boxUrl,
    proposal: transfer.payload.proposal,
  });
  t.same(result, {
    ok: false,
    reason: "stale",
    message: "Nothing was changed: a captured window has gained or lost a tab",
  });
  t.equal(mutations, 0, "no storage transition or Chrome mutation happened");
});
