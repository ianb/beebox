#!/usr/bin/env tsx
/**
 * The plan's first hard gate (Track F, "Implementation order" item 5 in
 * `docs/plans/boxes-as-packages-v2.md`): "a fresh external v2 box, scaffolded
 * in a temp dir against the tarball, must import every public export,
 * typecheck, pass `cb validate`, and serve its `content/` — before any hub,
 * fleet, or migration work proceeds."
 *
 * Runs entirely OUTSIDE this repo (a temp dir under `os.tmpdir()`), with zero
 * monorepo context: no workspace `pnpm-workspace.yaml`, no hoisted
 * `node_modules`, nothing but the released tarball. This is deliberately the
 * SAME sequence a stranger's README would document — see the printed
 * "Stranger sequence" block at the end, which is the authoritative source for
 * what that doc should say (chicken-and-egg: `cb init` needs a `cb` binary,
 * but a `cb` binary needs a `package.json` `cb init` hasn't written yet —
 * `pnpm dlx` breaks the cycle by running the tarball's `cb` from a disposable
 * install, then a real `pnpm install` resolves the dependency `cb init`
 * wrote and replaces the dev-convenience `node_modules/callback-box` symlink
 * `scaffoldPackageRoot` created — see that function's doc in
 * `src/core/box-package.ts`).
 *
 * Quiet on success (one summary line per step); full stdout+stderr from any
 * failed step surfaces immediately and the script exits nonzero.
 */

import { execa, type Subprocess } from "execa";
import { mkdtemp, mkdir, writeFile, rm, readdir, stat } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { PACKAGE_ROOT } from "../src/lib/package-root.js";

/** Native-module deps whose install scripts a fresh `pnpm install`/`dlx` must
 *  be told to trust (pnpm 10 blocks all of them by default) — kept in sync
 *  with the `pnpm.onlyBuiltDependencies` list `scaffoldPackageRoot` writes
 *  into the box's own `package.json` (`src/core/box-package.ts`). The `dlx`
 *  step below needs its own copy of this list because it runs BEFORE that
 *  package.json exists. */
const BUILT_DEPENDENCIES = ["better-sqlite3", "esbuild", "@google/genai", "protobufjs"];

/** A gate step (command or assertion) failed. `label` names the step;
 *  `detail` carries the full diagnostic (command line, stdout/stderr, or
 *  assertion context) — kept out of `message` so this satisfies the
 *  no-literal/template-error-message lint rule the same way
 *  `src/core/box-package.ts`'s `BoxPackageConflictError` does (string
 *  concatenation, not a template literal, at the throw site). */
class SmokeStepError extends Error {
  readonly label: string;
  readonly detail: string;
  constructor(label: string, detail: string) {
    super("A release smoke-test step failed: " + label);
    this.name = "SmokeStepError";
    this.label = label;
    this.detail = detail;
  }
}

/** No `dist-release/*.tgz` to smoke-test — `pnpm release` hasn't run. */
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

/** Run one gate step, timing it and throwing with full output on failure. */
async function step(label: string, spec: RunSpec): Promise<void> {
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
  process.stderr.write("[smoke] ok: " + label + " (" + (ms / 1000).toFixed(1) + "s)\n");
}

/** Find the most recently built tarball in `dist-release/`. */
async function findTarball(): Promise<string> {
  const dir = path.join(PACKAGE_ROOT, "dist-release");
  let entries: string[];
  try {
    entries = (await readdir(dir)).filter((f) => f.endsWith(".tgz"));
  } catch (_e) {
    entries = [];
  }
  if (entries.length === 0) {
    throw new NoTarballError(dir);
  }
  const withTimes = await Promise.all(
    entries.map(async (f) => ({ f, mtime: (await stat(path.join(dir, f))).mtimeMs }))
  );
  withTimes.sort((a, b) => b.mtime - a.mtime);
  return path.join(dir, withTimes[0]!.f);
}

/** The `callback-box` package's own exports map — every key here is a public
 *  export the gate must prove importable, except the non-JS tsconfig entry. */
