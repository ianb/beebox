/**
 * Apply a {@link FieldMap} to every card in a box: plan each card of a mapped
 * type, rewrite the changed ones (with `apply`), and report what happened.
 * A card the planner refuses is reported and left as it was; the run does not
 * stop, so one odd card never hides the rest of the report.
 */

import { relative } from "node:path";
import { listBoxCardFiles } from "../list-cards.js";
import { typeFromFilename } from "../card-io.js";
import { errorMessage } from "../../shared/error-guards.js";
import { convertCardFile } from "./field-edits.js";
import { fieldMapPlanner, type FieldMap } from "./map.js";

export interface FieldMapReport {
  /** Box-relative paths rewritten (or that would be, on a dry run). */
  converted: string[];
  /** Cards of a mapped type that needed no change. */
  already: number;
  /** Cards the map could not convert safely, with the reason. */
  refused: Array<{ path: string; reason: string }>;
}

export async function applyFieldMap(boxRoot: string, { map, apply }: { map: FieldMap; apply: boolean }): Promise<FieldMapReport> {
  const plan = fieldMapPlanner(map);
  const types = new Set(Object.keys(map.types));
  const report: FieldMapReport = { converted: [], already: 0, refused: [] };
  for (const file of (await listBoxCardFiles(boxRoot)).toSorted()) {
    const type = typeFromFilename(file);
    if (type === undefined || !types.has(type)) continue;
    const path = relative(boxRoot, file);
    try {
      const result = await convertCardFile(file, { plan, apply });
      if (result.outcome === "converted") report.converted.push(path);
      else report.already += 1;
    } catch (e) {
      report.refused.push({ path, reason: errorMessage(e) });
    }
  }
  return report;
}
