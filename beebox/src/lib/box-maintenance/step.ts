/**
 * What a maintenance owner is doing now, for a closed box to show. Each
 * attempt's step has its own file beside phase.json: admission reads
 * phase.json, so a step write can never restore a stale phase, and one
 * attempt's late write can never replace another's step.
 */
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "../atomic-write.js";
import { errnoCode } from "../../shared/error-guards.js";

const stepSchema = z.object({ name: z.string(), since: z.string().datetime() });
export type MaintenanceStep = z.infer<typeof stepSchema>;

function stepPath(directory: string, id: string): string {
  return join(directory, `step-${id}.json`);
}

/** Diagnostic only: a failed write warns and never stops the work it describes. */
export async function writeMaintenanceStep(directory: string, { id, name }: { id: string; name: string }): Promise<void> {
  try {
    await writeFileAtomic(stepPath(directory, id), { content: JSON.stringify({ name, since: new Date().toISOString() }) });
  } catch (error) {
    console.warn("[box-maintenance] step was not recorded:", error);
  }
}

/** A step that cannot be read is absent: it must never stop a closed box from saying why it is closed. */
export async function readMaintenanceStep(directory: string, id: string): Promise<MaintenanceStep | undefined> {
  try {
    return stepSchema.parse(JSON.parse(await readFile(stepPath(directory, id), "utf8")));
  } catch (error) {
    if (errnoCode(error) !== "ENOENT") console.warn("[box-maintenance] step could not be read:", error);
    return undefined;
  }
}

/** A phase change ends the step, and a cleared or replaced record takes its step with it. */
export async function clearMaintenanceStep(directory: string, id: string): Promise<void> {
  try {
    await rm(stepPath(directory, id), { force: true });
  } catch (error) {
    console.warn("[box-maintenance] step was not cleared:", error);
  }
}
