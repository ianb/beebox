/**
 * Running the pinned agent-browser for the box browser host
 * (docs/plans/shared-browser.md, Track B).
 *
 * The binary is the native one inside the installed `agent-browser` package,
 * not its Node wrapper, so the host's children are the processes the stale
 * cleanup and `bin/process-cleanup.ts` see.
 *
 * The environment is built from nothing. An explicit `AGENT_BROWSER_CONFIG`
 * replaces discovery of `~/.agent-browser/config.json` and
 * `./agent-browser.json`, so a stray config file cannot add `--no-sandbox`
 * or another profile; nothing else from the engine's environment reaches it
 * except `HOME` and `PATH`.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import * as path from "node:path";
import { PACKAGE_ROOT } from "../../../lib/package-root.js";
import { BOX_BROWSER_SESSION, type BrowserPaths } from "../paths.js";

/** The pinned package's native binary for this platform is missing. */
export class AgentBrowserBinaryMissingError extends Error {
  override name = "AgentBrowserBinaryMissingError";
  constructor(readonly binary: string) {
    super(`agent-browser has no binary for this platform: ${binary} does not exist`);
  }
}

/** The native agent-browser binary of the package beebox depends on. */
export function agentBrowserBinary(): string {
  const packageJson = createRequire(path.join(PACKAGE_ROOT, "package.json")).resolve("agent-browser/package.json");
  const binary = path.join(path.dirname(packageJson), "bin", `agent-browser-${process.platform}-${process.arch}`);
  if (!existsSync(binary)) throw new AgentBrowserBinaryMissingError(binary);
  return binary;
}

export interface DashboardEnvInput {
  readonly paths: BrowserPaths;
  readonly boxRoot: string;
  /** From `resolveBrowserExecutable`; undefined lets agent-browser choose. */
  readonly executablePath: string | undefined;
  /** The host's own `HOME` and `PATH`. */
  readonly home: string;
  readonly pathVar: string;
}

/** The whole environment agent-browser runs with. */
export function dashboardEnv({ paths, boxRoot, executablePath, home, pathVar }: DashboardEnvInput): Record<string, string> {
  return {
    AGENT_BROWSER_CONFIG: paths.config,
    AGENT_BROWSER_SOCKET_DIR: paths.socketDir,
    AGENT_BROWSER_SESSION: BOX_BROWSER_SESSION,
    AGENT_BROWSER_PROFILE: paths.profile,
    ...(executablePath === undefined ? {} : { AGENT_BROWSER_EXECUTABLE_PATH: executablePath }),
    AGENT_BROWSER_DOWNLOAD_PATH: paths.downloads,
    AGENT_BROWSER_SCREENSHOT_DIR: path.join(boxRoot, "_tmp", "browser"),
    AGENT_BROWSER_CONTENT_BOUNDARIES: "1",
    AGENT_BROWSER_MAX_OUTPUT: "60000",
    AGENT_BROWSER_IDLE_TIMEOUT_MS: "1800000",
    HOME: home,
    PATH: pathVar,
  };
}

export interface AgentBrowserRun {
  readonly code: number;
  readonly output: string;
}

const RUN_TIMEOUT_MS = 30_000;
const execFileAsync = promisify(execFile);

/** Run one agent-browser command to completion; a non-zero exit is returned, not thrown. */
export async function runAgentBrowser(args: readonly string[], options: { env: Record<string, string>; cwd: string }): Promise<AgentBrowserRun> {
  try {
    const { stdout, stderr } = await execFileAsync(agentBrowserBinary(), [...args], {
      env: options.env, cwd: options.cwd, timeout: RUN_TIMEOUT_MS, killSignal: "SIGKILL", encoding: "utf8",
    });
    return { code: 0, output: `${stdout}${stderr}`.trim() };
  } catch (e) {
    if (!isExecFailure(e)) throw e;
    const output = `${e.stdout ?? ""}${e.stderr ?? ""}`.trim();
    return { code: typeof e.code === "number" ? e.code : -1, output: output === "" ? e.message : output };
  }
}

interface ExecFailure extends Error {
  readonly code?: number | string;
  readonly stdout?: string;
  readonly stderr?: string;
}

function isExecFailure(e: unknown): e is ExecFailure {
  return e instanceof Error && ("stdout" in e || "code" in e);
}
