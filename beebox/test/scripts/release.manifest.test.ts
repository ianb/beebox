// # Release manifest consistency
//
// `package.json`'s `files` allowlist (Track F, `src/scripts/release.ts` — see
// "Distribution (decision 2)" in `docs/implemented-plans/boxes-as-packages-v2.md`) is what
// `pnpm pack` ships. This is a cheap, no-build static check that every target
// the `exports` map and `bin` field point at is actually covered by `files` —
// the failure mode it catches is real: shipping a tarball whose `exports` map
// promises a path `files` silently excludes, which only shows up later as a
// runtime `ERR_MODULE_NOT_FOUND` in a stranger's box (exactly the F1 release
// smoke test's job, but that's a slow end-to-end script — this test is the
// fast, CI-friendly manifest check that runs on every `pnpm test`).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { containing } from "@ianbicking/tap-check/check";
import { readFile, access, glob } from "node:fs/promises";
import * as path from "node:path";

const PACKAGE_ROOT = path.join(import.meta.dirname, "../..");

interface PackageJson {
  files: string[];
  exports: Record<string, unknown>;
  bin: Record<string, string>;
}

async function loadPackageJson(): Promise<PackageJson> {
  const raw = await readFile(path.join(PACKAGE_ROOT, "package.json"), "utf-8");
  return JSON.parse(raw);
}

/** Whether `files` (package.json's allowlist) covers `target` — either a
 *  directory entry that's a path-segment prefix of `target`, or an exact
 *  file match. */
function coveredByFiles(target: string, files: string[]) {
  const normalizedTarget = target.replace(/^\.\//, "");
  return files.some((entry: string) => {
    if (entry === normalizedTarget) return true;
    return normalizedTarget.startsWith(`${entry}/`);
  });
}

/** Every path an `exports` map value points at, whether the value is a bare
 *  string or a conditional object ({ types, default, ... }). */
function exportTargets(exportsMap: Record<string, unknown>) {
  const targets: string[] = [];
  for (const value of Object.values(exportsMap)) {
    if (typeof value === "string") {
      targets.push(value);
    } else if (value && typeof value === "object") {
      targets.push(...Object.values(value).filter((v): v is string => typeof v === "string"));
    }
  }
  return targets;
}

/** Entries of `entries` that match nothing under `PACKAGE_ROOT`. A glob
 *  entry (npm `files` accepts them) counts as present when it matches at
 *  least one path. */
async function findMissing(entries: string[]) {
  const missing: string[] = [];
  for (const entry of entries) {
    if (entry.includes("*")) {
      const matches: string[] = [];
      for await (const match of glob(entry, { cwd: PACKAGE_ROOT })) matches.push(match);
      if (matches.length === 0) missing.push(entry);
      continue;
    }
    try {
      await access(path.join(PACKAGE_ROOT, entry));
    } catch (_e) {
      missing.push(entry);
    }
  }
  return missing;
}

// ## Every `exports` map target is covered by `files`
void test("Every `exports` map target is covered by `files`", async (t) => {
  const pkg = await loadPackageJson();
  const targets = exportTargets(pkg.exports);

  t.check(targets, containing(["./dist/exports/cards.js"]));

  t.check(targets.filter((target) => !coveredByFiles(target, pkg.files)), []);

  // ## Every `bin` target is covered by `files`

  const binTargets = Object.values(pkg.bin);

  t.check(binTargets, containing(["./bin/bbx"]));

  t.check(binTargets.filter((target) => !coveredByFiles(target, pkg.files)), []);

  // ## `files` names no checked-in entry that doesn't exist
  //
  // Only the entries that are checked-in source, not build output (`dist` and
  // `src/frontend/dist` only exist after `pnpm release`/`build:cli`, so this
  // test — which runs on every `pnpm test`, build or no build — can't assert
  // on those without forcing a build here). A stale/renamed entry among the
  // checked-in ones (e.g. a leftover path from a layout change) would silently
  // ship nothing for that entry rather than fail loudly — catch it here instead
  // of at `pnpm pack` time.

  const checkedIn = pkg.files.filter((f) => f !== "dist" && f !== "src/frontend/dist");

  // Nonempty, so the check below cannot pass by checking nothing.
  t.check(checkedIn, containing(["bin"]));

  t.check(await findMissing(checkedIn), []);
});

// ## Every relative import in a shipped source file is shipped too
//
// `files` ships a few `.ts` sources so a box's own typecheck can follow types
// into them. An import in one of those to a file `files` leaves out fails only
// at the box's typecheck, the `pnpm release && pnpm smoke` step
// (`issues/closed/bugs/2026-10-23-release-tarball-misses-chat-composer-binding.md`).
void test("Every relative import in a shipped .ts source is covered by `files`", async (t) => {
  const pkg = await loadPackageJson();
  const sources = pkg.files.filter((entry) => entry.endsWith(".ts") && !entry.endsWith(".d.ts"));

  t.check(sources, containing(["src/core/chat/card-activity.ts"]));

  const unshipped: string[] = [];
  for (const source of sources) {
    const text = await readFile(path.join(PACKAGE_ROOT, source), "utf-8");
    for (const match of text.matchAll(/from\s+"(\.\.?\/[^"]+)"/g)) {
      const specifier = match[1] ?? "";
      const target = path.posix.join(path.posix.dirname(source), specifier).replace(/\.js$/, ".ts");
      if (!coveredByFiles(target, pkg.files)) unshipped.push(`${source} -> ${specifier}`);
    }
  }
  t.check(unshipped, []);
});
