import { test } from "tap";
import { loadConfig, saveConfig } from "../src/platform/config-storage.js";
import { addBox, emptyConfig } from "../src/domain/config.js";

type StorageKeys = string | string[];

function installFakeStorage(initial: Record<string, unknown>): Map<string, unknown> {
  const data = new Map<string, unknown>(Object.entries(initial));
  const local = {
    async get(keys: StorageKeys): Promise<Record<string, unknown>> {
      const list = typeof keys === "string" ? [keys] : keys;
      return Object.fromEntries(
        list.filter((key) => data.has(key)).map((key) => [key, data.get(key)])
      );
    },
    async set(items: Record<string, unknown>): Promise<void> {
      for (const [key, value] of Object.entries(items)) data.set(key, value);
    },
    async remove(keys: string[]): Promise<void> {
      for (const key of keys) data.delete(key);
    },
  };
  // eslint-disable-next-line no-restricted-syntax -- test shim standing in for the chrome global
  (globalThis as { chrome?: unknown }).chrome = { storage: { local } };
  return data;
}

test("loadConfig returns the empty config on a fresh install", async (t) => {
  installFakeStorage({});
  t.same(await loadConfig(), emptyConfig());
});

test("saveConfig/loadConfig round-trips", async (t) => {
  installFakeStorage({});
  const config = addBox(emptyConfig(), {
    boxUrl: "https://beebox.example.com/main",
    slug: "main",
    title: "Main",
  });
  await saveConfig(config);
  t.same(await loadConfig(), config);
});

test("loadConfig clears dropbox-era keys and keeps the config", async (t) => {
  const data = installFakeStorage({
    credentials: { workerUrl: "https://old.workers.dev", apiKey: "k" },
    syncState: { lastSyncAt: null },
    pendingActions: [],
  });
  t.same(await loadConfig(), emptyConfig());
  t.notOk(data.has("credentials"));
  t.notOk(data.has("syncState"));
  t.notOk(data.has("pendingActions"));
});
