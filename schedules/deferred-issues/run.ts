import * as fs from "node:fs/promises";
import * as path from "node:path";

import { execa } from "execa";

import { errnoCode } from "../../beebox/src/lib/error-guards.js";

interface ActivationResult {
  public: Array<{ destination: string }>;
  private: Array<{ destination: string }>;
}

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
// SCHEDULE_DRY_RUN is the schedules runner's process-boundary contract; this
// standalone job does not run inside the beebox application's env layer.
const dryRun = process.env["SCHEDULE_DRY_RUN"] === "1";
async function activate(visibility: "public" | "private"): Promise<ActivationResult> {
  if (visibility === "private") {
    const privateRoot = path.join(REPO_ROOT, "private-issues");
    let present: boolean;
    try {
      present = (await fs.stat(privateRoot)).isDirectory();
    } catch (error) {
      if (errnoCode(error) !== "ENOENT") throw error;
      present = false;
    }
    if (!present) return { public: [], private: [] };
  }
  const args = ["activate-due", "--json", "--visibility", visibility];
  if (!dryRun) args.push("--apply");
  const command = [path.join(REPO_ROOT, "bin", "issues"), ...args];
  const result = visibility === "private" && !dryRun
    ? await execa(path.join(REPO_ROOT, "bin", "private-issues"), ["with-lock", REPO_ROOT, ...command])
    : await execa(command[0] ?? "", command.slice(1));
  // eslint-disable-next-line no-restricted-syntax -- JSON from our own CLI is an untyped process boundary; the producer owns this exact result shape.
  return JSON.parse(result.stdout) as ActivationResult;
}

const publicActivation = await activate("public");
const privateActivation = await activate("private");
const activated = {
  public: publicActivation.public,
  private: privateActivation.private,
};
const publicCount = activated.public.length;
const privateCount = activated.private.length;
const total = publicCount + privateCount;

if (total === 0) process.exit(0);

const message = [
  `${String(publicCount)} public and ${String(privateCount)} private issue(s) became active.`,
  ...activated.public.map((move) => `public: ${path.basename(move.destination)}`),
  ...activated.private.map((move) => `private: ${path.basename(move.destination)}`),
].join("\n");

if (dryRun) {
  process.stdout.write(`[deferred-issues] would activate ${String(total)} issue(s)\n${message}\n`);
} else {
  await execa(path.join(REPO_ROOT, "bin", "schedules"), [
    "alert", "--priority", "normal", "--title", "Deferred issues activated", "--message", message,
  ], { stdout: "inherit", stderr: "inherit" });
}
