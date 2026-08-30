/**
 * Handle stage — the third stage of the triage pipeline.
 *
 * For each category bucket in `inbox/triaged/<category>/`, find the
 * landmark that defines the category, read the matching `destinations:`
 * entry's `procedure` ref, and invoke that procedure with the bucket of
 * items passed via the `TRIAGE_ITEMS` env var (null-delimited
 * box-relative paths).
 *
 * Inline procedures aren't supported yet — only `procedure: { ref }`
 * pointing at a real `.procedure.card`. Inline-vs-ref carriage is an
 * open question in the design doc; we ship the ref form first because
 * the engine already runs procedure cards as-is.
 *
 * See `docs/triage.md` §Handle (stage 3).
 */

import * as fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import * as path from "node:path";
import { getBoxDir } from "../lib/paths.js";
import { resolveRefPath } from "../shared/ref-path.js";
import {
  compileTriageInstructions,
  type TriageCategory,
} from "./triage/instructions.js";
import { startProcedure, type ProcedureInconclusive } from "./procedure/engine.js";
import type { CommandContext } from "./command-runner.js";
import { errnoCode } from "../lib/error-guards.js";
import { isRecord } from "../lib/is-record.js";

/** Env var the handler procedure reads to get its bucket. */
export const TRIAGE_ITEMS_ENV = "TRIAGE_ITEMS";

class DirectoryReadError extends Error {
  readonly dir: string;
  constructor(dir: string, cause: unknown) {
    super(`failed to read directory: ${dir}`, { cause });
    this.name = "DirectoryReadError";
    this.dir = dir;
  }
}

export interface RunProcedureInput {
  /** Box-relative path to the `.procedure.card`. */
  procedurePath: string;
  /** Box-relative paths of the items in the bucket. */
  triageItems: string[];
  ctx: CommandContext;
}

/**
 * How one handler-procedure invocation ended. Three arms, not a boolean plus a
 * message: `inconclusive` is a run whose *work* completed but whose review
 * reached no verdict, and collapsing it into either `completed` or `failed`
 * is the misreading this type exists to prevent (`shared/inconclusive.ts`).
 */
export interface RunProcedureOutput {
  outcome: "completed" | "failed" | "inconclusive";
  /**
   * Why. The error message for `failed`; the reason phrase (e.g. "review of
   * step draft reached max turns (8)") for `inconclusive`. Absent on
   * `completed`.
   */
  detail?: string;
}

export type ProcedureRunner = (input: RunProcedureInput) => Promise<RunProcedureOutput>;

/**
 * One phrase naming every step whose review reached no verdict, in the voice
 * of the thing that happened, so it drops into a report line after
 * "inconclusive — ".
 */
function describeInconclusiveSteps(items: ProcedureInconclusive[]): string {
  if (items.length === 0) return "the review reached no verdict";
  return items
    .map((item) => `review of step ${item.stepId} ${item.detail}`)
    .join("; ");
}

/**
 * Live procedure runner: sets TRIAGE_ITEMS in the process env, calls
 * the procedure engine, restores the prior value. The engine forwards
 * process.env into shell steps, so setting it here is the simplest
 * plumbing path.
 */
const liveRunProcedure: ProcedureRunner = async ({ procedurePath, triageItems, ctx }) => {
  const previous = process.env[TRIAGE_ITEMS_ENV];
  process.env[TRIAGE_ITEMS_ENV] = triageItems.join("\0");
  try {
    const result = await startProcedure({
      ctx,
      procedureNameOrPath: procedurePath,
    });
    if (!result.ok) return { outcome: "failed", detail: result.error.message };
    if (result.value.status === "inconclusive") {
      return {
        outcome: "inconclusive",
        detail: describeInconclusiveSteps(result.value.inconclusive),
      };
    }
    return { outcome: "completed" };
  } finally {
    if (previous === undefined) delete process.env[TRIAGE_ITEMS_ENV];
    else process.env[TRIAGE_ITEMS_ENV] = previous;
  }
};

