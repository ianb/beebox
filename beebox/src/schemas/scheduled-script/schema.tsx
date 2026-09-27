/**
 * Scheduled script card schema - declarative scheduling for commands.
 *
 * Scheduled scripts define what to run and when. They live in
 * _config/schedules/ and are evaluated by `bbx tick` (cron) and
 * `bbx wakeup` (on-wakeup scripts).
 *
 * The filename stem is the identity (e.g., check-email.scheduled-script.card).
 */

import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { cardSchema, type InferCardFields } from "../../cards/index.js";
import { parseDuration, parseBudget } from "../../scheduled-script-duration.js";
import { DatetimeField, CronField, RruleField, NotifyField, type ScheduleNotify } from "../../scheduled-script-fields.js";
import { SCHEDULED_SCRIPT_INSTRUCTIONS } from "./instructions.js";

export { parseDuration, parseBudget } from "../../scheduled-script-duration.js";

// --- Schema ---

const SourceField = z.union([
  z.string(),
  z.object({
    text: z.string().optional(),
    ref: z.string().optional(),
  }),
]);

const CreateAfterSuccessEntry = z.object({
  path: z.string(),
  args: z.record(z.string(), z.string()).optional(),
});

const RequiresField = z.object({
  connectors: z.array(z.string()).optional(),
});

export const ScheduledScriptSchema = cardSchema("scheduled-script", {
  brief: "A schedule for a command",
  description: "Declarative scheduling for a command — cron/at/rrule plus budgets, locks, and wakeup opportunism",
  category: "authored",
  searchable: false,
  fields: {
    cron: CronField.optional(),
    at: DatetimeField.optional(),
    rrule: RruleField.optional(),
    until: DatetimeField.optional(),
    "not-before": z.string().optional(),
    "on-wakeup": z.boolean().optional(),
    once: z.boolean().optional(),
    enabled: z.boolean().optional(),
    budget: z.string().optional(),
    "lock-group": z.string().optional(),
    timeout: z.string().optional(),
    description: z.string().optional(),
    runs: z.string().optional(),
    notify: NotifyField.optional(),
    "requested-by": z.literal("boxholder").optional(),
    source: SourceField.optional(),
    "create-after-success": z.array(CreateAfterSuccessEntry).optional(),
    requires: RequiresField.optional(),
  },
  instructions: SCHEDULED_SCRIPT_INSTRUCTIONS,
  // `enabled` is per-box state, not part of the shipped definition: a box turns
  // a schedule on or off for itself. Declaring it box-owned means a box that
  // only toggled `enabled` still receives upstream definition updates (new
  // cron/runs/description), with its own enabled state carried onto them,
  // instead of the whole card parking as "edited." Any edit beyond `enabled`
  // (retimed cron, changed runs) still parks for review.
  templateMerge: { boxOwnedFields: ["enabled"] },
  superRefine: (fields, ctx) => {
    if ((fields.runs === undefined) === (fields.notify === undefined)) {
      ctx.addIssue({
        code: "custom",
        path: [fields.runs === undefined ? "runs" : "notify"],
        message: "a scheduled script needs exactly one of runs (a command) and notify (a notification)",
      });
    }
    const present: Array<"cron" | "at" | "rrule"> = [];
    if (fields.cron !== undefined) present.push("cron");
    if (fields.at !== undefined) present.push("at");
    if (fields.rrule !== undefined) present.push("rrule");
    if (present.length > 1) {
      for (const key of present) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "cron, at, and rrule are mutually exclusive — specify at most one",
        });
      }
    }
  },
});

// --- Field types (raw frontmatter shape) ---

export type ScheduledScriptFields = InferCardFields<typeof ScheduledScriptSchema>;

// --- Parsed scheduled script (computed/normalized) ---

/** What a schedule does when it fires: run a command, or send a notification. */
export type ScheduleAction =
  | { kind: "runs"; command: string }
  | { kind: "notify"; notify: ScheduleNotify };

export interface ScheduleRequirements {
  connectors: string[];
}

export interface ParsedScheduledScript {
  cron: string | undefined;
  at: string | undefined;
  rrule: string | undefined;
  until: string | undefined;
  notBefore: string | undefined;
  onWakeup: boolean;
  once: boolean;
  enabled: boolean;
  action: ScheduleAction;
  /** `boxholder` when the boxholder asked for this schedule. */
  requestedBy: "boxholder" | undefined;
  description: string | undefined;
  source: { ref?: string; text?: string } | undefined;
  createAfterSuccess: Array<{ path: string; args: Record<string, string> }>;
  budget: { limitMs: number; windowMs: number } | undefined;
  lockGroup: string | undefined;
  timeoutMs: number | undefined;
  requires: ScheduleRequirements | undefined;
}

function normalizeSource(src: ScheduledScriptFields["source"]): { ref?: string; text?: string } | undefined {
  if (src === undefined) return undefined;
  if (typeof src === "string") return { text: src };
  const out: { ref?: string; text?: string } = {};
  if (src.ref !== undefined) out.ref = src.ref;
  if (src.text !== undefined) out.text = src.text;
  return out;
}

