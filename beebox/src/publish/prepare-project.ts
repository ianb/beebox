/** Runs the fixed package-project preparation contract for published sites. */

import { constants } from "node:fs";
import { lstat, mkdir, open, rm } from "node:fs/promises";
import path from "node:path";

import { errorMessage } from "../lib/error-guards.js";
import { CommandFailedError, CommandTimedOutError, execWithTimeout } from "../lib/exec-with-timeout.js";
import { PUBLICATION_COMMAND_TIMEOUT_MS, type PrepareDeps, type ProjectCommandRequest } from "./prepare-types.js";
import { BundlePolicyError, bundlePolicyError, projectCommandError } from "./prepare-errors.js";

function sanitizedCommandDiagnostic(error: unknown): string {
  let message = errorMessage(error)
    .replace(/\b((?:cloudflare_\w+|\w*token|\w*key))=\S+/gi, "$1=[redacted]")
    .replace(/\b(?:aiza[\w-]{35}|sk-[\w-]{20,}|gh[oprsu]_[\da-z]{20,}|xox[bp]-[\da-z-]{10,})\b/gi, "[redacted credential]")
    .replace(/\bbearer\s+\S+/gi, "Bearer [redacted]");
  if (error instanceof CommandFailedError) message = message.replace(/Command failed with exit code (\d+)/, "pnpm exited with code $1");
  return message.slice(-2_000);
}

function commandEnvironment(args: { parent: NodeJS.ProcessEnv; taskHome: string; taskTmp: string }): NodeJS.ProcessEnv {
  const { parent, taskHome, taskTmp } = args;
  const env: NodeJS.ProcessEnv = {
    PATH: parent.PATH ?? "/usr/bin:/bin",
    HOME: taskHome,
    TMPDIR: taskTmp,
    TMP: taskTmp,
    TEMP: taskTmp,
    LANG: parent.LANG ?? "C.UTF-8",
  };
  if (parent.LC_ALL !== undefined) env.LC_ALL = parent.LC_ALL;
  if (parent.LC_CTYPE !== undefined) env.LC_CTYPE = parent.LC_CTYPE;
  return env;
}

async function runPnpm(request: ProjectCommandRequest): Promise<void> {
  const command = request.step === "install" ? "pnpm install --frozen-lockfile" : "pnpm run build";
  await execWithTimeout(command, {
    cwd: request.cwd,
    // The helper always retains bounded stdout/stderr tails in failures; "ignore"
    // only suppresses mirroring those captured diagnostics to the parent.
    stdio: "ignore",
    timeout: request.timeoutMs,
    env: request.env,
  });
}

async function requireRegularProjectFile(projectRoot: string, filename: string): Promise<void> {
  const file = path.join(projectRoot, filename);
  let info;
  try {
    info = await lstat(file);
  } catch (error) {
    throw bundlePolicyError(`project is missing ${filename}: ${errorMessage(error)}`);
  }
  if (info.isSymbolicLink() || !info.isFile()) throw bundlePolicyError(`project ${filename} must be a regular file`);
}

async function cleanDist(projectRoot: string): Promise<string> {
  const dist = path.join(projectRoot, "dist");
  try {
    const info = await lstat(dist);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw bundlePolicyError("project dist/ must be a real directory when present");
    }
    await rm(dist, { recursive: true });
  } catch (error) {
    if (error instanceof BundlePolicyError) throw error;
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  return dist;
}

/** Install locked dependencies and run the project's conventional build script. */
export async function prepareProject(args: { projectRoot: string; taskRoot: string; deps: PrepareDeps }): Promise<void> {
  const { projectRoot, taskRoot, deps } = args;
  const projectInfo = await lstat(projectRoot);
  if (projectInfo.isSymbolicLink() || !projectInfo.isDirectory()) throw bundlePolicyError("project/ must be a real directory");
  await requireRegularProjectFile(projectRoot, "package.json");
  await requireRegularProjectFile(projectRoot, "pnpm-lock.yaml");
  let packageJson: unknown;
  const packageHandle = await open(path.join(projectRoot, "package.json"), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    packageJson = JSON.parse(await packageHandle.readFile("utf-8"));
  } catch (error) {
    throw bundlePolicyError(`project package.json is invalid: ${errorMessage(error)}`);
  } finally {
    await packageHandle.close();
  }
  const scripts = typeof packageJson === "object" && packageJson !== null && "scripts" in packageJson ? packageJson.scripts : undefined;
  if (typeof scripts !== "object" || scripts === null || !("build" in scripts) || typeof scripts.build !== "string" || scripts.build.trim() === "") {
    throw bundlePolicyError("project package.json must define a non-empty scripts.build command");
  }

  const dist = await cleanDist(projectRoot);
  const home = path.join(taskRoot, "home");
  const tmp = path.join(taskRoot, "tmp");
  await mkdir(home, { recursive: true });
  await mkdir(tmp, { recursive: true });
  const env = commandEnvironment({ parent: deps.parentEnv ?? process.env, taskHome: home, taskTmp: tmp });
  const run = deps.runProjectCommand ?? runPnpm;

  for (const step of ["install", "build"] as const) {
    try {
      await run({ step, cwd: projectRoot, env, timeoutMs: PUBLICATION_COMMAND_TIMEOUT_MS });
    } catch (error) {
      throw projectCommandError({ step, timedOut: error instanceof CommandTimedOutError, message: sanitizedCommandDiagnostic(error) });
    }
  }
  const distInfo = await lstat(dist).catch((error: unknown) => {
    throw bundlePolicyError(`project build did not produce dist/: ${errorMessage(error)}`);
  });
  if (distInfo.isSymbolicLink() || !distInfo.isDirectory()) throw bundlePolicyError("project build output dist/ must be a real directory");
}