async function publicExportSpecifiers(): Promise<string[]> {
  const raw = await import(path.join(PACKAGE_ROOT, "package.json"), { with: { type: "json" } });
  const exportsMap = (raw.default as { exports: Record<string, unknown> }).exports;
  return Object.keys(exportsMap)
    .filter((key) => key !== "./tsconfig.base.json")
    .map((key) => (key === "." ? "callback-box" : "callback-box" + key.slice(1)));
}

const WIDGET_SCHEMA = `import { body, cardSchema } from "callback-box/cards";
import { z } from "callback-box/schema";

export default cardSchema("widget", {
  fields: { size: z.number(), body: body(z.string()) },
});
`;

const WIDGET_VIEW = `export const name = "Widget";
export const description = "Trivial smoke-test view.";
export const dependencies: string[] = [];
export const modes = ["page"];
export const rendersCardTypes = ["widget"];

export default function Widget({ boxSlug }: { boxSlug: string }) {
  return <div>Widget view for {boxSlug}</div>;
}
`;

interface WaitForStatusArgs {
  url: string;
  expectStatus: number;
  timeoutMs: number;
  headers?: Record<string, string>;
}

/** Poll a URL until it returns the expected status or the timeout elapses. */
async function waitForStatus(args: WaitForStatusArgs): Promise<Response> {
  const deadline = Date.now() + args.timeoutMs;
  let lastDetail = "no attempt succeeded";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(args.url, { headers: args.headers });
      if (response.status === args.expectStatus) return response;
      lastDetail = args.url + " returned " + String(response.status);
    } catch (e) {
      lastDetail = args.url + " errored: " + String(e);
    }
    await sleep(200);
  }
  throw new SmokeStepError("waitForStatus(" + args.url + ")", lastDetail);
}

async function scaffold(args: { tarball: string; boxDir: string }): Promise<void> {
  // Step 1: scaffold via a disposable `pnpm dlx` install of the tarball —
  // this is the ONLY way to get a `cb` binary before `cb init` has written a
  // package.json for a real install to resolve against.
  await step("pnpm dlx <tarball> cb init . (scaffold)", {
    file: "pnpm",
    args: [
      "dlx",
      ...BUILT_DEPENDENCIES.map((d) => "--allow-build=" + d),
      "--package",
      args.tarball,
      "cb",
      "init",
      ".",
    ],
    cwd: args.boxDir,
    env: { ...process.env, CB_INIT_CALLBACK_BOX_SPEC: "file:" + args.tarball },
  });

  // Step 2: the real install — resolves the `file:<tarball>` dependency
  // `cb init` wrote and replaces the scaffold's dev-convenience symlink.
  await step("pnpm install (real, replaces the scaffold symlink)", {
    file: "pnpm",
    args: ["install"],
    cwd: args.boxDir,
  });
}

async function importEveryPublicExport(boxDir: string): Promise<void> {
  const specifiers = await publicExportSpecifiers();
  const importScript = specifiers.map((s) => "await import(" + JSON.stringify(s) + ");").join("\n");
  const scriptPath = path.join(boxDir, "_smoke-imports.mjs");
  await writeFile(scriptPath, importScript);
  try {
    await step("import every public export (" + specifiers.join(", ") + ")", {
      file: "node",
      args: ["--disable-warning=DEP0040", "_smoke-imports.mjs"],
      cwd: boxDir,
    });
  } finally {
    await rm(scriptPath, { force: true });
  }
}

async function typecheck(boxDir: string): Promise<void> {
  // Something real to typecheck — a trivial schema + view in src/.
  await mkdir(path.join(boxDir, "src/schemas"), { recursive: true });
  await mkdir(path.join(boxDir, "src/views"), { recursive: true });
  await writeFile(path.join(boxDir, "src/schemas/widget.ts"), WIDGET_SCHEMA);
  await writeFile(path.join(boxDir, "src/views/widget.tsx"), WIDGET_VIEW);

  await step("pnpm exec tsc (box tsconfig extends callback-box/tsconfig.base.json)", {
    file: "node_modules/.bin/tsc",
    args: ["-p", "."],
    cwd: boxDir,
  });
}