export interface CategoryHandling {
  category: string;
  /** Items found in the bucket (basenames). */
  items: string[];
  outcome:
    | "ran"
    | "no-items"
    | "no-procedure"
    | "no-category"
    // The handler's work completed but its review reached no verdict — not
    // `ran` (nothing judged it) and not `procedure-failed` (nothing failed).
    | "procedure-inconclusive"
    | "procedure-failed";
  /** Box-relative procedure path, if one was resolved. */
  procedurePath?: string;
  /**
   * The failure message for `procedure-failed`, or the reason phrase for
   * `procedure-inconclusive`. Named for what it carries, not for failure:
   * an inconclusive run has no error to report.
   */
  detail?: string;
}

/**
 * The report lines for one category's handling — the outcome row, then a
 * detail row when there's something to say. An inconclusive run gets its own
 * sentence: the reason, then the clause that stops it reading as a failure.
 */
export function formatHandlingLines(result: CategoryHandling): string[] {
  const itemCount = result.items.length;
  const procDetail = result.procedurePath ? ` [${result.procedurePath}]` : "";
  const lines = [
    `  ${result.outcome}\t${result.category} (${itemCount} item${itemCount === 1 ? "" : "s"})${procDetail}`,
  ];
  if (result.outcome === "procedure-inconclusive") {
    lines.push(
      `    └─ inconclusive — ${result.detail ?? "the review reached no verdict"}; work completed`,
    );
  } else if (result.detail !== undefined && result.detail !== "") {
    lines.push(`    └─ ${result.detail}`);
  }
  return lines;
}

/**
 * The worst outcome in a handle pass, in the order a caller cares about:
 * a failed handler is louder than an unjudged one, and an unjudged one is
 * louder than a clean pass. `bbx handle`'s exit code is this and nothing else —
 * before it, a bucket whose handler failed and a bucket nobody judged both
 * exited 0, so a wakeup script gating on `bbx handle` saw a green run either
 * way.
 */
export type HandleVerdict = "ok" | "inconclusive" | "failed";

export function handleVerdict(results: readonly CategoryHandling[]): HandleVerdict {
  if (results.some((r) => r.outcome === "procedure-failed")) return "failed";
  if (results.some((r) => r.outcome === "procedure-inconclusive")) return "inconclusive";
  return "ok";
}

/** One sentence naming the buckets whose handler procedure failed. */
export function describeHandleFailures(results: readonly CategoryHandling[]): string {
  const failed = results.filter((r) => r.outcome === "procedure-failed");
  return `handler procedure failed for ${failed
    .map((r) => `${r.category}${r.detail === undefined || r.detail === "" ? "" : ` (${r.detail})`}`)
    .join("; ")}`;
}

const HANDLE_OUTCOMES: readonly CategoryHandling["outcome"][] = [
  "ran",
  "no-items",
  "no-procedure",
  "no-category",
  "procedure-inconclusive",
  "procedure-failed",
];

/**
 * Read a handle command's boundary `data` back as typed results. The
 * command-runner boundary is untyped, and the CLI keys its exit code on what
 * comes through it, so this re-validates rather than asserts — a mis-shaped
 * value must not silently become a clean exit.
 */
export function readHandlingResults(data: unknown): CategoryHandling[] {
  if (!Array.isArray(data)) return [];
  const results: CategoryHandling[] = [];
  for (const entry of data) {
    if (!isRecord(entry)) continue;
    const { category, items, outcome, procedurePath, detail } = entry;
    if (typeof category !== "string") continue;
    const known = HANDLE_OUTCOMES.find((o) => o === outcome);
    if (known === undefined) continue;
    results.push({
      category,
      items: Array.isArray(items) ? items.filter((i): i is string => typeof i === "string") : [],
      outcome: known,
      ...(typeof procedurePath === "string" && { procedurePath }),
      ...(typeof detail === "string" && { detail }),
    });
  }
  return results;
}

