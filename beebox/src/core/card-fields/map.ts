/**
 * A field map: how a box's cards move off reserved field names, written by
 * the box's agent or boxholder and applied by `bbx migrate-fields`. One
 * planner shape covers what the shipped card-field migrations did by hand:
 * rename a key, or replace each of its values with specific fields.
 *
 * ```yaml
 * types:
 *   book:
 *     status: { rename: ownership }          # keep the value under a new name
 *   bill:
 *     status:
 *       values:                               # each old value becomes these fields
 *         paid: { paid: true }
 *         auto-pay: { auto-pay: true }
 *         unpaid: {}                          # nothing: absence means unpaid
 *       unlisted: refuse                      # refuse (default) | drop
 *     date: { rename: due }
 *   lesson:
 *     "segments[].status": { rename: stage }  # each entry of a list
 *   progress:
 *     "units{}.status": { rename: stage }     # each value of a map
 *   docket-entry:
 *     date: { wrap: { field: filed, key: value } }          # filed: { value: <old> }
 *   snapshot:
 *     source: { wrap: { field: sources, key: href, list: true } }  # sources: [{ href: <old> }]
 * ```
 */

import { z } from "zod";
import { isRecord } from "../../shared/is-record.js";
import { UnmappedFieldError, UnmappedStatusError, type FieldEdit, type FieldEditPlan, type FieldPlanner } from "./field-edits.js";

const SetFields = z.record(z.string(), z.unknown());

const RenameRule = z.object({ rename: z.string().min(1) }).strict();
const ValuesRule = z
  .object({
    values: z.record(z.string(), SetFields),
    unlisted: z.enum(["refuse", "drop"]).optional(),
  })
  .strict();
const WrapRule = z
  .object({
    wrap: z.object({ field: z.string().min(1), key: z.string().min(1), list: z.boolean().optional() }).strict(),
  })
  .strict();
const FieldRule = z.union([RenameRule, ValuesRule, WrapRule]);

/**
 * A field key: top-level (`status`), per list entry (`segments[].status`),
 * or per value of a map (`units{}.status`).
 */
const FIELD_KEY = /^(?:([\w.-]+)(\[]|{})\.)?([\w.-]+)$/;

export const FieldMapSchema = z
  .object({
    types: z.record(z.string(), z.record(z.string().regex(FIELD_KEY), FieldRule)),
  })
  .strict();
export type FieldMap = z.infer<typeof FieldMapSchema>;
type Rule = z.infer<typeof FieldRule>;

/** Read a map from parsed YAML/JSON, or throw with the schema's message. */
export function parseFieldMap(raw: unknown): FieldMap {
  return FieldMapSchema.parse(raw);
}

function ruleEdits({ where, base, entry, field, rule }: {
  where: string;
  base: ReadonlyArray<string | number>;
  entry: Record<string, unknown>;
  field: string;
  rule: Rule;
}): FieldEdit[] {
  if (!(field in entry)) return [];
  if ("rename" in rule) {
    if (rule.rename in entry) throw new UnmappedFieldError({ type: where, field: rule.rename, problem: "old-and-new" });
    // The new key is placed while the old one is still there to anchor it.
    return [
      { op: "set", path: [...base, rule.rename], value: entry[field], after: field },
      { op: "delete", path: [...base, field] },
    ];
  }
  if ("wrap" in rule) {
    const { field: target, key, list } = rule.wrap;
    if (target in entry) throw new UnmappedFieldError({ type: where, field: target, problem: "old-and-new" });
    const wrapped = { [key]: entry[field] };
    return [
      { op: "set", path: [...base, target], value: list === true ? [wrapped] : wrapped, after: field },
      { op: "delete", path: [...base, field] },
    ];
  }
  const value = entry[field];
  const sets = typeof value === "string" && Object.hasOwn(rule.values, value) ? rule.values[value] : undefined;
  if (sets === undefined) {
    if (rule.unlisted === "drop") return [{ op: "delete", path: [...base, field] }];
    throw new UnmappedStatusError({ type: `${where} ${field}`, status: value });
  }
  const edits: FieldEdit[] = [];
  for (const [name, set] of Object.entries(sets)) {
    // A key the card already carries with the same value is fine (a bill
    // with `auto-pay: true` and `status: auto-pay`); a different value is not.
    if (name in entry && name !== field) {
      if (JSON.stringify(entry[name]) === JSON.stringify(set)) continue;
      throw new UnmappedFieldError({ type: where, field: name, problem: "old-and-new" });
    }
    edits.push({ op: "set", path: [...base, name], value: set, after: field });
  }
  edits.push({ op: "delete", path: [...base, field] });
  return edits;
}

/** The planner a map describes; types the map does not name are untouched. */
export function fieldMapPlanner(map: FieldMap): FieldPlanner {
  return (type, fm): FieldEditPlan => {
    const rules = map.types[type];
    if (rules === undefined) return { edits: [], warnings: [] };
    const edits: FieldEdit[] = [];
    for (const [key, rule] of Object.entries(rules)) {
      const match = FIELD_KEY.exec(key);
      const container = match?.[1];
      const shape = match?.[2];
      const field = match?.[3];
      if (field === undefined) continue;
      if (container === undefined) {
        edits.push(...ruleEdits({ where: type, base: [], entry: fm, field, rule }));
        continue;
      }
      const held = fm[container];
      if (held === undefined) continue;
      // A container of the wrong shape is refused, not skipped: a key that
      // silently matched nothing would leave the field in place unnoticed.
      if (shape === "[]" ? !Array.isArray(held) : !isRecord(held)) {
        throw new UnmappedFieldError({ type, field: container, problem: shape === "[]" ? "not-a-list" : "not-a-map" });
      }
      const members: Array<[string | number, unknown]> = Array.isArray(held)
        ? [...held.entries()]
        : isRecord(held) ? Object.entries(held) : [];
      for (const [k, entry] of members) {
        const where = `${type} ${container}${Array.isArray(held) ? `[${String(k)}]` : `.${String(k)}`}`;
        if (!isRecord(entry)) throw new UnmappedFieldError({ type: where, field, problem: "not-a-map" });
        edits.push(...ruleEdits({ where, base: [container, k], entry, field, rule }));
      }
    }
    return { edits, warnings: [] };
  };
}
