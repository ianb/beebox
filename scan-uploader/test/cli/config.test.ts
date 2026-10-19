// # Config loading and validation
//
// The uploader fails closed on any config problem, with a message naming
// exactly what's wrong — there's no silent partial-config fallback.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../../src/cli/config.js";
import { makeTmpDir, removeTmpDir } from "./tmp-dir.js";

const dir = await makeTmpDir("config");

async function writeConfig(contents: unknown): Promise<string> {
  const path = join(dir, `${Math.random().toString(36).slice(2)}.json`);
  await writeFile(path, JSON.stringify(contents));
  return path;
}

// checkThrows only catches synchronous throws; loadConfig rejects, so
// tests assert on the rejected error's name via this helper instead.
async function rejectedErrorName(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "(no error thrown)";
  } catch (e) {
    return e instanceof Error ? e.name : String(e);
  }
}

// An optional Photos album is retained in the typed config and requires keep:
void test("An optional Photos album is retained in the typed config and requires keep:", async (t) => {
  const photosPath = await writeConfig({ targets: [{ folder: "/photos", serverUrl: "https://beebox.run", box: "family", tokenPath: "/t", photos: { album: "Bee Box" } }] });
  t.check((await loadConfig(photosPath)).targets[0], {
    folder: "/photos",
    serverUrl: "https://beebox.run",
    box: "family",
    tokenPath: "/t",
    disposition: "keep",
    photos: {
      album: "Bee Box",
    },
  });
});

// Archiving Photos exports is refused:
void test("Archiving Photos exports is refused:", async (t) => {
  const photosArchivePath = await writeConfig({ targets: [{ folder: "/photos", serverUrl: "https://beebox.run", box: "family", tokenPath: "/t", disposition: "archive", photos: { album: "Bee Box" } }] });
  t.check(await rejectedErrorName(loadConfig(photosArchivePath)), "ConfigError");
});

// A well-formed config with one target loads cleanly; an omitted `disposition`
// defaults to `keep`:
void test("A well-formed config with one target loads cleanly; an omitted disposition de...", async (t) => {
  const path = await writeConfig({
    targets: [{ folder: "/scans/family", serverUrl: "https://beebox.run", box: "family", tokenPath: "/secrets/family.token" }],
  });
  const config = await loadConfig(path);
  t.check(config, {
    targets: [
      {
        folder: "/scans/family",
        serverUrl: "https://beebox.run",
        box: "family",
        tokenPath: "/secrets/family.token",
        disposition: "keep",
      },
    ],
  });
});

// A missing file is a `ConfigError`, not a raw `fs` error:
void test("A missing file is a ConfigError, not a raw fs error:", async (t) => {
  t.check(await rejectedErrorName(loadConfig(join(dir, "does-not-exist.json"))), "ConfigError");
});

// Invalid JSON:
void test("Invalid JSON:", async (t) => {
  const badJson = join(dir, "bad.json");
  await writeFile(badJson, "{ not json");
  t.check(await rejectedErrorName(loadConfig(badJson)), "ConfigError");
});

// An empty `targets` array is rejected — there's no such thing as a config
// that does nothing:
void test("An empty targets array is rejected — there's no such thing as a config that d...", async (t) => {
  const emptyTargets = await writeConfig({ targets: [] });
  t.check(await rejectedErrorName(loadConfig(emptyTargets)), "ConfigError");
});

// A target missing a required field is rejected:
void test("A target missing a required field is rejected:", async (t) => {
  const missingBox = await writeConfig({
    targets: [{ folder: "/scans", serverUrl: "https://beebox.run", tokenPath: "/t" }],
  });
  t.check(await rejectedErrorName(loadConfig(missingBox)), "ConfigError");
});

// An invalid `serverUrl` (not a URL) is rejected:
void test("An invalid serverUrl (not a URL) is rejected:", async (t) => {
  const badUrl = await writeConfig({
    targets: [{ folder: "/scans", serverUrl: "not-a-url", box: "family", tokenPath: "/t" }],
  });
  t.check(await rejectedErrorName(loadConfig(badUrl)), "ConfigError");
});

// An unrecognized `disposition` value is rejected:
void test("An unrecognized disposition value is rejected:", async (t) => {
  const badDisposition = await writeConfig({
    targets: [{ folder: "/scans", serverUrl: "https://beebox.run", box: "family", tokenPath: "/t", disposition: "delete" }],
  });
  t.check(await rejectedErrorName(loadConfig(badDisposition)), "ConfigError");
});

// `disposition: "trash"` is accepted on a platform reported as `darwin`:
void test("disposition:", async (t) => {
  t.teardown(async () => {
    try {
      await removeTmpDir(dir);
    } catch (error) {
      t.error(error);
    }
  });
  const trashOnMac = await writeConfig({
    targets: [{ folder: "/scans", serverUrl: "https://beebox.run", box: "family", tokenPath: "/t", disposition: "trash" }],
  });
  const macConfig = await loadConfig(trashOnMac, { platform: "darwin" });
  t.check(macConfig.targets[0]?.disposition, "trash");

  // `disposition: "trash"` REFUSES at config load on a non-macOS platform — the
  // uploader never falls back to `unlink`, so a Trash disposition that can't be
  // honored must be caught before any file ever moves:

  t.check(await rejectedErrorName(loadConfig(trashOnMac, { platform: "linux" })), "ConfigError");
});
