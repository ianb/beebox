// # Engine version surfacing (Track E, chunk E2)
//
// A box pins its own `beebox` dependency in `package.json`, resolved
// into `node_modules/beebox/`. That pinned version can drift from
// whatever engine process is actually serving the box (future-normal once the
// hub serves per-box engines — for now, just flagged). `getEngineVersionReport`
// is the single place `bbx status` and `/healthz` both read this comparison
// from, so the two surfaces can't disagree.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  getServingEngineVersion,
  getInstalledEngineVersion,
  getEngineVersionReport,
} from "../../src/core/engine-version.js";
import { PACKAGE_ROOT } from "../../src/lib/package-root.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

async function realEngineVersion() {
  const raw = await fs.readFile(path.join(PACKAGE_ROOT, "package.json"), "utf-8");
  return JSON.parse(raw).version;
}

// ## `getServingEngineVersion` reads the running engine's own package.json
void test("`getServingEngineVersion` reads the running engine's own package.json", async (t) => {
  // doctest:L30
  const engineVersion = await realEngineVersion();
  t.check(await getServingEngineVersion(), engineVersion);
});

// ## A box with no installed engine reports `installed: null`
//
// `getInstalledEngineVersion` reads `<box.root>/node_modules/beebox/package.json`.
// A fresh fixture has no such install, so it's `null` — and the report shows no
// mismatch (a null side never mismatches).
void test("getInstalledEngineVersion reads <box.root>/nodemodules/beebox/package.json.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L42
  const box = await makeTmpBox();
  t.check(await getInstalledEngineVersion(box.root), null);

  // doctest:L48
  const report = await getEngineVersionReport(box.root);
  t.check(report, { serving: await realEngineVersion(), installed: null, mismatch: false });
});

// ## A box whose installed engine differs from the serving engine reports a mismatch
//
// The pinned/installed engine lives at `<box.root>/node_modules/beebox/`.
// Install a fake one at version `0.0.1`; the serving engine (this build) is a
// different version, so `mismatch` is true.
void test("The pinned/installed engine lives at <box.root>/nodemodules/beebox/.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L64
  const box = await makeTmpBox();
  await fs.mkdir(path.join(box.root, "node_modules/beebox"), { recursive: true });
  await fs.writeFile(path.join(box.root, "node_modules/beebox/package.json"), JSON.stringify({ version: "0.0.1" }));

  // doctest:L68
  const report = await getEngineVersionReport(box.root);
  t.check(report, { serving: await realEngineVersion(), installed: "0.0.1", mismatch: true });
});

// ## A box whose installed engine matches the serving engine reports no mismatch
void test("A box whose installed engine matches the serving engine reports no mismatch", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L80
  const box = await makeTmpBox();
  const engineVersion = await realEngineVersion();
  await fs.mkdir(path.join(box.root, "node_modules/beebox"), { recursive: true });
  await fs.writeFile(path.join(box.root, "node_modules/beebox/package.json"), JSON.stringify({ version: engineVersion }));

  // doctest:L85
  const report = await getEngineVersionReport(box.root);
  t.check(report, { serving: engineVersion, installed: engineVersion, mismatch: false });
});
