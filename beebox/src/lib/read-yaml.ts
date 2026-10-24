/**
 * Read-only YAML parsing: text to plain values.
 *
 * Reads parse with js-yaml, which is 4–7× faster than the `yaml` package on
 * box cards (`docs/plans/yaml-read-parser.md`). Writing and editing YAML stays
 * on `yaml`: `stringify`, and `parseDocument` for edits that keep a block's
 * comments and quoting; js-yaml has no document model. An edit planned from
 * parsed values also parses with `yaml`, so the plan and the edit read the
 * text the same way (`core/card-fields/field-edits.ts`).
 *
 * The schema is the YAML 1.2 core schema, as `yaml` resolves by default: no
 * timestamps, no merge keys. Known differences from `yaml` on hand-typed
 * input: a signed float without a leading digit (`-.5`) stays a string, `0b101`
 * is a number, and an unknown tag (`!foo`) is a syntax error rather than a
 * warning.
 */

import { CORE_SCHEMA, load, YAMLException } from "js-yaml";

/** YAML text as plain values. Empty or comment-only text is `null`. */
export function parseYaml(text: string): unknown {
  return load(text, { schema: CORE_SCHEMA }) ?? null;
}

/** Whether `error` is a YAML syntax or structure error thrown by {@link parseYaml}. */
export function isYamlSyntaxError(error: unknown): boolean {
  return error instanceof YAMLException;
}
