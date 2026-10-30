/**
 * The deploy's check that Chrome keeps its own sandbox inside the box
 * browser's private network namespace (docs/plans/shared-browser.md, Track F,
 * the "Chromium runs without its sandbox" row of Failure modes).
 *
 * That failure is silent: agent-browser adds `--no-sandbox` when it sees uid
 * 0, and Chrome runs either way. So the deploy runs this once per deploy, as a
 * box user inside the box sandbox (`deploy/deploy.sh`), through the same
 * launcher the browser host uses, and fails unless `chrome://sandbox` says
 * "You are adequately sandboxed".
 *
 * It uses a throwaway profile, socket directory and session under the
 * process's own temporary directory, so it never touches the box's browser.
 */

import type { SpawnOptions } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { onUnitHost } from "../../../lib/unit-host.js";
import { errnoCode } from "../../../shared/error-guards.js";
import { agentBrowserBinary } from "../host-process/run.js";
import { resolveBrowserExecutable } from "../install.js";
import { spawnInNamespace } from "./namespace.js";

const CHECK_TIMEOUT_MS = 60_000;
const PIPE_DRAIN_MS = 1000;
/** `chrome://sandbox` says "You are not adequately sandboxed." on failure, so the match includes "You are". */
const SANDBOXED = /You are adequately sandboxed/;

/**
 * The namespaced command. `$0` is the agent-browser binary; each step runs
 * only if the one before it passed, and `close` runs regardless.
 */
export const SANDBOX_CHECK_SCRIPT = [
  'ab="$0"',
  '"$ab" open chrome://sandbox && "$ab" wait --text "adequately sandboxed" && "$ab" get text body',
  "rc=$?",
  '"$ab" close >/dev/null 2>&1',
  'exit "$rc"',
].join("\n");

export interface SandboxCheckResult {
  readonly ok: boolean;
  /** Everything the namespaced command printed, for the deploy log on failure. */
  readonly output: string;
}

/** Whether the page text says Chrome is sandboxed. */
export function sandboxPageSaysSandboxed(text: string): boolean {
  return SANDBOXED.test(text);
}

export async function checkBrowserSandbox(): Promise<SandboxCheckResult> {
  if (!onUnitHost()) return { ok: false, output: "the sandbox check runs only on a unit host (BBX_UNIT_HOST=1), where the launcher exists" };
  const executable = resolveBrowserExecutable({ unitHost: true });
  if (!executable.ok) return { ok: false, output: executable.reason };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-browser-sandbox-check-"));
  try {
    const config = path.join(dir, "config.json");
    await fs.writeFile(config, "{}\n", { mode: 0o600 });
    const env: Record<string, string> = {
      AGENT_BROWSER_CONFIG: config,
      AGENT_BROWSER_SOCKET_DIR: path.join(dir, "sockets"),
      AGENT_BROWSER_SESSION: "sandbox-check",
      AGENT_BROWSER_IDLE_TIMEOUT_MS: "10000",
      HOME: dir,
      PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
      ...(executable.executablePath === undefined ? {} : { AGENT_BROWSER_EXECUTABLE_PATH: executable.executablePath }),
    };
    const command = ["sh", "-c", SANDBOX_CHECK_SCRIPT, agentBrowserBinary()];
    const options: SpawnOptions = { cwd: dir, env, detached: true, stdio: ["ignore", "pipe", "pipe"] };
    const child = await spawnInNamespace(command, options);
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
    child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
    const code = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => {
        output += `\n(timed out after ${String(CHECK_TIMEOUT_MS)} ms)`;
        try {
          if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
        } catch (e) {
          // ESRCH: the group exited between the timer firing and here.
          if (errnoCode(e) !== "ESRCH") throw e;
        }
      }, CHECK_TIMEOUT_MS);
      // The daemon agent-browser detaches may hold the pipes open past the
      // shell's exit, so `close` alone could wait for its idle timeout: take
      // the exit, and give the pipes a moment to drain.
      child.on("exit", (exitCode) => {
        clearTimeout(timer);
        const drained = setTimeout(() => resolve(exitCode), PIPE_DRAIN_MS);
        child.on("close", () => {
          clearTimeout(drained);
          resolve(exitCode);
        });
      });
    });
    child.stdout?.destroy();
    child.stderr?.destroy();
    return { ok: code === 0 && sandboxPageSaysSandboxed(output), output };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
