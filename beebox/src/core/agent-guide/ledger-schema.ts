/**
 * Shape of `ledger.yaml`, the agent guide's source of decisions: the size
 * budget, the linter's switches, the handle registry, and one row per rule
 * with its bin and reason. Validated with zod at the YAML parse boundary so a
 * malformed ledger fails with a pointed error. The spec is `docs/agent-guide.md`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { PACKAGE_ROOT } from "../../lib/package-root.js";

/** A section handle: ALL_CAPS words joined by underscores. */
export const HANDLE_PATTERN = /^[A-Z]+(?:_[A-Z]+)*$/;
/** A row id: `<section>.<slug>`, lowercase words joined by hyphens. */
const ROW_ID_PATTERN = /^[\da-z]+(?:-[\da-z]+)*(?:\.[\da-z]+(?:-[\da-z]+)*)+$/;

const handleSchema = z.string().regex(HANDLE_PATTERN, { message: "a handle is ALL_CAPS words joined by underscores" });

const binSchema = z.enum(["law", "core", "indirect", "delete"]);

const rowSchema = z.object({
  id: z.string().regex(ROW_ID_PATTERN, { message: "a row id is <section>.<slug> in lowercase-hyphen words" }),
  /** One sentence: the thing an agent must know or do. */
  rule: z.string().min(1),
  /** The handle of the section that carries the rule, or the surface it moved to. */
  handle: z.string().min(1),
  bin: binSchema,
  /** Why this bin, in one or two sentences. */
  reason: z.string().min(1),
  /** Ids in `src/dev/knowledge-audits.yaml` that guard the rule. */
  audits: z.array(z.string()),
  /** Where the how-to lives: a package doc, a rule, a skill. */
  mechanics: z.string().optional(),
}).strict();
export type LedgerRow = z.infer<typeof rowSchema>;

const registryEntrySchema = z.object({
  handle: handleSchema,
  /** One line: what the section governs. */
  governs: z.string().min(1),
  /** Who names the handle: another handle, or a path relative to the beebox package. */
  referrers: z.array(z.string()),
}).strict();

const ledgerSchema = z.object({
  budget: z.object({
    /** Words in the rendered `.beebox/agent-guide.md`, DOCID line included. */
    guide_words: z.number().int().positive(),
    /** The `agent-context chat` always-loaded total. */
    always_loaded_words: z.number().int().positive(),
    /** Words a covered section may carry outside any cited passage. */
    uncited_words_per_section: z.number().int().nonnegative(),
  }).strict(),
  lint: z.object({
    /** Sections whose coverage and allowance checks are on. */
    covered_sections: z.array(handleSchema),
  }).strict(),
  registry: z.array(registryEntrySchema).min(1),
  rows: z.array(rowSchema),
}).strict().superRefine((ledger, ctx) => {
  const handles = new Set<string>();
  for (const entry of ledger.registry) {
    if (handles.has(entry.handle)) ctx.addIssue({ code: "custom", message: `duplicate registry handle ${entry.handle}` });
    handles.add(entry.handle);
  }
  for (const covered of ledger.lint.covered_sections) {
    if (!handles.has(covered)) ctx.addIssue({ code: "custom", message: `covered section ${covered} is not a registry handle` });
  }
  const ids = new Set<string>();
  for (const row of ledger.rows) {
    if (ids.has(row.id)) ctx.addIssue({ code: "custom", message: `duplicate row id ${row.id}` });
    ids.add(row.id);
    const staysInGuide = row.bin === "law" || row.bin === "core";
    if (staysInGuide && !handles.has(row.handle)) {
      ctx.addIssue({ code: "custom", message: `row ${row.id} is ${row.bin} but its handle ${row.handle} is not a registry handle` });
    }
  }
});
export type Ledger = z.infer<typeof ledgerSchema>;

/** Where the ledger lives in the package; read at runtime, so the package ships it. */
const LEDGER_PATH = join(PACKAGE_ROOT, "src", "core", "agent-guide", "ledger.yaml");

/** Parse and validate ledger text (throws a zod error naming the bad field). */
export function parseLedger(text: string): Ledger {
  return ledgerSchema.parse(parseYaml(text));
}

let cached: Ledger | undefined;

/** The package's ledger, read once per process. */
export function loadLedger(): Ledger {
  cached ??= parseLedger(readFileSync(LEDGER_PATH, "utf-8"));
  return cached;
}
