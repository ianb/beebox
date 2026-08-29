#!/usr/bin/env tsx
/**
 * `cb upgrade` end-to-end smoke gate (Track E, chunk E1+E2's "RUN it" item).
 *
 * Runs entirely OUTSIDE this repo, the same "stranger sequence" as
 * `smoke-external-box.ts`: pack a release tarball (or reuse the latest one),
 * derive a SECOND tarball with the same code but a different `version` field
 * (no rebuild needed — only `package.json`'s `version` differs), scaffold a
 * fresh v2 box against the first, then `cb upgrade --to` the second and
 * assert the commit trailer + installed version. Then induces a failure
 * (`--to` a nonexistent path — exactly the preflight `assertSpecResolvable`
 * check in `src/cli/commands/upgrade.ts`) and asserts the box is left
 * untouched (nonzero exit, clean tree, nothing bumped).
 *
 * The second tarball is derived by extracting the first and rewriting its
 * `package.json` version in a scratch temp dir — NOT by mutating this repo's
 * real `package.json` and re-running `pnpm release` (which would race any
 * concurrent work on this checkout and cost a second full build for zero
 * code difference). "Same code, different versions" is exactly what `cb
 * upgrade`'s dependency bump needs to exercise.
 *
 * Quiet on success (one summary line per step); full output from a failed
 * step surfaces immediately and the script exits nonzero.
 */

