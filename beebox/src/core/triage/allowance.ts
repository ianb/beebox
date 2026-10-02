/** Shared call allowance inherited by research subprocesses; never content storage. */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import { withFileLock } from "../../lib/file-lock.js";

const allowanceSchema = z.object({ expires: z.number(), remaining: z.number().int().nonnegative(), researchRemaining: z.number().int().nonnegative() });
const context = new AsyncLocalStorage<{ id: string; research: boolean }>();
const idSchema = z.uuid();

export class TriageAllowanceError extends Error {
  constructor({ detail }: { detail: string }) { super(`Triage deferred: ${detail}`); this.name = "TriageAllowanceError"; }
}

function allowancePath(boxRoot: string, id: string): string {
  return path.join(boxRoot, ".beebox", "triage-runs", `${idSchema.parse(id)}.json`);
}

/** No ambient run means a standalone trial, still subject to the daily Jev cap. */
export async function reserveRunCalls(boxRoot: string, count: number): Promise<void> {
  if (!Number.isInteger(count) || count < 1) throw new TriageAllowanceError({ detail: "invalid call count" });
  const inherited = context.getStore();
  // TODO(env-migration): These inherited allowance markers are harness-only feature flags.
  const id = inherited?.id ?? process.env.BBX_TRIAGE_RUN_ID;
  if (!id) return;
  const file = allowancePath(boxRoot, id);
  await withFileLock({ lockPath: `${file}.lock`, metadata: { purpose: "triage-allowance" }, waitMs: 10_000 }, async () => {
    const quota = allowanceSchema.parse(JSON.parse(await fs.readFile(file, "utf8")));
    if (quota.expires < Date.now()) throw new TriageAllowanceError({ detail: "run allowance expired" });
    const research = inherited?.research ?? process.env.BBX_TRIAGE_RESEARCH === "1";
    if (quota.remaining < count || (research && quota.researchRemaining < count)) {
      throw new TriageAllowanceError({ detail: "run call allowance exhausted" });
    }
    quota.remaining -= count;
    if (research) quota.researchRemaining -= count;
    await fs.writeFile(file, JSON.stringify(quota));
  });
}

/** One automatic run, shared by core calls and the agent's CLI subprocesses. */
export async function withTriageAllowance<T>(boxRoot: string, run: (env: Record<string, string>) => Promise<T>): Promise<T> {
  // TODO(env-migration): The inherited run marker is a harness-only feature flag.
  if (context.getStore() || process.env.BBX_TRIAGE_RUN_ID) throw new TriageAllowanceError({ detail: "recursive automatic triage is not allowed; use replay/judge" });
  const id = randomUUID();
  const file = allowancePath(boxRoot, id);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ expires: Date.now() + 60 * 60 * 1000, remaining: 32, researchRemaining: 12 }), { flag: "wx" });
  try {
    return await context.run({ id, research: false }, () => run({ BBX_TRIAGE_RUN_ID: id, BBX_TRIAGE_RESEARCH: "1" }));
  } finally {
    await fs.rm(file, { force: true });
  }
}
