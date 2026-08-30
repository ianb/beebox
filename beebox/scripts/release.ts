#!/usr/bin/env tsx
/**
 * Build a release tarball: the `dist-release/*.tgz` a box's `package.json`
 * pins (Track F, `docs/implemented-plans/boxes-as-packages-v2.md` "Distribution
 * (decision 2)"). No install-time build, no registry — the tarball itself
 * (or its hash) is what a box depends on.
 *
 * Steps:
 *   1. Clean `dist/` and `dist-release/` — a stale `dist/` can carry d.ts or
 *      JS from an earlier build shape (e.g. a full `tsc` tree from `pnpm
 *      build`) that the current `files` allowlist would otherwise ship
 *      unnoticed.
 *   2. `build:cli` — bundles `dist/cli.mjs` plus the `./cards`, `./schema`,
 *      `./server`, `./view-widgets` export targets, then emits declarations
 *      for the two typed exports (`tsconfig.declarations.json`). This is
 *      deliberately NOT `pnpm build` (the full per-file `tsc` tree): nothing
 *      at runtime resolves `dist/webapp/*.js` or `dist/cli/index.js` — prod
 *      runs the bundle via `bin/bbx`, and the library surface is the four
 *      bundled export targets above. Shipping the per-file tree would just
 *      be dead weight in the tarball.
 *   3. Build the frontend (`src/frontend` → `src/frontend/dist`) — served by
 *      `server.ts` at `PACKAGE_ROOT/src/frontend/dist`.
 *   4. `pnpm pack` into `dist-release/`, respecting package.json's `files`
 *      allowlist.
 *
 * Quiet on success (prints one summary line); full stdout+stderr from any
 * failed step surfaces on failure.
 */

import { execa } from "execa";
import { rm, mkdir, stat } from "node:fs/promises";
import * as path from "node:path";
import { PACKAGE_ROOT } from "../src/lib/package-root.js";

const DIST_RELEASE_DIR = path.join(PACKAGE_ROOT, "dist-release");

interface RunStepArgs {
  label: string;
  file: string;
  args: string[];
  cwd: string;
}

/** Run a command, streaming nothing on success but dumping full output on failure. */
async function runStep({ label, file, args, cwd }: RunStepArgs): Promise<void> {
  const result = await execa(file, args, { cwd, reject: false, all: true });
  if (result.exitCode !== 0) {
    process.stderr.write(`\n[release] FAILED: ${label} (${file} ${args.join(" ")})\n`);
    process.stderr.write(`${result.all ?? ""}\n`);
    process.exit(result.exitCode ?? 1);
  }
}

async function main(): Promise<void> {
  const t0 = process.hrtime.bigint();

  await rm(path.join(PACKAGE_ROOT, "dist"), { recursive: true, force: true });
  await rm(DIST_RELEASE_DIR, { recursive: true, force: true });
  await mkdir(DIST_RELEASE_DIR, { recursive: true });

  await runStep({
    label: "build:cli (bundle + declarations)",
    file: "pnpm",
    args: ["run", "build:cli"],
    cwd: PACKAGE_ROOT,
  });
  await runStep({
    label: "build frontend",
    file: "pnpm",
    args: ["run", "build"],
    cwd: path.join(PACKAGE_ROOT, "src/frontend"),
  });

  const packResult = await execa(
    "pnpm",
    ["pack", "--pack-destination", DIST_RELEASE_DIR],
    { cwd: PACKAGE_ROOT, reject: false, all: true }
  );
  if (packResult.exitCode !== 0) {
    process.stderr.write(`\n[release] FAILED: pnpm pack\n${packResult.all ?? ""}\n`);
    process.exit(packResult.exitCode ?? 1);
  }
  // `pnpm pack`'s last stdout line is the tarball's absolute path.
  const lines = (packResult.stdout ?? "").trim().split("\n");
  const tarballPath = lines[lines.length - 1]!.trim();
  const { size } = await stat(tarballPath);
  const listing = await execa("tar", ["tzf", tarballPath], { cwd: PACKAGE_ROOT });
  const fileCount = listing.stdout.trim().split("\n").filter((l) => l.length > 0).length;

  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  process.stderr.write(
    `[release] ${path.relative(PACKAGE_ROOT, tarballPath)} — ${(size / 1024).toFixed(0)}KB, ` +
      `${fileCount} files, built in ${(ms / 1000).toFixed(1)}s\n`
  );
}

await main();
