/**
 * Procedure run card schema (Phase-2 frontmatter, no body).
 *
 * Tracks the execution state of a procedure run. Created in
 * procedure/runs/<name>_<timestamp>/run.procedure-run.card
 */

import { splitCardContent, cardSchema, type CardSchema } from "../cards/index.js";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const Iso = z.string().datetime({ offset: true });

/** Precheck phase result. */
export const RunStepPrecheck = z.object({
  status: z.enum(["pass", "fail", "skip"]),
  stdout: z.string().optional(),
});

/** Run phase result. */
export const RunStepRun = z.object({
  "session-id": z.string().optional(),
  stdout: z.string().optional(),
  error: z.string().optional(),
  "git-ref": z.string().optional(),
});

/**
 * Validate phase result.
 *
 * `inconclusive` is the non-verdict: the checker never decided (its review
 * reached the turn cap, timed out, or returned nothing parseable). It is
 * neither a pass nor a fail, and it never gates the step on its own — the
 * work may be fine and nobody knows. `error` carries the concrete reason.
 * Additive to the enum: run cards written before it still load.
 */
export const RunStepValidate = z.object({
  status: z.enum(["pass", "fail", "warn", "inconclusive"]),
  stdout: z.string().optional(),
  review: z.string().optional(),
  error: z.string().optional(),
});

/** One step's execution record. */
export const RunStep = z.object({
  id: z.string(),
  status: z.enum(["pending", "running", "completed", "skipped", "failed"]),
  "started-at": Iso.optional(),
  "completed-at": Iso.optional(),
  precheck: RunStepPrecheck.optional(),
  run: RunStepRun.optional(),
  validate: RunStepValidate.optional(),
});

const procedureRunFields = {
  procedure: z.string(),
  status: z.enum(["pending", "running", "completed", "failed", "inconclusive"]),
  "started-at": Iso,
  "completed-at": Iso.optional(),
  directive: z.string().optional(),
  expires: z.union([z.literal("never"), Iso]).optional(),
  steps: z.array(RunStep),
};

export const ProcedureRunSchema: CardSchema = cardSchema("procedure-run", {
  description: "Engine-managed execution state for one run of a procedure — read for progress, don't edit (except expires)",
  category: "system",
  searchable: false,
  fields: procedureRunFields,
  instructions: `# Handling Procedure Runs

This card is managed by the procedure engine. Agents should read it to understand execution progress but should NOT modify it directly — with one exception: the \`expires\` field.

Check the root \`status\` field for overall progress: pending → running → completed/failed/inconclusive. Each entry in \`steps\` also has its own status.

\`inconclusive\` means every step's work completed but at least one \`validate\` check never reached a verdict (its review ran out of turns, timed out, or returned nothing parseable). The work is unjudged, not wrong — do not redo it on that basis; read the step's \`validate.error\` for the reason.

Step statuses: pending → running → completed/skipped/failed. Look at a step's \`precheck.status\` to see why it was skipped, \`run.error\` for run-agent or shell failures, and \`validate.error\` / \`validate.status\` for validation failures (\`validate.status: inconclusive\` is a non-verdict, not a failure).

The \`expires\` field (stamped by the engine at completion) is when \`cb procedure gc\` may delete this run's directory. Run dirs are a recent cache — git history is the archive. To retain a specific run, set \`expires: never\` or push the date out.

The \`procedure\` field names the procedure definition this run belongs to. The run card lives in \`procedure/runs/<name>_<timestamp>/\`.`,
});

const ProcedureRunObject = z.object(procedureRunFields);
export type ProcedureRunFields = z.infer<typeof ProcedureRunObject>;
export type RunStepResult = z.infer<typeof RunStep>;
/** Back-compat alias for the run-card fields type. */
export type ProcedureRun = ProcedureRunFields;

/**
 * Parse a run card's raw text into typed fields, or null if it has no
 * frontmatter or fails validation. Used by the engine and gc to read run
 * cards directly without going through the full card loader.
 */
export function parseProcedureRun(content: string): ProcedureRunFields | null {
  const split = splitCardContent(content);
  if (!split.hasFrontmatter) return null;
  let fm: unknown;
  try {
    fm = parseYaml(split.frontmatterText);
  } catch (_e) {
    return null;
  }
  const parsed = ProcedureRunObject.safeParse(fm ?? {});
  if (!parsed.success) return null;
  return parsed.data;
}
