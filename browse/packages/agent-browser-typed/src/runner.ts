import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { constants as osConstants } from "node:os";
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

/** Whole seconds, rounded to the nearest, for "killed by SIGTERM after 62 s". */
function seconds(elapsedMs: number): string {
  return String(Math.round(elapsedMs / 1000));
}

/**
 * What to tell a caller when the client ended by a signal: the command, the
 * signal, how long it ran, and any output it left. A signal gives no exit code,
 * so without this the failure reads as an empty exit 1.
 */
export function describeSignal({ args, signal, elapsedMs, output }: { args: readonly string[]; signal: string; elapsedMs: number; output: string }): string {
  const tail = output.trim() === "" ? "" : `: ${output.trim()}`;
  return `${args[0] ?? "agent-browser"} killed by ${signal} after ${seconds(elapsedMs)} s${tail}`;
}

export class AgentBrowserError extends Error {
  readonly code: number;
  readonly stderr: string;
  readonly stdout: string;
  readonly args: readonly string[];
  /** The signal that ended the client, or null when it exited (or was killed by our own timeout). */
  readonly signal: string | null;
  /** True when `timeoutMs` elapsed and this wrapper killed the client: upstream never answered. */
  readonly timedOut: boolean;
  constructor({ code, stderr, stdout, args, signal, elapsedMs, timedOut }: {
    code: number; stderr: string; stdout: string; args: readonly string[]; signal?: string | null; elapsedMs?: number; timedOut?: boolean;
  }) {
    const output = stderr.trim() || stdout.trim();
    super(signal === undefined || signal === null
      ? `agent-browser exited ${code}: ${output || "upstream gave no output"}`
      : describeSignal({ args, signal, elapsedMs: elapsedMs ?? 0, output }));
    this.name = "AgentBrowserError";
    this.code = code;
    this.stderr = stderr;
    this.stdout = stdout;
    this.args = args;
    this.signal = signal ?? null;
    this.timedOut = timedOut ?? false;
  }

  /** Text for a caller to print: never empty, names the cause or says upstream gave none. */
  get report(): string {
    return this.message;
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

/**
 * SIGKILL the shim and the native client it spawned. `agent-browser.js`
 * spawns the client with inherited stdio, so killing only the shim left the
 * client holding our pipes: `close` waited out its 152 s of re-sends and the
 * ceiling never fired early. The client stays in our process group, so a
 * Ctrl-C still reaches it.
 */
function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  let children: number[] = [];
  try {
    children = execFileSync("pgrep", ["-P", String(pid)], { encoding: "utf8" }).split("\n").filter((l) => l !== "").map(Number);
  } catch {
    // pgrep exits 1 when there are no children.
  }
  for (const target of [...children, pid]) {
    try {
      process.kill(target, "SIGKILL");
    } catch {
      // ESRCH: already exited.
    }
  }
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
    const started = Date.now();
    const timer = opts.timeoutMs === undefined ? null : setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, opts.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.on("error", (e) => { if (timer !== null) clearTimeout(timer); reject(e); });
    child.on("close", (code, signal) => {
      if (timer !== null) clearTimeout(timer);
      if (timedOut) {
        reject(new AgentBrowserError({ code: -1, stderr: `killed after ${String(opts.timeoutMs)}ms`, stdout, args, timedOut: true }));
        return;
      }
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new AgentBrowserError({ code: code === null ? -1 : code, stderr, stdout, args, signal, elapsedMs: Date.now() - started }));
    });
  });
}

export async function runPassthrough(args: readonly string[]): Promise<number> {
  const binary = resolveBinary();
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn("node", [binary, ...args], { stdio: "inherit" });
    child.on("error", (e) => reject(e));
    child.on("close", (code, signal) => {
      if (code === null) {
        // Ended by a signal: say so, since the inherited stdio carried nothing.
        const named = signal ?? "an unknown signal";
        process.stderr.write(`browse: ${describeSignal({ args, signal: named, elapsedMs: Date.now() - started, output: "" })}\n`);
        resolve(signal === null ? 1 : 128 + (osConstants.signals[signal as NodeJS.Signals] ?? 0));
        return;
      }
      resolve(code);
    });
  });
}
