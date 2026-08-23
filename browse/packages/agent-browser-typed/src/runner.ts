import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

let cachedBinary: string | null = null;

function resolveBinary(): string {
  if (cachedBinary !== null) return cachedBinary;
  const pkgPath = require.resolve("agent-browser/package.json");
  const pkgDir = dirname(pkgPath);
  cachedBinary = join(pkgDir, "bin", "agent-browser.js");
  return cachedBinary;
}

export class AgentBrowserError extends Error {
  readonly code: number;
  readonly stderr: string;
  readonly stdout: string;
  readonly args: readonly string[];
  constructor({ code, stderr, stdout, args }: { code: number; stderr: string; stdout: string; args: readonly string[] }) {
    super(`agent-browser exited ${code}: ${stderr.trim() || stdout.trim() || "(no output)"}`);
    this.name = "AgentBrowserError";
    this.code = code;
    this.stderr = stderr;
    this.stdout = stdout;
    this.args = args;
  }
}

export interface RunResult {
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  /** Extra environment for the child, merged over `process.env`. */
  env?: Readonly<Record<string, string>>;
  /**
   * Wall-clock ceiling. The child is killed and the call rejects when it
   * elapses. A backstop, not a scheduling knob: the upstream binary has its
   * own per-action timeout, and this exists because a command that ignores it
   * (`wait --fn` does — measured on 0.27.0) would otherwise hang the wrapper
   * forever, which is exactly how `screenshot` and `snapshot` became
   * unusable.
   */
  timeoutMs?: number;
}

export async function run(args: readonly string[], options?: RunOptions): Promise<RunResult> {
  const binary = resolveBinary();
  const opts: RunOptions = options === undefined ? {} : options;
  return new Promise((resolve, reject) => {
    const env = opts.env === undefined ? process.env : { ...process.env, ...opts.env };
    const child = spawn("node", [binary, ...args], { stdio: ["ignore", "pipe", "pipe"], env });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = opts.timeoutMs === undefined ? null : setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.on("error", (e) => { if (timer !== null) clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      if (timer !== null) clearTimeout(timer);
      if (timedOut) {
        reject(new AgentBrowserError({ code: -1, stderr: `killed after ${String(opts.timeoutMs)}ms`, stdout, args }));
        return;
      }
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new AgentBrowserError({ code: code === null ? -1 : code, stderr, stdout, args }));
    });
  });
}

export async function runPassthrough(args: readonly string[]): Promise<number> {
  const binary = resolveBinary();
  return new Promise((resolve, reject) => {
    const child = spawn("node", [binary, ...args], { stdio: "inherit" });
    child.on("error", (e) => reject(e));
    child.on("close", (code) => resolve(code === null ? 1 : code));
  });
}
