/** Filesystem writability probes shared by health checks. */

import * as fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { errnoCode } from "../../../lib/error-guards.js";

export type Writability = "writable" | "missing" | "not-writable";

export function failedWritability(error: unknown): Exclude<Writability, "writable"> {
  return errnoCode(error) === "ENOENT" ? "missing" : "not-writable";
}

export async function writability(dirPath: string): Promise<Writability> {
  try {
    await fs.access(dirPath, fsConstants.W_OK);
    return "writable";
  } catch (e) {
    return failedWritability(e);
  }
}

export async function isWritable(dirPath: string): Promise<boolean> {
  return (await writability(dirPath)) === "writable";
}
