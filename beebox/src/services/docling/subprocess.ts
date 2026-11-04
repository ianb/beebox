/**
 * How `core.ts` starts the Docling driver (`convert.py`) and reads how it
 * ended. Pure functions, apart from the cgroup counter read, so the tests reach
 * every decision without running Docling.
 *
 * Measurements and the reasons for each choice: D18 in
 * `docs/plans/scanner-ingest-docling-decisions.md`.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { PACKAGE_ROOT } from "../../lib/package-root.js";
import { DOCLING_VERSION } from "./version.js";
import type { DoclingExtractOptions } from "./core.js";

/** The driver, shipped as a package file (`package.json` `files`). */
export const DOCLING_DRIVER_PATH = path.join(PACKAGE_ROOT, "src", "services", "docling", "convert.py");

/** Exit codes `convert.py` defines. */
export const DRIVER_EXIT_BUSY = 75;

/** `uv` reports a SIGKILLed child as 128 + 9 (measured). */
const EXIT_SIGKILL = 137;

/**
 * The line the driver prints once it holds every lock. Until then a run is
 * waiting, not converting, so the conversion budget starts here.
 */
export const LOCK_ACQUIRED_MARKER = "bbx-docling: lock acquired";

/** How long a driver waits for another conversion before it gives up (exit 75). */
export const LOCK_WAIT_SECONDS = 20 * 60;

/** The JSON request `convert.py` reads from its one argument. */
export interface DoclingRequest {
  source: string;
  outputDir: string;
  ocr: DoclingExtractOptions["ocr"];
  languages: string[] | null;
  documentTimeoutSeconds: number;
  /** Box lock first, then host lock: the driver takes them in this order. */
  lockPaths: string[];
  lockWaitSeconds: number;
  /** The driver exits when this process is gone. */
  parentPid: number;
}

const LOCK_FILENAME = "bbx-docling.lock";

/**
 * Where the conversion locks live.
 *
 * - Box lock, under `HOME`. A hosted box is its own user with its own home, so
 *   this is one lock per box; on a laptop it is one per user, which is stricter.
 * - Host lock, under `UV_CACHE_DIR`, the directory every box on a host shares
 *   for Docling's environment (`hub/box-env-file.ts`). Without it set there is
 *   no shared directory to name, and the box lock is the only one.
 */
export function doclingLockPaths(env: NodeJS.ProcessEnv, homeDir: string): string[] {
  const paths = [path.join(homeDir, ".cache", LOCK_FILENAME)];
  const shared = env["UV_CACHE_DIR"];
  if (shared !== undefined && shared !== "") {
    const host = path.join(shared, LOCK_FILENAME);
    if (host !== paths[0]) paths.push(host);
  }
  return paths;
}

/** The `uvx` argv that runs the driver at the pinned Docling version. */
export function doclingArgs(request: DoclingRequest): string[] {
  return [
    "--from", `docling==${DOCLING_VERSION}`,
    // rapidocr, not Docling's easyocr default (scored on a notarized form:
    // 6/6 handwritten fields against 5/6). `--with` keeps it in uv's
    // throwaway environment, so the host needs nothing installed.
    "--with", "onnxruntime",
    "--with", "rapidocr",
    "python", "-I", DOCLING_DRIVER_PATH,
    JSON.stringify(request),
  ];
}

/**
 * Environment additions for the driver. glibc gives each thread its own malloc
 * arena; Docling's threaded pipeline then holds freed memory per thread.
 * Two arenas measured ~3% lower peak at no time cost (D18). Ignored on macOS.
 */
export const DOCLING_ENV: Readonly<Record<string, string>> = { MALLOC_ARENA_MAX: "2" };

export type DoclingExitOutcome =
  | { kind: "ok" }
  | { kind: "timeout"; phase: "waiting" | "converting" }
  | { kind: "busy" }
  | { kind: "oom" }
  | { kind: "killed" }
  | { kind: "failed"; exitCode: number | undefined };

