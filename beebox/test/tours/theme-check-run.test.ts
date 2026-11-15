// The last completed theme check drives --failed. A partial retry must not
// describe its small set of screens as complete rule coverage.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "tap";
import { SCREENS } from "../../src/shared/theme-screens.js";
import { jobKey, loadLastRun, retryJobs, saveLastRun, validateLastRun, type ThemeJob } from "./theme-check-run.js";

const c = { system: "plain", systemStock: "neutral", card: "plain", cardStock: "neutral" };
const contrast: ThemeJob = { kind: "contrast", screen: SCREENS[0], c };
const phone: ThemeJob = { kind: "screen", screen: SCREENS[0], c };
const laptop: ThemeJob = { kind: "screen", screen: SCREENS[3], c };
const available = [contrast, phone, laptop];

void test("a backdrop-only retry does not report rule coverage", (t) => {
  t.check(retryJobs({ version: 1, fullCatalog: false, cases: [c], failed: [jobKey(phone)], coverageNeeded: false }, available), {
    jobs: [phone], completeCoverage: false,
  });
  t.end();
});

void test("a contrast-only retry does not report rule coverage", (t) => {
  t.check(retryJobs({ version: 1, fullCatalog: false, cases: [c], failed: [jobKey(contrast)], coverageNeeded: false }, available), {
    jobs: [contrast], completeCoverage: false,
  });
  t.end();
});

void test("uncovered rules make a retry visit every screen", (t) => {
  t.check(retryJobs({ version: 1, fullCatalog: false, cases: [c], failed: [jobKey(contrast)], coverageNeeded: true }, available), {
    jobs: [contrast, phone, laptop], completeCoverage: true,
  });
  t.end();
});

void test("a completed run replaces the retry state", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "theme-check-run-"));
  t.teardown(() => rm(root, { recursive: true, force: true }));
  const first = { version: 1 as const, fullCatalog: false, cases: [c], failed: [jobKey(phone)], coverageNeeded: false };
  const second = { version: 1 as const, fullCatalog: false, cases: [c], failed: [], coverageNeeded: true };
  await saveLastRun(root, first);
  t.check(await loadLastRun(root), first);
  await saveLastRun(root, second);
  t.check(await loadLastRun(root), second);
});

void test("malformed case data is rejected before building jobs", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "theme-check-run-"));
  t.teardown(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "last-run.json"), JSON.stringify({ version: 1, fullCatalog: false, cases: [null], failed: [], coverageNeeded: false }));
  t.check(await loadLastRun(root).then(() => "loaded", (error: unknown) => error instanceof Error ? error.message : String(error)),
    "last-run.json is invalid; run bin/theme-check --all again");
});

void test("removed catalog stock and changed full catalog are stale", (t) => {
  const themes = [{ name: "plain", stocks: ["neutral"] }];
  const invalid = { version: 1 as const, fullCatalog: false, cases: [{ ...c, cardStock: "removed" }], failed: [], coverageNeeded: false };
  function message(run: typeof invalid, catalog: typeof c[]): string {
    try { validateLastRun(run, { catalog, themes }); return "accepted"; }
    catch (error) { return error instanceof Error ? error.message : String(error); }
  }
  t.check(message(invalid, [c]), "last-run.json names a removed stock plain/removed; run --all again");
  const stale = { ...invalid, fullCatalog: true, cases: [c] };
  t.check(message(stale, [{ ...c, systemStock: "new" }]), "the theme catalog changed since last-run.json; run --all again");
  t.end();
});
