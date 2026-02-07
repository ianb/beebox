import { test } from "tap";

// Mock chrome.storage.local for testing
function mockChromeStorage() {
  const store: Record<string, unknown> = {};
  return {
    storage: {
      local: {
        async get(keys: string | string[]) {
          const keyList = typeof keys === "string" ? [keys] : keys;
          const result: Record<string, unknown> = {};
          for (const k of keyList) {
            if (k in store) result[k] = store[k];
          }
          return result;
        },
        async set(items: Record<string, unknown>) {
          Object.assign(store, items);
        },
        async remove(keys: string | string[]) {
          const keyList = typeof keys === "string" ? [keys] : keys;
          for (const k of keyList) {
            delete store[k];
          }
        },
      },
      onChanged: {
        addListener() {},
        removeListener() {},
      },
    },
    _store: store,
  };
}

test("credentials round-trip", async (t) => {
  const mock = mockChromeStorage();
  (globalThis as any).chrome = mock;

  // Dynamically import so the module sees our mock
  const { saveCredentials, getCredentials, clearCredentials } = await import(
    "../src/lib/storage.js"
  );

  // Initially null
  t.equal(await getCredentials(), null);

  // Save and retrieve
  const creds = {
    workerUrl: "https://example.com",
    apiKey: "key-123",
    channelKey: "base64key==",
    channelId: "chan-456",
  };
  await saveCredentials(creds);
  const loaded = await getCredentials();
  t.same(loaded, creds);

  // Clear
  await clearCredentials();
  t.equal(await getCredentials(), null);
});

test("sync state round-trip", async (t) => {
  const mock = mockChromeStorage();
  (globalThis as any).chrome = mock;

  const { saveSyncState, getSyncState } = await import("../src/lib/storage.js");

  t.equal(await getSyncState(), null);

  const state = {
    lastSyncAt: "2024-01-01T00:00:00Z",
    tabCount: 5,
    lastMessageId: "msg-1",
  };
  await saveSyncState(state);
  t.same(await getSyncState(), state);
});
