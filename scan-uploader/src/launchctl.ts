/**
 * The real, process-spawning implementation of `LaunchctlRunner`
 * (`schedule.ts`). Isolated here so `schedule.ts` and its doctests never
 * need to actually invoke `launchctl` — tests inject a fake runner instead.
 */

import { spawn } from "node:child_process";

import type { LaunchctlResult, LaunchctlRunner } from "./schedule.js";

export class RealLaunchctlRunner implements LaunchctlRunner {
  run(args: readonly string[]): Promise<LaunchctlResult> {
    return new Promise((resolve) => {
      const child = spawn("launchctl", args, { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf-8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf-8");
      });
      child.on("error", (error) => {
        resolve({ code: 1, stdout, stderr: `${stderr}${error.message}` });
      });
      child.on("close", (code) => {
        resolve({ code: code ?? 1, stdout, stderr });
      });
    });
  }
}
