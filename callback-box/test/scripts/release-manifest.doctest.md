# Release manifest consistency

`package.json`'s `files` allowlist (Track F, `scripts/release.ts` — see
"Distribution (decision 2)" in `docs/plans/boxes-as-packages-v2.md`) is what
`pnpm pack` ships. This is a cheap, no-build static check that every target
the `exports` map and `bin` field point at is actually covered by `files` —
the failure mode it catches is real: shipping a tarball whose `exports` map
promises a path `files` silently excludes, which only shows up later as a
runtime `ERR_MODULE_NOT_FOUND` in a stranger's box (exactly the F1 release
smoke test's job, but that's a slow end-to-end script — this doctest is the
fast, CI-friendly manifest check that runs on every `pnpm test`).

```ts setup
import { readFile, access } from "node:fs/promises";
import * as path from "node:path";

const PACKAGE_ROOT = path.join(import.meta.dirname, "../..");

async function loadPackageJson() {
  const raw = await readFile(path.join(PACKAGE_ROOT, "package.json"), "utf-8");
  return JSON.parse(raw);
}

/** Whether `files` (package.json's allowlist) covers `target` — either a
 *  directory entry that's a path-segment prefix of `target`, or an exact
 *  file match. */
function coveredByFiles(target, files) {
  const normalizedTarget = target.replace(/^\.\//, "");
  return files.some((entry) => {
    if (entry === normalizedTarget) return true;
    return normalizedTarget.startsWith(`${entry}/`);
  });
}

/** Every path an `exports` map value points at, whether the value is a bare
 *  string or a conditional object ({ types, default, ... }). */
function exportTargets(exportsMap) {
  const targets = [];
  for (const value of Object.values(exportsMap)) {
    if (typeof value === "string") {
      targets.push(value);
    } else if (value && typeof value === "object") {
      targets.push(...Object.values(value));
    }
  }
  return targets;
}

/** Entries of `entries` that don't exist under `PACKAGE_ROOT`. */
async function findMissing(entries) {
  const missing = [];
  for (const entry of entries) {
    try {
      await access(path.join(PACKAGE_ROOT, entry));
    } catch (_e) {
      missing.push(entry);
    }
  }
  return missing;
}
```

## Every `exports` map target is covered by `files`

```ts
const pkg = await loadPackageJson();
const targets = exportTargets(pkg.exports);

targets.length > 0
=> true

targets.filter((t) => !coveredByFiles(t, pkg.files))
=> []
```

## Every `bin` target is covered by `files`

```ts continue
const binTargets = Object.values(pkg.bin);

binTargets.length > 0
=> true

binTargets.filter((t) => !coveredByFiles(t, pkg.files))
=> []
```

## `files` names no checked-in entry that doesn't exist

Only the entries that are checked-in source, not build output (`dist` and
`src/frontend/dist` only exist after `pnpm release`/`build:cli`, so this
doctest — which runs on every `pnpm test`, build or no build — can't assert
on those without forcing a build here). A stale/renamed entry among the
checked-in ones (e.g. a leftover path from a layout change) would silently
ship nothing for that entry rather than fail loudly — catch it here instead
of at `pnpm pack` time.

```ts continue
const checkedIn = pkg.files.filter((f) => f !== "dist" && f !== "src/frontend/dist");
checkedIn
=> [
  "bin",
  "templates",
  "src/frontend/package.json",
  "src/types",
  "tsconfig.json",
  "tsconfig.base.json"
]
```

```ts continue
await findMissing(checkedIn)
=> []
```
