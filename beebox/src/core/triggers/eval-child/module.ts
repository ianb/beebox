/**
 * Validate an imported trigger module against the contract in `types.ts`.
 * A bad module is an `invalid` with a message naming the export, so
 * `bbx chat trigger arm` can refuse it with a reason the agent can fix.
 */

import { isRecord } from "../../../shared/is-record.js";
import { TICK_FLOOR_SECONDS, type TriggerModule } from "../types.js";

const TYPES_IMPORT = "import type { TriggerModule } from \"beebox/triggers\"";

export type TriggerModuleCheck = { module: TriggerModule } | { invalid: string };

export function validateTriggerModule(imported: unknown): TriggerModuleCheck {
  if (!isRecord(imported)) return { invalid: `the file has no exports (${TYPES_IMPORT})` };
  const { label, trigger, tick } = imported;
  if (typeof label !== "function") return { invalid: "the file exports no `label` function (export function label(config): string)" };
  if (typeof trigger !== "function") return { invalid: "the file exports no `trigger` function (export async function trigger(input, ctx): Promise<TriggerResult | null>)" };
  if (tick !== undefined && (typeof tick !== "number" || !Number.isFinite(tick) || tick < TICK_FLOOR_SECONDS)) {
    return { invalid: `\`tick\` must be a number of seconds, at least ${String(TICK_FLOOR_SECONDS)} (got ${JSON.stringify(tick)})` };
  }
  // The functions are checked as functions above; their signatures are the box's tsc's job.
  // eslint-disable-next-line no-restricted-syntax -- the shape was verified field by field just above; this is the one place the import boundary is crossed
  const module = { label, trigger, ...(tick === undefined ? {} : { tick }) } as TriggerModule;
  return { module };
}
