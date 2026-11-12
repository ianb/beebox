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

/**
 * Docling's own conversion budget (`document_timeout`, D6), scaled by page
 * count (D19). A flat 10 minutes stopped a 333-page manual and an 84-page
 * report on prod. Measured in the D18 VM: about 2-3.5 s a page for digital
 * PDFs, 9 s a page with OCR; prod shares three cores across boxes, so the
 * per-page figures carry about 3x headroom. Unknown page count gets the cap.
 */
const BUDGET_BASE_SECONDS = 5 * 60;
const BUDGET_SECONDS_PER_PAGE = { text: 10, ocr: 30 } as const;
export const MAX_CONVERSION_SECONDS = 90 * 60;

export function conversionBudgetSeconds(pages: number | null, ocr: DoclingExtractOptions["ocr"]): number {
  if (pages === null) return MAX_CONVERSION_SECONDS;
  const perPage = ocr === "off" ? BUDGET_SECONDS_PER_PAGE.text : BUDGET_SECONDS_PER_PAGE.ocr;
  return Math.min(MAX_CONVERSION_SECONDS, BUDGET_BASE_SECONDS + perPage * pages);
}

/**
 * How long a driver waits for other conversions before it gives up (exit 75):
 * the longest conversion, its 5-minute render slack (`core.ts`), and a margin.
 * One long conversion ahead never refuses a queued PDF; two at the cap can.
 */
export const LOCK_WAIT_SECONDS = MAX_CONVERSION_SECONDS + 30 * 60;

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
    // uv's own routine output off. With UV_TORCH_BACKEND set (prod), uv warns
    // on every run that the option is experimental; that line would otherwise
    // lead every failure tail. uv errors still print under --quiet (measured).
    "--quiet",
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
      return `Other Docling conversions on this box or host kept this one waiting for over ${String(LOCK_WAIT_SECONDS / 60)} minutes; this PDF was not converted. Retry later, one at a time.`;
    case "oom":
      return "Docling was killed during an out-of-memory event in this box. Do not retry in parallel; retry once when nothing else is converting, or use a smaller PDF.";
    case "killed":
      return "Docling was killed by a signal beebox did not send; running out of memory is the usual cause. Do not retry in parallel; retry once when nothing else is converting.";
    case "failed":
      return `Docling exited ${String(outcome.exitCode)}: ${detail}`;
  }
}

const DRIVER_ERROR_PREFIX = "bbx-docling: error: ";

/**
 * Prefer the driver's own failure reason (its last `bbx-docling: error:` line)
 * over the raw output tail, which is mostly model-loading progress. Progress
 * lines (waiting, lock acquired) are never a reason.
 */
export function driverReason(outputTail: string): string | null {
  const last = outputTail.split("\n").findLast((line) => line.startsWith(DRIVER_ERROR_PREFIX));
  return last === undefined ? null : last.slice(DRIVER_ERROR_PREFIX.length);
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