export interface RunHandleOptions {
  /** Inject a stubbed procedure runner for tests. */
  runProcedure?: ProcedureRunner;
}

export interface HandleParams {
  ctx: CommandContext;
  /** Optional: only handle this category. Otherwise handle every non-empty bucket. */
  category?: string;
  options?: RunHandleOptions;
}

async function listCategoryBuckets(boxRoot: string): Promise<string[]> {
  const triagedDir = getBoxDir(boxRoot, "inboxTriaged");
  let entries: Dirent[];
  try {
    entries = await fs.readdir(triagedDir, { withFileTypes: true });
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return [];
    throw new DirectoryReadError(triagedDir, e);
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    // _unsure/ is waiting on a user answer, not for handling.
    .filter((name) => !name.startsWith("_") && !name.startsWith("."));
}

async function listBucketItems({ boxRoot, category }: { boxRoot: string; category: string }): Promise<string[]> {
  const dir = path.join(getBoxDir(boxRoot, "inboxTriaged"), category);
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return [];
    throw new DirectoryReadError(dir, e);
  }
  return entries
    .filter((e) => !e.isDirectory())
    .map((e) => e.name)
    .filter((name) => !name.startsWith(".") && !name.endsWith(".probable.txt"));
}

function resolveProcedurePath(category: TriageCategory): string | null {
  if (!category.procedureRef || category.procedureRef === "inline") return null;
  // A destination's `procedure.ref` is a box path (leading `/`); a bare path
  // still resolves against the landmark's own directory. Resolution goes
  // through the shared ref algebra, which fails closed on a `..` escape.
  const resolved = resolveRefPath({
    fromPath: `${category.dir}/`,
    ref: category.procedureRef,
    kind: "card",
  });
  if (resolved === null) {
    console.warn(`handle: procedure ref "${category.procedureRef}" in "${category.dir}" escapes the box`);
    return null;
  }
  return resolved;
}

/**
 * Run one handle pass. For each category bucket with items, invoke the
 * category's handler procedure with `TRIAGE_ITEMS` pointing at the
 * bucket's contents.
 */
export async function runHandle(params: HandleParams): Promise<CategoryHandling[]> {
  const { ctx, category: only, options = {} } = params;
  const runProcedure = options.runProcedure ?? liveRunProcedure;

  const instructions = await compileTriageInstructions(ctx.boxRoot);
  const categoriesByName = new Map(instructions.categories.map((c) => [c.name, c]));

  const buckets = only ? [only] : await listCategoryBuckets(ctx.boxRoot);

  const results: CategoryHandling[] = [];
  for (const name of buckets) {
    const items = await listBucketItems({ boxRoot: ctx.boxRoot, category: name });
    if (items.length === 0) {
      results.push({ category: name, items: [], outcome: "no-items" });
      continue;
    }

    const category = categoriesByName.get(name);
    if (!category) {
      results.push({ category: name, items, outcome: "no-category" });
      continue;
    }

    const procedurePath = resolveProcedurePath(category);
    if (!procedurePath) {
      results.push({ category: name, items, outcome: "no-procedure" });
      continue;
    }

    const triageItems = items.map((file) =>
      path.join("box/inbox/triaged", name, file),
    );
    const result = await runProcedure({ procedurePath, triageItems, ctx });
    if (result.outcome === "completed") {
      results.push({
        category: name,
        items,
        outcome: "ran",
        procedurePath,
      });
    } else {
      const handling: CategoryHandling = {
        category: name,
        items,
        outcome:
          result.outcome === "inconclusive"
            ? "procedure-inconclusive"
            : "procedure-failed",
        procedurePath,
      };
      if (result.detail !== undefined) handling.detail = result.detail;
      results.push(handling);
    }
  }

  return results;
}
