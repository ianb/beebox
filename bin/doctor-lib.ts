/**
 * Shared substrate for the preflight doctor (`bin/doctor.ts`): the error
 * family, the injected-I/O contract every check is written against, the
 * minimal version-range comparator, and the check-result constructors.
 *
 * Split out of `doctor.ts` purely for size; nothing here knows about any
 * individual check. See `bin/doctor.ts` for the design discussion.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isRecord } from "../callback-box/src/lib/is-record.js";

const execFileAsync = promisify(execFile);

/** Thrown for genuinely-impossible inputs (a hand-corrupted `engines` field). */
export class DoctorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DoctorError";
  }
}

export class VersionParseError extends DoctorError {
  constructor(readonly raw: string) {
    super(`cannot parse version: ${raw}`);
    this.name = "VersionParseError";
  }
}

export class RangeOperatorError extends DoctorError {
  constructor(readonly raw: string) {
    super(`unknown range operator: ${raw}`);
    this.name = "RangeOperatorError";
  }
}

export class RangeComparatorParseError extends DoctorError {
  constructor(readonly token: string) {
    super(`cannot parse range comparator: ${token}`);
    this.name = "RangeComparatorParseError";
  }
}

export class UnhandledRangeOperatorError extends DoctorError {
  constructor(readonly operator: string) {
    super(`unhandled range operator: ${operator}`);
    this.name = "UnhandledRangeOperatorError";
  }
}

export class MissingEnginesNodeError extends DoctorError {
  constructor(readonly manifestPath: string) {
    super(`${manifestPath} is missing engines.node`);
    this.name = "MissingEnginesNodeError";
  }
}

export class MissingPackageManagerError extends DoctorError {
  constructor(readonly manifestPath: string) {
    super(`${manifestPath} is missing packageManager`);
    this.name = "MissingPackageManagerError";
  }
}

// ─── Subprocess + filesystem injection ───────────────────────────────────────

export interface CommandResult {
  /** True iff the OS was able to spawn the command at all (found on PATH). */
  spawned: boolean;
  /** Exit code, or null if the process never spawned or was killed/timed out. */
  code: number | null;
  stdout: string;
  stderr: string;
}

export type RunCommand = (cmd: string, args: string[]) => Promise<CommandResult>;

export function createRealRun(): RunCommand {
  return async (cmd, args) => {
    try {
      const { stdout, stderr } = await execFileAsync(cmd, args, { timeout: 10000, encoding: "utf8" });
      return { spawned: true, code: 0, stdout, stderr };
    } catch (e) {
      const err: Record<string, unknown> = isRecord(e) ? e : {};
      if (err["code"] === "ENOENT") {
        return { spawned: false, code: null, stdout: "", stderr: "" };
      }
      const numericCode = typeof err["code"] === "number" ? err["code"] : null;
      const stdout = typeof err["stdout"] === "string" ? err["stdout"] : "";
      const stderr = typeof err["stderr"] === "string" ? err["stderr"] : "";
      return { spawned: true, code: numericCode, stdout, stderr };
    }
  };
}

export interface DoctorDeps {
  run: RunCommand;
  fileExists: (absPath: string) => boolean;
  nodeVersion: string;
  repoRoot: string;
  engines: string;
  packageManager: string;
  resolveSdkBinary: () => string | null;
  /**
   * Loads better-sqlite3 and opens an in-memory database, resolving to a
   * detail string. This is THE check that catches Node-ABI drift directly —
   * a native module compiled against a different Node breaks at dlopen, and
   * historically that surfaced as an opaque crash at first box boot rather
   * than anything naming the cause.
   */
  loadBetterSqlite3: () => Promise<string>;
  /** Wall clock, injected so the schedules-heartbeat check is deterministic. */
  nowMs: number;
}

// ─── Minimal version-range comparison (no `semver` dependency: it's hoisted
// but has no type declarations in this workspace — see the plan's B1 note) ──

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

/** Parses `vX`, `X`, `X.Y`, or `X.Y.Z` into a 3-tuple, defaulting missing parts to 0. */
export function parseVersion(raw: string): ParsedVersion {
  const cleaned = raw.trim().replace(/^v/, "");
  const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(cleaned);
  if (m === null) throw new VersionParseError(raw);
  const [, majorStr, minorStr, patchStr] = m;
  if (majorStr === undefined) throw new VersionParseError(raw);
  return { major: Number(majorStr), minor: Number(minorStr ?? "0"), patch: Number(patchStr ?? "0") };
}

function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

type RangeOperator = ">=" | "<=" | ">" | "<" | "=";

interface RangeComparator {
  op: RangeOperator;
  version: ParsedVersion;
}

function toRangeOperator(raw: string | undefined): RangeOperator {
  if (raw === undefined || raw === "") return "=";
  if (raw === ">=" || raw === "<=" || raw === ">" || raw === "<" || raw === "=") return raw;
  throw new RangeOperatorError(raw);
}

const RANGE_TOKEN = /^(>=|<=|>|<|=)?(.+)$/;

function parseRange(range: string): RangeComparator[] {
  return range
    .trim()
    .split(/\s+/)
    .filter((token) => token !== "")
    .map((token) => {
      const m = RANGE_TOKEN.exec(token);
      if (m === null) throw new RangeComparatorParseError(token);
      const [, opRaw, versionPart] = m;
      if (versionPart === undefined) throw new RangeComparatorParseError(token);
      return { op: toRangeOperator(opRaw), version: parseVersion(versionPart) };
    });
}

function comparatorHolds(cmp: number, op: RangeOperator): boolean {
  switch (op) {
    case ">=":
      return cmp >= 0;
    case "<=":
      return cmp <= 0;
    case ">":
      return cmp > 0;
    case "<":
      return cmp < 0;
    case "=":
      return cmp === 0;
    default: {
      const exhaustive: never = op;
      throw new UnhandledRangeOperatorError(String(exhaustive));
    }
  }
}

/** Space-separated comparators are ANDed (npm/pnpm `engines` range syntax). */
export function satisfiesRange(version: string, range: string): boolean {
  const v = parseVersion(version);
  const comparators = parseRange(range);
  return comparators.every(({ op, version: cv }) => comparatorHolds(compareVersions(v, cv), op));
}

// ─── Check result shape ──────────────────────────────────────────────────────

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
  remedy: string | null;
}

export function pass(name: string, detail: string): CheckResult {
  return { name, ok: true, detail, remedy: null };
}

export function fail(name: string, input: { detail: string; remedy: string }): CheckResult {
  return { name, ok: false, detail: input.detail, remedy: input.remedy };
}