class ScheduleActionMissingError extends Error {
  constructor() {
    super("scheduled script has neither runs nor notify; the schema's refinement should have refused it");
    this.name = "ScheduleActionMissingError";
  }
}

function scheduleAction(fields: ScheduledScriptFields): ScheduleAction {
  if (fields.runs !== undefined) return { kind: "runs", command: fields.runs };
  if (fields.notify !== undefined) return { kind: "notify", notify: fields.notify };
  throw new ScheduleActionMissingError();
}

/** One line for lists and logs: the command, or `notify: <title>`. */
export function describeScheduleAction(action: ScheduleAction): string {
  return action.kind === "runs" ? action.command : `notify: ${action.notify.title}`;
}

/**
 * Parse a scheduled-script fields object into a typed structure.
 */
export function parseScheduledScript(fields: ScheduledScriptFields): ParsedScheduledScript {
  return {
    cron: fields.cron,
    at: fields.at,
    rrule: fields.rrule,
    until: fields.until,
    notBefore: fields["not-before"],
    onWakeup: fields["on-wakeup"] === true,
    once: fields.once === true,
    enabled: fields.enabled !== false,
    action: scheduleAction(fields),
    requestedBy: fields["requested-by"],
    description: fields.description,
    source: normalizeSource(fields.source),
    createAfterSuccess: (fields["create-after-success"] ?? []).map((e) => ({
      path: e.path,
      args: e.args ?? {},
    })),
    budget: fields.budget !== undefined ? parseBudget(fields.budget) : undefined,
    lockGroup: fields["lock-group"],
    timeoutMs: fields.timeout !== undefined ? parseDuration(fields.timeout) : undefined,
    requires:
      fields.requires?.connectors && fields.requires.connectors.length > 0
        ? { connectors: fields.requires.connectors }
        : undefined,
  };
}

// --- Template ---

export interface ScheduledScriptTemplateOptions {
  cron?: string;
  at?: string;
  rrule?: string;
  until?: string;
  notBefore?: string;
  onWakeup?: boolean;
  once?: boolean;
  enabled?: boolean;
  runs: string;
  description?: string;
  source?: string;
  sourceRef?: string;
  createAfterSuccess?: Array<{ path: string; args: Record<string, string> }>;
  budget?: string;
  lockGroup?: string;
  timeout?: string;
  requires?: string[];
}

class InvalidScheduledScriptTemplateError extends Error {
  constructor(issues: string) {
    super(`createScheduledScriptTemplate produced an invalid card: ${issues}`);
    this.name = "InvalidScheduledScriptTemplateError";
  }
}

/**
 * Create a scheduled-script card template (YAML frontmatter + empty body).
 * Throws {@link InvalidScheduledScriptTemplateError} if the assembled fields
 * would fail schema validation — a programmatic caller should fail here, not
 * hand the box a card that can't load.
 */
export function createScheduledScriptTemplate(options: ScheduledScriptTemplateOptions): string {
  const fields: Record<string, unknown> = {};
  if (options.cron !== undefined) fields["cron"] = options.cron;
  if (options.at !== undefined) fields["at"] = options.at;
  if (options.rrule !== undefined) fields["rrule"] = options.rrule;
  if (options.until !== undefined) fields["until"] = options.until;
  if (options.notBefore !== undefined) fields["not-before"] = options.notBefore;
  if (options.onWakeup === true) fields["on-wakeup"] = true;
  if (options.once === true) fields["once"] = true;
  if (options.enabled === false) fields["enabled"] = false;
  if (options.budget !== undefined) fields["budget"] = options.budget;
  if (options.lockGroup !== undefined) fields["lock-group"] = options.lockGroup;
  if (options.timeout !== undefined) fields["timeout"] = options.timeout;
  if (options.description !== undefined) fields["description"] = options.description;
  fields["runs"] = options.runs;
  if (options.source !== undefined || options.sourceRef !== undefined) {
    if (options.sourceRef !== undefined) {
      const src: Record<string, string> = {};
      if (options.source !== undefined) src["text"] = options.source;
      src["ref"] = options.sourceRef;
      fields["source"] = src;
    } else {
      fields["source"] = options.source;
    }
  }
  if (options.createAfterSuccess !== undefined && options.createAfterSuccess.length > 0) {
    fields["create-after-success"] = options.createAfterSuccess.map((e) => ({
      path: e.path,
      ...(Object.keys(e.args).length > 0 && { args: e.args }),
    }));
  }
  if (options.requires !== undefined && options.requires.length > 0) {
    fields["requires"] = { connectors: options.requires };
  }
  const check = ScheduledScriptSchema.frontmatterSchema.safeParse({
    type: "scheduled-script",
    ...fields,
  });
  if (!check.success) {
    const issues = check.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new InvalidScheduledScriptTemplateError(issues);
  }
  return `---\n${stringifyYaml(fields)}---\n`;
}