export interface DoclingExitFacts {
  exitCode: number | undefined;
  signal: string | undefined;
  /** Our awake budget fired, in which phase. */
  timedOut: "waiting" | "converting" | null;
  /** This cgroup's `oom_kill` count before and after; null where unreadable. */
  oomKillsBefore: number | null;
  oomKillsAfter: number | null;
}

/** Name how a driver run ended. */
export function classifyDoclingExit(facts: DoclingExitFacts): DoclingExitOutcome {
  if (facts.timedOut !== null) return { kind: "timeout", phase: facts.timedOut };
  if (facts.signal === "SIGKILL" || facts.exitCode === EXIT_SIGKILL) {
    const rose = facts.oomKillsBefore !== null
      && facts.oomKillsAfter !== null
      && facts.oomKillsAfter > facts.oomKillsBefore;
    return { kind: rose ? "oom" : "killed" };
  }
  if (facts.exitCode === 0) return { kind: "ok" };
  if (facts.exitCode === DRIVER_EXIT_BUSY) return { kind: "busy" };
  return { kind: "failed", exitCode: facts.exitCode };
}

/** The card-facing message for every outcome but `ok`. `detail` is the condensed output tail. */
export function doclingFailureMessage(failure: {
  outcome: Exclude<DoclingExitOutcome, { kind: "ok" }>;
  budgets: { waitMinutes: number; convertMinutes: number };
  detail: string;
}): string {
  const { outcome, budgets, detail } = failure;
  switch (outcome.kind) {
    case "timeout":
      return outcome.phase === "converting"
        ? `Docling did not finish within ${String(budgets.convertMinutes)} minutes and was stopped`
        : `Docling did not start converting within ${String(budgets.waitMinutes)} minutes and was stopped`;
    case "busy":
      return `Another Docling conversion on this box or host ran for over ${String(LOCK_WAIT_SECONDS / 60)} minutes; this PDF was not converted. Retry later, one at a time.`;
    case "oom":
      return "Docling was killed during an out-of-memory event in this box. Do not retry in parallel; retry once when nothing else is converting, or use a smaller PDF.";
    case "killed":
      return "Docling was killed by a signal beebox did not send; running out of memory is the usual cause. Do not retry in parallel; retry once when nothing else is converting.";
    case "failed":
      return `Docling exited ${String(outcome.exitCode)}: ${detail}`;
  }
}

/**
 * Prefer the driver's own reason (`bbx-docling: …`, its last such line) over
 * the raw output tail, which is mostly model-loading progress.
 */
export function driverReason(outputTail: string): string | null {
  const lines = outputTail.split("\n").filter((line) => line.startsWith("bbx-docling: ") && !line.startsWith(LOCK_ACQUIRED_MARKER));
  const last = lines.at(-1);
  return last === undefined ? null : last.slice("bbx-docling: ".length);
}

/**
 * This process's cgroup v2 `oom_kill` count, or null where there is none to
 * read (macOS, cgroup v1, a sandbox hiding /sys). Children share the parent's
 * cgroup unless something moves them, so the count covers the driver.
 */
export async function readOomKillCount(): Promise<number | null> {
  try {
    const membership = await fs.readFile("/proc/self/cgroup", "utf-8");
    const line = membership.split("\n").find((entry) => entry.startsWith("0::"));
    if (line === undefined) return null;
    const events = await fs.readFile(path.join("/sys/fs/cgroup", line.slice(3), "memory.events"), "utf-8");
    return parseOomKills(events);
  } catch (_e) {
    // Not Linux, or no cgroup v2 here: the classifier treats null as "no evidence".
    return null;
  }
}

/** The `oom_kill` field of a cgroup `memory.events` file. */
export function parseOomKills(events: string): number | null {
  const match = /^oom_kill (\d+)$/mu.exec(events);
  return match?.[1] === undefined ? null : Number(match[1]);
}
