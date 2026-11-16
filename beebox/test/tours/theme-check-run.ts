/** State for retrying only the misses of the last completed theme check. */
import { randomUUID } from "node:crypto";
import { readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StudioCase } from "../../src/shared/theme-studio-case.js";
import type { Screen } from "../../src/shared/theme-screens.js";

export interface ThemeJob { kind: "contrast" | "screen"; screen: Screen; c: StudioCase }

interface LastRun {
  version: 1;
  fullCatalog: boolean;
  cases: StudioCase[];
  failed: string[];
  coverageNeeded: boolean;
}

export class ThemeCheckError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ThemeCheckError";
  }
}

function isStudioCase(value: unknown): value is StudioCase {
  return typeof value === "object" && value !== null &&
    "system" in value && typeof value.system === "string" && value.system !== "" &&
    "systemStock" in value && typeof value.systemStock === "string" && value.systemStock !== "" &&
    "card" in value && typeof value.card === "string" && value.card !== "" &&
    "cardStock" in value && typeof value.cardStock === "string" && value.cardStock !== "";
}

export function jobKey(job: ThemeJob): string {
  return JSON.stringify([job.kind, job.screen.name, job.c.system, job.c.systemStock, job.c.card, job.c.cardStock]);
}

export function runId(): string {
  return `${String(process.pid)}-${randomUUID().slice(0, 8)}`;
}

/** Only a completed run replaces last-run.json. A crash leaves the previous result intact. */
export async function saveLastRun(root: string, run: LastRun): Promise<void> {
  const target = path.join(root, "last-run.json");
  const temp = path.join(root, `.last-run-${runId()}.json`);
  await writeFile(temp, `${JSON.stringify(run)}\n`, "utf8");
  await rename(temp, target);
}

export async function loadLastRun(root: string): Promise<LastRun> {
  let raw: string;
  try { raw = await readFile(path.join(root, "last-run.json"), "utf8"); }
  catch (cause) { throw new ThemeCheckError("--failed needs a completed earlier run; run bin/theme-check --all first", { cause }); }
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch (cause) { throw new ThemeCheckError("last-run.json is invalid JSON; run bin/theme-check --all again", { cause }); }
  if (typeof value !== "object" || value === null || !("version" in value) || value.version !== 1 ||
      !("fullCatalog" in value) || typeof value.fullCatalog !== "boolean" ||
      !("failed" in value) || !Array.isArray(value.failed) || !value.failed.every((key: unknown) => typeof key === "string") ||
      !("coverageNeeded" in value) || typeof value.coverageNeeded !== "boolean" ||
      !("cases" in value) || !Array.isArray(value.cases) || value.cases.length === 0 || !value.cases.every(isStudioCase)) {
    throw new ThemeCheckError("last-run.json is invalid; run bin/theme-check --all again");
  }
  // This file is written by this process; the shape check above guards stale versions.
  // eslint-disable-next-line no-restricted-syntax -- validated local run-state boundary
  return value as LastRun;
}

/** Reject stale catalog retries while allowing the studio's draft and study names. */
export function validateLastRun(last: LastRun, { catalog, themes }: { catalog: readonly StudioCase[]; themes: readonly { name: string; stocks: readonly string[] }[] }): void {
  function checkStock(name: string, stock: string): void {
    const known = themes.find((theme) => theme.name === name);
    if (known !== undefined && !known.stocks.includes(stock)) {
      throw new ThemeCheckError(`last-run.json names a removed stock ${name}/${stock}; run --all again`);
    }
  }
  for (const c of last.cases) {
    checkStock(c.system, c.systemStock);
    checkStock(c.card, c.cardStock);
  }
  if (last.fullCatalog && JSON.stringify(last.cases) !== JSON.stringify(catalog)) {
    throw new ThemeCheckError("the theme catalog changed since last-run.json; run --all again");
  }
}

/** A retry may cover fewer screens; coverage is reportable only when all screen jobs ran. */
export function retryJobs(last: LastRun, available: readonly ThemeJob[]): { jobs: ThemeJob[]; completeCoverage: boolean } {
  const byKey = new Map(available.map((job) => [jobKey(job), job]));
  const selected = new Map<string, ThemeJob>();
  for (const key of last.failed) {
    const job = byKey.get(key);
    if (job === undefined) throw new ThemeCheckError(`last-run.json refers to an unavailable theme job: ${key}; run --all again`);
    selected.set(key, job);
  }
  if (last.coverageNeeded) {
    for (const job of available) if (job.kind === "screen") selected.set(jobKey(job), job);
  }
  const allScreens = available.filter((job) => job.kind === "screen");
  return { jobs: [...selected.values()], completeCoverage: allScreens.every((job) => selected.has(jobKey(job))) };
}

/** Detect edits even when Vite swaps CSS without reloading the document. */
export async function sourceFingerprint(): Promise<string> {
  const roots = [
    path.resolve(import.meta.dirname, "../../src/frontend/src"),
    path.resolve(import.meta.dirname, "../../src/shared"),
  ];
  const parts: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) {
        const meta = await stat(file);
        parts.push(`${file}:${String(meta.mtimeMs)}:${String(meta.size)}`);
      }
    }
  }
  for (const root of roots) await walk(root);
  const palette = path.resolve(import.meta.dirname, "../../src/frontend/tailwind.config.js");
  const meta = await stat(palette);
  parts.push(`${palette}:${String(meta.mtimeMs)}:${String(meta.size)}`);
  return parts.toSorted().join("\n");
}
