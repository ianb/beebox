/**
 * The Jev budget: a per-box daily cap on `bbx judge` calls, counted in
 * `.beebox/jev-budget.json` as `{ day, calls, deferrals }` under the box time
 * zone. Over the cap, `bbx judge` defers with the reason `budget`, which holds
 * the schedule's change cursor, so a stuck schedule spends at most the cap and
 * drops nothing. `deferrals` keeps the times of the last day's budget
 * deferrals, for the health check. See docs/plans/notifications.md (Track D).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { withFileLock } from "../../lib/file-lock.js";
import { errnoCode, errorMessage } from "../../lib/error-guards.js";
import { boxLocalDay } from "../../connectors/activity.js";

/** Jev calls a box may make per box-local day. */
export const JEV_DAILY_CAP = 500;

const DAY_MS = 24 * 60 * 60 * 1000;

const BudgetFile = z.object({
  day: z.string(),
  calls: z.number().int().min(0),
  deferrals: z.array(z.string()).default([]),
});
type Budget = z.infer<typeof BudgetFile>;

function budgetPath(boxRoot: string): string {
  return path.join(boxRoot, ".beebox", "jev-budget.json");
}

async function readBudget(boxRoot: string): Promise<Budget | null> {
  let text: string;
  try {
    text = await fs.readFile(budgetPath(boxRoot), "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw e;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    console.warn(`[judge] ${budgetPath(boxRoot)} is not JSON (${errorMessage(e)}); starting today's count at zero`);
    return null;
  }
  const parsed = BudgetFile.safeParse(json);
  if (!parsed.success) {
    console.warn(`[judge] ${budgetPath(boxRoot)} has an unexpected shape; starting today's count at zero`);
    return null;
  }
  return parsed.data;
}

async function writeBudget(boxRoot: string, budget: Budget): Promise<void> {
  await fs.mkdir(path.dirname(budgetPath(boxRoot)), { recursive: true });
  await fs.writeFile(budgetPath(boxRoot), `${JSON.stringify(budget)}\n`);
}

/**
 * Reserve `calls` Jev calls for today, all or none. Returns false, and records
 * a budget deferral, when they would take the day's count past the cap.
 */
export async function reserveJevCalls(boxRoot: string, opts: { calls: number; now: Date }): Promise<boolean> {
  const { calls, now } = opts;
  const lockPath = `${budgetPath(boxRoot)}.lock`;
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  return withFileLock({ lockPath, metadata: { purpose: "jev-budget" }, waitMs: 10_000 }, async () => {
    const today = await boxLocalDay(boxRoot, now);
    const stored = await readBudget(boxRoot);
    const cutoff = now.getTime() - DAY_MS;
    const deferrals = (stored?.deferrals ?? []).filter((at) => new Date(at).getTime() >= cutoff);
    const used = stored?.day === today ? stored.calls : 0;
    if (used + calls > JEV_DAILY_CAP) {
      await writeBudget(boxRoot, { day: today, calls: used, deferrals: [...deferrals, now.toISOString()] });
      return false;
    }
    await writeBudget(boxRoot, { day: today, calls: used + calls, deferrals });
    return true;
  });
}

/** Structurally a `HealthCheck` (`webapp/trpc/routers/health.ts`). */
interface JevBudgetHealthCheck {
  name: string;
  ok: boolean;
  message: string;
  severity: "error" | "warning";
}

/** How many runs deferred for the Jev budget in the last 24 hours. */
export async function jevBudgetHealthCheck(boxRoot: string, opts: { now: Date }): Promise<JevBudgetHealthCheck> {
  const stored = await readBudget(boxRoot);
  const cutoff = opts.now.getTime() - DAY_MS;
  const deferred = (stored?.deferrals ?? []).filter((at) => new Date(at).getTime() >= cutoff).length;
  return {
    name: "jev-budget",
    ok: deferred === 0,
    message: deferred === 0
      ? "No judgment deferred for the daily Jev budget in the last 24 hours"
      : `${String(deferred)} judgment run(s) deferred in the last 24 hours because the box reached its daily cap of ${String(JEV_DAILY_CAP)} Jev calls; their schedules retry with the same items`,
    severity: "warning",
  };
}