async function validate(contentDir: string): Promise<void> {
  // The engine's own view/ViewProps boundary check.
  await step("cb view typecheck", {
    file: "../node_modules/.bin/cb",
    args: ["view", "typecheck"],
    cwd: contentDir,
  });
  await step("cb validate --all", {
    file: "../node_modules/.bin/cb",
    args: ["validate", "--all"],
    cwd: contentDir,
  });
}

/** Boot `cb serve`, hit `/healthz` and the box's own health check, then
 *  SIGTERM and confirm a clean shutdown. */
const SERVE_STEP_LABEL = "cb serve";
const SERVE_SHUTDOWN_STEP_LABEL = "cb serve shutdown";

async function serveAndProbe(args: { boxDir: string; port: number }): Promise<void> {
  const diagKey = "smoke-test-diag-key";
  const cbServe: Subprocess = execa(
    "node_modules/.bin/cb",
    ["serve", "content", "--port", String(args.port)],
    { cwd: args.boxDir, env: { ...process.env, CB_DIAG_API_KEY: diagKey }, reject: false, all: true }
  );
  try {
    const t0 = process.hrtime.bigint();
    const crashed = cbServe.then((result) => {
      throw new SmokeStepError(SERVE_STEP_LABEL, "server exited early:\n" + (result.all ?? ""));
    });
    await Promise.race([
      waitForStatus({
        url: "http://localhost:" + String(args.port) + "/healthz",
        headers: { Authorization: "Bearer " + diagKey },
        expectStatus: 200,
        timeoutMs: 15000,
      }),
      crashed,
    ]);
    // The box's slug is the basename of the dir passed to `cb serve`
    // ("content") — this IS the plan's "serve its content/" literally: no
    // Track G slug-derivation exists yet, so the slug a real README would
    // reference today is whatever basename `content/` has.
    const boxHealthUrl = "http://localhost:" + String(args.port) + "/content/api/trpc/health.check";
    const boxHealthResponse = await waitForStatus({ url: boxHealthUrl, expectStatus: 200, timeoutMs: 5000 });
    const boxHealthBody = (await boxHealthResponse.json()) as { result?: { data?: { status?: string } } };
    const boxStatus = boxHealthBody.result?.data?.status;
    if (!boxStatus) {
      throw new SmokeStepError(SERVE_STEP_LABEL, "unexpected /content/api/trpc/health.check body: " + JSON.stringify(boxHealthBody));
    }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    process.stderr.write(
      "[smoke] ok: cb serve — /healthz 200, /content/api/trpc/health.check 200 (status: " +
        boxStatus + ") (" + (ms / 1000).toFixed(1) + "s)\n"
    );

    cbServe.kill("SIGTERM");
    const serveResult = await cbServe;
    if (serveResult.signal !== "SIGTERM" && serveResult.exitCode !== 0) {
      throw new SmokeStepError(
        SERVE_SHUTDOWN_STEP_LABEL,
        "unexpected exit: " + JSON.stringify({ signal: serveResult.signal, exitCode: serveResult.exitCode }) +
          "\n" + (serveResult.all ?? "")
      );
    }
    process.stderr.write("[smoke] ok: cb serve — clean SIGTERM shutdown\n");
  } finally {
    if (cbServe.exitCode === null) cbServe.kill("SIGKILL");
  }
}

async function main(): Promise<void> {
  const tarball = await findTarball();
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "cb-smoke-"));
  const boxDir = path.join(tmpRoot, "smoke-box");
  const contentDir = path.join(boxDir, "content");
  const port = 20000 + Math.floor(Math.random() * 20000);
  process.stderr.write(
    "[smoke] tarball: " + path.relative(PACKAGE_ROOT, tarball) + "\n[smoke] box: " + boxDir + "\n"
  );

  try {
    await mkdir(boxDir, { recursive: true });
    await scaffold({ tarball, boxDir });
    await importEveryPublicExport(boxDir);
    await typecheck(boxDir);
    await validate(contentDir);
    await serveAndProbe({ boxDir, port });

    process.stderr.write(
      "\n[smoke] Stranger sequence (what a README should say):\n" +
        "  mkdir my-box && cd my-box\n" +
        "  pnpm dlx --package=<callback-box tarball URL> cb init .\n" +
        "  pnpm install\n" +
        "  pnpm exec cb serve content\n\n"
    );
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
}

await main();
