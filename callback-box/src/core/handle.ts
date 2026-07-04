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
 * See `docs/triage-design.md` §Handle (stage 3).
 */

import * as fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import * as path from "node:path";
import { getBoxDir } from "../cli/lib/paths.js";
import {
  compileTriageInstructions,
  type TriageCategory,
} from "./triage-instructions.js";
import { startProcedure } from "./procedure/engine.js";
import type { CommandContext } from "./command-runner.js";

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

export interface RunProcedureOutput {
  success: boolean;
  error?: string;
}

export type ProcedureRunner = (input: RunProcedureInput) => Promise<RunProcedureOutput>;

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
    const output: RunProcedureOutput = { success: result.success };
    if (result.error !== undefined) output.error = result.error;
    return output;
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
    | "procedure-failed";
  /** Box-relative procedure path, if one was resolved. */
  procedurePath?: string;
  error?: string;
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
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
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
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new DirectoryReadError(dir, e);
  }
  return entries
    .filter((e) => !e.isDirectory())
    .map((e) => e.name)
    .filter((name) => !name.startsWith(".") && !name.endsWith(".probable.txt"));
}

function resolveProcedurePath(category: TriageCategory): string | null {
  if (!category.procedureRef || category.procedureRef === "inline") return null;
  // procedureRef is relative to the landmark's directory; resolve to box-relative.
  return path.normalize(path.join(category.dir, category.procedureRef));
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
    if (!result.success) {
      const handling: CategoryHandling = {
        category: name,
        items,
        outcome: "procedure-failed",
        procedurePath,
      };
      if (result.error !== undefined) handling.error = result.error;
      results.push(handling);
    } else {
      results.push({
        category: name,
        items,
        outcome: "ran",
        procedurePath,
      });
    }
  }

  return results;
}
