/**
 * What a maintenance owner is doing now, for a closed box to show. It lives in
 * its own file beside phase.json because admission reads phase.json: a step
 * write can then never restore a stale phase or change who gets in.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "../atomic-write.js";
import { errnoCode } from "../../shared/error-guards.js";

const stepSchema = z.object({ id: z.string().uuid(), name: z.string(), since: z.string().datetime() });
export interface MaintenanceStep { name: string; since: string }

/** Diagnostic only: a failed write warns and never stops the work it describes. */
export async function writeMaintenanceStep(directory: string, { id, name }: { id: string; name: string }): Promise<void> {
  try {
    await writeFileAtomic(join(directory, "step.json"), { content: JSON.stringify({ id, name, since: new Date().toISOString() }) });
  } catch (error) {
    console.warn("[box-maintenance] step was not recorded:", error);
  }
}

/** The step of maintenance `id`; a step left by any other attempt is not its step. */
export async function readMaintenanceStep(directory: string, id: string): Promise<MaintenanceStep | undefined> {
  let record: z.infer<typeof stepSchema>;
  try { record = stepSchema.parse(JSON.parse(await readFile(join(directory, "step.json"), "utf8"))); }
  catch (error) { if (errnoCode(error) === "ENOENT") return undefined; throw error; }
  return record.id === id ? { name: record.name, since: record.since } : undefined;
}
