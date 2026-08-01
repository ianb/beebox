/**
 * Per-folder disposition, applied only after a confirmed server response and
 * a restat proving the file hasn't changed since it was hashed (see
 * run-target.ts). Never `unlink`: `keep` leaves the file, `archive` renames
 * it into `<folder>/imported/`, `trash` moves it to the OS Trash (recoverable).
 */

import { mkdir, rename, stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { spawn } from "node:child_process";

import { errorMessage, isErrnoException } from "./error-guards.js";
import { TrashError } from "./errors.js";
import type { Disposition } from "./config.js";

export async function applyDisposition(filePath: string, disposition: Disposition): Promise<void> {
  if (disposition === "keep") return;
  if (disposition === "archive") {
    await archiveFile(filePath);
    return;
  }
  await trashFile(filePath);
}

async function archiveFile(filePath: string): Promise<void> {
  const importedDir = join(dirname(filePath), "imported");
  await mkdir(importedDir, { recursive: true });
  const dest = await uniqueDestination(importedDir, basename(filePath));
  await rename(filePath, dest);
}

async function uniqueDestination(dir: string, name: string): Promise<string> {
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = join(dir, name);
  let attempt = 1;
  while (await pathExists(candidate)) {
    attempt += 1;
    candidate = join(dir, `${stem}-${String(attempt)}${ext}`);
  }
  return candidate;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (e) {
    if (isErrnoException(e) && e.code === "ENOENT") return false;
    throw e;
  }
}

async function trashFile(filePath: string): Promise<void> {
  const cli = await runCommand("trash", [filePath]);
  if (cli.error !== undefined) {
    if (isErrnoException(cli.error) && cli.error.code === "ENOENT") {
      await trashViaFinder(filePath);
      return;
    }
    throw new TrashError(filePath, errorMessage(cli.error));
  }
  if (cli.code !== 0) {
    throw new TrashError(filePath, `trash exited with code ${String(cli.code)}`);
  }
}

async function trashViaFinder(filePath: string): Promise<void> {
  const script = `tell application "Finder" to delete POSIX file "${escapeAppleScriptString(filePath)}"`;
  const result = await runCommand("osascript", ["-e", script]);
  if (result.error !== undefined) {
    throw new TrashError(filePath, errorMessage(result.error));
  }
  if (result.code !== 0) {
    throw new TrashError(filePath, `osascript exited with code ${String(result.code)}`);
  }
}

function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

interface CommandOutcome {
  readonly code: number | null;
  readonly error?: NodeJS.ErrnoException;
}

function runCommand(command: string, args: readonly string[]): Promise<CommandOutcome> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.on("error", (error) => {
      resolve({ code: null, error });
    });
    child.on("close", (code) => {
      resolve({ code });
    });
  });
}
