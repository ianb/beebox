/** Durable state owned by the hourly full-suite schedule. */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { refuse } from "./repo.js";

function statePath(name: string): string {
  const directory = process.env["SCHEDULE_STATE_DIR"];
  if (directory === undefined || directory === "") refuse("SCHEDULE_STATE_DIR is not set");
  return path.join(directory, name);
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function readJson(name: string): Promise<unknown> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(statePath(name), "utf8"));
    return parsed;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return null;
    throw error;
  }
}

async function writeJson(name: string, value: unknown): Promise<void> {
  const file = statePath(name);
  const temporary = `${file}.${String(process.pid)}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporary, file);
}

// ─── known red ────────────────────────────────────────────────────────────

export function newlyRedFiles(input: { known: readonly string[]; current: readonly string[] }): string[] {
  const known = new Set(input.known);
  return input.current.filter((file) => !known.has(file));
}

/** Replacing the set drops recovered files, allowing a later regression to be reported. */
export function nextKnownRed(current: readonly string[]): string[] {
  return [...new Set(current)].toSorted();
}

export async function readKnownRed(): Promise<string[]> {
  const parsed = await readJson("known-red.json");
  if (parsed === null) return [];
  if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === "string")) {
    refuse("known-red.json is not an array of file names");
  }
  return nextKnownRed(parsed);
}

export async function writeKnownRed(files: readonly string[]): Promise<void> {
  await writeJson("known-red.json", nextKnownRed(files));
}

// ─── pending verdicts ─────────────────────────────────────────────────────

/**
 * A failure seen only on an untrusted (slowed) run: no verdict yet. `base` is
 * the last tested commit when the file FIRST failed, so a later trusted
 * confirmation still bisects over every landing that could have caused it,
 * even though completion markers moved on in between.
 */
export interface PendingEntry {
  base: string;
  firstSeen: string;
}

function isPendingEntry(value: unknown): value is PendingEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    "base" in value &&
    typeof value.base === "string" &&
    "firstSeen" in value &&
    typeof value.firstSeen === "string"
  );
}

export async function readPending(): Promise<Record<string, PendingEntry>> {
  const parsed = await readJson("pending.json");
  if (parsed === null) return {};
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    refuse("pending.json is not a map of file -> pending entry");
  }
  const pending: Record<string, PendingEntry> = {};
  for (const [file, entry] of Object.entries(parsed)) {
    if (!isPendingEntry(entry)) refuse(`pending.json entry for ${file} is not a pending entry`);
    pending[file] = entry;
  }
  return pending;
}

export async function writePending(pending: Record<string, PendingEntry>): Promise<void> {
  await writeJson("pending.json", pending);
}

/** After an untrusted red run: keep existing entries, open one per new failure. */
export function nextPendingAfterUntrusted(input: {
  pending: Record<string, PendingEntry>;
  failures: readonly string[];
  base: string;
  now: Date;
}): Record<string, PendingEntry> {
  const next = { ...input.pending };
  for (const file of input.failures) {
    next[file] ??= { base: input.base, firstSeen: input.now.toISOString() };
  }
  return next;
}

// ─── the last alert raised ────────────────────────────────────────────────

export interface LastAlert {
  fingerprint: string;
  raisedAt: string;
}

function isLastAlert(value: unknown): value is LastAlert {
  return (
    typeof value === "object" &&
    value !== null &&
    "fingerprint" in value &&
    typeof value.fingerprint === "string" &&
    "raisedAt" in value &&
    typeof value.raisedAt === "string"
  );
}

export async function readLastAlert(): Promise<LastAlert | null> {
  const parsed = await readJson("last-alert.json");
  if (parsed === null) return null;
  if (!isLastAlert(parsed)) refuse("last-alert.json is not a { fingerprint, raisedAt } record");
  return parsed;
}

export async function writeLastAlert(alert: LastAlert | null): Promise<void> {
  if (alert === null) {
    await fs.rm(statePath("last-alert.json"), { force: true });
    return;
  }
  await writeJson("last-alert.json", alert);
}