import { execa } from "execa";
import { mkdtemp, mkdir, readFile, writeFile, readdir, stat, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { PACKAGE_ROOT } from "../src/lib/package-root.js";
import { BOX_BUILT_DEPENDENCIES } from "../src/core/box/package.js";
import { isRecord } from "../src/lib/is-record.js";

/** Extract a `version` string from a parsed `package.json`-shaped value, throwing on anything else. */
function requireVersion(parsed: unknown): string {
  if (isRecord(parsed) && typeof parsed["version"] === "string") return parsed["version"];
  throw new MissingPackageVersionError();
}

/** A fresh scaffold's `src/` has nothing but the CLAUDE.md guides — no
 *  `.ts`/`.tsx` files — so `tsc -p .` (the box tsconfig's `include: ["src"]`)
 *  fails with TS18003 ("no inputs found") before `cb upgrade` even runs.
 *  Real boxes accumulate schemas/views quickly; the smoke test seeds one so
 *  the typecheck step (which `cb upgrade` also runs) has something real to
 *  check, same as `smoke-external-box.ts`'s WIDGET_SCHEMA. */
const WIDGET_SCHEMA = `import { body, cardSchema } from "callback-box/cards";
import { z } from "callback-box/schema";

export default cardSchema("widget", {
  fields: { size: z.number(), body: body(z.string()) },
});
`;

class SmokeStepError extends Error {
  readonly label: string;
  readonly detail: string;
  constructor(label: string, detail: string) {
    super("A cb-upgrade smoke-test step failed: " + label);
    this.name = "SmokeStepError";
    this.label = label;
    this.detail = detail;
  }
}

class MissingPackageVersionError extends Error {
  constructor() {
    super("Expected a package.json body with a string `version` field");
    this.name = "MissingPackageVersionError";
  }
}

class NoTarballError extends Error {
  readonly dir: string;
  constructor(dir: string) {
    super("No release tarball found — run `pnpm release` first.");
    this.name = "NoTarballError";
    this.dir = dir;
  }
}

interface RunSpec {
  file: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

async function step(label: string, spec: RunSpec): Promise<string> {
  const t0 = process.hrtime.bigint();
  const result = await execa(spec.file, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    reject: false,
    all: true,
  });
  if (result.exitCode !== 0) {
    const command = spec.file + " " + spec.args.join(" ");
    throw new SmokeStepError(label, command + "\n" + (result.all ?? ""));
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  process.stderr.write("[smoke-upgrade] ok: " + label + " (" + (ms / 1000).toFixed(1) + "s)\n");
  return result.stdout ?? "";
}

/** A failing step is EXPECTED here — assert it failed, don't throw. Returns
 *  the combined stdout+stderr so the caller can check exit-code + effects. */
async function expectFailure(label: string, spec: RunSpec): Promise<{ exitCode: number; output: string }> {
  const t0 = process.hrtime.bigint();
  const result = await execa(spec.file, spec.args, { cwd: spec.cwd, env: spec.env, reject: false, all: true });
  if (result.exitCode === 0) {
    throw new SmokeStepError(label, "expected nonzero exit, got 0:\n" + (result.all ?? ""));
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  process.stderr.write(
    "[smoke-upgrade] ok: " + label + " (expected failure, exit " + String(result.exitCode) + ", " +
      (ms / 1000).toFixed(1) + "s)\n"
  );
  return { exitCode: result.exitCode ?? 1, output: result.all ?? "" };
}

async function findLatestTarball(): Promise<string> {
  const dir = path.join(PACKAGE_ROOT, "dist-release");
  let entries: string[];
  try {
    entries = (await readdir(dir)).filter((f) => f.endsWith(".tgz"));
  } catch (_e) {
    entries = [];
  }
  if (entries.length === 0) throw new NoTarballError(dir);
  const withTimes = await Promise.all(
    entries.map(async (f) => ({ f, mtime: (await stat(path.join(dir, f))).mtimeMs }))
  );
  withTimes.sort((a, b) => b.mtime - a.mtime);
  return path.join(dir, withTimes[0]!.f);
}

/** Bump a semver patch version: "0.1.0" -> "0.1.1". */
function bumpPatch(version: string): string {
  const parts = version.split(".");
  const patch = Number(parts[2] ?? "0");
  return [parts[0], parts[1], String(patch + 1)].join(".");
}

/**
 * Derive a second tarball with the SAME built code but a bumped `version` —
 * extract, rewrite `package/package.json`, re-pack. Never touches this
 * repo's real `package.json`.
 */
async function deriveSecondVersionTarball(args: { firstTarball: string; scratchDir: string }): Promise<{ path: string; version: string }> {
  const extractDir = path.join(args.scratchDir, "v2-src");
  await mkdir(extractDir, { recursive: true });
  await step("extract first tarball", {
    file: "tar",
    args: ["xzf", args.firstTarball, "-C", extractDir],
    cwd: args.scratchDir,
  });

  const pkgJsonPath = path.join(extractDir, "package/package.json");
  const parsedPkg: unknown = JSON.parse(await readFile(pkgJsonPath, "utf-8"));
  if (!isRecord(parsedPkg)) throw new MissingPackageVersionError();
  const secondVersion = bumpPatch(requireVersion(parsedPkg));
  parsedPkg["version"] = secondVersion;
  await writeFile(pkgJsonPath, JSON.stringify(parsedPkg, null, 2) + "\n");

  const secondTarball = path.join(args.scratchDir, "callback-box-" + secondVersion + ".tgz");
  await step("repack as v" + secondVersion, {
    file: "tar",
    args: ["czf", secondTarball, "-C", extractDir, "package"],
    cwd: args.scratchDir,
  });
  return { path: secondTarball, version: secondVersion };
}

async function scaffoldBox(args: { tarball: string; boxDir: string }): Promise<void> {
  await step("pnpm dlx <tarball> cb init . (scaffold)", {
    file: "pnpm",
    args: [
      "dlx",
      ...BOX_BUILT_DEPENDENCIES.map((d) => "--allow-build=" + d),
      "--package",
      args.tarball,
      "cb",
      "init",
      ".",
    ],
    cwd: args.boxDir,
    env: { ...process.env, CB_INIT_CALLBACK_BOX_SPEC: "file:" + args.tarball },
  });
  await step("pnpm install (real, replaces the scaffold symlink)", {
    file: "pnpm",
    args: ["install"],
    cwd: args.boxDir,
  });

  await mkdir(path.join(args.boxDir, "src/schemas"), { recursive: true });
  await writeFile(path.join(args.boxDir, "src/schemas/widget.ts"), WIDGET_SCHEMA);

  // Commit everything the scaffold + real install produced (notably
  // pnpm-lock.yaml, which `cb init`'s own commit predates) — `cb upgrade`'s
  // preflight requires a clean tree to snapshot against, same as any real
  // boxholder would need to commit their `pnpm install` before upgrading.
  await step("git add -A (scaffold + install + widget schema)", { file: "git", args: ["add", "-A"], cwd: args.boxDir });
  await step("git commit (scaffold + install + widget schema)", {
    file: "git",
    args: ["commit", "-q", "-m", "pnpm install + widget schema", "--no-verify"],
    cwd: args.boxDir,
  });
}

async function readInstalledVersion(boxDir: string): Promise<string> {
  const raw = await readFile(path.join(boxDir, "node_modules/callback-box/package.json"), "utf-8");
  return requireVersion(JSON.parse(raw));
}

async function main(): Promise<void> {
  const firstTarball = await findLatestTarball();
  const scratchDir = await mkdtemp(path.join(os.tmpdir(), "cb-smoke-upgrade-"));
  const boxDir = path.join(scratchDir, "box");
  process.stderr.write(
    "[smoke-upgrade] first tarball: " + path.relative(PACKAGE_ROOT, firstTarball) +
      "\n[smoke-upgrade] box: " + boxDir + "\n"
  );

  try {
    const { path: secondTarball, version: secondVersion } = await deriveSecondVersionTarball({ firstTarball, scratchDir });

    await mkdir(boxDir, { recursive: true });
    await scaffoldBox({ tarball: firstTarball, boxDir });
    const firstVersion = await readInstalledVersion(boxDir);
    process.stderr.write("[smoke-upgrade] scaffolded at v" + firstVersion + "\n");

    // Absolute, not "node_modules/.bin/cb" — every step below runs with
    // cwd=contentDir (a box's `.bin` is at the PACKAGE root, one level up).
    const cbBin = path.join(boxDir, "node_modules/.bin/cb");
    const contentDir = path.join(boxDir, "content");

    await step("cb upgrade --to <second tarball>", {
      file: cbBin,
      args: ["upgrade", "--to", "file:" + secondTarball],
      cwd: contentDir,
    });

    const installedAfterUpgrade = await readInstalledVersion(boxDir);
    if (installedAfterUpgrade !== secondVersion) {
      const label = "post-upgrade version check";
      throw new SmokeStepError(label, "expected " + secondVersion + ", got " + installedAfterUpgrade);
    }
    process.stderr.write("[smoke-upgrade] ok: installed version is now v" + installedAfterUpgrade + "\n");

    const log = await step("git log -1 --format=%B (trailer check)", {
      file: "git",
      args: ["log", "-1", "--format=%B"],
      cwd: boxDir,
    });
    const expectedTrailer = "Upgraded-To: callback-box@" + secondVersion;
    if (!log.includes(expectedTrailer)) {
      const label = "commit trailer check";
      throw new SmokeStepError(label, "expected to find \"" + expectedTrailer + "\" in:\n" + log);
    }
    process.stderr.write("[smoke-upgrade] ok: commit carries \"" + expectedTrailer + "\"\n");

    // Induce a failure: --to a nonexistent path. This is the preflight
    // assertSpecResolvable check (src/cli/commands/upgrade.ts) — it fails
    // before the snapshot is even taken, so "clean revert" here means
    // nothing changed at all.
    const beforeStatus = await step("git status --porcelain (before induced failure)", {
      file: "git",
      args: ["status", "--porcelain"],
      cwd: boxDir,
    });
    const failure = await expectFailure("cb upgrade --to <nonexistent path> (induced failure)", {
      file: cbBin,
      args: ["upgrade", "--to", "/nonexistent/path/does-not-exist.tgz"],
      cwd: contentDir,
    });
    if (!failure.output.includes("nothing exists at")) {
      const label = "induced-failure message check";
      throw new SmokeStepError(label, "expected the UnresolvableSpecError message, got:\n" + failure.output);
    }
    const afterStatus = await step("git status --porcelain (after induced failure)", {
      file: "git",
      args: ["status", "--porcelain"],
      cwd: boxDir,
    });
    if (afterStatus !== beforeStatus) {
      const label = "clean-revert check";
      throw new SmokeStepError(
        label,
        "git status changed after the failed upgrade:\nbefore:\n" + beforeStatus + "\nafter:\n" + afterStatus
      );
    }
    const installedAfterFailure = await readInstalledVersion(boxDir);
    if (installedAfterFailure !== secondVersion) {
      const label = "clean-revert version check";
      throw new SmokeStepError(label, "expected installed version to remain " + secondVersion + ", got " + installedAfterFailure);
    }
    process.stderr.write("[smoke-upgrade] ok: box untouched by the induced failure\n");

    process.stderr.write("\n[smoke-upgrade] PASS\n");
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
  }
}

await main();
