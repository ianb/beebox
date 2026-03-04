/**
 * Subprocess wrappers for `cb wakeup` (sync) and `cb finalize`.
 *
 * These spawn the `cb` CLI as a child process so the reactor can
 * delegate sync and finalize to the same code paths used by manual
 * CLI invocations. They stream stdout/stderr to the reactor's log
 * callback for visibility.
 */

import { spawn } from "node:child_process";

/**
 * Run `cb wakeup` as a subprocess to sync external sources.
 */
export async function runSync(boxRoot: string, onLog?: (text: string) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("cb", ["wakeup"], {
      cwd: boxRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (data) => {
      onLog?.(data.toString());
    });

    child.stderr.on("data", (data) => {
      onLog?.(data.toString());
    });

    child.on("error", (err) => {
      onLog?.(`Sync error: ${err.message}\n`);
      resolve(false);
    });

    child.on("close", (code) => {
      resolve(code === 0);
    });
  });
}

/**
 * Run `cb finalize` as a subprocess to flush outbound cards.
 */
export async function runFinalize(boxRoot: string, onLog?: (text: string) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("cb", ["finalize"], {
      cwd: boxRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (data: Buffer) => {
      onLog?.(data.toString());
    });

    child.stderr.on("data", (data: Buffer) => {
      onLog?.(data.toString());
    });

    child.on("error", (err) => {
      onLog?.(`Finalize error: ${err.message}\n`);
      resolve(false);
    });

    child.on("close", (code) => {
      resolve(code === 0);
    });
  });
}
