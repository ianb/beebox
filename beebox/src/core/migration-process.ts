/** Migration subprocess lifetime: cancellation finishes before ownership releases. */
import { spawn } from "node:child_process";
import { errnoCode } from "../lib/error-guards.js";

export async function runMigrationProcess(opts: {
  file: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv;
  signal?: AbortSignal | undefined; diagnosticsToStderr?: boolean | undefined;
  onOutput?: ((text: string) => void) | undefined;
}): Promise<number> {
  opts.signal?.throwIfAborted();
  const child = spawn(opts.file, opts.args, {
    cwd: opts.cwd, env: opts.env, detached: true, stdio: ["inherit", "pipe", "pipe"],
  });
  const kill = (signal: NodeJS.Signals): void => {
    if (child.pid === undefined) return;
    try { process.kill(-child.pid, signal); }
    catch (error) {
      if (errnoCode(error) !== "ESRCH") throw error;
      // The complete process group already exited.
    }
  };
  let termination: Promise<void> | undefined;
  let interrupted: "SIGTERM" | "SIGINT" | undefined;
  const terminate = (graceMs: number): void => {
    if (termination) return;
    kill("SIGTERM");
    termination = new Promise((resolve) => {
      setTimeout(() => { kill("SIGKILL"); resolve(); }, graceMs);
    });
  };
  const onAbort = (): void => terminate(5_000);
  // Finish before an enclosing schedule's five-second escalation kills us.
  const onTerm = (): void => { interrupted = "SIGTERM"; terminate(2_500); };
  const onInt = (): void => { interrupted = "SIGINT"; terminate(2_500); };
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  process.once("SIGTERM", onTerm);
  process.once("SIGINT", onInt);
  child.stdout.on("data", (chunk: Buffer) => {
    opts.onOutput?.(chunk.toString());
    (opts.diagnosticsToStderr ? process.stderr : process.stdout).write(chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    opts.onOutput?.(chunk.toString()); process.stderr.write(chunk);
  });
  let spawnError: Error | undefined;
  child.on("error", (error) => { spawnError = error; });
  try {
    const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
    await termination;
    if (interrupted) process.exit(interrupted === "SIGTERM" ? 143 : 130);
    opts.signal?.throwIfAborted();
    if (spawnError) throw spawnError;
    return code ?? 1;
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
    process.removeListener("SIGTERM", onTerm);
    process.removeListener("SIGINT", onInt);
  }
}
