/** Durable state owned by the hourly full-suite schedule. */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { refuse } from "./repo.js";

function statePath(): string {
  const directory = process.env["SCHEDULE_STATE_DIR"];
  if (directory === undefined || directory === "") refuse("SCHEDULE_STATE_DIR is not set");
  return path.join(directory, "known-red.json");
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

export function newlyRedFiles(input: { known: readonly string[]; current: readonly string[] }): string[] {
  const known = new Set(input.known);
  return input.current.filter((file) => !known.has(file));
}

/** Replacing the set drops recovered files, allowing a later regression to be reported. */
export function nextKnownRed(current: readonly string[]): string[] {
  return [...new Set(current)].toSorted();
}

export async function readKnownRed(): Promise<string[]> {
  const file = statePath();
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
    if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === "string")) {
      refuse(`${file} is not an array of file names`);
    }
    return nextKnownRed(parsed);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return [];
    throw error;
  }
}

export async function writeKnownRed(files: readonly string[]): Promise<void> {
  const file = statePath();
  const temporary = `${file}.${String(process.pid)}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(nextKnownRed(files), null, 2)}\n`, "utf8");
  await fs.rename(temporary, file);
}
